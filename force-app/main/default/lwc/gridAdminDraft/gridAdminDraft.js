/**
 * gridAdminDraft — the plain logic of the grid settings editor, kept
 * out of the component so it can be tested on its own.
 *
 * A DRAFT is a grid configuration and its records as GridAdmin.Draft shapes
 * them: { config, columns, rules, actions, children, filters }. The list
 * order is the grid's order (columns), the order rules apply in, the menu's
 * order (actions), the tabs' order (child tables) and the filters' order;
 * the server numbers Sort Order from it.
 *
 * A formula column has a `formula` and no field. A rule with a
 * `formula` that is not null (even '', while it is being typed) is a formula
 * rule: its operator and value are not used.
 * In the browser each list item also carries `_key`, a stable key for the
 * template (HR-19), which toServer() takes off again.
 *
 * The picklist values below are the Custom Metadata fields' own, letter for
 * letter: a deploy with any other value fails.
 *
 * A saved configuration needs no help to reach the grids on the page: they
 * open with GridController.openGrid, which is never answered from the
 * browser's cache.
 */

/** A Custom Metadata record's API name and label: at most 40 characters. */
export const MAX_NAME = 40;

export const SORT_DIRECTIONS = Object.freeze([
    { value: 'asc', label: 'Ascending' },
    { value: 'desc', label: 'Descending' }
]);

/** The sorts a grid can open with: the first and up to four after it (GridConfig.MAX_SORT_LEVELS). */
export const MAX_SORT_LEVELS = 5;

export const SUBTOTALS = Object.freeze([
    { value: 'sum', label: 'Sum' },
    { value: 'average', label: 'Average' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'count', label: 'Count' }
]);

/** What a child total column works out. */
export const CHILD_TOTALS = Object.freeze([
    { value: 'count', label: 'Count' },
    { value: 'sum', label: 'Sum' },
    { value: 'average', label: 'Average' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' }
]);

export const DATE_UNITS = Object.freeze([
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'quarter', label: 'Quarter' },
    { value: 'year', label: 'Year' },
    { value: 'fiscal_quarter', label: 'Fiscal quarter' },
    { value: 'fiscal_year', label: 'Fiscal year' }
]);

/** Types users are offered grouping by without Allow Grouping (GridConfig.GROUP_OFFERED_TYPES). */
export const GROUP_OFFERED_TYPES = Object.freeze(['picklist', 'checkbox', 'reference', 'owner', 'date', 'datetime']);

export const GROUP_LEVELS = Object.freeze([
    { value: '', label: 'None' },
    { value: '1', label: '1 (outermost)' },
    { value: '2', label: '2' },
    { value: '3', label: '3' }
]);

export const OPERATORS = Object.freeze([
    { value: 'equals', label: 'Equals' },
    { value: 'not_equals', label: 'Does not equal' },
    { value: 'greater_than', label: 'Greater than' },
    { value: 'greater_or_equal', label: 'Greater than or equal to' },
    { value: 'less_than', label: 'Less than' },
    { value: 'less_or_equal', label: 'Less than or equal to' },
    { value: 'between', label: 'Between' },
    { value: 'contains', label: 'Contains' },
    { value: 'not_contains', label: 'Does not contain' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'is_blank', label: 'Is blank' },
    { value: 'is_not_blank', label: 'Is not blank' }
]);

export const STYLES = Object.freeze([
    { value: 'fill_green', label: 'Green fill' },
    { value: 'fill_amber', label: 'Amber fill' },
    { value: 'fill_red', label: 'Red fill' },
    { value: 'fill_purple', label: 'Purple fill' },
    { value: 'fill_gray', label: 'Gray fill' },
    { value: 'text_red', label: 'Red text' },
    { value: 'text_green', label: 'Green text' },
    { value: 'text_gray', label: 'Gray text' },
    { value: 'bold', label: 'Bold' },
    { value: 'icon_warning', label: 'Warning icon' },
    { value: 'icon_error', label: 'Error icon' },
    { value: 'icon_success', label: 'Success icon' },
    { value: 'icon_info', label: 'Info icon' },
    { value: 'icon_up', label: 'Up arrow' },
    { value: 'icon_down', label: 'Down arrow' },
    { value: 'data_bar', label: 'Data bar' }
]);

