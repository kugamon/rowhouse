/**
 * DEVELOPMENT ONLY. Never packaged.
 * The sort a grid opens with: Default Sort Field and Default Sort Direction,
 * then up to four more in Then Sort By ("Pieces__c DESC, Name ASC"), each a
 * column the grid can sort by. Read with the grid's own code (GridConfig.build)
 * from records in memory; narrowed for a user who cannot read a field.
 */
@IsTest
private class GridSortTest {
    /** A grid of consignments with four sortable columns and one that is not. */
    private static GridConfig.Definition grid(String sortField, String sortDirection, String thenSortBy) {
        return GridConfig.build(
            new Grid_Configuration__mdt(
                DeveloperName = 'Sorted',
                MasterLabel = 'Sorted',
                Object_API_Name__c = 'Consignment__c',
                Default_Sort_Field__c = sortField,
                Default_Sort_Direction__c = sortDirection,
                Then_Sort_By__c = thenSortBy
            ),
            new List<Grid_Column__mdt>{
                column('Name', 10, true),
                column('Consignee__c', 20, true),
                column('Pieces__c', 30, true),
                column('Ship_Date__c', 40, true),
                column('Mode__c', 50, true),
                column('Carrier_Code__c', 60, true),
                column('Pro_Number__c', 70, false)
            },
            new List<Grid_Display_Rule__mdt>(),
            new List<Grid_Child_Table__mdt>(),
            new List<Grid_Action__mdt>()
        );
    }

    private static Grid_Column__mdt column(String field, Integer order, Boolean sortable) {
        return new Grid_Column__mdt(
            DeveloperName = field.replace('__c', ''),
            Field_API_Name__c = field,
            Sort_Order__c = order,
            Sortable__c = sortable
        );
    }

    private static Map<String, String> level(String field, String direction) {
        return new Map<String, String>{ 'field' => field, 'direction' => direction };
    }

    private static Boolean warned(GridConfig.Definition def, String part) {
        for (String w : def.warnings) {
            if (w.startsWith('Then Sort By: ') && w.contains(part)) {
                return true;
            }
        }
        return false;
    }

    @IsTest
    static void thenSortByAddsTheSortsAfterTheFirstInOrder() {
        GridConfig.Definition def = grid('Consignee__c', 'asc', 'Pieces__c DESC, Name');
        System.assertEquals('Consignee__c', def.sortField);
        System.assertEquals('asc', def.sortDirection);
        System.assertEquals(
            new List<Map<String, String>>{ level('Pieces__c', 'desc'), level('Name', 'asc') },
            def.thenSort,
            'In order; ASC unless DESC is given.'
        );
        System.assert(def.warnings.isEmpty(), String.valueOf(def.warnings));
    }

    @IsTest
    static void aGridWithoutThenSortBySortsAsBefore() {
        GridConfig.Definition def = grid('Name', 'desc', null);
        System.assertEquals('Name', def.sortField);
        System.assertEquals('desc', def.sortDirection);
        System.assertEquals(new List<Map<String, String>>(), def.thenSort);
    }

    @IsTest
    static void aSortThatDoesNotFitIsSkippedWithAWarning() {
        GridConfig.Definition def = grid(
            'Name',
            'asc',
            'Gone__c DESC, Pieces__c sideways, pieces__c desc, Pro_Number__c, name DESC, , Mode__c'
        );
        System.assertEquals(
            new List<Map<String, String>>{ level('Pieces__c', 'desc'), level('Mode__c', 'asc') },
            def.thenSort,
            'A column\'s own spelling; blanks passed over.'
        );
        System.assert(warned(def, 'Gone__c is not a column'), String.valueOf(def.warnings));
        System.assert(
            warned(def, '"Pieces__c sideways" is not a field followed by ASC or DESC'),
            String.valueOf(def.warnings)
        );
        System.assert(warned(def, 'Pro_Number__c is not a column'), 'Sortable not selected: ' + def.warnings);
        System.assert(warned(def, 'name is already in the sort'), String.valueOf(def.warnings));
    }

    @IsTest
    static void aGridSortsByFiveFieldsAtMost() {
        GridConfig.Definition def = grid(
            'Name',
            'asc',
            'Consignee__c, Pieces__c, Ship_Date__c, Mode__c, Carrier_Code__c'
        );
        System.assertEquals(GridConfig.MAX_SORT_LEVELS - 1, def.thenSort.size());
        System.assertEquals('Mode__c', def.thenSort[3].get('field'));
        System.assert(warned(def, 'up to 5 fields, so Carrier_Code__c'), String.valueOf(def.warnings));
    }

    @IsTest
    static void withoutADefaultSortFieldTheFirstThenSortTakesItsPlace() {
        GridConfig.Definition def = grid(null, null, 'Pieces__c DESC, Name');
        System.assertEquals('Pieces__c', def.sortField);
        System.assertEquals('desc', def.sortDirection);
        System.assertEquals(new List<Map<String, String>>{ level('Name', 'asc') }, def.thenSort);
    }

    @IsTest
    static void theSortsAreReadAndWrittenAsAnOrderBy() {
        List<Map<String, String>> levels = GridConfig.parseSortLevels(' LastModifiedDate desc ,CloseDate,Name ASC ');
        System.assertEquals(
            new List<Map<String, String>>{
                level('LastModifiedDate', 'desc'),
                level('CloseDate', 'asc'),
                level('Name', 'asc')
            },
            levels
        );
        System.assertEquals('LastModifiedDate DESC, CloseDate ASC, Name ASC', GridConfig.formatSortLevels(levels));
        System.assertEquals(null, GridConfig.formatSortLevels(new List<Map<String, String>>()));
        System.assertEquals(null, GridConfig.formatSortLevels(null));
        System.assertEquals(new List<Map<String, String>>(), GridConfig.parseSortLevels('  '));
        System.assertEquals(
            new List<Map<String, String>>{ new Map<String, String>{ 'error' => 'Name ASC NULLS LAST' } },
            GridConfig.parseSortLevels('Name ASC NULLS LAST')
        );
    }

    @IsTest
    static void aSortOnAFieldTheUserCannotReadIsLeftOutAndTheRestMoveUp() {
        GridConfig.Definition def = new GridConfig.Definition();
        def.sortField = 'Picked_Up__c';
        def.sortDirection = 'asc';
        def.thenSort.add(level('Pieces__c', 'desc'));
        def.thenSort.add(level('Name', 'asc'));
        System.runAs(GridTestUsers.limitedUser()) {
            GridConfig.narrowSort(def, Consignment__c.SObjectType);
        }
        System.assertEquals('Pieces__c', def.sortField, 'limitedUser() cannot read Picked_Up__c.');
        System.assertEquals('desc', def.sortDirection);
        System.assertEquals(new List<Map<String, String>>{ level('Name', 'asc') }, def.thenSort);

        GridConfig.Definition full = new GridConfig.Definition();
        full.sortField = 'Picked_Up__c';
        full.sortDirection = 'asc';
        full.thenSort.add(level('Pieces__c', 'desc'));
        System.runAs(GridTestUsers.fullUser()) {
            GridConfig.narrowSort(full, Consignment__c.SObjectType);
        }
        System.assertEquals('Picked_Up__c', full.sortField, 'A user who can read it keeps it.');
        System.assertEquals(1, full.thenSort.size());
    }
}
