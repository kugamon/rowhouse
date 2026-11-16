/**
 * Each user's layout. A top-level grid reads the user's saved layout
 * beside its configuration and starts with its sort, grouping, widths, Wrap
 * or Clip and open rows, as far as they still fit the grid. A change to any
 * of them is kept LAYOUT_DELAY_MS after the last one, and at once if the grid
 * goes away first. Reset layout forgets it and puts back the admin's. A
 * layout that cannot be read or kept changes nothing for the user. The
 * user's filters are never part of it. A child table keeps its own for the tab
 * that shows it.
 */
import { createElement } from 'lwc';
import GridView, { readLayout, LAYOUT_DELAY_MS, NARROW_WIDTH, MENU_ITEM_HEIGHT, MENU_CHROME } from 'c/gridView';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import getLayout from '@salesforce/apex/GridController.getLayout';
import saveLayout from '@salesforce/apex/GridController.saveLayout';
import resetLayout from '@salesforce/apex/GridController.resetLayout';
import USER_ID from '@salesforce/user/Id';
import { pendingKey, holdLayout, heldLayout } from 'c/gridPendingLayout';

jest.mock('@salesforce/apex/GridController.getGridConfig', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.openGrid', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.fetchRowsById', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.save', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveStatus', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.deleteRows', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.summarizeGroups', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.countChildren', () => ({ default: jest.fn(() => Promise.resolve({})) }), {
    virtual: true
});
jest.mock('@salesforce/apex/GridController.runAction', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.getLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.saveLayout', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/GridController.resetLayout', () => ({ default: jest.fn() }), { virtual: true });

const COLUMNS = [
    { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, isName: true },
    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', editable: true, sortable: true, scale: 2 },
    {
        field: 'Service_Level__c',
        label: 'Service Level',
        type: 'picklist',
        editable: true,
        sortable: true,
        groupable: true
    },
    { field: 'Ship_Date__c', label: 'Ship Date', type: 'date', editable: true, sortable: true, groupable: true },
    { field: 'Delivery_Notes__c', label: 'Delivery Notes', type: 'textarea', editable: true, sortable: false }
];
// The admin's sort is by Name; the admin sets no grouping.
const DEFINITION = {
    name: 'Consignments',
    label: 'Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: COLUMNS
};
const ADMIN_SORT = [{ field: 'Name', direction: 'asc' }];
const OPEN_ROW = 'a00000000000000001';
// In the order the grid writes it, so the JSON the grid would keep for the
// same layout is the same text.
const SAVED = {
    v: 1,
    sort: [{ field: 'Freight_Charge__c', direction: 'desc' }],
    grouping: [{ field: 'Service_Level__c', unit: null }],
    widths: { Name: 180 },
    wrap: { Name: true },
    expanded: [OPEN_ROW]
};
const SAVED_JSON = JSON.stringify(SAVED);

const row = i => ({
    Id: 'a00' + String(i).padStart(15, '0'),
    Name: 'Kennebec Lumber, load ' + i,
    Freight_Charge__c: i,
    Service_Level__c: 'Standard'
});
const page = (rows, { hasMore = false, locator = null, total = rows.length } = {}) => ({
    rows,
    hasMore,
    cursorLocator: locator,
    cursorToken: null,
    totalRows: total
});

// Resolve every pending promise.
const settle = async () => {
    for (let i = 0; i < 16; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};
const $ = (el, selector) => el.shadowRoot.querySelector(selector);
const table = el => $(el, 'c-grid-table');
const tableConfig = el => table(el).config;
const lastCall = mock => mock.mock.calls[mock.mock.calls.length - 1][0];
const live = el => $(el, '.rh-live').textContent;

const sortChange = (el, sort) => table(el).dispatchEvent(new CustomEvent('sortchange', { detail: { sort } }));
const groupChange = (el, grouping) => table(el).dispatchEvent(new CustomEvent('groupchange', { detail: { grouping } }));
const layoutChange = (el, detail) => table(el).dispatchEvent(new CustomEvent('layoutchange', { detail }));
const filterChange = (el, filters) => table(el).dispatchEvent(new CustomEvent('filterchange', { detail: { filters } }));
/** What the last saveLayout call kept, read back. */
const keptLayout = () => JSON.parse(lastCall(saveLayout).layout);

function mount(configName = 'Consignments') {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = configName;
    document.body.appendChild(el);
    return el;
}

function mountChild() {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = 'Consignment_Items';
    el.parent = { link: 'Consignments_Items', id: 'a00000000000000001', name: 'Kennebec Lumber, load 1', level: 2 };
    document.body.appendChild(el);
    return el;
}

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
    summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: false });
    getLayout.mockResolvedValue(null);
    saveLayout.mockResolvedValue(true);
    resetLayout.mockResolvedValue(undefined);
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
    delete global.ResizeObserver;
});

