/**
 * DEVELOPMENT ONLY. Never packaged.
 * Refusals at the object level, as a restricted user. The field tests prove a
 * column the user cannot read is left out; these prove the server refuses the
 * whole request when the user cannot read the grid's object at all, or can
 * read its records but not edit or create them, and that nothing is written.
 *
 *   limitedUser() cannot read Inspection__c (Freight_Limited_Access
 *   grants nothing on it). The Inspections grid is refused when it opens, when a
 *   page of its rows is read, when its groups are totalled and when its action
 *   (Inspections_Stamp, in test-data/config, whose Required Permission,
 *   Run_Freight_Actions, this user lacks too) is run: the object check
 *   refuses it first.
 *   readOnlyUser() reads Consignment__c but may not edit or create
 *   (Freight_Read_Only). On Consignments, which allows editing, import
 *   and new records, a save, an import of updates and of new records and new
 *   rows are each refused by the object permission, and the records are as
 *   they were.
 */
@IsTest
private class GridObjectAccessTest {
    private static final String NO_READ = 'You do not have access to Inspection__c.';
    private static final String NO_EDIT = 'You do not have permission to edit Consignment__c records.';
    private static final String NO_CREATE = 'You do not have permission to create Consignment__c records.';
    private static final String PROBE = 'Kraft paper, Bangor';

    @TestSetup
    static void setup() {
        GridTestUsers.limitedUser();
        GridTestUsers.readOnlyUser();
        System.runAs(GridTestUsers.fullUser()) {
            Id standard = Schema.SObjectType.Inspection__c.getRecordTypeInfosByDeveloperName()
                .get('Routine')
                .getRecordTypeId();
            insert new Inspection__c(Name = 'Trailer inspection, Bangor', RecordTypeId = standard, Status__c = 'New');
            insert new Consignment__c(Name = PROBE, Consignee__c = 'Penobscot Paper', Pieces__c = 7);
        }
    }

    // ---------------------------------------------------------------- helpers

    private static User limited() {
        return GridTestUsers.built(GridTestUsers.LIMITED);
    }

    private static User readOnly() {
        return GridTestUsers.built(GridTestUsers.READ_ONLY);
    }

    private static Id typedId() {
        Id found;
        System.runAs(GridTestUsers.built(GridTestUsers.FULL)) {
            found = [SELECT Id FROM Inspection__c WHERE Name = 'Trailer inspection, Bangor' LIMIT 1].Id;
        }
        return found;
    }

    /** The probe as it is now, read by a user who sees every field. */
    private static Consignment__c probe() {
        Consignment__c found;
        System.runAs(GridTestUsers.built(GridTestUsers.FULL)) {
            found = [
                SELECT Id, Consignee__c, Pieces__c
                FROM Consignment__c
                WHERE Name = :PROBE
                LIMIT 1
            ];
        }
        return found;
    }

    private static Integer recordCount() {
        Integer n;
        System.runAs(GridTestUsers.built(GridTestUsers.FULL)) {
            n = [SELECT COUNT() FROM Consignment__c];
        }
        return n;
    }

    /** What the attempt was refused with, or null when it was not refused. */
    private static String refusal(System.Callable attempt) {
        try {
            attempt.call(null, null);
        } catch (GridException e) {
            return e.getMessage();
        } catch (AuraHandledException e) {
            return e.getMessage();
        }
        return null;
    }

