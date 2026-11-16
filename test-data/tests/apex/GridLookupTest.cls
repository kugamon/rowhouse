/**
 * DEVELOPMENT ONLY. Never packaged.
 * Lookup and owner cells: the typeahead search, the display name that
 * travels with each row, sorting and searching by that name, and the save's
 * check that a lookup holds an Id of its own target object.
 *
 * Runs as GridTestUsers.fullUser(): what the searches can see comes from
 * sharing and permission sets, never from whoever runs the suite.
 */
@IsTest
private class GridLookupTest {
    private static Map<String, Id> accounts(List<String> names) {
        List<Account> recs = new List<Account>();
        for (String n : names) {
            recs.add(new Account(Name = n));
        }
        insert recs;
        Map<String, Id> out = new Map<String, Id>();
        for (Account a : recs) {
            out.put(a.Name, a.Id);
        }
        return out;
    }

    @IsTest
    static void searchFindsTheTermAnywhereInTheName() {
        System.runAs(GridTestUsers.fullUser()) {
            accounts(new List<String>{ 'Lower Penobscot Fuel', 'Penobscot Paper', 'Quabbin Supply' });
            List<Map<String, String>> found = GridLookup.search('Consignments', 'Shipper__c', 'penobscot');
            System.assertEquals(2, found.size(), String.valueOf(found));
            System.assertEquals('Lower Penobscot Fuel', found[0].get('name'), 'Sorted by name.');
            System.assertEquals('Penobscot Paper', found[1].get('name'));
            System.assertEquals('Account', found[0].get('kind'));
            System.assertEquals('Account', found[0].get('object'), 'The object\'s local name keys its icon.');
            System.assert(String.isNotBlank(found[0].get('id')));
        }
    }

    @IsTest
    static void wildcardsInTheTermAreText() {
        System.runAs(GridTestUsers.fullUser()) {
            accounts(new List<String>{ '100% Maine Maple', 'Green Mountain Maple' });
            List<Map<String, String>> found = GridLookup.search('Consignments', 'Shipper__c', '%');
            System.assertEquals(1, found.size(), 'A percent sign is matched literally (TC-021).');
            System.assertEquals('100% Maine Maple', found[0].get('name'));
        }
    }

    @IsTest
    static void ownerSearchOffersActiveUsersAndThisObjectsQueues() {
        Group queue = new Group(Name = 'Coffin Wharf Dispatch', Type = 'Queue');
        System.runAs(new User(Id = UserInfo.getUserId())) {
            insert queue;
            insert new QueueSobject(
                QueueId = queue.Id,
                SobjectType = Consignment__c.SObjectType.getDescribe().getName()
            );
        }
        System.runAs(GridTestUsers.fullUser()) {
            List<Map<String, String>> found = GridLookup.search('Consignments', 'OwnerId', 'Coffin');
            Set<String> kinds = new Set<String>();
            Boolean queueFound = false;
            for (Map<String, String> r : found) {
                kinds.add(r.get('kind'));
                queueFound = queueFound || r.get('id') == queue.Id;
            }
            System.assert(kinds.contains('User'), 'The suite user is named Abigail Coffin: ' + found);
            System.assert(queueFound, 'A queue that accepts the object is offered: ' + found);
            for (Map<String, String> r : found) {
                System.assertEquals(r.get('kind') == 'Queue' ? 'Group' : 'User', r.get('object'), String.valueOf(r));
            }
        }
    }

    @IsTest
    static void onlyAnEditableLookupColumnOfTheGridCanBeSearched() {
        System.runAs(GridTestUsers.fullUser()) {
            for (String field : new List<String>{ 'Consignee__c', 'CreatedById', 'No_Such_Field__c' }) {
                try {
                    GridLookup.search('Consignments', field, 'Casco');
                    System.assert(false, 'Expected a refusal for ' + field);
                } catch (GridException e) {
                    System.assert(e.getMessage().contains('no editable lookup column'), e.getMessage());
                }
            }
        }
    }

