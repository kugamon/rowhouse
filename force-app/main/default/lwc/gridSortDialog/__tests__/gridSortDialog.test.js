/**
 * The Sort dialog, as drawn in mock-up D: Sort by, then Then by rows, each a
 * column and a direction, with arrows, a bin and Add sort; up to five; a
 * column offered once; Done saves the levels, Cancel and Escape do not.
 */
import { createElement } from 'lwc';
import GridSortDialog from 'c/gridSortDialog';

const OPTIONS = [
    { value: 'StageName', label: 'Stage' },
    { value: 'LastModifiedDate', label: 'Last Modified Date' },
    { value: 'Amount', label: 'Amount' },
    { value: 'CloseDate', label: 'Close Date' },
    { value: 'Name', label: 'Opportunity Name' },
    { value: 'Type', label: 'Type' }
];
const LEVELS = [
    { field: 'StageName', direction: 'asc' },
    { field: 'LastModifiedDate', direction: 'desc' }
];

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
let el;
let events;
const $ = selector => el.shadowRoot.querySelector(selector);
const $$ = selector => [...el.shadowRoot.querySelectorAll(selector)];
const choose = async (target, value) => {
    target.dispatchEvent(new CustomEvent('change', { detail: { value } }));
    await flush();
};
const click = async target => {
    target.dispatchEvent(new CustomEvent('click'));
    await flush();
};
const fields = () => $$('.rh-sort-field').map(c => c.value);

async function mount(props = {}) {
    el = createElement('c-grid-sort-dialog', { is: GridSortDialog });
    Object.assign(el, { levels: LEVELS, options: OPTIONS, gridLabel: 'Pipeline Review', ...props });
    events = [];
    el.addEventListener('save', e => events.push({ name: 'save', detail: e.detail }));
    el.addEventListener('cancel', () => events.push({ name: 'cancel' }));
    document.body.appendChild(el);
    await flush();
}

afterEach(() => {
    while (document.body.firstChild) document.body.firstChild.remove();
});

it('shows the sort as rows: Sort by, then Then by, each a column and a direction', async () => {
    await mount();
    expect($('h1').textContent).toBe('Sort');
    expect($('.rh-sort-intro').textContent).toContain('The order Pipeline Review opens in: first by any field');
    expect($$('.rh-sort-row-label').map(l => l.textContent)).toEqual(['Sort by', 'Then by']);
    expect(fields()).toEqual(['StageName', 'LastModifiedDate']);
    expect($$('.rh-sort-direction').map(c => c.value)).toEqual(['asc', 'desc']);
    expect($$('.rh-sort-direction')[0].options.map(o => o.label)).toEqual(['Ascending', 'Descending']);
    expect($$('.rh-sort-field').map(c => c.label)).toEqual(['Sort by', 'Then by 1']);
    expect($('.rh-sort-hint').textContent).toBe('Up to 5.');
});

it('offers each column once: a row leaves out the columns the other rows have', async () => {
    await mount();
    const [first, second] = $$('.rh-sort-field');
    expect(first.options.map(o => o.value)).not.toContain('LastModifiedDate');
    expect(first.options.map(o => o.value)).toContain('StageName');
    expect(second.options.map(o => o.value)).not.toContain('StageName');
});

it('starts with one empty Sort by row when there is no sort', async () => {
    await mount({ levels: [] });
    expect(fields()).toEqual([null]);
    expect($('.rh-sort-save').disabled).toBe(true);
    await choose($('.rh-sort-field'), 'Amount');
    expect($('.rh-sort-save').disabled).toBe(false);
});

it('adds rows up to five, and moves and removes them', async () => {
    await mount();
    await click($('.rh-sort-add'));
    expect(fields()).toEqual(['StageName', 'LastModifiedDate', null]);
    expect($('.rh-sort-save').disabled).toBe(true); // a row without its column
    await choose($$('.rh-sort-field')[2], 'Amount');
    await click($('.rh-sort-add'));
    await choose($$('.rh-sort-field')[3], 'CloseDate');
    await click($('.rh-sort-add'));
    await choose($$('.rh-sort-field')[4], 'Name');
    expect($('.rh-sort-add').disabled).toBe(true);

    expect($$('.rh-sort-up')[0].disabled).toBe(true);
    expect($$('.rh-sort-down')[4].disabled).toBe(true);
    await click($$('.rh-sort-up')[2]);
    expect(fields()).toEqual(['StageName', 'Amount', 'LastModifiedDate', 'CloseDate', 'Name']);
    await click($$('.rh-sort-down')[0]);
    expect(fields()).toEqual(['Amount', 'StageName', 'LastModifiedDate', 'CloseDate', 'Name']);
    expect($$('.rh-sort-remove')[1].alternativeText).toBe('Remove Then by 1');
    await click($$('.rh-sort-remove')[1]);
    expect(fields()).toEqual(['Amount', 'LastModifiedDate', 'CloseDate', 'Name']);
    expect($('.rh-sort-add').disabled).toBe(false);
});

it('Done saves the levels in order; with every row removed, no sort', async () => {
    await mount();
    await choose($$('.rh-sort-direction')[0], 'desc');
    await click($('.rh-sort-save'));
    expect(events).toEqual([
        {
            name: 'save',
            detail: {
                levels: [
                    { field: 'StageName', direction: 'desc' },
                    { field: 'LastModifiedDate', direction: 'desc' }
                ]
            }
        }
    ]);

    await mount();
    await click($$('.rh-sort-remove')[1]);
    await click($$('.rh-sort-remove')[0]);
    expect($('.rh-sort-none').textContent).toContain('No sort');
    await click($('.rh-sort-save'));
    expect(events).toEqual([{ name: 'save', detail: { levels: [] } }]);
});

it('Cancel and Escape save nothing, and Escape goes no further', async () => {
    await mount();
    await click($('.rh-sort-cancel'));
    expect(events).toEqual([{ name: 'cancel' }]);

    await mount();
    const outside = jest.fn();
    document.body.addEventListener('keydown', outside);
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true });
    $('section').dispatchEvent(esc);
    await flush();
    expect(events).toEqual([{ name: 'cancel' }]);
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', outside);
});

it('Sort by can be any field; such a field stays first, and Then by rows are columns', async () => {
    const FIRST = [...OPTIONS, { value: 'LastName', label: 'Last Name (LastName)' }];
    await mount({ firstOptions: FIRST, levels: [{ field: 'LastName', direction: 'asc' }] });
    expect($$('.rh-sort-field')[0].options.map(o => o.value)).toContain('LastName');
    await click($('.rh-sort-add'));
    await choose($$('.rh-sort-field')[1], 'Amount');
    expect($$('.rh-sort-field')[1].options.map(o => o.value)).not.toContain('LastName');
    expect($$('.rh-sort-down')[0].disabled).toBe(true);
    expect($$('.rh-sort-up')[1].disabled).toBe(true);
    // A column first can move, as before.
    await choose($$('.rh-sort-field')[0], 'StageName');
    expect($$('.rh-sort-down')[0].disabled).toBe(false);
    expect($$('.rh-sort-up')[1].disabled).toBe(false);
});

it('is accessible', async () => {
    await mount();
    await expect(el).toBeAccessible();
});
