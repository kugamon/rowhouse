import { createElement } from 'lwc';
import GridView, {
    PRELOAD_ROWS,
    MAX_LOADED_ROWS,
    FOLLOW_PAGE_SIZE,
    SEARCH_DELAY_MS,
    MAX_SELECTED,
    DELETE_BATCH,
    MAX_LEVELS,
    messageOf,
    PLACEHOLDER_ROWS,
    COUNT_BATCH,
    NARROW_WIDTH
} from 'c/gridView';
import { childTableHeight } from 'c/gridChildTables';
import getGridConfig from '@salesforce/apex/GridController.getGridConfig';
import openGrid from '@salesforce/apex/GridController.openGrid';
import { openGridFrom } from './openGridFrom';
import fetchRows from '@salesforce/apex/GridController.fetchRows';
import fetchRowsById from '@salesforce/apex/GridController.fetchRowsById';
import saveRows from '@salesforce/apex/GridController.save';
import saveStatus from '@salesforce/apex/GridController.saveStatus';
import deleteRows from '@salesforce/apex/GridController.deleteRows';
import summarizeGroups from '@salesforce/apex/GridController.summarizeGroups';
import countChildren from '@salesforce/apex/GridController.countChildren';
import { toCsv, downloadCsv, downloadBytes, XLSX_TYPE } from 'c/gridCsv';
import { readXlsx } from 'c/gridXlsx';
import { REFUSED_BY_PERMISSION } from 'c/gridEditState';
import { dateIn } from 'c/gridDisplayRules';

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
// Export is checked at its boundary: what gridView hands to gridCsv.
jest.mock('c/gridCsv', () => ({
    toCsv: jest.fn(() => 'csv'),
    downloadCsv: jest.fn(() => true),
    downloadBytes: jest.fn(() => true),
    XLSX_TYPE: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
}));

const DEFINITION = {
    name: 'Consignments',
    label: 'Open Consignments',
    objectApiName: 'Consignment__c',
    objectLabel: 'Consignments',
    pageSize: 200,
    sortField: 'Name',
    sortDirection: 'asc',
    allowInlineEdit: true,
    allowCsvExport: true,
    columns: [
        { field: 'Name', label: 'Name', type: 'text', editable: true, sortable: true, required: true },
        { field: 'Pieces__c', label: 'Pieces', type: 'number', editable: true, sortable: true, scale: 2 }
    ]
};

const row = (i, extra = {}) => ({
    Id: 'a00' + String(i).padStart(15, '0'),
    Name: 'Penobscot Paper, load ' + i,
    Pieces__c: String(i),
    ...extra
});
const page = (rows, { hasMore = false, locator = null, total = rows.length, token = null } = {}) => ({
    rows,
    hasMore,
    cursorLocator: locator,
    cursorToken: token,
    totalRows: total,
    serverMs: 5,
    cpuMs: 3
});

// Resolve every pending promise and any timer they schedule.
const settle = async () => {
    for (let i = 0; i < 12; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

function mount(configName = 'Consignments') {
    const el = createElement('c-grid-view', { is: GridView });
    el.configName = configName;
    document.body.appendChild(el);
    return el;
}

const table = el => el.shadowRoot.querySelector('c-grid-table');
const tableConfig = el => table(el).config;

beforeEach(() => {
    openGrid.mockImplementation(openGridFrom({ getGridConfig, fetchRows }));
    jest.useFakeTimers();
    getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
    fetchRows.mockResolvedValue(page([row(1), row(2), row(3)]));
});

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
    jest.clearAllMocks();
    jest.useRealTimers();
});

describe('loading', () => {
    it("numbers the table's rows unless the configuration hides them", async () => {
        const el = mount();
        await settle();
        expect(tableConfig(el).rowNumbers).toBe(true);
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, showRowNumbers: false }, diagnostics: false });
        const hidden = mount('Consignment_Directory');
        await settle();
        expect(tableConfig(hidden).rowNumbers).toBe(false);
    });

    it('reads the configuration by name, then the rows, and hands both to the table', async () => {
        const el = mount();
        await settle();
        expect(getGridConfig).toHaveBeenCalledWith({ configName: 'Consignments' });
        expect(fetchRows).toHaveBeenCalledWith({
            configName: 'Consignments',
            searchTerm: null,
            sortField: 'Name',
            sortDirection: 'asc',
            cursorLocator: null,
            cursorToken: null,
            pageSize: null,
            // No user filters and no record page.
            filters: null,
            recordId: null
        });
        const cfg = tableConfig(el);
        expect(cfg.columns).toEqual(DEFINITION.columns);
        expect(cfg.rows.map(r => r.Name)).toEqual([
            'Penobscot Paper, load 1',
            'Penobscot Paper, load 2',
            'Penobscot Paper, load 3'
        ]);
        expect(cfg.totalRows).toBe(3);
        expect(el.shadowRoot.querySelector('.rh-count').textContent).toBe('3 items');
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('3 rows loaded.');
    });

    it('follows the cursor with large pages and de-duplicates a row that shifted between calls', async () => {
        fetchRows
            .mockResolvedValueOnce(page([row(1), row(2)], { hasMore: true, locator: 'fp:2', total: 4 }))
            .mockResolvedValueOnce(page([row(2), row(3), row(4)], { total: 4 }));
        const el = mount();
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(2);
        expect(fetchRows.mock.calls[1][0]).toMatchObject({ cursorLocator: 'fp:2', pageSize: FOLLOW_PAGE_SIZE });
        expect(tableConfig(el).rows.map(r => r.Name)).toEqual([
            'Penobscot Paper, load 1',
            'Penobscot Paper, load 2',
            'Penobscot Paper, load 3',
            'Penobscot Paper, load 4'
        ]);
    });

    it('preloads up to the preload size, then says how to get more', async () => {
        let next = 0;
        fetchRows.mockImplementation(() => {
            const rows = Array.from({ length: FOLLOW_PAGE_SIZE }, () => row(++next));
            return Promise.resolve(page(rows, { hasMore: true, locator: 'fp:' + next, total: 25000 }));
        });
        const el = mount();
        await settle();
        await settle();
        expect(tableConfig(el).rows.length).toBe(PRELOAD_ROWS);
        expect(fetchRows).toHaveBeenCalledTimes(PRELOAD_ROWS / FOLLOW_PAGE_SIZE);
        const notice = el.shadowRoot.querySelector('.rh-truncated').content;
        expect(notice).toContain('first 10,000 of 25,000');
        expect(notice).toContain('Scroll down to load more');
        expect(el.shadowRoot.querySelector('.rh-count').textContent).toBe('10,000 of 25,000 items');
        // The table is told there is more, and how many rows there are in all.
        expect(tableConfig(el)).toMatchObject({ hasMore: true, loadingMore: false, totalRows: 25000 });
    });

    it('stops exactly at the ceiling when the first page is the configured size', async () => {
        // As the server does it: the first page is the configuration's page size
        // (200), every later page the size asked for. 200 + 5 x 2,000 would be
        // 10,200 rows, past the ceiling (found live at 50,000 rows).
        let next = 0;
        fetchRows.mockImplementation(({ pageSize }) => {
            const size = pageSize == null ? DEFINITION.pageSize : pageSize;
            const rows = Array.from({ length: size }, () => row(++next));
            return Promise.resolve(page(rows, { hasMore: true, locator: 'fp:' + next, total: 50000 }));
        });
        const el = mount();
        for (let i = 0; i < 4; i++) {
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        expect(tableConfig(el).rows.length).toBe(PRELOAD_ROWS);
        const sizes = fetchRows.mock.calls.map(([args]) => args.pageSize);
        expect(sizes).toEqual([null, 2000, 2000, 2000, 2000, 1800]);
        expect(el.shadowRoot.querySelector('.rh-truncated').content).toContain('first 10,000 of 50,000');
    });

    it('marks the row count unknown while pages are still arriving', async () => {
        let release;
        fetchRows
            .mockResolvedValueOnce(page([row(1)], { hasMore: true, locator: 'fp:1', total: 2 }))
            .mockReturnValueOnce(
                new Promise(resolve => {
                    release = resolve;
                })
            );
        const el = mount();
        await settle();
        expect(tableConfig(el).totalRows).toBe(-1);
        release(page([row(2)], { total: 2 }));
        await settle();
        expect(tableConfig(el).totalRows).toBe(2);
    });

    it('shows grey placeholder rows until the first rows arrive, not a spinner', async () => {
        let release;
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                release = resolve;
            })
        );
        const el = mount();
        await settle();
        const placeholder = el.shadowRoot.querySelector('.rh-placeholder');
        expect(placeholder.getAttribute('role')).toBe('status');
        expect(placeholder.getAttribute('aria-label')).toBe('Loading');
        // A header row, then the rows.
        expect(placeholder.querySelectorAll('.rh-placeholder-head')).toHaveLength(1);
        expect(placeholder.querySelectorAll('.rh-placeholder-row:not(.rh-placeholder-head)')).toHaveLength(
            PLACEHOLDER_ROWS
        );
        expect(el.shadowRoot.querySelector('lightning-spinner')).toBeNull();
        expect(table(el)).toBeNull();
        release(page([row(1)]));
        await settle();
        expect(el.shadowRoot.querySelector('.rh-placeholder')).toBeNull();
        expect(table(el)).not.toBeNull();
    });

    it('shows at once that it is loading: a bar along the top, and grey bars for the name and icon', async () => {
        let release;
        openGrid.mockReturnValueOnce(
            new Promise(resolve => {
                release = resolve;
            })
        );
        const el = mount();
        await settle();
        const busy = el.shadowRoot.querySelector('.rh-busy');
        expect(busy.getAttribute('aria-hidden')).toBe('true');
        expect(el.shadowRoot.querySelector('.rh-skeleton_title')).not.toBeNull();
        expect(el.shadowRoot.querySelector('.rh-skeleton_icon')).not.toBeNull();
        expect(el.shadowRoot.querySelector('lightning-icon.rh-object-icon')).toBeNull();
        expect(el.shadowRoot.querySelector('h2').textContent).toBe('Loading the grid');
        expect(el.shadowRoot.querySelector('.rh-count').textContent).toBe('Loading…');
        release(await openGridFrom({ getGridConfig, fetchRows })({ configName: 'Consignments' }));
        await settle();
        expect(el.shadowRoot.querySelector('.rh-busy')).toBeNull();
        expect(el.shadowRoot.querySelector('.rh-skeleton_title')).toBeNull();
        expect(el.shadowRoot.querySelector('h2').textContent).toBe('Open Consignments');
        expect(el.shadowRoot.querySelector('lightning-icon.rh-object-icon')).not.toBeNull();
    });

    it('shows the bar while a search asks the server, over the rows it has', async () => {
        const el = mount();
        await settle();
        expect(el.shadowRoot.querySelector('.rh-busy')).toBeNull();
        let release;
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                release = resolve;
            })
        );
        const search = el.shadowRoot.querySelector('.rh-search');
        search.value = 'Penobscot';
        search.dispatchEvent(new CustomEvent('change', { detail: { value: 'Penobscot' } }));
        jest.advanceTimersByTime(SEARCH_DELAY_MS);
        await settle();
        expect(el.shadowRoot.querySelector('.rh-busy')).not.toBeNull();
        expect(el.shadowRoot.querySelector('.rh-placeholder')).toBeNull(); // the rows it has stay
        release(page([row(2)]));
        await settle();
        expect(el.shadowRoot.querySelector('.rh-busy')).toBeNull();
    });

    it('shows no bar when it cannot open, and says why under the title', async () => {
        getGridConfig.mockRejectedValue({ body: { message: 'No Grid Configuration named "Consignment_Rerate".' } });
        const el = mount('Consignment_Rerate');
        await settle();
        expect(el.shadowRoot.querySelector('.rh-busy')).toBeNull();
        expect(el.shadowRoot.querySelector('.rh-skeleton_title')).toBeNull();
    });

    it('shows the server message when the configuration cannot be read', async () => {
        getGridConfig.mockRejectedValue({ body: { message: 'No Grid Configuration named "Consignment_Rerate".' } });
        const el = mount('Consignment_Rerate');
        await settle();
        const alert = el.shadowRoot.querySelector('.rh-load-error');
        expect(alert.getAttribute('role')).toBe('alert');
        expect(alert.textContent).toContain('No Grid Configuration named "Consignment_Rerate".');
        expect(table(el)).toBeNull();
    });

    it('refuses to start without a configuration name', async () => {
        const el = mount('');
        await settle();
        expect(getGridConfig).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelector('.rh-load-error').textContent).toContain('no configuration name');
    });

    it('titles the card with the configuration label, and the grid with the same name', async () => {
        const el = mount();
        await settle();
        expect(el.shadowRoot.querySelector('.slds-card__header-title').textContent.trim()).toBe('Open Consignments');
        expect(tableConfig(el).ariaLabel).toBe('Open Consignments');
    });

    it('falls back to the object label when the configuration has no label', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, label: null }, diagnostics: false });
        const el = mount();
        await settle();
        expect(tableConfig(el).ariaLabel).toBe('Consignments');
    });

    it('reloads when the admin points it at another configuration, and not otherwise', async () => {
        const el = mount();
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(1);
        el.configName = ' Consignments ';
        await settle();
        expect(getGridConfig).toHaveBeenCalledTimes(1);
        el.configName = 'Freight_Claims';
        await settle();
        expect(getGridConfig).toHaveBeenLastCalledWith({ configName: 'Freight_Claims' });
    });

    it('hands the table the SAME config object when nothing changed (HR-17)', async () => {
        const el = mount();
        await settle();
        const first = tableConfig(el);
        // Re-render for an unrelated reason: the Export dialog opens and closes.
        // (The child sees a read-only proxy; the membrane returns the same proxy
        // for the same object, so identity still holds.)
        el.shadowRoot.querySelector('.rh-export').click();
        await settle();
        expect(el.shadowRoot.querySelector('c-grid-export-dialog')).not.toBeNull();
        el.shadowRoot.querySelector('c-grid-export-dialog').dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(tableConfig(el)).toBe(first);
    });
});

