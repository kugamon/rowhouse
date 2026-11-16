/**
 * DEVELOPMENT ONLY. Never packaged.
 * GridController — the @AuraEnabled surface the LWC calls. Runs as
 * GridTestUsers.fullUser(), as a subscriber's user would call it.
 */
@IsTest
private class GridControllerTest {
    @TestSetup
    static void setup() {
        // At API 67 plain DML runs in user mode, so the seed rows are written by
        // a user with field access, not by whoever runs the suite.
        System.runAs(GridTestUsers.fullUser()) {
            insert new List<Consignment__c>{
                new Consignment__c(
                    Name = 'Bath Iron fasteners, bulk',
                    Pieces__c = Decimal.valueOf('999999999999999999')
                ),
                new Consignment__c(
                    Name = 'Driver log, Fort Kent',
                    Consignee__c = 'Kennebec Lumber',
                    Delivery_Notes__c = 'Driver reports the dock door was blocked until the next shift. '
                        .repeat(600)
                        .left(32000)
                )
            };
        }
    }

    @IsTest
    static void configCarriesTheDefinitionAndTheDiagnosticsFlag() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> result = GridController.openGrid('Consignments', null, null, null, null, null);
            GridConfig.Definition def = (GridConfig.Definition) result.get('definition');
            System.assertEquals('Consignment__c', def.objectApiName);
            System.assertEquals(false, result.get('diagnostics'), 'Diagnostics are off without the custom permission.');
        }
    }

    @IsTest
    static void configCarriesIconsAndTheNameColumn() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = (GridConfig.Definition) GridController.openGrid(
                    'Consignments',
                    null,
                    null,
                    null,
                    null,
                    null
                )
                .get('definition');
            // The object's tab icon, or the record icon for an object with no tab.
            System.assert(Pattern.matches('(standard|custom):[a-z0-9_]+', def.objectIcon), def.objectIcon);
            Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
            for (GridConfig.Column c : def.columns) {
                byField.put(c.field, c);
            }
            System.assert(byField.get('Name').isName, 'Name cells link to the record.');
            System.assert(!byField.get('Consignee__c').isName);
            GridConfig.Column lookup = byField.get('Shipper__c');
            System.assert(lookup.referenceIcons.containsKey('Account'), String.valueOf(lookup.referenceIcons));
            GridConfig.Column owner = byField.get('OwnerId');
            if (owner != null) {
                System.assertEquals(
                    GridIcons.QUEUE,
                    owner.referenceIcons.get('Group'),
                    'An owner\'s queues show the queue icon.'
                );
            }
            System.assertEquals(null, byField.get('Consignee__c').referenceIcons, 'Only lookups have target icons.');
        }
    }

    @IsTest
    static void iconsAreNotWorkedOutOnTheRowCalls() {
        System.runAs(GridTestUsers.fullUser()) {
            // forUser is what every other call uses: no icons, so no describeTabs per call.
            System.assertEquals(null, GridConfig.forUser('Consignments').objectIcon);
        }
    }

    @IsTest
    static void countsRelatedRecordsPerRowAndPerTab() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Consignment__c> parents = [SELECT Id FROM Consignment__c ORDER BY Name LIMIT 2];
            insert new List<Consignment_Item__c>{
                new Consignment_Item__c(Name = 'Hex bolts, 4 kegs', Consignment__c = parents[0].Id),
                new Consignment_Item__c(Name = 'Lag screws, 2 kegs', Consignment__c = parents[0].Id)
            };
            Map<String, Object> counts = GridController.countChildren(
                'Consignments',
                new List<String>{ parents[0].Id, parents[1].Id, UserInfo.getUserId(), 'not an id', null }
            );
            System.assertEquals(2, counts.size(), 'Only records of the grid\'s object are counted: ' + counts);
            Map<String, Object> first = (Map<String, Object>) counts.get(String.valueOf(parents[0].Id));
            System.assertEquals(2, first.get('total'));
            System.assertEquals(2, ((Map<String, Integer>) first.get('byTab')).get('Consignments_Items'));
            Map<String, Object> second = (Map<String, Object>) counts.get(String.valueOf(parents[1].Id));
            System.assertEquals(0, second.get('total'), 'A row with nothing related says 0, so it offers no toggle.');
            System.assertEquals(0, ((Map<String, Integer>) second.get('byTab')).get('Consignments_Items'));
        }
    }

    @IsTest
    static void countsAreRefusedForTooManyRowsAtOnce() {
        System.runAs(GridTestUsers.fullUser()) {
            Id first = [SELECT Id FROM Consignment__c LIMIT 1].Id;
            String prefix = String.valueOf(first).left(3);
            List<String> ids = new List<String>();
            for (Integer i = 0; i <= GridChildTables.MAX_COUNT_PARENTS; i++) {
                ids.add(prefix + '0'.repeat(12 - String.valueOf(i).length()) + String.valueOf(i)); // 15 characters
            }
            try {
                GridController.countChildren('Consignments', ids);
                System.assert(false, 'More than the limit must be refused.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('at most ' + GridChildTables.MAX_COUNT_PARENTS), e.getMessage());
            }
        }
    }

    @IsTest
    static void rowsTravelWithDecimalsAsExactStrings() {
        System.runAs(GridTestUsers.fullUser()) {
            // TC-024: through REST this value comes back as 1.0E18. It must reach the
            // browser as the exact digits.
            Map<String, Object> result = GridController.fetchRows(
                'Consignments',
                'Bath Iron',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get('rows');
            System.assertEquals(1, rows.size());
            System.assertEquals('999999999999999999', rows[0].get('Pieces__c'));
            System.assert(rows[0].containsKey('Name'), 'Rows are keyed by local field name (HR-4).');
        }
    }

    @IsTest
    static void longTextIsTruncatedForTheGrid() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> result = GridController.fetchRows(
                'Consignment_Charges',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            Integer marked = 0;
            for (Map<String, Object> row : (List<Map<String, Object>>) result.get('rows')) {
                String text = (String) row.get('Delivery_Notes__c');
                if (text != null) {
                    System.assert(
                        text.length() <= 1001,
                        'TC-055: ' + text.length() + ' characters shipped to a grid cell.'
                    );
                }
                if (row.containsKey('_cut')) {
                    // A shortened value says so, for its editor.
                    System.assertEquals(new List<String>{ 'Delivery_Notes__c' }, row.get('_cut'));
                    marked++;
                }
            }
            System.assertEquals(1, marked, 'Only the shortened value is marked.');
        }
    }

    @IsTest
    static void theEditorReadsTheWholeLongText() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = [
                SELECT Id, Delivery_Notes__c
                FROM Consignment__c
                WHERE Name = 'Driver log, Fort Kent'
            ];
            String whole = GridController.fetchFullText('Consignment_Charges', rec.Id, 'delivery_notes__c');
            System.assertEquals(rec.Delivery_Notes__c, whole, 'The whole text, not the shortened copy.');
            List<String> refusals = new List<String>();
            for (
                List<String> bad : new List<List<String>>{
                    new List<String>{ 'Consignment_Charges', rec.Id, 'Consignee__c' },
                    new List<String>{ 'Consignment_Charges', rec.Id, 'Freight_Charge__c' },
                    new List<String>{ 'Consignment_Charges', UserInfo.getUserId(), 'Delivery_Notes__c' }
                }
            ) {
                try {
                    GridController.fetchFullText(bad[0], bad[1], bad[2]);
                    refusals.add('read');
                } catch (AuraHandledException e) {
                    refusals.add(e.getMessage());
                }
            }
            System.assert(refusals[0].contains('Not a long text column'), refusals[0]);
            System.assert(
                refusals[1].contains('Not a long text column'),
                'HR-6: only the grid\'s own columns. ' + refusals[1]
            );
            System.assert(refusals[2].contains('is not a'), refusals[2]);
        }
    }

    @IsTest
    static void aTimeReachesTheBrowserAsSalesforceWritesIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = [SELECT Id FROM Consignment__c WHERE Name = 'Driver log, Fort Kent'];
            rec.Pickup_Time__c = Time.newInstance(17, 30, 5, 7);
            update rec;
            GridRequest request = new GridRequest(
                'Consignment__c',
                new List<String>{ 'Name', 'Pickup_Time__c' },
                null,
                10
            );
            request.onlyIds(new List<Id>{ rec.Id });
            List<Map<String, Object>> rows = GridController.toClientRows(
                GridDataService.fetchPage(request),
                'Consignment__c'
            );
            // Not milliseconds after midnight, which is how Apex hands a Time to the browser.
            System.assertEquals('17:30:05.007Z', rows[0].get('Pickup_Time__c'));
            System.assertEquals('00:00:00.000Z', GridController.timeText(Time.newInstance(0, 0, 0, 0)));
        }
    }

    @IsTest
    static void saveAndPollRoundTrip() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = [SELECT Id FROM Consignment__c WHERE Name = 'Driver log, Fort Kent'];
            Test.startTest();
            GridSaveResult ticket = GridController.save(
                'Consignment_Charges',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => rec.Id, 'Consignee__c' => 'Penobscot Paper' }
                }
            );
            System.assertEquals(false, ticket.done, 'A queued save is not done yet.');
            Test.stopTest();
            GridSaveResult done = GridController.saveStatus(ticket.saveId);
            System.assert(done.done);
            System.assertEquals(1, done.successCount);
            List<Map<String, Object>> reread = GridController.fetchRowsById(
                'Consignment_Charges',
                new List<Id>{ rec.Id }
            );
            System.assertEquals('Penobscot Paper', reread[0].get('Consignee__c'));
        }
    }

    @IsTest
    static void groupSubtotalsComeThroughAndTheirErrorsReadPlainly() {
        System.runAs(GridTestUsers.fullUser()) {
            GridGroupService.Result result = GridController.summarizeGroups(
                'Consignments_By_Mode',
                null,
                new List<String>{ 'Service_Level__c' },
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            Integer records = 0;
            for (Map<String, Object> g : result.groups) {
                records += (Integer) g.get('n');
            }
            System.assertEquals(2, records, 'Both seed rows, in the blank Stage group.');
            try {
                GridController.summarizeGroups(
                    'Consignments_By_Mode',
                    null,
                    new List<String>{ 'Pieces__c' },
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
                System.assert(false, 'Expected a refusal.');
            } catch (AuraHandledException e) {
                System.assertEquals('Cannot group by Pieces__c.', e.getMessage());
            }
        }
    }

    // ------------------------------------------------------------ a sort of several columns

    @IsTest
    static void theRowsComeInEveryLevelOfTheSort() {
        System.runAs(GridTestUsers.fullUser()) {
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Casco one', Consignee__c = 'Casco Freight', Pieces__c = 1),
                new Consignment__c(Name = 'Casco three', Consignee__c = 'Casco Freight', Pieces__c = 3),
                new Consignment__c(Name = 'Casco two', Consignee__c = 'Casco Freight', Pieces__c = 2)
            };
            Map<String, Object> result = GridController.fetchRows(
                'Consignments',
                'Casco',
                'Consignee__c',
                'asc',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'field' => 'Pieces__c', 'direction' => 'desc' }
                }
            );
            List<String> names = new List<String>();
            for (Map<String, Object> row : (List<Map<String, Object>>) result.get('rows')) {
                names.add((String) row.get('Name'));
            }
            System.assertEquals(new List<String>{ 'Casco three', 'Casco two', 'Casco one' }, names);
            try {
                GridController.fetchRows(
                    'Consignments',
                    null,
                    'Name',
                    'asc',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    new List<Map<String, Object>>{ new Map<String, Object>{ 'field' => 'Delivery_Notes__c' } }
                );
                System.assert(false, 'A sort after the first is checked as the first is.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().startsWith('Cannot sort by Delivery_Notes__c'), e.getMessage());
            }
        }
    }

    // ------------------------------------------------------------ openGrid

    @IsTest
    static void openGridAnswersTheConfigurationTheLayoutAndTheFirstPage() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> result = GridController.openGrid('Consignments', null, null, null, null, null);
            GridConfig.Definition def = (GridConfig.Definition) result.get('definition');
            System.assertEquals('Consignment__c', def.objectApiName);
            System.assert(
                Pattern.matches('(standard|custom):[a-z0-9_]+', def.objectIcon),
                'Icons, once per grid opened.'
            );
            System.assertEquals(false, result.get('diagnostics'));
            System.assert(result.containsKey('canConfigure'));
            System.assertEquals(null, result.get('layout'), 'No layout kept yet.');
            System.assertEquals(null, result.get('pageError'));
            Map<String, Object> start = (Map<String, Object>) result.get('start');
            System.assertEquals('Name', start.get('sortField'), 'The admin\'s sort.');
            System.assertEquals('asc', start.get('sortDirection'));
            System.assertEquals(new List<String>(), start.get('groupBy'));
            Map<String, Object> page = (Map<String, Object>) result.get('page');
            List<Map<String, Object>> rows = (List<Map<String, Object>>) page.get('rows');
            System.assertEquals(2, rows.size());
            System.assertEquals('Bath Iron fasteners, bulk', rows[0].get('Name'));
            System.assertEquals('999999999999999999', rows[0].get('Pieces__c'), 'Rows as fetchRows sends them.');
            System.assertEquals(2, page.get('totalRows'));
            System.assertEquals(false, page.get('hasMore'));
            Map<String, Object> newRow = (Map<String, Object>) result.get('newRow');
            System.assertEquals(true, newRow.get('inline'), 'The New button adds a row in place here.');
            System.assertEquals(
                null,
                GridController.openGrid('Consignment_Rates', null, null, null, null, null).get('newRow'),
                'No New button, no new row.'
            );
        }
    }

    @IsTest
    static void aPicklistThatFollowsRecordTypesBringsEachRowsRecordType() {
        Map<String, Schema.RecordTypeInfo> types = Schema.SObjectType.Inspection__c.getRecordTypeInfosByDeveloperName();
        Id standard = types.get('Routine').getRecordTypeId();
        Id restricted = types.get('Hazmat').getRecordTypeId();
        System.runAs(GridTestUsers.fullUser()) {
            Inspection__c a = new Inspection__c(
                Name = 'Brake inspection, Augusta yard',
                RecordTypeId = standard,
                Status__c = 'Working'
            );
            Inspection__c b = new Inspection__c(
                Name = 'Hazmat placard check, Bangor',
                RecordTypeId = restricted,
                Status__c = 'Archived'
            );
            insert new List<Inspection__c>{ a, b };
            Map<String, Object> result = GridController.openGrid('Inspections', null, null, null, null, null);
            GridConfig.Definition def = (GridConfig.Definition) result.get('definition');
            System.assertEquals(true, def.byRecordType, 'An editable picklist on an object with record types.');
            List<Map<String, Object>> rows = (List<Map<String, Object>>) ((Map<String, Object>) result.get('page'))
                .get('rows');
            System.assertEquals(2, rows.size());
            System.assertEquals(standard, rows[0].get('RecordTypeId'), 'Each row says its record type.');
            System.assertEquals(restricted, rows[1].get('RecordTypeId'));
            List<Map<String, Object>> reread = GridController.fetchRowsById('Inspections', new List<Id>{ b.Id });
            System.assertEquals(restricted, reread[0].get('RecordTypeId'), 'A row read again after a save keeps it.');
            GridConfig.Definition plain = (GridConfig.Definition) GridController.openGrid(
                    'Consignments',
                    null,
                    null,
                    null,
                    null,
                    null
                )
                .get('definition');
            System.assertEquals(
                false,
                plain.byRecordType,
                'No record types on the object: the picklists are as they are.'
            );
        }
    }

    @IsTest
    static void createRowsCreatesTheNewRowsRecordsAndSaysWhyNot() {
        System.runAs(GridTestUsers.fullUser()) {
            GridCreateService.Result result = GridController.createRows(
                'Consignments',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'key' => 'rh-new-1', 'Name' => 'Casco Bay Marine, 4 pallets' }
                },
                null,
                null,
                null
            );
            System.assertEquals('rh-new-1', result.rows[0].key);
            System.assert(result.rows[0].success, String.valueOf(result.rows[0].errors));
            try {
                GridController.createRows(
                    'Consignment_Rates',
                    new List<Map<String, Object>>{
                        new Map<String, Object>{ 'key' => 'k', 'Name' => 'Wachusett Paper, 6 rolls' }
                    },
                    null,
                    null,
                    null
                );
                System.assert(false, 'Expected a refusal.');
            } catch (AuraHandledException e) {
                System.assertEquals('This grid does not allow new records.', e.getMessage());
            }
        }
    }

    @IsTest
    static void openGridSearchesAsFetchRowsDoes() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> page = (Map<String, Object>) GridController.openGrid(
                    'Consignments',
                    'Fort Kent',
                    null,
                    null,
                    null,
                    null
                )
                .get('page');
            System.assertEquals(1, page.get('totalRows'));
            System.assertEquals('Driver log, Fort Kent', ((List<Map<String, Object>>) page.get('rows'))[0].get('Name'));
        }
    }

    @IsTest
    static void openGridSortsAndGroupsTheFirstPageAsTheLayoutSays() {
        System.runAs(GridTestUsers.fullUser()) {
            String layout = '{"v":1,"sort":[{"field":"Name","direction":"desc"}],"grouping":[{"field":"Service_Level__c","unit":null}]}';
            GridLayouts.save('Consignments', layout);
            Map<String, Object> result = GridController.openGrid('Consignments', null, null, null, null, null);
            System.assertEquals(layout, result.get('layout'), 'The layout comes with it, for the browser to read.');
            Map<String, Object> start = (Map<String, Object>) result.get('start');
            System.assertEquals('Name', start.get('sortField'));
            System.assertEquals('desc', start.get('sortDirection'));
            System.assertEquals(new List<String>{ 'Service_Level__c' }, start.get('groupBy'));
            List<Map<String, Object>> rows = (List<Map<String, Object>>) ((Map<String, Object>) result.get('page'))
                .get('rows');
            System.assertEquals(
                'Driver log, Fort Kent',
                rows[0].get('Name'),
                'One group (no picklist value), Name descending.'
            );
        }
    }

    @IsTest
    static void openGridFallsBackToTheAdminsSortAndGrouping() {
        System.runAs(GridTestUsers.fullUser()) {
            // A column the grid no longer has is passed over; a grouping with no
            // level left is the admin's (none here).
            GridLayouts.save(
                'Consignments',
                '{"v":1,"sort":[{"field":"Gone__c","direction":"desc"},' +
                '{"field":"Consignee__c","direction":"desc"}],"grouping":[{"field":"Consignee__c"}]}'
            );
            Map<String, Object> start = (Map<String, Object>) GridController.openGrid(
                    'Consignments',
                    null,
                    null,
                    null,
                    null,
                    null
                )
                .get('start');
            System.assertEquals('Consignee__c', start.get('sortField'), 'The first sort key left.');
            System.assertEquals('desc', start.get('sortDirection'));
            System.assertEquals(
                new List<String>(),
                start.get('groupBy'),
                'Text cannot be grouped by: the admin\'s grouping.'
            );
        }
    }

    @IsTest
    static void aChildTableKeepsItsOwnLayoutForItsTab() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c parent = [
                SELECT Id
                FROM Consignment__c
                WHERE Name = 'Bath Iron fasteners, bulk'
            ];
            String own = '{"v":1,"sort":[{"field":"Name","direction":"desc"}]}';
            String inTab = '{"v":1,"sort":[{"field":"Name","direction":"desc"}],"widths":{"Name":180}}';
            GridLayouts.save('Consignment_Items', own);
            System.assertEquals(true, GridController.saveLayout('Consignment_Items', inTab, 'Consignments_Items'));
            Map<String, Object> result = GridController.openGrid(
                'Consignment_Items',
                null,
                'Consignments_Items',
                parent.Id,
                null,
                null
            );
            System.assertEquals(inTab, result.get('layout'), 'The tab\'s own layout, not the grid\'s on its own.');
            System.assertEquals('desc', ((Map<String, Object>) result.get('start')).get('sortDirection'), 'Its sort.');
            System.assertEquals(
                0,
                ((Map<String, Object>) result.get('page')).get('totalRows'),
                'Only the parent\'s records: none.'
            );
            System.assertEquals(own, GridLayouts.read('Consignment_Items', null), 'The grid on its own keeps its own.');
            GridController.resetLayout('Consignment_Items', 'Consignments_Items');
            System.assertEquals(null, GridLayouts.read('Consignment_Items', 'Consignments_Items'), 'Reset in the tab.');
            System.assertEquals(
                own,
                GridLayouts.read('Consignment_Items', null),
                '... leaves the grid on its own as it was.'
            );
            try {
                GridController.saveLayout('Consignments', inTab, 'Consignments_Items');
                System.assert(false, 'A tab that does not show the grid is no key.');
            } catch (AuraHandledException e) {
                System.assert(
                    e.getMessage().contains('does not') || e.getMessage().contains('shows the grid'),
                    e.getMessage()
                );
            }
        }
    }

    @IsTest
    static void rowsThatCannotBeReadAreNoPage() {
        System.runAs(GridTestUsers.fullUser()) {
            // A child tab the grid does not have: the configuration still comes,
            // and the grid asks for the rows itself, which shows why.
            Map<String, Object> result = GridController.openGrid(
                'Consignment_Items',
                null,
                'Consignment_Items_Claims',
                UserInfo.getUserId(),
                null,
                null
            );
            System.assertNotEquals(null, result.get('definition'));
            System.assertEquals(null, result.get('page'));
            System.assert(String.isNotBlank((String) result.get('pageError')), 'Says why.');
        }
    }

    @IsTest
    static void openGridRefusesAGridThatDoesNotExist() {
        try {
            GridController.openGrid('No_Such_Grid', null, null, null, null, null);
            System.assert(false, 'Expected an exception.');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('No_Such_Grid'), e.getMessage());
        }
    }

    @IsTest
    static void errorsReachTheClientWithTheirMessage() {
        // Rowhouse's own refusal keeps its words.
        try {
            GridController.fetchRows(
                'No_Such_Grid',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            System.assert(false, 'Expected an exception.');
        } catch (AuraHandledException e) {
            System.assert(e.getMessage().contains('No_Such_Grid'), e.getMessage());
        }
        // Anything else reads plainly; only Rowhouse Grid Diagnostics users see the platform's text.
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridController.lookupName('Consignments', 'Shipper__c', 'not an id');
                System.assert(false, 'Expected an exception.');
            } catch (AuraHandledException e) {
                System.assertEquals(GridException.UNEXPECTED, e.getMessage(), 'No type or detail without Diagnostics.');
            }
        }
        System.runAs(GridTestUsers.diagnosticsUser()) {
            try {
                GridController.lookupName('Consignments', 'Shipper__c', 'not an id');
                System.assert(false, 'Expected an exception.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().startsWith(GridException.UNEXPECTED), e.getMessage());
                System.assert(e.getMessage().contains('(System.StringException: '), e.getMessage());
            }
        }
    }

    @IsTest
    static void onlyASortableColumnOfTheGridSortsTheRows() {
        System.runAs(GridTestUsers.fullUser()) {
            // A column of the grid, in any case: sorted.
            Map<String, Object> page = GridController.fetchRows(
                'Consignments',
                null,
                'name',
                'desc',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null
            );
            List<Map<String, Object>> rows = (List<Map<String, Object>>) page.get('rows');
            System.assertEquals('Driver log, Fort Kent', rows[0].get('Name'), 'Name descending.');
            // A field the user can read, but no column of this grid: refused (HR-6).
            try {
                GridController.fetchRows(
                    'Consignments',
                    null,
                    'CreatedDate',
                    'asc',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
                System.assert(false, 'The browser may sort only by the grid\'s own sortable columns.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().startsWith('Cannot sort by CreatedDate'), e.getMessage());
            }
        }
    }
}
