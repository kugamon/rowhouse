/**
 * gridConfigEditor — a grid's settings, edited in one place: the
 * Grid Admin tab shows it for any grid, and the gear on a grid shows it
 * for that one.
 *
 * WHAT IT EDITS
 * One Grid Configuration and its records, in six tabs: the grid itself, its
 * columns, its display rules, its filters, its actions and its child
 * tables; and a seventh, Views, lists the views people saved of the grid
 * (c/gridAdminViews), any of which an admin may delete. The Grid tab also takes the Record Page Field;
 * a column can be a formula column (a header, a formula and what it
 * returns); a rule can be Between, compare two fields, or be a formula, and
 * can show an icon or a data bar. Lists are in
 * the order the grid uses; arrows move an entry. Saved entries cannot be
 * deleted (Apex cannot delete Custom Metadata), so each has an On switch
 * instead; an entry added and not saved yet can be removed.
 *
 * CHECKING
 * After every change, a moment later, the draft goes to GridAdminController.
 * checkDraft, which reads it with the grid's own code: errors (that would stop
 * the grid or the save) block Save; warnings say what the grid would skip.
 *
 * SAVING
 * Saving deploys the records (GridAdmin.save), which needs Customize
 * Application as well as Rowhouse Grid Admin; without it the editor says so and
 * Save stays off. The deploy runs in the background: the editor asks
 * saveStatus until it has succeeded or failed, then reads the grid again, so
 * new entries get the API names the server gave them.
 *
 * LAYOUT
 * On the Grid Admin tab the editor is a page of its own (layout "page"): a
 * heading with the way back, the grid's name, its object and API name, and
 * Close and Save at the top; the tabs below, with the Grid Guide's part about
 * the open tab in a panel beside them (c/gridAdminHelp). Hide help folds the
 * panel away, and this browser remembers it. From the gear on a grid it is the
 * compact layout (the default): the tabs, then the problems and the buttons.
 *
 * INPUTS (plain values, HR-28)
 *   configName  the configuration to edit; blank for a new grid
 *   layout      "page" on the Grid Admin tab; anything else, the compact layout
 * METHODS
 *   requestClose()  close, asking first if there are unsaved changes
 * EVENTS OUT
 *   saved  { configName }, once a save has gone through
 *   close  the editor is done (Cancel, or Close after a save)
 */
import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import readConfig from '@salesforce/apex/GridAdminController.readConfig';
import listObjects from '@salesforce/apex/GridAdminController.listObjects';
import describeObject from '@salesforce/apex/GridAdminController.describeObject';
import checkDraft from '@salesforce/apex/GridAdminController.checkDraft';
import saveDraft from '@salesforce/apex/GridAdminController.saveDraft';
import saveStatus from '@salesforce/apex/GridAdminController.saveStatus';
import canSaveConfig from '@salesforce/apex/GridAdminController.canSave';
import gridViews from '@salesforce/apex/GridAdminController.gridViews';
import deleteGridView from '@salesforce/apex/GridAdminController.deleteGridView';
import { openGuide } from 'c/guideRoute';
import { namespaceOf } from 'c/gridFlowRoute';
import {
    ACTION_TYPES,
    APPLY_TO,
    CHILD_TOTALS,
    COMPARE_OPERATORS,
    DATE_UNITS,
    FORMULA_OPERATOR,
    FORMULA_TYPES,
    MAX_FORMULAS,
    GROUP_LEVELS,
    GROUP_OFFERED_TYPES,
    MAX_NAME,
    SHOW_IN,
    STYLES,
    SUBTOTALS,
    apiNameFrom,
    compareKind,
    emptyDraft,
    fieldMap,
    fitColumnToField,
    fitRuleToField,
    isDateType,
    isChildTotalColumn,
    isFormulaColumn,
    isFormulaRule,
    isPathName,
    moveItem,
    needsValue,
    newAction,
    newChild,
    newChildTotalColumn,
    newColumn,
    newFilter,
    newFormulaColumn,
    newRule,
    operatorsFor,
    pathField,
    pathSteps,
    pruneSort,
    isSortColumn,
    sameDraft,
    sortLevelsOf,
    withSortLevels,
    toServer,
    valueHint,
    walkPath,
    withKeys
} from 'c/gridAdminDraft';

/** ms after the last change before the draft is checked. */
export const CHECK_DELAY_MS = 600;
/** Between save-status checks: a deploy takes a few seconds. */
export const POLL_DELAYS_MS = [1000, 1500, 2000, 3000];
/** After this, the editor stops waiting and says the save may still finish. */
export const SAVE_TIMEOUT_MS = 90000;

const NONE = { value: '', label: 'None' };
const NUMBER_RESULTS = new Set(['number', 'currency', 'percent']);

const delay = ms =>
    new Promise(resolve => {
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- back-off between save-status checks
        setTimeout(resolve, ms);
    });

/** An Apex error's message, whatever shape it arrived in. */
function messageOf(error) {
    if (!error) return 'Unknown error.';
    const body = error.body;
    if (body && typeof body.message === 'string' && body.message) return body.message;
    if (Array.isArray(body))
        return body
            .map(e => e && e.message)
            .filter(Boolean)
            .join(' ');
    return error.message || String(error);
}

/** Where this browser remembers that the Grid Guide's panel was hidden. */
export const HELP_HIDDEN_KEY = 'rowhouse.gridAdmin.helpHidden';

function helpStore() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

function readHelpHidden() {
    try {
        const store = helpStore();
        return Boolean(store && store.getItem(HELP_HIDDEN_KEY) === '1');
    } catch {
        return false;
    }
}

function writeHelpHidden(hidden) {
    try {
        const store = helpStore();
        if (!store) return;
        if (hidden) store.setItem(HELP_HIDDEN_KEY, '1');
        else store.removeItem(HELP_HIDDEN_KEY);
    } catch {
        // A browser that keeps nothing shows the panel again next time.
    }
}

const toInteger = value => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = parseInt(value, 10);
    return Number.isNaN(n) ? null : n;
};

export default class GridConfigEditor extends NavigationMixin(LightningElement) {
    _configName = '';

    // ---- reactive state ----
    loading = false;
    loadError = null;
    draft = null;
    /** The object's fields and possible child tables (GridAdmin.describeObject). */
    described = null;
    /** Child objects' fields, for child total columns: { [object]: fields }. */
    childFields = {};
    /** Parent objects' describes, for columns of a parent record's field: { [lower-case object]: describe }. */
    related = {};
    objects = [];
    canSave = false;
    check = { errors: [], warnings: [] };
    checking = false;
    saving = false;
    status = '';
    saveErrors = [];
    confirmingClose = false;
    activeTab = 'grid';
    /** The views people saved of this grid (GridAdminController.gridViews), or null while they load. */
    savedViews = null;
    savedViewsError = '';
    savedViewsBusy = false;
    /** The Grid Guide's panel folded away (the page layout). */
    helpHidden = false;
    /** The Sort dialog is open (Columns tab, Edit sort). */
    sortDialogOpen = false;
    /** Which sorts a change to the columns took out of the default sort, said under it. */
    sortNotice = '';
    _layout = 'panel';

