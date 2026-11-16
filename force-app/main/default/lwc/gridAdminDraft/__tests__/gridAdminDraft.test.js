/**
 * The grid settings editor's plain logic: names, operators, the draft's
 * shape for the server, moving entries, fitting a column or rule to its field,
 * and which configurations load fresh; also filters, the
 * record page field, formula columns, and rules that use Between, compare two
 * fields, or are formulas.
 */
import {
    ACTION_TYPES,
    COMPARE_OPERATORS,
    FORMULA_OPERATOR,
    FORMULA_TYPES,
    MAX_FORMULAS,
    MAX_SORT_LEVELS,
    OPERATORS,
    SHOW_IN,
    STYLES,
    apiNameFrom,
    compareKind,
    emptyDraft,
    fitColumnToField,
    fitRuleToField,
    isFormulaColumn,
    isFormulaRule,
    isSortColumn,
    moveItem,
    nameProblem,
    needsValue,
    newColumn,
    newFilter,
    newFormulaColumn,
    newRule,
    operatorsFor,
    pruneSort,
    sameDraft,
    sortLevelsOf,
    toServer,
    valueHint,
    withKeys,
    withSortLevels
} from 'c/gridAdminDraft';

const values = list => list.map(o => o.value);

describe('API names', () => {
    it('makes one from a title as the server cleans names', () => {
        expect(apiNameFrom('Open Opportunities')).toBe('Open_Opportunities');
        expect(apiNameFrom('  Q3 — pipeline (EMEA) ')).toBe('Q3_pipeline_EMEA');
        expect(apiNameFrom('2026 deals')).toBe('X2026_deals');
        expect(apiNameFrom('')).toBe('');
        const long = apiNameFrom('Consignments awaiting pickup in Presque Isle and Houlton');
        expect(long.length).toBeLessThanOrEqual(40);
        expect(long.endsWith('_')).toBe(false);
    });

    it('says why a name will not do, as the server does', () => {
        expect(nameProblem('Consignments_2026')).toBe('');
        expect(nameProblem('')).toMatch(/API name/);
        expect(nameProblem('Consignments__Open')).toMatch(/single underscores/);
        expect(nameProblem('Consignments_')).toMatch(/not ending/);
        expect(nameProblem('2026_Consignments')).toMatch(/start with a letter/);
        expect(nameProblem('Consignments_Awaiting_Pickup_Presque_Isle')).toMatch(/41 characters/);
    });
});

describe('picklist values', () => {
    it("are the Custom Metadata fields' own values", () => {
        expect(values(ACTION_TYPES)).toEqual(['screen_flow', 'autolaunched_flow', 'quick_action']);
        expect(values(SHOW_IN)).toEqual(['row_menu_and_selection', 'row_menu', 'selection']);
        // The labels are Setup's, word for word.
        expect(ACTION_TYPES.map(o => o.label)).toEqual(['Screen flow', 'Autolaunched flow', 'Quick action']);
        expect(SHOW_IN.map(o => o.label)).toEqual(['Row menu and selection', 'Row menu', 'Selection']);
        expect(values(STYLES)).toEqual(expect.arrayContaining(['fill_gray', 'text_gray']));
        expect(values(STYLES)).not.toContain('fill_blue');
        expect(values(OPERATORS)).toHaveLength(12); // Between included
    });
});

describe('operators by field type', () => {
    it('offers what the server accepts', () => {
        expect(values(operatorsFor('checkbox'))).toEqual(['equals', 'not_equals']);
        expect(values(operatorsFor('currency'))).toEqual([
            'equals',
            'not_equals',
            'greater_than',
            'greater_or_equal',
            'less_than',
            'less_or_equal',
            'between',
            'is_blank',
            'is_not_blank'
        ]);
        expect(values(operatorsFor('text'))).toEqual([
            'equals',
            'not_equals',
            'contains',
            'not_contains',
            'starts_with',
            'is_blank',
            'is_not_blank'
        ]);
        expect(values(operatorsFor('multipicklist'))).not.toContain('starts_with');
        expect(values(operatorsFor('reference'))).toEqual(['equals', 'not_equals', 'is_blank', 'is_not_blank']);
    });

    it('needs a value except for the blank tests, and hints how to write one', () => {
        expect(needsValue('is_blank')).toBe(false);
        expect(needsValue('equals')).toBe(true);
        expect(valueHint('date')).toMatch(/TODAY/);
        expect(valueHint('owner')).toMatch(/\$User/);
    });
});