    /** One request the grid could make, so each can be tried in turn. */
    private class Attempt implements System.Callable {
        private final String kind;
        private final Id recordId;
        Attempt(String kind, Id recordId) {
            this.kind = kind;
            this.recordId = recordId;
        }
        public Object call(String action, Map<String, Object> args) {
            switch on kind {
                when 'forUser' {
                    return GridConfig.forUser('Inspections');
                }
                when 'openGrid' {
                    return GridController.openGrid('Inspections', null, null, null, null, null);
                }
                when 'fetchRows' {
                    return GridController.fetchRows(
                        'Inspections',
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
                }
                when 'fetchRowsById' {
                    return GridController.fetchRowsById('Inspections', new List<Id>{ recordId });
                }
                when 'fetchPage' {
                    return GridDataService.fetchPage(
                        new GridRequest('Inspection__c', new List<String>{ 'Name', 'Status__c' }, null, 50)
                    );
                }
                when 'summarize' {
                    return GridGroupService.summarize('Inspections', null, new List<String>{ 'Status__c' }, null, null);
                }
                when 'summarizeGroups' {
                    return GridController.summarizeGroups(
                        'Inspections',
                        null,
                        new List<String>{ 'Status__c' },
                        null,
                        null,
                        null,
                        null,
                        null,
                        null,
                        null
                    );
                }
                when 'run' {
                    return GridActionService.run('Inspections', 'Inspections_Stamp', new List<Id>{ recordId });
                }
                when 'runAction' {
                    return GridController.runAction('Inspections', 'Inspections_Stamp', new List<Id>{ recordId });
                }
                when 'save' {
                    return GridSaveService.save(
                        'Consignments',
                        new List<Map<String, Object>>{
                            new Map<String, Object>{ 'Id' => recordId, 'Consignee__c' => 'Androscoggin Pulp' }
                        }
                    );
                }
                when 'importUpdate' {
                    return GridImportService.importRows(
                        'Consignments',
                        new List<Map<String, Object>>{
                            new Map<String, Object>{ 'Id' => recordId, 'Consignee__c' => 'Blackstone Valley Textiles' }
                        }
                    );
                }
                when 'importCreate' {
                    return GridImportService.importRows(
                        'Consignments',
                        new List<Map<String, Object>>{
                            new Map<String, Object>{
                                'Name' => 'Apple crates, Springfield',
                                'Consignee__c' => 'Pioneer Valley Orchards'
                            }
                        }
                    );
                }
                when 'create' {
                    return GridCreateService.create('Consignments', newRow(), null, null, null);
                }
                when else {
                    return GridController.createRows('Consignments', newRow(), null, null, null);
                }
            }
        }
    }

    private static List<Map<String, Object>> newRow() {
        return new List<Map<String, Object>>{
            new Map<String, Object>{
                'key' => 'rh-new-1',
                'Name' => 'Cider barrels, Springfield',
                'Consignee__c' => 'Pioneer Valley Orchards'
            }
        };
    }

    // ------------------------------------------------- an object the user cannot read

    @IsTest
    static void aUserWhoCannotReadTheObjectIsNotGivenTheGrid() {
        Id typed = typedId();
        System.runAs(limited()) {
            System.assert(
                !GridSecurity.canRead(Inspection__c.SObjectType),
                'Freight_Limited_Access grants nothing on Inspection__c, or this test proves nothing.'
            );
            System.assertEquals(NO_READ, refusal(new Attempt('forUser', typed)), 'GridConfig.forUser');
            System.assertEquals(NO_READ, refusal(new Attempt('openGrid', typed)), 'GridController.openGrid');
        }
    }

    @IsTest
    static void aUserWhoCannotReadTheObjectGetsNoRows() {
        Id typed = typedId();
        System.runAs(limited()) {
            System.assertEquals(NO_READ, refusal(new Attempt('fetchRows', typed)), 'A page of rows.');
            System.assertEquals(NO_READ, refusal(new Attempt('fetchRowsById', typed)), 'Rows read again by Id.');
            System.assertEquals(
                NO_READ,
                refusal(new Attempt('fetchPage', typed)),
                'GridDataService itself refuses the object, whoever asks.'
            );
        }
    }

    @IsTest
    static void aUserWhoCannotReadTheObjectGetsNoGroupCountsOrTotals() {
        Id typed = typedId();
        System.runAs(limited()) {
            System.assertEquals(NO_READ, refusal(new Attempt('summarize', typed)), 'GridGroupService.summarize');
            System.assertEquals(
                NO_READ,
                refusal(new Attempt('summarizeGroups', typed)),
                'GridController.summarizeGroups'
            );
        }
    }

