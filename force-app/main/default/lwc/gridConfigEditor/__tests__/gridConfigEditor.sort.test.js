/**
 * The default sort on the Columns tab (mock-up D): a summary over the columns
 * table with Edit sort, the Sort dialog behind it, a badge on each sorted
 * column, and a sort that loses its column taken out, with a note.
 */
import { createElement } from 'lwc';
import GridConfigEditor, { CHECK_DELAY_MS } from 'c/gridConfigEditor';
import readConfig from '@salesforce/apex/GridAdminController.readConfig';
import listObjects from '@salesforce/apex/GridAdminController.listObjects';
import describeObject from '@salesforce/apex/GridAdminController.describeObject';
import checkDraft from '@salesforce/apex/GridAdminController.checkDraft';
import canSave from '@salesforce/apex/GridAdminController.canSave';

jest.mock('@salesforce/apex/GridAdminController.readConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.listObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.describeObject', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.checkDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveDraft', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridAdminController.canSave', () => ({ default: jest.fn() }), { virtual: true });

const mockGenerateUrl = jest.fn(ref => Promise.resolve('/generated?' + JSON.stringify(ref.state)));
jest.mock('lightning/navigation', () => {
    // eslint-disable-next-line no-undef -- a jest.mock factory cannot use the file's imports
    const { createTestWireAdapter } = require('@salesforce/wire-service-jest-util');
    const Navigate = Symbol('Navigate');
    const GenerateUrl = Symbol('GenerateUrl');
    const NavigationMixin = Base =>
        class extends Base {
            [Navigate]() {}
            [GenerateUrl](ref) {
                return mockGenerateUrl(ref);
            }
        };
    NavigationMixin.Navigate = Navigate;
    NavigationMixin.GenerateUrl = GenerateUrl;
    return { NavigationMixin, CurrentPageReference: createTestWireAdapter(jest.fn()) };
});

const FIELDS = [
    {
        name: 'Name',
        label: 'Name',
        type: 'text',
        sortable: true,
        groupable: true,
        editable: true,
        isName: true,
        subtotals: ['count']
    },
    {
        name: 'Amount__c',
        label: 'Amount',
        type: 'currency',
        sortable: true,
        groupable: false,
        editable: true,
        isName: false,
        subtotals: ['sum', 'average', 'min', 'max', 'count']
    },
    {
        name: 'Close__c',
        label: 'Close Date',
        type: 'date',
        sortable: true,
        groupable: true,
        editable: true,
        isName: false,
        subtotals: ['min', 'max', 'count']
    },
    {
        name: 'Score__c',
        label: 'Score',
        type: 'number',
        sortable: true,
        groupable: false,
        editable: false,
        isName: false,
        subtotals: ['sum']
    }
];
const DESCRIBED = {
    name: 'Deal__c',
    label: 'Deal',
    labelPlural: 'Deals',
    fields: FIELDS,
    children: [
        {
            config: 'Deal_Notes',
            label: 'Deal Notes',
            fields: ['Deal__c', 'Parent_Deal__c'],
            fieldLabels: { Deal__c: 'Deal', Parent_Deal__c: 'Parent Deal' }
        }
    ]
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
        allowCsvExport: true
    },
    columns: [
        { name: 'Deals_Name', field: 'Name', columnLabel: null, editable: true, sortable: true, inactive: false },
        {
            name: 'Deals_Amount',
            field: 'Amount__c',
            columnLabel: 'Deal Value',
            editable: true,
            sortable: true,
            subtotal: 'sum',
            inactive: false
        },
        { name: 'Deals_Score', field: 'Score__c', columnLabel: null, editable: false, sortable: true, inactive: true }
    ],
    rules: [
        {
            name: 'Deals_Big',
            label: 'Large deal',
            field: 'Amount__c',
            operator: 'greater_than',
            value: '1000',
            style: 'fill_green',
            applyTo: 'row',
            inactive: false
        }
    ],
    actions: [],
    children: [
        {
            name: 'Deals_Notes',
            childConfig: 'Deal_Notes',
            relationshipField: 'Deal__c',
            tabLabel: 'Notes',
            inactive: false
        }
    ]
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

let events;
async function mount(configName = 'Deals') {
    const el = createElement('c-grid-config-editor', { is: GridConfigEditor });
    el.configName = configName;
    events = [];
    ['saved', 'close', 'lightning__showtoast'].forEach(type =>
        el.addEventListener(type, e => events.push({ type, detail: e.detail }))
    );
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
    readConfig.mockResolvedValue({
        draft: DRAFT,
        warnings: ['Grid Column Deals_Score is inactive, so the grid leaves it out.'],
        canSave: true
    });
    describeObject.mockResolvedValue(DESCRIBED);
    listObjects.mockResolvedValue([
        { name: 'Account', label: 'Account' },
        { name: 'Deal__c', label: 'Deal' }
    ]);
    canSave.mockResolvedValue(true);
    checkDraft.mockResolvedValue({ errors: [], warnings: [] });
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.useRealTimers();
});