describe('the draft', () => {
    it('gives every entry a template key and takes it off for the server', () => {
        const draft = withKeys({
            config: { name: 'Consignments', label: 'Consignments', isNew: false },
            columns: [{ name: 'Consignments_Name', field: 'Name' }],
            rules: [],
            actions: [],
            children: []
        });
        expect(draft.columns[0]._key).toMatch(/^col\d+$/);
        const server = toServer(draft);
        expect(server.columns[0]._key).toBeUndefined();
        expect(server.columns[0].field).toBe('Name');
    });

    it('sends blank text as null and trims the rest', () => {
        const d = emptyDraft();
        d.config.label = '  Pipeline  ';
        d.config.name = '';
        const server = toServer(d);
        expect(server.config.label).toBe('Pipeline');
        expect(server.config.name).toBeNull();
    });

    it('knows an unchanged draft whatever its keys', () => {
        const a = withKeys({ config: { name: 'Consignments' }, columns: [{ field: 'Name' }] });
        const b = withKeys({ config: { name: 'Consignments' }, columns: [{ field: 'Name' }] });
        expect(sameDraft(a, b)).toBe(true);
        expect(sameDraft(a, { ...b, columns: [] })).toBe(false);
    });

    it('moves an entry, and leaves the list alone at either end', () => {
        const list = ['Name', 'Pieces__c', 'Ship_Date__c'];
        expect(moveItem(list, 0, 1)).toEqual(['Pieces__c', 'Name', 'Ship_Date__c']);
        expect(moveItem(list, 2, -1)).toEqual(['Name', 'Ship_Date__c', 'Pieces__c']);
        expect(moveItem(list, 0, -1)).toBe(list);
        expect(moveItem(list, 2, 1)).toBe(list);
    });

    it('clears column settings the new field cannot take', () => {
        const col = { ...newColumn('Amount'), editable: true, groupLevel: 1, groupUnit: 'month', subtotal: 'sum' };
        const name = {
            name: 'Name',
            type: 'text',
            editable: true,
            sortable: true,
            groupable: true,
            subtotals: ['count']
        };
        const fitted = fitColumnToField(col, name);
        expect(fitted.editable).toBe(true);
        expect(fitted.groupLevel).toBe(1);
        expect(fitted.groupUnit).toBeNull();
        expect(fitted.subtotal).toBeNull();
        const formula = {
            name: 'Pallet_Positions__c',
            type: 'number',
            editable: false,
            sortable: true,
            groupable: false,
            subtotals: ['sum']
        };
        expect(fitColumnToField(col, formula)).toMatchObject({ editable: false, groupLevel: null, subtotal: 'sum' });
    });

    it('gives a rule an operator its new field takes', () => {
        const rule = { field: 'Amount', operator: 'greater_than' };
        expect(fitRuleToField(rule, { type: 'checkbox' }).operator).toBe('equals');
        expect(fitRuleToField(rule, { type: 'date' }).operator).toBe('greater_than');
    });
});

