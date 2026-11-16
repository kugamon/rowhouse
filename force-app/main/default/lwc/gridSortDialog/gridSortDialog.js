/**
 * gridSortDialog — Sort: the order a grid opens in, from the Columns tab of
 * the grid's settings. One row for each level: Sort by, then up to four Then
 * by rows, each a column and Ascending or Descending, with arrows to move it
 * and a bin to remove it; Add sort adds a row, as a list view's Column Sort
 * does. Sort by can be any field the grid can sort by (Last Name, say, on a
 * grid that shows Full Name); a Then by row, a column that can be sorted. Such
 * a field stays first: it cannot move down, nor another row above it. A field
 * is offered once: a row's list leaves out what the other rows have. With
 * every row removed, the grid opens unsorted.
 *
 * The SLDS modal blueprint, as the grid's other dialogs: focus starts on the
 * first row's column and stays inside (a guard at each end sends it round);
 * Escape cancels, and goes no further, so a grid's settings dialog behind
 * this one stays open.
 *
 * INPUTS (plain values, HR-28)
 *   levels        the sort as it is: [{ field, direction }], the first first
 *   options       the columns a Then by row can use: [{ value, label }]
 *   firstOptions  the fields Sort by can use, columns or not: [{ value, label }]
 *   gridLabel the grid's title, for the line under the heading
 * EVENTS OUT
 *   save { levels }, cancel
 */
import { LightningElement, api } from 'lwc';
import { MAX_SORT_LEVELS, SORT_DIRECTIONS } from 'c/gridAdminDraft';

export default class GridSortDialog extends LightningElement {
    @api options = [];
    @api firstOptions = [];
    @api gridLabel = '';

    rows = [];

    // Non-reactive (HR-20): what takes focus after the next render, and the next row's key.
    _layout = { focus: '.rh-sort-field', nextKey: 0 };

    @api
    get levels() {
        return this.rows.filter(r => r.field).map(r => ({ field: r.field, direction: r.direction }));
    }
    set levels(value) {
        const list = (Array.isArray(value) ? value : []).filter(l => l && l.field).slice(0, MAX_SORT_LEVELS);
        // Nothing to start from: one empty Sort by row to fill in.
        this.rows = (list.length ? list : [{ field: null, direction: 'asc' }]).map(l => this.newRow(l));
    }

    newRow(level) {
        this._layout.nextKey += 1;
        return {
            key: `sort-${this._layout.nextKey}`,
            field: level.field || null,
            direction: level.direction === 'desc' ? 'desc' : 'asc'
        };
    }

    /** Focus where the last action leaves it (HR-13's way: after the render). */
    renderedCallback() {
        const selector = this._layout.focus;
        if (!selector) return;
        const target = this.template.querySelector(selector);
        if (target) {
            this._layout.focus = null;
            target.focus();
        }
    }

    get intro() {
        const grid = this.gridLabel ? this.gridLabel : 'The grid';
        return `The order ${grid} opens in: first by any field, then by its columns that can be sorted. A user who sorts the grid keeps their own order; Reset layout brings this one back.`;
    }

    get directionOptions() {
        return SORT_DIRECTIONS;
    }

    get thenOptions() {
        return Array.isArray(this.options) ? this.options : [];
    }

    get sortByOptions() {
        const first = Array.isArray(this.firstOptions) ? this.firstOptions : [];
        return first.length ? first : this.thenOptions;
    }

    /** Sort by is on a field no Then by row could take: it stays first. */
    get firstIsField() {
        const first = this.rows[0];
        return Boolean(first && first.field) && !this.thenOptions.some(o => o.value === first.field);
    }

    get rowModels() {
        const last = this.rows.length - 1;
        const pinned = this.firstIsField;
        return this.rows.map((r, i) => {
            const all = i === 0 ? this.sortByOptions : this.thenOptions;
            const label = i === 0 ? 'Sort by' : 'Then by';
            const name = i === 0 ? 'Sort by' : `Then by ${i}`;
            const taken = new Set(this.rows.filter((o, j) => j !== i && o.field).map(o => o.field));
            return {
                key: r.key,
                index: i,
                label,
                fieldLabel: name,
                directionLabel: `Direction of ${name}`,
                field: r.field,
                direction: r.direction,
                fieldOptions: all.filter(o => !taken.has(o.value)).map(o => ({ ...o })),
                upDisabled: i === 0 || (i === 1 && pinned),
                downDisabled: i === last || (i === 0 && pinned),
                upLabel: `Move ${name} up`,
                downLabel: `Move ${name} down`,
                removeLabel: `Remove ${name}`
            };
        });
    }

    /** Up to five rows, while a column is left for a new row (a field, for a first one). */
    get addDisabled() {
        if (this.rows.length >= MAX_SORT_LEVELS) return true;
        const taken = new Set(this.rows.map(r => r.field).filter(Boolean));
        const pool = this.rows.length ? this.thenOptions : this.sortByOptions;
        return !pool.some(o => !taken.has(o.value));
    }

    get addHint() {
        return `Up to ${MAX_SORT_LEVELS}.`;
    }

    get hasRows() {
        return this.rows.length > 0;
    }

    /** A row without its column chosen yet: fill it in or remove it first. */
    get saveDisabled() {
        return this.rows.some(r => !r.field);
    }

    indexOf(event) {
        return Number(event.target.dataset.index);
    }

    handleField(event) {
        const i = this.indexOf(event);
        this.rows = this.rows.map((r, j) => (j === i ? { ...r, field: event.detail.value || null } : r));
    }

    handleDirection(event) {
        const i = this.indexOf(event);
        this.rows = this.rows.map((r, j) => (j === i ? { ...r, direction: event.detail.value } : r));
    }

    handleMove(event) {
        const i = this.indexOf(event);
        const to = i + Number(event.target.dataset.delta);
        if (to < 0 || to >= this.rows.length) return;
        const rows = this.rows.slice();
        const [moved] = rows.splice(i, 1);
        rows.splice(to, 0, moved);
        this.rows = rows;
        // The same button, on the row in its new place; at the top or bottom, its column.
        const edge = (to === 0 && to < i) || (to === rows.length - 1 && to > i);
        this._layout.focus = edge
            ? `.rh-sort-field[data-index="${to}"]`
            : `.rh-sort-${to < i ? 'up' : 'down'}[data-index="${to}"]`;
    }

    handleRemove(event) {
        const i = this.indexOf(event);
        this.rows = this.rows.filter((r, j) => j !== i);
        // Focus would go with the row: Add sort takes it.
        this._layout.focus = '.rh-sort-add';
    }

    handleAdd() {
        if (this.addDisabled) return;
        this.rows = [...this.rows, this.newRow({ field: null, direction: 'asc' })];
        this._layout.focus = `.rh-sort-field[data-index="${this.rows.length - 1}"]`;
    }

    handleSave() {
        if (this.saveDisabled) return;
        this.dispatchEvent(new CustomEvent('save', { detail: { levels: this.levels } }));
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }

    handleKeyDown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.handleCancel();
        }
    }

    /** Shift+Tab from the first control: round to the last enabled button. */
    handleGuardStart() {
        const last = this.saveDisabled
            ? this.template.querySelector('.rh-sort-cancel')
            : this.template.querySelector('.rh-sort-save');
        if (last) last.focus();
    }

    /** Tab from the last control: round to the close button, the first. */
    handleGuardEnd() {
        const close = this.template.querySelector('.rh-sort-close');
        if (close) close.focus();
    }
}