describe('search and sort', () => {
    it('says which shown columns search does not look in while the box has focus, as a list view does', async () => {
        const el = mount();
        await settle();
        expect(el.shadowRoot.querySelector('.rh-search-hint')).toBeNull();
        const input = el.shadowRoot.querySelector('.rh-search');
        input.dispatchEvent(new CustomEvent('focus'));
        await settle();
        const hint = el.shadowRoot.querySelector('.rh-search-hint');
        expect(hint.getAttribute('role')).toBe('tooltip');
        // The test definition marks no column searchable: both are named.
        expect(hint.textContent).toBe(
            "Name and Pieces aren't searchable. Use filters or sort on these fields instead."
        );
        expect(el.shadowRoot.querySelector('.rh-search-hint-spoken').textContent).toBe(hint.textContent);
        input.dispatchEvent(new CustomEvent('blur'));
        await settle();
        expect(el.shadowRoot.querySelector('.rh-search-hint')).toBeNull();
        expect(el.shadowRoot.querySelector('.rh-search-hint-spoken').textContent).toBe('');
    });

    it('says nothing on focus when search looks in every shown column', async () => {
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, columns: DEFINITION.columns.map(c => ({ ...c, searchable: true })) },
            diagnostics: false,
            canConfigure: false
        });
        const el = mount();
        await settle();
        el.shadowRoot.querySelector('.rh-search').dispatchEvent(new CustomEvent('focus'));
        await settle();
        expect(el.shadowRoot.querySelector('.rh-search-hint')).toBeNull();
    });

    it('searches on the server after the user stops typing', async () => {
        const el = mount();
        await settle();
        fetchRows.mockClear();
        const input = el.shadowRoot.querySelector('.rh-search');
        input.dispatchEvent(new CustomEvent('change', { detail: { value: 'O' } }));
        input.dispatchEvent(new CustomEvent('change', { detail: { value: "O'Brien %" } }));
        jest.advanceTimersByTime(SEARCH_DELAY_MS - 1);
        expect(fetchRows).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows.mock.calls[0][0].searchTerm).toBe("O'Brien %");
    });

    it('ignores a response that arrives after a newer search started', async () => {
        const el = mount();
        await settle();
        let slow;
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                slow = resolve;
            })
        );
        fetchRows.mockResolvedValueOnce(page([row(9)]));
        const input = el.shadowRoot.querySelector('.rh-search');
        input.dispatchEvent(new CustomEvent('change', { detail: { value: 'Penob' } }));
        jest.advanceTimersByTime(SEARCH_DELAY_MS);
        input.dispatchEvent(new CustomEvent('change', { detail: { value: 'Penobscot' } }));
        jest.advanceTimersByTime(SEARCH_DELAY_MS);
        await settle();
        slow(page([row(1), row(2)]));
        await settle();
        expect(tableConfig(el).rows.map(r => r.Name)).toEqual(['Penobscot Paper, load 9']);
    });

    it('leaves sorting to the table when every row is loaded', async () => {
        const el = mount();
        await settle();
        fetchRows.mockClear();
        table(el).dispatchEvent(
            new CustomEvent('sortchange', { detail: { sort: [{ field: 'Pieces__c', direction: 'desc' }] } })
        );
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
    });

    it('asks the server for amounts in mixed currencies, which only it can order, even with every row loaded', async () => {
        const amount = {
            field: 'Freight_Charge__c',
            label: 'Freight Charge',
            type: 'currency',
            sortable: true,
            scale: 2
        };
        getGridConfig.mockResolvedValue({
            definition: {
                ...DEFINITION,
                columns: [...DEFINITION.columns, { ...amount, currencyField: 'CurrencyIsoCode' }]
            },
            diagnostics: false
        });
        const el = mount();
        await settle();
        fetchRows.mockClear();
        table(el).dispatchEvent(
            new CustomEvent('sortchange', { detail: { sort: [{ field: 'Freight_Charge__c', direction: 'desc' }] } })
        );
        await settle();
        expect(fetchRows.mock.calls[0][0]).toMatchObject({ sortField: 'Freight_Charge__c', sortDirection: 'desc' });
    });

    it('asks the server when the view is truncated, because the loaded rows are the wrong rows', async () => {
        fetchRows.mockResolvedValue(page([row(1)], { hasMore: true, locator: 'fp:1', total: 50000 }));
        const el = mount();
        await settle();
        await settle();
        fetchRows.mockClear();
        fetchRows.mockResolvedValue(page([row(7)]));
        table(el).dispatchEvent(
            new CustomEvent('sortchange', { detail: { sort: [{ field: 'Pieces__c', direction: 'desc' }] } })
        );
        await settle();
        expect(fetchRows.mock.calls[0][0]).toMatchObject({
            sortField: 'Pieces__c',
            sortDirection: 'desc',
            cursorLocator: null
        });
    });
});

describe('loading more as you scroll', () => {
    /**
     * Pages as the server returns them: the configuration's size first, then
     * the size asked for, and one cursor token for the whole query.
     */
    function serverOf(total) {
        let next = 0;
        fetchRows.mockImplementation(({ pageSize }) => {
            const size = Math.min(pageSize == null ? DEFINITION.pageSize : pageSize, total - next);
            const rows = Array.from({ length: size }, () => row(++next));
            const more = next < total;
            return Promise.resolve(
                page(rows, {
                    hasMore: more,
                    locator: more ? `fp:${next}:${total}` : null,
                    total,
                    token: more ? 'tok-1' : null
                })
            );
        });
    }
    const settleAll = async () => {
        for (let i = 0; i < 4; i++) {
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
    };
    const loadMore = el => table(el).dispatchEvent(new CustomEvent('loadmore'));
    const live = el => el.shadowRoot.querySelector('.rh-live').textContent;

    it('loads the next page when the table asks, on the same cursor', async () => {
        serverOf(50000);
        const el = mount();
        await settleAll();
        // The preload hands the first page's cursor back with every later page.
        const tokens = fetchRows.mock.calls.map(([args]) => args.cursorToken);
        expect(tokens).toEqual([null, 'tok-1', 'tok-1', 'tok-1', 'tok-1', 'tok-1']);

        fetchRows.mockClear();
        loadMore(el);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows.mock.calls[0][0]).toMatchObject({
            configName: 'Consignments',
            sortField: 'Name',
            sortDirection: 'asc',
            cursorLocator: 'fp:10000:50000',
            cursorToken: 'tok-1',
            pageSize: FOLLOW_PAGE_SIZE
        });
        expect(tableConfig(el).rows.length).toBe(12000);
        expect(tableConfig(el)).toMatchObject({ hasMore: true, loadingMore: false, totalRows: 50000 });
        expect(live(el)).toBe('Loaded 2,000 more rows. Showing the first 12,000 of 50,000 rows.');
    });

    it('asks once while a page is on its way, and says it is loading', async () => {
        serverOf(50000);
        const el = mount();
        await settleAll();
        let release;
        fetchRows.mockClear();
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                release = resolve;
            })
        );
        loadMore(el);
        loadMore(el);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(tableConfig(el).loadingMore).toBe(true);
        expect(live(el)).toBe('Loading more rows…');
        release(page([row(90001)], { hasMore: true, locator: 'fp:10001:50000', total: 50000, token: 'tok-1' }));
        await settle();
        expect(tableConfig(el).loadingMore).toBe(false);
        expect(tableConfig(el).rows.length).toBe(10001);
    });

    it('drops a page that arrives after a new search, and does not stay busy', async () => {
        serverOf(50000);
        const el = mount();
        await settleAll();
        let slow;
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                slow = resolve;
            })
        );
        fetchRows.mockResolvedValueOnce(page([row(9)]));
        loadMore(el);
        await settle();
        el.shadowRoot
            .querySelector('.rh-search')
            .dispatchEvent(new CustomEvent('change', { detail: { value: 'Bangor' } }));
        jest.advanceTimersByTime(SEARCH_DELAY_MS);
        await settle();
        slow(
            page([row(20001), row(20002)], { hasMore: true, locator: 'fp:10002:50000', total: 50000, token: 'tok-1' })
        );
        await settle();
        expect(tableConfig(el).rows.map(r => r.Name)).toEqual(['Penobscot Paper, load 9']);
        expect(tableConfig(el)).toMatchObject({ loadingMore: false, hasMore: false });
    });

    it('stops at the most one grid holds, the rows one cursor holds', async () => {
        serverOf(250000);
        const el = mount();
        await settleAll();
        for (let i = 0; tableConfig(el).rows.length < MAX_LOADED_ROWS && i < 60; i++) {
            loadMore(el);
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        expect(tableConfig(el).rows.length).toBe(MAX_LOADED_ROWS);
        expect(tableConfig(el).hasMore).toBe(false);
        expect(el.shadowRoot.querySelector('.rh-truncated').content).toContain('the most one grid holds');
        fetchRows.mockClear();
        loadMore(el);
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
    });

    it('says how many match when more match than one cursor holds', async () => {
        // The server pages through the first rows its cursor holds (100,000
        // live) and counts every match: here 3 of 120. Nothing more can load,
        // and the grid says so rather than calling it 3 items.
        fetchRows.mockResolvedValue(page([row(1), row(2), row(3)], { hasMore: false, total: 120 }));
        const el = mount();
        await settleAll();
        expect(el.shadowRoot.querySelector('.rh-count').textContent).toBe('3 of 120 items');
        const notice = el.shadowRoot.querySelector('.rh-truncated').content;
        expect(notice).toContain('Showing the first 3 of 120 rows.');
        expect(notice).toContain('the most one grid holds; search to narrow the list');
        expect(tableConfig(el).hasMore).toBe(false);
    });

    it('keeps the rows it has when a page fails, and says so', async () => {
        serverOf(50000);
        const el = mount();
        await settleAll();
        fetchRows.mockRejectedValueOnce({ body: { message: 'Apex CPU time limit exceeded' } });
        loadMore(el);
        await settle();
        expect(el.shadowRoot.querySelector('.rh-notice').textContent).toBe(
            'More rows could not be loaded. Apex CPU time limit exceeded'
        );
        expect(tableConfig(el).rows.length).toBe(PRELOAD_ROWS);
        expect(tableConfig(el)).toMatchObject({ hasMore: true, loadingMore: false });
    });
});

