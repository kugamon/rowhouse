/**
 * DEVELOPMENT ONLY. Never packaged.
 * Nesting: the tabs a grid lists under its rows, and a child grid's
 * parent filter. The fixture: Consignments opens Consignment_Items (by Consignment__c);
 * Nest_Accounts opens Consignments (by Shipper__c) and Nest_Contacts (by
 * AccountId); Consignments_By_Mode lists three tabs that cannot work, on purpose.
 */
@IsTest
private class GridChildTablesTest {
    private static Consignment__c parentA;
    private static Consignment__c parentB;

    /** A with three children (10, 20, 30), B with one (5). */
    private static void seed() {
        parentA = new Consignment__c(Name = 'Kennebec Lumber, 12 bundles');
        parentB = new Consignment__c(Name = 'Saco River Outfitters, 3 crates');
        insert new List<Consignment__c>{ parentA, parentB };
        insert new List<Consignment_Item__c>{
            new Consignment_Item__c(Name = 'Spruce studs, 6 bundles', Amount__c = 10, Consignment__c = parentA.Id),
            new Consignment_Item__c(Name = 'Pine boards, 3 bundles', Amount__c = 20, Consignment__c = parentA.Id),
            new Consignment_Item__c(Name = 'Cedar shingles, 2 pallets', Amount__c = 30, Consignment__c = parentA.Id),
            new Consignment_Item__c(Name = 'Canoe paddles, 1 pallet', Amount__c = 5, Consignment__c = parentB.Id)
        };
    }

    private static List<String> names(Map<String, Object> page) {
        List<String> out = new List<String>();
        for (Map<String, Object> row : (List<Map<String, Object>>) page.get('rows')) {
            out.add((String) row.get('Name'));
        }
        return out;
    }

    private static String refusal(String configName, String link, String parentId) {
        try {
            GridChildTables.scopeFor(GridConfig.forUser(configName), link, parentId);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void listsTheTabsInOrderWithTheirLabels() {
        System.runAs(GridTestUsers.fullUser()) {
            List<GridConfig.Child> tabs = GridConfig.forUser('Nest_Accounts').children;
            System.assertEquals(2, tabs.size(), String.valueOf(tabs));
            System.assertEquals('Nest_Accounts_Records', tabs[0].name);
            System.assertEquals('Consignments', tabs[0].label, 'The Tab Label.');
            System.assertEquals('Consignments', tabs[0].configName);
            System.assertEquals('Consignment__c', tabs[0].objectApiName);
            System.assertEquals('Shipper__c', tabs[0].relationshipField);
            System.assertEquals('Nest_Accounts_Contacts', tabs[1].name);
            System.assertEquals('Contacts', tabs[1].label, 'No Tab Label: the child configuration\'s label.');
            System.assertEquals('AccountId', tabs[1].relationshipField);

            List<GridConfig.Child> children = GridConfig.forUser('Consignments').children;
            System.assertEquals(1, children.size());
            System.assertEquals('Items', children[0].label);
            System.assertEquals('Consignment__c', children[0].relationshipField);
            System.assertEquals(
                0,
                GridConfig.forUser('Consignment_Items').children.size(),
                'A grid with no tabs lists none.'
            );
        }
    }

    @IsTest
    static void skipsATabThatCannotWorkWithAWarning() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Definition def = GridConfig.load('Consignments_By_Mode');
            System.assertEquals(0, def.children.size(), 'None of Consignments_By_Mode\'s tabs can work.');
            String all = String.join(def.warnings, '\n');
            System.assert(
                all.contains(
                    'Grid Child Table Consignments_By_Mode_Bad_Field was skipped: ' +
                    'Consignment_Item__c.Amount__c does not point to Consignment__c records.'
                ),
                all
            );
            System.assert(
                all.contains(
                    'Grid Child Table Consignments_By_Mode_Wrong_Parent was skipped: ' +
                    'Contact.AccountId does not point to Consignment__c records.'
                ),
                all
            );
            System.assert(
                all.contains(
                    'Grid Child Table Consignments_By_Mode_No_Child was skipped: it has no Child Configuration.'
                ),
                all
            );
        }
    }

    @IsTest
    static void aTabTheUserCannotReadIsNotOffered() {
        // Freight_Limited_Access reads Consignments but not their items.
        System.runAs(GridTestUsers.limitedUser()) {
            System.assertEquals(0, GridConfig.forUser('Consignments').children.size());
        }
    }

