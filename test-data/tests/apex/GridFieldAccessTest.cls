/**
 * DEVELOPMENT ONLY. Never packaged.
 * Refusals at the field level for the names the browser sends, as a
 * restricted user. The browser names a column to filter or sort by, a long
 * text to read whole, a field of a parent record to save; each must be one
 * this user may read (and, to save, edit) in this grid. And a total of child
 * records is offered only when the user can read them, the link to the row
 * and the field it adds up.
 *
 * limitedUser() (Freight_Limited_Access) cannot read Picked_Up__c,
 * Delivery_Notes__c or the Account lookup Shipper__c, and can read
 * Freight_Charge__c, which is not a column of Consignment_Charges. readOnlyUser()
 * (Freight_Read_Only) reads the consignment items but not their Amount__c.
 * Each refusal is paired with the same request from fullUser(), which it does
 * not refuse, so the test shows the user's access is what decides.
 */
@IsTest
private class GridFieldAccessTest {
    private static final String PROBE = 'Berkshire Mills, Springfield';
    private static final String INDUSTRY = 'Shipper__r.Industry';
    private static final String RECORDS_AMOUNT = '_ct_Nest_Accounts_Records_Amount';
    private static final String CHILDREN_AMOUNT = '_ct_Consignment_Directory_Items_Amount';

    @TestSetup
    static void setup() {
        GridTestUsers.limitedUser();
        GridTestUsers.readOnlyUser();
        System.runAs(GridTestUsers.fullUser()) {
            Account parent = new Account(Name = 'Wachusett Paper', Industry = 'Manufacturing');
            insert parent;
            Consignment__c rec = new Consignment__c(
                Name = PROBE,
                Consignee__c = 'Berkshire Mills',
                Delivery_Notes__c = 'Gate code 4471; receiving closes at 3 pm.',
                Picked_Up__c = Datetime.newInstanceGmt(2026, 10, 1, 12, 0, 0),
                Shipper__c = parent.Id
            );
            insert rec;
            insert new Consignment_Item__c(Name = 'Kraft paper, 4 pallets', Consignment__c = rec.Id, Amount__c = 40);
        }
    }

    // ---------------------------------------------------------------- helpers

    private static User full() {
        return GridTestUsers.built(GridTestUsers.FULL);
    }

    private static User limited() {
        return GridTestUsers.built(GridTestUsers.LIMITED);
    }

    private static Id probeId() {
        Id found;
        System.runAs(full()) {
            found = [SELECT Id FROM Consignment__c WHERE Name = :PROBE LIMIT 1].Id;
        }
        return found;
    }