    @IsTest
    static void aUserWhoCannotReadTheObjectCannotRunItsAction() {
        Id typed = typedId();
        System.runAs(GridTestUsers.built(GridTestUsers.FULL)) {
            Boolean offered = false;
            for (GridConfig.Action a : GridConfig.forUser('Inspections').actions) {
                offered = offered || a.name == 'Inspections_Stamp';
            }
            System.assert(offered, 'The fixture action works for a user who can read the object.');
        }
        System.runAs(limited()) {
            Integer dml = Limits.getDmlStatements();
            System.assertEquals(NO_READ, refusal(new Attempt('run', typed)), 'GridActionService.run');
            System.assertEquals(NO_READ, refusal(new Attempt('runAction', typed)), 'GridController.runAction');
            System.assertEquals(dml, Limits.getDmlStatements(), 'Nothing was run, so nothing was written.');
        }
    }

    // ------------------------------------------------- an object the user can only read

    @IsTest
    static void aUserWhoCanOnlyReadIsOfferedNothingThatWrites() {
        System.runAs(readOnly()) {
            GridConfig.Definition def = GridConfig.forUser('Consignments');
            System.assertEquals(false, def.allowImport, 'Consignments allows import; this user may not edit.');
            System.assertEquals(
                false,
                def.allowNewRecords,
                'Consignments allows new records; this user may not create.'
            );
            System.assertEquals(false, def.allowMassDelete, 'Consignments allows delete; this user may not delete.');
            System.assert(!def.columns.isEmpty(), 'The user reads the grid.');
            for (GridConfig.Column c : def.columns) {
                System.assertEquals(false, c.editable, c.field + ' is offered for editing.');
                System.assertEquals(false, c.creatable, c.field + ' is offered on a new row.');
            }
            Map<String, Object> page = GridController.fetchRows(
                'Consignments',
                PROBE,
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
            System.assertEquals(
                1,
                ((List<Map<String, Object>>) page.get('rows')).size(),
                'The user can read the records, so the refusals below are about writing.'
            );
        }
    }

    @IsTest
    static void aUserWhoCanOnlyReadCannotSave() {
        Consignment__c before = probe();
        System.runAs(readOnly()) {
            Test.startTest();
            Integer dml = Limits.getDmlStatements();
            Integer jobs = Limits.getQueueableJobs();
            System.assertEquals(NO_EDIT, refusal(new Attempt('save', before.Id)));
            System.assertEquals(dml, Limits.getDmlStatements(), 'No DML in the refused call.');
            System.assertEquals(jobs, Limits.getQueueableJobs(), 'No chunk was queued.');
            Test.stopTest();
        }
        Consignment__c after = probe();
        System.assertEquals('Penobscot Paper', after.Consignee__c, 'Nothing was saved.');
    }

    @IsTest
    static void aUserWhoCanOnlyReadCannotImportUpdatesOrNewRecords() {
        Consignment__c before = probe();
        Integer count = recordCount();
        System.runAs(readOnly()) {
            Integer dml = Limits.getDmlStatements();
            System.assertEquals(NO_EDIT, refusal(new Attempt('importUpdate', before.Id)), 'An import of updates.');
            System.assertEquals(NO_CREATE, refusal(new Attempt('importCreate', null)), 'An import of new records.');
            System.assertEquals(dml, Limits.getDmlStatements(), 'Neither batch wrote anything.');
        }
        System.assertEquals('Penobscot Paper', probe().Consignee__c, 'Not imported over.');
        System.assertEquals(count, recordCount(), 'No record was created.');
    }

    @IsTest
    static void aUserWhoCanOnlyReadCannotAddNewRows() {
        Integer count = recordCount();
        System.runAs(readOnly()) {
            Integer dml = Limits.getDmlStatements();
            System.assertEquals(NO_CREATE, refusal(new Attempt('create', null)), 'GridCreateService.create');
            System.assertEquals(NO_CREATE, refusal(new Attempt('createRows', null)), 'GridController.createRows');
            System.assertEquals(dml, Limits.getDmlStatements(), 'Nothing was inserted.');
        }
        System.assertEquals(count, recordCount(), 'No record was created.');
    }
}
