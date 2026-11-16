/**
 * DEVELOPMENT ONLY. Never packaged.
 * The Grid Admin tab's server: who may use it, reading a
 * configuration as a draft, checking a draft with the grid's own code, and
 * what a save deploys. A test cannot deploy metadata, so the deploy is a
 * stand-in that keeps what it was given.
 */
@IsTest
private class GridAdminTest {
    private class Kept implements GridAdmin.Deployer {
        public Metadata.DeployContainer container;
        public Metadata.DeployCallback callback;
        public Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback) {
            this.container = container;
            this.callback = callback;
            return UserInfo.getUserId(); // any Id: the page only hands it back
        }
    }

    private static Map<String, Metadata.CustomMetadata> byName(Metadata.DeployContainer container) {
        Map<String, Metadata.CustomMetadata> out = new Map<String, Metadata.CustomMetadata>();
        for (Metadata.Metadata m : container.getMetadata()) {
            out.put(GridTestUsers.plain(m.fullName), (Metadata.CustomMetadata) m);
        }
        return out;
    }

    private static Object valueOf(Metadata.CustomMetadata record, String field) {
        for (Metadata.CustomMetadataValue v : record.values) {
            if (GridTestUsers.plain(v.field) == field) {
                return v.value;
            }
        }
        return 'not sent';
    }

    private static GridAdmin.Draft newDraft(String name) {
        GridAdmin.Draft d = new GridAdmin.Draft();
        d.config.name = name;
        d.config.label = 'Open Consignments';
        d.config.isNew = true;
        d.config.objectApiName = 'Consignment__c';
        GridAdmin.ColumnDraft nameCol = new GridAdmin.ColumnDraft();
        nameCol.field = 'Name';
        d.columns.add(nameCol);
        GridAdmin.ColumnDraft amount = new GridAdmin.ColumnDraft();
        amount.field = 'Freight_Charge__c';
        amount.columnLabel = 'Charge';
        amount.editable = true;
        amount.subtotal = 'sum';
        d.columns.add(amount);
        return d;
    }

    @IsTest
    static void aFieldHiddenFromTheAdminIsAWarningNotAnError() {
        GridAdmin.Draft d = newDraft('Hidden_Email');
        GridAdmin.ColumnDraft email = new GridAdmin.ColumnDraft();
        email.field = 'Contact_Email__c';
        d.columns.add(email);
        GridAdmin.RuleDraft rule = new GridAdmin.RuleDraft();
        rule.label = 'Has email';
        rule.field = 'Contact_Email__c';
        rule.operator = 'is_not_blank';
        rule.style = 'bold';
        rule.applyTo = 'cell';
        d.rules.add(rule);
        GridAdmin.FilterDraft filter = new GridAdmin.FilterDraft();
        filter.field = 'Contact_Email__c';
        filter.operator = 'is_not_blank';
        d.filters.add(filter);
        GridAdmin.Check limited;
        GridAdmin.Check full;
        System.runAs(GridTestUsers.limitedAdmin()) {
            limited = GridAdmin.check(d);
        }
        System.runAs(GridTestUsers.adminUser()) {
            full = GridAdmin.check(d);
        }
        System.assertEquals(new List<String>(), limited.errors, 'Others may read the field: it can still be saved.');
        String warnings = String.join(limited.warnings, ' | ');
        System.assert(
            warnings.contains(
                'Contact Email (Contact_Email__c) is hidden from you by field-level security, so the grid leaves its column out for you.'
            ),
            warnings
        );
        System.assert(
            warnings.contains('Display rule "Has email" tests Contact Email (Contact_Email__c), which is hidden'),
            warnings
        );
        System.assert(warnings.contains('so the grid will not open for you'), warnings);
        System.assert(
            !String.join(full.warnings, ' ').contains('hidden from you'),
            'An admin who can read the field is told nothing.'
        );
    }

    @IsTest
    static void everythingNeedsTheRowhouseGridAdminPermission() {
        System.runAs(GridTestUsers.fullUser()) {
            for (Integer i = 0; i < 3; i++) {
                try {
                    if (i == 0)
                        GridAdmin.listConfigs();
                    if (i == 1)
                        GridAdmin.readConfig('Consignments');
                    if (i == 2)
                        GridAdmin.save(newDraft('Not_Allowed'));
                    System.assert(false, 'Call ' + i + ' should have been refused.');
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
                }
            }
            System.assertEquals(
                false,
                GridController.openGrid('Consignments', null, null, null, null, null).get('canConfigure'),
                'No gear without Rowhouse Grid Admin.'
            );
        }
    }

    @IsTest
    static void theInstalledVersionIsReadForAdminsWithoutACallout() {
        System.assertEquals('1.2', GridAdmin.versionText(1, 2));
        System.assertEquals('1.10', GridAdmin.versionText(1, 10), 'Minor versions are numbers, not decimals.');
        System.assertEquals(null, GridAdmin.versionText(1, null));
        System.assertEquals(null, GridAdmin.versionText(null, 2));
        System.assertEquals(null, GridAdmin.versionText(0, 0), 'Publisher lists a namespace an org publishes at 0.0.');
        System.assertEquals('0.9', GridAdmin.versionText(0, 9), 'A minor version of a major 0 is still a version.');
        System.runAs(GridTestUsers.adminViewer()) {
            System.assertEquals(null, GridAdmin.versionOf(''), 'Deployed from source: no namespace, no version.');
            System.assertEquals(
                null,
                GridAdmin.versionOf('nosuchpackage'),
                'A namespace not installed has no version.'
            );
            String version = GridAdmin.installedVersion();
            System.assert(
                version == null || (Pattern.matches('\\d+\\.\\d+', version) && version != '0.0'),
                'A version is 1.2 or none, never 0.0: ' + version
            );
            System.assertEquals(0, Limits.getCallouts(), 'Never a callout (HR-9).');
        }
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridAdmin.installedVersion();
                System.assert(false, 'Refused without Rowhouse Grid Admin.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
        }
    }

    @IsTest
    static void anAdminWithoutCustomizeApplicationMayReadButNotSave() {
        System.runAs(GridTestUsers.adminViewer()) {
            Map<String, Object> read = GridAdmin.readConfig('Consignments');
            System.assertEquals(false, read.get('canSave'));
            System.assertEquals(
                true,
                GridController.openGrid('Consignments', null, null, null, null, null).get('canConfigure'),
                'The gear shows.'
            );
            GridAdmin.deployWith = new Kept();
            try {
                GridAdmin.save((GridAdmin.Draft) read.get('draft'));
                System.assert(false, 'Saving needs Customize Application.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Customize Application'), e.getMessage());
            }
            System.assertEquals(null, ((Kept) GridAdmin.deployWith).container, 'Nothing was deployed.');
        }
    }

    @IsTest
    static void aConfigurationReadsBackAsADraftInOrderAndChecksClean() {
        System.runAs(GridTestUsers.adminUser()) {
            Map<String, Object> read = GridAdmin.readConfig('Consignments');
            System.assertEquals(true, read.get('canSave'), 'A System Administrator may save.');
            GridAdmin.Draft d = (GridAdmin.Draft) read.get('draft');
            System.assertEquals('Consignments', d.config.name);
            System.assertEquals('Consignment__c', d.config.objectApiName);
            System.assertEquals(false, d.config.isNew);
            System.assertEquals(true, d.config.showRowNumbers, 'Show Row Numbers reads back.');
            System.assertEquals(true, d.config.allowNewRecords, 'Allow New Records reads back.');
            GridConfig.Definition def = GridConfig.load('Consignments');
            System.assertEquals(def.columns.size(), d.columns.size());
            for (Integer i = 0; i < d.columns.size(); i++) {
                System.assertEquals(
                    def.columns[i].field.toLowerCase(),
                    d.columns[i].field.toLowerCase(),
                    'Column ' + i
                );
                System.assertEquals(
                    def.columns[i].alwaysShown,
                    d.columns[i].alwaysShown,
                    'Always Shown reads back: ' + def.columns[i].field
                );
            }
            Boolean switchedOff = false;
            for (GridAdmin.RuleDraft r : d.rules) {
                if (r.inactive == true)
                    switchedOff = true;
            }
            System.assert(switchedOff, 'A rule that is off is in the draft, so it can be turned back on.');
            System.assertEquals(1, d.children.size());
            System.assertEquals('Consignment_Items', d.children[0].childConfig, 'A child table names its grid.');

            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals(def.warnings, result.warnings, 'The draft is checked by the grid\'s own code.');
        }
    }

    private static GridAdmin.SortLevel sortLevel(String field, String direction) {
        GridAdmin.SortLevel l = new GridAdmin.SortLevel();
        l.field = field;
        l.direction = direction;
        return l;
    }

    @IsTest
    static void theSortsAfterTheFirstAreSavedInThenSortBy() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Sorted_Twice');
            d.config.sortField = 'Freight_Charge__c';
            d.config.sortDirection = 'desc';
            d.config.thenSort.add(sortLevel('Name', 'asc'));
            System.assertEquals(new List<String>(), GridAdmin.check(d).errors);
            GridAdmin.deployWith = new Kept();
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(((Kept) GridAdmin.deployWith).container);
            System.assertEquals(
                'Name ASC',
                valueOf(sent.get('Grid_Configuration__mdt.Sorted_Twice'), 'Then_Sort_By__c')
            );

            GridConfig.Definition def = GridConfig.build(
                GridAdmin.configRecord(d),
                GridAdmin.columnRecords(d),
                new List<Grid_Display_Rule__mdt>(),
                new List<Grid_Child_Table__mdt>(),
                new List<Grid_Action__mdt>()
            );
            System.assertEquals('Freight_Charge__c', def.sortField);
            System.assertEquals(
                new List<Map<String, String>>{ new Map<String, String>{ 'field' => 'Name', 'direction' => 'asc' } },
                def.thenSort,
                'The grid reads what the editor saves.'
            );

            GridAdmin.Draft none = newDraft('Sorted_Once');
            none.config.sortField = 'Name';
            GridAdmin.deployWith = new Kept();
            GridAdmin.save(none);
            sent = byName(((Kept) GridAdmin.deployWith).container);
            System.assertEquals(null, valueOf(sent.get('Grid_Configuration__mdt.Sorted_Once'), 'Then_Sort_By__c'));
        }
    }

    @IsTest
    static void aSortAfterTheFirstMustBeAColumnThatIsOnAndCanBeSorted() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft twice = newDraft('Sort_Twice');
            twice.config.sortField = 'Name';
            twice.config.thenSort.add(sortLevel('name', 'desc'));
            System.assert(String.join(GridAdmin.check(twice).errors, ' ').contains('in the sort twice'));

            GridAdmin.Draft off = newDraft('Sort_Off');
            off.config.sortField = 'Name';
            off.columns[1].inactive = true;
            off.config.thenSort.add(sortLevel('Freight_Charge__c', 'asc'));
            System.assert(
                String.join(GridAdmin.check(off).errors, ' ').contains('is not a column of this grid that is on'),
                'A column switched off.'
            );

            GridAdmin.Draft unsortable = newDraft('Sort_Unsortable');
            unsortable.config.sortField = 'Name';
            unsortable.columns[1].sortable = false;
            unsortable.config.thenSort.add(sortLevel('Freight_Charge__c', 'asc'));
            System.assert(String.join(GridAdmin.check(unsortable).errors, ' ').contains('can be sorted'));

            GridAdmin.Draft notAColumn = newDraft('Sort_Elsewhere');
            notAColumn.config.sortField = 'Name';
            notAColumn.config.thenSort.add(sortLevel('Pieces__c', 'asc'));
            System.assert(String.join(GridAdmin.check(notAColumn).errors, ' ').contains('Pieces__c is not a column'));

            GridAdmin.Draft noFirst = newDraft('Sort_No_First');
            noFirst.config.thenSort.add(sortLevel('Name', 'asc'));
            System.assert(String.join(GridAdmin.check(noFirst).errors, ' ').contains('first column to sort by'));

            GridAdmin.Draft tooMany = newDraft('Sort_Too_Many');
            tooMany.config.sortField = 'Pieces__c';
            for (
                String f : new List<String>{ 'Name', 'Freight_Charge__c', 'Consignee__c', 'Mode__c', 'Ship_Date__c' }
            ) {
                GridAdmin.ColumnDraft c = new GridAdmin.ColumnDraft();
                c.field = f;
                if (f != 'Name' && f != 'Freight_Charge__c') {
                    tooMany.columns.add(c);
                }
                tooMany.config.thenSort.add(sortLevel(f, 'asc'));
            }
            System.assert(String.join(GridAdmin.check(tooMany).errors, ' ').contains('up to 5 columns'));
        }
    }

    @IsTest
    static void aTurnedOffColumnIsLeftOutOfTheGrid() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Turned_Off');
            d.columns[1].inactive = true;
            GridAdmin.deployWith = new Kept();
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(((Kept) GridAdmin.deployWith).container);
            System.assertEquals(
                true,
                valueOf(sent.get('Grid_Column__mdt.Turned_Off_Freight_Charge'), 'Inactive__c'),
                'A turned-off column is saved off, not left out: Apex cannot delete it.'
            );

            GridConfig.Definition def = GridConfig.build(
                GridAdmin.configRecord(d),
                GridAdmin.columnRecords(d),
                new List<Grid_Display_Rule__mdt>(),
                new List<Grid_Child_Table__mdt>(),
                new List<Grid_Action__mdt>()
            );
            System.assertEquals(1, def.columns.size(), 'The grid leaves the turned-off column out.');
            System.assertEquals('Name', def.columns[0].field);
        }
    }

    @IsTest
    static void aDraftThatCannotWorkIsRefusedWithReasons() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft taken = newDraft('Consignments');
            System.assert(String.join(GridAdmin.check(taken).errors, ' ').contains('already exists'));

            GridAdmin.Draft badName = newDraft('2_Bad__Name_');
            System.assert(String.join(GridAdmin.check(badName).errors, ' ').contains('must start with a letter'));

            GridAdmin.Draft noTitle = newDraft('No_Title');
            noTitle.config.label = ' ';
            System.assert(String.join(GridAdmin.check(noTitle).errors, ' ').contains('title'));

            GridAdmin.Draft noObject = newDraft('No_Object');
            noObject.config.objectApiName = 'Not_An_Object__c';
            System.assert(String.join(GridAdmin.check(noObject).errors, ' ').contains('Not_An_Object__c'));

            GridAdmin.Draft badField = newDraft('Bad_Field');
            badField.columns[1].field = 'Not_A_Field__c';
            System.assert(String.join(GridAdmin.check(badField).errors, ' ').contains('Not_A_Field__c'));

            GridAdmin.Draft twice = newDraft('Twice');
            twice.columns[1].field = 'Name';
            System.assert(String.join(GridAdmin.check(twice).errors, ' ').contains('twice'));

            GridAdmin.Draft allOff = newDraft('All_Off');
            allOff.columns[0].inactive = true;
            allOff.columns[1].inactive = true;
            System.assert(String.join(GridAdmin.check(allOff).errors, ' ').contains('at least one column'));

            GridAdmin.Draft badSort = newDraft('Bad_Sort');
            badSort.config.sortField = 'Delivery_Window__c';
            System.assert(String.join(GridAdmin.check(badSort).errors, ' ').contains('Default sort'));

            GridAdmin.Draft ruleWithoutMeaning = newDraft('Unlabelled_Rule');
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.field = 'Freight_Charge__c';
            r.operator = 'greater_than';
            r.value = '100';
            r.style = 'fill_green';
            ruleWithoutMeaning.rules.add(r);
            System.assert(String.join(GridAdmin.check(ruleWithoutMeaning).errors, ' ').contains('meaning'));

            GridAdmin.Draft ownChild = newDraft('Consignment_Items');
            ownChild.config.isNew = false;
            ownChild.config.objectApiName = 'Consignment_Item__c';
            ownChild.columns.remove(1);
            GridAdmin.ChildDraft child = new GridAdmin.ChildDraft();
            child.childConfig = 'Consignment_Items';
            child.relationshipField = 'Consignment__c';
            ownChild.children.add(child);
            System.assert(String.join(GridAdmin.check(ownChild).errors, ' ').contains('itself'));

            GridAdmin.Draft moved = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            moved.config.objectApiName = 'Account';
            System.assert(String.join(GridAdmin.check(moved).errors, ' ').contains('cannot be changed'));
        }
    }

    @IsTest
    static void whatTheGridWouldSkipIsAWarningNotAnError() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Skipped_Settings');
            d.columns[0].subtotal = 'sum'; // a sum of a name
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.label = 'Big';
            r.field = 'Freight_Charge__c';
            r.operator = 'contains';
            r.value = '1';
            r.style = 'fill_green';
            d.rules.add(r);
            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals(2, result.warnings.size(), String.join(result.warnings, ' | '));
        }
    }

    @IsTest
    static void anAutolaunchedFlowCannotBeSavedWithoutARequiredPermission() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Open_Consignments');
            Map<String, String> labels = new Map<String, String>{
                'autolaunched_flow' => 'Reroute',
                'quick_action' => 'Log the call',
                'screen_flow' => 'Reroute with a note'
            };
            for (String type : new List<String>{ 'autolaunched_flow', 'quick_action', 'screen_flow' }) {
                GridAdmin.ActionDraft a = new GridAdmin.ActionDraft();
                a.label = labels.get(type);
                a.type = type;
                a.actionName = type == 'quick_action' ? 'LogACall' : 'Reroute_Consignment';
                a.showIn = 'row_menu';
                d.actions.add(a);
            }
            GridAdmin.ActionDraft off = new GridAdmin.ActionDraft();
            off.label = 'Hold at depot';
            off.type = 'autolaunched_flow';
            off.actionName = 'Hold_At_Depot';
            off.inactive = true;
            d.actions.add(off);
            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(
                new List<String>{ 'Action "Reroute": ' + GridActions.PERMISSION_NEEDED },
                result.errors,
                'A quick action, a screen flow and an action switched off may leave it blank.'
            );
            d.actions[0].requiredPermission = 'Run_Freight_Actions';
            System.assertEquals(new List<String>(), GridAdmin.check(d).errors);
        }
    }

    @IsTest
    static void anApexActionOrAQuickActionOnTheSelectionCannotBeSaved() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Open_Consignments');
            GridAdmin.ActionDraft apex = new GridAdmin.ActionDraft();
            apex.label = 'Stamp';
            apex.type = 'Apex'; // from an imported grid: Grid Admin does not offer the type
            apex.actionName = 'ConsignmentStampAction';
            apex.requiredPermission = 'Run_Freight_Actions';
            d.actions.add(apex);
            GridAdmin.ActionDraft call = new GridAdmin.ActionDraft();
            call.label = 'Log a call';
            call.type = 'quick_action';
            call.actionName = 'LogACall';
            call.showIn = 'selection';
            d.actions.add(call);
            System.assertEquals(
                new List<String>{
                    'Action "Stamp": ' + GridActions.NO_APEX,
                    'Action "Log a call": ' + GridActions.QUICK_ACTION_ON_ROW
                },
                GridAdmin.check(d).errors
            );
            call.showIn = 'row_menu_and_selection';
            d.actions = new List<GridAdmin.ActionDraft>{ call };
            System.assertEquals(
                new List<String>(),
                GridAdmin.check(d).errors,
                'Both: a quick action is offered in the row menu only.'
            );
        }
    }

    @IsTest
    static void aSaveDeploysEveryRecordWithEveryFieldNamedAfterTheGrid() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Open_Consignments');
            d.columns[0].alwaysShown = true;
            d.columns[0].allowGrouping = true;
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.label = 'Big amount';
            r.field = 'Freight_Charge__c';
            r.operator = 'greater_than';
            r.value = '1000';
            r.style = 'fill_green';
            d.rules.add(r);
            GridAdmin.ActionDraft a = new GridAdmin.ActionDraft();
            a.label = 'Add a note';
            a.type = 'autolaunched_flow';
            a.actionName = 'Mark_Consignment_Reviewed';
            a.showIn = 'row_menu_and_selection';
            a.requiredPermission = 'Run_Freight_Actions';
            d.actions.add(a);
            GridAdmin.ChildDraft child = new GridAdmin.ChildDraft();
            child.childConfig = 'Consignment_Items';
            child.relationshipField = 'Consignment__c';
            child.tabLabel = 'Items';
            child.height = 300;
            d.children.add(child);
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;

            String jobId = GridAdmin.save(d);

            System.assertEquals(String.valueOf(UserInfo.getUserId()), jobId);
            System.assert(spy.callback instanceof GridAdminDeploy);
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            System.assertEquals(6, sent.size(), String.valueOf(sent.keySet()));
            Metadata.CustomMetadata cfg = sent.get('Grid_Configuration__mdt.Open_Consignments');
            System.assertEquals('Open Consignments', cfg.label);
            System.assertEquals('Consignment__c', valueOf(cfg, 'Object_API_Name__c'));
            System.assertEquals(true, valueOf(cfg, 'Allow_Inline_Edit__c'));
            System.assertEquals(null, valueOf(cfg, 'Height_Px__c'), 'Every field is sent, blank ones as null.');
            System.assertEquals(true, valueOf(cfg, 'Show_Row_Numbers__c'), 'A new grid numbers its rows.');
            System.assertEquals(true, valueOf(cfg, 'Allow_New_Records__c'), 'A new grid has a New button.');

            Metadata.CustomMetadata nameCol = sent.get('Grid_Column__mdt.Open_Consignments_Name');
            System.assertEquals(
                'Open_Consignments',
                valueOf(nameCol, 'Grid_Configuration__c'),
                'Linked by the grid\'s API name.'
            );
            System.assertEquals(Decimal.valueOf(10), valueOf(nameCol, 'Sort_Order__c'));
            System.assertEquals(false, valueOf(nameCol, 'Inactive__c'));
            System.assertEquals(true, valueOf(nameCol, 'Always_Shown__c'), 'Always Shown is saved.');
            System.assertEquals(true, valueOf(nameCol, 'Allow_Grouping__c'), 'Allow Grouping is saved.');
            Metadata.CustomMetadata amount = sent.get('Grid_Column__mdt.Open_Consignments_Freight_Charge');
            System.assertEquals('Charge', amount.label, 'A new column is labelled with its header.');
            System.assertEquals(Decimal.valueOf(20), valueOf(amount, 'Sort_Order__c'));
            System.assertEquals('sum', valueOf(amount, 'Subtotal__c'));
            System.assertEquals(true, valueOf(amount, 'Editable__c'));
            System.assertEquals(false, valueOf(amount, 'Always_Shown__c'), 'Unticked unless the admin ticks it.');
            System.assertEquals(false, valueOf(amount, 'Allow_Grouping__c'), 'Unticked unless the admin ticks it.');

            Metadata.CustomMetadata rule = sent.get('Grid_Display_Rule__mdt.Open_Consignments_Big_amount');
            System.assertEquals('Big amount', rule.label);
            System.assertEquals(false, valueOf(rule, 'Inactive__c'));
            Metadata.CustomMetadata action = sent.get('Grid_Action__mdt.Open_Consignments_Add_a_note');
            System.assertEquals('Add a note', action.label);
            System.assertEquals('Run_Freight_Actions', valueOf(action, 'Required_Permission__c'));
            Metadata.CustomMetadata link = sent.get('Grid_Child_Table__mdt.Open_Consignments_Items');
            System.assertEquals('Consignment_Items', valueOf(link, 'Child_Configuration__c'));
            System.assertEquals('Open_Consignments', valueOf(link, 'Grid_Configuration__c'));
            System.assertEquals(
                Decimal.valueOf(300),
                valueOf(link, 'Height_Px__c'),
                'A child table\'s Height is saved.'
            );
        }
    }

    @IsTest
    static void anExistingRecordKeepsItsNameAndLabel() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            GridAdmin.ColumnDraft first = d.columns.remove(0);
            d.columns.add(first); // moved to the end
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            Metadata.CustomMetadata moved = sent.get('Grid_Column__mdt.' + first.name);
            System.assertNotEquals(null, moved, 'Saved under its own name: ' + first.name);
            System.assertEquals(Grid_Column__mdt.getInstance(first.name).MasterLabel, moved.label);
            System.assertEquals(Decimal.valueOf(d.columns.size() * 10), valueOf(moved, 'Sort_Order__c'), 'Now last.');
        }
    }

    @IsTest
    static void newRecordNamesAreCleanUniqueAndShort() {
        List<String> names = GridAdmin.names(
            'Pipeline',
            new List<String>{ null, null, 'Pipeline_Stage', null },
            new List<String>{ 'Amount', 'Amount', 'Stage', 'Amount after partner discounts and freight' },
            new Set<String>{ 'Pipeline_Amount' }
        );
        System.assertEquals('Pipeline_Amount_2', names[0], 'Taken in the org.');
        System.assertEquals('Pipeline_Amount_3', names[1], 'Taken in the draft.');
        System.assertEquals('Pipeline_Stage', names[2]);
        System.assert(names[3].length() <= 40, names[3]);
        System.assert(!names[3].endsWith('_'), names[3]);
        System.assertEquals('Close_Date', GridAdmin.clean('Close Date__c'.removeEndIgnoreCase('__c')));
        System.assertEquals('X2_Day_Total', GridAdmin.clean('2-Day  Total'));
        System.assertEquals(null, GridAdmin.nameProblem('Consignments_2026'));
        System.assertNotEquals(null, GridAdmin.nameProblem('Consignment__Items'));
        System.assertNotEquals(null, GridAdmin.nameProblem('Consignments_'));
        System.assertNotEquals(null, GridAdmin.nameProblem('Consignments_Delivered_Late_By_Shipper_ME'));
    }

    @IsTest
    static void theDeployOutcomeIsKeptForThePageAndReadOnce() {
        User admin = GridTestUsers.adminUser();
        System.runAs(admin) {
            // A deployment's Id is an Id (measured: 'job-ok' is refused), prefix 0Af.
            Metadata.DeployResult ok = new Metadata.DeployResult();
            ok.id = '0Afhk0000000001';
            ok.status = Metadata.DeployStatus.Succeeded;
            new GridAdminDeploy(admin.Id).handleResult(ok, null);

            Metadata.DeployResult failed = new Metadata.DeployResult();
            failed.id = '0Afhk0000000002';
            failed.status = Metadata.DeployStatus.Failed;
            Metadata.DeployMessage m = new Metadata.DeployMessage();
            m.fullName = 'Grid_Column__mdt.Consignments_Weight';
            m.problem = 'Gross_Weight__c does not exist.';
            failed.details = new Metadata.DeployDetails();
            failed.details.componentFailures = new List<Metadata.DeployMessage>{ m };
            new GridAdminDeploy(admin.Id).handleResult(failed, null);

            System.assertEquals('pending', GridAdmin.saveStatus('0Afhk0000000003').get('status'));
            Map<String, Object> first = GridAdmin.saveStatus(String.valueOf(ok.id));
            System.assertEquals('Succeeded', first.get('status'));
            System.assertEquals(
                'pending',
                GridAdmin.saveStatus(String.valueOf(ok.id)).get('status'),
                'Read once, then gone.'
            );
            Map<String, Object> second = GridAdmin.saveStatus(String.valueOf(failed.id));
            System.assertEquals('Failed', second.get('status'));
            System.assertEquals(
                new List<String>{ 'Grid_Column__mdt.Consignments_Weight: Gross_Weight__c does not exist.' },
                second.get('messages')
            );
        }
    }

    @IsTest
    static void aRefusalForWantOfTheSecurityReviewIsSaidPlainly() {
        User admin = GridTestUsers.adminUser();
        System.runAs(admin) {
            String refusal = 'Deploying metadata from Apex is not allowed for a non-certified package version.';
            System.assertEquals(GridAdmin.BEFORE_REVIEW, GridAdmin.explained(new GridException(refusal)).getMessage());
            Exception other = new GridException('Too many queued deployments.');
            System.assertEquals(other, GridAdmin.explained(other), 'Any other failure as it came.');

            Metadata.DeployResult failed = new Metadata.DeployResult();
            failed.id = '0Afhk0000000004';
            failed.status = Metadata.DeployStatus.Failed;
            failed.errorMessage = refusal;
            new GridAdminDeploy(admin.Id).handleResult(failed, null);
            System.assertEquals(
                new List<String>{ GridAdmin.BEFORE_REVIEW },
                GridAdmin.saveStatus(String.valueOf(failed.id)).get('messages')
            );
        }
    }

    @IsTest
    static void theObjectsAndFieldsOnOffer() {
        System.runAs(GridTestUsers.adminUser()) {
            Set<String> objects = new Set<String>();
            for (Map<String, String> o : GridAdmin.listObjects()) {
                objects.add(o.get('name'));
            }
            System.assert(objects.contains('Account'));
            System.assert(objects.contains('Consignment__c'));
            System.assert(!objects.contains('Grid_Configuration__mdt'), 'Not Rowhouse\'s own metadata.');

            Map<String, Object> described = GridAdmin.describeObject('Consignment__c');
            Map<String, Map<String, Object>> fields = new Map<String, Map<String, Object>>();
            for (Map<String, Object> f : (List<Map<String, Object>>) described.get('fields')) {
                fields.put((String) f.get('name'), f);
            }
            System.assertEquals('currency', fields.get('Freight_Charge__c').get('type'));
            System.assert(((List<String>) fields.get('Freight_Charge__c').get('subtotals')).contains('sum'));
            System.assertEquals(false, fields.get('Pallet_Positions__c').get('editable'), 'A formula never is.');
            System.assertEquals(true, fields.get('Name').get('isName'));
            Boolean childOffered = false;
            for (Map<String, Object> c : (List<Map<String, Object>>) described.get('children')) {
                if (c.get('config') == 'Consignment_Items') {
                    childOffered = ((List<String>) c.get('fields')).contains('Consignment__c');
                    System.assert(
                        String.isNotBlank(((Map<String, String>) c.get('fieldLabels')).get('Consignment__c')),
                        'Each link comes with its label.'
                    );
                }
            }
            System.assert(childOffered, 'Consignment_Items can be a child table: its Consignment__c points here.');

            // An Account grid under an Account: the Parent Account first, the Master Record ID
            // (which only a merge fills in) after it.
            for (
                Map<String, Object> c : (List<Map<String, Object>>) GridAdmin.describeObject('Account').get('children')
            ) {
                if (c.get('config') == 'Nest_Accounts') {
                    List<String> links = (List<String>) c.get('fields');
                    System.assertEquals('ParentId', links[0], 'A lookup a new record can set comes first.');
                    System.assert(links.indexOf('MasterRecordId') > 0, 'Master Record ID is offered, after it.');
                }
            }

            Set<String> configs = new Set<String>();
            for (Map<String, Object> c : GridAdmin.listConfigs()) {
                configs.add((String) c.get('name'));
                if (c.get('name') == 'Consignments') {
                    // The Grid Admin tab's stat cards: its child table, and that it does not log.
                    System.assertEquals(1, c.get('childTables'), 'Consignments has one child table.');
                    System.assertEquals(false, c.get('logChanges'));
                }
                if (c.get('name') == 'Consignment_Audit') {
                    System.assertEquals(true, c.get('logChanges'), 'Consignment Audit logs every change.');
                }
            }
            System.assert(configs.contains('Consignments'));
        }
    }

    @IsTest
    static void anAdminIsOfferedOnlyObjectsTheyCanReadAndHiddenFieldsOnlyWithViewSetup() {
        User admin = GridTestUsers.limitedAdmin();
        // Whether this org's Standard User profile holds View Setup and
        // Configuration, read apart from the code under test.
        Boolean viewsSetup = [
            SELECT PermissionsViewSetup
            FROM PermissionSet
            WHERE IsOwnedByProfile = TRUE AND ProfileId = :admin.ProfileId
        ]
        .PermissionsViewSetup;
        System.runAs(admin) {
            System.assertEquals(viewsSetup, GridSecurity.canViewSetup());
            Set<String> objects = new Set<String>();
            for (Map<String, String> o : GridAdmin.listObjects()) {
                objects.add(o.get('name'));
            }
            System.assert(objects.contains('Consignment__c'));
            System.assert(!objects.contains('Consignment_Item__c'), 'Not an object this admin cannot read.');
            String refusal;
            try {
                GridAdmin.describeObject('Consignment_Item__c');
            } catch (GridException e) {
                refusal = e.getMessage();
            }
            System.assertEquals('You do not have access to Consignment_Item__c.', refusal);

            Map<String, Object> described = GridAdmin.describeObject('Consignment__c');
            Set<String> fields = new Set<String>();
            for (Map<String, Object> f : (List<Map<String, Object>>) described.get('fields')) {
                fields.add((String) f.get('name'));
            }
            System.assert(fields.contains('Consignee__c'), 'A field the admin can read.');
            System.assertEquals(
                viewsSetup,
                fields.contains('Contact_Email__c'),
                'A field hidden from the admin is listed only with View Setup and Configuration, as Setup lists it.'
            );
            for (Map<String, Object> c : (List<Map<String, Object>>) described.get('children')) {
                System.assertNotEquals(
                    'Consignment_Items',
                    c.get('config'),
                    'Its object is one the admin cannot read.'
                );
            }
        }
    }

    @IsTest
    static void aDraftCannotTakeAnotherGridsRecordsByName() {
        String otherGridsColumn = 'Consignment_Rates_Pieces';
        System.assertNotEquals(null, Grid_Column__mdt.getInstance(otherGridsColumn), 'The fixture is there.');
        System.runAs(GridTestUsers.adminUser()) {
            // A saved grid's draft naming another grid's column.
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            d.columns[0].name = otherGridsColumn;
            System.assert(
                GridAdmin.check(d).errors.contains('Column ' + otherGridsColumn + ' belongs to another grid.'),
                String.valueOf(GridAdmin.check(d).errors)
            );
            // A new grid may not take any existing record's name either.
            GridAdmin.Draft fresh = newDraft('Fresh_Grid');
            fresh.columns[0].name = Grid_Column__mdt.getInstance(otherGridsColumn).DeveloperName.toLowerCase();
            System.assert(
                String.join(GridAdmin.check(fresh).errors, ' ').contains('belongs to another grid'),
                'In any case: record names are not case-sensitive.'
            );
            // A name that is not an API name is refused before anything is deployed.
            GridAdmin.Draft badName = newDraft('Bad_Record_Name');
            badName.columns[0].name = 'Consignment__Items';
            System.assert(
                String.join(GridAdmin.check(badName).errors, ' ').contains('Column API name: '),
                String.valueOf(GridAdmin.check(badName).errors)
            );
            // The grid's own records keep their names.
            GridAdmin.Draft own = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            System.assertEquals(new List<String>(), GridAdmin.check(own).errors);
        }
    }

    @IsTest
    static void aGridsApiNameIsMatchedInAnyCase() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft saved = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            saved.config.name = 'consignments';
            GridAdmin.Check result = GridAdmin.check(saved);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals('Consignments', saved.config.name, 'Saved under the org\'s own spelling.');
            GridAdmin.Draft taken = newDraft('CONSIGNMENTS');
            System.assert(
                GridAdmin.check(taken)
                    .errors.contains('A grid named CONSIGNMENTS already exists. Choose another API name.'),
                String.valueOf(GridAdmin.check(taken).errors)
            );
        }
    }

    @IsTest
    static void filtersFormulasAndTheRecordPageAreCheckedAndSaved() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('New_Settings');
            d.config.recordPageField = 'Shipper__c';
            GridAdmin.FilterDraft filter = new GridAdmin.FilterDraft();
            filter.field = 'Pieces__c';
            filter.operator = 'greater_than';
            filter.value = '10';
            d.filters.add(filter);
            GridAdmin.ColumnDraft fx = new GridAdmin.ColumnDraft();
            fx.columnLabel = 'Cartons';
            fx.formula = 'Pieces__c * 2';
            fx.formulaType = 'number';
            fx.decimalPlaces = 1;
            d.columns.add(fx);
            GridAdmin.RuleDraft between = new GridAdmin.RuleDraft();
            between.label = 'Mid';
            between.field = 'Freight_Charge__c';
            between.operator = 'between';
            between.value = '1';
            between.valueTo = '9';
            between.style = 'data_bar';
            between.applyTo = 'cell';
            d.rules.add(between);
            GridAdmin.RuleDraft formulaRule = new GridAdmin.RuleDraft();
            formulaRule.label = 'Big';
            formulaRule.formula = 'Pieces__c > 100';
            formulaRule.style = 'icon_warning';
            formulaRule.applyTo = 'row';
            d.rules.add(formulaRule);

            GridAdmin.Check result = GridAdmin.check(d);
            System.assertEquals(new List<String>(), result.errors);
            System.assertEquals(new List<String>(), result.warnings);

            GridAdmin.deployWith = new Kept();
            GridAdmin.save(d);
            Map<String, Metadata.CustomMetadata> sent = byName(((Kept) GridAdmin.deployWith).container);
            System.assertEquals(
                'Shipper__c',
                valueOf(sent.get('Grid_Configuration__mdt.New_Settings'), 'Record_Page_Field__c')
            );
            Metadata.CustomMetadata savedFilter = sent.get('Grid_Filter__mdt.New_Settings_Pieces');
            System.assertNotEquals(null, savedFilter, String.valueOf(sent.keySet()));
            System.assertEquals('greater_than', valueOf(savedFilter, 'Operator__c'));
            System.assertEquals('New_Settings', valueOf(savedFilter, 'Grid_Configuration__c'));
            Metadata.CustomMetadata savedFx = sent.get('Grid_Column__mdt.New_Settings_Cartons');
            System.assertNotEquals(null, savedFx, String.valueOf(sent.keySet()));
            System.assertEquals('Pieces__c * 2', valueOf(savedFx, 'Formula__c'));
            System.assertEquals(null, valueOf(savedFx, 'Field_API_Name__c'), 'A formula column has no field.');
            System.assertEquals('9', valueOf(sent.get('Grid_Display_Rule__mdt.New_Settings_Mid'), 'Value_To__c'));
        }
    }

    @IsTest
    static void whatTheMetadataCannotHoldIsRefusedBeforeSave() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = newDraft('Too_Long');
            GridAdmin.ColumnDraft fx = new GridAdmin.ColumnDraft();
            fx.columnLabel = 'Freight charge per pallet position, before fuel surcharge and accessorial charges';
            fx.formula = 'Pieces__c' + ' + 0'.repeat(1000);
            fx.formulaType = 'number';
            fx.decimalPlaces = 12;
            d.columns.add(fx);
            GridAdmin.RuleDraft r = new GridAdmin.RuleDraft();
            r.label = 'Long';
            r.field = 'Consignee__c';
            r.operator = 'equals';
            r.value = 'Fore Street receiving, Portland; '.repeat(8).left(256);
            r.style = 'bold';
            r.applyTo = 'row';
            d.rules.add(r);
            GridAdmin.FilterDraft f = new GridAdmin.FilterDraft();
            f.field = 'Consignee__c';
            f.operator = 'equals';
            f.value = 'Kennebec Lumber, 12 bundles; '.repeat(9).left(256);
            d.filters.add(f);
            String errors = String.join(GridAdmin.check(d).errors, ' | ');
            System.assert(errors.contains('the column label is 81 characters; 80 at most'), errors);
            System.assert(errors.contains('the formula is 4009 characters; 3900 at most'), errors);
            System.assert(errors.contains('decimal places are 0 to 9'), errors);
            System.assert(errors.contains('Display rule "Long": its value is 256 characters; 255 at most'), errors);
            System.assert(errors.contains('Filter 1: its value is 256 characters; 255 at most'), errors);
        }
    }

    @IsTest
    static void aFilterOrFormulaThatCannotWorkKeepsSaveOff() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft badFilter = newDraft('Bad_Filter');
            GridAdmin.FilterDraft filter = new GridAdmin.FilterDraft();
            filter.field = 'Pieces__c';
            filter.operator = 'contains';
            filter.value = '1';
            badFilter.filters.add(filter);
            String errors = String.join(GridAdmin.check(badFilter).errors, ' ');
            System.assert(errors.contains('Grid Filter') && errors.contains('does not apply'), errors);

            GridAdmin.Draft badFormula = newDraft('Bad_Formula');
            GridAdmin.ColumnDraft fx = new GridAdmin.ColumnDraft();
            fx.columnLabel = 'Broken';
            fx.formula = 'Pieces__c * ';
            fx.formulaType = 'number';
            badFormula.columns.add(fx);
            errors = String.join(GridAdmin.check(badFormula).errors, ' ');
            System.assert(errors.contains('Broken: the formula does not work'), errors);

            // Added with Add formula column and not written yet: said in the editor's
            // own words, and not as a column without a field.
            GridAdmin.Draft unwritten = newDraft('Unwritten');
            GridAdmin.ColumnDraft blank = new GridAdmin.ColumnDraft();
            blank.formula = '';
            blank.formulaType = 'number';
            unwritten.columns.add(blank);
            errors = String.join(GridAdmin.check(unwritten).errors, ' | ');
            System.assert(errors.contains('Formula column 3: write its formula.'), errors);
            System.assert(errors.contains('Formula column 3: give it a header.'), errors);
            System.assert(!errors.contains('needs a field'), errors);

            GridAdmin.Draft badPage = newDraft('Bad_Page');
            badPage.config.recordPageField = 'Consignee__c';
            errors = String.join(GridAdmin.check(badPage).errors, ' ');
            System.assert(errors.contains('is not a lookup'), errors);
        }
    }

    @IsTest
    static void aChildTotalColumnIsCheckedAndSavedWithItsChildTable() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            GridAdmin.ColumnDraft total = new GridAdmin.ColumnDraft();
            total.childTable = 'Consignments_Items';
            total.childTotal = 'sum';
            total.childField = 'Amount__c';
            d.columns.add(total);
            GridAdmin.Check ok = GridAdmin.check(d);
            System.assertEquals(new List<String>(), ok.errors, 'A child total of a child table of the grid.');

            total.childField = null;
            GridAdmin.Check missing = GridAdmin.check(d);
            System.assert(
                String.join(missing.errors, ' | ').contains('a sum needs the Child Field to work out.'),
                String.join(missing.errors, ' | ')
            );
            total.childField = 'Amount__c';
            total.childTable = null;
            total.childTotal = 'sum';
            System.assert(String.join(GridAdmin.check(d).errors, ' | ').contains('choose the child table it totals.'));
            total.childTable = 'Consignments_Items';

            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            Metadata.CustomMetadata sent = null;
            for (Metadata.CustomMetadata m : byName(spy.container).values()) {
                if (valueOf(m, 'Child_Table__c') == 'Consignments_Items') {
                    sent = m;
                }
            }
            System.assertNotEquals(null, sent, 'The child total column is deployed.');
            System.assertEquals('sum', valueOf(sent, 'Child_Total__c'));
            System.assertEquals('Amount__c', valueOf(sent, 'Child_Field__c'));
            System.assertEquals(null, valueOf(sent, 'Field_API_Name__c'), 'It has no field of its own.');
        }
    }

    // ------------------------------------------------------------ row actions

    @IsTest
    static void anArchivedGridIsListedAsArchivedAndKeptOutOfUse() {
        System.runAs(GridTestUsers.adminUser()) {
            Map<String, Object> archived = null;
            for (Map<String, Object> c : GridAdmin.listConfigs()) {
                if (c.get('name') == 'Consignment_Items_2025') {
                    archived = c;
                }
                if (c.get('name') == 'Consignment_Items') {
                    System.assert(
                        ((List<String>) c.get('usedBy')).contains('Consignments'),
                        'Consignments shows Consignment Items as a child table: ' + c.get('usedBy')
                    );
                }
                if (c.get('name') == 'Consignments') {
                    System.assertEquals(false, c.get('archived'));
                }
            }
            System.assertNotEquals(null, archived, 'An archived grid is still listed, for the Archived view.');
            System.assertEquals(true, archived.get('archived'));
            try {
                GridConfig.load('Consignment_Items_2025');
                System.assert(false, 'A page cannot open an archived grid.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Consignment Items 2025 is archived'), e.getMessage());
            }
            System.assertEquals(
                'Consignment_Item__c',
                GridConfig.load('Consignment_Items_2025', true).objectApiName,
                'A parent grid\'s child total still reads it.'
            );
            System.assert(
                !GridLogRetention.loggingGrids().contains('Consignment Items 2025'),
                'An archived grid writes nothing to the edit log.'
            );
            for (
                Map<String, Object> c : (List<Map<String, Object>>) GridAdmin.describeObject('Consignment__c')
                    .get('children')
            ) {
                System.assertNotEquals('Consignment_Items_2025', c.get('config'), 'Not offered as a new child table.');
            }
            // A child table that shows it is skipped, with a warning that says why.
            Map<String, Object> m = new Map<String, Object>{
                'DeveloperName' => 'Consignments_Items_2025',
                'MasterLabel' => 'Items 2025',
                GridDescribe.apiName(Grid_Child_Table__mdt.Relationship_Field__c) => 'Consignment__c',
                GridDescribe.apiName(
                    Grid_Child_Table__mdt.Child_Configuration__c
                ) => Grid_Configuration__mdt.getInstance('Consignment_Items_2025').Id
            };
            Grid_Child_Table__mdt link = (Grid_Child_Table__mdt) JSON.deserialize(
                JSON.serialize(m),
                Grid_Child_Table__mdt.class
            );
            List<String> warnings = new List<String>();
            List<GridConfig.Child> tabs = GridChildTables.childrenFrom(
                new List<Grid_Child_Table__mdt>{ link },
                Consignment__c.SObjectType,
                warnings
            );
            System.assertEquals(0, tabs.size(), 'The tab is hidden.');
            System.assert(
                String.join(warnings, ' ').contains('Consignment_Items_2025 is archived'),
                String.join(warnings, ' ')
            );
        }
    }

    @IsTest
    static void archiveAndRestoreDeployTheConfigurationAlone() {
        System.runAs(GridTestUsers.adminUser()) {
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.setArchived('Consignments', true);
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            System.assertEquals(
                new Set<String>{ 'Grid_Configuration__mdt.Consignments' },
                sent.keySet(),
                'Its columns and the rest are untouched.'
            );
            Metadata.CustomMetadata cfg = sent.get('Grid_Configuration__mdt.Consignments');
            System.assertEquals(true, valueOf(cfg, 'Archived__c'));
            System.assertEquals(
                'Consignment__c',
                valueOf(cfg, 'Object_API_Name__c'),
                'Every field, as the org has it.'
            );
            System.assertEquals('Consignments', cfg.label);
            System.assert(spy.callback instanceof GridAdminDeploy, 'Its outcome is read like a save\'s.');

            GridAdmin.setArchived('Consignment_Items_2025', false);
            System.assertEquals(
                false,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'), 'Archived__c'),
                'Restored.'
            );
            System.assertEquals(
                true,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'), 'Log_Changes__c'),
                'The rest as it was.'
            );
            System.assertEquals(
                false,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'),
                    'Show_Row_Numbers__c'
                ),
                'Show Row Numbers as it was.'
            );
            System.assertEquals(
                false,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'),
                    'Allow_New_Records__c'
                ),
                'Allow New Records as it was.'
            );
        }
    }

    @IsTest
    static void requireExportReportsReadsBackAndIsKeptBySaveArchiveAndRestore() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Consignment_Exports').get('draft');
            System.assertEquals(true, d.config.requireExportReports, 'Require Export Reports Permission reads back.');
            GridAdmin.Draft other = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            System.assertEquals(false, other.config.requireExportReports, 'Unset reads back deselected.');
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            System.assertEquals(
                true,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Exports'),
                    'Require_Export_Reports__c'
                ),
                'Saved as it was.'
            );
            GridAdmin.setArchived('Consignment_Exports', true);
            System.assertEquals(
                true,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Exports'),
                    'Require_Export_Reports__c'
                ),
                'Archive keeps it.'
            );
            d.config.requireExportReports = false;
            GridAdmin.save(d);
            System.assertEquals(
                false,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Exports'),
                    'Require_Export_Reports__c'
                ),
                'Deselecting it is saved.'
            );
        }
    }

    @IsTest
    static void aSaveKeepsArchivedAsTheOrgHasIt() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft d = (GridAdmin.Draft) GridAdmin.readConfig('Consignments').get('draft');
            System.assertEquals(false, d.config.archived);
            d.config.archived = true;
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.save(d);
            System.assertEquals(
                false,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Consignments'), 'Archived__c'),
                'Only archive changes it.'
            );

            GridAdmin.Draft archived = (GridAdmin.Draft) GridAdmin.readConfig('Consignment_Items_2025').get('draft');
            System.assertEquals(true, archived.config.archived);
            System.assertEquals(false, archived.config.showRowNumbers, 'Show Row Numbers reads back unchecked.');
            System.assertEquals(false, archived.config.allowNewRecords, 'Allow New Records reads back unchecked.');
            archived.config.showRowNumbers = true;
            archived.config.allowNewRecords = true;
            archived.config.archived = false;
            GridAdmin.save(archived);
            System.assertEquals(
                true,
                valueOf(byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'), 'Archived__c'),
                'Saving an archived grid keeps it archived.'
            );
            System.assertEquals(
                true,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'),
                    'Show_Row_Numbers__c'
                ),
                'Checking Show Row Numbers is saved.'
            );
            System.assertEquals(
                true,
                valueOf(
                    byName(spy.container).get('Grid_Configuration__mdt.Consignment_Items_2025'),
                    'Allow_New_Records__c'
                ),
                'Checking Allow New Records is saved.'
            );
        }
    }

    @IsTest
    static void aCloneCopiesEveryRecordUnderNewNames() {
        System.runAs(GridTestUsers.adminUser()) {
            GridAdmin.Draft source = (GridAdmin.Draft) GridAdmin.readConfig('Nest_Accounts').get('draft');
            Kept spy = new Kept();
            GridAdmin.deployWith = spy;
            GridAdmin.cloneConfig('Nest_Accounts', 'Copy of Nest Accounts', 'Copy_of_Nest_Accounts');
            Map<String, Metadata.CustomMetadata> sent = byName(spy.container);
            Integer records =
                1 +
                source.columns.size() +
                source.rules.size() +
                source.filters.size() +
                source.actions.size() +
                source.children.size();
            System.assertEquals(records, sent.size(), String.valueOf(sent.keySet()));
            Metadata.CustomMetadata cfg = sent.get('Grid_Configuration__mdt.Copy_of_Nest_Accounts');
            System.assertEquals('Copy of Nest Accounts', cfg.label);
            System.assertEquals('Account', valueOf(cfg, 'Object_API_Name__c'));
            System.assertEquals(false, valueOf(cfg, 'Archived__c'));
            Set<String> links = new Set<String>();
            for (String fullName : sent.keySet()) {
                if (fullName == 'Grid_Configuration__mdt.Copy_of_Nest_Accounts') {
                    continue;
                }
                System.assert(
                    fullName.substringAfter('.').startsWith('Copy_of_Nest_Accounts_'),
                    'A new record, named after the copy: ' + fullName
                );
                System.assertEquals('Copy_of_Nest_Accounts', valueOf(sent.get(fullName), 'Grid_Configuration__c'));
                if (fullName.startsWith('Grid_Child_Table__mdt.')) {
                    links.add(fullName.substringAfter('.'));
                }
            }
            Integer totals = 0;
            for (String fullName : sent.keySet()) {
                Object table = fullName.startsWith('Grid_Column__mdt.')
                    ? valueOf(sent.get(fullName), 'Child_Table__c')
                    : null;
                if (table != null) {
                    totals++;
                    System.assert(
                        links.contains((String) table),
                        'A child total column totals the copy\'s child table: ' + table + ' in ' + links
                    );
                }
            }
            System.assertEquals(2, totals, 'Both child total columns are copied.');

            try {
                GridAdmin.cloneConfig('Nest_Accounts', 'Key Accounts', 'Consignments');
                System.assert(false, 'A clone cannot take an existing grid\'s API name.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('A grid named Consignments already exists'), e.getMessage());
            }
            try {
                GridAdmin.cloneConfig('Nest_Accounts', '', 'Untitled_Copy');
                System.assert(false, 'A clone needs a title.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Give the grid a title'), e.getMessage());
            }
        }
    }

    @IsTest
    static void rowActionsThatDeployNeedCustomizeApplication() {
        System.runAs(GridTestUsers.adminViewer()) {
            GridAdmin.deployWith = new Kept();
            for (Integer i = 0; i < 2; i++) {
                try {
                    if (i == 0)
                        GridAdmin.setArchived('Consignments', true);
                    if (i == 1)
                        GridAdmin.cloneConfig('Consignments', 'Copy of Consignments', 'Copy_of_Consignments');
                    System.assert(false, 'Call ' + i + ' needs Customize Application.');
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('Customize Application'), e.getMessage());
                }
            }
            System.assertEquals(null, ((Kept) GridAdmin.deployWith).container, 'Nothing was deployed.');
            System.assert(
                !GridAdmin.setupRecords('Consignments').isEmpty(),
                'Seeing what to delete needs only Rowhouse Grid Admin.'
            );
        }
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridAdmin.setupRecords('Consignments');
                System.assert(false, 'Not without Rowhouse Grid Admin.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Rowhouse Grid Admin'), e.getMessage());
            }
        }
    }

    @IsTest
    static void setupListsEveryRecordToDeleteWithTheGridLast() {
        System.runAs(GridTestUsers.adminUser()) {
            List<Map<String, String>> items = GridAdmin.setupRecords('Consignment_Items');
            Integer firstOwn = null;
            Set<String> others = new Set<String>();
            Set<String> columns = new Set<String>();
            for (Integer i = 0; i < items.size(); i++) {
                Map<String, String> item = items[i];
                System.assert(
                    item.get('url').startsWith('/lightning/setup/CustomMetadata/page?address=%2F'),
                    item.get('url')
                );
                if (item.get('note') != null && item.get('note').startsWith('A child table of')) {
                    System.assertEquals(null, firstOwn, 'Other grids\' child tables come before its own records.');
                    others.add(item.get('name'));
                } else if (firstOwn == null) {
                    firstOwn = i;
                }
                if (item.get('kind') == 'Grid Column') {
                    columns.add(item.get('name'));
                }
            }
            System.assert(others.contains('Consignments_Items'), 'Consignments\' child table shows it: ' + others);
            System.assert(
                columns.contains('Consignment_Items_Name') && columns.contains('Consignment_Items_Amount'),
                String.valueOf(columns)
            );
            Map<String, String> last = items[items.size() - 1];
            System.assertEquals('Consignment_Items', last.get('name'), 'The grid itself is last.');
            System.assertEquals('Grid Configuration', last.get('kind'));
            System.assert(
                last.get('url').endsWith(String.valueOf(Grid_Configuration__mdt.getInstance('Consignment_Items').Id)),
                last.get('url')
            );
        }
    }
}