/** What a formula column returns: Grid Column's Formula Type values. */
export const FORMULA_TYPES = Object.freeze([
    { value: 'text', label: 'Text' },
    { value: 'number', label: 'Number' },
    { value: 'currency', label: 'Currency' },
    { value: 'percent', label: 'Percent' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date/Time' },
    { value: 'checkbox', label: 'Checkbox' }
]);

/** The operator choice that makes a rule a formula rule; never saved as an Operator. */
export const FORMULA_OPERATOR = '__formula';

/** Formulas one grid may have, columns and rules together (GridFormulas.MAX_FORMULAS). */
export const MAX_FORMULAS = 10;

export const APPLY_TO = Object.freeze([
    { value: 'cell', label: 'The cell' },
    { value: 'row', label: 'The whole row' }
]);

/** What an action runs. Apex runs from an autolaunched flow (GridActions.NO_APEX). */
export const ACTION_TYPES = Object.freeze([
    { value: 'screen_flow', label: 'Screen flow' },
    { value: 'autolaunched_flow', label: 'Autolaunched flow' },
    { value: 'quick_action', label: 'Quick action' }
]);

export const SHOW_IN = Object.freeze([
    { value: 'row_menu_and_selection', label: 'Row menu and selection' },
    { value: 'row_menu', label: 'Row menu' },
    { value: 'selection', label: 'Selection' }
]);

// What each operator applies to, as GridConfig.requireOperatorFits decides.
const TEXT_TYPES = new Set(['text', 'email', 'phone', 'url', 'textarea', 'id', 'picklist', 'multipicklist']);
const ORDERED_TYPES = new Set(['number', 'currency', 'percent', 'date', 'datetime', 'time']);
const ORDERED_OPERATORS = new Set(['greater_than', 'greater_or_equal', 'less_than', 'less_or_equal']);
const DATE_TYPES = new Set(['date', 'datetime']);
const NUMBER_TYPES = new Set(['number', 'currency', 'percent']);

/** The operators that mean something for a field of this type. */
export function operatorsFor(type) {
    return OPERATORS.filter(o => {
        const op = o.value;
        if (op === 'is_blank' || op === 'is_not_blank') return type !== 'checkbox';
        if (op === 'equals' || op === 'not_equals') return true;
        if (op === 'starts_with') return TEXT_TYPES.has(type) && type !== 'multipicklist';
        if (op === 'contains' || op === 'not_contains') return TEXT_TYPES.has(type);
        if (ORDERED_OPERATORS.has(op) || op === 'between') return ORDERED_TYPES.has(type);
        return false;
    });
}

/** Operators a two-field rule may use: equals and the comparisons. */
export const COMPARE_OPERATORS = new Set([
    'equals',
    'not_equals',
    'greater_than',
    'greater_or_equal',
    'less_than',
    'less_or_equal'
]);

/** Which fields compare with which, as GridConfig.kindOf says. */
export function compareKind(type) {
    if (NUMBER_TYPES.has(type)) return 'number';
    if (DATE_TYPES.has(type)) return 'date';
    if (type === 'reference' || type === 'owner') return 'reference';
    if (type === 'time' || type === 'checkbox' || type === 'multipicklist') return type;
    return 'text';
}

/** Is a rule a formula rule? */
export function isFormulaRule(rule) {
    return Boolean(rule) && rule.formula !== null && rule.formula !== undefined;
}

/** Is a column a child total column? One added as one, or one with a child table. */
export function isChildTotalColumn(column) {
    return (
        Boolean(column) &&
        ((column.childTotal !== null && column.childTotal !== undefined) || Boolean(column.childTable))
    );
}

/** Is a column a formula column? */
export function isFormulaColumn(column) {
    return Boolean(column) && column.formula !== null && column.formula !== undefined;
}

// ---------------------------------------------------------------- the default sort

/** The sort a grid opens with, every level of it: [{ field, direction }], the first first. */
export function sortLevelsOf(config) {
    const c = config || {};
    if (!c.sortField) return [];
    const then = (Array.isArray(c.thenSort) ? c.thenSort : [])
        .filter(l => l && l.field)
        .map(l => ({ field: l.field, direction: l.direction === 'desc' ? 'desc' : 'asc' }));
    return [{ field: c.sortField, direction: c.sortDirection === 'desc' ? 'desc' : 'asc' }, ...then];
}

/** The configuration with this sort: the first in Sort by and Sort direction, the rest in thenSort. */
export function withSortLevels(config, levels) {
    const list = (levels || []).filter(l => l && l.field).slice(0, MAX_SORT_LEVELS);
    const first = list[0];
    return {
        ...config,
        sortField: first ? first.field : null,
        sortDirection: first && first.direction === 'desc' ? 'desc' : 'asc',
        thenSort: list.slice(1).map(l => ({ field: l.field, direction: l.direction === 'desc' ? 'desc' : 'asc' }))
    };
}

/** A column on a field, switched on, that users can sort by: one the default sort can use. */
export function isSortColumn(column) {
    return (
        Boolean(column && column.field) &&
        !isFormulaColumn(column) &&
        !isChildTotalColumn(column) &&
        column.inactive !== true &&
        column.sortable !== false
    );
}

/**
 * The sort, after a change to the columns: a sort after the first whose column
 * was switched off, can no longer be sorted, or now shows another field leaves
 * the sort, and the ones after it move up. The first sort stays: it may be any
 * field the grid can sort by, a column or not. Returns { config, dropped: [field, …] }.
 */
export function pruneSort(config, columns) {
    const usable = new Set((columns || []).filter(isSortColumn).map(c => String(c.field).toLowerCase()));
    const levels = sortLevelsOf(config);
    const dropped = [];
    const kept = levels.filter((l, i) => {
        const ok = i === 0 || usable.has(String(l.field).toLowerCase());
        if (!ok) dropped.push(l.field);
        return ok;
    });
    if (!dropped.length) return { config, dropped };
    return { config: withSortLevels(config, kept), dropped };
}

/** Does the rule compare against a value? The blank tests do not. */
export function needsValue(operator) {
    return operator !== 'is_blank' && operator !== 'is_not_blank';
}

/** How to write a value for a field of this type, as the server reads it. */
export function valueHint(type) {
    if (DATE_TYPES.has(type)) return '2026-12-31, TODAY, TODAY+7 or TODAY-30';
    if (NUMBER_TYPES.has(type)) return 'A number, such as 1000';
    if (type === 'time') return '17:30';
    if (type === 'checkbox') return 'true or false';
    if (type === 'reference' || type === 'owner') return '$User, or a record Id';
    if (type === 'picklist' || type === 'multipicklist') return 'A value, by its label or API name';
    return 'Text';
}

export function isDateType(type) {
    return DATE_TYPES.has(type);
}

/**
 * An API name from a title: letters, numbers and single underscores, starting
 * with a letter, at most MAX_NAME characters, as GridAdmin.clean makes them.
 */
export function apiNameFrom(label) {
    let out = String(label || '')
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    if (!out) return '';
    if (!/^[A-Za-z]/.test(out)) out = 'X' + out;
    return out.slice(0, MAX_NAME).replace(/_+$/, '');
}

/** Why an API name will not do, or '' — the server's nameProblem, said the same way. */
export function nameProblem(name) {
    const n = String(name || '').trim();
    if (!n) return 'Give the grid an API name.';
    if (n.length > MAX_NAME) return `The API name is ${n.length} characters; ${MAX_NAME} at most.`;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(n) || n.includes('__') || n.endsWith('_')) {
        return 'The API name must start with a letter and use only letters, numbers and single underscores, not ending with one.';
    }
    return '';
}