describe('editing and saving', () => {
    const edit = (el, recordId, field, value, originalValue) =>
        table(el).dispatchEvent(new CustomEvent('cellchange', { detail: { recordId, field, value, originalValue } }));

    it('asks before the page is left while there are unsaved changes, and only then', async () => {
        const leave = () => {
            const event = new CustomEvent('beforeunload', { cancelable: true });
            window.dispatchEvent(event);
            return event.defaultPrevented;
        };
        const added = jest.spyOn(window, 'addEventListener');
        const el = mount();
        await settle();
        expect(leave()).toBe(false); // nothing unsaved: no question, and no listener
        expect(added.mock.calls.filter(c => c[0] === 'beforeunload')).toHaveLength(0);
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        await settle();
        expect(leave()).toBe(true); // the browser's "Leave site?"
        edit(el, row(2).Id, 'Name', 'Bangor Brick', 'Penobscot Paper, load 2');
        await settle();
        expect(added.mock.calls.filter(c => c[0] === 'beforeunload')).toHaveLength(1); // one listener, however many changes
        table(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(leave()).toBe(false); // discarded: nothing to ask about
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        await settle();
        expect(leave()).toBe(true);
        el.remove();
        expect(leave()).toBe(false); // the grid gone: its listener too
        added.mockRestore();
    });

    it('records an edit as a draft in a new config object', async () => {
        const el = mount();
        await settle();
        const before = tableConfig(el);
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        await settle();
        expect(tableConfig(el)).not.toBe(before);
        expect(tableConfig(el).drafts).toEqual({ [row(1).Id]: { Name: 'Kennebec Lumber, 12 bundles' } });
    });

    it('saves, polls until every batch reports, re-reads the rows, and clears the drafts', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        saveRows.mockResolvedValue({
            saveId: 's1',
            done: false,
            chunkCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        saveStatus
            .mockResolvedValueOnce({ saveId: 's1', done: false, chunkCount: 1, chunksReported: 0, errors: [] })
            .mockResolvedValueOnce({
                saveId: 's1',
                done: true,
                chunkCount: 1,
                chunksReported: 1,
                successCount: 1,
                errors: []
            });
        fetchRowsById.mockResolvedValue([row(1, { Name: 'Kennebec Lumber, 12 bundles, Augusta' })]);
        const toast = jest.fn();
        el.addEventListener('lightning__showtoast', toast);

        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        expect(saveRows).toHaveBeenCalledWith({
            configName: 'Consignments',
            rows: [{ Id: row(1).Id, Name: 'Kennebec Lumber, 12 bundles' }]
        });
        expect(tableConfig(el).saving).toBe(true);
        // The Save button shows the save under way.
        expect(tableConfig(el).savingEdits).toBe(true);
        await jest.advanceTimersByTimeAsync(5000);
        await settle();

        expect(saveStatus).toHaveBeenCalledTimes(2);
        expect(fetchRowsById).toHaveBeenCalledWith({ configName: 'Consignments', recordIds: [row(1).Id] });
        const cfg = tableConfig(el);
        expect(cfg.saving).toBe(false);
        expect(cfg.savingEdits).toBe(false);
        expect(cfg.drafts).toEqual({});
        expect(cfg.rows[0].Name).toBe('Kennebec Lumber, 12 bundles, Augusta');
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('Saved 1 record.');
        expect(toast).toHaveBeenCalledTimes(1);
        expect(toast.mock.calls[0][0].detail.variant).toBe('success');
    });

    it('keeps a failed edit and puts the server message on its cell', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Pieces__c', '99999999', '1');
        edit(el, row(2).Id, 'Name', 'Wachusett Paper, 6 rolls', 'Penobscot Paper, load 2');
        saveRows.mockResolvedValue({
            saveId: 's2',
            done: false,
            chunkCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        saveStatus.mockResolvedValue({
            saveId: 's2',
            done: true,
            chunkCount: 1,
            chunksReported: 1,
            successCount: 1,
            errors: [{ recordId: row(1).Id, fieldName: 'Pieces__c', message: 'Value too large.' }]
        });
        fetchRowsById.mockResolvedValue([row(2, { Name: 'Wachusett Paper, 6 rolls' })]);
        table(el).dispatchEvent(new CustomEvent('save'));
        await jest.advanceTimersByTimeAsync(5000);
        await settle();
        const cfg = tableConfig(el);
        expect(cfg.drafts).toEqual({ [row(1).Id]: { Pieces__c: '99999999' } });
        expect(cfg.errors[row(1).Id].fields.Pieces__c).toBe('Value too large.');
        expect(fetchRowsById.mock.calls[0][0].recordIds).toEqual([row(2).Id]);
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('Saved 1 record. 1 record has errors.');
    });

    it('tells the user when field-level security removed an edit, instead of dropping it silently', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Pieces__c', '5', '1');
        saveRows.mockResolvedValue({
            saveId: 's3',
            done: false,
            chunkCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: ['Pieces__c']
        });
        saveStatus.mockResolvedValue({
            saveId: 's3',
            done: true,
            chunkCount: 1,
            chunksReported: 1,
            successCount: 1,
            errors: []
        });
        fetchRowsById.mockResolvedValue([row(1)]);
        table(el).dispatchEvent(new CustomEvent('save'));
        await jest.advanceTimersByTimeAsync(5000);
        await settle();
        const cfg = tableConfig(el);
        expect(cfg.drafts).toEqual({ [row(1).Id]: { Pieces__c: '5' } });
        expect(cfg.errors[row(1).Id].fields.Pieces__c).toBe(REFUSED_BY_PERMISSION);
    });

    it('merges errors refused up front with those the batches reported', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Pieces__c', 'twelve', '1');
        edit(el, row(2).Id, 'Name', 'Quabbin Supply, 3 crates', 'Penobscot Paper, load 2');
        saveRows.mockResolvedValue({
            saveId: 's4',
            done: false,
            chunkCount: 1,
            rejectedFields: [],
            strippedFields: [],
            errors: [{ recordId: row(1).Id, fieldName: 'Pieces__c', message: 'Not a number.' }]
        });
        saveStatus.mockResolvedValue({
            saveId: 's4',
            done: true,
            chunkCount: 1,
            chunksReported: 1,
            successCount: 0,
            errors: [{ recordId: row(2).Id, fieldName: null, message: 'Record locked.' }]
        });
        table(el).dispatchEvent(new CustomEvent('save'));
        await jest.advanceTimersByTimeAsync(5000);
        await settle();
        const cfg = tableConfig(el);
        expect(cfg.errors[row(1).Id].fields.Pieces__c).toBe('Not a number.');
        expect(cfg.errors[row(2).Id].row).toBe('Record locked.');
        expect(fetchRowsById).not.toHaveBeenCalled();
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('Nothing was saved. 2 records have errors.');
    });

    it('keeps every draft and says so when the save call itself fails', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        saveRows.mockRejectedValue({ body: { message: 'Insufficient access.' } });
        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({ [row(1).Id]: { Name: 'Kennebec Lumber, 12 bundles' } });
        expect(tableConfig(el).saving).toBe(false);
        expect(el.shadowRoot.querySelector('.rh-notice').textContent).toBe(
            'Your changes were not saved. Insufficient access.'
        );
    });

    it('keeps an edit typed while the save was running', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Casco Bay Marine, 2 skids', 'Penobscot Paper, load 1');
        saveRows.mockResolvedValue({
            saveId: 's5',
            done: false,
            chunkCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        saveStatus.mockResolvedValue({
            saveId: 's5',
            done: true,
            chunkCount: 1,
            chunksReported: 1,
            successCount: 1,
            errors: []
        });
        fetchRowsById.mockResolvedValue([row(1, { Name: 'Casco Bay Marine, 2 skids' })]);
        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        edit(el, row(2).Id, 'Name', 'Mill River Energy, 4 drums', 'Penobscot Paper, load 2');
        await jest.advanceTimersByTimeAsync(5000);
        await settle();
        expect(tableConfig(el).drafts).toEqual({ [row(2).Id]: { Name: 'Mill River Energy, 4 drums' } });
    });

    it('clears a cell error when the user edits that cell again', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Saco River Outfitters, 40 kayaks, Brunswick', 'Penobscot Paper, load 1');
        saveRows.mockResolvedValue({
            saveId: 's6',
            done: true,
            chunkCount: 0,
            rejectedFields: [],
            strippedFields: [],
            errors: [{ recordId: row(1).Id, fieldName: 'Name', message: 'Too long.' }]
        });
        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        expect(tableConfig(el).errors[row(1).Id].fields.Name).toBe('Too long.');
        edit(el, row(1).Id, 'Name', 'Saco River Outfitters, 40 kayaks', 'Penobscot Paper, load 1');
        await settle();
        expect(tableConfig(el).errors).toEqual({});
    });

    it('refuses to send a blank required field and marks the cell (found in Lightning Experience)', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', '', 'Penobscot Paper, load 1');
        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        expect(saveRows).not.toHaveBeenCalled();
        expect(tableConfig(el).errors[row(1).Id].fields.Name).toBe('Complete this field.');
        expect(tableConfig(el).drafts).toEqual({ [row(1).Id]: { Name: '' } });
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe(
            '1 required field is blank. Complete it, then save.'
        );
    });

    it('discards drafts and errors on Cancel', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        await settle();
        table(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({});
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('Changes discarded.');
    });
});

describe('spreadsheet actions and undo', () => {
    const edit = (el, recordId, field, value, originalValue) =>
        table(el).dispatchEvent(new CustomEvent('cellchange', { detail: { recordId, field, value, originalValue } }));
    const cells = (el, detail) => table(el).dispatchEvent(new CustomEvent('cellschange', { detail }));
    const live = el => el.shadowRoot.querySelector('.rh-live').textContent;
    const button = (el, cls) => el.shadowRoot.querySelector(cls);

    it('keeps a paste as drafts and marks the cells whose values could not be read', async () => {
        const el = mount();
        await settle();
        cells(el, {
            label: 'paste',
            changes: [
                {
                    recordId: row(1).Id,
                    field: 'Name',
                    value: 'Bangor Brick & Tile, 8 pallets',
                    originalValue: 'Penobscot Paper, load 1'
                },
                {
                    recordId: row(2).Id,
                    field: 'Name',
                    value: 'Monadnock Granite, 2 slabs',
                    originalValue: 'Penobscot Paper, load 2'
                }
            ],
            errors: [{ recordId: row(3).Id, field: 'Pieces__c', message: 'Not a number: 4 pallets' }]
        });
        await settle();
        const cfg = tableConfig(el);
        expect(cfg.drafts).toEqual({
            [row(1).Id]: { Name: 'Bangor Brick & Tile, 8 pallets' },
            [row(2).Id]: { Name: 'Monadnock Granite, 2 slabs' }
        });
        expect(cfg.errors[row(3).Id].fields.Pieces__c).toBe('Not a number: 4 pallets');
    });

    it('undoes a whole paste in one step, and redoes it', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Housatonic Hardware, 5 cartons', 'Penobscot Paper, load 1');
        cells(el, {
            label: 'paste',
            changes: [
                {
                    recordId: row(1).Id,
                    field: 'Name',
                    value: 'Bangor Brick & Tile, 8 pallets',
                    originalValue: 'Penobscot Paper, load 1'
                },
                {
                    recordId: row(2).Id,
                    field: 'Name',
                    value: 'Monadnock Granite, 2 slabs',
                    originalValue: 'Penobscot Paper, load 2'
                }
            ],
            errors: []
        });
        await settle();
        // Undo and Redo are the Save bar's: the table is told what they would do.
        expect(tableConfig(el).history).toEqual({
            canUndo: true,
            canRedo: false,
            undoLabel: 'Undo paste of 2 cells',
            redoLabel: 'Redo'
        });

        table(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({ [row(1).Id]: { Name: 'Housatonic Hardware, 5 cartons' } });
        expect(live(el)).toBe('Undid paste of 2 cells.');
        expect(tableConfig(el).history.canRedo).toBe(true);
        expect(tableConfig(el).history.redoLabel).toBe('Redo paste of 2 cells');

        table(el).dispatchEvent(new CustomEvent('redo'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({
            [row(1).Id]: { Name: 'Bangor Brick & Tile, 8 pallets' },
            [row(2).Id]: { Name: 'Monadnock Granite, 2 slabs' }
        });
        expect(live(el)).toBe('Redid paste of 2 cells.');

        table(el).dispatchEvent(new CustomEvent('undo'));
        table(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({});
        expect(tableConfig(el).history.canUndo).toBe(false);
        // No undo buttons in the header any more.
        expect(button(el, '.rh-undo')).toBeNull();
    });

    it('says so when there is nothing to undo', async () => {
        const el = mount();
        await settle();
        table(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(live(el)).toBe('Nothing to undo.');
    });

    it('starts a fresh history after Cancel and after a save', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        await settle();
        table(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(tableConfig(el).history).toMatchObject({ canUndo: false, canRedo: false });

        edit(el, row(1).Id, 'Name', 'Berkshire Mills, 9 bales', 'Penobscot Paper, load 1');
        saveRows.mockResolvedValue({
            saveId: 's1',
            done: true,
            chunkCount: 1,
            successCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        fetchRowsById.mockResolvedValue([row(1, { Name: 'Berkshire Mills, 9 bales' })]);
        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        await jest.advanceTimersByTimeAsync(100);
        await settle();
        expect(tableConfig(el).history).toMatchObject({ canUndo: false, canRedo: false });
    });

    it('passes the frozen column count to the table, and offers no undo where nothing is editable', async () => {
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, frozenColumns: 1, allowInlineEdit: false },
            diagnostics: false
        });
        const el = mount();
        await settle();
        expect(tableConfig(el).frozenColumns).toBe(1);
        expect(tableConfig(el).history).toBeNull();
    });
});

describe('height', () => {
    it("passes the configuration's Height to the table, and nothing when there is none (fill the window)", async () => {
        const el = mount();
        await settle();
        expect(tableConfig(el).height).toBeNull();

        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, height: 320 }, diagnostics: false });
        const fixed = mount();
        await settle();
        expect(tableConfig(fixed).height).toBe(320);
    });
});