describe('readLayout', () => {
    const read = layout => readLayout(JSON.stringify(layout), COLUMNS);

    it('reads every part of a layout that fits the grid', () => {
        expect(readLayout(SAVED_JSON, COLUMNS)).toEqual({
            sort: [{ field: 'Freight_Charge__c', direction: 'desc' }],
            grouping: [{ field: 'Service_Level__c', unit: null }],
            widths: { Name: 180 },
            wrap: { Name: true },
            expanded: [OPEN_ROW],
            columns: null,
            frozen: null,
            groupView: null,
            chart: null,
            chartsOpen: false
        });
    });

    it("reads the user's chart as far as it fits the grid, and whether it was open", () => {
        expect(
            read({
                chart: {
                    type: 'donut',
                    measure: 'sum',
                    field: 'Freight_Charge__c',
                    groupBy: 'Service_Level__c',
                    open: true
                }
            })
        ).toEqual(
            expect.objectContaining({
                chart: {
                    type: 'donut',
                    measure: 'sum',
                    field: 'Freight_Charge__c',
                    groupBy: 'Service_Level__c',
                    unit: null
                },
                chartsOpen: true
            })
        );
        // A date gets a unit; a column it can no longer add up is counted instead.
        expect(read({ chart: { type: 'vbar', measure: 'sum', field: 'Name', groupBy: 'Ship_Date__c' } }).chart).toEqual(
            {
                type: 'vbar',
                measure: 'count',
                field: null,
                groupBy: 'Ship_Date__c',
                unit: 'month'
            }
        );
        // A column the grid can no longer group by: no chart, and nothing open.
        expect(read({ chart: { type: 'hbar', measure: 'count', groupBy: 'Rate_Class__c', open: true } })).toEqual(
            expect.objectContaining({ chart: null, chartsOpen: false })
        );
        expect(read({ chart: 'nonsense' }).chart).toBeNull();
    });

    it('reads the columns the user froze, 0 to 5', () => {
        expect(read({ frozen: 2 }).frozen).toBe(2);
        expect(read({ frozen: 0 }).frozen).toBe(0);
        expect(read({ frozen: 6 }).frozen).toBeNull();
        expect(read({ frozen: '2' }).frozen).toBeNull();
        expect(read({}).frozen).toBeNull();
    });

    it("reads the groups' order and percentages", () => {
        expect(read({ groups: { order: { by: 'count', direction: 'asc' }, percent: true } }).groupView).toEqual({
            order: { by: 'count', direction: 'asc' },
            percent: true
        });
        expect(read({ groups: 'nonsense' }).groupView).toBeNull();
        expect(read({ groups: { percent: 'yes' } }).groupView).toEqual({ order: null, percent: false });
    });

    it("reads the user's own columns as far as they fit the grid", () => {
        expect(
            read({
                columns: {
                    order: [
                        'Service_Level__c',
                        'Rate_Class__c',
                        'Name',
                        'Freight_Charge__c',
                        'Ship_Date__c',
                        'Delivery_Notes__c'
                    ],
                    hidden: ['Delivery_Notes__c', 'Rate_Class__c']
                }
            }).columns
        ).toEqual({
            order: ['Service_Level__c', 'Name', 'Freight_Charge__c', 'Ship_Date__c', 'Delivery_Notes__c'],
            hidden: ['Delivery_Notes__c']
        });
        expect(read({ columns: 'nonsense' }).columns).toBeNull();
    });

    it('reads nothing from nothing', () => {
        expect(readLayout(null, COLUMNS)).toBeNull();
        expect(readLayout(undefined, COLUMNS)).toBeNull();
        expect(readLayout('', COLUMNS)).toBeNull();
    });

    it('reads nothing from text that is not JSON, or JSON that is not one object', () => {
        ['{"v":1,', 'not json', '[]', '[{"v":1}]', '"text"', '42', 'true', 'null'].forEach(json => {
            expect(readLayout(json, COLUMNS)).toBeNull();
        });
    });

    it('leaves out sort keys on columns the grid no longer has, or can no longer sort by', () => {
        const layout = read({
            v: 1,
            sort: [
                { field: 'Rate_Class__c', direction: 'asc' },
                { field: 'Delivery_Notes__c', direction: 'asc' },
                null,
                { field: 'Freight_Charge__c', direction: 'desc' },
                { field: 'Name', direction: 'sideways' }
            ]
        });
        // Anything but desc is ascending.
        expect(layout.sort).toEqual([
            { field: 'Freight_Charge__c', direction: 'desc' },
            { field: 'Name', direction: 'asc' }
        ]);
    });

    it("uses no saved sort when no column is left for it, so the admin's applies", () => {
        expect(read({ v: 1, sort: [{ field: 'Rate_Class__c', direction: 'desc' }] }).sort).toBeNull();
        expect(read({ v: 1, sort: 'Freight_Charge__c' }).sort).toBeNull();
        expect(read({ v: 1 }).sort).toBeNull();
    });

    it('keeps a saved choice of no sort at all', () => {
        expect(read({ v: 1, sort: [] }).sort).toEqual([]);
    });

    it('keeps at most five sort keys', () => {
        const many = Array.from({ length: 7 }, (_, i) => ({
            field: 'Stop_' + (i + 1) + '__c',
            label: 'Stop ' + (i + 1),
            type: 'text',
            sortable: true
        }));
        const layout = readLayout(
            JSON.stringify({ v: 1, sort: many.map(c => ({ field: c.field, direction: 'asc' })) }),
            many
        );
        expect(layout.sort.map(k => k.field)).toEqual([
            'Stop_1__c',
            'Stop_2__c',
            'Stop_3__c',
            'Stop_4__c',
            'Stop_5__c'
        ]);
    });

    it('leaves out grouping on columns the grid no longer has or cannot group by, and gives a date its unit', () => {
        const layout = read({
            v: 1,
            grouping: [
                { field: 'Rate_Class__c', unit: null },
                { field: 'Name', unit: null },
                { field: 'Ship_Date__c' },
                { field: 'Service_Level__c', unit: 'year' }
            ]
        });
        expect(layout.grouping).toEqual([
            { field: 'Ship_Date__c', unit: 'month' },
            { field: 'Service_Level__c', unit: null }
        ]);
        expect(read({ v: 1, grouping: [] }).grouping).toEqual([]);
        expect(read({ v: 1, grouping: 'Service_Level__c' }).grouping).toBeNull();
        expect(read({ v: 1 }).grouping).toBeNull();
    });

    it('ignores widths, wrap and open rows of the wrong shape', () => {
        const layout = read({
            v: 1,
            widths: [180],
            wrap: [true],
            expanded: [OPEN_ROW, 5, null, { id: 'a00000000000000002' }]
        });
        expect(layout.widths).toBeNull();
        expect(layout.wrap).toEqual({});
        expect(layout.expanded).toEqual([OPEN_ROW]);
        const other = read({ v: 1, widths: 'wide', wrap: 'yes', expanded: OPEN_ROW });
        expect(other).toMatchObject({ widths: null, wrap: {}, expanded: [] });
        expect(read({ v: 1 })).toMatchObject({ widths: null, wrap: {}, expanded: [] });
    });

    it('keeps no sort key when it is given no columns', () => {
        expect(readLayout(SAVED_JSON, undefined).sort).toBeNull();
        expect(readLayout(SAVED_JSON, null).sort).toBeNull();
    });
});