// ================================================================ the draft

let counter = 0;
const nextKey = prefix => `${prefix}${++counter}`;

export function newColumn(field) {
    return {
        _key: nextKey('col'),
        name: null,
        field: field || null,
        columnLabel: null,
        editable: false,
        sortable: true,
        wrap: false,
        alwaysShown: false,
        width: null,
        cellType: null,
        groupLevel: null,
        groupUnit: null,
        allowGrouping: false,
        subtotal: null,
        inactive: false,
        formula: null,
        formulaType: null,
        decimalPlaces: null,
        childTable: null,
        childTotal: null,
        childField: null
    };
}

/** A child total column: a child table of the grid, a kind of total and, but for a count, a field. */
export function newChildTotalColumn(childTable) {
    return {
        ...newColumn(null),
        _key: nextKey('col'),
        sortable: false,
        childTable: childTable || null,
        childTotal: 'count'
    };
}

/** A formula column: a header, a formula and what it returns; no field. */
export function newFormulaColumn() {
    return { ...newColumn(null), _key: nextKey('col'), sortable: false, formula: '', formulaType: 'number' };
}

export function newRule() {
    return {
        _key: nextKey('rule'),
        name: null,
        label: '',
        field: null,
        operator: 'equals',
        value: '',
        valueTo: '',
        compareField: null,
        formula: null,
        style: 'fill_green',
        applyTo: 'cell',
        inactive: false
    };
}