describe('the new rule and column options', () => {
    it('has Between among the operators, after the comparisons', () => {
        const ops = values(OPERATORS);
        expect(ops).toContain('between');
        expect(ops.indexOf('between')).toBe(ops.indexOf('less_or_equal') + 1);
        expect(OPERATORS.find(o => o.value === 'between').label).toBe('Between');
    });

    it('has the icon and data bar looks, with their labels', () => {
        const looks = Object.fromEntries(STYLES.map(s => [s.value, s.label]));
        expect(looks).toMatchObject({
            icon_warning: 'Warning icon',
            icon_error: 'Error icon',
            icon_success: 'Success icon',
            icon_info: 'Info icon',
            icon_up: 'Up arrow',
            icon_down: 'Down arrow',
            data_bar: 'Data bar'
        });
        // The color fills and text looks are still there, and nothing twice.
        expect(values(STYLES)).toContain('fill_green');
        expect(new Set(values(STYLES)).size).toBe(STYLES.length);
        expect(STYLES).toHaveLength(16);
    });

    it("lists what a formula column can return, as Formula Type's values", () => {
        expect(values(FORMULA_TYPES)).toEqual([
            'text',
            'number',
            'currency',
            'percent',
            'date',
            'datetime',
            'checkbox'
        ]);
        expect(FORMULA_TYPES.find(t => t.value === 'datetime').label).toBe('Date/Time');
    });

    it('marks a formula rule by an operator that is never saved, and allows 10 formulas', () => {
        expect(FORMULA_OPERATOR).toBe('__formula');
        expect(values(OPERATORS)).not.toContain(FORMULA_OPERATOR);
        expect(MAX_FORMULAS).toBe(10);
    });

    it('offers Between only for numbers, dates and times', () => {
        ['number', 'currency', 'percent', 'date', 'datetime', 'time'].forEach(type => {
            expect(values(operatorsFor(type))).toContain('between');
        });
        ['text', 'textarea', 'email', 'picklist', 'multipicklist', 'checkbox', 'reference', 'owner'].forEach(type => {
            expect(values(operatorsFor(type))).not.toContain('between');
        });
        expect(values(operatorsFor('time'))).toEqual([
            'equals',
            'not_equals',
            'greater_than',
            'greater_or_equal',
            'less_than',
            'less_or_equal',
            'between',
            'is_blank',
            'is_not_blank'
        ]);
    });

    it('lets two fields be compared only by equals and the comparisons', () => {
        expect([...COMPARE_OPERATORS].sort()).toEqual([
            'equals',
            'greater_or_equal',
            'greater_than',
            'less_or_equal',
            'less_than',
            'not_equals'
        ]);
        ['between', 'contains', 'not_contains', 'starts_with', 'is_blank', 'is_not_blank', FORMULA_OPERATOR].forEach(
            op => {
                expect(COMPARE_OPERATORS.has(op)).toBe(false);
            }
        );
    });

    it('sorts field types into the kinds that compare with each other', () => {
        expect(['number', 'currency', 'percent'].map(compareKind)).toEqual(['number', 'number', 'number']);
        expect(['date', 'datetime'].map(compareKind)).toEqual(['date', 'date']);
        expect(['reference', 'owner'].map(compareKind)).toEqual(['reference', 'reference']);
        // Times, checkboxes and multi-select picklists only compare with their own type.
        expect(['time', 'checkbox', 'multipicklist'].map(compareKind)).toEqual(['time', 'checkbox', 'multipicklist']);
        // Everything else is text.
        expect(['text', 'textarea', 'email', 'phone', 'url', 'id', 'picklist', undefined].map(compareKind)).toEqual([
            'text',
            'text',
            'text',
            'text',
            'text',
            'text',
            'text',
            'text'
        ]);
    });

    it('knows a formula rule by its formula, even one not written yet', () => {
        expect(isFormulaRule({ formula: 'Amount__c > 0' })).toBe(true);
        expect(isFormulaRule({ formula: '' })).toBe(true); // chosen, being typed
        expect(isFormulaRule({ formula: null })).toBe(false);
        expect(isFormulaRule({ field: 'Amount__c' })).toBe(false); // no formula at all
        expect(isFormulaRule(null)).toBe(false);
        expect(isFormulaRule(undefined)).toBe(false);
        expect(isFormulaRule(newRule())).toBe(false);
    });

    it('knows a formula column the same way', () => {
        expect(isFormulaColumn({ formula: 'Amount__c * 2' })).toBe(true);
        expect(isFormulaColumn({ formula: '' })).toBe(true);
        expect(isFormulaColumn({ formula: null, field: 'Name' })).toBe(false);
        expect(isFormulaColumn({ field: 'Name' })).toBe(false);
        expect(isFormulaColumn(null)).toBe(false);
        expect(isFormulaColumn(newColumn('Name'))).toBe(false);
    });
});