describe('starting from the saved layout', () => {
    it('asks for the layout beside the configuration, not after it', async () => {
        getGridConfig.mockReturnValue(new Promise(() => {}));
        mount();
        await settle();
        expect(getLayout).toHaveBeenCalledTimes(1);
        expect(getLayout).toHaveBeenCalledWith({ configName: 'Consignments' });
    });

    it('starts with the saved sort and grouping, and hands the table the rest', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        // The server is asked for the rows in the saved order, in the saved groups.
        expect(fetchRows.mock.calls[0][0]).toMatchObject({
            sortField: 'Freight_Charge__c',
            sortDirection: 'desc',
            groupBy: ['Service_Level__c']
        });
        expect(summarizeGroups.mock.calls[0][0]).toMatchObject({ grouping: ['Service_Level__c'] });
        const cfg = tableConfig(el);
        expect(cfg.sort).toEqual([{ field: 'Freight_Charge__c', direction: 'desc' }]);
        expect(cfg.grouping).toEqual([{ field: 'Service_Level__c', unit: null }]);
        expect(cfg.userLayout).toEqual({
            key: expect.any(Number),
            widths: { Name: 180 },
            wrap: { Name: true },
            expanded: [OPEN_ROW],
            groupView: null,
            frozen: null,
            sort: [{ field: 'Freight_Charge__c', direction: 'desc' }]
        });
        expect($(el, '.rh-sorted').textContent).toBe('Sorted by Freight Charge');
    });

    it('opens as the admin set it up when nothing is saved, and offers no reset', async () => {
        for (const nothing of [null, '', undefined]) {
            getLayout.mockResolvedValue(nothing);
            const el = mount();
            // eslint-disable-next-line no-await-in-loop
            await settle();
            expect(fetchRows.mock.calls[0][0]).toMatchObject({ sortField: 'Name', sortDirection: 'asc' });
            expect(fetchRows.mock.calls[0][0].groupBy).toBeUndefined();
            expect(tableConfig(el).sort).toEqual(ADMIN_SORT);
            expect(tableConfig(el).grouping).toEqual([]);
            expect(tableConfig(el).userLayout).toBeNull();
            expect($(el, '.rh-reset-layout')).toBeNull();
            el.remove();
            fetchRows.mockClear();
        }
    });

    it("uses the admin's sort when no saved sort key is left, and leaves out what cannot be grouped", async () => {
        getLayout.mockResolvedValue(
            JSON.stringify({
                v: 1,
                sort: [
                    { field: 'Rate_Class__c', direction: 'desc' },
                    { field: 'Delivery_Notes__c', direction: 'desc' }
                ],
                grouping: [{ field: 'Name', unit: null }]
            })
        );
        const el = mount();
        await settle();
        expect(fetchRows.mock.calls[0][0]).toMatchObject({ sortField: 'Name', sortDirection: 'asc' });
        expect(fetchRows.mock.calls[0][0].groupBy).toBeUndefined();
        expect(tableConfig(el).sort).toEqual(ADMIN_SORT);
        expect(tableConfig(el).userLayout.sort).toEqual(ADMIN_SORT);
        expect(tableConfig(el).grouping).toEqual([]);
    });

    it('opens as the admin set it up when the saved layout is not JSON, and offers to reset it', async () => {
        getLayout.mockResolvedValue('{"v":1,"sort":');
        const el = mount();
        await settle();
        expect(tableConfig(el).sort).toEqual(ADMIN_SORT);
        expect(tableConfig(el).userLayout).toBeNull();
        expect($(el, '.rh-load-error')).toBeNull();
        expect($(el, '.rh-reset-layout')).not.toBeNull();
    });

    it('opens normally when the layout cannot be read, says nothing, and does not try to keep changes', async () => {
        getLayout.mockRejectedValue({ body: { message: 'Insufficient access to Grid User Layout.' } });
        const info = jest.spyOn(console, 'info').mockImplementation(() => {});
        const el = mount();
        await settle();
        expect(tableConfig(el).rows).toHaveLength(3);
        expect(tableConfig(el).sort).toEqual(ADMIN_SORT);
        expect(tableConfig(el).userLayout).toBeNull();
        expect($(el, '.rh-load-error')).toBeNull();
        expect($(el, '.rh-notice')).toBeNull();
        expect($(el, '.rh-reset-layout')).toBeNull();
        expect(info).not.toHaveBeenCalled();

        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).not.toHaveBeenCalled();
        info.mockRestore();
    });

    it('tells only Rowhouse Grid Diagnostics users, in the console, that the layout could not be read', async () => {
        getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: true });
        getLayout.mockRejectedValue({ body: { message: 'Insufficient access to Grid User Layout.' } });
        const info = jest.spyOn(console, 'info').mockImplementation(() => {});
        mount();
        await settle();
        const lines = info.mock.calls.map(([, json]) => JSON.parse(json)).filter(e => e.event === 'layout');
        expect(lines).toEqual([
            expect.objectContaining({
                source: 'rowhouse',
                grid: 'Consignments',
                error: 'Insufficient access to Grid User Layout.'
            })
        ]);
        info.mockRestore();
    });

    it('a child table reads and keeps its own layout for its tab', async () => {
        getLayout.mockResolvedValue(
            JSON.stringify({ v: 1, sort: [{ field: 'Freight_Charge__c', direction: 'desc' }], frozen: 1 })
        );
        const el = mountChild();
        await settle();
        expect(getGridConfig).toHaveBeenCalledWith({ configName: 'Consignment_Items' });
        expect(getLayout).toHaveBeenCalledWith({ configName: 'Consignment_Items', parentLink: 'Consignments_Items' });
        expect(tableConfig(el).userLayout).toEqual(
            expect.objectContaining({ sort: [{ field: 'Freight_Charge__c', direction: 'desc' }], frozen: 1 })
        );
        layoutChange(el, { widths: { Name: 220 }, wrap: {}, expanded: [], frozen: 2 });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledWith({
            configName: 'Consignment_Items',
            layout: expect.any(String),
            parentLink: 'Consignments_Items'
        });
        expect(keptLayout()).toEqual(expect.objectContaining({ widths: { Name: 220 }, frozen: 2 }));
    });

    it('Reset layout in a child table forgets the layout of its tab', async () => {
        getLayout.mockResolvedValue(
            JSON.stringify({ v: 1, sort: [{ field: 'Freight_Charge__c', direction: 'desc' }] })
        );
        const el = mountChild();
        await settle();
        // A child table's actions are in one menu.
        const items = [...el.shadowRoot.querySelectorAll('lightning-menu-item')].map(i => i.label);
        expect(items).toContain('Reset layout');
        $(el, '.rh-actions-menu').dispatchEvent(new CustomEvent('select', { detail: { value: 'reset' } }));
        await settle();
        expect(resetLayout).toHaveBeenCalledWith({ configName: 'Consignment_Items', parentLink: 'Consignments_Items' });
    });
});

