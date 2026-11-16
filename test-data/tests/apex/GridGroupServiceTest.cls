/**
 * DEVELOPMENT ONLY. Never packaged.
 * Grouping and subtotals: the Consignments_By_Mode configuration groups by Service Level
 * and then Ship Date by quarter, and carries one column for each kind of subtotal.
 * The field-level security case is in GridSecurityTest.
 */
@IsTest
private class GridGroupServiceTest {
    private static final String CONFIG = 'Consignments_By_Mode';

    /** Five records: three Economy (two in Q1, one in Q2), one Standard, one with no service level or date. */
    private static List<Consignment__c> seed() {
        List<Consignment__c> rows = new List<Consignment__c>{
            new Consignment__c(
                Name = 'Boat fittings, Rockland',
                Service_Level__c = 'Economy',
                Ship_Date__c = Date.newInstance(2026, 1, 15),
                Pieces__c = 10,
                Freight_Charge__c = 100,
                Consignee__c = 'Casco Bay Marine',
                Picked_Up__c = Datetime.newInstanceGmt(2026, 1, 15, 12, 0, 0)
            ),
            new Consignment__c(
                Name = 'Canned goods, Lewiston',
                Service_Level__c = 'Economy',
                Ship_Date__c = Date.newInstance(2026, 2, 20),
                Pieces__c = 5,
                Freight_Charge__c = 50,
                Picked_Up__c = Datetime.newInstanceGmt(2026, 2, 20, 12, 0, 0)
            ),
            new Consignment__c(
                Name = 'Maple syrup, Burlington',
                Service_Level__c = 'Economy',
                Ship_Date__c = Date.newInstance(2026, 5, 1),
                Freight_Charge__c = 30,
                Consignee__c = 'Green Mountain Maple'
            ),
            new Consignment__c(
                Name = 'Seed potatoes, Presque Isle',
                Service_Level__c = 'Standard',
                Ship_Date__c = Date.newInstance(2026, 3, 31),
                Pieces__c = 7,
                Freight_Charge__c = 70,
                Consignee__c = 'Merrimack Valley Foods'
            ),
            new Consignment__c(Name = 'Empty pallets, Bangor', Pieces__c = 1)
        };
        insert rows;
        return rows;
    }

    /** The group whose keys are these, or null. */
    private static Map<String, Object> groupFor(GridGroupService.Result result, List<String> keys) {
        for (Map<String, Object> g : result.groups) {
            if (String.valueOf(g.get('k')) == String.valueOf(keys)) {
                return g;
            }
        }
        return null;
    }

    private static Object value(Map<String, Object> g, String field, String part) {
        return ((Map<String, Object>) ((Map<String, Object>) g.get('v')).get(field)).get(part);
    }

    /** A decimal-string subtotal as a number: the platform may send 15 as "15.0". */
    private static Decimal number(Map<String, Object> g, String field, String part) {
        Object v = value(g, field, part);
        return v == null ? null : Decimal.valueOf((String) v);
    }