describe('new entries', () => {
    it('starts a formula column with no field, an empty formula, a number result and no sorting', () => {
        const col = newFormulaColumn();
        expect(col).toMatchObject({
            name: null,
            field: null,
            formula: '',
            formulaType: 'number',
            decimalPlaces: null,
            sortable: false,
            editable: false,
            groupLevel: null,
            subtotal: null,
            inactive: false
        });
        expect(col._key).toMatch(/^col\d+$/);
        expect(isFormulaColumn(col)).toBe(true);
        expect(newFormulaColumn()._key).not.toBe(col._key);
    });

    it('starts a field column with no formula', () => {
        expect(newColumn('Amount__c')).toMatchObject({
            field: 'Amount__c',
            formula: null,
            formulaType: null,
            decimalPlaces: null,
            sortable: true
        });
    });

    it('starts a rule with no upper value, no field to compare with and no formula', () => {
        const rule = newRule();
        expect(rule).toMatchObject({
            operator: 'equals',
            value: '',
            valueTo: '',
            compareField: null,
            formula: null,
            style: 'fill_green',
            applyTo: 'cell',
            inactive: false
        });
        expect(rule._key).toMatch(/^rule\d+$/);
    });

    it('starts a filter that is on, tests equals and has no field yet', () => {
        const filter = newFilter();
        const { _key, ...rest } = filter;
        expect(_key).toMatch(/^flt\d+$/);
        expect(rest).toEqual({
            name: null,
            label: '',
            field: null,
            operator: 'equals',
            value: '',
            valueTo: '',
            inactive: false
        });
        expect(newFilter()._key).not.toBe(_key);
    });
});

describe('filters and the record page field in the draft', () => {
    it('starts a new grid with no filters and no record page field', () => {
        const d = emptyDraft();
        expect(d.filters).toEqual([]);
        expect(d.config.recordPageField).toBeNull();
        expect(Object.keys(d)).toEqual(['config', 'columns', 'rules', 'actions', 'children', 'filters']);
    });

    it('gives each filter a template key, and an empty list when the server sent none', () => {
        const draft = withKeys({
            config: { name: 'Consignments', recordPageField: 'AccountId' },
            columns: [],
            filters: [
                {
                    name: 'Consignments_Open',
                    field: 'Stage__c',
                    operator: 'not_equals',
                    value: 'Closed',
                    inactive: false
                }
            ]
        });
        expect(draft.filters[0]._key).toMatch(/^flt\d+$/);
        expect(draft.filters[0].field).toBe('Stage__c');
        expect(draft.config.recordPageField).toBe('AccountId');
        // A draft from before filters: an empty list, and no record page field.
        const old = withKeys({ config: { name: 'Consignments' }, columns: [], rules: [], actions: [], children: [] });
        expect(old.filters).toEqual([]);
        expect(old.config.recordPageField).toBeNull();
    });

    it('sends filters and the record page field to the server, without keys and with blank text as null', () => {
        const d = withKeys({
            config: { name: 'Consignments', label: 'Consignments', recordPageField: 'AccountId' },
            columns: []
        });
        d.filters = [
            { ...newFilter(), field: 'Amount__c', operator: 'between', value: ' 100 ', valueTo: '500', label: '  ' }
        ];
        const server = toServer(d);
        expect(server.config.recordPageField).toBe('AccountId');
        expect(server.filters).toEqual([
            {
                name: null,
                label: null,
                field: 'Amount__c',
                operator: 'between',
                value: '100',
                valueTo: '500',
                inactive: false
            }
        ]);
        expect(JSON.stringify(server)).not.toContain('_key');
    });

    it('sends a formula column and the new rule settings as they are', () => {
        const d = emptyDraft();
        d.columns = [
            {
                ...newFormulaColumn(),
                formula: 'Amount__c * 0.2',
                columnLabel: 'Bonus',
                formulaType: 'currency',
                decimalPlaces: 2
            }
        ];
        d.rules = [
            { ...newRule(), field: 'Amount__c', operator: 'between', value: '10', valueTo: '20' },
            { ...newRule(), field: 'Amount__c', operator: 'greater_than', compareField: 'Budget__c' },
            { ...newRule(), formula: 'Amount__c > Budget__c', applyTo: 'row' }
        ];
        const server = toServer(d);
        expect(server.columns[0]).toMatchObject({
            field: null,
            formula: 'Amount__c * 0.2',
            formulaType: 'currency',
            decimalPlaces: 2,
            columnLabel: 'Bonus',
            sortable: false
        });
        expect(server.rules[0]).toMatchObject({
            operator: 'between',
            value: '10',
            valueTo: '20',
            compareField: null,
            formula: null
        });
        expect(server.rules[1]).toMatchObject({ compareField: 'Budget__c', value: null, valueTo: null });
        expect(server.rules[2]).toMatchObject({ formula: 'Amount__c > Budget__c', field: null, applyTo: 'row' });
    });

    it('sends a formula not written yet as nothing, which is why the editor checks it itself', () => {
        const server = toServer({
            ...emptyDraft(),
            columns: [newFormulaColumn()],
            rules: [{ ...newRule(), formula: '' }]
        });
        expect(server.columns[0].formula).toBeNull();
        expect(server.rules[0].formula).toBeNull();
    });

    it('sees a change to the filters or the record page field', () => {
        const a = withKeys({
            config: { name: 'Consignments' },
            columns: [{ field: 'Name' }],
            filters: [{ field: 'Stage__c', operator: 'equals', value: 'Won' }]
        });
        const b = withKeys({
            config: { name: 'Consignments' },
            columns: [{ field: 'Name' }],
            filters: [{ field: 'Stage__c', operator: 'equals', value: 'Won' }]
        });
        expect(sameDraft(a, b)).toBe(true);
        expect(sameDraft(a, { ...b, filters: [] })).toBe(false);
        expect(sameDraft(a, { ...b, filters: [{ ...b.filters[0], inactive: true }] })).toBe(false);
        expect(sameDraft(a, { ...b, config: { ...b.config, recordPageField: 'AccountId' } })).toBe(false);
    });

    it('moves a filter like any other entry', () => {
        const filters = [
            { ...newFilter(), field: 'Mode__c' },
            { ...newFilter(), field: 'Service_Level__c' }
        ];
        expect(moveItem(filters, 1, -1).map(f => f.field)).toEqual(['Service_Level__c', 'Mode__c']);
    });
});