    @IsTest
    static void theLimitedUserCannotSearchALookupItCannotSee() {
        System.runAs(GridTestUsers.limitedUser()) {
            try {
                GridLookup.search('Consignments', 'Shipper__c', 'Casco');
                System.assert(false, 'Shipper__c is not readable to the limited user.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('Shipper__c'), e.getMessage());
            }
        }
    }

    @IsTest
    static void rowsCarryTheNameAndSortAndSearchByIt() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Id> ids = accounts(new List<String>{ 'Wachusett Paper', 'Penobscot Paper' });
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Kraft liner, Worcester', Shipper__c = ids.get('Wachusett Paper')),
                new Consignment__c(Name = 'Newsprint rolls, Bangor', Shipper__c = ids.get('Penobscot Paper'))
            };
            Map<String, Object> result = GridController.fetchRows(
                'Consignments',
                'Paper',
                'Shipper__c',
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
            List<Map<String, Object>> rows = (List<Map<String, Object>>) result.get('rows');
            System.assertEquals(2, rows.size(), 'Quick search matches the lookup name.');
            System.assertEquals(
                'Newsprint rolls, Bangor',
                rows[0].get('Name'),
                'Sorted by the name shown, Penobscot before Wachusett.'
            );
            Map<String, String> labels = (Map<String, String>) rows[0].get('_labels');
            System.assertEquals('Penobscot Paper', labels.get('Shipper__c'));
            System.assertEquals(ids.get('Penobscot Paper'), rows[0].get('Shipper__c'), 'The value stays the Id.');
            System.assert(String.isNotBlank(labels.get('OwnerId')), 'The owner is named too.');
        }
    }

    @IsTest
    static void aLookupSavesOnlyAnIdOfItsTargetObject() {
        System.runAs(GridTestUsers.fullUser()) {
            Consignment__c rec = new Consignment__c(Name = 'Kennebec Lumber, 12 bundles');
            insert rec;
            GridSaveResult res = GridSaveService.save(
                'Consignments',
                new List<Map<String, Object>>{
                    new Map<String, Object>{ 'Id' => rec.Id, 'Shipper__c' => UserInfo.getUserId() }
                }
            );
            System.assertEquals(1, res.errors.size(), String.valueOf(res.errors));
            System.assertEquals('Shipper__c', res.errors[0].fieldName);
            System.assert(res.errors[0].message.contains('is not a Account record'), res.errors[0].message);
        }
    }

    @IsTest
    static void aFilteredLookupIsSaidSoWithItsApiName() {
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.Column filtered;
            GridConfig.Column plain;
            for (GridConfig.Column c : GridConfig.forUser('Consignment_Import').columns) {
                if (c.field == 'Bill_To__c') {
                    filtered = c;
                }
            }
            for (GridConfig.Column c : GridConfig.forUser('Consignments').columns) {
                if (c.field == 'Shipper__c') {
                    plain = c;
                }
            }
            System.assertEquals(true, filtered.filteredLookup, 'Bill_To__c has a lookup filter.');
            System.assert(filtered.fieldApiName.endsWith('Bill_To__c'), filtered.fieldApiName);
            System.assertEquals(false, plain.filteredLookup);
            System.assertEquals(null, plain.fieldApiName);
        }
    }

    @IsTest
    static void aLookupOffersNewForTargetsTheUserMayCreate() {
        System.runAs(GridTestUsers.fullUser()) {
            for (GridConfig.Column c : GridConfig.forUser('Consignments').columns) {
                if (c.field == 'Shipper__c') {
                    Boolean canCreate = Schema.Account.SObjectType.getDescribe().isCreateable();
                    System.assertEquals(canCreate, c.newTargets != null, String.valueOf(c.newTargets));
                    if (canCreate) {
                        System.assertEquals('Account', c.newTargets[0].get('object'));
                    }
                }
                if (c.field == 'OwnerId') {
                    System.assertEquals(null, c.newTargets, 'An owner is not created from its lookup.');
                }
            }
        }
    }

    @IsTest
    static void namesTheRecordALookupNowPointsTo() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Id> ids = accounts(new List<String>{ 'Saco River Outfitters' });
            Consignment__c other = new Consignment__c(Name = 'Reefer load, Machias');
            insert other;
            Test.startTest();
            String name = GridController.lookupName('Consignments', 'Shipper__c', ids.get('Saco River Outfitters'));
            String refused;
            try {
                GridController.lookupName('Consignments', 'Shipper__c', other.Id);
            } catch (AuraHandledException e) {
                refused = e.getMessage();
            }
            Test.stopTest();
            System.assertEquals('Saco River Outfitters', name);
            System.assert(refused != null && refused.contains('cannot be the value of'), refused);
        }
    }

    @IsTest
    static void namesFindTheirRecordsWhateverTheCaseAndSayWhenTwoShareOne() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Id> ids = accounts(
                new List<String>{ 'Casco Bay Marine', 'Kennebec Lumber', 'Kennebec Lumber', 'Monadnock Granite' }
            );
            Test.startTest();
            Map<String, List<Map<String, String>>> found = GridController.findLookupNames(
                'Consignments',
                'Shipper__c',
                new List<String>{ 'casco bay marine', 'Kennebec Lumber', 'Housatonic Hardware', '  ', null }
            );
            Test.stopTest();
            System.assertEquals(new Set<String>{ 'casco bay marine', 'kennebec lumber' }, found.keySet());
            System.assertEquals(1, found.get('casco bay marine').size());
            System.assertEquals(ids.get('Casco Bay Marine'), found.get('casco bay marine')[0].get('id'));
            System.assertEquals('Casco Bay Marine', found.get('casco bay marine')[0].get('name'));
            System.assertEquals(
                2,
                found.get('kennebec lumber').size(),
                'Two records of one name: both, so the browser can say so.'
            );
        }
    }

    @IsTest
    static void ownerNamesAreActiveUsersOrThisObjectsQueues() {
        System.runAs(GridTestUsers.fullUser()) {
            String me = [SELECT Name FROM User WHERE Id = :UserInfo.getUserId()].Name;
            Map<String, List<Map<String, String>>> found = GridLookup.namesFor(
                'Consignments',
                'OwnerId',
                new List<String>{ me }
            );
            System.assert(found.containsKey(me.toLowerCase()), String.valueOf(found));
            Boolean mine = false;
            for (Map<String, String> m : found.get(me.toLowerCase())) {
                mine = mine || m.get('id') == UserInfo.getUserId();
            }
            System.assert(mine, 'The user by name.');
        }
    }

    @IsTest
    static void namesAreLookedUpOnlyForAnEditableLookupColumnAndAFewAtATime() {
        System.runAs(GridTestUsers.fullUser()) {
            try {
                GridLookup.namesFor('Consignments', 'Consignee__c', new List<String>{ 'Casco Bay Marine' });
                System.assert(false, 'Not a lookup column.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('no editable lookup column'), e.getMessage());
            }
            List<String> many = new List<String>();
            for (Integer i = 0; i <= GridLookup.MAX_NAMES; i++) {
                many.add('Kennebec Lumber ' + i);
            }
            try {
                GridLookup.namesFor('Consignments', 'Shipper__c', many);
                System.assert(false, 'Too many names.');
            } catch (GridException e) {
                System.assert(e.getMessage().contains('At most'), e.getMessage());
            }
            System.assertEquals(0, GridLookup.namesFor('Consignments', 'Shipper__c', new List<String>()).size());
        }
    }
}