describe("a child table's actions menu", () => {
    const rect = (el, box) => {
        el.getBoundingClientRect = () => ({ left: 0, right: 300, width: 300, ...box });
    };

    it('makes room for the whole menu while it is open, so the panel grows to hold it', async () => {
        const el = mountChild();
        await settle();
        const root = $(el, '[data-view-root]');
        const menu = $(el, '.rh-actions-menu');
        rect(root, { top: 100, bottom: 200, height: 100 });
        rect(menu, { top: 108, bottom: 140, height: 32 });
        const items = el.shadowRoot.querySelectorAll('lightning-menu-item').length;
        menu.dispatchEvent(new CustomEvent('open'));
        await settle();
        const need = 40 + items * MENU_ITEM_HEIGHT + MENU_CHROME;
        expect(need).toBeGreaterThan(100);
        expect(root.style.minHeight).toBe(`${need}px`);
        menu.dispatchEvent(new CustomEvent('close'));
        await settle();
        expect(root.style.minHeight).toBe('');
    });

    it('adds nothing when the grid is already tall enough', async () => {
        const el = mountChild();
        await settle();
        const root = $(el, '[data-view-root]');
        const menu = $(el, '.rh-actions-menu');
        rect(root, { top: 100, bottom: 700, height: 600 });
        rect(menu, { top: 108, bottom: 140, height: 32 });
        menu.dispatchEvent(new CustomEvent('open'));
        await settle();
        expect(root.style.minHeight).toBe('');
    });
});

