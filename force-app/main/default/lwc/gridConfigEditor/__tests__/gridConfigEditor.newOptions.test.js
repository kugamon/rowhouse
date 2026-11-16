/**
 * The grid settings editor's newer options: the Filters tab, the
 * record page field on the Grid tab, formula columns, headers that use what
 * the grid shows for a field, and display rules that use Between, compare two
 * fields, are formulas, or show an icon or a data bar. Also the editor's own
 * checks for formulas, and what it sends to the server.
 */
import { createElement } from 'lwc';
import GridConfigEditor, { CHECK_DELAY_MS } from 'c/gridConfigEditor';
import { FORMULA_TYPES } from 'c/gridAdminDraft';
import readConfig from '@salesforce/apex/GridAdminController.readConfig';
import listObjects from '@salesforce/apex/GridAdminController.listObjects';
import describeObject from '@salesforce/apex/GridAdminController.describeObject';
import checkDraft from '@salesforce/apex/GridAdminController.checkDraft';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import canSave from '@salesforce/apex/GridAdminController.canSave';

jest.mock('@salesforce/apex/GridAdminController.readConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.listObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.describeObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.checkDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });

// The object's fields, as GridAdmin.describeObject gives them. `heading` is what
// a column of the field is headed when it has no header of its own.
const field = (name, label, type, more = {}) => ({
    name,
    label,
    heading: label,
    type,
    sortable: true,
    groupable: false,
    filterable: true,
    editable: true,
    isName: false,
    referenceTo: [],
    subtotals: [],
    ...more
});
const FIELDS = [
    field('Name', 'Deal Name', 'text', { isName: true, groupable: true, subtotals: ['count'] }),
    // A lookup to one object: headed "Account", not "Account ID".
    field('AccountId', 'Account ID', 'reference', { heading: 'Account', referenceTo: ['Account'] }),
    // A lookup to two objects: no good for a record page.
    field('WhatId', 'Related To ID', 'reference', { heading: 'Related To', referenceTo: ['Account', 'Opportunity'] }),
    // The owner: a lookup to one object, but not of the reference type.
    field('OwnerId', 'Owner ID', 'owner', { heading: 'Owner', referenceTo: ['User'] }),
    field('Amount__c', 'Amount', 'currency', { subtotals: ['sum', 'average', 'min', 'max', 'count'] }),
    field('Budget__c', 'Budget', 'currency', { subtotals: ['sum'] }),
    // No heading: the header falls back to the label.
    { ...field('Score__c', 'Score', 'number', { editable: false, subtotals: ['sum'] }), heading: undefined },
    field('Close__c', 'Close Date', 'date', { groupable: true }),
    field('Done__c', 'Done', 'checkbox'),
    field('Stage__c', 'Stage', 'picklist', { groupable: true }),
    field('Tags__c', 'Tags', 'multipicklist', { sortable: false }),
    // Long text cannot filter.
    field('Notes__c', 'Notes', 'textarea', { sortable: false, filterable: false, editable: false })
];
const DESCRIBED = { name: 'Deal__c', label: 'Deal', labelPlural: 'Deals', fields: FIELDS, children: [] };
const ACCOUNT_DESCRIBED = {
    name: 'Account',
    label: 'Account',
    labelPlural: 'Accounts',
    fields: [
        field('Name', 'Account Name', 'text', { isName: true }),
        field('ParentId', 'Parent Account ID', 'reference', { heading: 'Parent Account', referenceTo: ['Account'] })
    ],
    children: []
};

const DRAFT = {
    config: {
        name: 'Deals',
        label: 'Deals',
        isNew: false,
        objectApiName: 'Deal__c',
        sortField: 'Name',
        sortDirection: 'asc',
        allowInlineEdit: true,
        allowCsvExport: true,
        recordPageField: null
    },
    columns: [
        {
            name: 'Deals_Name',
            field: 'Name',
            columnLabel: null,
            editable: true,
            sortable: true,
            inactive: false,
            formula: null
        },
        {
            name: 'Deals_Account',
            field: 'AccountId',
            columnLabel: null,
            editable: true,
            sortable: true,
            inactive: false,
            formula: null
        },
        {
            name: 'Deals_Amount',
            field: 'Amount__c',
            columnLabel: 'Deal Value',
            editable: true,
            sortable: true,
            subtotal: 'sum',
            inactive: false,
            formula: null
        },
        {
            name: 'Deals_Commission',
            field: null,
            columnLabel: 'Commission',
            editable: false,
            sortable: false,
            inactive: false,
            formula: 'Amount__c * 0.1',
            formulaType: 'currency',
            decimalPlaces: 2
        }
    ],
    rules: [
        {
            name: 'Deals_Large',
            label: 'Large deal',
            field: 'Amount__c',
            operator: 'greater_than',
            value: '1000',
            valueTo: null,
            compareField: null,
            formula: null,
            style: 'fill_green',
            applyTo: 'row',
            inactive: false
        }
    ],
    actions: [],
    children: [],
    filters: [
        {
            name: 'Deals_Open',
            label: 'Open',
            field: 'Stage__c',
            operator: 'not_equals',
            value: 'Closed',
            valueTo: null,
            inactive: false
        },
        {
            name: 'Deals_Recent',
            label: 'Recent',
            field: 'Close__c',
            operator: 'greater_than',
            value: 'TODAY-30',
            valueTo: null,
            inactive: true
        }
    ]
};
/** A copy of the saved draft, changed by `edit`, so no test changes another's. */
const draftWith = edit => {
    const d = JSON.parse(JSON.stringify(DRAFT));
    if (edit) edit(d);
    return d;
};

const settle = async () => {
    for (let i = 0; i < 12; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const $$ = (el, selector) => [...el.shadowRoot.querySelectorAll(selector)];
const change = (target, value) => {
    if (typeof value === 'boolean') target.checked = value;
    target.dispatchEvent(new CustomEvent('change', { detail: { value, checked: value } }));
};
const click = target => target.dispatchEvent(new CustomEvent('click'));
const lastDraft = () => JSON.parse(checkDraft.mock.calls[checkDraft.mock.calls.length - 1][0].draftJson);
const values = options => options.map(o => o.value);
const errorsText = el => {
    const box = $(el, '.rh-editor-errors');
    return box ? box.textContent : '';
};

async function mount(configName = 'Deals') {
    const el = createElement('c-grid-config-editor', { is: GridConfigEditor });
    el.configName = configName;
    document.body.appendChild(el);
    await settle();
    return el;
}
const afterCheck = async () => {
    jest.advanceTimersByTime(CHECK_DELAY_MS);
    await settle();
};

beforeEach(() => {
    jest.useFakeTimers();
    readConfig.mockResolvedValue({ draft: draftWith(), warnings: [], canSave: true });
    describeObject.mockImplementation(({ objectApiName }) =>
        Promise.resolve(objectApiName === 'Account' ? ACCOUNT_DESCRIBED : DESCRIBED)
    );
    listObjects.mockResolvedValue([
        { name: 'Account', label: 'Account' },
        { name: 'Deal__c', label: 'Deal' }
    ]);
    canSave.mockResolvedValue(true);
    checkDraft.mockResolvedValue({ errors: [], warnings: [] });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('the Filters tab', () => {
    it('sits between the display rules and the actions, and counts the filters that are on', async () => {
        const el = await mount();
        const tabs = $$(el, 'lightning-tab').map(t => t.label);
        expect(tabs).toEqual([
            'Grid',
            'Columns (4)',
            'Display rules (1)',
            'Filters (1)',
            'Actions (0)',
            'Child tables (0)',
            'Views (0)'
        ]);
    });

    it('lists the saved filters in order, with their field, condition, value and switch', async () => {
        const el = await mount();
        expect($$(el, '.rh-filter-label').map(i => i.value)).toEqual(['Open', 'Recent']);
        expect($$(el, '.rh-filter-field').map(c => c.value)).toEqual(['Stage__c', 'Close__c']);
        expect($$(el, '.rh-filter-operator').map(c => c.value)).toEqual(['not_equals', 'greater_than']);
        expect($$(el, '.rh-filter-value').map(i => i.value)).toEqual(['Closed', 'TODAY-30']);
        expect($$(el, '.rh-filter-value-to')).toHaveLength(0);
        expect($$(el, '.rh-filter-on').map(t => t.checked)).toEqual([true, false]);
        // Saved filters cannot be deleted, only switched off.
        expect($$(el, '.rh-filter-remove')).toHaveLength(0);
    });

    it('offers only the fields a filter can test', async () => {
        const el = await mount();
        const offered = values($(el, '.rh-filter-field').options);
        expect(offered).toContain('Amount__c');
        expect(offered).toContain('Stage__c');
        expect(offered).not.toContain('Notes__c'); // long text cannot filter
    });

    it('shows no table and only the Add button when the grid has no filters', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                d.filters = [];
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect($(el, '.rh-filters')).toBeNull();
        expect($(el, '.rh-add-filter')).not.toBeNull();
        expect($$(el, 'lightning-tab')[3].label).toBe('Filters (0)');
    });

    it('accepts a draft from before filters, with none', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                delete d.filters;
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect($$(el, 'lightning-tab')[3].label).toBe('Filters (0)');
        expect($(el, '.rh-filters')).toBeNull();
    });

    it('adds a filter that can be removed, asks for a second value for Between, and sends it to the check', async () => {
        const el = await mount();
        click($(el, '.rh-add-filter'));
        await settle();
        expect($$(el, '.rh-filter-field')).toHaveLength(3);
        expect($$(el, '.rh-filter-remove')).toHaveLength(1);
        expect($$(el, '.rh-filter-operator')[2].value).toBe('equals');
        change($$(el, '.rh-filter-field')[2], 'Amount__c');
        await settle();
        expect(values($$(el, '.rh-filter-operator')[2].options)).toContain('between');
        change($$(el, '.rh-filter-operator')[2], 'between');
        await settle();
        expect($$(el, '.rh-filter-value-to')).toHaveLength(1);
        change($$(el, '.rh-filter-label')[2], 'Mid-size');
        change($$(el, '.rh-filter-value')[2], '100');
        change($(el, '.rh-filter-value-to'), '500');
        await afterCheck();
        expect(lastDraft().filters).toHaveLength(3);
        expect(lastDraft().filters[2]).toEqual({
            name: null,
            label: 'Mid-size',
            field: 'Amount__c',
            operator: 'between',
            value: '100',
            valueTo: '500',
            inactive: false
        });
        expect($$(el, 'lightning-tab')[3].label).toBe('Filters (2)');
        expect($(el, '.rh-editor-save').disabled).toBe(false);
    });

    it('removes a filter not saved yet', async () => {
        const el = await mount();
        click($(el, '.rh-add-filter'));
        await settle();
        click($(el, '.rh-filter-remove'));
        await afterCheck();
        expect($$(el, '.rh-filter-field')).toHaveLength(2);
        expect(lastDraft().filters.map(f => f.name)).toEqual(['Deals_Open', 'Deals_Recent']);
    });

    it('offers Between only for numbers, dates and times, and fits the condition to a new field', async () => {
        const el = await mount();
        const [stage, close] = $$(el, '.rh-filter-operator');
        expect(values(stage.options)).not.toContain('between');
        expect(values(close.options)).toContain('between');
        // Greater than means nothing for a checkbox: the condition becomes Equals.
        change($$(el, '.rh-filter-field')[1], 'Done__c');
        await afterCheck();
        expect(values($$(el, '.rh-filter-operator')[1].options)).toEqual(['equals', 'not_equals']);
        expect(lastDraft().filters[1]).toMatchObject({ field: 'Done__c', operator: 'equals' });
    });

    it('asks for no value for a blank test', async () => {
        const el = await mount();
        change($$(el, '.rh-filter-operator')[0], 'is_blank');
        await settle();
        expect($$(el, '.rh-filter-value').map(i => i.value)).toEqual(['TODAY-30']);
    });

    it('turns a saved filter off rather than deleting it, and moves filters', async () => {
        const el = await mount();
        change($$(el, '.rh-filter-on')[0], false);
        await settle();
        expect($$(el, 'lightning-tab')[3].label).toBe('Filters (0)');
        const up = $$(el, 'lightning-button-icon[data-list="filters"][data-delta="-1"]');
        expect(up[0].disabled).toBe(true);
        click(up[1]);
        await afterCheck();
        expect($$(el, '.rh-filter-label').map(i => i.value)).toEqual(['Recent', 'Open']);
        expect(lastDraft().filters.map(f => [f.name, f.inactive])).toEqual([
            ['Deals_Recent', true],
            ['Deals_Open', true]
        ]);
    });
});

describe('the record page field', () => {
    it('offers None and the lookups to exactly one object', async () => {
        const el = await mount();
        const box = $(el, '.rh-config-record-page');
        expect(box.options).toEqual([
            { value: '', label: 'None: every record, on any page' },
            { value: 'AccountId', label: 'Account ID (AccountId), on Account pages' }
        ]);
        // None is chosen, not a blank "Select an Option".
        expect(box.value).toBe('');
    });

    it('sends the chosen lookup to the check, and nothing for None', async () => {
        const el = await mount();
        change($(el, '.rh-config-record-page'), 'AccountId');
        await afterCheck();
        expect(lastDraft().config.recordPageField).toBe('AccountId');
        expect($(el, '.rh-config-record-page').value).toBe('AccountId');
        change($(el, '.rh-config-record-page'), '');
        await afterCheck();
        expect(lastDraft().config.recordPageField).toBeNull();
        // Back as it was: nothing to save.
        expect($(el, '.rh-editor-save').disabled).toBe(true);
    });

    it('still shows a saved field the object no longer has', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                d.config.recordPageField = 'Territory__c';
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        const box = $(el, '.rh-config-record-page');
        expect(box.value).toBe('Territory__c');
        expect(box.options).toContainEqual({ value: 'Territory__c', label: 'Territory__c (not on this object)' });
    });
});

describe('formula columns', () => {
    it('shows a saved formula column with its formula, result type and decimals, and no field', async () => {
        const el = await mount();
        expect($$(el, '.rh-column-field').map(c => c.value)).toEqual(['Name', 'AccountId', 'Amount__c']);
        expect($$(el, '.rh-column-formula').map(t => t.value)).toEqual(['Amount__c * 0.1']);
        const type = $(el, '.rh-column-formula-type');
        expect(type.value).toBe('currency');
        expect(type.options).toEqual(FORMULA_TYPES);
        expect($(el, '.rh-column-decimals').value).toBe(2);
        const header = $$(el, '.rh-column-label')[3];
        expect(header.value).toBe('Commission');
        expect(header.required).toBe(true);
        expect(header.placeholder).toBe('Required');
    });

    it('cannot be edited, sorted, grouped or subtotalled, but can wrap and take a width', async () => {
        const el = await mount();
        const at = selector => $$(el, selector)[3];
        expect(at('.rh-column-editable').disabled).toBe(true);
        expect(at('.rh-column-editable').checked).toBe(false);
        expect(at('.rh-column-sortable').disabled).toBe(true);
        expect(at('.rh-column-sortable').checked).toBe(false);
        expect(at('.rh-column-group').disabled).toBe(true);
        expect(at('.rh-column-subtotal').disabled).toBe(true);
        expect(at('.rh-column-wrap').disabled).toBeFalsy();
        expect(at('.rh-column-width').disabled).toBeFalsy();
        // A field column next to it still can.
        expect($$(el, '.rh-column-sortable')[2].disabled).toBe(false);
    });

    it('adds a formula column that needs a formula and a header before the grid can be saved', async () => {
        const el = await mount();
        click($(el, '.rh-add-formula-column'));
        await settle();
        expect($$(el, '.rh-column-field')).toHaveLength(3); // no field list for it
        expect($$(el, '.rh-column-formula').map(t => t.value)).toEqual(['Amount__c * 0.1', '']);
        expect($$(el, '.rh-column-formula-type')[1].value).toBe('number');
        expect($$(el, '.rh-column-decimals')).toHaveLength(2);
        expect($$(el, '.rh-column-label')[4].required).toBe(true);
        expect($$(el, '.rh-column-label')[4].placeholder).toBe('Required');
        expect($$(el, '.rh-column-remove')).toHaveLength(1);
        // The server is sent blank text as nothing, so the editor says what is missing itself.
        expect(errorsText(el)).toContain('Formula column 5: write its formula.');
        expect(errorsText(el)).toContain('Formula column 5: give it a header.');
        await afterCheck();
        expect($(el, '.rh-editor-save').disabled).toBe(true);

        change($$(el, '.rh-column-formula')[1], 'Amount__c * 0.2');
        change($$(el, '.rh-column-label')[4], 'Bonus');
        change($$(el, '.rh-column-decimals')[1], '0');
        await afterCheck();
        expect($(el, '.rh-editor-errors')).toBeNull();
        expect($(el, '.rh-editor-save').disabled).toBe(false);
        expect(lastDraft().columns[4]).toEqual(
            expect.objectContaining({
                name: null,
                field: null,
                formula: 'Amount__c * 0.2',
                formulaType: 'number',
                decimalPlaces: 0,
                columnLabel: 'Bonus',
                editable: false,
                sortable: false,
                inactive: false
            })
        );
    });

    it('names a formula column by its header in its own error', async () => {
        const el = await mount();
        change($(el, '.rh-column-formula'), '   ');
        await settle();
        expect(errorsText(el)).toContain('Commission: write its formula.');
        expect(errorsText(el)).not.toContain('give it a header');
    });

    it('does not ask for the formula of a formula column that is off', async () => {
        const el = await mount();
        click($(el, '.rh-add-formula-column'));
        await settle();
        expect(errorsText(el)).toContain('Formula column 5');
        change($$(el, '.rh-column-on')[4], false);
        await settle();
        expect($(el, '.rh-editor-errors')).toBeNull();
    });

    it('asks for decimal places only for numbers, and clears them for another result type', async () => {
        const el = await mount();
        change($(el, '.rh-column-formula-type'), 'text');
        await afterCheck();
        expect($(el, '.rh-column-decimals')).toBeNull();
        expect(lastDraft().columns[3]).toMatchObject({ formulaType: 'text', decimalPlaces: null });
        change($(el, '.rh-column-formula-type'), 'percent');
        await afterCheck();
        expect($(el, '.rh-column-decimals')).not.toBeNull();
        expect($(el, '.rh-column-decimals').value).toBeNull();
        expect(lastDraft().columns[3]).toMatchObject({ formulaType: 'percent', decimalPlaces: null });
    });

    it('keeps decimal places when the result changes from one number type to another', async () => {
        const el = await mount();
        change($(el, '.rh-column-formula-type'), 'number');
        await afterCheck();
        expect(lastDraft().columns[3]).toMatchObject({ formulaType: 'number', decimalPlaces: 2 });
    });

    it('says how many formulas are used, counting columns and rules that are on', async () => {
        const el = await mount();
        const hint = () => $(el, '.rh-formula-hint').textContent;
        expect(hint()).toContain('1 of 10 formulas used');
        click($(el, '.rh-add-formula-column'));
        await settle();
        expect(hint()).toContain('2 of 10 formulas used');
        change($(el, '.rh-rule-operator'), '__formula');
        await settle();
        expect(hint()).toContain('3 of 10 formulas used');
        change($(el, '.rh-rule-on'), false);
        change($$(el, '.rh-column-on')[4], false);
        await settle();
        expect(hint()).toContain('1 of 10 formulas used');
    });

    it('allows at most 10 formulas, columns and rules together', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                d.columns = [d.columns[0]];
                for (let i = 1; i <= 10; i++) {
                    d.columns.push({
                        name: `Deals_Tier_${i}`,
                        field: null,
                        columnLabel: `Tier ${i} commission`,
                        sortable: false,
                        inactive: false,
                        formula: `Amount__c * ${i}`,
                        formulaType: 'number'
                    });
                }
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect($(el, '.rh-formula-hint').textContent).toContain('10 of 10 formulas used');
        expect($(el, '.rh-editor-errors')).toBeNull();
        // An eleventh, as a formula rule.
        change($(el, '.rh-rule-operator'), '__formula');
        await settle();
        change($(el, '.rh-rule-formula'), 'Done__c');
        await settle();
        expect(errorsText(el)).toContain(
            'A grid has at most 10 formulas, columns and rules together; this one has 11.'
        );
        await afterCheck();
        expect($(el, '.rh-editor-save').disabled).toBe(true);
        // One turned off: within the limit again.
        change($$(el, '.rh-column-on')[1], false);
        await afterCheck();
        expect($(el, '.rh-editor-errors')).toBeNull();
        expect($(el, '.rh-editor-save').disabled).toBe(false);
    });
});

describe('column headers', () => {
    it("suggest what the grid shows for the field, not the field's label", async () => {
        const el = await mount();
        const placeholders = $$(el, '.rh-column-label').map(i => i.placeholder);
        expect(placeholders.slice(0, 3)).toEqual(['Deal Name', 'Account', 'Amount']);
    });

    it('fall back to the label when there is no heading, and follow a new field', async () => {
        const el = await mount();
        click($(el, '.rh-add-column'));
        await settle();
        expect($$(el, '.rh-column-label')[4].placeholder).toBe('');
        change($$(el, '.rh-column-field')[3], 'Score__c');
        await settle();
        expect($$(el, '.rh-column-label')[4].placeholder).toBe('Score');
        change($$(el, '.rh-column-field')[3], 'WhatId');
        await settle();
        expect($$(el, '.rh-column-label')[4].placeholder).toBe('Related To');
    });
});

describe('display rules', () => {
    it('end the conditions with Formula is true, and offer Between for a number', async () => {
        const el = await mount();
        const options = $(el, '.rh-rule-operator').options;
        expect(options[options.length - 1]).toEqual({ value: '__formula', label: 'Formula is true' });
        expect(values(options)).toContain('between');
        // A rule with no field yet still ends with it.
        click($(el, '.rh-add-rule'));
        await settle();
        const fresh = $$(el, '.rh-rule-operator')[1].options;
        expect(fresh[fresh.length - 1].value).toBe('__formula');
        expect(values(fresh)).not.toContain('between');
    });

    it('offer the icons and the data bar as looks', async () => {
        const el = await mount();
        const looks = $(el, '.rh-rule-style').options;
        expect(looks).toEqual(
            expect.arrayContaining([
                { value: 'icon_warning', label: 'Warning icon' },
                { value: 'icon_error', label: 'Error icon' },
                { value: 'icon_success', label: 'Success icon' },
                { value: 'icon_info', label: 'Info icon' },
                { value: 'icon_up', label: 'Up arrow' },
                { value: 'icon_down', label: 'Down arrow' },
                { value: 'data_bar', label: 'Data bar' }
            ])
        );
        change($(el, '.rh-rule-style'), 'data_bar');
        await afterCheck();
        expect(lastDraft().rules[0].style).toBe('data_bar');
    });

    it('become a formula rule with Formula is true, and stop being one with another condition', async () => {
        const el = await mount();
        change($(el, '.rh-rule-operator'), '__formula');
        await settle();
        expect($(el, '.rh-rule-operator').value).toBe('__formula');
        expect($(el, '.rh-rule-formula').value).toBe('');
        expect($(el, '.rh-rule-value')).toBeNull();
        expect($(el, '.rh-rule-value-to')).toBeNull();
        expect($(el, '.rh-rule-compare')).toBeNull();
        expect($(el, '.rh-rule-field').options[0]).toEqual({ value: '', label: 'None (a row rule)' });
        expect(errorsText(el)).toContain('Large deal: write its formula.');
        await afterCheck();
        expect($(el, '.rh-editor-save').disabled).toBe(true);

        change($(el, '.rh-rule-formula'), 'Amount__c > Budget__c');
        change($(el, '.rh-rule-field'), '');
        await afterCheck();
        expect($(el, '.rh-editor-errors')).toBeNull();
        expect(lastDraft().rules[0]).toMatchObject({
            formula: 'Amount__c > Budget__c',
            field: null,
            compareField: null,
            applyTo: 'row'
        });
        expect($(el, '.rh-editor-save').disabled).toBe(false);

        change($(el, '.rh-rule-operator'), 'equals');
        await afterCheck();
        expect($(el, '.rh-rule-formula')).toBeNull();
        expect($(el, '.rh-rule-value')).not.toBeNull();
        expect($(el, '.rh-rule-field').options[0].value).not.toBe('');
        expect(lastDraft().rules[0]).toMatchObject({ formula: null, operator: 'equals' });
    });

    it('read a saved formula rule as one', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                d.rules = [
                    {
                        name: 'Deals_Done',
                        label: 'Done',
                        field: null,
                        operator: null,
                        value: null,
                        formula: 'Done__c',
                        style: 'icon_success',
                        applyTo: 'row',
                        inactive: false
                    }
                ];
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect($(el, '.rh-rule-operator').value).toBe('__formula');
        expect($(el, '.rh-rule-formula').value).toBe('Done__c');
        expect($(el, '.rh-rule-style').value).toBe('icon_success');
        expect($(el, '.rh-formula-hint').textContent).toContain('2 of 10 formulas used');
    });

    it('do not ask for the formula of a formula rule that is off', async () => {
        const el = await mount();
        change($(el, '.rh-rule-operator'), '__formula');
        await settle();
        expect(errorsText(el)).toContain('write its formula');
        change($(el, '.rh-rule-on'), false);
        await settle();
        expect($(el, '.rh-editor-errors')).toBeNull();
    });

    it('ask for a second value for Between, and cannot compare two fields with it', async () => {
        const el = await mount();
        expect($(el, '.rh-rule-value-to')).toBeNull();
        change($(el, '.rh-rule-operator'), 'between');
        await settle();
        expect($(el, '.rh-rule-value').value).toBe('1000');
        expect($(el, '.rh-rule-value-to')).not.toBeNull();
        expect($(el, '.rh-rule-compare')).toBeNull();
        change($(el, '.rh-rule-value-to'), '5000');
        await afterCheck();
        expect(lastDraft().rules[0]).toMatchObject({
            operator: 'between',
            value: '1000',
            valueTo: '5000',
            compareField: null
        });
    });

    it('compare with a value, or with another field of the same kind', async () => {
        const el = await mount();
        const compare = $(el, '.rh-rule-compare');
        expect(compare.value).toBe('');
        expect(compare.options).toEqual([
            { value: '', label: 'A value' },
            { value: 'Budget__c', label: 'Field: Budget (Budget__c)' },
            { value: 'Score__c', label: 'Field: Score (Score__c)' }
        ]);
        change(compare, 'Budget__c');
        await afterCheck();
        expect($(el, '.rh-rule-value')).toBeNull();
        expect($(el, '.rh-rule-compare').value).toBe('Budget__c');
        expect(lastDraft().rules[0]).toMatchObject({
            field: 'Amount__c',
            operator: 'greater_than',
            compareField: 'Budget__c'
        });
        change($(el, '.rh-rule-compare'), '');
        await afterCheck();
        expect($(el, '.rh-rule-value')).not.toBeNull();
        expect(lastDraft().rules[0].compareField).toBeNull();
    });

    it('clear a hidden value when a field is chosen to compare with, as the grid takes one or the other', async () => {
        const el = await mount();
        change($(el, '.rh-rule-compare'), 'Budget__c');
        await afterCheck();
        // The value box is hidden now, so a value left in it could not be cleared.
        expect(lastDraft().rules[0]).toMatchObject({ compareField: 'Budget__c', value: null });
    });

    it('offer dates for a date, and no other field for a multi-select picklist', async () => {
        const el = await mount();
        change($(el, '.rh-rule-field'), 'Close__c');
        await settle();
        expect(values($(el, '.rh-rule-compare').options)).toEqual(['']); // the only date field
        change($(el, '.rh-rule-field'), 'Tags__c');
        await settle();
        expect($(el, '.rh-rule-compare')).toBeNull();
        expect($(el, '.rh-rule-value')).not.toBeNull();
    });

    it('stop comparing with a field when the condition cannot compare', async () => {
        const el = await mount();
        change($(el, '.rh-rule-compare'), 'Budget__c');
        await settle();
        change($(el, '.rh-rule-operator'), 'is_blank');
        await afterCheck();
        expect(lastDraft().rules[0]).toMatchObject({ operator: 'is_blank', compareField: null });
        expect($(el, '.rh-rule-compare')).toBeNull();
    });

    it('stop comparing with a field when Formula is true is chosen', async () => {
        const el = await mount();
        change($(el, '.rh-rule-compare'), 'Budget__c');
        await settle();
        change($(el, '.rh-rule-operator'), '__formula');
        await settle();
        change($(el, '.rh-rule-formula'), 'Done__c');
        await afterCheck();
        expect(lastDraft().rules[0]).toMatchObject({ formula: 'Done__c', compareField: null });
    });

    it('keep the field to compare with for a field of the same kind, and drop it for another kind', async () => {
        const el = await mount();
        change($(el, '.rh-rule-compare'), 'Budget__c');
        await settle();
        change($(el, '.rh-rule-field'), 'Score__c'); // a number, like Budget
        await afterCheck();
        expect(lastDraft().rules[0]).toMatchObject({ field: 'Score__c', compareField: 'Budget__c' });
        change($(el, '.rh-rule-field'), 'Close__c'); // a date
        await afterCheck();
        expect(lastDraft().rules[0]).toMatchObject({ field: 'Close__c', operator: 'greater_than', compareField: null });
    });

    it('do not compare a field with itself when the rule moves to the field it compared with', async () => {
        const el = await mount();
        change($(el, '.rh-rule-compare'), 'Budget__c');
        await settle();
        change($(el, '.rh-rule-field'), 'Budget__c');
        await afterCheck();
        expect(lastDraft().rules[0]).toMatchObject({ field: 'Budget__c', compareField: null });
        expect($(el, '.rh-rule-compare').value).toBe('');
        expect($(el, '.rh-rule-value')).not.toBeNull();
    });
});