    // ---- non-reactive containers (HR-20) ----
    _runtime = { token: 0, checkToken: 0, checkTimer: null, connected: false };
    /** Where focus goes after the next render: Edit sort, once the Sort dialog closes. */
    _measurements = { focus: null };
    /** The draft as last saved or read, and whether the API name was typed by hand. */
    _memo = { saved: null, nameEdited: false, fieldsFor: null, fields: new Map() };

    @api
    get configName() {
        return this._configName;
    }
    set configName(value) {
        const next = typeof value === 'string' ? value.trim() : '';
        if (next === this._configName) return;
        this._configName = next;
        if (this._runtime.connected) this.load();
    }

    /** "page" on the Grid Admin tab; anything else is the compact layout. */
    @api
    get layout() {
        return this._layout;
    }
    set layout(value) {
        this._layout = value === 'page' ? 'page' : 'panel';
    }

    /** Close, asking first when there are unsaved changes. */
    @api
    requestClose() {
        if (this.saving) return;
        if (this.dirty) {
            this.confirmingClose = true;
            return;
        }
        this.dispatchEvent(new CustomEvent('close'));
    }

    connectedCallback() {
        this._runtime.connected = true;
        this.helpHidden = readHelpHidden();
        this.load();
    }

    disconnectedCallback() {
        this._runtime.connected = false;
        this._runtime.token++;
        this._runtime.checkToken++;
        clearTimeout(this._runtime.checkTimer);
    }

    // ============================================================ loading

    async load() {
        const token = ++this._runtime.token;
        this._runtime.checkToken++;
        clearTimeout(this._runtime.checkTimer);
        this.loading = true;
        this.loadError = null;
        this.draft = null;
        this.described = null;
        this.check = { errors: [], warnings: [] };
        this.saveErrors = [];
        this.confirmingClose = false;
        this._memo.nameEdited = false;
        try {
            const name = this._configName;
            if (name) {
                const result = await readConfig({ configName: name });
                if (token !== this._runtime.token) return;
                const draft = withKeys(result.draft);
                const described = await describeObject({ objectApiName: draft.config.objectApiName });
                if (token !== this._runtime.token) return;
                this.described = described;
                this.draft = draft;
                this.canSave = result.canSave === true;
                this.check = { errors: [], warnings: result.warnings || [] };
                this._memo.saved = draft;
                this.loadChildFields();
                this.loadPathObjects();
                this.loadSavedViews();
            } else {
                const [objects, canSave] = await Promise.all([listObjects(), canSaveConfig()]);
                if (token !== this._runtime.token) return;
                this.objects = objects || [];
                this.canSave = canSave === true;
                this.draft = withKeys(emptyDraft());
                this._memo.saved = this.draft;
            }
            this.activeTab = 'grid';
        } catch (e) {
            if (token === this._runtime.token) this.loadError = messageOf(e);
        } finally {
            if (token === this._runtime.token) this.loading = false;
        }
    }

    // ============================================================ saved views

    /** The views people saved of this grid, for the Views tab and its count. */
    async loadSavedViews() {
        const name = this._configName;
        this.savedViews = null;
        this.savedViewsError = '';
        try {
            const views = await gridViews({ configName: name });
            if (name === this._configName) this.savedViews = Array.isArray(views) ? views : [];
        } catch (e) {
            if (name === this._configName) this.savedViewsError = 'The views could not be read. ' + messageOf(e);
        }
    }

    /** A grid that exists has views; a new one has none yet. */
    get hasViewsTab() {
        return Boolean(this._configName);
    }

    get viewsTabLabel() {
        return Array.isArray(this.savedViews) ? `Views (${this.savedViews.length})` : 'Views';
    }

    /** Delete, confirmed on the Views tab: the view goes, whoever owns it. */
    async handleViewRemove(event) {
        const { id, name } = event.detail || {};
        if (!id || this.savedViewsBusy) return;
        this.savedViewsBusy = true;
        try {
            await deleteGridView({ configName: this._configName, viewId: id });
            this.dispatchEvent(new ShowToastEvent({ title: `${name} deleted`, variant: 'success' }));
            await this.loadSavedViews();
        } catch (e) {
            this.savedViewsError = 'The view could not be deleted. ' + messageOf(e);
        } finally {
            this.savedViewsBusy = false;
        }
    }

    // ============================================================ what is shown

    get ready() {
        return Boolean(this.draft) && !this.loading && !this.loadError;
    }

    get config() {
        return this.draft ? this.draft.config : {};
    }

    /** Show row numbers: ticked unless the grid's record says otherwise, as a new grid starts. */
    get showRowNumbers() {
        return this.config.showRowNumbers !== false;
    }

    /** Create records with New: ticked unless the grid's record says otherwise, as a new grid starts. */
    get allowNewRecords() {
        return this.config.allowNewRecords !== false;
    }

    /** Export Reports matters only to a grid that offers Export; the choice is kept while Export is off. */
    get exportPermissionDisabled() {
        return this.config.allowCsvExport === false;
    }

    /** Import creates a record for each row without an Id: it needs Create records with New. */
    get importDisabled() {
        return !this.allowNewRecords;
    }

    get isNew() {
        return Boolean(this.draft && this.draft.config.isNew);
    }

    /** Unsaved changes: anything entered on a new grid, any difference on a saved one. */
    get dirty() {
        if (!this.draft) return false;
        return !sameDraft(this.draft, this._memo.saved);
    }

    get hasObject() {
        return Boolean(this.config.objectApiName) && Boolean(this.described);
    }

    get needsObject() {
        return !this.hasObject;
    }

    get readOnlyNotice() {
        return this.ready && !this.canSave;
    }

    get nameLocked() {
        return !this.isNew || this.saving;
    }

    get maxName() {
        return MAX_NAME;
    }

    get nameHelp() {
        return this.isNew
            ? 'What the Rowhouse Grid component on a page is given. Made from the title until you change it; it cannot change once saved.'
            : 'What the Rowhouse Grid component on a page is given. It cannot change.';
    }

    /** The object a saved grid shows, which cannot change. */
    get objectText() {
        const d = this.described;
        return d ? `${d.labelPlural} (${d.name})` : this.config.objectApiName || '';
    }

    get objectOptions() {
        return (this.objects || []).map(o => ({ value: o.name, label: `${o.label} (${o.name})` }));
    }

    /** The object's fields by lower-case API name, made once per describe. */
    get fields() {
        if (this._memo.fieldsFor !== this.described) {
            this._memo.fieldsFor = this.described;
            this._memo.fields = fieldMap(this.described);
        }
        return this._memo.fields;
    }