describe('export', () => {
    const dialogOf = el => el.shadowRoot.querySelector('c-grid-export-dialog');
    // Export, then the dialog's Export with this view and format; the rows not loaded load first.
    async function exportAs(el, view = 'formatted', format = 'xlsx') {
        el.shadowRoot.querySelector('.rh-export').click();
        await settle();
        dialogOf(el).dispatchEvent(new CustomEvent('export', { detail: { view, format } }));
        for (let i = 0; i < 6; i++) {
            // eslint-disable-next-line no-await-in-loop
            await settle();
            jest.runOnlyPendingTimers();
        }
        await settle();
    }
    const rowsOf = bytes => readXlsx(bytes).rows;
    const textAt = (rows, text) => rows.findIndex(r => r.some(c => c && c.v === text));

    it('opens the Export dialog: Formatted Report or Details Only, as Salesforce exports a report', async () => {
        const el = mount();
        await settle();
        expect(dialogOf(el)).toBeNull();
        el.shadowRoot.querySelector('.rh-export').click();
        await settle();
        const dialog = dialogOf(el);
        expect(dialog).not.toBeNull();
        expect(dialog.total).toBe(3);
        expect(dialog.loaded).toBe(3);
        expect(dialog.max).toBe(MAX_LOADED_ROWS);
        dialog.dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(dialogOf(el)).toBeNull();
        expect(downloadBytes).not.toHaveBeenCalled();
        expect(toCsv).not.toHaveBeenCalled();
    });

    it('writes a Formatted Report: the report header and filter details, then the table without the Id', async () => {
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, userName: 'Abigail Whitcomb' },
            diagnostics: false
        });
        const el = mount();
        await settle();
        await exportAs(el, 'formatted');
        expect(toCsv).not.toHaveBeenCalled();
        expect(downloadBytes).toHaveBeenCalledTimes(1);
        const [bytes, fileName, container, type] = downloadBytes.mock.calls[0];
        expect(fileName).toMatch(/^Open-Consignments-\d{4}-\d{2}-\d{2}\.xlsx$/);
        expect(container).toBe(el.shadowRoot.querySelector('.rh-download'));
        expect(type).toBe(XLSX_TYPE);
        const { sheet } = readXlsx(bytes);
        expect(sheet).toBe('Open Consignments');
        const rows = rowsOf(bytes);
        expect(textAt(rows, 'Open Consignments')).toBeGreaterThanOrEqual(0);
        const subtitle = rows.flat().find(c => c && /^As of /.test(c.v));
        expect(subtitle.v).toMatch(
            /^As of \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} .+ • Generated by Abigail Whitcomb • Sorted by Name \(Ascending\)$/
        );
        expect(textAt(rows, 'Filtered By')).toBeGreaterThan(0);
        expect(textAt(rows, 'Show: All consignments')).toBeGreaterThan(textAt(rows, 'Filtered By'));
        // The table: no Id, the rows in the order the table shows them, the admin's sort by Name.
        const head = textAt(rows, 'Name');
        expect(rows[head].filter(c => c && c.v).map(c => c.v)).toEqual(['Name', 'Pieces']);
        expect(rows.slice(head + 1, head + 4).map(r => r.find(c => c && c.t === 's').v)).toEqual([
            'Penobscot Paper, load 1',
            'Penobscot Paper, load 2',
            'Penobscot Paper, load 3'
        ]);
        // Under the table, the report's footer.
        expect(textAt(rows, 'Confidential Information - Do Not Distribute')).toBeGreaterThan(head + 3);
        expect(textAt(rows, 'Made with Rowhouse Grid by Kugamon')).toBeGreaterThan(head + 3);
        expect(dialogOf(el)).toBeNull();
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('Exported 3 rows.');
    });

    it('writes Details Only as a CSV: the record Id first, the rows in the order shown', async () => {
        const el = mount();
        await settle();
        await exportAs(el, 'details', 'csv');
        const [rows, columns] = toCsv.mock.calls[0];
        expect(rows.map(r => r.Name)).toEqual([
            'Penobscot Paper, load 1',
            'Penobscot Paper, load 2',
            'Penobscot Paper, load 3'
        ]);
        expect(rows[0]).toEqual({ Id: row(1).Id, Name: 'Penobscot Paper, load 1', Pieces__c: '1' });
        expect(columns).toEqual([
            { field: 'Id', label: 'Id', type: 'id' }, // so the file can come back in as an import
            { field: 'Name', label: 'Name', type: 'text' },
            { field: 'Pieces__c', label: 'Pieces', type: 'number' }
        ]);
        const [, fileName, container] = downloadCsv.mock.calls[0];
        // Named after the grid title, which is the configuration label.
        expect(fileName).toMatch(/^Open-Consignments-\d{4}-\d{2}-\d{2}\.csv$/);
        expect(container).toBe(el.shadowRoot.querySelector('.rh-download'));
        expect(downloadBytes).not.toHaveBeenCalled();
    });

    it('writes a lookup by its record’s name and a picklist by its label, as a report does', async () => {
        getGridConfig.mockResolvedValue({
            definition: {
                ...DEFINITION,
                columns: DEFINITION.columns.concat([
                    { field: 'Carrier__c', label: 'Carrier', type: 'reference' },
                    {
                        field: 'Service_Level__c',
                        label: 'Service Level',
                        type: 'picklist',
                        options: [{ value: 'two_day', label: 'Two-day' }]
                    }
                ])
            },
            diagnostics: false
        });
        fetchRows.mockResolvedValue(
            page([
                row(1, {
                    Carrier__c: '001000000000001AAA',
                    Service_Level__c: 'two_day',
                    _labels: { Carrier__c: 'Bangor Freight Lines' }
                })
            ])
        );
        const el = mount();
        await settle();
        await exportAs(el, 'details', 'csv');
        const [rows] = toCsv.mock.calls[0];
        expect(rows[0]).toMatchObject({ Carrier__c: 'Bangor Freight Lines', Service_Level__c: 'Two-day' });
    });

    it('writes Details Only as a workbook: the record Id, then the values, without the report header', async () => {
        const el = mount();
        await settle();
        await exportAs(el, 'details', 'xlsx');
        const rows = rowsOf(downloadBytes.mock.calls[0][0]);
        expect(rows[0]).toEqual([
            { t: 's', v: 'Id' },
            { t: 's', v: 'Name' },
            { t: 's', v: 'Pieces' }
        ]);
        expect(rows[1][1]).toEqual({ t: 's', v: 'Penobscot Paper, load 1' });
        expect(rows[1][2]).toEqual({ t: 'n', v: '1' });
    });

    it('loads every matching record first, as a report exports the whole report', async () => {
        fetchRows
            .mockResolvedValueOnce(page([row(1), row(2)], { hasMore: true, locator: 'fp:2', total: 5 }))
            .mockResolvedValueOnce(page([row(3), row(4)], { hasMore: true, locator: 'fp:4', total: 5 }))
            .mockResolvedValueOnce(page([row(5)], { total: 5 }));
        // The grid loads the first page, and as far as its preload goes.
        const el = mount();
        await settle();
        expect(tableConfig(el).rows.length).toBe(5);
        await exportAs(el, 'details', 'csv');
        expect(toCsv.mock.calls[0][0]).toHaveLength(5);
    });

    it('loads the rest when the grid holds only some, then exports them all', async () => {
        let next = 0;
        fetchRows.mockImplementation(() => {
            const rows = Array.from({ length: FOLLOW_PAGE_SIZE }, () => row(++next));
            return Promise.resolve(page(rows, { hasMore: next < 14000, locator: 'fp:' + next, total: 14000 }));
        });
        const el = mount();
        await settle();
        await settle();
        expect(tableConfig(el).rows.length).toBe(PRELOAD_ROWS);
        el.shadowRoot.querySelector('.rh-export').click();
        await settle();
        expect(dialogOf(el).total).toBe(14000);
        expect(dialogOf(el).loaded).toBe(PRELOAD_ROWS);
        dialogOf(el).dispatchEvent(new CustomEvent('export', { detail: { view: 'details', format: 'csv' } }));
        for (let i = 0; i < 8; i++) {
            // eslint-disable-next-line no-await-in-loop
            await settle();
            jest.runOnlyPendingTimers();
        }
        expect(tableConfig(el).rows.length).toBe(14000);
        expect(toCsv.mock.calls[0][0]).toHaveLength(14000);
        expect(el.shadowRoot.querySelector('.rh-live').textContent).toBe('Exported 14,000 rows.');
    });

    it('says so in the dialog when the browser refuses the file, and does not claim an export', async () => {
        downloadCsv.mockReturnValueOnce(false);
        const el = mount();
        await settle();
        await exportAs(el, 'details', 'csv');
        expect(dialogOf(el).error).toBe('This browser did not allow the file to be downloaded.');
        expect(dialogOf(el).busy).toBe(false);
        expect(el.shadowRoot.querySelector('.rh-live').textContent).not.toContain('Exported');
    });

    it('says so when the browser refuses the workbook', async () => {
        downloadBytes.mockReturnValueOnce(false);
        const el = mount();
        await settle();
        await exportAs(el, 'formatted');
        expect(dialogOf(el).error).toBe('This browser did not allow the file to be downloaded.');
    });

    it('offers no export when the configuration does not allow it', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowCsvExport: false }, diagnostics: false });
        const el = mount();
        await settle();
        expect(el.shadowRoot.querySelector('.rh-export')).toBeNull();
    });
});

describe('telemetry', () => {
    it('writes structured lines only with the diagnostics permission, and never record data', async () => {
        const info = jest.spyOn(console, 'info').mockImplementation(() => {});
        mount();
        await settle();
        expect(info).not.toHaveBeenCalled();

        document.body.firstChild.remove();
        getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: true });
        mount();
        await settle();
        const events = info.mock.calls.map(c => JSON.parse(c[1]));
        expect(events.map(e => e.event)).toEqual(['config', 'page', 'load']);
        expect(events[1]).toMatchObject({ source: 'rowhouse', grid: 'Consignments', rows: 3, serverMs: 5, cpuMs: 3 });
        expect(JSON.stringify(events)).not.toContain('Penobscot Paper, load 1');
        info.mockRestore();
    });
});

describe('messageOf', () => {
    it('reads every error shape Apex and the browser produce', () => {
        expect(messageOf({ body: { message: 'Unable to obtain exclusive access to this record.' } })).toBe(
            'Unable to obtain exclusive access to this record.'
        );
        expect(
            messageOf({
                body: [
                    { message: 'Required fields are missing: [Consignee].' },
                    { message: 'Pieces: value outside of valid range.' }
                ]
            })
        ).toBe('Required fields are missing: [Consignee]. Pieces: value outside of valid range.');
        expect(messageOf(new Error('Failed to fetch.'))).toBe('Failed to fetch.');
        expect(messageOf(null)).toBe('Unknown error.');
    });
});

describe('accessibility', () => {
    it('has no axe violations once loaded', async () => {
        jest.useRealTimers();
        const el = mount();
        await settle();
        await expect(el).toBeAccessible();
    });
});