describe('a new grid', () => {
    it('drops the filters and the record page field when its object changes', async () => {
        const el = await mount('');
        change($(el, '.rh-config-object'), 'Deal__c');
        await settle();
        await afterCheck();
        change($(el, '.rh-config-record-page'), 'AccountId');
        click($(el, '.rh-add-filter'));
        await settle();
        change($(el, '.rh-filter-field'), 'Amount__c');
        await afterCheck();
        expect(lastDraft().config.recordPageField).toBe('AccountId');
        expect(lastDraft().filters).toHaveLength(1);

        change($(el, '.rh-config-object'), 'Account');
        await settle();
        await afterCheck();
        expect(describeObject).toHaveBeenLastCalledWith({ objectApiName: 'Account' });
        const sent = lastDraft();
        // Sorted by the name column it starts with, A to Z.
        expect(sent.config).toMatchObject({
            objectApiName: 'Account',
            recordPageField: null,
            sortField: 'Name',
            sortDirection: 'asc',
            thenSort: []
        });
        expect(sent.filters).toEqual([]);
        expect(sent.columns.map(c => c.field)).toEqual(['Name']);
        expect($$(el, '.rh-filter-field')).toHaveLength(0);
        expect($$(el, 'lightning-tab')[3].label).toBe('Filters (0)');
        // The new object's own lookups are offered.
        expect(values($(el, '.rh-config-record-page').options)).toEqual(['', 'ParentId']);
    });

    it('shows the filters tab only once the object is chosen', async () => {
        const el = await mount('');
        expect($(el, '.rh-add-filter')).toBeNull();
        expect($(el, '.rh-config-record-page')).toBeNull();
        change($(el, '.rh-config-object'), 'Deal__c');
        await settle();
        expect($(el, '.rh-add-filter')).not.toBeNull();
        expect($(el, '.rh-config-record-page')).not.toBeNull();
    });
});

