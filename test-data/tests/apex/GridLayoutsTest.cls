/**
 * DEVELOPMENT ONLY. Never packaged.
 * Each user's layout of a grid: kept, read back, replaced, reset, and
 * each user's own. 'Consignments' is a fixture configuration (test-data/config).
 */
@IsTest
private class GridLayoutsTest {
    private static final String LAYOUT = '{"v":1,"widths":{"Name":180},"wrap":{"Consignee__c":true}}';

    @IsTest
    static void aLayoutIsKeptReadBackReplacedAndReset() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals(null, GridLayouts.read('Consignments', null), 'Nothing kept yet.');
            System.assertEquals(true, GridController.saveLayout('Consignments', LAYOUT, null));
            System.assertEquals(LAYOUT, GridLayouts.read('consignments', null), 'The grid\'s name in any case.');

            String changed = '{"v":1,"sort":[{"field":"Name","direction":"desc"}]}';
            GridController.saveLayout('Consignments', changed, null);
            System.assertEquals(changed, GridLayouts.read('Consignments'));
            System.assertEquals(
                1,
                [SELECT COUNT() FROM Grid_User_Layout__c],
                'One record per user per grid: the save upserts.'
            );
            Grid_User_Layout__c kept = [SELECT Name, Key__c, OwnerId FROM Grid_User_Layout__c];
            System.assertEquals('Consignments', kept.Name);
            System.assertEquals(UserInfo.getUserId(), kept.OwnerId, 'The user owns it.');
            System.assertEquals(UserInfo.getUserId() + ':Consignments', kept.Key__c);