    /** A field of the object, or of a parent record through lookups ("Account.Industry"). */
    fieldOf(name) {
        if (!name) return null;
        if (isPathName(name)) return pathField(name, this.described, this.related);
        return this.fields.get(String(name).toLowerCase()) || null;
    }

    /** Every field, and a value the object no longer has, so it still shows. */
    fieldOptions(current, filter) {
        const options = [];
        this.fields.forEach(f => {
            if (!filter || filter(f)) options.push({ value: f.name, label: `${f.label} (${f.name})` });
        });
        const f = current ? this.fieldOf(current) : null;
        // A parent record's field, set in Setup or as a column, shows by its heading.
        if (f && isPathName(current)) options.unshift({ value: current, label: `${f.heading} (${current})` });
        else if (current && !f) options.unshift({ value: current, label: `${current} (not on this object)` });
        return options;
    }

    /**
     * The describes of the objects the columns reach through lookups, loaded
     * one level at a time until every column's path can be followed.
     */
    async loadPathObjects() {
        const token = this._runtime.token;
        for (let round = 0; round < 6; round++) {
            const missing = new Set();
            ((this.draft && this.draft.columns) || []).forEach(c => {
                if (!isPathName(c.field)) return;
                const walk = walkPath(c.field, this.described, this.related);
                if (walk.missing) missing.add(walk.missing);
            });
            if (!missing.size) return;
            try {
                // eslint-disable-next-line no-await-in-loop
                const found = await Promise.all([...missing].map(objectApiName => describeObject({ objectApiName })));
                if (token !== this._runtime.token) return;
                const next = { ...this.related };
                found.forEach(d => {
                    if (d && d.name) next[d.name.toLowerCase()] = d;
                });
                this.related = next;
            } catch (e) {
                if (token === this._runtime.token) this.saveErrors = [messageOf(e)];
                return;
            }
        }
    }

    // ============================================================ the default sort

    /** What a column is called here: its header, else its field's heading or label. */
    sortLabelOf(field) {
        const c = ((this.draft && this.draft.columns) || []).find(col => col.field === field);
        if (c && c.columnLabel) return c.columnLabel;
        const f = this.fieldOf(field);
        return f ? f.heading || f.label : field;
    }

    get sortLevels() {
        return sortLevelsOf(this.config);
    }

    /** "Stage (ascending), then Last Modified Date (descending)", or blank for no sort. */
    get sortText() {
        return this.sortLevels
            .map(l => `${this.sortLabelOf(l.field)} (${l.direction === 'desc' ? 'descending' : 'ascending'})`)
            .join(', then ');
    }

    get hasSort() {
        return this.sortLevels.length > 0;
    }