describe('saving', () => {
    it('sends the filters, the record page field, formula columns and the new rule settings', async () => {
        saveDraft.mockResolvedValue('0Af000000000009');
        saveStatus.mockResolvedValue({ status: 'pending', messages: [] });
        const el = await mount();
        change($(el, '.rh-config-record-page'), 'AccountId');
        // A formula column.
        click($(el, '.rh-add-formula-column'));
        await settle();
        change($$(el, '.rh-column-formula')[1], 'Amount__c - Budget__c');
        change($$(el, '.rh-column-label')[4], 'Over budget by');
        change($$(el, '.rh-column-formula-type')[1], 'currency');
        // The saved rule becomes Between.
        change($(el, '.rh-rule-operator'), 'between');
        await settle();
        change($(el, '.rh-rule-value-to'), '5000');
        // A new rule that compares two fields, with an icon.
        click($(el, '.rh-add-rule'));
        await settle();
        change($$(el, '.rh-rule-label')[1], 'Over budget');
        change($$(el, '.rh-rule-field')[1], 'Amount__c');
        change($$(el, '.rh-rule-operator')[1], 'greater_than');
        await settle();
        change($$(el, '.rh-rule-compare')[0], 'Budget__c');
        change($$(el, '.rh-rule-style')[1], 'icon_warning');
        // A new formula rule for the whole row.
        click($(el, '.rh-add-rule'));
        await settle();
        change($$(el, '.rh-rule-label')[2], 'Done');
        change($$(el, '.rh-rule-operator')[2], '__formula');
        await settle();
        change($(el, '.rh-rule-formula'), 'Done__c');
        change($$(el, '.rh-rule-apply')[2], 'row');
        // A new filter.
        click($(el, '.rh-add-filter'));
        await settle();
        change($$(el, '.rh-filter-field')[2], 'Close__c');
        change($$(el, '.rh-filter-operator')[2], 'between');
        await settle();
        change($$(el, '.rh-filter-value')[2], 'TODAY-30');
        change($(el, '.rh-filter-value-to'), 'TODAY');
        await afterCheck();
        expect($(el, '.rh-editor-errors')).toBeNull();
        expect($(el, '.rh-editor-save').disabled).toBe(false);

        click($(el, '.rh-editor-save'));
        await settle();
        expect(saveDraft).toHaveBeenCalledTimes(1);
        const json = saveDraft.mock.calls[0][0].draftJson;
        expect(json).not.toContain('_key');
        const sent = JSON.parse(json);
        expect(sent.config.recordPageField).toBe('AccountId');
        expect(sent.columns[4]).toMatchObject({
            field: null,
            formula: 'Amount__c - Budget__c',
            formulaType: 'currency',
            columnLabel: 'Over budget by',
            sortable: false
        });
        expect(sent.columns[3]).toMatchObject({
            name: 'Deals_Commission',
            formula: 'Amount__c * 0.1',
            formulaType: 'currency',
            decimalPlaces: 2
        });
        expect(sent.rules).toHaveLength(3);
        expect(sent.rules[0]).toMatchObject({
            name: 'Deals_Large',
            operator: 'between',
            value: '1000',
            valueTo: '5000',
            compareField: null,
            formula: null
        });
        expect(sent.rules[1]).toMatchObject({
            name: null,
            label: 'Over budget',
            field: 'Amount__c',
            operator: 'greater_than',
            compareField: 'Budget__c',
            value: null,
            style: 'icon_warning',
            formula: null
        });
        expect(sent.rules[2]).toMatchObject({
            name: null,
            label: 'Done',
            field: null,
            formula: 'Done__c',
            applyTo: 'row'
        });
        expect(sent.filters).toEqual([
            {
                name: 'Deals_Open',
                label: 'Open',
                field: 'Stage__c',
                operator: 'not_equals',
                value: 'Closed',
                valueTo: null,
                inactive: false
            },
            {
                name: 'Deals_Recent',
                label: 'Recent',
                field: 'Close__c',
                operator: 'greater_than',
                value: 'TODAY-30',
                valueTo: null,
                inactive: true
            },
            {
                name: null,
                label: null,
                field: 'Close__c',
                operator: 'between',
                value: 'TODAY-30',
                valueTo: 'TODAY',
                inactive: false
            }
        ]);
    });

    it('will not save while a formula is missing', async () => {
        const el = await mount();
        click($(el, '.rh-add-formula-column'));
        await afterCheck();
        expect($(el, '.rh-editor-save').disabled).toBe(true);
        click($(el, '.rh-editor-save'));
        await settle();
        expect(saveDraft).not.toHaveBeenCalled();
    });
});