describe('keeping changes', () => {
    it(`keeps a new sort ${LAYOUT_DELAY_MS}ms after it, as JSON`, async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS - 1);
        expect(saveLayout).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(saveLayout).toHaveBeenCalledWith({
            configName: 'Consignments',
            layout: expect.any(String),
            parentLink: null
        });
        // Only what the user set: no widths, wrap or open rows yet.
        expect(keptLayout()).toEqual({ v: 1, sort: [{ field: 'Freight_Charge__c', direction: 'desc' }], grouping: [] });
    });

    it('sends one save for several quick changes, with all of them, after the last one', async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS - 500);
        groupChange(el, [{ field: 'Ship_Date__c', unit: 'quarter' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS - 500);
        layoutChange(el, { widths: { Name: 200 }, wrap: { Delivery_Notes__c: false }, expanded: [OPEN_ROW] });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS - 1);
        expect(saveLayout).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(1);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(keptLayout()).toEqual({
            v: 1,
            sort: [{ field: 'Freight_Charge__c', direction: 'desc' }],
            grouping: [{ field: 'Ship_Date__c', unit: 'quarter' }],
            widths: { Name: 200 },
            wrap: { Delivery_Notes__c: false },
            expanded: [OPEN_ROW]
        });
    });

    it('keeps a grouping change on its own', async () => {
        const el = mount();
        await settle();
        groupChange(el, [{ field: 'Service_Level__c', unit: null }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout()).toEqual({ v: 1, grouping: [{ field: 'Service_Level__c', unit: null }] });
    });

    it("keeps the groups' order and percentages, and leaves them out when they are the default", async () => {
        const el = mount();
        await settle();
        layoutChange(el, {
            widths: null,
            wrap: {},
            expanded: [],
            groupView: { order: { by: 'count', direction: 'desc' }, percent: true }
        });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout().groups).toEqual({ order: { by: 'count', direction: 'desc' }, percent: true });
        layoutChange(el, {
            widths: null,
            wrap: {},
            expanded: [],
            groupView: { order: { by: 'name', direction: 'asc' }, percent: false }
        });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout().groups).toBeUndefined();
    });

    it('leaves out widths, wrap and open rows the table reports as unset', async () => {
        const el = mount();
        await settle();
        layoutChange(el, { widths: null, wrap: {}, expanded: [] });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(Object.keys(keptLayout())).toEqual(['v', 'grouping']);
        layoutChange(el, { widths: {}, wrap: null, expanded: 'none' });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        // The same layout as before: nothing new to send.
        expect(saveLayout).toHaveBeenCalledTimes(1);
    });

    it('does not send a layout that is already kept', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        // Back to the saved sort: the layout is the one already kept.
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).not.toHaveBeenCalled();

        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(keptLayout()).toEqual({ ...SAVED, sort: [{ field: 'Name', direction: 'desc' }] });

        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledTimes(1);
    });

    it('offers Reset layout once a change is kept', async () => {
        const el = mount();
        await settle();
        expect($(el, '.rh-reset-layout')).toBeNull();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        await settle();
        expect($(el, '.rh-reset-layout')).not.toBeNull();
    });

    it('stops trying once the server says the layout was not kept, and says nothing', async () => {
        saveLayout.mockResolvedValue(false);
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        await settle();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect($(el, '.rh-notice')).toBeNull();
        expect($(el, '.rh-reset-layout')).toBeNull();

        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        groupChange(el, [{ field: 'Service_Level__c', unit: null }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        el.remove();
        expect(saveLayout).toHaveBeenCalledTimes(1);
    });

    it('stops trying once a save fails, and says nothing', async () => {
        saveLayout.mockRejectedValue({ body: { message: 'Storage limit exceeded' } });
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        await settle();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect($(el, '.rh-notice')).toBeNull();

        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).toHaveBeenCalledTimes(1);
    });

    it('sends a waiting change at once when the grid goes away', async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        el.remove();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(lastCall(saveLayout).configName).toBe('Consignments');
        expect(keptLayout().sort).toEqual([{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).toHaveBeenCalledTimes(1);
    });

    it('sends nothing when the grid goes away with no change waiting', async () => {
        const el = mount();
        await settle();
        el.remove();
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).not.toHaveBeenCalled();
    });

    it('sends a waiting change before the grid loads again for another record', async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        el.recordId = '001000000000001AAA';
        await settle();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(lastCall(saveLayout).configName).toBe('Consignments');
        expect(keptLayout().sort).toEqual([{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).toHaveBeenCalledTimes(1);
    });

    it("never keeps one grid's layout under another grid's name", async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        el.configName = 'Freight_Claims';
        await settle();
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout.mock.calls.filter(([args]) => args.configName === 'Freight_Claims')).toHaveLength(0);
    });

    it('keeps a waiting change for the grid it was made on when the grid changes', async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        el.configName = 'Freight_Claims';
        await settle();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(lastCall(saveLayout).configName).toBe('Consignments');
        expect(keptLayout().sort).toEqual([{ field: 'Freight_Charge__c', direction: 'desc' }]);
    });

    it("a late failure for the grid before does not stop keeping the next one's", async () => {
        let failFirst;
        saveLayout.mockImplementationOnce(
            () =>
                new Promise((resolve, reject) => {
                    failFirst = reject;
                })
        );
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        el.configName = 'Freight_Claims';
        await settle();
        failFirst({ body: { message: 'Read timed out' } });
        await settle();
        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        await settle();
        expect(saveLayout).toHaveBeenCalledTimes(2);
        expect(lastCall(saveLayout).configName).toBe('Freight_Claims');
    });

    it("never keeps the user's filters", async () => {
        const el = mount();
        await settle();
        filterChange(el, [{ field: 'Service_Level__c', operator: 'equals', value: 'Express', valueTo: null }]);
        await settle();
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        // A filter alone is not a layout change.
        expect(saveLayout).not.toHaveBeenCalled();

        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(Object.keys(keptLayout())).toEqual(['v', 'sort', 'grouping']);
        expect(lastCall(saveLayout).layout).not.toContain('Express');
    });
});