    /** The columns a Then by row can use: on, sortable, in the grid's order, once each. */
    get sortOptions() {
        const options = [];
        const seen = new Set();
        ((this.draft && this.draft.columns) || []).filter(isSortColumn).forEach(c => {
            const key = String(c.field).toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ value: c.field, label: this.sortLabelOf(c.field) });
        });
        return options;
    }

    /**
     * What Sort by can use: any field the grid can sort by, columns or not, as
     * the Grid tab's Sort by offered (Last Name on a grid that shows Full Name).
     */
    get sortFirstOptions() {
        return this.fieldOptions(this.config.sortField, f => f.sortable);
    }

    handleSortOpen() {
        this.sortDialogOpen = true;
    }

    handleSortSave(event) {
        const levels = (event.detail && event.detail.levels) || [];
        this.draft = { ...this.draft, config: withSortLevels(this.draft.config, levels) };
        this.sortNotice = '';
        this.closeSortDialog();
        this.scheduleCheck();
    }

    handleSortCancel() {
        this.closeSortDialog();
    }

    /** Focus goes back to Edit sort, the button that opened the dialog. */
    closeSortDialog() {
        this.sortDialogOpen = false;
        this._measurements.focus = '.rh-sort-edit';
    }

    renderedCallback() {
        const selector = this._measurements.focus;
        if (!selector) return;
        const target = this.template.querySelector(selector);
        if (target) {
            this._measurements.focus = null;
            target.focus();
        }
    }

    /**
     * The columns as they are now, and the default sort to match: a sort whose
     * column was switched off, can no longer be sorted or shows another field
     * leaves it, and the summary says so before the save.
     */
    withColumns(columns) {
        const { config, dropped } = pruneSort(this.draft.config, columns);
        if (dropped.length) {
            const names = dropped.map(f => this.sortLabelOf(f));
            this.sortNotice =
                names.length === 1
                    ? `${names[0]} was taken out of the default sort, as its column changed.`
                    : `${names.join(', ')} were taken out of the default sort, as their columns changed.`;
        }
        return { ...this.draft, config, columns };
    }

    /**
     * Lookups to one object, for the Record Page Field: on that
     * object's record pages the grid shows the records whose field points to
     * the page's record.
     */
    get recordPageOptions() {
        const options = this.fieldOptions(
            this.config.recordPageField,
            f => f.type === 'reference' && (f.referenceTo || []).length === 1
        ).map(o => {
            const f = this.fieldOf(o.value);
            return f ? { value: o.value, label: `${f.label} (${f.name}), on ${f.referenceTo[0]} pages` } : o;
        });
        return [{ value: '', label: 'None: every record, on any page' }, ...options];
    }

    /** The choice shown: None for a blank field, so the list never reads "Select an Option". */
    get recordPageValue() {
        return this.config.recordPageField || '';
    }

    get pageSizeValue() {
        return this.config.pageSize;
    }

    // ---- tabs

    countOn(list, isOn) {
        return this.draft ? this.draft[list].filter(isOn).length : 0;
    }

    get columnsTabLabel() {
        return `Columns (${this.countOn('columns', c => !c.inactive)})`;
    }

    get rulesTabLabel() {
        return `Display rules (${this.countOn('rules', r => !r.inactive)})`;
    }

    get actionsTabLabel() {
        return `Actions (${this.countOn('actions', a => !a.inactive)})`;
    }

    get childrenTabLabel() {
        return `Child tables (${this.countOn('children', c => !c.inactive)})`;
    }

    get filtersTabLabel() {
        return `Filters (${this.countOn('filters', f => !f.inactive)})`;
    }

    handleTab(event) {
        this.activeTab = event.target.value;
    }

    /**
     * The part of the Grid Guide's Configuration reference about this tab,
     * in a new browser tab, so the grid being built stays as it is.
     */
    handleHelp(event) {
        const section = event.currentTarget.dataset.section;
        openGuide(this, namespaceOf(this.template.host), 'configure', section).catch(() => {
            this.dispatchEvent(
                new ShowToastEvent({
                    title: 'The Grid Guide did not open',
                    message: 'Open it from the App Launcher: search for Grid Guide.',
                    variant: 'warning'
                })
            );
        });
    }

    // ---- columns

    get columnRows() {
        if (!this.draft) return [];
        const list = this.draft.columns;
        return list.map((c, i) => {
            // A formula column has no field: read only, not sorted, grouped or subtotalled.
            const formula = isFormulaColumn(c);
            // Nor has a child total column.
            const childTotal = !formula && isChildTotalColumn(c);
            const f = formula || childTotal ? null : this.fieldOf(c.field);
            const subtotals = f ? f.subtotals || [] : [];
            let name = formula
                ? c.columnLabel || `formula column ${i + 1}`
                : f
                  ? f.label
                  : c.field || `column ${i + 1}`;
            if (childTotal) name = c.columnLabel || `child total column ${i + 1}`;
            return {
                key: c._key,
                position: i + 1,
                isFormula: formula,
                isChildTotal: childTotal,
                isField: !formula && !childTotal,
                ...(childTotal ? this.childTotalModel(c, name) : {}),
                field: c.field,
                fieldOptions: this.fieldOptions(c.field),
                fieldLabel: `Field of column ${i + 1}`,
                // One list per object on the way to a parent record's field.
                fieldSteps: formula || childTotal ? [] : this.fieldStepsOf(c, i + 1),
                formula: c.formula || '',
                formulaLabel: `Formula of ${name}`,
                formulaType: c.formulaType || 'number',
                formulaTypeLabel: `What ${name} returns`,
                showDecimals: NUMBER_RESULTS.has(c.formulaType || 'number'),
                decimalPlaces: c.decimalPlaces,
                decimalsLabel: `Decimal places of ${name}`,
                columnLabel: c.columnLabel || '',
                headerLabel: `Header for ${name}`,
                // A lookup is headed by what it points to, not "Account ID".
                headerPlaceholder: formula
                    ? 'Required'
                    : childTotal
                      ? this.childTotalPlaceholder(c)
                      : f
                        ? f.heading || f.label
                        : '',
                headerRequired: formula,
                editable: !formula && c.editable === true,
                editableDisabled: !f || !f.editable,
                editableLabel: `${name} can be edited`,
                sortable: !formula && !childTotal && c.sortable !== false,
                sortableDisabled: !f || !f.sortable,
                sortableLabel: `${name} can be sorted`,
                ...this.sortBadgeOf(c),
                wrap: c.wrap === true,
                wrapLabel: `Wrap ${name}`,
                alwaysShown: c.alwaysShown === true,
                alwaysShownLabel: `${name} is always shown`,
                width: c.width,
                widthLabel: `Width of ${name} in pixels`,
                groupLevel: c.groupLevel ? String(c.groupLevel) : '',
                groupDisabled: !f || !f.groupable,
                groupLabel: `Group by ${name}`,
                showUnit: Boolean(f && isDateType(f.type) && c.groupLevel),
                groupUnit: c.groupUnit || 'month',
                unitLabel: `Group ${name} by`,
                // Users may group by a column whose type is not offered anyway, a text column say.
                showAllowGrouping: Boolean(f && f.groupable && !GROUP_OFFERED_TYPES.includes(f.type)),
                allowGrouping: c.allowGrouping === true,
                allowGroupingLabel: `Users can group by ${name}`,
                subtotal: c.subtotal || '',
                subtotalOptions: [NONE, ...SUBTOTALS.filter(s => subtotals.includes(s.value))],
                subtotalDisabled: !subtotals.length,
                subtotalLabel: `Subtotal of ${name}`,
                on: !c.inactive,
                onLabel: `Show ${name}`,
                rowClass: c.inactive ? 'rh-entry rh-entry_off' : 'rh-entry',
                upDisabled: i === 0,
                downDisabled: i === list.length - 1,
                upLabel: `Move ${name} left`,
                downLabel: `Move ${name} right`,
                removable: !c.name,
                removeLabel: `Remove ${name}`
            };
        });
    }

    /** Where a column stands in the default sort: "1" and an up arrow for the first, ascending. */
    sortBadgeOf(c) {
        const levels = isSortColumn(c) ? this.sortLevels : [];
        const at = levels.findIndex(l => String(l.field).toLowerCase() === String(c.field).toLowerCase());
        if (at < 0) return { sortBadge: '' };
        const desc = levels[at].direction === 'desc';
        return {
            sortBadge: String(at + 1),
            sortArrow: desc ? 'utility:arrowdown' : 'utility:arrowup',
            sortBadgeText: `Default sort ${at + 1}, ${desc ? 'descending' : 'ascending'}`
        };
    }

    /** A column's field lists: its object's fields and lookups, then each parent's, as far as the path goes. */
    fieldStepsOf(c, position) {
        const steps = this.described ? pathSteps(c.field, this.described, this.related) : [];
        if (!steps.length) steps.push({ index: 0, options: this.fieldOptions(c.field), value: c.field });
        return steps.map(s => ({
            ...s,
            key: `${c._key}-${s.index}`,
            first: s.index === 0,
            cls: s.index === 0 ? 'rh-column-field' : 'rh-column-step',
            label: s.index === 0 ? `Field of column ${position}` : `Field of ${s.objectLabel}, column ${position}`,
            placeholder: s.index === 0 ? 'Choose a field' : `Choose a field of ${s.objectLabel}`
        }));
    }

    /**
     * A choice in one of a column's field lists: a field ends the path there;
     * a lookup ("Related Account >") opens its record's fields in the next list.
     */
    handleFieldStep(event) {
        const { key, step } = event.target.dataset;
        const index = Number(step) || 0;
        const value = event.detail ? event.detail.value : event.target.value;
        const column = this.draft.columns.find(c => c._key === key);
        if (!column) return;
        const before = String(column.field || '')
            .split('.')
            .slice(0, index);
        const next = before.concat(value || '').join('.');
        this.changeEntry('columns', key, 'field', next || null);
        if (isPathName(next)) this.loadPathObjects();
    }

    get groupLevelOptions() {
        return GROUP_LEVELS;
    }

    // ---- child total columns

    /** The grid's saved child tables, which a child total column can total: { name, label, object }. */
    get savedChildren() {
        if (!this.draft) return [];
        return this.draft.children
            .filter(ch => ch.name && !ch.inactive)
            .map(ch => {
                const choice = this.childChoices.find(x => x.config === ch.childConfig);
                return {
                    name: ch.name,
                    label: ch.tabLabel || (choice ? choice.label : ch.childConfig),
                    object: choice ? choice.objectApiName : null
                };
            });
    }

    get canAddChildTotal() {
        return this.savedChildren.length > 0;
    }

    get childTotalOptions() {
        return CHILD_TOTALS;
    }

    childTotalModel(c, name) {
        const children = this.savedChildren;
        const options = children.map(ch => ({ value: ch.name, label: `${ch.label} (${ch.name})` }));
        if (c.childTable && !children.some(ch => ch.name === c.childTable))
            options.unshift({ value: c.childTable, label: `${c.childTable} (not a child table that is on)` });
        const child = children.find(ch => ch.name === c.childTable);
        const fields = (child && child.object && this.childFields[child.object]) || [];
        const kind = c.childTotal || 'count';
        const fieldOptions = fields
            .filter(fl => (fl.subtotals || []).includes(kind))
            .map(fl => ({ value: fl.name, label: `${fl.label} (${fl.name})` }));
        if (kind === 'count') fieldOptions.unshift({ value: '', label: 'Records' });
        if (c.childField && !fieldOptions.some(o => o.value === c.childField))
            fieldOptions.unshift({ value: c.childField, label: c.childField });
        return {
            childTable: c.childTable,
            childTableOptions: options,
            childTableLabel: `Child table ${name} totals`,
            childTotal: kind,
            childTotalLabel: `What ${name} works out`,
            childField: c.childField || '',
            childFieldOptions: fieldOptions,
            childFieldLabel: `Field ${name} works out from`,
            childFieldPlaceholder: kind === 'count' ? 'Records' : 'Choose a field'
        };
    }

    /** The header a child total column has without one of its own, as the server makes it. */
    childTotalPlaceholder(c) {
        const child = this.savedChildren.find(ch => ch.name === c.childTable);
        if (!child) return 'Header';
        if (!c.childField) return child.label;
        const fields = (child.object && this.childFields[child.object]) || [];
        const fl = fields.find(x => x.name === c.childField);
        const kind = CHILD_TOTALS.find(k => k.value === (c.childTotal || 'count'));
        return `${child.label}: ${kind ? kind.label : 'Count'} of ${fl ? fl.label : c.childField}`;
    }

    /** The fields of every child object a child total column uses, read once each. */
    async loadChildFields() {
        if (!this.draft) return;
        const wanted = new Set();
        this.draft.columns.forEach(c => {
            if (!isChildTotalColumn(c)) return;
            const child = this.savedChildren.find(ch => ch.name === c.childTable);
            if (child && child.object && !this.childFields[child.object]) wanted.add(child.object);
        });
        const token = this._runtime.token;
        for (const objectApiName of wanted) {
            try {
                // eslint-disable-next-line no-await-in-loop
                const described = await describeObject({ objectApiName });
                if (token !== this._runtime.token) return;
                this.childFields = { ...this.childFields, [objectApiName]: (described && described.fields) || [] };
            } catch {
                // The field list stays empty; the check says what is wrong with the column.
            }
        }
    }

    get formulaTypeOptions() {
        return FORMULA_TYPES;
    }

    /** Formulas in the grid, columns and rules that are on: at most MAX_FORMULAS. */
    get formulaCount() {
        if (!this.draft) return 0;
        return (
            this.draft.columns.filter(c => isFormulaColumn(c) && !c.inactive).length +
            this.draft.rules.filter(r => isFormulaRule(r) && !r.inactive).length
        );
    }

    get formulaHint() {
        return `Formulas use the syntax of formula fields, such as Amount__c * 0.2 or Account.Name. The grid works them out as it reads the rows, so they show saved values. ${this.formulaCount} of ${MAX_FORMULAS} formulas used.`;
    }

    get dateUnitOptions() {
        return DATE_UNITS;
    }

    // ---- display rules

    get ruleRows() {
        if (!this.draft) return [];
        const list = this.draft.rules;
        return list.map((r, i) => {
            const f = this.fieldOf(r.field);
            const name = r.label || `rule ${i + 1}`;
            const formula = isFormulaRule(r);
            const operator = r.operator || 'equals';
            // Two fields: only equals and the comparisons, with a field of the same kind.
            const canCompare = !formula && Boolean(f) && COMPARE_OPERATORS.has(operator) && f.type !== 'multipicklist';
            const comparing = canCompare && Boolean(r.compareField);
            return {
                key: r._key,
                label: r.label || '',
                meaningLabel: `Meaning of rule ${i + 1}`,
                field: r.field,
                // A formula rule's Field is only the cell it colors: none colors the row.
                fieldOptions: formula
                    ? [{ value: '', label: 'None (a row rule)' }, ...this.fieldOptions(r.field)]
                    : this.fieldOptions(r.field),
                fieldLabel: formula ? `Cell ${name} colors` : `Field ${name} tests`,
                fieldPlaceholder: formula ? 'The cell it colors' : 'Choose a field',
                isFormula: formula,
                formula: r.formula || '',
                formulaLabel: `Formula of ${name}, true or false`,
                operator: formula ? FORMULA_OPERATOR : operator,
                operatorOptions: [
                    ...(f ? operatorsFor(f.type) : operatorsFor('text')),
                    { value: FORMULA_OPERATOR, label: 'Formula is true' }
                ],
                operatorLabel: `How ${name} compares`,
                canCompare,
                compareField: comparing ? r.compareField : '',
                compareOptions: canCompare ? this.compareOptions(r) : [],
                compareLabel: `What ${name} compares ${f ? f.label : ''} with`,
                showValue: !formula && !comparing && needsValue(operator),
                value: r.value || '',
                valueLabel: `Value ${name} compares with`,
                valueHint: f ? valueHint(f.type) : '',
                showValueTo: !formula && !comparing && operator === 'between',
                valueTo: r.valueTo || '',
                valueToLabel: `Upper value of ${name}`,
                style: r.style || 'fill_green',
                styleLabel: `Look of ${name}`,
                applyTo: r.applyTo || 'cell',
                applyLabel: `Where ${name} applies`,
                on: !r.inactive,
                onLabel: `Use ${name}`,
                rowClass: r.inactive ? 'rh-entry rh-entry_off' : 'rh-entry',
                upDisabled: i === 0,
                downDisabled: i === list.length - 1,
                upLabel: `Move ${name} up`,
                downLabel: `Move ${name} down`,
                removable: !r.name,
                removeLabel: `Remove ${name}`
            };
        });
    }

    get styleOptions() {
        return STYLES;
    }

    /** "A value", or another field of the same kind. */
    compareOptions(rule) {
        const f = this.fieldOf(rule.field);
        const kind = f ? compareKind(f.type) : null;
        const fields = this.fieldOptions(
            rule.compareField,
            x => x.name !== (f && f.name) && compareKind(x.type) === kind
        );
        return [{ value: '', label: 'A value' }, ...fields.map(o => ({ ...o, label: `Field: ${o.label}` }))];
    }

    // ---- filters

    get filterRows() {
        if (!this.draft) return [];
        const list = this.draft.filters;
        return list.map((x, i) => {
            const f = this.fieldOf(x.field);
            const name = x.label || (f ? f.label : '') || `filter ${i + 1}`;
            const operator = x.operator || 'equals';
            return {
                key: x._key,
                label: x.label || '',
                labelLabel: `Label of filter ${i + 1}`,
                field: x.field,
                fieldOptions: this.fieldOptions(x.field, y => y.filterable !== false),
                fieldLabel: `Field ${name} tests`,
                operator,
                operatorOptions: f ? operatorsFor(f.type) : operatorsFor('text'),
                operatorLabel: `How ${name} compares`,
                showValue: needsValue(operator),
                value: x.value || '',
                valueLabel: `Value ${name} compares with`,
                valueHint: f ? valueHint(f.type) : '',
                showValueTo: operator === 'between',
                valueTo: x.valueTo || '',
                valueToLabel: `Upper value of ${name}`,
                on: !x.inactive,
                onLabel: `Apply ${name}`,
                rowClass: x.inactive ? 'rh-entry rh-entry_off' : 'rh-entry',
                upDisabled: i === 0,
                downDisabled: i === list.length - 1,
                upLabel: `Move ${name} up`,
                downLabel: `Move ${name} down`,
                removable: !x.name,
                removeLabel: `Remove ${name}`
            };
        });
    }

    get hasFilters() {
        return Boolean(this.draft && this.draft.filters.length);
    }

    get applyToOptions() {
        return APPLY_TO;
    }

    // ---- actions

    get actionRows() {
        if (!this.draft) return [];
        const list = this.draft.actions;
        return list.map((a, i) => {
            const name = a.label || `action ${i + 1}`;
            const quick = a.type === 'quick_action';
            return {
                key: a._key,
                label: a.label || '',
                labelLabel: `Label of action ${i + 1}`,
                type: a.type || 'screen_flow',
                typeLabel: `Type of ${name}`,
                actionName: a.actionName || '',
                actionNameLabel: `What ${name} runs`,
                actionNameHint: quick ? 'Object.ActionName, or a global action' : 'Flow API name',
                inputName: a.inputName || '',
                inputLabel: `Input of ${name}`,
                inputHint: quick ? 'Not used' : 'recordId',
                // Salesforce's window takes no input and asks its own question.
                quick,
                showIn: quick ? 'row_menu' : a.showIn || 'row_menu_and_selection',
                showInLabel: `Where ${name} is offered`,
                showInOptions: quick ? SHOW_IN.filter(o => o.value === 'row_menu') : SHOW_IN,
                confirmation: a.confirmation || '',
                confirmationLabel: `Question before ${name} runs`,
                confirmationHint: a.type === 'autolaunched_flow' ? 'Nothing' : 'Not used',
                requiredPermission: a.requiredPermission || '',
                permissionLabel: `Custom permission ${name} needs`,
                // An autolaunched flow must name one (GridActions.PERMISSION_NEEDED).
                permissionHint: a.type === 'autolaunched_flow' ? 'Required' : 'Anyone',
                on: !a.inactive,
                onLabel: `Offer ${name}`,
                rowClass: a.inactive ? 'rh-entry rh-entry_off' : 'rh-entry',
                upDisabled: i === 0,
                downDisabled: i === list.length - 1,
                upLabel: `Move ${name} up`,
                downLabel: `Move ${name} down`,
                removable: !a.name,
                removeLabel: `Remove ${name}`
            };
        });
    }

    get actionTypeOptions() {
        return ACTION_TYPES;
    }

    // ---- child tables

    get childChoices() {
        return (this.described && this.described.children) || [];
    }

    get childRows() {
        if (!this.draft) return [];
        const list = this.draft.children;
        const choices = this.childChoices;
        return list.map((c, i) => {
            const choice = choices.find(x => x.config === c.childConfig);
            const configOptions = choices.map(x => ({ value: x.config, label: `${x.label} (${x.config})` }));
            if (c.childConfig && !choice)
                configOptions.unshift({ value: c.childConfig, label: `${c.childConfig} (no lookup to this object)` });
            const linkLabels = (choice && choice.fieldLabels) || {};
            const relationshipOptions = (choice ? choice.fields : []).map(f => ({
                value: f,
                label: linkLabels[f] ? `${linkLabels[f]} (${f})` : f
            }));
            if (c.relationshipField && !relationshipOptions.some(o => o.value === c.relationshipField)) {
                relationshipOptions.unshift({ value: c.relationshipField, label: c.relationshipField });
            }
            const name = c.tabLabel || (choice ? choice.label : '') || `child table ${i + 1}`;
            return {
                key: c._key,
                childConfig: c.childConfig,
                configOptions,
                configLabel: `Grid shown in ${name}`,
                relationshipField: c.relationshipField,
                relationshipOptions,
                relationshipLabel: `Field linking ${name} to this grid's records`,
                tabLabel: c.tabLabel || '',
                tabLabelLabel: `Tab label of ${name}`,
                tabPlaceholder: choice ? choice.label : '',
                height: c.height,
                heightLabel: `Height of ${name} in pixels`,
                on: !c.inactive,
                onLabel: `Show ${name}`,
                rowClass: c.inactive ? 'rh-entry rh-entry_off' : 'rh-entry',
                upDisabled: i === 0,
                downDisabled: i === list.length - 1,
                upLabel: `Move ${name} up`,
                downLabel: `Move ${name} down`,
                removable: !c.name,
                removeLabel: `Remove ${name}`
            };
        });
    }

    get noChildChoices() {
        return this.hasObject && !this.childChoices.length;
    }

    get hasColumns() {
        return Boolean(this.draft && this.draft.columns.length);
    }

    get hasRules() {
        return Boolean(this.draft && this.draft.rules.length);
    }

    get hasActions() {
        return Boolean(this.draft && this.draft.actions.length);
    }

    get hasChildren() {
        return Boolean(this.draft && this.draft.children.length);
    }

    // ---- problems and saving

    /**
     * What the server cannot see, because blank text goes to it as nothing: a
     * formula chosen and not written yet.
     */
    get localErrors() {
        if (!this.draft) return [];
        const out = [];
        this.draft.columns.forEach((c, i) => {
            if (!isFormulaColumn(c) || c.inactive) return;
            const name = c.columnLabel || `Formula column ${i + 1}`;
            if (!String(c.formula || '').trim()) out.push(`${name}: write its formula.`);
            if (!String(c.columnLabel || '').trim()) out.push(`Formula column ${i + 1}: give it a header.`);
        });
        this.draft.rules.forEach((r, i) => {
            if (isFormulaRule(r) && !r.inactive && !String(r.formula || '').trim()) {
                out.push(`${r.label || `Rule ${i + 1}`}: write its formula.`);
            }
        });
        if (this.formulaCount > MAX_FORMULAS)
            out.push(
                `A grid has at most ${MAX_FORMULAS} formulas, columns and rules together; this one has ${this.formulaCount}.`
            );
        return out;
    }

    get errors() {
        const list = [...this.saveErrors, ...this.localErrors, ...(this.check.errors || [])];
        return [...new Set(list)].map((message, i) => ({ key: 'e' + i, message }));
    }

    get warnings() {
        return (this.check.warnings || []).map((message, i) => ({ key: 'w' + i, message }));
    }

    get hasErrors() {
        return this.errors.length > 0;
    }

    get hasWarnings() {
        return this.warnings.length > 0;
    }

    get saveDisabled() {
        return this.saving || !this.canSave || !this.dirty || this.hasErrors || this.checking;
    }

    get saveTitle() {
        if (!this.canSave) return 'Saving needs the Customize Application permission';
        if (!this.dirty) return 'Nothing to save';
        if (this.hasErrors) return 'Fix the problems first';
        return 'Save this grid';
    }

    get cancelLabel() {
        return this.dirty ? 'Cancel' : 'Close';
    }

    get busy() {
        return this.saving || this.checking;
    }

    // ============================================================ editing

    /**
     * One input changed. Its data attributes say which list (or config), which
     * entry (key), which property, and how to read the value (kind).
     */
    handleChange(event) {
        const { list, key, prop, kind } = event.target.dataset;
        let value;
        if (kind === 'checkbox') value = event.target.checked === true;
        else if (kind === 'on')
            value = event.target.checked !== true; // the switch shows On; the field is Inactive
        else if (kind === 'number') value = toInteger(event.detail ? event.detail.value : event.target.value);
        else value = event.detail ? event.detail.value : event.target.value;
        if (list === 'config') this.changeConfig(prop, value);
        else this.changeEntry(list, key, prop, value);
    }

    changeConfig(prop, value) {
        const config = { ...this.draft.config, [prop]: value };
        if (prop === 'label' && config.isNew && !this._memo.nameEdited) config.name = apiNameFrom(value);
        if (prop === 'name') this._memo.nameEdited = true;
        if (prop === 'recordPageField' && !value) config.recordPageField = null;
        if (prop === 'allowNewRecords' && value === false) config.allowImport = false; // import needs New
        this.draft = { ...this.draft, config };
        if (prop === 'objectApiName') this.changeObject(value);
        else this.scheduleCheck();
    }

    /** A new grid's object chosen: its name column to start with, and nothing that belonged to the last one. */
    async changeObject(objectApiName) {
        const token = this._runtime.token;
        this.described = null;
        this.draft = {
            ...this.draft,
            columns: [],
            rules: [],
            children: [],
            filters: [],
            config: { ...this.draft.config, sortField: null, sortDirection: 'asc', thenSort: [], recordPageField: null }
        };
        if (!objectApiName) return;
        try {
            const described = await describeObject({ objectApiName });
            if (token !== this._runtime.token || this.draft.config.objectApiName !== objectApiName) return;
            this.described = described;
            const nameField = (described.fields || []).find(f => f.isName);
            if (nameField) {
                // The name column it starts with, and sorted by it, A to Z.
                this.draft = {
                    ...this.draft,
                    columns: [fitColumnToField(newColumn(nameField.name), nameField)],
                    config: withSortLevels(this.draft.config, [{ field: nameField.name, direction: 'asc' }])
                };
            }
            this.scheduleCheck();
        } catch (e) {
            if (token === this._runtime.token) this.saveErrors = [messageOf(e)];
        }
    }

    changeEntry(list, key, prop, value) {
        let next = value;
        if (prop === 'groupLevel' || prop === 'decimalPlaces' || prop === 'height') next = toInteger(value);
        if (prop === 'childField' && !value) next = null; // Records: a count of the records
        const items = this.draft[list].map(item => {
            if (item._key !== key) return item;
            let changed = { ...item, [prop]: next };
            if (list === 'columns' && prop === 'field') changed = fitColumnToField(changed, this.fieldOf(next));
            if (list === 'columns' && prop === 'groupLevel' && next && !changed.groupUnit) {
                const f = this.fieldOf(changed.field);
                if (f && isDateType(f.type)) changed.groupUnit = 'month';
            }
            if (list === 'columns' && prop === 'groupLevel' && !next) changed.groupUnit = null;
            if ((list === 'rules' || list === 'filters') && prop === 'field') {
                const other = this.fieldOf(changed.compareField);
                changed = fitRuleToField(changed, this.fieldOf(next), other ? other.type : undefined);
            }
            // "Formula is true" makes a formula rule; any other condition ends it.
            if (list === 'rules' && prop === 'operator') {
                if (next === FORMULA_OPERATOR) {
                    changed.operator = item.operator;
                    changed.formula = item.formula || '';
                    changed.compareField = null;
                } else {
                    changed.formula = null;
                    if (!COMPARE_OPERATORS.has(next)) changed.compareField = null;
                }
            }
            // A rule compares with a value or a field, not both: the value box is hidden
            // once a field is chosen, so its value goes too (the server skips a rule with both).
            if (list === 'rules' && prop === 'compareField') {
                if (next) changed.value = '';
                else changed.compareField = null;
            }
            // Value To belongs to Between alone; another condition drops it.
            if ((list === 'rules' || list === 'filters') && prop === 'operator' && changed.operator !== 'between')
                changed.valueTo = '';
            if (list === 'columns' && prop === 'formulaType' && !NUMBER_RESULTS.has(next)) changed.decimalPlaces = null;
            // A quick action opens Salesforce's window for one row: the row menu only, no input, no question.
            if (list === 'actions' && prop === 'type' && next === 'quick_action') {
                changed.showIn = 'row_menu';
                changed.inputName = '';
                changed.confirmation = '';
            }
            // A new kind of total keeps its field only where the field fits it.
            if (list === 'columns' && prop === 'childTotal' && changed.childField) {
                const child = this.savedChildren.find(ch => ch.name === changed.childTable);
                const fl = ((child && child.object && this.childFields[child.object]) || []).find(
                    x => x.name === changed.childField
                );
                if (!fl || !(fl.subtotals || []).includes(next)) changed.childField = null;
            }
            if (list === 'columns' && prop === 'childTable') changed.childField = null;
            if (list === 'children' && prop === 'childConfig') {
                const choice = this.childChoices.find(x => x.config === next);
                changed.relationshipField = choice && choice.fields.length ? choice.fields[0] : null;
            }
            return changed;
        });
        this.draft = list === 'columns' ? this.withColumns(items) : { ...this.draft, [list]: items };
        if (list === 'columns' && prop === 'childTable') this.loadChildFields();
        this.scheduleCheck();
    }

    handleAdd(event) {
        const list = event.target.dataset.list;
        const formula = 'formula' in event.target.dataset;
        if ('childTotal' in event.target.dataset) {
            // A child total column, on the first child table to start with.
            const first = this.savedChildren[0];
            this.draft = {
                ...this.draft,
                columns: [...this.draft.columns, newChildTotalColumn(first ? first.name : null)]
            };
            this.loadChildFields();
            this.scheduleCheck();
            return;
        }
        const make = formula
            ? newFormulaColumn
            : { columns: newColumn, rules: newRule, actions: newAction, children: newChild, filters: newFilter }[list];
        if (!make) return;
        this.draft = { ...this.draft, [list]: [...this.draft[list], make()] };
        this.scheduleCheck();
    }

    handleMove(event) {
        const { list, key, delta } = event.target.dataset;
        const items = this.draft[list];
        const index = items.findIndex(item => item._key === key);
        const moved = moveItem(items, index, Number(delta));
        if (moved === items) return;
        this.draft = { ...this.draft, [list]: moved };
        this.scheduleCheck();
    }

    /** Only an entry never saved can go: a saved one is turned off instead. */
    handleRemove(event) {
        const { list, key } = event.target.dataset;
        const items = this.draft[list].filter(item => item._key !== key || item.name);
        if (items.length === this.draft[list].length) return;
        this.draft = list === 'columns' ? this.withColumns(items) : { ...this.draft, [list]: items };
        this.scheduleCheck();
    }

    // ============================================================ checking

    scheduleCheck() {
        this.saveErrors = [];
        this.status = '';
        clearTimeout(this._runtime.checkTimer);
        const token = ++this._runtime.checkToken;
        this.checking = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- checked once the admin pauses, not on every key
        this._runtime.checkTimer = setTimeout(() => this.runCheck(token), CHECK_DELAY_MS);
    }

    async runCheck(token) {
        if (token !== this._runtime.checkToken || !this.draft) return;
        try {
            const result = await checkDraft({ draftJson: JSON.stringify(toServer(this.draft)) });
            if (token !== this._runtime.checkToken) return;
            this.check = { errors: (result && result.errors) || [], warnings: (result && result.warnings) || [] };
        } catch (e) {
            if (token === this._runtime.checkToken) this.check = { errors: [messageOf(e)], warnings: [] };
        } finally {
            if (token === this._runtime.checkToken) this.checking = false;
        }
    }

    // ============================================================ saving

    async handleSave() {
        if (this.saveDisabled) return;
        const token = this._runtime.token;
        clearTimeout(this._runtime.checkTimer);
        this._runtime.checkToken++;
        const name = (this.draft.config.name || '').trim();
        const label = (this.draft.config.label || '').trim();
        this.saving = true;
        this.saveErrors = [];
        this.status = 'Saving…';
        try {
            const jobId = await saveDraft({ draftJson: JSON.stringify(toServer(this.draft)) });
            if (token !== this._runtime.token) return;
            this.status = 'Saving. This takes a few seconds…';
            const outcome = await this.waitForSave(jobId, token);
            if (!outcome) return;
            if (outcome.status === 'Succeeded') {
                this.status = '';
                this.dispatchEvent(
                    new ShowToastEvent({
                        title: 'Grid saved',
                        message: `${label || name} is saved. Grids show it the next time they load.`,
                        variant: 'success'
                    })
                );
                this.dispatchEvent(new CustomEvent('saved', { detail: { configName: name } }));
                // Read it again: new entries now have the API names the server gave them.
                this._configName = name;
                this.saving = false;
                this.load();
            } else if (outcome.status === 'Failed') {
                this.status = '';
                this.saveErrors =
                    outcome.messages && outcome.messages.length
                        ? outcome.messages
                        : ['The save did not go through. Try again.'];
            } else {
                this.status =
                    'The save is taking longer than usual. It may still go through: open this grid again in a minute to see.';
            }
        } catch (e) {
            if (token === this._runtime.token) {
                this.status = '';
                this.saveErrors = [messageOf(e)];
            }
        } finally {
            if (token === this._runtime.token) this.saving = false;
        }
    }

    /** Ask until the deploy has succeeded or failed: its outcome, { status: 'timeout' }, or null if the editor closed. */
    async waitForSave(jobId, token) {
        const started = Date.now();
        for (let i = 0; ; i++) {
            // eslint-disable-next-line no-await-in-loop
            await delay(POLL_DELAYS_MS[Math.min(i, POLL_DELAYS_MS.length - 1)]);
            if (token !== this._runtime.token) return null;
            // eslint-disable-next-line no-await-in-loop
            const result = await saveStatus({ jobId });
            if (token !== this._runtime.token) return null;
            if (result && result.status && result.status !== 'pending') {
                return { status: result.status, messages: result.messages || [] };
            }
            if (Date.now() - started >= SAVE_TIMEOUT_MS) return { status: 'timeout', messages: [] };
        }
    }

    // ============================================================ the page layout

    get isPage() {
        return this._layout === 'page';
    }

    get showFooter() {
        return !this.isPage;
    }

    get showHelpPanel() {
        return this.isPage && !this.helpHidden;
    }

    get showHelpButton() {
        return this.isPage && this.helpHidden;
    }

    get rootClass() {
        return this.isPage ? 'rh-editor rh-editor_page' : 'rh-editor';
    }

    get bodyClass() {
        if (!this.isPage) return 'rh-ed-body';
        return this.showHelpPanel ? 'rh-ed-body rh-ed-body_page' : 'rh-ed-body rh-ed-body_page rh-ed-body_nohelp';
    }

    /** The page's title: the grid's, or New grid until a new one has one. */
    get heading() {
        const label = String(this.config.label || '').trim();
        if (label) return label;
        return this.isNew ? 'New grid' : this._configName;
    }

    /** The object, as its plural label: Contacts. */
    get objectChip() {
        return this.described ? this.described.labelPlural : '';
    }

    get nameChip() {
        return String(this.config.name || '').trim();
    }

    /** Where the grid shows its rows, and how tall it is. */
    get placeText() {
        if (!this.hasObject) return '';
        const field = this.fieldOf(this.config.recordPageField);
        const where = this.config.recordPageField
            ? `On record pages, by ${field ? field.label : this.config.recordPageField}`
            : 'Not on a record page';
        const height = this.config.height ? `${this.config.height} pixels high` : 'fills the window';
        return `${where} · ${height}`;
    }

    /** The heading's way back, Grid Admin or Grids: the list, asking first if there are unsaved changes. */
    handleCrumb(event) {
        event.preventDefault();
        this.requestClose();
    }

    handleHideHelp() {
        this.helpHidden = true;
        writeHelpHidden(true);
    }

    handleShowHelp() {
        this.helpHidden = false;
        writeHelpHidden(false);
    }

    // ============================================================ closing

    handleCancel() {
        this.requestClose();
    }

    handleDiscard() {
        this.confirmingClose = false;
        this.dispatchEvent(new CustomEvent('close'));
    }

    handleKeepEditing() {
        this.confirmingClose = false;
    }
}