describe('lookup names', () => {
    const ACC = '001000000000001AAA';

    it('learns names from the rows and from the lookup editor, and passes the grid name to the table', async () => {
        fetchRows.mockResolvedValue(page([row(1, { Shipper__c: ACC, _labels: { Shipper__c: 'Casco Bay Marine' } })]));
        const el = mount();
        await settle();
        expect(tableConfig(el).refNames).toEqual({ [ACC]: 'Casco Bay Marine' });
        expect(tableConfig(el).configName).toBe('Consignments');

        const other = '001000000000002AAA';
        table(el).dispatchEvent(
            new CustomEvent('cellchange', {
                detail: {
                    recordId: row(1).Id,
                    field: 'Shipper__c',
                    value: other,
                    originalValue: ACC,
                    valueLabel: 'Merrimack Valley Foods'
                }
            })
        );
        await settle();
        expect(tableConfig(el).refNames).toEqual({ [ACC]: 'Casco Bay Marine', [other]: 'Merrimack Valley Foods' });
    });

    it('keeps the same names object when a page brings nothing new (HR-17)', async () => {
        fetchRows.mockResolvedValue(page([row(1, { Shipper__c: ACC, _labels: { Shipper__c: 'Casco Bay Marine' } })]));
        const el = mount();
        await settle();
        const names = tableConfig(el).refNames;
        table(el).dispatchEvent(
            new CustomEvent('cellchange', {
                detail: {
                    recordId: row(1).Id,
                    field: 'Name',
                    value: 'Green Mountain Maple, 30 cases',
                    originalValue: 'Penobscot Paper, load 1'
                }
            })
        );
        await settle();
        expect(tableConfig(el).refNames).toBe(names);
    });
});

describe('conditional formatting', () => {
    const RULES = [
        {
            name: 'Large_Load',
            field: 'Pieces__c',
            type: 'number',
            operator: 'greater_than',
            value: '2',
            style: 'bold',
            applyTo: 'row'
        }
    ];

    it('hands the configuration’s display rules to the table', async () => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, displayRules: RULES }, diagnostics: false });
        const el = mount();
        await settle();
        expect(tableConfig(el).displayRules).toEqual(RULES);
    });

    it('hands an empty list when the configuration has none', async () => {
        const el = mount();
        await settle();
        expect(tableConfig(el).displayRules).toEqual([]);
    });

    it('shows configuration warnings to diagnostics users only', async () => {
        const warnings = ['Display rule Heavy_Freight was skipped: Value "heavy" is not a number.'];
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, warnings }, diagnostics: true });
        let el = mount();
        await settle();
        // One line until opened.
        expect(el.shadowRoot.querySelector('.rh-warnings-summary').textContent).toBe(
            '1 configuration warning (shown with Rowhouse Grid Diagnostics only)'
        );
        expect(el.shadowRoot.querySelectorAll('.rh-config-warnings li')).toHaveLength(0);
        const toggle = el.shadowRoot.querySelector('.rh-warnings-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click();
        await settle();
        const items = [...el.shadowRoot.querySelectorAll('.rh-config-warnings li')].map(li => li.textContent);
        expect(items).toEqual(warnings);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        el.remove();

        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, warnings }, diagnostics: false });
        el = mount();
        await settle();
        expect(el.shadowRoot.querySelector('.rh-config-warnings')).toBeNull();
    });
});

describe('mass update and mass delete', () => {
    const $ = (el, selector) => el.shadowRoot.querySelector(selector);
    const select = (el, ids) =>
        table(el).dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: ids } }));
    const dialog = el => $(el, 'c-grid-update-field');
    const live = el => $(el, '.rh-live').textContent;
    const edit = (el, recordId, field, value, originalValue) =>
        table(el).dispatchEvent(new CustomEvent('cellchange', { detail: { recordId, field, value, originalValue } }));
    const withDelete = extra =>
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, allowMassDelete: true, ...extra },
            diagnostics: false
        });
    let toasts;
    const mountWatched = () => {
        const el = mount();
        toasts = [];
        el.addEventListener('lightning__showtoast', e => toasts.push(e.detail));
        return el;
    };

    /** Delete from the selection bar, then answer the dialog. */
    const deleteSelected = async (el, answer = 'confirm') => {
        $(el, '.rh-mass-delete').click();
        await settle();
        $(el, 'c-grid-delete-dialog').dispatchEvent(new CustomEvent(answer));
        await settle();
    };

    it('turns row selection on where rows can be changed or deleted, and not otherwise', async () => {
        let el = mount();
        await settle();
        expect(tableConfig(el)).toMatchObject({ selection: 'multi', maxSelected: MAX_SELECTED });
        select(el, [row(1).Id]);
        await settle();
        expect($(el, '.rh-mass-edit')).not.toBeNull();
        expect($(el, '.rh-mass-delete')).toBeNull(); // this configuration does not allow it
        el.remove();

        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowInlineEdit: false }, diagnostics: false });
        el = mount();
        await settle();
        expect(tableConfig(el).selection).toBeUndefined();
        el.remove();

        withDelete({ allowInlineEdit: false });
        el = mount();
        await settle();
        expect(tableConfig(el).selection).toBe('multi');
        select(el, [row(1).Id]);
        await settle();
        expect($(el, '.rh-mass-edit')).toBeNull();
        expect($(el, '.rh-mass-delete')).not.toBeNull();
    });

    it('shows a selection bar with a selection, and clears it on a reload', async () => {
        withDelete();
        const el = mount();
        await settle();
        expect($(el, '.rh-selection-bar')).toBeNull(); // nothing greyed out waiting for a selection
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        const bar = $(el, '.rh-selection-bar');
        expect(bar.getAttribute('role')).toBe('region');
        expect($(el, '.rh-selection-count').textContent).toBe('2 selected');
        expect($(el, '.rh-mass-edit').label).toBe('Update field');
        expect($(el, '.rh-clear-selection').label).toBe('Clear');
        expect($(el, '.rh-clear-selection').title).toBe('Clear selection');
        expect($(el, '.rh-mass-delete').label).toBe('Delete');
        expect($(el, '.rh-mass-delete').variant).toBe('destructive-text');
        expect($(el, '.rh-count').textContent).toBe('3 items'); // the count line is the list's
        // It floats from the header (positioned under it in CSS), so the table does not
        // move, and the header stays in view: its title and search are not hidden.
        expect(bar.parentElement.classList).toContain('rh-header');
        expect(bar.parentElement.classList).not.toContain('rh-header_selecting');
        expect($(el, '.rh-search')).not.toBeNull();

        const key = tableConfig(el).selectionKey;
        $(el, '.rh-search').dispatchEvent(new CustomEvent('change', { detail: { value: 'Penobscot' } }));
        await jest.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 10);
        await settle();
        expect(tableConfig(el).selectionKey).not.toBe(key);
        expect($(el, '.rh-selection-bar')).toBeNull();
    });

    it('clears the selection from the bar', async () => {
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        const key = tableConfig(el).selectionKey;
        $(el, '.rh-clear-selection').click();
        await settle();
        expect(tableConfig(el).selectionKey).not.toBe(key); // the table clears its own
        expect($(el, '.rh-selection-bar')).toBeNull();
        expect(live(el)).toBe('Selection cleared.');
    });

    it('hands the dialog the selected rows as they are now, with lookup names', async () => {
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        select(el, [row(1).Id, row(3).Id]);
        await settle();
        $(el, '.rh-mass-edit').click();
        await settle();
        expect(dialog(el).rows.map(r => r.Name)).toEqual(['Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 3']);
        expect(dialog(el).refNames).toEqual({});
    });

    it('keeps the dialog value as unsaved edits on the selected rows, in one undo step', async () => {
        const el = mountWatched();
        await settle();
        select(el, [row(1).Id, row(3).Id]);
        await settle();
        $(el, '.rh-mass-edit').click();
        await settle();
        expect(dialog(el).count).toBe(2);
        expect(dialog(el).configName).toBe('Consignments');
        expect(dialog(el).columns.map(c => c.field)).toEqual(['Name', 'Pieces__c']);

        dialog(el).dispatchEvent(
            new CustomEvent('apply', { detail: { field: 'Pieces__c', value: 50, valueLabel: null } })
        );
        await settle();
        expect(dialog(el)).toBeNull();
        expect(tableConfig(el).drafts).toEqual({
            [row(1).Id]: { Pieces__c: 50 },
            [row(3).Id]: { Pieces__c: 50 }
        });
        // Undo is in the Save bar, the table's.
        expect(tableConfig(el).history.undoLabel).toBe('Undo mass update of 2 cells');
        expect(live(el)).toBe('Pieces changed on 2 rows. Save to keep it; Undo takes it back.');
        expect(toasts).toEqual([]); // the yellow cells say it; a toast is for exceptions
        expect(saveRows).not.toHaveBeenCalled();

        table(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({});
    });

    it('closes the dialog on cancel, changing nothing', async () => {
        const el = mount();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        $(el, '.rh-mass-edit').click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect(dialog(el)).toBeNull();
        expect(tableConfig(el).drafts).toEqual({});
    });

    it('marks rows a dependent value does not suit, and clears dependents a new controlling value rules out', async () => {
        const region = {
            field: 'Region__c',
            label: 'Region',
            type: 'picklist',
            editable: true,
            options: [
                { value: 'North', label: 'North' },
                { value: 'South', label: 'South' }
            ]
        };
        const city = {
            field: 'City__c',
            label: 'City',
            type: 'picklist',
            editable: true,
            dependentOn: 'Region__c',
            options: [
                { value: 'Bangor', label: 'Bangor', validFor: ['North'] },
                { value: 'Worcester', label: 'Worcester', validFor: ['South'] }
            ]
        };
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, columns: [...DEFINITION.columns, region, city] },
            diagnostics: false
        });
        fetchRows.mockResolvedValue(
            page([row(1, { Region__c: 'North', City__c: null }), row(2, { Region__c: 'South', City__c: 'Worcester' })])
        );
        const el = mountWatched();
        await settle();
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        $(el, '.rh-mass-edit').click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('apply', { detail: { field: 'City__c', value: 'Bangor' } }));
        await settle();
        let cfg = tableConfig(el);
        expect(cfg.drafts).toEqual({ [row(1).Id]: { City__c: 'Bangor' } });
        expect(cfg.errors[row(2).Id].fields.City__c).toBe('Bangor is not offered when Region is South.');
        expect(toasts[0]).toMatchObject({ variant: 'warning' });
        expect(live(el)).toContain('1 row keeps its value; see the marked cells.');

        $(el, '.rh-mass-edit').click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('apply', { detail: { field: 'Region__c', value: 'North' } }));
        await settle();
        cfg = tableConfig(el);
        expect(cfg.drafts[row(2).Id]).toEqual({ Region__c: 'North', City__c: null });
        expect(live(el)).toContain('City cleared on 1 row');
    });

    it('asks before deleting, naming the rows and saying that unsaved changes are lost', async () => {
        withDelete();
        const el = mount();
        await settle();
        edit(el, row(1).Id, 'Name', 'Kennebec Lumber, 12 bundles', 'Penobscot Paper, load 1');
        select(el, [row(1).Id, row(2).Id]);
        await settle();
        $(el, '.rh-mass-delete').click();
        await settle();
        const ask = $(el, 'c-grid-delete-dialog');
        expect(ask.names).toEqual(['Penobscot Paper, load 1', 'Penobscot Paper, load 2']); // as saved: the dialog names the records
        expect(ask.count).toBe(2);
        expect(ask.hasDrafts).toBe(true);
        ask.dispatchEvent(new CustomEvent('cancel'));
        await settle();
        expect($(el, 'c-grid-delete-dialog')).toBeNull();
        expect(deleteRows).not.toHaveBeenCalled();
        expect(tableConfig(el).rows).toHaveLength(3);
    });

    it('deletes in batches, takes the deleted rows out, and marks the rows that could not be deleted', async () => {
        withDelete();
        const rows = Array.from({ length: 260 }, (_, i) => row(i + 1));
        fetchRows.mockResolvedValue(page(rows));
        const refused = row(7).Id;
        deleteRows.mockImplementation(({ recordIds }) =>
            Promise.resolve({
                deletedIds: recordIds.filter(id => id !== refused),
                errors: recordIds.includes(refused)
                    ? [{ recordId: refused, fieldName: null, message: 'insufficient access rights on object id' }]
                    : []
            })
        );
        const el = mountWatched();
        await settle();
        edit(el, row(1).Id, 'Name', 'Cape Ann Seafood, 14 totes', 'Penobscot Paper, load 1');
        edit(el, row(260).Id, 'Name', 'Narragansett Shellfish, 6 totes', 'Penobscot Paper, load 260');
        select(
            el,
            rows.slice(0, 250).map(r => r.Id)
        );
        await settle();
        const key = tableConfig(el).selectionKey;
        await deleteSelected(el);
        await settle();

        expect(deleteRows).toHaveBeenCalledTimes(2);
        expect(deleteRows.mock.calls.map(([args]) => args.recordIds.length)).toEqual([DELETE_BATCH, 50]);
        expect(deleteRows.mock.calls[0][0].configName).toBe('Consignments');
        const cfg = tableConfig(el);
        expect(cfg.rows.map(r => r.Id)).toEqual([refused, ...rows.slice(250).map(r => r.Id)]);
        expect(cfg.errors[refused].row).toBe('insufficient access rights on object id');
        expect(cfg.drafts).toEqual({ [row(260).Id]: { Name: 'Narragansett Shellfish, 6 totes' } });
        expect(cfg.totalRows).toBe(11);
        expect(cfg.selectionKey).not.toBe(key);
        expect($(el, '.rh-count').textContent).toBe('11 items');
        expect(toasts).toEqual([
            {
                title: 'Deleted with errors',
                message: 'Deleted 249 records. 1 could not be deleted; see the marked rows.',
                variant: 'warning'
            }
        ]);
        // The deleted row's edit left the undo history; the other stays undoable.
        expect(tableConfig(el).history.undoLabel).toBe('Undo edit');
        table(el).dispatchEvent(new CustomEvent('undo'));
        await settle();
        expect(tableConfig(el).drafts).toEqual({});
    });

    it('stops at a batch the server refuses, and says what was and was not deleted', async () => {
        withDelete();
        const rows = Array.from({ length: 250 }, (_, i) => row(i + 1));
        fetchRows.mockResolvedValue(page(rows));
        deleteRows
            .mockImplementationOnce(({ recordIds }) => Promise.resolve({ deletedIds: recordIds, errors: [] }))
            .mockRejectedValueOnce({ body: { message: 'This grid does not allow deleting records.' } });
        const el = mountWatched();
        await settle();
        select(
            el,
            rows.map(r => r.Id)
        );
        await settle();
        await deleteSelected(el);
        await settle();
        expect(tableConfig(el).rows).toHaveLength(50);
        expect(toasts[0]).toEqual({
            title: 'Deleted with errors',
            message: 'Deleted 200 records. The rest were not deleted: This grid does not allow deleting records.',
            variant: 'warning'
        });
    });

    it('says plainly when nothing was deleted', async () => {
        withDelete();
        deleteRows.mockRejectedValue({
            body: { message: 'You do not have permission to delete Consignment__c records.' }
        });
        const el = mountWatched();
        await settle();
        select(el, [row(1).Id]);
        await settle();
        await deleteSelected(el);
        expect(tableConfig(el).rows).toHaveLength(3);
        expect(toasts[0]).toEqual({
            title: 'Not deleted',
            message: 'Nothing was deleted: You do not have permission to delete Consignment__c records.',
            variant: 'error'
        });
    });
});