/** An admin's filter: every active one holds. */
export function newFilter() {
    return {
        _key: nextKey('flt'),
        name: null,
        label: '',
        field: null,
        operator: 'equals',
        value: '',
        valueTo: '',
        inactive: false
    };
}

export function newAction() {
    return {
        _key: nextKey('act'),
        name: null,
        label: '',
        type: 'screen_flow',
        actionName: '',
        inputName: '',
        showIn: 'row_menu_and_selection',
        confirmation: '',
        requiredPermission: '',
        inactive: false
    };
}

export function newChild() {
    return {
        _key: nextKey('child'),
        name: null,
        childConfig: null,
        relationshipField: null,
        tabLabel: '',
        height: null,
        inactive: false
    };
}

/** A new grid: its name column comes once the object is chosen. */
export function emptyDraft() {
    return {
        config: {
            name: '',
            label: '',
            isNew: true,
            objectApiName: null,
            pageSize: null,
            sortField: null,
            sortDirection: 'asc',
            thenSort: [],
            allowInlineEdit: true,
            allowNewRecords: true,
            allowCsvExport: true,
            requireExportReports: false,
            allowMassDelete: false,
            allowImport: false,
            logChanges: false,
            frozenColumns: null,
            height: null,
            showRowNumbers: true,
            recordPageField: null
        },
        columns: [],
        rules: [],
        actions: [],
        children: [],
        filters: []
    };
}

const LISTS = ['columns', 'rules', 'actions', 'children', 'filters'];
const PREFIX = { columns: 'col', rules: 'rule', actions: 'act', children: 'child', filters: 'flt' };

/** The server's draft, with a template key on each list item. */
export function withKeys(draft) {
    const d = draft || emptyDraft();
    const out = { config: { ...emptyDraft().config, ...(d.config || {}) } };
    LISTS.forEach(list => {
        out[list] = (d[list] || []).map(item => ({ ...item, _key: nextKey(PREFIX[list]) }));
    });
    return out;
}

/** The draft as the server takes it: no template keys, blank text as null. */
export function toServer(draft) {
    const tidy = value => (typeof value === 'string' ? (value.trim() ? value.trim() : null) : value);
    const strip = item => {
        const out = {};
        Object.keys(item).forEach(k => {
            if (k !== '_key') out[k] = tidy(item[k]);
        });
        return out;
    };
    const out = { config: strip(draft.config) };
    LISTS.forEach(list => {
        out[list] = (draft[list] || []).map(strip);
    });
    return out;
}

/** The same draft, as far as the server would see it? */
export function sameDraft(a, b) {
    if (!a || !b) return a === b;
    return JSON.stringify(toServer(a)) === JSON.stringify(toServer(b));
}

/** The list with one item moved by delta places; the same list when it cannot move. */
export function moveItem(list, index, delta) {
    const to = index + delta;
    if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
    const out = list.slice();
    const [item] = out.splice(index, 1);
    out.splice(to, 0, item);
    return out;
}

/** The object's fields by API name, from GridAdmin.describeObject. */
export function fieldMap(described) {
    const map = new Map();
    ((described && described.fields) || []).forEach(f => map.set(f.name.toLowerCase(), f));
    return map;
}

// ---------------------------------------------------------------- parent records

/** The most lookups a column may reach through (GridPaths.MAX_HOPS on the server). */
export const MAX_HOPS = 5;

/** Does the name reach through a lookup, as Account.Industry does? */
export function isPathName(name) {
    return typeof name === 'string' && name.includes('.');
}