describe('a change made just before the page is left (issue: lost on a quick reload)', () => {
    const KEY = pendingKey(USER_ID, 'Consignments', null);
    const DESC = [{ field: 'Freight_Charge__c', direction: 'desc' }];
    const hidden = state =>
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });

    afterEach(() => {
        delete document.visibilityState;
    });

    it('is kept at once when the page is left, without waiting for the delay', async () => {
        const el = mount();
        await settle();
        sortChange(el, DESC);
        window.dispatchEvent(new CustomEvent('pagehide'));
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(keptLayout().sort).toEqual(DESC);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        el.remove();
    });

    it('is kept at once when the page is hidden, and not when it is shown again', async () => {
        const el = mount();
        await settle();
        sortChange(el, DESC);
        hidden('visible');
        document.dispatchEvent(new CustomEvent('visibilitychange'));
        expect(saveLayout).not.toHaveBeenCalled();
        hidden('hidden');
        document.dispatchEvent(new CustomEvent('visibilitychange'));
        expect(saveLayout).toHaveBeenCalledTimes(1);
        el.remove();
    });

    it('is held in the browser until the server has kept it', async () => {
        let keep;
        saveLayout.mockReturnValue(
            new Promise(resolve => {
                keep = resolve;
            })
        );
        const el = mount();
        await settle();
        sortChange(el, DESC);
        expect(JSON.parse(heldLayout(KEY).json).sort).toEqual(DESC);
        expect(heldLayout(KEY).base).toBeNull();
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(heldLayout(KEY)).not.toBeNull(); // sent, not yet kept
        keep(true);
        await settle();
        expect(heldLayout(KEY)).toBeNull();
        el.remove();
    });

    it('stays held when the request fails, so the next opening keeps it', async () => {
        saveLayout.mockRejectedValue({ body: { message: 'Request aborted' } });
        const el = mount();
        await settle();
        sortChange(el, DESC);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        await settle();
        expect(heldLayout(KEY)).not.toBeNull();
        el.remove();
    });

    it('holds a later change over the one that failed, without sending it, so the latest wins next time', async () => {
        saveLayout.mockRejectedValue({ body: { message: 'Request aborted' } });
        const el = mount();
        await settle();
        sortChange(el, DESC);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        await settle();
        expect(saveLayout).toHaveBeenCalledTimes(1);
        const later = [{ field: 'Freight_Charge__c', direction: 'asc' }];
        sortChange(el, later);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(heldLayout(KEY).json).sort).toEqual(later);
        el.remove();
    });

    it('is used and kept when the grid opens again and nothing was kept since', async () => {
        const held = JSON.stringify({ v: 1, sort: DESC, grouping: [], widths: { Name: 240 } });
        holdLayout(KEY, held, null);
        getLayout.mockResolvedValue(null);
        const el = mount();
        await settle();
        expect(tableConfig(el).sort).toEqual(DESC);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(keptLayout()).toEqual(JSON.parse(held));
        await settle();
        expect(heldLayout(KEY)).toBeNull();
        // Kept: Reset layout is offered.
        expect($(el, '.rh-reset-layout')).not.toBeNull();
    });

    it('rests on the layout the server had, and is used over it', async () => {
        const held = JSON.stringify({ ...SAVED, sort: [{ field: 'Name', direction: 'desc' }] });
        holdLayout(KEY, held, SAVED_JSON);
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        expect(tableConfig(el).sort).toEqual([{ field: 'Name', direction: 'desc' }]);
        expect(keptLayout().sort).toEqual([{ field: 'Name', direction: 'desc' }]);
    });

    it('is let go when a layout was kept since, on another device or in another tab', async () => {
        holdLayout(KEY, JSON.stringify({ v: 1, sort: DESC, grouping: [] }), null);
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        expect(tableConfig(el).sort).toEqual(SAVED.sort);
        expect(saveLayout).not.toHaveBeenCalled();
        expect(heldLayout(KEY)).toBeNull();
    });

    it('is let go when the request did arrive', async () => {
        holdLayout(KEY, SAVED_JSON, null);
        getLayout.mockResolvedValue(SAVED_JSON);
        mount();
        await settle();
        expect(saveLayout).not.toHaveBeenCalled();
        expect(heldLayout(KEY)).toBeNull();
    });

    it("is never used for another user's grid in the same browser", async () => {
        holdLayout(pendingKey('005000000000099AAA', 'Consignments', null), SAVED_JSON, null);
        const el = mount();
        await settle();
        expect(tableConfig(el).sort).toEqual(ADMIN_SORT);
        expect(saveLayout).not.toHaveBeenCalled();
    });

    it('goes with Reset layout', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        sortChange(el, DESC);
        expect(heldLayout(KEY)).not.toBeNull();
        $(el, '.rh-reset-layout').click();
        await settle();
        expect(resetLayout).toHaveBeenCalled();
        expect(heldLayout(KEY)).toBeNull();
    });

    it('stops listening to the page once the grid is gone', async () => {
        const el = mount();
        await settle();
        el.remove();
        window.dispatchEvent(new CustomEvent('pagehide'));
        hidden('hidden');
        document.dispatchEvent(new CustomEvent('visibilitychange'));
        expect(saveLayout).not.toHaveBeenCalled();
    });
});