describe('import', () => {
    const $ = (el, selector) => el.shadowRoot.querySelector(selector);
    const dialog = el => $(el, 'c-grid-import-dialog');
    const withImport = extra =>
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, allowImport: true, canCreate: true, ...extra },
            diagnostics: false
        });

    it('is offered only where the configuration allows it and something is editable', async () => {
        let el = mount();
        await settle();
        expect($(el, '.rh-import')).toBeNull();
        el.remove();
        withImport({ allowInlineEdit: false });
        el = mount();
        await settle();
        expect($(el, '.rh-import')).toBeNull();
        el.remove();
        withImport();
        el = mount();
        await settle();
        expect($(el, '.rh-import').disabled).toBe(false);
        expect($(el, '.rh-import').title).toBe('Import from a CSV or Excel file');
    });

    it('waits until unsaved changes are saved or cancelled', async () => {
        withImport();
        const el = mount();
        await settle();
        table(el).dispatchEvent(
            new CustomEvent('cellchange', {
                detail: {
                    recordId: row(1).Id,
                    field: 'Name',
                    value: 'Green Mountain Maple, 30 cases',
                    originalValue: 'Penobscot Paper, load 1'
                }
            })
        );
        await settle();
        expect($(el, '.rh-import').disabled).toBe(true);
        expect($(el, '.rh-import').title).toBe('Import from a file (save or cancel your changes first)');
    });

    it('hands the dialog what it needs, and reloads the rows when the import wrote something', async () => {
        withImport();
        const el = mount();
        await settle();
        $(el, '.rh-import').click();
        await settle();
        const d = dialog(el);
        expect(d.configName).toBe('Consignments');
        expect(d.canCreate).toBe(true);
        expect(d.rows.map(r => r.Id)).toEqual([row(1).Id, row(2).Id, row(3).Id]);
        expect(d.columns.map(c => c.field)).toEqual(['Name', 'Pieces__c']);
        const calls = fetchRows.mock.calls.length;
        d.dispatchEvent(new CustomEvent('close', { detail: { changed: false } }));
        await settle();
        expect(dialog(el)).toBeNull();
        expect(fetchRows.mock.calls.length).toBe(calls); // nothing written, nothing reloaded
        $(el, '.rh-import').click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('close', { detail: { changed: true } }));
        await settle();
        expect(fetchRows.mock.calls.length).toBe(calls + 1);
    });

    it('gives focus back to the import button, after the reload when there is one', async () => {
        withImport();
        const el = mount();
        await settle();
        const button = $(el, '.rh-import');
        button.focus = jest.fn();
        button.click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('close', { detail: { changed: false } }));
        await settle();
        expect(button.focus).toHaveBeenCalledTimes(1);

        // The reload disables the button, which then cannot take focus: it gets it when the rows are back.
        let release;
        fetchRows.mockReturnValueOnce(
            new Promise(resolve => {
                release = resolve;
            })
        );
        button.click();
        await settle();
        dialog(el).dispatchEvent(new CustomEvent('close', { detail: { changed: true } }));
        await settle();
        expect(button.disabled).toBe(true);
        expect(button.focus).toHaveBeenCalledTimes(1);
        release(page([row(1), row(2), row(3), row(4)]));
        await settle();
        expect(button.disabled).toBe(false);
        expect(button.focus).toHaveBeenCalledTimes(2);
    });
});

describe('grouping and subtotals', () => {
    const GROUPED = {
        ...DEFINITION,
        columns: [
            ...DEFINITION.columns,
            {
                field: 'Service_Level__c',
                label: 'Service Level',
                type: 'picklist',
                editable: true,
                sortable: true,
                groupable: true
            },
            {
                field: 'Ship_Date__c',
                label: 'Ship Date',
                type: 'date',
                editable: true,
                sortable: true,
                groupable: true
            },
            {
                field: 'Freight_Charge__c',
                label: 'Freight Charge',
                type: 'currency',
                scale: 2,
                editable: true,
                sortable: true,
                subtotal: 'sum'
            }
        ],
        grouping: [{ field: 'Service_Level__c', unit: null }]
    };
    const group = (stage, n, sum) => ({ k: [stage], l: [null], n, v: { Freight_Charge__c: { s: sum } } });
    const summaryCall = (extra = {}) => ({
        configName: 'Consignments',
        searchTerm: null,
        grouping: ['Service_Level__c'],
        fromId: null,
        toId: null,
        filters: null,
        recordId: null,
        ...extra
    });
    const groupChange = (el, grouping) =>
        table(el).dispatchEvent(new CustomEvent('groupchange', { detail: { grouping } }));
    const deferred = () => {
        let resolve;
        const promise = new Promise(r => {
            resolve = r;
        });
        return { promise, resolve };
    };

    beforeEach(() => {
        getGridConfig.mockResolvedValue({ definition: GROUPED, diagnostics: false });
        summarizeGroups.mockResolvedValue({
            groups: [group('Standard', 2, '150'), group('Express', 1, '500')],
            boundaries: null,
            tooManyGroups: false
        });
    });

    it('opens with the admin grouping: rows in group order, and counts and subtotals from the server', async () => {
        const el = mount();
        await settle();
        expect(fetchRows.mock.calls[0][0].groupBy).toEqual(['Service_Level__c']);
        expect(summarizeGroups).toHaveBeenCalledTimes(1);
        expect(summarizeGroups).toHaveBeenCalledWith(summaryCall());
        const cfg = tableConfig(el);
        expect(cfg.grouping).toEqual([{ field: 'Service_Level__c', unit: null }]);
        expect(cfg.groupSummary.status).toBe('ready');
        expect(cfg.groupSummary.totals.total.count).toBe(3);
        expect(cfg.groupSummary.totals.total.values.Freight_Charge__c.s).toBe('650');
    });

    it('adds up the slices of a large list, each asked for by its Id range', async () => {
        summarizeGroups
            .mockResolvedValueOnce({
                groups: [group('Standard', 45000, '1.5')],
                boundaries: ['a01A', 'a01B'],
                tooManyGroups: false
            })
            .mockResolvedValueOnce({
                groups: [group('Standard', 45000, '2.25'), group('Express', 1, '7')],
                boundaries: null,
                tooManyGroups: false
            })
            .mockResolvedValueOnce({ groups: [group('Express', 3, '0.25')], boundaries: null, tooManyGroups: false });
        const el = mount();
        await settle();
        await settle();
        expect(summarizeGroups.mock.calls.map(c => [c[0].fromId, c[0].toId])).toEqual([
            [null, null],
            ['a01A', 'a01B'],
            ['a01B', null]
        ]);
        const totals = tableConfig(el).groupSummary.totals;
        expect(totals.total.count).toBe(90004);
        // 1.5 + 2.25 + 7 + 0.25, added as decimals: exact, at the widest scale.
        expect(totals.total.values.Freight_Charge__c.s).toBe('11.00');
        expect(totals.byPath.get('standard').count).toBe(90000);
    });

    it('with every row loaded, a new grouping asks only for counts; the same grouping asks for nothing', async () => {
        const el = mount();
        await settle();
        fetchRows.mockClear();
        summarizeGroups.mockClear();
        groupChange(el, [{ field: 'Ship_Date__c', unit: 'quarter' }]);
        await settle();
        expect(fetchRows).not.toHaveBeenCalled();
        expect(summarizeGroups).toHaveBeenCalledWith(summaryCall({ grouping: ['Ship_Date__c:quarter'] }));
        expect(tableConfig(el).grouping).toEqual([{ field: 'Ship_Date__c', unit: 'quarter' }]);

        summarizeGroups.mockClear();
        groupChange(el, [{ field: 'Ship_Date__c', unit: 'quarter' }]);
        await settle();
        expect(summarizeGroups).not.toHaveBeenCalled();
    });

    it('with rows still on the server, a new grouping reloads them in group order', async () => {
        fetchRows.mockResolvedValue(page([row(1), row(2)], { hasMore: true, locator: 'fp:2', total: 50000 }));
        const el = mount();
        await settle();
        fetchRows.mockClear();
        fetchRows.mockResolvedValue(page([row(1), row(2)]));
        groupChange(el, []);
        await settle();
        expect(fetchRows).toHaveBeenCalledTimes(1);
        expect(fetchRows.mock.calls[0][0].groupBy).toBeUndefined();
        expect(fetchRows.mock.calls[0][0].cursorLocator).toBeNull();
        // Not grouped, but Freight Charge has a subtotal: the Total row still needs one call.
        expect(summarizeGroups).toHaveBeenLastCalledWith(summaryCall({ grouping: [] }));
    });

    it('a search asks for new counts, and an older answer that arrives late is dropped', async () => {
        const slow = deferred();
        summarizeGroups.mockReturnValueOnce(slow.promise);
        const el = mount();
        await settle();
        expect(tableConfig(el).groupSummary).toEqual({ status: 'loading' });
        summarizeGroups.mockResolvedValueOnce({
            groups: [group('Express', 1, '5')],
            boundaries: null,
            tooManyGroups: false
        });
        el.shadowRoot
            .querySelector('.rh-search')
            .dispatchEvent(new CustomEvent('change', { detail: { value: 'Bangor' } }));
        jest.advanceTimersByTime(SEARCH_DELAY_MS);
        await settle();
        expect(summarizeGroups).toHaveBeenLastCalledWith(summaryCall({ searchTerm: 'Bangor' }));
        slow.resolve({ groups: [group('Standard', 99, '1')], boundaries: null, tooManyGroups: false });
        await settle();
        expect(tableConfig(el).groupSummary.totals.total.count).toBe(1);
    });

    it('too many groups: no counts, and says what to do', async () => {
        summarizeGroups.mockResolvedValue({ groups: [], boundaries: null, tooManyGroups: true });
        const el = mount();
        await settle();
        expect(tableConfig(el).groupSummary).toEqual({ status: 'unavailable' });
        expect(el.shadowRoot.querySelector('.rh-notice').textContent).toBe(
            'This list has too many groups to count. Group by fewer columns, a date by a longer period, or search to narrow the list.'
        );
    });

    it('a failed call leaves the grid working, without counts, and says why', async () => {
        summarizeGroups.mockRejectedValue({ body: { message: 'Cannot group by Service Level.' } });
        const el = mount();
        await settle();
        expect(tableConfig(el).rows).toHaveLength(3);
        expect(tableConfig(el).groupSummary).toEqual({ status: 'unavailable' });
        expect(el.shadowRoot.querySelector('.rh-notice').textContent).toBe(
            'Counts and subtotals could not be loaded. Cannot group by Service Level.'
        );
    });

    it('asks again after a save, since saved values can move a record or change a subtotal', async () => {
        const el = mount();
        await settle();
        summarizeGroups.mockClear();
        table(el).dispatchEvent(
            new CustomEvent('cellchange', {
                detail: {
                    recordId: row(1).Id,
                    field: 'Name',
                    value: 'Pioneer Valley Orchards, 60 bushels',
                    originalValue: 'Penobscot Paper, load 1'
                }
            })
        );
        saveRows.mockResolvedValue({
            saveId: 's1',
            done: true,
            chunkCount: 1,
            successCount: 1,
            errors: [],
            rejectedFields: [],
            strippedFields: []
        });
        fetchRowsById.mockResolvedValue([row(1, { Name: 'Pioneer Valley Orchards, 60 bushels' })]);
        table(el).dispatchEvent(new CustomEvent('save'));
        await settle();
        await jest.advanceTimersByTimeAsync(100);
        await settle();
        expect(summarizeGroups).toHaveBeenCalledTimes(1);
    });

    it('asks for nothing when the grid has no grouping and no subtotals', async () => {
        getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
        const el = mount();
        await settle();
        expect(summarizeGroups).not.toHaveBeenCalled();
        expect(tableConfig(el).groupSummary).toBeNull();
        expect(tableConfig(el).grouping).toEqual([]);
    });
});