/**
 * Follow a path such as "Shipper__r.Owner.Email" from the grid's
 * object. `related` holds the describes of the objects on the way
 * (GridAdmin.describeObject), by lower-case API name. Returns the steps, one
 * per object reached ({ fields, objectName, objectLabel, part, last }), the
 * field at the end when there is one, the headings on the way, and `missing`:
 * the object whose describe is needed next and not loaded yet.
 */
export function walkPath(path, described, related) {
    const parts = String(path || '').split('.');
    const out = { steps: [], field: null, headings: [], missing: null };
    let current = described;
    for (let i = 0; i < parts.length && current; i++) {
        const fields = current.fields || [];
        const last = i === parts.length - 1;
        const part = parts[i];
        out.steps.push({ fields, objectName: current.name, objectLabel: current.label, part, last });
        if (last) {
            const f = fields.find(x => x.name.toLowerCase() === part.toLowerCase());
            if (f) {
                out.field = f;
                out.headings.push(f.heading || f.label);
            }
            break;
        }
        const lookup = fields.find(
            x => x.reachable && x.relationship && x.relationship.toLowerCase() === part.toLowerCase()
        );
        if (!lookup) break;
        out.headings.push(lookup.heading || lookup.label);
        const target = lookup.referenceTo[0];
        current = (related || {})[target.toLowerCase()] || null;
        if (!current) out.missing = target;
    }
    return out;
}

/**
 * The field a path ends at, as a column of it is shown: headed as a report
 * heads a related record's field ("Related Account: Industry"), never the
 * row's name. Null when the path does not reach a field.
 */
export function pathField(path, described, related) {
    const walk = walkPath(path, described, related);
    if (!walk.field || walk.steps.length < 2) return null;
    const heading = walk.headings.join(': ');
    return { ...walk.field, name: path, label: heading, heading, isName: false };
}

/**
 * The choices for a column's field, one list per object on the way: each
 * object's fields, then its lookups to one kind of record, which open that
 * record's fields ("Related Account >"), while fewer than MAX_HOPS are
 * followed. A lookup's value ends in a dot. A value the object no longer
 * has still shows, as the field lists do.
 */
export function pathSteps(path, described, related) {
    return walkPath(path, described, related).steps.map((s, i) => {
        const options = s.fields.map(f => ({ value: f.name, label: `${f.label} (${f.name})` }));
        if (i < MAX_HOPS) {
            s.fields
                .filter(f => f.reachable && f.relationship)
                .forEach(f => options.push({ value: `${f.relationship}.`, label: `${f.heading || f.label} >` }));
        }
        let value = s.last ? s.part : `${s.part}.`;
        const known = options.find(o => o.value.toLowerCase() === value.toLowerCase());
        if (known) value = known.value;
        else if (s.part) options.unshift({ value, label: `${s.part} (not on this object)` });
        return { index: i, options, value, objectName: s.objectName, objectLabel: s.objectLabel };
    });
}

/**
 * A column changed field: settings the new field cannot take are cleared, as
 * the grid would otherwise skip them with a warning.
 */
export function fitColumnToField(column, field) {
    const out = { ...column };
    if (!field) return out;
    if (!field.editable) out.editable = false;
    if (!field.sortable) out.sortable = false;
    if (!field.groupable) {
        out.groupLevel = null;
        out.groupUnit = null;
    } else if (!isDateType(field.type)) {
        out.groupUnit = null;
    }
    // Allow Grouping only means something for a groupable type not offered anyway.
    if (!field.groupable || GROUP_OFFERED_TYPES.includes(field.type)) out.allowGrouping = false;
    if (out.subtotal && !(field.subtotals || []).includes(out.subtotal)) out.subtotal = null;
    return out;
}

/**
 * A rule or a filter changed field: an operator that means nothing for it
 * becomes the first one that does, and a compare field of another kind, or
 * the new field itself, is cleared.
 */
export function fitRuleToField(rule, field, compareType) {
    const out = { ...rule };
    if (!field) return out;
    const allowed = operatorsFor(field.type).map(o => o.value);
    if (!allowed.includes(out.operator)) out.operator = allowed[0] || 'equals';
    if (out.compareField && compareType !== undefined && compareKind(compareType) !== compareKind(field.type))
        out.compareField = null;
    // A field is not compared with itself: the server skips such a rule.
    if (out.compareField && field.name && String(out.compareField).toLowerCase() === String(field.name).toLowerCase())
        out.compareField = null;
    return out;
}
