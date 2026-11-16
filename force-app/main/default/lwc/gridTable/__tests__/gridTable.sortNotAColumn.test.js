/**
 * The admin's sort may start on a field that is no column (Default Sort Field
 * set in Setup: a contact grid sorted by Last Name, showing Full Name). The
 * table cannot compare that field, so where it decides the rows keep the
 * server's order, which has it; the sorts after it still apply among rows the
 * server put level.
 */
import { createElement } from 'lwc';
import GridTable from 'c/gridTable';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const COLUMNS = [
    { field: 'Name', label: 'Full Name', type: 'text', sortable: true },
    { field: 'Title', label: 'Title', type: 'text', sortable: true }
];
const id = n => `003000000000000${n}AA`.slice(0, 18);
// In the server's order: by Last Name (no column), then Title.
const ROWS = [
    { Id: id(3), Name: 'Lauren Boyle', Title: 'SVP, Technology' },
    { Id: id(1), Name: 'Molly Fitzgerald', Title: 'VP, Sales' },
    { Id: id(2), Name: 'Avi Green', Title: 'CFO' }
];

let el;
const mount = async sort => {
    el = createElement('c-grid-table', { is: GridTable });
    el.config = { columns: COLUMNS, rows: ROWS, totalRows: ROWS.length, sort };
    document.body.appendChild(el);
    await flush();
};
const order = () => [...el.shadowRoot.querySelectorAll('tbody tr[data-row-id]')].map(r => r.dataset.rowId);

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it("keeps the server's order when the first sort is on a field that is no column", async () => {
    await mount([
        { field: 'LastName', direction: 'asc' },
        { field: 'Title', direction: 'asc' }
    ]);
    expect(order()).toEqual([id(3), id(1), id(2)]);
});

it('sorts by the columns it can, as before', async () => {
    await mount([{ field: 'Title', direction: 'asc' }]);
    expect(order()).toEqual([id(2), id(3), id(1)]); // CFO, SVP, VP
});