describe('Reset layout', () => {
    const reset = el => $(el, '.rh-reset-layout').click();

    it('is a button in the toolbar once a layout is kept', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        const button = $(el, '.rh-reset-layout');
        expect(button.alternativeText).toBe('Reset layout');
        expect(button.title).toMatch(/^Reset layout/);
    });

    it("forgets the layout and puts back the admin's sort and grouping", async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        const before = tableConfig(el).userLayout.key;
        reset(el);
        await settle();
        expect(resetLayout).toHaveBeenCalledWith({ configName: 'Consignments', parentLink: null });
        const cfg = tableConfig(el);
        expect(cfg.grouping).toEqual([]);
        // A new key, so the table applies it: the admin's sort, no widths, wrap or open rows.
        expect(cfg.userLayout).toEqual({
            key: expect.any(Number),
            widths: null,
            wrap: {},
            expanded: [],
            groupView: null,
            frozen: null,
            sort: ADMIN_SORT
        });
        expect(cfg.userLayout.key).not.toBe(before);
        expect($(el, '.rh-sorted').textContent).toBe('Sorted by Name');
        expect($(el, '.rh-reset-layout')).toBeNull();
        expect(live(el)).toBe('Layout reset. The grid is as your admin set it up.');
    });

    it("puts back the admin's own grouping", async () => {
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, grouping: [{ field: 'Ship_Date__c', unit: 'year' }] },
            diagnostics: false
        });
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        expect(tableConfig(el).grouping).toEqual([{ field: 'Service_Level__c', unit: null }]);
        summarizeGroups.mockClear();
        reset(el);
        await settle();
        expect(tableConfig(el).grouping).toEqual([{ field: 'Ship_Date__c', unit: 'year' }]);
        // New groups need new counts.
        expect(summarizeGroups).toHaveBeenCalledWith(expect.objectContaining({ grouping: ['Ship_Date__c:year'] }));
    });

    it("asks for the rows again in the admin's order when not every row is loaded", async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        // 50,000 matching rows: the grid preloads some and leaves the rest on the server.
        let next = 0;
        fetchRows.mockImplementation(({ pageSize }) => {
            const rows = Array.from({ length: pageSize == null ? 200 : pageSize }, () => row(++next));
            return Promise.resolve(page(rows, { hasMore: true, locator: 'fp:' + next, total: 50000 }));
        });
        const el = mount();
        for (let i = 0; i < 4; i++) {
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        expect(tableConfig(el).hasMore).toBe(true);
        fetchRows.mockClear();
        reset(el);
        await settle();
        expect(fetchRows.mock.calls[0][0]).toMatchObject({
            sortField: 'Name',
            sortDirection: 'asc',
            cursorLocator: null
        });
        expect(fetchRows.mock.calls[0][0].groupBy).toBeUndefined();
    });

    it("with every row loaded, reads them again in the admin's order: its sort field need not be a column", async () => {
        // Found live: the rows were read in the saved order, and the admin's sort
        // field (LastName) was not a column the browser could sort by.
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        fetchRows.mockClear();
        reset(el);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows.mock.calls[0][0]).toMatchObject({
            sortField: 'Name',
            sortDirection: 'asc',
            cursorLocator: null
        });
    });

    it('with every row loaded and the same sort, asks for nothing', async () => {
        getLayout.mockResolvedValue(JSON.stringify({ v: 1, sort: ADMIN_SORT, grouping: [], wrap: { Name: true } }));
        const el = mount();
        await settle();
        fetchRows.mockClear();
        reset(el);
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
    });

    it('says so when the layout cannot be reset, and changes nothing', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        resetLayout.mockRejectedValue({ body: { message: 'Unable to lock row.' } });
        const el = mount();
        await settle();
        const before = tableConfig(el).userLayout;
        reset(el);
        await settle();
        expect($(el, '.rh-notice').textContent).toBe('The layout could not be reset. Unable to lock row.');
        expect(tableConfig(el).userLayout).toEqual(before);
        expect(tableConfig(el).grouping).toEqual([{ field: 'Service_Level__c', unit: null }]);
        expect($(el, '.rh-sorted').textContent).toBe('Sorted by Freight Charge');
        expect($(el, '.rh-reset-layout')).not.toBeNull();
    });

    it('drops a change still waiting to be kept', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        reset(el);
        await settle();
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS * 2);
        el.remove();
        expect(saveLayout).not.toHaveBeenCalled();
    });

    it('waits for a save still on its way, so it cannot bring the layout back', async () => {
        let finishSave;
        saveLayout.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishSave = resolve;
                })
        );
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Name', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        reset(el);
        await settle();
        expect(resetLayout).not.toHaveBeenCalled();
        finishSave(true);
        await settle();
        expect(resetLayout).toHaveBeenCalledWith({ configName: 'Consignments', parentLink: null });
        await settle();
        expect($(el, '.rh-reset-layout')).toBeNull();
        expect(tableConfig(el).userLayout.sort).toEqual(ADMIN_SORT);
    });

    it('keeps changes again afterwards', async () => {
        getLayout.mockResolvedValue(SAVED_JSON);
        const el = mount();
        await settle();
        reset(el);
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(saveLayout).toHaveBeenCalledTimes(1);
        expect(keptLayout()).toEqual({ v: 1, sort: [{ field: 'Freight_Charge__c', direction: 'desc' }], grouping: [] });
    });

    it('is in the actions menu when the toolbar is narrow, once a layout is kept', async () => {
        // The table measures itself too: narrow the grid through the observer on the grid's own root.
        let observers = [];
        global.ResizeObserver = class {
            constructor(cb) {
                this.cb = cb;
                observers.push(this);
            }
            observe(target) {
                this.target = target;
            }
            disconnect() {}
        };
        const narrow = () =>
            observers
                .filter(o => o.target && o.target.hasAttribute('data-view-root'))
                .forEach(o => o.cb([{ contentRect: { width: NARROW_WIDTH - 80 } }]));
        const items = el =>
            [...el.shadowRoot.querySelectorAll('.rh-actions-menu lightning-menu-item')].map(i => i.label);
        let el = mount();
        await settle();
        narrow();
        await settle();
        expect(items(el)).toEqual(['Refresh', 'Choose columns', 'Export', 'Charts', 'Filters', 'Help']);
        el.remove();

        observers = [];
        getLayout.mockResolvedValue(SAVED_JSON);
        el = mount();
        await settle();
        narrow();
        await settle();
        expect($(el, '.rh-reset-layout')).toBeNull();
        expect(items(el)).toContain('Reset layout');
        $(el, '.rh-actions-menu').dispatchEvent(new CustomEvent('select', { detail: { value: 'reset' } }));
        await settle();
        expect(resetLayout).toHaveBeenCalledWith({ configName: 'Consignments', parentLink: null });
        expect(items(el)).not.toContain('Reset layout');
    });
});