describe('child tables', () => {
    const CHILDREN = [
        {
            name: 'Consignments_Items',
            label: 'Consignment Items',
            configName: 'Consignment_Items',
            objectApiName: 'Consignment_Item__c',
            relationshipField: 'Consignment__c'
        }
    ];
    const PARENT = {
        link: 'Consignments_Items',
        id: 'a00000000000000001',
        name: 'Penobscot Paper, load 1',
        level: 2,
        height: null
    };
    const $ = (el, selector) => el.shadowRoot.querySelector(selector);
    const mountChild = (parent = PARENT, configName = 'Consignment_Items') => {
        const el = createElement('c-grid-view', { is: GridView });
        el.configName = configName;
        el.parent = parent;
        document.body.appendChild(el);
        return el;
    };

    beforeEach(() => {
        getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, children: CHILDREN }, diagnostics: false });
    });

    it('a top-level grid sends no parent, and hands the table its tabs at level 1', async () => {
        const el = mount();
        await settle();
        expect(fetchRows.mock.calls[0][0]).not.toHaveProperty('parentLink');
        expect(fetchRows.mock.calls[0][0]).not.toHaveProperty('parentId');
        const cfg = tableConfig(el);
        expect(cfg.children).toEqual(CHILDREN);
        expect(cfg.level).toBe(1);
        expect(cfg.height).toBeNull();
        expect($(el, 'article').className).toBe('slds-card rh-app');
    });

    it("a child table asks for its parent's rows only, through the link it is shown in", async () => {
        mountChild();
        await settle();
        expect(getGridConfig).toHaveBeenCalledWith({ configName: 'Consignment_Items' });
        expect(fetchRows).toHaveBeenCalledWith(
            expect.objectContaining({
                configName: 'Consignment_Items',
                parentLink: 'Consignments_Items',
                parentId: PARENT.id
            })
        );
    });

    it('a child table is a fixed height, one level down, with no card box; its title is for screen readers', async () => {
        const el = mountChild();
        await settle();
        const cfg = tableConfig(el);
        expect(cfg.height).toBe(childTableHeight(2)); // its parent's panel, less the tabs and header
        expect(cfg.height).toBe(388);
        expect(cfg.level).toBe(2);
        expect(cfg.children).toEqual(CHILDREN);
        expect($(el, 'article').className).toBe('rh-app rh-app_nested');
        expect($(el, 'h2').className).toBe('slds-assistive-text');
        expect($(el, 'h2').textContent.trim()).toContain('Open Consignments');
    });

    it('a child table is as tall as the Height the admin gave its tab', async () => {
        const el = mountChild({ ...PARENT, height: 600 });
        await settle();
        expect(tableConfig(el).height).toBe(600);
    });

    it('the deepest level gets no tabs of its own', async () => {
        const el = mountChild({ ...PARENT, level: MAX_LEVELS });
        await settle();
        expect(tableConfig(el).level).toBe(MAX_LEVELS);
        expect(tableConfig(el).children).toEqual([]);
        expect(tableConfig(el).height).toBe(168); // inside a level-2 row's shorter panel
    });

    it('reloads for another parent record; the same one handed again changes nothing (HR-17)', async () => {
        const el = mountChild();
        await settle();
        const calls = fetchRows.mock.calls.length;
        const before = tableConfig(el);
        el.parent = { ...PARENT };
        await settle();
        expect(fetchRows.mock.calls.length).toBe(calls);
        expect(tableConfig(el)).toBe(before);
        el.parent = { ...PARENT, id: 'a00000000000000002', name: 'Penobscot Paper, load 2' };
        await settle();
        expect(fetchRows.mock.calls.length).toBeGreaterThan(calls);
        expect(fetchRows.mock.calls[fetchRows.mock.calls.length - 1][0].parentId).toBe('a00000000000000002');
    });

    it('ignores a parent without a link or a record', async () => {
        const el = mountChild({ link: 'Consignments_Items' });
        await settle();
        expect(el.parent).toBeNull();
        expect(fetchRows.mock.calls[0][0]).not.toHaveProperty('parentId');
    });

    it('counts and subtotals go with the parent too', async () => {
        getGridConfig.mockResolvedValue({
            definition: {
                ...DEFINITION,
                columns: [
                    ...DEFINITION.columns,
                    { field: 'Freight_Charge__c', label: 'Freight Charge', type: 'currency', scale: 2, subtotal: 'sum' }
                ]
            },
            diagnostics: false
        });
        summarizeGroups.mockResolvedValue({
            groups: [{ k: [], l: [], n: 3, v: { Freight_Charge__c: { s: '6' } } }],
            boundaries: null,
            tooManyGroups: false
        });
        mountChild();
        await settle();
        expect(summarizeGroups).toHaveBeenCalledWith(
            expect.objectContaining({ parentLink: 'Consignments_Items', parentId: PARENT.id })
        );
    });

    it('hands the import dialog the parent, so new rows are created under it', async () => {
        getGridConfig.mockResolvedValue({
            definition: { ...DEFINITION, allowImport: true, canCreate: true },
            diagnostics: false
        });
        const el = mountChild();
        await settle();
        // A child table's actions are in one menu beside its search.
        expect($(el, '.rh-import')).toBeNull();
        $(el, '.rh-actions-menu').dispatchEvent(new CustomEvent('select', { detail: { value: 'import' } }));
        await settle();
        expect($(el, 'c-grid-import-dialog').parent).toEqual(PARENT);
    });

    it('focus() goes to its table', async () => {
        const el = mountChild();
        await settle();
        const spy = jest.spyOn(table(el), 'focus');
        el.focus();
        expect(spy).toHaveBeenCalled();
    });
});