describe('fitting a rule or a filter to a new field', () => {
    it('keeps Between for a number or date, and drops it for a field that cannot take it', () => {
        const rule = { field: 'Amount__c', operator: 'between', value: '1', valueTo: '2' };
        expect(fitRuleToField(rule, { name: 'Close__c', type: 'date' }).operator).toBe('between');
        expect(fitRuleToField(rule, { name: 'Done__c', type: 'checkbox' }).operator).toBe('equals');
        expect(fitRuleToField(rule, { name: 'Stage__c', type: 'picklist' }).operator).toBe('equals');
    });

    it('fits a filter the same way', () => {
        const filter = { ...newFilter(), field: 'Stage__c', operator: 'starts_with' };
        const fitted = fitRuleToField(filter, { name: 'Amount__c', type: 'currency' });
        expect(fitted.operator).toBe('equals');
        expect(fitted).not.toBe(filter);
        expect(filter.operator).toBe('starts_with'); // the original is left alone
    });

    it('clears a field to compare with that is of another kind', () => {
        const rule = { field: 'Amount__c', operator: 'greater_than', compareField: 'Budget__c' };
        // Budget is a currency field: a date no longer compares with it.
        expect(fitRuleToField(rule, { name: 'Close__c', type: 'date' }, 'currency').compareField).toBeNull();
        // A number still does.
        expect(fitRuleToField(rule, { name: 'Score__c', type: 'number' }, 'currency').compareField).toBe('Budget__c');
        // A percent field compares with a currency one: both are numbers.
        expect(fitRuleToField(rule, { name: 'Rate__c', type: 'percent' }, 'currency').compareField).toBe('Budget__c');
    });

    it('clears the field to compare with when the rule moves to that same field', () => {
        const rule = { field: 'Amount__c', operator: 'greater_than', compareField: 'Budget__c' };
        expect(fitRuleToField(rule, { name: 'Budget__c', type: 'currency' }, 'currency').compareField).toBeNull();
        expect(fitRuleToField(rule, { name: 'budget__c', type: 'currency' }, 'currency').compareField).toBeNull(); // whatever the case
    });

    it('keeps the field to compare with when its type is not known', () => {
        const rule = { field: 'Amount__c', operator: 'equals', compareField: 'Gone__c' };
        expect(fitRuleToField(rule, { name: 'Close__c', type: 'date' }).compareField).toBe('Gone__c');
        expect(fitRuleToField(rule, { name: 'Close__c', type: 'date' }, undefined).compareField).toBe('Gone__c');
    });

    it('changes nothing when there is no new field', () => {
        const rule = { field: 'Amount__c', operator: 'between', compareField: 'Budget__c' };
        const fitted = fitRuleToField(rule, null, 'date');
        expect(fitted).toEqual(rule);
        expect(fitted).not.toBe(rule);
    });
});