const dialog = el => $(el, 'c-grid-sort-dialog');
const summary = el => $(el, '.rh-sort-summary-text').textContent.replace(/\s+/g, ' ').trim();
const badges = el => $$(el, '.rh-sort-badge .slds-assistive-text').map(b => b.textContent);

describe('the default sort on the Columns tab', () => {
    it('is no longer on the Grid tab; the Columns tab says it, and badges the sorted column', async () => {
        const el = await mount();
        expect($$(el, 'lightning-combobox').map(c => c.label)).not.toContain('Sort by');
        expect($$(el, 'lightning-combobox').map(c => c.label)).not.toContain('Sort direction');
        expect(summary(el)).toBe('Opens sorted by Name (ascending)');
        expect(badges(el)).toEqual(['Default sort 1, ascending']);
        expect($(el, '.rh-sort-edit').label).toBe('Edit sort');
    });

    it('Edit sort opens the Sort dialog with the sort and the columns it can use; Done keeps the new sort', async () => {
        const el = await mount();
        expect(dialog(el)).toBeNull();
        click($(el, '.rh-sort-edit'));
        await settle();
        expect(dialog(el).levels).toEqual([{ field: 'Name', direction: 'asc' }]);
        // Score is switched off, so it is not offered; a header is used where there is one.
        expect(dialog(el).options).toEqual([
            { value: 'Name', label: 'Name' },
            { value: 'Amount__c', label: 'Deal Value' }
        ]);
        expect(dialog(el).gridLabel).toBe('Deals');
        dialog(el).dispatchEvent(
            new CustomEvent('save', {
                detail: {
                    levels: [
                        { field: 'Amount__c', direction: 'desc' },
                        { field: 'Name', direction: 'asc' }
                    ]
                }
            })
        );
        await settle();
        expect(dialog(el)).toBeNull();
        expect(summary(el)).toBe('Opens sorted by Deal Value (descending), then Name (ascending)');
        expect(badges(el)).toEqual(['Default sort 2, ascending', 'Default sort 1, descending']);
        await afterCheck();
        expect(lastDraft().config).toMatchObject({
            sortField: 'Amount__c',
            sortDirection: 'desc',
            thenSort: [{ field: 'Name', direction: 'asc' }]
        });
    });

    it('Cancel keeps the sort as it was', async () => {
        const el = await mount();
        checkDraft.mockClear();
        click($(el, '.rh-sort-edit'));
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(dialog(el)).toBeNull();
        expect(summary(el)).toBe('Opens sorted by Name (ascending)');
        await afterCheck();
        expect(checkDraft).not.toHaveBeenCalled();
    });

    it('a sorted column switched off, or no longer sortable, leaves the sort, and the summary says so', async () => {
        readConfig.mockResolvedValue({
            draft: {
                ...DRAFT,
                config: { ...DRAFT.config, thenSort: [{ field: 'Amount__c', direction: 'desc' }] }
            },
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect(summary(el)).toBe('Opens sorted by Name (ascending), then Deal Value (descending)');
        const amountSort = $$(el, '.rh-column-sortable')[1];
        change(amountSort, false);
        await settle();
        expect(summary(el)).toBe('Opens sorted by Name (ascending)');
        expect($(el, '.rh-sort-notice').textContent).toBe(
            'Deal Value was taken out of the default sort, as its column changed.'
        );
        await afterCheck();
        expect(lastDraft().config.thenSort).toEqual([]);
    });

    it('with no sort, says the grid opens in the order Salesforce returns the records', async () => {
        readConfig.mockResolvedValue({
            draft: { ...DRAFT, config: { ...DRAFT.config, sortField: null } },
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect(summary(el)).toBe('No default sort. The grid opens in the order Salesforce returns the records.');
        expect(badges(el)).toEqual([]);
    });

    it('Sort by offers any field the grid can sort by; Then by, the columns', async () => {
        readConfig.mockResolvedValue({
            draft: { ...DRAFT, config: { ...DRAFT.config, sortField: 'Close__c', sortDirection: 'desc' } },
            warnings: [],
            canSave: true
        });
        const el = await mount();
        expect(summary(el)).toBe('Opens sorted by Close Date (descending)');
        expect(badges(el)).toEqual([]); // no column of it
        click($(el, '.rh-sort-edit'));
        await settle();
        expect(dialog(el).firstOptions.map(o => o.value)).toEqual(['Name', 'Amount__c', 'Close__c', 'Score__c']);
        expect(dialog(el).firstOptions[2]).toEqual({ value: 'Close__c', label: 'Close Date (Close__c)' });
        expect(dialog(el).options.map(o => o.value)).toEqual(['Name', 'Amount__c']);
    });

    it('keeps the first sort when its column is switched off: it may be any field', async () => {
        const el = await mount();
        change($$(el, '.rh-column-sortable')[0], false);
        await settle();
        expect(summary(el)).toBe('Opens sorted by Name (ascending)');
        expect($(el, '.rh-sort-notice')).toBeNull();
    });
});