    private static Map<String, Object> page(
        String configName,
        String searchTerm,
        String sortField,
        List<Map<String, Object>> filters
    ) {
        // Each page as a request of its own: a cursor opened for one user is never another's.
        GridDataService.forgetOpenCursors();
        return GridController.fetchRows(
            configName,
            searchTerm,
            sortField,
            sortField == null ? null : 'asc',
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
    }

    private static List<Map<String, Object>> rowsOf(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get('rows');
    }

    /** What fetching the page was refused with, or null when it was not refused. */
    private static String pageRefusal(
        String configName,
        String searchTerm,
        String sortField,
        List<Map<String, Object>> filters
    ) {
        try {
            page(configName, searchTerm, sortField, filters);
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
        return null;
    }

    private static Map<String, GridConfig.Column> byField(GridConfig.Definition def) {
        Map<String, GridConfig.Column> out = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            out.put(c.field, c);
        }
        return out;
    }

    /** A user's filter on When (Picked_Up__c), a column of Consignments_By_Mode. */
    private static List<Map<String, Object>> whenIsSet() {
        return new List<Map<String, Object>>{
            new Map<String, Object>{ 'field' => 'Picked_Up__c', 'operator' => 'is_not_blank' }
        };
    }

    // ---------------------------------------------------------------- filters

    @IsTest
    static void aFilterOnAFieldTheUserCannotReadIsRefused() {
        System.runAs(full()) {
            System.assertEquals(
                1,
                rowsOf(page('Consignments_By_Mode', PROBE, null, whenIsSet())).size(),
                'A user who can read When filters by it.'
            );
        }
        System.runAs(limited()) {
            System.assertEquals(
                'Cannot filter by Picked_Up__c.',
                pageRefusal('Consignments_By_Mode', PROBE, null, whenIsSet()),
                'The rows are not read with a filter on a field the user cannot read.'
            );
            String refused;
            try {
                GridGroupService.summarize(
                    'Consignments_By_Mode',
                    null,
                    new List<String>{ 'Service_Level__c' },
                    null,
                    null,
                    null,
                    null,
                    whenIsSet(),
                    null
                );
            } catch (GridException e) {
                refused = e.getMessage();
            }
            System.assertEquals('Cannot filter by Picked_Up__c.', refused, 'Nor are the group totals.');
        }
    }

    // ---------------------------------------------------------------- sorting

    @IsTest
    static void sortingByAFieldTheUserCannotReadIsRefused() {
        System.runAs(full()) {
            System.assertEquals(
                1,
                rowsOf(page('Consignments_By_Mode', PROBE, 'Picked_Up__c', null)).size(),
                'When is a sortable column of Consignments_By_Mode for a user who can read it.'
            );
        }
        System.runAs(limited()) {
            String refused = pageRefusal('Consignments_By_Mode', PROBE, 'Picked_Up__c', null);
            System.assert(
                refused != null && refused.contains('Picked_Up__c'),
                'A sort by a field the user cannot read must be refused, naming it: ' + refused
            );
            System.assertEquals(
                1,
                rowsOf(page('Consignments_By_Mode', PROBE, 'Consignee__c', null)).size(),
                'A sort by a column the user can read still works, so the grid itself is open to this user.'
            );
        }
    }

    @IsTest
    static void sortingByAFieldThatIsNotASortableColumnOfTheGridIsRefused() {
        System.runAs(limited()) {
            System.assert(
                GridSecurity.canRead(Consignment__c.Freight_Charge__c),
                'The limited user can read Freight_Charge__c, so only the grid can refuse the sort.'
            );
            String refused = pageRefusal('Consignment_Charges', PROBE, 'Freight_Charge__c', null);
            System.assert(
                refused != null && refused.startsWith('Cannot sort by Freight_Charge__c'),
                'Freight_Charge__c is not a column of Consignment_Charges: the browser may not sort by it. ' + refused
            );
        }
    }

    // ---------------------------------------------------------------- long text

    @IsTest
    static void theWholeOfALongTextTheUserCannotReadIsRefused() {
        Id rec = probeId();
        System.runAs(full()) {
            System.assertEquals(
                'Gate code 4471; receiving closes at 3 pm.',
                GridController.fetchFullText('Consignment_Charges', rec, 'Delivery_Notes__c'),
                'Delivery_Notes__c is a column of Consignment_Charges.'
            );
        }
        System.runAs(limited()) {
            String refused;
            try {
                GridController.fetchFullText('Consignment_Charges', rec, 'Delivery_Notes__c');
            } catch (AuraHandledException e) {
                refused = e.getMessage();
            }
            System.assertEquals('Not a long text column of this grid: Delivery_Notes__c', refused);
        }
    }

    // ---------------------------------------------------------------- parent records

    @IsTest
    static void aParentRecordFieldTheUserCannotEditIsStrippedAndNothingIsWritten() {
        Id rec = probeId();
        GridSaveResult ticket;
        System.runAs(limited()) {
            System.assert(
                !byField(GridConfig.forUser('Consignment_Shippers')).containsKey(INDUSTRY),
                'The limited user cannot read Shipper__c, so the account\'s Industry is not a column for them.'
            );
            Test.startTest();
            Integer jobs = Limits.getQueueableJobs();
            ticket = GridSaveService.save(
                'Consignment_Shippers',
                new List<Map<String, Object>>{ new Map<String, Object>{ 'Id' => rec, INDUSTRY => 'Energy' } }
            );
            System.assertEquals(jobs, Limits.getQueueableJobs(), 'Nothing was queued to write.');
            Test.stopTest();
        }
        System.assert(
            ticket.strippedFields.contains(INDUSTRY),
            'Industry is an editable column of Consignment_Shippers, so the user\'s access must be what refused it: ' +
            ticket
        );
        System.assertEquals(0, ticket.chunkCount, String.valueOf(ticket));
        System.runAs(full()) {
            System.assertEquals(
                'Manufacturing',
                [SELECT Industry FROM Account WHERE Name = 'Wachusett Paper' LIMIT 1].Industry,
                'The account was not changed through a lookup the user cannot read.'
            );
        }
    }

    // ---------------------------------------------------------------- child totals

    @IsTest
    static void aChildTotalOfAFieldTheUserCannotReadIsNotOffered() {
        System.runAs(full()) {
            GridConfig.Column total = byField(GridConfig.forUser('Consignment_Directory')).get(CHILDREN_AMOUNT);
            System.assertNotEquals(null, total, 'A user who can read Amount__c is offered the total.');
            Map<String, Object> row = rowsOf(page('Consignment_Directory', PROBE, null, null))[0];
            System.assertEquals(
                40,
                Decimal.valueOf(String.valueOf(row.get(CHILDREN_AMOUNT))).intValue(),
                String.valueOf(row)
            );
        }
        System.runAs(GridTestUsers.built(GridTestUsers.READ_ONLY)) {
            GridConfig.Definition def = GridConfig.forUser('Consignment_Directory');
            System.assertEquals(
                1,
                def.children.size(),
                'The user reads the children and their link to the row, so the Children tab is offered.'
            );
            System.assert(
                !byField(def).containsKey(CHILDREN_AMOUNT),
                'The total of Amount__c, which the user cannot read, is not offered.'
            );
            Map<String, Object> row = rowsOf(page('Consignment_Directory', PROBE, null, null))[0];
            System.assert(!row.containsKey(CHILDREN_AMOUNT), 'Nor is it on the rows: ' + row);
        }
    }

    @IsTest
    static void aChildTotalReachedThroughALookupTheUserCannotReadIsNotOffered() {
        System.runAs(full()) {
            System.assert(byField(GridConfig.forUser('Nest_Accounts')).containsKey(RECORDS_AMOUNT));
        }
        System.runAs(limited()) {
            Map<String, GridConfig.Column> columns = byField(GridConfig.forUser('Nest_Accounts'));
            System.assert(
                columns.containsKey('_ct_Nest_Accounts_Contact_Count'),
                'The count of Contacts, which the user can read, is still offered.'
            );
            System.assert(
                !columns.containsKey(RECORDS_AMOUNT),
                'The total of Consignments reached through Shipper__c, which the user cannot read, is not.'
            );
        }
    }
}