describe('the default sort', () => {
    const columns = [
        { field: 'StageName', sortable: true, inactive: false },
        { field: 'LastModifiedDate', sortable: true, inactive: false },
        { field: 'Amount', sortable: true, inactive: false },
        { field: null, formula: 'Amount * 2', sortable: false }
    ];
    const config = {
        sortField: 'StageName',
        sortDirection: 'asc',
        thenSort: [{ field: 'LastModifiedDate', direction: 'desc' }]
    };

    it('reads every level, the first first, and writes them back', () => {
        expect(sortLevelsOf(config)).toEqual([
            { field: 'StageName', direction: 'asc' },
            { field: 'LastModifiedDate', direction: 'desc' }
        ]);
        expect(sortLevelsOf({ sortField: null, thenSort: [{ field: 'Amount' }] })).toEqual([]);
        expect(sortLevelsOf({ sortField: 'Amount' })).toEqual([{ field: 'Amount', direction: 'asc' }]);
        const back = withSortLevels({ label: 'Deals' }, sortLevelsOf(config));
        expect(back).toEqual({ label: 'Deals', ...config });
        expect(withSortLevels(config, [])).toMatchObject({ sortField: null, sortDirection: 'asc', thenSort: [] });
        const six = ['A', 'B', 'C', 'D', 'E', 'F'].map(field => ({ field, direction: 'asc' }));
        expect(withSortLevels({}, six).thenSort).toHaveLength(MAX_SORT_LEVELS - 1);
    });

    it('a column switched off, unsortable or on another field leaves the sorts after the first', () => {
        expect(pruneSort(config, columns)).toEqual({ config, dropped: [] });
        const off = columns.map(c => (c.field === 'LastModifiedDate' ? { ...c, inactive: true } : c));
        const pruned = pruneSort(config, off);
        expect(pruned.dropped).toEqual(['LastModifiedDate']);
        expect(pruned.config).toMatchObject({ sortField: 'StageName', sortDirection: 'asc', thenSort: [] });
        const unsortable = columns.map(c => (c.field === 'LastModifiedDate' ? { ...c, sortable: false } : c));
        expect(pruneSort(config, unsortable).config.thenSort).toEqual([]);
        const moved = columns.map(c => (c.field === 'LastModifiedDate' ? { ...c, field: 'CloseDate' } : c));
        expect(pruneSort(config, moved).dropped).toEqual(['LastModifiedDate']);
        // The first sort may be any field: its column switched off, it stays.
        const firstOff = columns.map(c => (c.field === 'StageName' ? { ...c, inactive: true } : c));
        expect(pruneSort(config, firstOff)).toEqual({ config, dropped: [] });
    });

    it('keeps a first sort on a field that is no column at all', () => {
        const setup = { sortField: 'CreatedDate', sortDirection: 'desc', thenSort: [] };
        expect(pruneSort(setup, columns)).toEqual({ config: setup, dropped: [] });
        expect(isSortColumn(columns[3])).toBe(false);
        expect(isSortColumn({ field: 'Amount', childTable: 'Deal_Notes', childTotal: 'count' })).toBe(false);
    });
});