describe('grouping options', () => {
    it('offer Users can group only for a groupable column whose type is not offered anyway, and send it', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                d.columns.push({
                    name: 'Deals_Stage',
                    field: 'Stage__c',
                    columnLabel: null,
                    editable: true,
                    sortable: true,
                    inactive: false,
                    formula: null
                });
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        // Name (text, groupable) has the box; Account (not groupable), Amount, the formula column and Stage (a picklist, offered anyway) have none.
        const boxes = $$(el, '.rh-column-allow-group');
        expect(boxes).toHaveLength(1);
        expect(boxes[0].title).toBe('Users can group by Deal Name');
        expect(boxes[0].checked).toBe(false);
        change(boxes[0], true);
        await afterCheck();
        expect(lastDraft().columns[0].allowGrouping).toBe(true);
    });

    it('offer a date the week and the fiscal periods as units', async () => {
        readConfig.mockResolvedValue({
            draft: draftWith(d => {
                d.columns.push({
                    name: 'Deals_Close',
                    field: 'Close__c',
                    columnLabel: null,
                    editable: true,
                    sortable: true,
                    groupLevel: 1,
                    groupUnit: 'fiscal_quarter',
                    inactive: false,
                    formula: null
                });
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        const unit = $(el, '.rh-column-unit');
        expect(unit.value).toBe('fiscal_quarter');
        expect(values(unit.options)).toEqual([
            'day',
            'week',
            'month',
            'quarter',
            'year',
            'fiscal_quarter',
            'fiscal_year'
        ]);
    });
});

describe('child tables and child total columns', () => {
    const LINE_FIELDS = [
        field('Name', 'Line Name', 'text', { isName: true, subtotals: ['count'] }),
        field('Amount__c', 'Line Amount', 'currency', { subtotals: ['sum', 'average', 'min', 'max', 'count'] }),
        field('Deal__c', 'Deal', 'reference', { referenceTo: ['Deal__c'], subtotals: ['count'] })
    ];
    const WITH_CHILD = {
        ...DESCRIBED,
        children: [{ config: 'Deal_Lines', label: 'Deal Lines', fields: ['Deal__c'], objectApiName: 'Line__c' }]
    };
    const withChild = edit =>
        draftWith(d => {
            d.children = [
                {
                    name: 'Deals_Lines',
                    childConfig: 'Deal_Lines',
                    relationshipField: 'Deal__c',
                    tabLabel: 'Lines',
                    height: null,
                    inactive: false
                }
            ];
            if (edit) edit(d);
        });

    beforeEach(() => {
        describeObject.mockImplementation(({ objectApiName }) =>
            Promise.resolve(
                objectApiName === 'Line__c' ? { name: 'Line__c', fields: LINE_FIELDS, children: [] } : WITH_CHILD
            )
        );
    });

    it('take a Height for each child table, and send it', async () => {
        readConfig.mockResolvedValue({ draft: withChild(), warnings: [], canSave: true });
        const el = await mount();
        const height = $(el, '.rh-child-height');
        expect(height.value).toBeNull();
        change(height, '600');
        await afterCheck();
        expect(lastDraft().children[0].height).toBe(600);
    });

    it('offer a child total column once the grid has a saved child table, on that table, counting its records', async () => {
        readConfig.mockResolvedValue({ draft: draftWith(), warnings: [], canSave: true });
        let el = await mount();
        expect($(el, '.rh-add-child-total')).toBeNull();
        el.remove();
        readConfig.mockResolvedValue({ draft: withChild(), warnings: [], canSave: true });
        el = await mount();
        click($(el, '.rh-add-child-total'));
        await afterCheck();
        const added = lastDraft().columns[lastDraft().columns.length - 1];
        expect(added).toMatchObject({ childTable: 'Deals_Lines', childTotal: 'count', childField: null, field: null });
        expect($(el, '.rh-column-child-table').value).toBe('Deals_Lines');
        expect($(el, '.rh-column-child-field').options.map(o => o.label)).toEqual([
            'Records',
            'Line Name (Name)',
            'Line Amount (Amount__c)',
            'Deal (Deal__c)'
        ]);
        // Its header says what it shows until the admin writes one.
        const headers = $$(el, '.rh-column-label');
        expect(headers[headers.length - 1].placeholder).toBe('Lines');
    });

    it('offer only the fields a total fits, and drop a field the new total does not fit', async () => {
        readConfig.mockResolvedValue({
            draft: withChild(d => {
                d.columns.push({
                    name: 'Deals_Total',
                    field: null,
                    columnLabel: null,
                    childTable: 'Deals_Lines',
                    childTotal: 'count',
                    childField: 'Name',
                    inactive: false,
                    formula: null
                });
            }),
            warnings: [],
            canSave: true
        });
        const el = await mount();
        change($(el, '.rh-column-child-total'), 'sum');
        await afterCheck();
        expect(lastDraft().columns[4]).toMatchObject({ childTotal: 'sum', childField: null });
        expect(values($(el, '.rh-column-child-field').options)).toEqual(['Amount__c']);
        change($(el, '.rh-column-child-field'), 'Amount__c');
        await afterCheck();
        expect(lastDraft().columns[4]).toMatchObject({ childTotal: 'sum', childField: 'Amount__c' });
        const headers = $$(el, '.rh-column-label');
        expect(headers[4].placeholder).toBe('Lines: Sum of Line Amount');
    });
});
