/**
 * DEVELOPMENT ONLY. Never packaged.
 * Filters and the record page: how a condition is checked and
 * normalised, the SOQL it becomes, which records it leaves, and what is
 * refused. Conditions are built in memory, so each case states its own;
 * the queries run as GridTestUsers.fullUser(), in user mode.
 */
@IsTest
private class GridFiltersTest {
    private static final Schema.SObjectType TEST_RECORD = Consignment__c.SObjectType;

    @TestSetup
    static void setup() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = new Account(Name = 'Casco Bay Marine');
            insert acme;
            Datetime todayNoon = Datetime.newInstance(Date.today(), Time.newInstance(12, 0, 0, 0));
            insert new List<Consignment__c>{
                new Consignment__c(
                    Name = 'Apple crates, Springfield',
                    Pieces__c = 5,
                    Service_Level__c = 'Economy',
                    Consignee__c = 'Pioneer Valley Orchards',
                    Handling__c = 'Fragile;Liftgate',
                    Delivered__c = true,
                    Picked_Up__c = todayNoon,
                    Shipper__c = acme.Id
                ),
                new Consignment__c(
                    Name = 'Maple syrup, Burlington',
                    Pieces__c = 15,
                    Service_Level__c = 'Standard',
                    Consignee__c = 'Green Mountain Maple',
                    Handling__c = 'Inside Delivery',
                    Delivered__c = false,
                    Picked_Up__c = todayNoon.addDays(-3)
                ),
                new Consignment__c(
                    Name = 'Paper rolls, Bangor',
                    Pieces__c = 25,
                    Service_Level__c = 'Express',
                    Consignee__c = 'Saco River Outfitters 50%_off'
                ),
                new Consignment__c(Name = 'Roof slate, Rockland')
            };
        }
    }

    private static GridFilters.Condition condition(String field, String operator, String value, String valueTo) {
        return GridFilters.condition(TEST_RECORD, field, operator, value, valueTo);
    }

    /** The names of the records that meet every condition, sorted. */
    private static List<String> namesMeeting(List<GridFilters.Condition> conditions) {
        GridRequest request = new GridRequest('Consignment__c', new List<String>{ 'Name' }, null, 200);
        request.narrowedBy(conditions);
        request.orderBy('Name', 'asc');
        List<String> out = new List<String>();
        for (SObject r : GridDataService.fetchPage(request).rows) {
            out.add((String) r.get('Name'));
        }
        return out;
    }

    private static List<String> namesMeeting(GridFilters.Condition c) {
        return namesMeeting(new List<GridFilters.Condition>{ c });
    }

    @IsTest
    static void eachOperatorLeavesTheRightRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington', 'Paper rolls, Bangor' },
                namesMeeting(condition('Pieces__c', 'greater_than', '10', null))
            );
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield', 'Maple syrup, Burlington' },
                namesMeeting(condition('Pieces__c', 'between', '5', '15')),
                'Between includes both ends.'
            );
            System.assertEquals(
                new List<String>{ 'Roof slate, Rockland' },
                namesMeeting(condition('Pieces__c', 'is_blank', null, null))
            );
            // A picklist by its label, in any case, compares by API value.
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington' },
                namesMeeting(condition('Service_Level__c', 'equals', 'standard', null))
            );
            // Does not equal and does not contain include blanks, as a list view filter does.
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield', 'Paper rolls, Bangor', 'Roof slate, Rockland' },
                namesMeeting(condition('Service_Level__c', 'not_equals', 'Standard', null))
            );
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington', 'Paper rolls, Bangor', 'Roof slate, Rockland' },
                namesMeeting(condition('Consignee__c', 'not_contains', 'Orchard', null))
            );
            // Part of a picklist value, as for text: Economy has "nom"; blanks do not contain it.
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington', 'Paper rolls, Bangor', 'Roof slate, Rockland' },
                namesMeeting(condition('Service_Level__c', 'not_contains', 'nom', null))
            );
            System.assertEquals(
                new List<String>{ 'Paper rolls, Bangor' },
                namesMeeting(condition('Service_Level__c', 'contains', 'EXP', null))
            );
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington' },
                namesMeeting(condition('Consignee__c', 'starts_with', 'GREEN', null))
            );
            // A wildcard in the value is a character, not a wildcard (TC-021).
            System.assertEquals(
                new List<String>{ 'Paper rolls, Bangor' },
                namesMeeting(condition('Consignee__c', 'contains', '%_', null))
            );
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield' },
                namesMeeting(condition('Handling__c', 'contains', 'liftgate', null)),
                'A multi-select contains a value: INCLUDES.'
            );
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington', 'Paper rolls, Bangor', 'Roof slate, Rockland' },
                namesMeeting(condition('Handling__c', 'not_contains', 'Fragile', null))
            );
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield' },
                namesMeeting(condition('Delivered__c', 'equals', 'true', null))
            );
        }
    }

    @IsTest
    static void aDateTimeIsFilteredByTheUsersCalendarDay() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield' },
                namesMeeting(condition('Picked_Up__c', 'equals', 'TODAY', null))
            );
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington' },
                namesMeeting(condition('Picked_Up__c', 'less_than', 'TODAY-1', null))
            );
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield', 'Maple syrup, Burlington' },
                namesMeeting(condition('Picked_Up__c', 'between', 'TODAY-3', 'TODAY')),
                'Both days included.'
            );
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington', 'Paper rolls, Bangor', 'Roof slate, Rockland' },
                namesMeeting(condition('Picked_Up__c', 'not_equals', 'TODAY', null)),
                'Does not equal includes blanks.'
            );
        }
    }

    @IsTest
    static void everyConditionMustHold() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington' },
                namesMeeting(
                    new List<GridFilters.Condition>{
                        condition('Pieces__c', 'greater_than', '10', null),
                        condition('Consignee__c', 'contains', 'Maple', null)
                    }
                )
            );
        }
    }

    @IsTest
    static void aConditionSaysWhatItMeans() {
        System.assertEquals('Pieces is greater than 10', condition('Pieces__c', 'greater_than', '10', null).text);
        System.assertEquals(
            'Service Level is not Standard',
            condition('Service_Level__c', 'not_equals', 'standard', null).text
        );
        System.assertEquals('Delivered is not checked', condition('Delivered__c', 'equals', 'false', null).text);
        System.assertEquals(
            'Ship Date is at least 30 days ago',
            condition('Ship_Date__c', 'greater_or_equal', 'today - 30', null).text
        );
        System.assertEquals('Pieces is between 1 and 9', condition('Pieces__c', 'between', '1', '9').text);
        System.assertEquals(
            'Owner is me',
            condition('OwnerId', 'equals', '$User', null).text,
            'A lookup heading drops " ID".'
        );
        // TODAY and $User mean something only for a date and a lookup: in a text
        // filter they are just text, and must not stop the grid.
        System.assert(condition('Consignee__c', 'starts_with', 'TODAYS', null).text.endsWith('TODAYS'));
        System.assert(condition('Consignee__c', 'equals', 'TODAY1', null).text.endsWith('TODAY1'));
        System.assert(condition('Consignee__c', 'equals', '$User', null).text.endsWith('$User'));
    }

    @IsTest
    static void anAdminFilterThatCannotWorkStopsTheGridAndSaysWhich() {
        List<Grid_Filter__mdt> records = new List<Grid_Filter__mdt>{
            new Grid_Filter__mdt(
                DeveloperName = 'Many_Pieces',
                Field_API_Name__c = 'Pieces__c',
                Operator__c = 'greater_than',
                Value__c = 'lots'
            )
        };
        try {
            GridFilters.fromRecords(records, TEST_RECORD);
            System.assert(false, 'A filter that cannot work must not be skipped: it would widen the grid.');
        } catch (GridException e) {
            System.assert(e.getMessage().startsWith('Grid Filter Many_Pieces: '), e.getMessage());
            System.assert(e.getMessage().contains('is not a number'), e.getMessage());
        }
        List<String> refusals = new List<String>();
        for (
            List<String> bad : new List<List<String>>{
                new List<String>{ 'Delivery_Notes__c', 'equals', 'Use the side door.', null },
                new List<String>{ 'Consignee__c', 'greater_than', 'Kennebec Lumber', null },
                new List<String>{ 'Pieces__c', 'between', '1', null },
                new List<String>{ 'Delivery_Window__c', 'equals', 'Morning', null }
            }
        ) {
            try {
                condition(bad[0], bad[1], bad[2], bad[3]);
                refusals.add('accepted');
            } catch (GridException e) {
                refusals.add(e.getMessage());
            }
        }
        System.assert(refusals[0].contains('cannot be filtered on'), refusals[0]);
        System.assert(refusals[1].contains('does not apply'), refusals[1]);
        System.assert(refusals[2].contains('Value To'), refusals[2]);
        System.assert(refusals[3].contains('Unknown field'), refusals[3]);
    }

    @IsTest
    static void anAdminFilterTurnedOffIsLeftOutAndTheRestAreInOrder() {
        List<GridFilters.Condition> got = GridFilters.fromRecords(
            new List<Grid_Filter__mdt>{
                new Grid_Filter__mdt(
                    DeveloperName = 'Pieces_Entered',
                    Field_API_Name__c = 'Pieces__c',
                    Operator__c = 'is_not_blank',
                    Sort_Order__c = 20
                ),
                new Grid_Filter__mdt(
                    DeveloperName = 'Delivery_Window',
                    Field_API_Name__c = 'Delivery_Window__c',
                    Operator__c = 'equals',
                    Inactive__c = true
                ),
                new Grid_Filter__mdt(
                    DeveloperName = 'Consignee_Blank',
                    Field_API_Name__c = 'Consignee__c',
                    Operator__c = 'is_blank',
                    Sort_Order__c = 10
                )
            },
            TEST_RECORD
        );
        System.assertEquals(2, got.size(), 'An inactive filter is not there, even a broken one.');
        System.assertEquals('Consignee_Blank', got[0].name);
        System.assertEquals('Pieces_Entered', got[1].name);
    }

    @IsTest
    static void aUserFiltersOnlyByTheGridsOwnFilterableColumns() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            List<GridFilters.Condition> ok = GridFilters.userConditions(
                def,
                new List<Map<String, Object>>{
                    new Map<String, Object>{
                        'field' => 'Pieces__c',
                        'operator' => 'between',
                        'value' => '1',
                        'valueTo' => 9
                    }
                }
            );
            System.assertEquals('9', ok[0].valueTo, 'Values arrive as anything; they are read as text.');

            List<String> refusals = new List<String>();
            for (
                Map<String, Object> bad : new List<Map<String, Object>>{
                    new Map<String, Object>{ 'field' => 'Carrier_Code__c', 'operator' => 'equals', 'value' => 'GCFR' },
                    new Map<String, Object>{ 'field' => 'Id', 'operator' => 'equals', 'value' => 'PRO-1001' },
                    new Map<String, Object>{ 'operator' => 'equals', 'value' => 'Portland' }
                }
            ) {
                Boolean isColumn = false;
                for (GridConfig.Column c : def.columns) {
                    isColumn = isColumn || c.field == bad.get('field');
                }
                try {
                    GridFilters.userConditions(def, new List<Map<String, Object>>{ bad });
                    refusals.add(isColumn ? 'column' : 'accepted');
                } catch (GridException e) {
                    refusals.add(e.getMessage());
                }
            }
            for (String r : refusals) {
                System.assert(
                    r == 'column' || r.startsWith('Cannot filter by'),
                    'HR-6: only the grid\'s own columns: ' + r
                );
            }
            List<Map<String, Object>> tooMany = new List<Map<String, Object>>();
            for (Integer i = 0; i <= GridFilters.MAX_USER_FILTERS; i++) {
                tooMany.add(new Map<String, Object>{ 'field' => 'Pieces__c', 'operator' => 'is_not_blank' });
            }
            try {
                GridFilters.userConditions(def, tooMany);
                System.assert(false, 'More than the most filters is refused.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains(String.valueOf(GridFilters.MAX_USER_FILTERS)), e.getMessage());
            }
        }
    }

    @IsTest
    static void aUserFilterNarrowsTheRowsAndTheCounts() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> filters = new List<Map<String, Object>>{
                new Map<String, Object>{ 'field' => 'Pieces__c', 'operator' => 'greater_than', 'value' => '10' }
            };
            Map<String, Object> page = GridController.fetchRows(
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
                filters,
                null,
                null,
                null
            );
            List<String> names = new List<String>();
            for (Map<String, Object> r : (List<Map<String, Object>>) page.get('rows')) {
                Object n = r.get('Pieces__c');
                System.assert(
                    n != null && Decimal.valueOf(String.valueOf(n)) > 10,
                    'Only rows that meet the filter: ' + r
                );
                names.add((String) r.get('Name'));
            }
            System.assert(
                names.contains('Maple syrup, Burlington') &&
                    names.contains('Paper rolls, Bangor') &&
                    !names.contains('Apple crates, Springfield'),
                String.valueOf(names)
            );
        }
    }

    @IsTest
    static void aLookupIsFilteredByTheNameTheUserSees() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            Boolean hasLookup = false;
            for (GridConfig.Column c : def.columns) {
                hasLookup = hasLookup || (c.field == 'Shipper__c' && c.filterable == true);
            }
            if (!hasLookup) {
                return; // the fixture grid has no lookup column to filter by
            }
            List<GridFilters.Condition> c = GridFilters.userConditions(
                def,
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'field' => 'Shipper__c', 'operator' => 'contains', 'value' => 'casco' }
                }
            );
            System.assertEquals(new List<String>{ 'Apple crates, Springfield' }, namesMeeting(c));
        }
    }

    @IsTest
    static void theRecordPageNarrowsToThatRecordsRows() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = [SELECT Id FROM Account WHERE Name = 'Casco Bay Marine' LIMIT 1];
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            System.assertEquals(null, GridFilters.recordCondition(def, acme.Id), 'No Record Page Field: as before.');

            def.recordPageField = 'Shipper__c';
            System.assertEquals(null, GridFilters.recordCondition(def, null), 'No record (an App page): as before.');
            GridFilters.Condition c = GridFilters.recordCondition(def, acme.Id);
            System.assertEquals('Shipper__c', c.field);
            System.assertEquals(new List<String>{ 'Apple crates, Springfield' }, namesMeeting(c));
            System.assertEquals(acme.Id, GridFilters.recordScope(def, acme.Id).parentId, 'Import fills the field in.');

            Id wrongKind = [SELECT Id FROM Consignment__c LIMIT 1].Id;
            try {
                GridFilters.recordCondition(def, wrongKind);
                System.assert(false, 'A page of another object must not show unrelated records.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('related to Account records'), e.getMessage());
            }
            def.recordPageField = 'Consignee__c';
            try {
                GridFilters.recordCondition(def, acme.Id);
                System.assert(false, 'A Record Page Field must be a lookup.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('is not a lookup'), e.getMessage());
            }
            System.assertEquals(
                new List<GridFilters.Condition>(def.filters).size(),
                GridFilters.forRequest(def, null, acme.Id, true).size(),
                'A child table ignores the page.'
            );
        }
    }

    @IsTest
    static void filtersAreInTheGroupCountsToo() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> filters = new List<Map<String, Object>>{
                new Map<String, Object>{ 'field' => 'Pieces__c', 'operator' => 'greater_than', 'value' => '10' }
            };
            List<String> byPicklist = new List<String>{ 'Service_Level__c' };
            GridGroupService.Result unfiltered = GridGroupService.summarize(
                'Consignments',
                null,
                byPicklist,
                null,
                null,
                null,
                null,
                null,
                null
            );
            GridGroupService.Result filtered = GridGroupService.summarize(
                'Consignments',
                null,
                byPicklist,
                null,
                null,
                null,
                null,
                filters,
                null
            );
            System.assertEquals(4, unfiltered.groups.size(), 'Economy, Standard, Express and blank.');
            System.assertEquals(
                2,
                filtered.groups.size(),
                'Only the groups of the filtered records: Standard and Express.'
            );
            Integer counted = 0;
            for (Map<String, Object> g : filtered.groups) {
                counted += (Integer) g.get('n');
            }
            System.assertEquals(2, counted, 'A filtered grid counts only the filtered records.');
        }
    }

    /** The names of the rows fetchRows returns for these filters and filter logic, sorted. */
    private static List<String> namesFor(List<Map<String, Object>> filters, String logic) {
        Map<String, Object> page = GridController.fetchRows(
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
            filters,
            null,
            logic,
            null
        );
        List<String> names = new List<String>();
        for (Map<String, Object> r : (List<Map<String, Object>>) page.get('rows')) {
            names.add((String) r.get('Name'));
        }
        return names;
    }

    @IsTest
    static void filterLogicJoinsTheUsersFiltersWithOrAndNot() {
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, Object>> filters = new List<Map<String, Object>>{
                new Map<String, Object>{ 'field' => 'Pieces__c', 'operator' => 'greater_than', 'value' => '20' },
                new Map<String, Object>{ 'field' => 'Service_Level__c', 'operator' => 'equals', 'value' => 'Economy' }
            };
            System.assertEquals(new List<String>(), namesFor(filters, null), 'Without logic, both must hold.');
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield', 'Paper rolls, Bangor' },
                namesFor(filters, '1 OR 2')
            );
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield' },
                namesFor(filters, '2 AND NOT 1'),
                'NOT around a condition.'
            );
            System.assertEquals(
                new List<String>{ 'Maple syrup, Burlington' },
                namesFor(filters, 'NOT (1 OR 2)'),
                'NOT around a group. As in SOQL, a blank field compared is neither true nor false, so NOT leaves Roof slate out too.'
            );
            // The same column twice, with OR between: Stage is A or Stage is B.
            filters.add(
                new Map<String, Object>{ 'field' => 'Service_Level__c', 'operator' => 'equals', 'value' => 'Standard' }
            );
            System.assertEquals(
                new List<String>{ 'Apple crates, Springfield', 'Maple syrup, Burlington' },
                namesFor(filters, '2 OR 3 OR (1 AND 2)')
            );
            try {
                namesFor(filters, '1 OR 2');
                System.assert(false, 'Every filter must be in the logic.');
            } catch (AuraHandledException e) {
                System.assert(e.getMessage().contains('not referenced'), e.getMessage());
            }
            GridGroupService.Result counted = GridGroupService.summarize(
                'Consignments',
                null,
                new List<String>{ 'Service_Level__c' },
                null,
                null,
                null,
                null,
                filters,
                '2 OR 3 OR (1 AND 2)',
                null
            );
            System.assertEquals(2, counted.groups.size(), 'The counts use the logic too: Economy and Standard.');
        }
    }

    @IsTest
    static void filterLogicNeverWidensTheAdminsFilters() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            List<Map<String, Object>> filters = new List<Map<String, Object>>{
                new Map<String, Object>{ 'field' => 'Pieces__c', 'operator' => 'greater_than', 'value' => '20' },
                new Map<String, Object>{ 'field' => 'Pieces__c', 'operator' => 'is_blank' }
            };
            List<GridFilters.Condition> got = GridFilters.forRequest(def, filters, '1 OR 2', null, false);
            System.assertEquals(
                def.filters.size() + 1,
                got.size(),
                'The admin\'s filters each stand alone; the user\'s are one condition, joined by the logic.'
            );
            Map<String, Object> binds = new Map<String, Object>();
            List<String> soql = GridFilters.clauses(TEST_RECORD, got, binds);
            String joined = soql[soql.size() - 1];
            System.assert(joined.contains(' OR '), joined);
            System.assert(!joined.contains('Name'), 'Only the user\'s filters are inside the OR: ' + joined);
        }
    }

    @IsTest
    static void aConditionCarriesItsFieldsLabelForTheCountLine() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals('Pieces', condition('Pieces__c', 'greater_than', '10', null).label);
            System.assertEquals('Service Level', condition('Service_Level__c', 'is_blank', null, null).label);
        }
    }
}