    @IsTest
    static void aChildGridReadsOnlyItsParentsRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            Map<String, Object> a = GridController.fetchRows(
                'Consignment_Items',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                'Consignments_Items',
                parentA.Id,
                null,
                null,
                null,
                null
            );
            Map<String, Object> b = GridController.fetchRows(
                'Consignment_Items',
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                'Consignments_Items',
                parentB.Id,
                null,
                null,
                null,
                null
            );
            Map<String, Object> searched = GridController.fetchRows(
                'Consignment_Items',
                'pallet',
                null,
                null,
                null,
                null,
                null,
                null,
                'Consignments_Items',
                parentA.Id,
                null,
                null,
                null,
                null
            );
            Test.stopTest();
            System.assertEquals(
                new List<String>{ 'Cedar shingles, 2 pallets', 'Pine boards, 3 bundles', 'Spruce studs, 6 bundles' },
                names(a),
                'Sorted by Name, A\'s only.'
            );
            System.assertEquals(3, a.get('totalRows'));
            System.assertEquals(new List<String>{ 'Canoe paddles, 1 pallet' }, names(b));
            System.assertEquals(
                new List<String>{ 'Cedar shingles, 2 pallets' },
                names(searched),
                'Search stays within the parent.'
            );
        }
    }

    @IsTest
    static void aChildGridsTotalsCoverOnlyItsParentsRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result result = GridController.summarizeGroups(
                'Consignment_Items',
                null,
                new List<String>(),
                null,
                null,
                'Consignments_Items',
                parentA.Id,
                null,
                null,
                null
            );
            Test.stopTest();
            System.assertEquals(1, result.groups.size(), String.valueOf(result.groups));
            Map<String, Object> total = result.groups[0];
            System.assertEquals(3, total.get('n'));
            Map<String, Object> values = (Map<String, Object>) total.get('v');
            Map<String, Object> amount = (Map<String, Object>) values.get('Amount__c');
            System.assertEquals(60, Decimal.valueOf((String) amount.get('s')), 'A\'s 10 + 20 + 30, not B\'s 5.');
        }
    }

    @IsTest
    static void importIntoAChildGridCreatesRecordsUnderTheParent() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridImportService.Result result = GridController.importRows(
                'Consignment_Items',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Name' => 'Life jackets, 2 cartons', 'Amount__c' => '7' }
                },
                'Consignments_Items',
                parentB.Id,
                null,
                null
            );
            Test.stopTest();
            System.assert(result.rows[0].success && result.rows[0].created, String.valueOf(result.rows[0]));
            Consignment_Item__c made = [
                SELECT Consignment__c, Amount__c
                FROM Consignment_Item__c
                WHERE Id = :result.rows[0].recordId
            ];
            System.assertEquals(parentB.Id, made.Consignment__c, 'The parent is filled in from the tab.');
            System.assertEquals(7, made.Amount__c);
        }
    }

    @IsTest
    static void refusesAParentThatDoesNotFit() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            System.assertEquals(
                null,
                GridChildTables.scopeFor(GridConfig.forUser('Consignment_Items'), null, null),
                'No tab and no parent: a top-level grid.'
            );
            System.assertEquals(
                'No Grid Child Table named "Consignment_Items_Claims".',
                refusal('Consignment_Items', 'Consignment_Items_Claims', parentA.Id)
            );
            System.assertEquals(
                'Grid Child Table Nest_Accounts_Contacts does not show the grid Consignment_Items.',
                refusal('Consignment_Items', 'Nest_Accounts_Contacts', parentA.Id)
            );
            System.assertEquals(
                'Record ' + UserInfo.getUserId() + ' is not a Consignment__c.',
                refusal('Consignment_Items', 'Consignments_Items', UserInfo.getUserId())
            );
            System.assertEquals(
                'Not a record Id: not-an-id',
                refusal('Consignment_Items', 'Consignments_Items', 'not-an-id')
            );
            System.assertEquals(
                'A child table needs both its tab and its parent record.',
                refusal('Consignment_Items', 'Consignments_Items', null)
            );
            System.assertEquals(
                'A child table needs both its tab and its parent record.',
                refusal('Consignment_Items', null, parentA.Id)
            );
            // Through the controller, the message reaches the browser as it is.
            try {
                GridController.fetchRows(
                    'Consignment_Items',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    'Consignment_Items_Claims',
                    parentA.Id,
                    null,
                    null,
                    null,
                    null
                );
                System.assert(false, 'Expected a refusal.');
            } catch (AuraHandledException e) {
                System.assertEquals('No Grid Child Table named "Consignment_Items_Claims".', e.getMessage());
            }
        }
    }

    @IsTest
    static void theParentFilterIsBoundNotConcatenated() {
        // HR-6 and TC-021's rule for the parent: the Id is a bind variable, and
        // the field comes from describe. A request cannot name another field.
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridChildTables.Scope s = GridChildTables.scopeFor(
                GridConfig.forUser('Consignment_Items'),
                'Consignments_Items',
                parentA.Id
            );
            System.assertEquals('Consignment__c', GridDescribe.localName(s.field));
            System.assertEquals(parentA.Id, s.parentId);
            Map<String, Object> binds = new Map<String, Object>();
            String condition = GridDataService.parentCondition(s.fieldApiName, s.parentId, binds);
            System.assertEquals(s.fieldApiName + ' = :parentId', condition);
            System.assertEquals(parentA.Id, binds.get('parentId'));
            System.assertEquals(null, GridDataService.parentCondition(null, null, binds), 'No parent, no condition.');
        }
    }

    // ---------------------------------------------------------- child totals and heights

    /** A Grid Column in memory, from its fields: Custom Metadata fields cannot be assigned in Apex. */
    private static Grid_Column__mdt column(String name, Map<String, Object> fields) {
        Map<String, Object> m = new Map<String, Object>{ 'DeveloperName' => name, 'MasterLabel' => name };
        for (String field : fields.keySet()) {
            m.put(GridTestUsers.qualified(field), fields.get(field));
        }
        return (Grid_Column__mdt) JSON.deserialize(JSON.serialize(m), Grid_Column__mdt.class);
    }

    private static GridConfig.Column totalColumn(String name, String kind, String field) {
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance('Consignments');
        return GridConfig.childTotalColumn(
            column(
                name,
                new Map<String, Object>{
                    'Child_Table__c' => 'Consignments_Items',
                    'Child_Total__c' => kind,
                    'Child_Field__c' => field
                }
            ),
            Consignment__c.SObjectType,
            GridChildTables.linksOf(cfg)
        );
    }

    private static String totalRefusal(String table, String kind, String field) {
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance('Consignments');
        try {
            GridChildTables.childTotalOf(table, kind, field, Consignment__c.SObjectType, GridChildTables.linksOf(cfg));
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void aChildTotalColumnTotalsEachRowsChildRecords() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Consignment__c none = new Consignment__c(Name = 'Quabbin Supply, 2 crates');
            insert none;
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            GridConfig.Column sum = totalColumn('Sum_Amount', 'sum', 'Amount__c');
            GridConfig.Column count = totalColumn('Count_Items', 'count', null);
            GridConfig.Column top = totalColumn('Top_Amount', 'max', 'Amount__c');
            def.columns.addAll(new List<GridConfig.Column>{ sum, count, top });
            System.assertEquals('_ct_Sum_Amount', sum.field);
            System.assertEquals('Items: Sum of Amount', sum.label, 'Named after the tab, the total and the field.');
            System.assertEquals('Items', count.label, 'A count of records is named after the tab.');
            System.assertEquals('number', count.type);
            System.assert(sum.isChildTotal && !sum.editable && !sum.sortable && !sum.groupable && !sum.filterable);
            System.assert(!def.fieldNames().contains(sum.field), 'A total is not a field to read.');

            List<Map<String, Object>> rows = new List<Map<String, Object>>{
                new Map<String, Object>{ 'Id' => parentA.Id },
                new Map<String, Object>{ 'Id' => parentB.Id },
                new Map<String, Object>{ 'Id' => none.Id }
            };
            Test.startTest();
            GridChildTables.addChildTotals(rows, def);
            Test.stopTest();
            System.assertEquals(60, Decimal.valueOf(String.valueOf(rows[0].get(sum.field))));
            System.assertEquals(3, Integer.valueOf(String.valueOf(rows[0].get(count.field))));
            System.assertEquals(30, Decimal.valueOf(String.valueOf(rows[0].get(top.field))));
            System.assertEquals(5, Decimal.valueOf(String.valueOf(rows[1].get(sum.field))));
            System.assertEquals(null, rows[2].get(sum.field), 'A sum of nothing is blank.');
            System.assertEquals(
                0,
                Integer.valueOf(String.valueOf(rows[2].get(count.field))),
                'A count of nothing is 0.'
            );
        }
    }

    @IsTest
    static void aLowestOrHighestDateArrivesAsADate() {
        // A Date held as an Object is also an instanceof Datetime: the column's type decides.
        Object lowest = Date.newInstance(2026, 9, 15);
        System.assertEquals('2026-09-15', GridChildTables.plain(lowest, 'date'));
        System.assertEquals(
            '2026-09-15T13:30:00.000Z',
            GridChildTables.plain(Datetime.newInstanceGmt(2026, 9, 15, 13, 30, 0), 'datetime')
        );
        System.assertEquals('1610000000', GridChildTables.plain(Decimal.valueOf('1610000000'), 'currency'));
        System.assertEquals(null, GridChildTables.plain(null, 'date'));
    }

    @IsTest
    static void aChildTotalThatCannotWorkSaysWhy() {
        System.assertEquals(
            'this grid has no child table named "Consignments_Claims".',
            totalRefusal('Consignments_Claims', 'count', null)
        );
        System.assertEquals(
            'a sum needs the Child Field to work out.',
            totalRefusal('Consignments_Items', 'sum', null)
        );
        System.assertEquals('unknown Child Total "median".', totalRefusal('Consignments_Items', 'median', 'Amount__c'));
        System.assertEquals(
            'Consignment_Item__c has no field "Declared_Value__c".',
            totalRefusal('Consignments_Items', 'sum', 'Declared_Value__c')
        );
        System.assert(
            totalRefusal('Consignments_Items', 'sum', 'Name').startsWith('a sum does not apply to'),
            totalRefusal('Consignments_Items', 'sum', 'Name')
        );
        System.assertEquals(
            null,
            totalRefusal('Consignments_Items', 'count', 'Name'),
            'A count of a field counts its values.'
        );
    }

    @IsTest
    static void aGridShowsItsChildTotalColumnsWithItsRows() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = new Account(Name = 'Casco Bay Marine');
            insert acme;
            insert new List<Contact>{
                new Contact(FirstName = 'Ada', LastName = 'Whitcomb', AccountId = acme.Id),
                new Contact(FirstName = 'Clara', LastName = 'Fogg', AccountId = acme.Id)
            };
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Casco Bay Marine, 4 pallets', Shipper__c = acme.Id, Freight_Charge__c = 100),
                new Consignment__c(Name = 'Casco Bay Marine, 2 crates', Shipper__c = acme.Id, Freight_Charge__c = 25.5)
            };
            GridConfig.Definition def = GridConfig.forUser('Nest_Accounts');
            Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
            for (GridConfig.Column c : def.columns) {
                byField.put(c.field, c);
            }
            System.assertEquals('Contacts', byField.get('_ct_Nest_Accounts_Contact_Count').label, 'The Column Label.');
            System.assertEquals(
                'currency',
                byField.get('_ct_Nest_Accounts_Records_Amount').type,
                'A sum of currency is currency.'
            );
            Map<String, Object> page = GridController.fetchRows(
                'Nest_Accounts',
                'Casco Bay Marine',
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
            Map<String, Object> row = ((List<Map<String, Object>>) page.get('rows'))[0];
            System.assertEquals(
                2,
                Integer.valueOf(String.valueOf(row.get('_ct_Nest_Accounts_Contact_Count'))),
                String.valueOf(row)
            );
            System.assertEquals(
                125.5,
                Decimal.valueOf(String.valueOf(row.get('_ct_Nest_Accounts_Records_Amount'))),
                String.valueOf(row)
            );
        }
    }

    @IsTest
    static void aChildFilterOnARelatedRecordsFieldIsReadAsAPath() {
        // A child grid's Grid Filter may test a related record's field, as the
        // Grid Guide says. Counting and totalling its tab must read it as a
        // path, not fail with "Unknown field".
        Schema.SObjectType childType = Consignment_Item__c.SObjectType;
        Schema.SObjectType recordType = Consignment__c.SObjectType;
        List<GridFilters.Condition> onTheParent = new List<GridFilters.Condition>{
            GridFilters.condition(childType, 'Consignment__r.Consignee__c', 'equals', 'Kennebec Lumber', null)
        };
        List<GridFilters.Condition> plain = new List<GridFilters.Condition>{
            GridFilters.condition(recordType, 'Consignee__c', 'equals', 'Kennebec Lumber', null)
        };
        List<GridFilters.Condition> throughAHiddenLookup = new List<GridFilters.Condition>{
            GridFilters.condition(recordType, 'Shipper__r.Name', 'equals', 'Casco Bay Marine', null)
        };
        System.runAs(GridTestUsers.fullUser()) {
            System.assert(GridChildTables.readable(childType, onTheParent), 'A path the user can read.');
            System.assert(
                GridChildTables.readable(recordType, throughAHiddenLookup),
                'The full user reads the lookup.'
            );
        }
        System.runAs(GridTestUsers.limitedUser()) {
            // Freight_Limited_Access reads Consignments, not their items or Shipper__c.
            System.assert(GridChildTables.readable(recordType, plain), 'A field the user can read.');
            System.assert(
                !GridChildTables.readable(recordType, throughAHiddenLookup),
                'A path through a lookup the user cannot read is not readable: the tab counts nothing.'
            );
            System.assert(
                !GridChildTables.readable(childType, onTheParent),
                'Nor is a path on records the user cannot read at all.'
            );
        }
    }

    @IsTest
    static void aTabCarriesTheHeightTheAdminGaveIt() {
        System.runAs(GridTestUsers.fullUser()) {
            List<GridConfig.Child> tabs = GridConfig.forUser('Nest_Accounts').children;
            System.assertEquals(null, tabs[0].height, 'No Height: the standard.');
            System.assertEquals(250, tabs[1].height, 'Nest_Accounts_Contacts: 250 px.');
        }
    }
}