describe("the admin's sort of several columns", () => {
    // The admin sorts by Name, then by Ship Date, newest first.
    const THEN = { ...DEFINITION, thenSort: [{ field: 'Ship_Date__c', direction: 'desc' }] };
    const BOTH = [
        { field: 'Name', direction: 'asc' },
        { field: 'Ship_Date__c', direction: 'desc' }
    ];

    beforeEach(() => {
        getGridConfig.mockResolvedValue({ definition: THEN, diagnostics: false });
    });

    it('opens sorted by every level, in the order the first page came in', async () => {
        const el = mount();
        await settle();
        expect(tableConfig(el).sort).toEqual(BOTH);
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows.mock.calls[0][0].thenSort).toEqual([{ field: 'Ship_Date__c', direction: 'desc' }]);
        expect($(el, '.rh-sorted').textContent).toBe('Sorted by Name, then Ship Date');
    });

    it('asks again when the first page came in another order', async () => {
        openGrid.mockImplementation(async args => {
            const answer = await openGridFrom({ getGridConfig, getLayout, fetchRows })(args);
            return { ...answer, start: { ...answer.start, thenSort: [] } };
        });
        const el = mount();
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(2);
        expect(lastCall(fetchRows).sortField).toBe('Name');
        expect(lastCall(fetchRows).thenSort).toEqual([{ field: 'Ship_Date__c', direction: 'desc' }]);
        expect(tableConfig(el).sort).toEqual(BOTH);
    });

    it("sends the user's own sorts after the first when the rows come again", async () => {
        fetchRows.mockResolvedValue(page([row(1), row(2)], { hasMore: true, locator: 'L1', total: 900 }));
        const el = mount();
        await settle();
        sortChange(el, [
            { field: 'Freight_Charge__c', direction: 'desc' },
            { field: 'Name', direction: 'asc' }
        ]);
        await settle();
        expect(lastCall(fetchRows).sortField).toBe('Freight_Charge__c');
        expect(lastCall(fetchRows).thenSort).toEqual([{ field: 'Name', direction: 'asc' }]);
    });

    it("keeps no sort while it is the admin's, so the admin's later change reaches the user", async () => {
        const el = mount();
        await settle();
        layoutChange(el, { widths: { Name: 240 } });
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout().sort).toBeUndefined();
        expect(keptLayout().widths).toEqual({ Name: 240 });
        const kept = lastCall(saveLayout).layout;
        el.remove();

        // The admin now sorts by Ship Date alone, oldest first.
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, sortField: 'Ship_Date__c', sortDirection: 'asc', thenSort: [] },
            diagnostics: false
        });
        getLayout.mockResolvedValue(kept);
        const again = mount();
        await settle();
        expect(tableConfig(again).sort).toEqual([{ field: 'Ship_Date__c', direction: 'asc' }]);
        expect(tableConfig(again).userLayout.widths).toEqual({ Name: 240 });
    });

    it("keeps the user's own sort, and Reset layout brings back every level of the admin's", async () => {
        const el = mount();
        await settle();
        sortChange(el, [{ field: 'Freight_Charge__c', direction: 'desc' }]);
        await jest.advanceTimersByTimeAsync(LAYOUT_DELAY_MS);
        expect(keptLayout().sort).toEqual([{ field: 'Freight_Charge__c', direction: 'desc' }]);
        $(el, '.rh-reset-layout').click();
        await settle();
        expect(tableConfig(el).sort).toEqual(BOTH);
        expect($(el, '.rh-sorted').textContent).toBe('Sorted by Name, then Ship Date');
    });
});