    private static String refusal(List<String> grouping, String fromId, String toId) {
        try {
            GridGroupService.summarize(CONFIG, null, grouping, fromId, toId);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void readsTheDefaultGroupingAndSubtotalsAndWarnsAboutWhatCannotWork() {
        GridConfig.Definition def = GridConfig.load(CONFIG);
        System.assertEquals(2, def.grouping.size(), String.valueOf(def.grouping));
        System.assertEquals('Service_Level__c', def.grouping[0].get('field'));
        System.assertEquals(null, def.grouping[0].get('unit'));
        System.assertEquals('Ship_Date__c', def.grouping[1].get('field'));
        System.assertEquals('quarter', def.grouping[1].get('unit'));
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            byField.put(c.field, c);
        }
        System.assertEquals('sum', byField.get('Pieces__c').subtotal);
        System.assertEquals('average', byField.get('Freight_Charge__c').subtotal);
        System.assertEquals('max', byField.get('Ship_Date__c').subtotal);
        System.assertEquals('min', byField.get('Picked_Up__c').subtotal);
        System.assertEquals('count', byField.get('Consignee__c').subtotal);
        System.assertEquals(null, byField.get('Delivered__c').subtotal, 'A checkbox cannot be summed.');
        System.assert(byField.get('Service_Level__c').groupable);
        System.assert(byField.get('Picked_Up__c').groupable, 'A date/time groups by its day, month, quarter or year.');
        System.assert(byField.get('Shipper__c').groupable);
        System.assert(!byField.get('Pieces__c').groupable, 'A number is summed, not grouped.');
        // Grouping is offered where values repeat: not by a name or a note.
        System.assert(!byField.get('Name').groupable, 'A group per row is no grouping.');
        // Text is offered when the admin groups by it, or allows grouping by it.
        System.assert(byField.get('Consignee__c').groupable, 'Consignments_By_Mode_Consignee has Allow Grouping.');
        System.assert(byField.get('Delivered__c').groupable);
        String warnings = String.join(def.warnings, '\n');
        System.assert(warnings.contains('Grid Column Consignments_By_Mode_Pieces: the grid cannot group by'), warnings);
        System.assert(
            warnings.contains('Grid Column Consignments_By_Mode_Delivered: a sum subtotal does not apply to'),
            warnings
        );
        System.assert(
            warnings.contains('Grid Column Consignments_By_Mode_Pieces: Allow Grouping does not apply to'),
            warnings
        );
    }

    @IsTest
    static void countsAndTotalsEveryGroupOfEveryLevel() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result result = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Service_Level__c', 'Ship_Date__c:quarter' },
                null,
                null
            );
            Test.stopTest();
            System.assertEquals(4, result.groups.size(), String.valueOf(result.groups));
            System.assertEquals(null, result.boundaries, 'Five records need no slices.');
            Map<String, Object> q1 = groupFor(result, new List<String>{ 'Economy', '2026-Q1' });
            System.assertEquals(2, q1.get('n'));
            System.assert(number(q1, 'Pieces__c', 's') == 15, String.valueOf(q1));
            System.assert(number(q1, 'Freight_Charge__c', 's') == 150, String.valueOf(q1));
            System.assertEquals(2, value(q1, 'Freight_Charge__c', 'c'), 'An average travels as a sum and a count.');
            System.assertEquals('2026-02-20', value(q1, 'Ship_Date__c', 'mx'));
            System.assertEquals('2026-01-15T12:00:00.000Z', value(q1, 'Picked_Up__c', 'mn'));
            System.assertEquals(1, value(q1, 'Consignee__c', 'c'), 'Count counts values, not records.');
            Map<String, Object> q2 = groupFor(result, new List<String>{ 'Economy', '2026-Q2' });
            System.assertEquals(1, q2.get('n'));
            System.assertEquals(null, value(q2, 'Pieces__c', 's'), 'A sum of nothing is blank, not zero.');
            System.assertEquals(1, groupFor(result, new List<String>{ 'Standard', '2026-Q1' }).get('n'));
            System.assertEquals(
                1,
                groupFor(result, new List<String>{ '', '' }).get('n'),
                'Blank is a group of its own.'
            );
            // Lightning drops null elements from a list on its way to the
            // browser, so a blank is '' and every group has one key per level.
            for (Map<String, Object> g : result.groups) {
                List<String> keys = (List<String>) g.get('k');
                List<String> labels = (List<String>) g.get('l');
                System.assertEquals(2, keys.size(), String.valueOf(g));
                System.assertEquals(2, labels.size(), String.valueOf(g));
                System.assert(!keys.contains(null) && !labels.contains(null), String.valueOf(g));
            }
        }
    }

    @IsTest
    static void totalsEverythingWhenNotGrouped() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridGroupService.Result result = GridGroupService.summarize(CONFIG, null, null, null, null);
            System.assertEquals(1, result.groups.size());
            System.assertEquals(5, result.groups[0].get('n'));
            System.assert(number(result.groups[0], 'Pieces__c', 's') == 23, String.valueOf(result.groups[0]));
            System.assertEquals(new List<String>(), result.groups[0].get('k'));
        }
    }

    @IsTest
    static void groupsDatesAndDateTimesByTheUnitAsked() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridGroupService.Result months = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:month' },
                null,
                null
            );
            System.assertEquals(5, months.groups.size(), String.valueOf(months.groups));
            System.assertEquals(1, groupFor(months, new List<String>{ '2026-01' }).get('n'), 'Months are two digits.');
            System.assertEquals(1, groupFor(months, new List<String>{ '2026-05' }).get('n'));
            GridGroupService.Result years = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:year' },
                null,
                null
            );
            System.assertEquals(4, groupFor(years, new List<String>{ '2026' }).get('n'));
            GridGroupService.Result byDefault = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c' },
                null,
                null
            );
            System.assertNotEquals(
                null,
                groupFor(byDefault, new List<String>{ '2026-03' }),
                'A date with no unit groups by month.'
            );
            // Noon GMT is the same day in any time zone a person works in.
            GridGroupService.Result days = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Picked_Up__c:day' },
                null,
                null
            );
            System.assertEquals(
                1,
                groupFor(days, new List<String>{ '2026-01-15' }).get('n'),
                String.valueOf(days.groups)
            );
            System.assertEquals(3, groupFor(days, new List<String>{ '' }).get('n'));
        }
    }

    @IsTest
    static void aLargeListIsTotalledInSlicesThatAddUpToTheWhole() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            List<String> grouping = new List<String>{ 'Service_Level__c' };
            GridGroupService.Result whole = GridGroupService.summarize(CONFIG, null, grouping, null, null);
            GridGroupService.sliceRows = 2;
            GridGroupService.Result first = GridGroupService.summarize(CONFIG, null, grouping, null, null);
            System.assertEquals(
                2,
                first.boundaries.size(),
                'Five records in slices of two: three slices, two boundaries.'
            );
            List<GridGroupService.Result> parts = new List<GridGroupService.Result>{
                first,
                GridGroupService.summarize(CONFIG, null, grouping, first.boundaries[0], first.boundaries[1]),
                GridGroupService.summarize(CONFIG, null, grouping, first.boundaries[1], null)
            };
            Map<String, Integer> counts = new Map<String, Integer>();
            Map<String, Decimal> sums = new Map<String, Decimal>();
            Integer records = 0;
            for (GridGroupService.Result part : parts) {
                System.assertEquals(
                    null,
                    part == first ? null : part.boundaries,
                    'Only the first call finds the slices.'
                );
                for (Map<String, Object> g : part.groups) {
                    String key = String.valueOf(g.get('k'));
                    Integer n = (Integer) g.get('n');
                    records += n;
                    counts.put(key, (counts.containsKey(key) ? counts.get(key) : 0) + n);
                    Decimal s = number(g, 'Pieces__c', 's');
                    if (s != null && sums.containsKey(key)) {
                        sums.put(key, sums.get(key) + s);
                    } else if (s != null) {
                        sums.put(key, s);
                    }
                }
            }
            System.assertEquals(5, records, 'Every record in exactly one slice.');
            for (Map<String, Object> g : whole.groups) {
                String key = String.valueOf(g.get('k'));
                System.assertEquals(g.get('n'), counts.get(key), key);
                System.assert(number(g, 'Pieces__c', 's') == sums.get(key), key + ': ' + sums.get(key));
            }
        }
    }

    @IsTest
    static void countsAloneNeverNeedSlices() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridGroupService.sliceRows = 2;
            // Consignments has no subtotals: a count per group costs one query row per group.
            GridGroupService.Result result = GridGroupService.summarize(
                'Consignments',
                null,
                new List<String>{ 'Service_Level__c' },
                null,
                null
            );
            System.assertEquals(null, result.boundaries);
            System.assertEquals(3, groupFor(result, new List<String>{ 'Economy' }).get('n'));
        }
    }

    @IsTest
    static void aColumnGroupedByItsOwnValueTakesItsSubtotalFromTheKey() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            // Ship Date has a Max subtotal; grouped by day, SOQL cannot also aggregate it.
            GridGroupService.Result days = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:day' },
                null,
                null
            );
            System.assertEquals(5, days.groups.size(), String.valueOf(days.groups));
            Map<String, Object> jan = groupFor(days, new List<String>{ '2026-01-15' });
            System.assertEquals(
                '2026-01-15',
                value(jan, 'Ship_Date__c', 'mx'),
                'Every record in the group has its key.'
            );
            System.assert(number(jan, 'Pieces__c', 's') == 10, 'Other subtotals are aggregated as before.');
            System.assertEquals(
                null,
                value(groupFor(days, new List<String>{ '' }), 'Ship_Date__c', 'mx'),
                'A blank key has no maximum.'
            );
        }
    }

    @IsTest
    static void aKeysSubtotalIsWorkedOutForEveryKind() {
        Schema.DescribeFieldResult num = Consignment__c.Pieces__c.getDescribe();
        Schema.DescribeFieldResult day = Consignment__c.Ship_Date__c.getDescribe();
        System.assertEquals(
            '2026-01-15',
            GridGroupService.fromKey('max', Date.newInstance(2026, 1, 15), 3, day).get('mx')
        );
        System.assertEquals(
            '2026-01-15',
            GridGroupService.fromKey('min', Date.newInstance(2026, 1, 15), 3, day).get('mn')
        );
        System.assertEquals(3, GridGroupService.fromKey('count', 'Economy', 3, day).get('c'));
        System.assertEquals(
            0,
            GridGroupService.fromKey('count', null, 3, day).get('c'),
            'A blank key counts no values.'
        );
        Map<String, Object> avg = GridGroupService.fromKey('average', Decimal.valueOf('2.5'), 4, num);
        System.assertEquals('10.0', avg.get('s'));
        System.assertEquals(4, avg.get('c'));
        System.assertEquals(null, GridGroupService.fromKey('sum', null, 4, num).get('s'));
    }

    @IsTest
    static void groupsByWeekAddingUpTheDaysOfEachWeek() {
        System.runAs(GridTestUsers.fullUser()) {
            Date thursday = Date.newInstance(2026, 1, 15);
            insert new List<Consignment__c>{
                new Consignment__c(
                    Name = 'Kennebec Lumber, 10 bundles',
                    Ship_Date__c = thursday,
                    Pieces__c = 10,
                    Freight_Charge__c = 100
                ),
                new Consignment__c(
                    Name = 'Kennebec Lumber, 5 bundles',
                    Ship_Date__c = thursday.addDays(1),
                    Pieces__c = 5,
                    Freight_Charge__c = 50
                ),
                new Consignment__c(
                    Name = 'Kennebec Lumber, 1 bundle',
                    Ship_Date__c = thursday.addDays(14),
                    Pieces__c = 1,
                    Freight_Charge__c = 30
                )
            };
            GridGroupService.Result weeks = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:week' },
                null,
                null
            );
            // A week is keyed by the day it starts on, in the running user's locale.
            Map<String, Object> first = groupFor(weeks, new List<String>{ String.valueOf(thursday.toStartOfWeek()) });
            System.assertNotEquals(null, first, String.valueOf(weeks.groups));
            System.assertEquals(2, first.get('n'), 'Two days of one week are one group.');
            System.assert(number(first, 'Pieces__c', 's') == 15, String.valueOf(first));
            System.assert(number(first, 'Freight_Charge__c', 's') == 150, 'An average\'s sum adds up.');
            System.assertEquals(2, value(first, 'Freight_Charge__c', 'c'), 'An average\'s count adds up.');
            System.assertEquals(
                String.valueOf(thursday.addDays(1)),
                value(first, 'Ship_Date__c', 'mx'),
                'The latest day of the week.'
            );
            System.assertEquals(
                1,
                groupFor(weeks, new List<String>{ String.valueOf(thursday.addDays(14).toStartOfWeek()) }).get('n')
            );
            System.assertEquals(2, weeks.groups.size(), String.valueOf(weeks.groups));
        }
    }

    @IsTest
    static void weeksAreRefusedOnlyWhenTheWeeksThemselvesAreTooMany() {
        System.runAs(GridTestUsers.fullUser()) {
            Date monday = Date.newInstance(2026, 3, 2);
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Firewood, Bangor', Ship_Date__c = monday.addDays(1)),
                new Consignment__c(Name = 'Firewood, Ellsworth', Ship_Date__c = monday.addDays(2)),
                new Consignment__c(Name = 'Firewood, Machias', Ship_Date__c = monday.addDays(3))
            };
            GridGroupService.maxGroups = 2;
            // Three days, at most two weeks: read as days, added up into weeks.
            GridGroupService.Result weeks = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:week' },
                null,
                null
            );
            System.assert(!weeks.tooManyGroups, String.valueOf(weeks.groups));
            GridGroupService.maxDays = 2;
            System.assert(
                GridGroupService.summarize(CONFIG, null, new List<String>{ 'Ship_Date__c:week' }, null, null)
                    .tooManyGroups,
                'More days than may be read is too many.'
            );
        }
    }

    @IsTest
    static void groupsByFiscalQuarterAndYearAsTheOrgsFiscalYearSays() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Map<String, Object> fiscal = GridGroupService.fiscalCalendarFor(GridConfig.forUser(CONFIG));
            Integer startMonth = Integer.valueOf(fiscal.get('startMonth'));
            Boolean nameByStart = (Boolean) fiscal.get('nameByStart');
            GridGroupService.Result quarters = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:fiscal_quarter' },
                null,
                null
            );
            GridGroupService.Result years = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:fiscal_year' },
                null,
                null
            );
            Integer counted = 0;
            for (Map<String, Object> g : quarters.groups) {
                String key = ((List<String>) g.get('k'))[0];
                System.assert(key == '' || Pattern.matches('FY\\d{4}-Q[1-4]', key), key);
                counted += (Integer) g.get('n');
            }
            System.assertEquals(5, counted, 'Every record in one fiscal quarter, or the blank group.');
            // 15 Jan 2026, by the org's start month, as the browser works it out when the org defines no period.
            Date day = Date.newInstance(2026, 1, 15);
            Integer startYear = day.month() >= startMonth ? 2026 : 2025;
            Integer name = nameByStart || startMonth == 1 ? startYear : startYear + 1;
            Integer quarter = Math.mod(day.month() - startMonth + 12, 12) / 3 + 1;
            if (((List<Object>) fiscal.get('periods')).isEmpty()) {
                System.assertNotEquals(
                    null,
                    groupFor(quarters, new List<String>{ 'FY' + name + '-Q' + quarter }),
                    String.valueOf(quarters.groups)
                );
                System.assertNotEquals(
                    null,
                    groupFor(years, new List<String>{ 'FY' + name }),
                    String.valueOf(years.groups)
                );
            }
            System.assertEquals(
                1,
                groupFor(years, new List<String>{ '' }).get('n'),
                'A record without a date is blank.'
            );
        }
    }

    @IsTest
    static void tellsTheBrowserTheFiscalYearOnlyForAGridWithADateToGroupBy() {
        System.runAs(GridTestUsers.fullUser()) {
            Map<String, Object> fiscal = GridGroupService.fiscalCalendarFor(GridConfig.forUser(CONFIG));
            System.assertNotEquals(null, fiscal);
            Organization org = [SELECT FiscalYearStartMonth, UsesStartDateAsFiscalYearName FROM Organization LIMIT 1];
            System.assertEquals(
                org.FiscalYearStartMonth,
                fiscal.get('startMonth'),
                'Read in user mode by a user of the grid.'
            );
            System.assertEquals(org.UsesStartDateAsFiscalYearName, fiscal.get('nameByStart'));
            for (Object o : (List<Object>) fiscal.get('periods')) {
                Map<String, Object> p = (Map<String, Object>) o;
                System.assert(p.get('type') == 'year' || p.get('type') == 'quarter', String.valueOf(p));
                System.assert(String.valueOf(p.get('start')) <= String.valueOf(p.get('end')), String.valueOf(p));
            }
            GridConfig.Definition noDates = GridConfig.forUser(CONFIG);
            List<GridConfig.Column> kept = new List<GridConfig.Column>();
            for (GridConfig.Column c : noDates.columns) {
                if (c.type != 'date' && c.type != 'datetime') {
                    kept.add(c);
                }
            }
            noDates.columns = kept;
            System.assertEquals(null, GridGroupService.fiscalCalendarFor(noDates), 'No date to group by: no queries.');
        }
    }

    @IsTest
    static void tooManyGroupsIsSaidPlainly() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridGroupService.maxGroups = 2;
            // Five groups: four days and a blank.
            GridGroupService.Result result = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Ship_Date__c:day' },
                null,
                null
            );
            System.assert(result.tooManyGroups);
            System.assertEquals(0, result.groups.size());
        }
    }

    @IsTest
    static void aLookupGroupCarriesTheRecordName() {
        System.runAs(GridTestUsers.fullUser()) {
            Account acme = new Account(Name = 'Penobscot Paper');
            insert acme;
            insert new List<Consignment__c>{
                new Consignment__c(Name = 'Kraft paper, Bangor', Shipper__c = acme.Id),
                new Consignment__c(Name = 'Newsprint, Bangor', Shipper__c = acme.Id)
            };
            GridGroupService.Result result = GridGroupService.summarize(
                CONFIG,
                null,
                new List<String>{ 'Shipper__c' },
                null,
                null
            );
            Map<String, Object> g = groupFor(result, new List<String>{ String.valueOf(acme.Id) });
            System.assertEquals(2, g.get('n'));
            System.assertEquals(new List<String>{ 'Penobscot Paper' }, g.get('l'));
        }
    }

    // ---------------------------------------------------------------- charts

    private static GridGroupService.Result chart(String groupBy, String measure, String field, String search) {
        return GridGroupService.chart(CONFIG, search, groupBy, measure, field, null, null, null, null, null, null);
    }

    private static String chartRefusal(String groupBy, String measure, String field) {
        try {
            chart(groupBy, measure, field, null);
        } catch (GridException e) {
            return e.getMessage();
        }
        return null;
    }

    @IsTest
    static void aChartCountsTheRecordsOfEachGroup() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result result = chart('Service_Level__c', 'count', null, null);
            Test.stopTest();
            System.assertEquals(3, result.groups.size(), String.valueOf(result.groups));
            System.assertEquals(3, groupFor(result, new List<String>{ 'Economy' }).get('n'));
            System.assertEquals(1, groupFor(result, new List<String>{ 'Standard' }).get('n'));
            System.assertEquals(1, groupFor(result, new List<String>{ '' }).get('n'), 'Blank is a group of its own.');
            System.assert(
                ((Map<String, Object>) groupFor(result, new List<String>{ 'Economy' }).get('v')).isEmpty(),
                'Counting the records needs no other figure.'
            );
        }
    }

    @IsTest
    static void aChartAddsUpOrAveragesTheNumberColumnChosen() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result sums = chart('Service_Level__c', 'sum', 'Pieces__c', null);
            GridGroupService.Result averages = chart('Service_Level__c', 'Average', 'Freight_Charge__c', null);
            Test.stopTest();
            Map<String, Object> economy = groupFor(sums, new List<String>{ 'Economy' });
            System.assert(number(economy, 'Pieces__c', 's') == 15, String.valueOf(economy));
            System.assert(
                !((Map<String, Object>) economy.get('v')).containsKey('Freight_Charge__c'),
                'Only the column chosen is measured, not the grid\'s subtotals.'
            );
            Map<String, Object> avg = groupFor(averages, new List<String>{ 'Economy' });
            System.assert(number(avg, 'Freight_Charge__c', 's') == 180, String.valueOf(avg));
            System.assertEquals(3, value(avg, 'Freight_Charge__c', 'c'), 'An average travels as a sum and a count.');
        }
    }

    @IsTest
    static void aChartGroupsADateByTheUnitChosenAndFollowsTheSearch() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result quarters = chart('Ship_Date__c:quarter', 'count', null, null);
            GridGroupService.Result searched = chart('Service_Level__c', 'count', null, 'potatoes');
            Test.stopTest();
            System.assertEquals(3, groupFor(quarters, new List<String>{ '2026-Q1' }).get('n'));
            System.assertEquals(1, groupFor(quarters, new List<String>{ '2026-Q2' }).get('n'));
            System.assertEquals(1, searched.groups.size(), String.valueOf(searched.groups));
            System.assertEquals(1, groupFor(searched, new List<String>{ 'Standard' }).get('n'));
        }
    }

    @IsTest
    static void aStackedChartGroupsByASecondColumnWithinTheFirst() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Test.startTest();
            GridGroupService.Result stacked = GridGroupService.chart(
                CONFIG,
                null,
                'Service_Level__c',
                'Ship_Date__c:quarter',
                'sum',
                'Pieces__c',
                null,
                null,
                null,
                null,
                null,
                null
            );
            String twice;
            try {
                GridGroupService.chart(
                    CONFIG,
                    null,
                    'Service_Level__c',
                    'Service_Level__c',
                    'count',
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
            } catch (GridException e) {
                twice = e.getMessage();
            }
            Test.stopTest();
            Map<String, Object> q1 = groupFor(stacked, new List<String>{ 'Economy', '2026-Q1' });
            System.assertEquals(2, q1.get('n'), String.valueOf(stacked.groups));
            System.assert(number(q1, 'Pieces__c', 's') == 15, String.valueOf(q1));
            System.assertEquals(1, groupFor(stacked, new List<String>{ 'Economy', '2026-Q2' }).get('n'));
            System.assertEquals(1, groupFor(stacked, new List<String>{ 'Standard', '2026-Q1' }).get('n'));
            System.assert(twice != null && twice.contains('twice'), twice);
        }
    }

    @IsTest
    static void aChartIsRefusedWhatTheGridCannotChart() {
        System.runAs(GridTestUsers.fullUser()) {
            Test.startTest();
            String noGroup = chartRefusal(' ', 'count', null);
            String notAColumn = chartRefusal('Weight_Kg__c', 'count', null);
            String twoLevels = chartRefusal('Service_Level__c,Ship_Date__c', 'count', null);
            String badMeasure = chartRefusal('Service_Level__c', 'max', 'Pieces__c');
            String text = chartRefusal('Service_Level__c', 'sum', 'Consignee__c');
            String absent = chartRefusal('Service_Level__c', 'average', 'Weight_Kg__c');
            Test.stopTest();
            System.assertEquals('Choose a column to group the chart by.', noGroup);
            System.assertEquals('Cannot group by Weight_Kg__c.', notAColumn);
            System.assert(twoLevels != null && twoLevels.startsWith('Cannot group by'), twoLevels);
            System.assertEquals('A chart counts the records, or adds up or averages a number column.', badMeasure);
            System.assertEquals('Consignee cannot be added up.', text);
            System.assertEquals('This grid has no column "Weight_Kg__c" to chart.', absent);
        }
    }

    @IsTest
    static void aChartNeverReachesAColumnTheUserCannotRead() {
        // Freight_Limited_Access cannot read Picked Up or Shipper (GridSecurityTest).
        System.runAs(GridTestUsers.limitedUser()) {
            Test.startTest();
            String byShipper = chartRefusal('Shipper__c', 'count', null);
            String ofPickedUp = chartRefusal('Service_Level__c', 'sum', 'Picked_Up__c');
            Test.stopTest();
            System.assertEquals('Cannot group by Shipper__c.', byShipper);
            System.assertEquals('This grid has no column "Picked_Up__c" to chart.', ofPickedUp);
        }
    }

    @IsTest
    static void theSearchNarrowsTheGroupsAsItNarrowsTheRows() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            GridGroupService.Result result = GridGroupService.summarize(
                CONFIG,
                'potatoes',
                new List<String>{ 'Service_Level__c' },
                null,
                null
            );
            System.assertEquals(1, result.groups.size(), String.valueOf(result.groups));
            System.assertEquals(1, groupFor(result, new List<String>{ 'Standard' }).get('n'));
        }
    }

    @IsTest
    static void rowsComeInGroupOrder() {
        System.runAs(GridTestUsers.fullUser()) {
            seed();
            Map<String, Object> page = GridController.fetchRows(
                CONFIG,
                null,
                'Name',
                'desc',
                null,
                null,
                null,
                new List<String>{ 'Service_Level__c' },
                null,
                null,
                null,
                null,
                null,
                null
            );
            List<String> seen = new List<String>();
            for (Map<String, Object> row : (List<Map<String, Object>>) page.get('rows')) {
                seen.add(row.get('Service_Level__c') + '/' + row.get('Name'));
            }
            System.assertEquals(
                new List<String>{
                    'Economy/Maple syrup, Burlington',
                    'Economy/Canned goods, Lewiston',
                    'Economy/Boat fittings, Rockland',
                    'Standard/Seed potatoes, Presque Isle',
                    'null/Empty pallets, Bangor'
                },
                seen,
                'Groups ascending, blank last; the sort applies within each group.'
            );
        }
    }

    @IsTest
    static void refusesAGroupingOrASliceTheGridDoesNotAllow() {
        System.runAs(GridTestUsers.fullUser()) {
            System.assertEquals('Cannot group by Pieces__c.', refusal(new List<String>{ 'Pieces__c' }, null, null));
            System.assertEquals('Cannot group by Name.', refusal(new List<String>{ 'Name' }, null, null));
            System.assertEquals(
                'Cannot group by Trailer_Number__c.',
                refusal(new List<String>{ 'Trailer_Number__c' }, null, null)
            );
            System.assertEquals(
                'Cannot group by Service Level twice.',
                refusal(new List<String>{ 'Service_Level__c', 'service_level__c' }, null, null)
            );
            System.assertEquals(
                'Group by at most 3 columns.',
                refusal(new List<String>{ 'Name', 'Service_Level__c', 'Ship_Date__c', 'Consignee__c' }, null, null)
            );
            System.assertEquals(
                'Cannot group Ship Date by "decade".',
                refusal(new List<String>{ 'Ship_Date__c:decade' }, null, null)
            );
            System.assertEquals(
                'Record ' + UserInfo.getUserId() + ' is not a Consignment__c.',
                refusal(null, UserInfo.getUserId(), null)
            );
            System.assertEquals('Not a record Id: PRO-1001', refusal(null, null, 'PRO-1001'));
            // fetchRows checks a grouping the same way.
            try {
                GridController.fetchRows(
                    CONFIG,
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    new List<String>{ 'Pieces__c' },
                    null,
                    null,
                    null,
                    null,
                    null,
                    null
                );
                System.assert(false, 'A grouping by a number must be refused.');
            } catch (AuraHandledException e) {
                System.assertEquals('Cannot group by Pieces__c.', e.getMessage());
            }
        }
    }
}