            GridController.resetLayout('Consignments', null);
            System.assertEquals(null, GridLayouts.read('Consignments', null), 'Reset layout forgets it.');
            GridController.resetLayout('Consignments', null); // nothing to forget: no harm
        }
    }

    @IsTest
    static void eachUserHasTheirOwn() {
        User a = GridTestUsers.fullUser();
        User b = GridTestUsers.limitedUser();
        System.runAs(a) {
            GridLayouts.save('Consignments', LAYOUT);
        }
        System.runAs(b) {
            System.assertEquals(null, GridLayouts.read('Consignments'), 'Another user\'s layout is not this user\'s.');
            GridLayouts.save('Consignments', '{"v":1}');
            System.assertEquals('{"v":1}', GridLayouts.read('Consignments'));
        }
        System.runAs(a) {
            System.assertEquals(LAYOUT, GridLayouts.read('Consignments'), 'Unchanged by the other user\'s save.');
        }
    }

    @IsTest
    static void noOneCanTakeAnotherUsersKey() {
        User a = GridTestUsers.fullUser();
        User b = GridTestUsers.limitedUser();
        System.runAs(b) {
            try {
                insert new Grid_User_Layout__c(
                    Name = 'Consignments',
                    Key__c = a.Id + ':Consignments',
                    Layout__c = '{"v":1}'
                );
                System.assert(false, 'A Key must start with its owner\'s Id.');
            } catch (DmlException e) {
                System.assert(e.getMessage().contains('owner\'s user Id'), e.getMessage());
            }
        }
        System.runAs(a) {
            System.assertEquals(true, GridLayouts.save('Consignments', LAYOUT), 'The owner\'s own layout is kept.');
            System.assertEquals(LAYOUT, GridLayouts.read('Consignments'));
        }
    }

    @IsTest
    static void onlyALayoutOfAGridThatExistsIsKept() {
        System.runAs(GridTestUsers.fullUser()) {
            List<String> refusals = new List<String>();
            for (
                List<String> bad : new List<List<String>>{
                    new List<String>{ 'Consignment_Rerate', LAYOUT },
                    new List<String>{ 'Consignments', 'not json' },
                    new List<String>{ 'Consignments', '[1,2]' },
                    new List<String>{ 'Consignments', '' },
                    new List<String>{ 'Consignments', '{"search":"' + 'Bangor '.repeat(GridLayouts.MAX_LENGTH) + '"}' }
                }
            ) {
                try {
                    GridLayouts.save(bad[0], bad[1]);
                    refusals.add('kept');
                } catch (GridException e) {
                    refusals.add(e.getMessage());
                }
            }
            System.assert(refusals[0].contains('No Grid Configuration'), refusals[0]);
            System.assert(refusals[1].contains('JSON'), refusals[1]);
            System.assert(refusals[2].contains('JSON object'), refusals[2]);
            System.assert(refusals[3].contains('no layout'), refusals[3]);
            System.assert(refusals[4].contains('at most'), refusals[4]);
            System.assertEquals(0, [SELECT COUNT() FROM Grid_User_Layout__c]);
        }
    }

    // ------------------------------------------- the first page's sort and grouping

    /** A grid in hand: sorted by Name, grouped by Stage by the admin. */
    private static GridConfig.Definition grid() {
        GridConfig.Definition d = new GridConfig.Definition();
        d.sortField = 'Name';
        d.sortDirection = 'asc';
        d.columns.add(column('Name', 'text', true, false));
        d.columns.add(column('Stage__c', 'picklist', true, true));
        d.columns.add(column('Close__c', 'date', true, true));
        d.columns.add(column('Notes__c', 'textarea', false, false));
        d.columns.add(column('Done__c', 'checkbox', true, true));
        d.columns.add(column('Owner__c', 'reference', true, true));
        d.grouping.add(new Map<String, String>{ 'field' => 'Stage__c', 'unit' => null });
        return d;
    }

    private static GridConfig.Column column(String field, String type, Boolean sortable, Boolean groupable) {
        GridConfig.Column c = new GridConfig.Column();
        c.field = field;
        c.type = type;
        c.sortable = sortable;
        c.groupable = groupable;
        return c;
    }

    private static Map<String, Object> start(String sortField, String sortDirection, List<String> groupBy) {
        return new Map<String, Object>{
            'sortField' => sortField,
            'sortDirection' => sortDirection,
            'thenSort' => new List<Map<String, Object>>(),
            'groupBy' => groupBy
        };
    }

    private static Map<String, Object> key(String field, String direction) {
        return new Map<String, Object>{ 'field' => field, 'direction' => direction };
    }

    @IsTest
    static void theAdminsSortsAfterTheFirstComeWithIt() {
        GridConfig.Definition d = grid();
        d.thenSort.add(new Map<String, String>{ 'field' => 'Close__c', 'direction' => 'desc' });
        Map<String, Object> admin = GridLayouts.startOf(d, null);
        System.assertEquals('Name', admin.get('sortField'));
        System.assertEquals(new List<Map<String, Object>>{ key('Close__c', 'desc') }, admin.get('thenSort'));
        System.assertEquals(
            admin.get('thenSort'),
            GridLayouts.startOf(d, '{"v":1,"grouping":[]}').get('thenSort'),
            'A layout without a sort follows the admin\'s.'
        );
        System.assertEquals(
            new List<Map<String, Object>>(),
            GridLayouts.startOf(d, '{"sort":[{"field":"Done__c","direction":"desc"}]}').get('thenSort'),
            'A user\'s own sort replaces every level of the admin\'s.'
        );
    }

    @IsTest
    static void theLayoutsSortKeepsEveryKeyThatStillFitsUpToFive() {
        Map<String, Object> s = GridLayouts.startOf(
            grid(),
            '{"sort":[{"field":"Gone__c"},{"field":"Close__c","direction":"desc"},{"field":"Notes__c"},{"field":"Name"},{"field":"Done__c","direction":"desc"},{"field":"Stage__c"},{"field":"Owner__c"}]}'
        );
        System.assertEquals('Close__c', s.get('sortField'));
        System.assertEquals('desc', s.get('sortDirection'));
        System.assertEquals(
            new List<Map<String, Object>>{
                key('Name', 'asc'),
                key('Done__c', 'desc'),
                key('Stage__c', 'asc'),
                key('Owner__c', 'asc')
            },
            s.get('thenSort'),
            'Unknown and unsortable keys passed over; five in all.'
        );
    }

    @IsTest
    static void withoutALayoutTheGridOpensAsTheAdminSetIt() {
        Map<String, Object> admin = start('Name', 'asc', new List<String>{ 'Stage__c' });
        for (
            String none : new List<String>{
                null,
                '',
                'not json',
                '[1,2]',
                '"Consignments"',
                '{"v":1}',
                '{"sort":"Name","grouping":{}}'
            }
        ) {
            System.assertEquals(admin, GridLayouts.startOf(grid(), none), 'Layout: ' + none);
        }
        GridConfig.Definition unsorted = grid();
        unsorted.sortField = null;
        System.assertEquals(
            start(null, null, new List<String>{ 'Stage__c' }),
            GridLayouts.startOf(unsorted, null),
            'No sort anywhere: none, as fetchRows then has none.'
        );
    }

    @IsTest
    static void theLayoutsSortIsItsFirstKeyThatStillFits() {
        GridConfig.Definition d = grid();
        System.assertEquals(
            'Close__c',
            GridLayouts.startOf(d, '{"sort":[{"field":"Close__c","direction":"desc"},{"field":"Name"}]}')
                .get('sortField')
        );
        System.assertEquals(
            'desc',
            GridLayouts.startOf(d, '{"sort":[{"field":"Close__c","direction":"desc"}]}').get('sortDirection')
        );
        System.assertEquals(
            'asc',
            GridLayouts.startOf(d, '{"sort":[{"field":"Close__c","direction":"DESC"}]}').get('sortDirection'),
            'Only "desc" is descending, as in the browser.'
        );
        Map<String, Object> passedOver = GridLayouts.startOf(
            d,
            '{"sort":[{"field":"Gone__c","direction":"desc"},{"field":"Notes__c","direction":"desc"},{"field":"name"},5,{"field":"Done__c","direction":"desc"}]}'
        );
        System.assertEquals(
            'Done__c',
            passedOver.get('sortField'),
            'Unknown, unsortable, wrongly spelt and not keys are passed over.'
        );
        System.assertEquals(
            'Name',
            GridLayouts.startOf(d, '{"sort":[{"field":"Gone__c"}]}').get('sortField'),
            'None left: the admin\'s.'
        );
        System.assertEquals(
            'Name',
            GridLayouts.startOf(d, '{"sort":[]}').get('sortField'),
            'No sort: the server\'s, the admin\'s.'
        );
    }

    @IsTest
    static void theLayoutsGroupingIsWhatStillFits() {
        GridConfig.Definition d = grid();
        System.assertEquals(
            new List<String>(),
            GridLayouts.startOf(d, '{"grouping":[]}').get('groupBy'),
            'An empty grouping is none.'
        );
        System.assertEquals(
            new List<String>{ 'Stage__c' },
            GridLayouts.startOf(d, '{"grouping":[{"field":"Notes__c"}]}').get('groupBy'),
            'None of its levels left: the admin\'s.'
        );
        System.assertEquals(
            new List<String>{ 'Close__c:quarter', 'Owner__c', 'Done__c' },
            GridLayouts.startOf(
                    d,
                    '{"grouping":[{"field":"Close__c","unit":"quarter"},{"field":"Notes__c"},{"field":"Owner__c","unit":"year"},' +
                    '{"field":"Close__c"},{"field":"Done__c"},{"field":"Stage__c"}]}'
                )
                .get('groupBy'),
            'Ungroupable and repeated levels passed over, a unit only for a date, three levels at most.'
        );
        System.assertEquals(
            new List<String>{ 'Close__c:month' },
            GridLayouts.startOf(d, '{"grouping":[{"field":"Close__c","unit":"decade"}]}').get('groupBy'),
            'A date by an unknown unit is by month.'
        );
        System.assertEquals(
            new List<String>{ 'Close__c:month' },
            GridLayouts.startOf(d, '{"grouping":[{"field":"Close__c"}]}').get('groupBy')
        );
    }

    @IsTest
    static void aUserWithoutAccessGetsNoLayoutAndTheGridWorksOn() {
        System.runAs(GridTestUsers.noLogUser()) {
            System.assertEquals(null, GridLayouts.read('Consignments'), 'No Rowhouse Grid User: no layout, no error.');
            System.assertEquals(false, GridLayouts.save('Consignments', LAYOUT));
            GridLayouts.reset('Consignments');
        }
    }
}