describe('list view details', () => {
    const $ = (el, selector) => el.shadowRoot.querySelector(selector);
    const live = el => $(el, '.rh-live').textContent;
    const search = async (el, value) => {
        $(el, '.rh-search').dispatchEvent(new CustomEvent('change', { detail: { value } }));
        await jest.advanceTimersByTimeAsync(SEARCH_DELAY_MS + 10);
        await settle();
    };

    afterEach(() => {
        delete global.ResizeObserver;
    });

    describe("the header, as a list view's", () => {
        it("shows the object's icon, the count, the sort and when it was loaded", async () => {
            getGridConfig.mockResolvedValue({
                definition: { ...DEFINITION, objectIcon: 'custom:custom57' },
                diagnostics: false
            });
            const el = mount();
            await settle();
            expect($(el, '.rh-object-icon').iconName).toBe('custom:custom57');
            expect($(el, '.rh-count').textContent).toBe('3 items');
            expect($(el, '.rh-sorted').textContent).toBe('Sorted by Name');
            expect($(el, '.rh-updated lightning-relative-date-time').value).toEqual(expect.any(Number));
        });

        it('falls back to the record icon, and says every sort key', async () => {
            const el = mount();
            await settle();
            expect($(el, '.rh-object-icon').iconName).toBe('standard:record');
            table(el).dispatchEvent(
                new CustomEvent('sortchange', {
                    detail: {
                        sort: [
                            { field: 'Pieces__c', direction: 'desc' },
                            { field: 'Name', direction: 'asc' }
                        ]
                    }
                })
            );
            await settle();
            expect($(el, '.rh-sorted').textContent).toBe('Sorted by Pieces, then Name');
        });

        it('labels Import and Export, and offers Refresh, which waits for unsaved changes', async () => {
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowImport: true }, diagnostics: false });
            const el = mount();
            await settle();
            expect($(el, '.rh-import').label).toBe('Import');
            expect($(el, '.rh-export').label).toBe('Export');
            const refresh = $(el, '.rh-refresh');
            expect(refresh.disabled).toBe(false);
            table(el).dispatchEvent(
                new CustomEvent('cellchange', {
                    detail: {
                        recordId: row(1).Id,
                        field: 'Name',
                        value: 'Green Mountain Maple, 30 cases',
                        originalValue: 'Penobscot Paper, load 1'
                    }
                })
            );
            await settle();
            expect(refresh.disabled).toBe(true);
            expect(refresh.alternativeText).toBe('Refresh (save or cancel your changes first)');
            table(el).dispatchEvent(new CustomEvent('cancel'));
            await settle();
            const before = fetchRows.mock.calls.length;
            refresh.click();
            await settle();
            expect(fetchRows.mock.calls.length).toBe(before + 1);
            expect(live(el)).toBe('3 rows loaded.');
        });

        it('has Refresh work TODAY out again for the display rules', async () => {
            const el = mount();
            await settle();
            // Until a Refresh, the rules keep the day they were first read.
            expect(table(el).config.formatToday).toBeNull();
            $(el, '.rh-refresh').click();
            await settle();
            expect(table(el).config.formatToday).toBe(dateIn(new Date()));
        });

        it('folds the actions into one menu when narrow, measured on its own root (HR-24)', async () => {
            const observers = [];
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
            const el = mount();
            await settle();
            expect($(el, '.rh-actions-menu')).toBeNull();
            expect(observers[0].target.hasAttribute('data-view-root')).toBe(true);
            observers[0].cb([{ contentRect: { width: NARROW_WIDTH - 80 } }]);
            await settle();
            expect($(el, '.rh-export')).toBeNull();
            // The title takes the first line, the search the second.
            expect($(el, '.rh-header').classList).toContain('rh-header_narrow');
            const items = [...el.shadowRoot.querySelectorAll('.rh-actions-menu lightning-menu-item')].map(i => i.label);
            expect(items).toEqual(['Refresh', 'Choose columns', 'Export', 'Filters', 'Help']);
            $(el, '.rh-actions-menu').dispatchEvent(new CustomEvent('select', { detail: { value: 'export' } }));
            await settle();
            expect($(el, 'c-grid-export-dialog')).not.toBeNull();
            $(el, 'c-grid-export-dialog').dispatchEvent(new CustomEvent('cancel'));
            await settle();
            observers[0].cb([{ contentRect: { width: 900 } }]);
            await settle();
            expect($(el, '.rh-export')).not.toBeNull();
            expect($(el, '.rh-header').classList).not.toContain('rh-header_narrow');
        });

        it('keeps its toolbar while its width is not known yet (a hidden tab)', async () => {
            const observers = [];
            global.ResizeObserver = class {
                constructor(cb) {
                    observers.push(cb);
                }
                observe() {}
                disconnect() {}
            };
            const el = mount();
            await settle();
            observers[0]([{ contentRect: { width: 0 } }]);
            await settle();
            expect($(el, '.rh-actions-menu')).toBeNull();
        });

        it('folds the actions wherever the toolbar is wider than the card, as in a record page column', async () => {
            const observers = [];
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
            const el = mount();
            await settle();
            const grid = observers.find(o => o.target.hasAttribute('data-view-root'));
            const bar = observers.find(o => o.target.classList.contains('rh-toolbar'));
            expect(bar).toBeDefined();
            // The full toolbar is 750px wide; the header is as wide as the card.
            let width = 600;
            Object.defineProperty($(el, '.rh-header'), 'clientWidth', { get: () => width, configurable: true });
            $(el, '.rh-toolbar').getBoundingClientRect = () => ({ width: 750 });
            grid.cb([{ contentRect: { width } }]);
            await settle();
            expect($(el, '.rh-actions-menu')).not.toBeNull();
            expect($(el, '.rh-export')).toBeNull();
            expect($(el, '.rh-header').classList).toContain('rh-header_narrow');
            // Wider, but still short of what the toolbar needs: still folded.
            width = 700;
            grid.cb([{ contentRect: { width } }]);
            await settle();
            expect($(el, '.rh-actions-menu')).not.toBeNull();
            // Room for all of it: the buttons come back.
            width = 760;
            grid.cb([{ contentRect: { width } }]);
            await settle();
            expect($(el, '.rh-actions-menu')).toBeNull();
            expect($(el, '.rh-export')).not.toBeNull();
            expect($(el, '.rh-header').classList).not.toContain('rh-header_narrow');
            // A button more makes the toolbar wider, not the card: the toolbar's own observer folds it.
            $(el, '.rh-toolbar').getBoundingClientRect = () => ({ width: 790 });
            $(el, '[data-view-root]').getBoundingClientRect = () => ({ width });
            bar.cb([]);
            await settle();
            expect($(el, '.rh-actions-menu')).not.toBeNull();
        });
    });

    describe('the Display Key', () => {
        const RULES = [
            {
                name: 'Late',
                label: 'Overdue',
                field: 'Pieces__c',
                type: 'number',
                operator: 'less_than',
                value: '0',
                style: 'text_red',
                applyTo: 'cell'
            },
            {
                name: 'Large_Load',
                label: 'Large load',
                field: 'Pieces__c',
                type: 'number',
                operator: 'greater_than',
                value: '9',
                style: 'fill_purple',
                applyTo: 'row'
            }
        ];
        // One drawn frame: the key opens after the spinner is drawn, the spinner
        // goes after the key is drawn (gridView.js afterNextPaint). This file runs
        // on Jest's fake clock, which fakes frames too (16ms each).
        const paint = () => jest.advanceTimersByTimeAsync(20);
        const mountWithRules = async () => {
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, displayRules: RULES }, diagnostics: false });
            const el = mount();
            await settle();
            return el;
        };
        const spinner = el => $(el, '.rh-display-key-wrap .rh-display-key-cover .rh-display-key-spinner');

        it('covers the icon with a spinner while the key opens, then shows the key and the switch on', async () => {
            const el = await mountWithRules();
            const toggle = $(el, '.rh-display-key-toggle');
            expect(spinner(el)).toBeNull();
            expect(toggle.selected).toBe(false);

            toggle.click();
            await settle();
            // The spinner first, over the icon; the key not yet.
            expect(spinner(el).getAttribute('role')).toBe('status');
            expect(spinner(el).textContent.trim()).toBe('Opening the Display Key');
            expect($(el, '.rh-display-key-toggle')).toBe(toggle); // the switch stays, so nothing moves
            expect($(el, '.rh-display-key')).toBeNull();

            await paint();
            await settle();
            // The key, with the spinner still there until the key has been drawn.
            expect($(el, '.rh-display-key')).not.toBeNull();
            expect(toggle.selected).toBe(true);
            expect(spinner(el)).not.toBeNull();

            await paint();
            await settle();
            expect(spinner(el)).toBeNull();
            expect($(el, '.rh-display-key-cover')).toBeNull();
        });

        it('says it is closing when it closes, and ignores a second click while it works', async () => {
            const el = await mountWithRules();
            const toggle = $(el, '.rh-display-key-toggle');
            toggle.click();
            await settle();
            toggle.click(); // while the first is still working: not a second toggle
            await paint();
            await paint();
            await settle();
            expect($(el, '.rh-display-key')).not.toBeNull();

            toggle.click();
            await settle();
            expect(spinner(el).textContent.trim()).toBe('Closing the Display Key');
            await paint();
            await paint();
            await settle();
            expect($(el, '.rh-display-key')).toBeNull();
            expect(toggle.selected).toBe(false);
            expect(spinner(el)).toBeNull();
        });

        it('is an icon switch named Display Key, right after Charts', async () => {
            const columns = [{ ...DEFINITION.columns[0], groupable: true }, DEFINITION.columns[1]];
            getGridConfig.mockResolvedValue({
                definition: { ...DEFINITION, columns, displayRules: RULES },
                diagnostics: false
            });
            const el = mount();
            await settle();
            const toggle = $(el, '.rh-display-key-toggle');
            expect(toggle.tagName.toLowerCase()).toBe('lightning-button-icon-stateful');
            expect(toggle.iconName).toBe('utility:color_swatch');
            expect(toggle.alternativeText).toBe('Display Key');
            expect(toggle.tooltip).toBe('Display Key');
            expect(toggle.textContent.trim()).toBe('');
            const charts = $(el, '.rh-charts');
            expect(charts.nextElementSibling).toBe($(el, '.rh-display-key-wrap'));
        });

        it('is offered only with display rules, and says what each color means', async () => {
            let el = mount();
            await settle();
            expect($(el, '.rh-display-key-toggle')).toBeNull();
            el.remove();

            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, displayRules: RULES }, diagnostics: false });
            el = mount();
            await settle();
            const toggle = $(el, '.rh-display-key-toggle');
            expect(toggle.alternativeText).toBe('Display Key');
            expect(toggle.selected).toBe(false);
            expect($(el, '.rh-display-key')).toBeNull();
            toggle.click();
            await paint();
            await settle();
            expect(toggle.selected).toBe(true);
            expect($(el, '.rh-display-key').getAttribute('aria-label')).toBe('Display Key');
            const items = [...el.shadowRoot.querySelectorAll('.rh-display-key li')];
            expect(items.map(li => li.textContent)).toEqual(['AaOverdue: Red text, Cell', 'AaLarge load: Purple, Row']);
            const swatches = [...el.shadowRoot.querySelectorAll('.rh-display-key .rh-display-key-swatch')].map(
                sw => sw.className
            );
            expect(swatches[0]).toContain('rh-rule_text-red');
            expect(swatches[1]).toContain('rh-display-key-swatch_bar');
            expect(swatches[1]).toContain('rh-rule_bar-purple');
        });
    });

    describe('an empty list', () => {
        it('after a search, says so and offers to clear it', async () => {
            const el = mount();
            await settle();
            fetchRows.mockResolvedValue(page([]));
            await search(el, 'Calais');
            expect(tableConfig(el).emptyState).toMatchObject({
                title: 'No records match “Calais”',
                actionLabel: 'Clear search'
            });
            fetchRows.mockResolvedValue(page([row(1)]));
            table(el).dispatchEvent(new CustomEvent('emptyaction'));
            await settle();
            expect(fetchRows.mock.calls[fetchRows.mock.calls.length - 1][0].searchTerm).toBeNull();
            expect($(el, '.rh-search').value).toBe('');
            expect(tableConfig(el).rows).toHaveLength(1);
        });

        it('with nothing yet, offers an import where the grid allows one', async () => {
            fetchRows.mockResolvedValue(page([]));
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, allowImport: true }, diagnostics: false });
            let el = mount();
            await settle();
            expect(tableConfig(el).emptyState).toMatchObject({ title: 'No records yet', actionLabel: 'Import' });
            table(el).dispatchEvent(new CustomEvent('emptyaction'));
            await settle();
            expect($(el, 'c-grid-import-dialog')).not.toBeNull();
            el.remove();

            getGridConfig.mockResolvedValue({ definition: DEFINITION, diagnostics: false });
            el = mount();
            await settle();
            expect(tableConfig(el).emptyState).toMatchObject({ title: 'No records yet', actionLabel: null });
        });
    });

    describe('child tables: counts', () => {
        const CHILDREN = [{ name: 'Consignments_Items', label: 'Consignment Items', configName: 'Consignment_Items' }];

        it('asks how many related records each row has, and hands the counts to the table', async () => {
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, children: CHILDREN }, diagnostics: false });
            countChildren.mockResolvedValue({ [row(1).Id]: { total: 2, byTab: { Consignments_Items: 2 } } });
            const el = mount();
            await settle();
            expect(countChildren).toHaveBeenCalledWith({
                configName: 'Consignments',
                parentIds: [row(1).Id, row(2).Id, row(3).Id]
            });
            expect(tableConfig(el).childCounts[row(1).Id]).toEqual({ total: 2, byTab: { Consignments_Items: 2 } });
            expect(tableConfig(el).childCountsFailed).toBe(false);

            // A child table's own count changed: the row's follows.
            table(el).dispatchEvent(
                new CustomEvent('childcount', {
                    detail: { parentId: row(1).Id, tab: 'Consignments_Items', count: 5 }
                })
            );
            await settle();
            expect(tableConfig(el).childCounts[row(1).Id]).toEqual({ total: 5, byTab: { Consignments_Items: 5 } });
        });

        it(`asks in batches of ${COUNT_BATCH}, and does not ask again for rows it knows`, async () => {
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, children: CHILDREN }, diagnostics: false });
            const rows = Array.from({ length: COUNT_BATCH + 5 }, (_, i) => row(i + 1));
            fetchRows.mockResolvedValue(page(rows));
            countChildren.mockImplementation(({ parentIds }) =>
                Promise.resolve(Object.fromEntries(parentIds.map(id => [id, { total: 0, byTab: {} }])))
            );
            mount();
            await settle();
            await settle();
            expect(countChildren.mock.calls.map(([args]) => args.parentIds.length)).toEqual([COUNT_BATCH, 5]);
        });

        it('does not ask without tabs, and a failed count says so, so the table offers every toggle', async () => {
            mount();
            await settle();
            expect(countChildren).not.toHaveBeenCalled();
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, children: CHILDREN }, diagnostics: false });
            countChildren.mockRejectedValue({ body: { message: 'Your query request was running for too long.' } });
            const el = mount();
            await settle();
            expect(tableConfig(el).childCounts).toEqual({});
            expect(tableConfig(el).childCountsFailed).toBe(true);
            expect($(el, '.rh-load-error')).toBeNull();
        });

        it('says the counts are on the way, not failed, until they arrive', async () => {
            getGridConfig.mockResolvedValue({ definition: { ...DEFINITION, children: CHILDREN }, diagnostics: false });
            let answer;
            countChildren.mockReturnValue(
                new Promise(resolve => {
                    answer = resolve;
                })
            );
            const el = mount();
            await settle();
            // Rows are in; their counts are not: the table offers no toggle yet.
            expect(tableConfig(el).rows).toHaveLength(3);
            expect(tableConfig(el).childCounts).toEqual({});
            expect(tableConfig(el).childCountsFailed).toBe(false);
            answer({ [row(1).Id]: { total: 1, byTab: { Consignments_Items: 1 } } });
            await settle();
            expect(tableConfig(el).childCounts[row(1).Id].total).toBe(1);
        });

        it("a child table tells its tab its count after it loads, but not a search's", async () => {
            const el = createElement('c-grid-view', { is: GridView });
            el.configName = 'Consignment_Items';
            el.parent = {
                link: 'Consignments_Items',
                id: 'a00000000000000001',
                name: 'Penobscot Paper, load 1',
                level: 2
            };
            const told = [];
            el.addEventListener('countchange', e => told.push(e.detail.count));
            document.body.appendChild(el);
            await settle();
            expect(told).toEqual([3]);
            fetchRows.mockResolvedValue(page([row(1)]));
            await search(el, 'Penobscot');
            expect(told).toEqual([3]);
            // A nested grid shows no count line: its tab says it.
            expect($(el, '.rh-count')).toBeNull();
        });
    });
});
