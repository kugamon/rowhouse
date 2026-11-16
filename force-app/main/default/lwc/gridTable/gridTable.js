/**
 * gridTable — the table core. Renders its own SLDS table, owns its own keyboard
 * model and writes its own ARIA. No lightning-datatable underneath.
 *
 * ONE PUBLIC INPUT (HR-2)
 * Everything arrives in one `config` object. Its setter only stores the
 * reference (HR-17): the parent owns the data and hands over a NEW object when
 * anything changes. Derived views (sorting, windowing, cell models) are computed
 * in getters from that reference and memoised in a non-reactive container.
 *
 *   config = {
 *     columns:     [{ field, label, type, editable, sortable, scale, options,
 *                     width, required, wrap, dependentOn }],
 *     rows:        [{ Id, ...fields }]   plain objects (HR-28)
 *     keyField:    'Id'
 *     drafts:      { [id]: { [field]: value } }      uncommitted edits
 *     errors:      { [id]: { row, fields: { [field]: message } } }
 *     selection:   'multi' | 'single' | undefined
 *     maxSelected: number
 *     selectionKey: any value; a new one clears the row selection
 *     sort:        [{ field, direction }]             initial sort
 *     totalRows:   number | -1                        -1 while still loading
 *     layout:      'auto' | 'table' | 'cards'          default 'auto'
 *     diagnostics: true to record benchmark timings (c/gridTiming)
 *     frozenColumns: how many data columns stay put when scrolling sideways
 *     hasMore:     true when the server has rows not loaded yet
 *     loadingMore: true while the next page is on its way
 *     height:      pixels, from the configuration; empty means fill the window
 *     rowNumbers:  true to number the rows down the left edge, as a list view
 *                  does (the configuration's Show Row Numbers)
 *     refNames:    { [recordId]: name } for lookup and owner cells
 *     configName:  the grid configuration, which lookup editors search through
 *     displayRules: conditional formats from the server, in order
 *     formatToday: the day TODAY stands for in them (YYYY-MM-DD), or null
 *                  for the day they were first read
 *     grouping:    [{ field, unit }] the grouping, outermost first
 *     groupSummary: { status: 'loading' | 'ready' | 'unavailable', totals }
 *                    counts and subtotals from the server (c/gridGroups rollUp)
 *     fiscal:      the org's fiscal year, for grouping by fiscal quarter or
 *                  year (c/gridGroups fiscalOf); null for none
 *     children:    [{ name, label, configName }] tabs of related records under
 *                  each row; empty for none, and at the deepest level
 *     childCounts: { [recordId]: { total, byTab } } how many related records
 *                  each row has; a row not in it yet has its count on
 *                  the way. Absent: no counts are asked for.
 *     childCountsFailed: true when the counts could not be fetched
 *     level:       1 for a top-level grid, 2 or 3 for a child table
 *     rowActions:  [{ name, label }] the actions in each row's menu;
 *                  empty for no Actions column
 *     bulkEdit:    true: an edit to a selected row can go to every selected
 *                  row (the editor's "Update N selected items", Ctrl+Enter)
 *     filters:     [{ field, operator, value, valueTo }] the user's
 *                  filters; the parent owns them. A column's menu keeps one
 *                  per column; the Filters panel may add more
 *     filterLogic: how they join, "1 AND (2 OR 3)", or '' for all; chips
 *                  are numbered when there is some
 *     adminFilters: [{ text }] the admin's filters, shown, never removable
 *     userLayout:  { key, widths, wrap, expanded, groupView } the user's saved layout,
 *                 applied once per key; a new key with nothing in
 *                  it puts the admin's widths and wrapping back (Reset layout)
 *     ariaLabel, saving
 *     savingEdits: the edits are being saved (not a delete or an action):
 *                  Save shows a spinner and "Saving…"
 *     saveProgress: how far a save of many batches has got, for the Save bar
 *   }
 *
 * EVENTS OUT (plain-object details, HR-28)
 *   cellchange      { recordId, field, value }
 *   cellschange     { label, changes: [{ recordId, field, value, originalValue }],
 *                     errors: [{ recordId, field, message }] }   one paste, fill or clear
 *   undo / redo     (no detail)
 *   save / cancel   (the Save bar, floating at the bottom)
 *   sortchange      { sort: [{ field, direction }] }
 *   selectionchange { selectedIds: [] }
 *   loadmore        (no detail) the user is near the end of the loaded rows
 *   groupchange     { grouping: [{ field, unit }] } from a column menu
 *   rowaction       { action, recordId } an action chosen from a row's menu
 *   applyselected   { recordId, field, value, valueLabel } an edit to a
 *                   selected row, for every selected row
 *   filterchange    { filters, logic? } a column filter applied or removed;
 *                   logic only when the filter logic itself was removed
 *   layoutchange    { widths, wrap, expanded, groupView } a width the user set,
 *                   Wrap or Clip chosen, a row's related records opened or
 *                   closed, the groups' order or percentages
 *
 * THE FOCUS MODEL (HR-13)
 * Focus is remembered as { rowId, field } — a record and a column — never as a
 * screen position. Rows are re-ordered by sorting and re-created by windowing,
 * and LWC's keyed diff can destroy a focused element when it moves (lwc#4291).
 * After every render that could have moved the focused cell, renderedCallback
 * puts DOM focus back on the cell for the SAME RECORD. That is what stops the
 * next keystroke editing the wrong row.
 *
 * ROW WINDOWING
 * `content-visibility: auto` does nothing on a real
 * <table> (table rows are internal table boxes, which size containment does not
 * apply to), and that where it does work it drops the skipped cells out of the
 * accessibility tree. So large views are windowed in JavaScript: only the rows
 * near the viewport are rendered, between two spacer rows, and every rendered
 * row carries aria-rowindex against aria-rowcount (HR-10).
 *
 * HEIGHT
 * The table scrolls inside its own box, so the header stays put and only the
 * rows in view are drawn; the box needs a height. With no Height on the
 * configuration it fills the window: from the box's top edge to the bottom of
 * the window, less room for the Lightning utility bar and, while there are
 * unsaved changes, the Save bar. Salesforce does not tell a component how much
 * room it has, so this is measured after each render and on window resize.
 *
 * NARROW LAYOUT
 * Below NARROW_WIDTH (the SLDS "small" breakpoint, 30em) the grid renders as a
 * list of record cards instead of a table: a 20-column ARIA grid is unusable on
 * a phone and hard to drive with a touch screen reader, while a list of
 * headings, label/value pairs and buttons is what VoiceOver and TalkBack handle
 * natively. Editing uses the same editors and emits the same events. The width
 * is read from the component's own root (HR-24) through ResizeObserver, with a
 * window-resize fallback where Locker does not provide it (HR-23).
 *
 * TEXT WRAP
 * A text column either clips to one line (the default) or wraps to at most
 * three. `column.wrap` is the admin's default; the column header menu (Wrap
 * text / Clip text, the wording lightning-datatable uses) overrides it for the
 * session. Wrapped cells use SLDS's own slds-line-clamp (three lines) and are
 * all exactly three lines tall, so every row keeps one height and the
 * windowing arithmetic stays exact. Clipping is visual only: the full value is
 * in the DOM for screen readers and in the title for a mouse. Cards always wrap.
 *
 * ALIGNMENT BY TYPE (c/gridFormat alignmentFor)
 * Number, currency and percent values sit against the right edge of their
 * cell, in the table and in cards, and so does the column's header label, so
 * digits line up for comparison. In a right-aligned header the sort arrow goes
 * before the label: SLDS shows that arrow only on hover, and after the label it
 * would push the label sideways every time the pointer crossed the header.
 * Checkboxes are centred in the table, header too, so a narrow column of
 * ticks reads as a column; in cards they stay beside their label.
 * Everything else, dates and picklists included, sits at the left.
 *
 * LOOKUPS, OWNERS AND PICKLIST DEPENDENCIES (c/gridFields)
 * A lookup or owner cell holds a record Id and shows the record's name, from
 * config.refNames, linked to the record; it sorts, copies and pastes by name.
 * A dependent picklist offers only the values its row's controlling value
 * allows, and an edit of the controlling field clears dependent values it
 * makes invalid, in the same undo step. A stored invalid pairing is shown as
 * stored until then (TC-038).
 *
 * CONDITIONAL FORMATTING (c/gridDisplayRules)
 * Each rendered row is tested against the configuration's display rules, using
 * the values the cells show (unsaved edits included), and each cell takes the
 * classes of the rules it matches: a fill, a text color, bold. The colors
 * are rh- classes on SLDS palette hooks. A cell with an unsaved edit or an
 * error takes no format, so it shows as unsaved or in error until it is saved
 * (a fill outranked SLDS's unsaved color, found in Lightning Experience);
 * the selected range tints over a fill.
 *
 * SPREADSHEET FEEL (docs/spreadsheet.md)
 * A range is the rectangle between an anchor cell and the focused cell, in
 * view positions: Shift+arrows and Shift+click extend it, any plain move
 * collapses it, and sorting clears it. Copy, paste, fill-down and clear work on
 * the range (or the focused cell) and never write to a record: they emit
 * `cellschange` with every change of one action together, so the parent keeps
 * them as drafts and can undo them as one step. Clipboard listeners sit on this
 * component's own root element, the one place Lightning Web Security delivers
 * clipboard events to. Frozen columns are sticky cells with a
 * left offset taken from the pinned column widths.
 *
 * GROUPING AND SUBTOTALS (c/gridGroups)
 * A grouped grid is a treegrid. A Group column, after the utility columns,
 * holds each group's toggle, name and record count; the group's header row
 * holds its subtotals under their columns, and its rows follow, one level
 * deeper. Header rows are rows of the view like any other, with synthetic
 * ids, so focus, windowing and the keyboard treat them alike; editing, paste,
 * fill, clear, copy and row selection skip them. Enter or Space on a group's
 * Group cell opens or closes it. Each column menu offers grouping by that
 * column, and the Group column's menu expands or collapses every group,
 * changes a date's unit, or removes the grouping; the parent owns the
 * grouping (groupchange) because a new one needs the server. Counts and
 * subtotals cover every matching record, from the server; the Total row, in
 * a table of its own under the grid, shows the whole list's.
 *
 * MORE GROUPING
 * The Group column's menu also orders the groups by name, record count or a
 * subtotal, largest or smallest first, and shows each group's share of the
 * whole list's count and sums; both are kept with the user's layout. A date
 * groups by week and by fiscal quarter and year too. Subtotals follow unsaved
 * edits (c/gridGroups withDrafts), marked as unsaved until they are saved. A
 * groupable header dragged onto the Group header, or onto the drop zone that
 * shows above the table while it is dragged, groups by it (mouse only; the
 * column menu does the same from the keyboard).
 *
 * CHILD TABLES (c/gridChildTables, c/gridChildTabs)
 * With tabs in config.children, a column after the selection column holds a
 * toggle on each record. An open record is followed by a detail row: one cell
 * across the table, holding c/gridChildTabs, a tab per child table, each a grid
 * of its own. Detail rows are rows of the view with synthetic ids, like group
 * rows, so windowing, focus and the keyboard treat them alike, and editing,
 * paste, fill, clear, copy and selection skip them. A detail row is
 * a fixed height by level (gridChildTables detailHeight), so a row's top is still
 * arithmetic (gridChildTables rowTop).
 * Enter on the detail cell moves focus into the open tab's grid; Escape there,
 * when the child grid has no use for it, brings focus back. Keys, clicks,
 * focus and clipboard events from inside a child grid bubble up through this
 * table's root; they belong to the child, so this table ignores them
 * (fromChild). Open rows last for the session.
 *
 * AFTER THE UX REVIEW
 * - Frozen cells take the row's hover and selected colors (rh-row_selected).
 * - The name field links to its record; email and phone are mailto: and tel:.
 * - Every sortable column has a menu with Sort ascending and descending; a
 *   read-only column's cells show their lock only on hover or focus, like the
 *   pencil. Its header has no lock, as in a list view.
 * - Columns are never narrower than their type needs (c/gridSizing); number
 *   and date columns widen to fit their widest loaded value; the table
 *   scrolls sideways instead of squeezing. A wrapped row takes the lines its
 *   values need, one to three.
 * - Typing on an editable cell, F2, Enter (on a cell that is not a link) and a
 *   double-click start editing.
 * - Panels are sized to their content; the toggle shows how many related
 *   records a row has and is hidden when it has none, or while its count is
 *   on the way (offersToggle).
 * - Group rows show their count as "(n)", levels are shaded apart, the
 *   grouping shows as chips above the table, and a count of nothing is blank.
 * - A row format's fill is a light tint and a bar at the row's left edge; formats carry labels.
 * - An empty list says so. Undo and Redo sit in the Save bar.
 * - Cards show the title and three fields; the rest on request.
 *
 * ROW ACTIONS
 * With config.rowActions, the last column holds a menu button on each record
 * row, as a list view's row-level actions do; a group's row has none. Its
 * menu is drawn only for the row it is open on, one row at a time (rowMenu),
 * with the header menus' keyboard model: Enter, Space or Alt+Down on the cell
 * opens it on the first item, arrows move, Enter chooses, Escape closes. It
 * opens upwards only where it fits between the row and the header; otherwise
 * downwards, and a short grid grows to hold it (measureMenuRoom). The table only
 * says which action on which record (rowaction); the parent runs it. In cards,
 * each card has the same menu (lightning-button-menu).
 *
 * FILTERS, LAYOUT, EDITORS AND FORMULAS
 * - A column the server marks filterable has Filter… in its menu, which opens
 *   c/gridFilterPanel under the header; a filtered column shows a filter icon
 *   beside its label, and the filters are chips above the table with the
 *   grouping's, the admin's among them, locked. The parent owns the filters
 *   (filterchange), because a new one needs the server.
 * - The user's widths, Wrap or Clip and open rows are told to the parent
 *   (layoutchange), which keeps them in Salesforce; a saved layout comes back
 *   in config.userLayout and is applied once.
 * - Date/time, time and text area cells have editors (c/cellDateTime,
 *   c/cellTime, c/cellTextarea). A value the server shortened (row._cut, TC-055)
 *   is edited in the text area editor, which reads the whole text first, and
 *   is never the source of a fill down.
 * - A cell a rule gives an icon shows it before the value; a data bar is a
 *   bar behind the number, scaled to the column's loaded values.
 */
import { LightningElement, api } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import tableTemplate from './gridTable.html';
import { nextPosition, actionFor, isNavigationKey, MODE_NAVIGATION, MODE_ACTION } from 'c/gridKeyboard';
import {
    formatValue,
    formatCount,
    safeHref,
    sortRows,
    alignmentFor,
    isBlank,
    picklistRanks,
    currencyFor,
    isMixedCurrency
} from 'c/gridFormat';
import { mark, measure, afterPaint } from 'c/gridTiming';
import { copyText, toTsv, parseTsv, parseCell, pastePlan, pasteSize, MAX_PASTE_CELLS } from 'c/gridClipboard';
import {
    isLookup,
    lookupText,
    lookupHref,
    nameIndex,
    unknownNames,
    namesFound,
    isValidDependent,
    dependentClears,
    rowOptions,
    isAllowedForRecordType
} from 'c/gridFields';
import findLookupNames from '@salesforce/apex/GridController.findLookupNames';
import { compileRules, formatsFor } from 'c/gridDisplayRules';
import {
    normalizeGrouping,
    normalizeOrder,
    buildView,
    withDrafts as totalsWithDrafts,
    shareOf,
    shareText,
    subtotalFor,
    recordsText,
    isDateColumn,
    DATE_UNITS,
    UNIT_LABELS,
    SUBTOTAL_SHORT,
    SUBTOTAL_NAMES,
    MAX_LEVELS
} from 'c/gridGroups';
import { detailId, withDetails, rowTop, rowAt, panelHeightFor, panelMax } from 'c/gridChildTables';
import { NEW_MARK } from 'c/gridEditState';
import { minWidthFor, fitsToValues, fitWidth, linesNeeded, FIT_CAP, TEXT_FIT_CAP, MAX_LINES } from 'c/gridSizing';
import { canFilter, describeFilter, withFilter, withoutFilterAt, MAX_FILTERS } from 'c/gridFilters';
import { shownColumns, canHide, hideColumn, moveColumn } from 'c/gridColumns';

const HEADER = '__header';
/** The Total row's focus key: its cells are reached with the arrow keys, under the last row. */
const TOTALS = '__totals';
const SELECT_FIELD = '__select';
const STATUS_FIELD = '__status';
const GROUP_FIELD = '__group';
const EXPAND_FIELD = '__expand'; // the toggle that opens a row's child tables
const DETAIL_FIELD = '__detail'; // the one cell of an open row's panel
const ACTIONS_FIELD = '__actions'; // the row's menu of actions, the last column
const GROUP_ZONE = '__groupzone'; // the bar a header is dropped on to group by it
const ACTIONS_WIDTH = 52; // px: an x-small menu button, as SLDS's data-table row actions (3.25rem)
const MENU_ITEM_HEIGHT = 36; // px: one dropdown item, for choosing whether a row's menu opens up or down
/** A filter chip; a locked one has no remove button, so it gets the padding the button would have. */
const CHIP_CLS = 'slds-pill slds-m-right_xx-small slds-m-vertical_xxx-small rh-filter-chip';
const MENU_GAP = 4; // px: room below an open menu, so its shadow is not cut off (measureMenuRoom)
const EXPAND_WIDTH = 56; // px: one x-small icon button and a count of up to three digits
const GROUP_WIDTH = 220; // px: room for a toggle, a name and a count
const GROUP_INDENT = 24; // px per level (16 read as flat)
const WINDOW_THRESHOLD = 150; // below this many rows, render them all
const WINDOW_BUFFER = 20; // rows rendered above and below the viewport
/** Cells a range's change may touch in place; beyond it the table is redrawn (patchRange). */
const MAX_RANGE_PATCH = 4000;
const LOAD_AHEAD = 200; // ask for the next page when this close to the last loaded row
const DEFAULT_ROW_HEIGHT = 33; // px; replaced by a measurement after first render
const DEFAULT_VIEWPORT = 480; // px; JSDOM and first render have no layout
const MIN_WIDTH = 20;
const MAX_WIDTH = 1000;
// px a press of an arrow key on a column's width control, as on a list view (measured)
const RESIZE_STEP = 10;
const RESIZE_KEYS = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
const DEFAULT_WIDTH = 150; // px: a column with no admin width, once widths are pinned
// Utility columns have fixed widths, the ones a Salesforce list view uses
// (measured in Lightning Experience): 2rem for the checkbox column, 3.25rem for
// the row-number/error column.
const SELECT_WIDTH = 32;
// px: the table's own left and right borders, 1px each in SLDS 2's bordered
// table. Room shared out to
// the columns leaves them out, or the table is 2px wider than its box.
const TABLE_BORDERS = 2;
const STATUS_WIDTH = 52;
// A row's number starts where a list view's does, 28px in: 8px, then a 20px
// place for the row's error button. The column widens for numbers of more
// digits than it holds: px per digit (small text, tabular figures; measured
// 7.6px in Lightning Experience).
const NUMBER_LEFT = 28;
const NUMBER_DIGIT = 8;
const MAX_NUMBERED = 100000; // the most rows a grid loads (gridView MAX_LOADED_ROWS)
const NARROW_WIDTH = 480; // px: the SLDS "small" breakpoint (30em)
// Height, in px.
const MIN_FIXED_HEIGHT = 160; // an admin Height below this still shows a few rows
const MIN_FILL_HEIGHT = 240; // filling a short window never shrinks the grid below this
const BOTTOM_RESERVE = 56; // the Lightning utility bar (2.5rem) and a 1rem margin
const FOOTER_RESERVE = 92; // the Save bar's band under the table (.rh-has-footer, 5.75rem)
const CARD_PAGE = 50; // cards rendered per "Show more"
// Column types where wrapping means something. Numbers, dates and checkboxes
// are short by nature and are never wrapped.
const WRAPPABLE_TYPES = new Set(['text', 'string', 'textarea', 'email', 'url', 'phone', 'picklist', 'multipicklist']);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
/**
 * A column that shows a parent record's field is edited on rows that have
 * that parent: a row whose lookup is blank has no record to change it on.
 */
const reachesParent = (row, column) => !column.isPath || Boolean(row && row._parents && row._parents[column.field]);

// ---- a cell range as the page shows it ----
const inRect = (r, row, col) => Boolean(r) && row >= r.top && row <= r.bottom && col >= r.left && col <= r.right;
const sameRect = (a, b) =>
    (!a && !b) ||
    (Boolean(a) && Boolean(b) && a.top === b.top && a.bottom === b.bottom && a.left === b.left && a.right === b.right);
/** The smallest rectangle holding both (either may be null). */
function boundingRect(a, b) {
    const rects = [a, b].filter(Boolean);
    return {
        top: Math.min(...rects.map(r => r.top)),
        bottom: Math.max(...rects.map(r => r.bottom)),
        left: Math.min(...rects.map(r => r.left)),
        right: Math.max(...rects.map(r => r.right))
    };
}
/** What a cell changed in place may differ in from its drawing. */
const cellState = el => ({
    tabindex: el.getAttribute('tabindex'),
    ring: el.classList.contains('rh-cell_focus'),
    inRange: el.classList.contains('rh-in-range'),
    selected: el.getAttribute('aria-selected')
});
const sameState = (a, b) =>
    a.tabindex === b.tabindex && a.ring === b.ring && a.inRange === b.inRange && a.selected === b.selected;
/** Values sampled per column to fit its width: the longest ones, by stored text. */
const FIT_SAMPLE = 8;
/** Fields a card shows before "Show all fields". */
const CARD_FIELDS = 3;
const RECORD_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;
const NO_NEW_ROWS = [];

const EDITOR_BY_TYPE = {
    text: 'text',
    string: 'text',
    textarea: 'textarea',
    email: 'text',
    phone: 'text',
    url: 'text',
    number: 'number',
    double: 'number',
    integer: 'number',
    long: 'number',
    currency: 'number',
    percent: 'number',
    date: 'date',
    datetime: 'datetime',
    time: 'time',
    checkbox: 'checkbox',
    boolean: 'checkbox',
    picklist: 'picklist',
    multipicklist: 'multipicklist',
    reference: 'lookup',
    owner: 'lookup'
};
// The edit box is the cell's width, for every editor.
// What cannot fit a narrow cell hangs below the box like a menu: a lookup's
// matches (20rem at least), the date calendar (about 18rem), the two lists of
// a multi-select picklist (26rem). px, at the 16px root size Lightning uses.
const DROPDOWN_WIDTH = { lookup: 320, date: 320, multipicklist: 416, datetime: 320, time: 160, textarea: 416 };
// px below an edited row for what hangs below the box: seven lookup matches or
// a dual listbox; the date calendar is taller (measured in Lightning
// Experience: 354px under a 32px box).
const EDITOR_ROOM = 320;
const EDITOR_ROOM_BY = { date: 400, datetime: 470, textarea: 280 };
/** px the editor's "Update N selected items" box adds below it. */
const BULK_ROOM = 36;
/** Layout entries the parent keeps: at most this many open rows. */
const MAX_OPEN_ROWS = 50;
/** Columns a user may freeze from a header's menu: as many as an admin may. */
const MAX_FROZEN = 5;
/** Rows "Show related records for every row" opens at most. */
const MAX_OPEN_ALL = 200;

let idCounter = 0;

/** A column menu's dropdown: one that holds more than ten items scrolls (SLDS's length-10), as the Group menu can. */
function menuClass(count) {
    return 'slds-dropdown slds-dropdown_right rh-column-menu' + (count > 10 ? ' slds-dropdown_length-10' : '');
}

export default class GridTable extends NavigationMixin(LightningElement) {
    _config = {};

    // ---- reactive UI state (each reassignment re-renders) ----
    sortKeys = [];
    focusRev = 0; // bumped when a change of focus needs a redraw; see focusKey
    dropTarget = null; // { field, after }: where a dragged header would go
    draggingField = null; // the header being dragged
    groupZoneField = null; // a groupable header being dragged: the drop zone above the table shows
    mode = MODE_NAVIGATION;
    hasFocus = false;
    editing = null; // { rowId, field, seed, applyAll }: applyAll, the editor's "Update N selected items"
    firstRow = 0; // first row index of the rendered window
    rowHeight = DEFAULT_ROW_HEIGHT;
    widths = {};
    widthsPinned = false; // true after the first resize: the table is then as wide as its columns
    selected = {};
    narrow = false; // measured: the component is narrower than NARROW_WIDTH
    cardLimit = CARD_PAGE;
    wrapOverrides = {}; // { [field]: boolean } chosen from the header menu, this session only
    menuOpenFor = null; // field whose column menu is open
    filterOpenFor = null; // field whose filter panel is open
    rowMenu = null; // { rowId, up }: the row whose actions menu is open, and whether it opens upwards
    fillHeight = 0; // px: measured height when filling the window; 0 until measured
    editRoom = 0; // px: how tall the scroller must be while an editor is open; see placeEditor
    menuRoom = 0; // px: how tall the scroller must be while a column or row menu is open; see measureMenuRoom
    editAlignRight = false; // what hangs below the open editor opens leftwards from the cell's right edge
    editUp = false; // what hangs from the open editor opens upwards: no room below, even grown; see placeEditor
    collapsed = {}; // { [group id]: true } for the groups closed this session
    groupView = { order: { by: 'name', direction: 'asc' }, percent: false }; // the groups' order and percentages
    expanded = {}; // { [record id]: true } for the rows whose child tables are open
    userFrozen = null; // the data columns the user froze (Freeze up to this column); null for the admin's
    viewWidth = 0; // px: the scroller's visible width: an open row's panel takes it, unpinned columns share it out
    panelSizes = {}; // { [record id]: px } each open panel's measured content
    childFocus = false; // focus is inside an open row's child table
    wrapMin = 1; // lines: a drawn wrapped cell needed more than estimated
    cardExpanded = {}; // { [record id]: true } cards showing every field

    // ---- non-reactive containers (mutated, never reassigned; HR-20) ----
    _measurements = { viewport: DEFAULT_VIEWPORT, rafPending: false, viewPending: false, scrollLeft: 0 };
    _layout = { restoreFocus: false, focusEditor: false, sortInitialised: false, gridId: 'rh-grid-' + ++idCounter };
    _memo = {};
    _timing = { firstRow: false, fullRender: false, sort: false, commit: false, key: false };
    _clip = { copy: null, pastePending: false, token: 0 };
    // Ctrl+Enter in an open editor, read on the window while one is open (onBulkKey).
    _bulk = { all: false, onKey: null, timer: null };
    // The focused cell, { rowId, field }; cells changed in place; and the range's
    // corners, the range as the page shows it, and the live region's text when
    // changed in place (see focusKey and setRange).
    _nav = { focus: null, patched: new Map(), rangeAnchor: null, rangeFocus: null, shaded: null, rangeQueued: false };
    // What the live region says (see announcement).
    _live = { text: '', written: false };

    @api
    get config() {
        return this._config;
    }
    set config(value) {
        // HR-17: assign the reference. No spread, no slice, no map — a clone here
        // would hide the parent's next change from this component for good.
        this._config = value || {};
        // Capture focus intent NOW, while the focused cell is still in the DOM.
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        if (!this._layout.sortInitialised && value && Array.isArray(value.sort)) {
            this._layout.sortInitialised = true;
            this.sortKeys = value.sort.map(s => ({
                field: s.field,
                direction: s.direction === 'desc' ? 'desc' : 'asc'
            }));
        }
        // A new selectionKey from the parent clears the row selection: after a
        // reload or a delete the selected rows are gone or different.
        const key = value ? value.selectionKey : undefined;
        if (key !== this._layout.selectionKey) {
            this._layout.selectionKey = key;
            if (Object.keys(this.selected).length) this.selected = {};
        }
        // The Group column coming or going changes the table's width. Widths
        // pinned only to freeze columns are measured again, so the table fills
        // the grid; widths the user chose are kept (found in Lightning
        // Experience: ungrouping left a 220px gap at the right).
        const grouped = this.isGrouped;
        if (
            this._layout.grouped !== undefined &&
            grouped !== this._layout.grouped &&
            this.widthsPinned &&
            !this._layout.userResized
        ) {
            this.widths = {};
            this.widthsPinned = false;
        }
        this._layout.grouped = grouped;
        this.applyLayout(value ? value.userLayout : null);
        // The user's own columns changed: what was in a hidden column moves on.
        const choice = (value && value.columnChoice) || null;
        if (this._layout.choiceSeen && choice !== this._layout.columnChoice) this.columnsChanged();
        this._layout.choiceSeen = true;
        this._layout.columnChoice = choice;
        // A row to focus: the one New just added, or a record just created.
        const focusRow = value ? value.focusRow : null;
        if (focusRow && focusRow.seq !== this._layout.focusRowSeq) {
            this._layout.focusRowSeq = focusRow.seq;
            this._layout.focusRowId = focusRow.id;
        }
    }

    /**
     * Columns shown, hidden or moved. Focus in a column no longer
     * shown goes to the first one shown; a range no longer means the same
     * cells; a menu or filter on a hidden column closes. Widths pinned only
     * to freeze columns are measured again, so the table fills the grid;
     * widths the user chose are kept.
     */
    columnsChanged() {
        const shown = new Set(this.shownColumns.map(c => c.field));
        const focus = this._nav.focus;
        if (
            focus &&
            focus.field !== DETAIL_FIELD &&
            !shown.has(focus.field) &&
            this.columns.some(c => c.field === focus.field)
        ) {
            const first = this.shownColumns[0];
            this._nav.focus = first ? { rowId: focus.rowId, field: first.field } : null;
            this.focusRev++;
        }
        this.rangeAnchor = null;
        this.rangeFocus = null;
        if (this.menuOpenFor !== null && !shown.has(this.menuOpenFor) && this.menuOpenFor !== GROUP_FIELD)
            this.menuOpenFor = null;
        if (this.filterOpenFor !== null && !shown.has(this.filterOpenFor)) this.filterOpenFor = null;
        if (this.widthsPinned && !this._layout.userResized) {
            this.widths = {};
            this.widthsPinned = false;
        }
    }

    /**
     * The user's saved layout, once per key: widths the user set,
     * Wrap or Clip, open rows and the sort. A layout with no widths (Reset
     * layout) puts the columns back as the admin set them.
     */
    applyLayout(layout) {
        if (!layout || layout.key === undefined || layout.key === this._layout.layoutKey) return;
        this._layout.layoutKey = layout.key;
        const known = new Set(this.columns.map(c => c.field).concat([GROUP_FIELD]));
        const widths = {};
        Object.keys(layout.widths || {}).forEach(f => {
            const w = Math.round(Number(layout.widths[f]));
            if (known.has(f) && Number.isFinite(w)) widths[f] = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, w));
        });
        if (Object.keys(widths).length) {
            this.widths = widths;
            this.widthsPinned = true;
            this._layout.userResized = true;
        } else {
            this.widths = {};
            this.widthsPinned = false;
            this._layout.userResized = false;
        }
        const wrap = {};
        Object.keys(layout.wrap || {}).forEach(f => {
            if (known.has(f)) wrap[f] = layout.wrap[f] === true;
        });
        this.wrapOverrides = wrap;
        // The columns the user froze; null for the admin's Frozen Columns (and after Reset layout).
        const frozen = Number(layout.frozen);
        this.userFrozen =
            layout.frozen !== null && layout.frozen !== undefined && Number.isInteger(frozen) && frozen >= 0
                ? Math.min(frozen, MAX_FROZEN)
                : null;
        const expanded = {};
        (Array.isArray(layout.expanded) ? layout.expanded : []).slice(0, MAX_OPEN_ROWS).forEach(id => {
            if (typeof id === 'string' && RECORD_ID.test(id)) expanded[id] = true;
        });
        this.expanded = expanded;
        // The groups' order and percentages; by name, without, after Reset layout.
        const gv = layout.groupView && typeof layout.groupView === 'object' ? layout.groupView : {};
        this.groupView = { order: normalizeOrder(gv.order, this.columns), percent: gv.percent === true };
        // The sort it starts with, or the admin's after Reset layout.
        if (Array.isArray(layout.sort)) {
            const sortable = new Set(this.columns.filter(c => c.sortable !== false).map(c => c.field));
            this.sortKeys = layout.sort
                .filter(k => k && sortable.has(k.field))
                .map(k => ({ field: k.field, direction: k.direction === 'desc' ? 'desc' : 'asc' }));
        }
    }

    /**
     * Tell the parent what to keep of the layout: the widths only once
     * the user has set one (pinning alone is not a choice), Wrap or Clip, and
     * the open rows, at most MAX_OPEN_ROWS.
     */
    emitLayout() {
        const widths = this._layout.userResized ? { ...this.widths } : null;
        const gv = this.groupView;
        this.dispatchEvent(
            new CustomEvent('layoutchange', {
                detail: {
                    widths,
                    wrap: { ...this.wrapOverrides },
                    expanded: Object.keys(this.expanded).slice(0, MAX_OPEN_ROWS),
                    groupView: { order: { ...gv.order }, percent: gv.percent },
                    frozen: this.userFrozen
                }
            })
        );
    }

    /**
     * The grid around the table changed the table's room (Charts opened or
     * closed beside it). Under Lightning Locker there is no ResizeObserver,
     * so the window's resize is all the table hears of its own width (HR-23),
     * and a panel opening beside it is not one: the parent says so here. The
     * width is measured in the next frame, after the parent's layout (HR-20).
     * Found in Lightning Experience under Locker: with a frozen column, the
     * table kept its width when Charts opened, and the grid scrolled sideways.
     */
    @api
    measureWidth() {
        if (this._measurements.viewPending) return;
        this._measurements.viewPending = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- measured after the parent's layout (HR-20)
        requestAnimationFrame(() => {
            this._measurements.viewPending = false;
            this.measureView();
        });
    }

    /** Re-entering the grid lands on the last focused cell, not the first. */
    @api
    focus() {
        const el = this.cellElement(this.focusKey || this.defaultFocusKey());
        if (el) el.focus();
    }

    // ============================================================ columns

    get columns() {
        return Array.isArray(this._config.columns) ? this._config.columns : [];
    }

    /**
     * The columns drawn, in the user's order, without the ones they hid.
     * `columns` stays every column: a hidden one can still be sorted,
     * filtered or grouped by, and its label is still needed for those.
     */
    get shownColumns() {
        const m = this._memo;
        if (m.shownFrom !== this._config.columns || m.shownChoice !== this._config.columnChoice) {
            m.shownFrom = this._config.columns;
            m.shownChoice = this._config.columnChoice;
            m.shown = shownColumns(this.columns, this._config.columnChoice);
        }
        return m.shown;
    }

    get keyField() {
        return this._config.keyField || 'Id';
    }

    get hasSelection() {
        return this._config.selection === 'multi' || this._config.selection === 'single';
    }

    get isMulti() {
        return this._config.selection === 'multi';
    }

    /** The actions in each row's menu, [{ name, label }]. */
    get rowActions() {
        return Array.isArray(this._config.rowActions) ? this._config.rowActions : [];
    }

    get hasRowActions() {
        return this.rowActions.length > 0;
    }

    /**
     * Records not saved yet, from the grid's New button: shown first, above
     * every group, in the order they were added, and not sorted, grouped,
     * numbered or selectable until they are saved. Their cells are filled in
     * where the column is `creatable`, not `editable`.
     */
    get newRows() {
        return Array.isArray(this._config.newRows) ? this._config.newRows : NO_NEW_ROWS;
    }

    /** The new rows' Ids, made once per list. */
    get newRowIds() {
        const m = this._memo;
        if (m.newIdsFrom !== this.newRows) {
            m.newIdsFrom = this.newRows;
            m.newIds = new Set(this.newRows.map(r => String(r[this.keyField])));
        }
        return m.newIds;
    }

    isNewRow(rowId) {
        const ids = this.newRowIds;
        return ids.size > 0 && ids.has(String(rowId));
    }

    /**
     * Can this cell be edited? A saved record's where its column is
     * editable; a new row's where the user may set the field on a new record.
     */
    canEditCell(column, rowId) {
        if (!column) return false;
        if (this.isNewRow(rowId)) return column.creatable === true;
        return column.editable === true && (!column.isPath || reachesParent(this.view[this.positionOf(rowId)], column));
    }

    /** Rows numbered down the left edge, as a list view's are. Cards have none. */
    get showRowNumbers() {
        return this._config.rowNumbers === true;
    }

    /**
     * The row-number/error column, SLDS's first column: shown when the rows
     * are numbered, or a row has errors to show.
     */
    get hasRowStatus() {
        if (this.showRowNumbers) return true;
        const errors = this._config.errors || {};
        const m = this._memo;
        if (m.statusErrors !== errors) {
            m.statusErrors = errors;
            m.hasRowStatus = Object.keys(errors).some(id => errors[id] && errors[id].row);
        }
        return m.hasRowStatus;
    }

    /**
     * Every rendered column in order, with its 1-based column index. Leading
     * utility columns (row status, selection) come first. Focus is keyed by
     * field, not index, so a status column appearing does not move focus.
     *
     * Built once for each change to what it is made of, and the same list
     * handed out until then: until a cell has focus every cell asks for it
     * while the table is drawn, and each build copies every column. Rebuilt
     * on every read, 20 columns made loading 10,000 rows about four times
     * slower than 5. Nothing changes the list or
     * its columns after it is built.
     */
    get layoutColumns() {
        const deps = [
            this._config.columns,
            this._config.columnChoice,
            this.wrapOverrides,
            this.hasRowStatus,
            this.showRowNumbers,
            this.hasSelection,
            this.hasChildren,
            this.isGrouped,
            this.hasRowActions
        ];
        const m = this._memo;
        if (m.layoutDeps && m.layoutDeps.every((d, i) => d === deps[i])) return m.layoutColumns;
        const list = [];
        if (this.hasRowStatus) {
            list.push({ field: STATUS_FIELD, utility: true, label: this.showRowNumbers ? 'Row number' : 'Row status' });
        }
        if (this.hasSelection) list.push({ field: SELECT_FIELD, utility: true, label: 'Choose a row' });
        if (this.hasChildren) list.push({ field: EXPAND_FIELD, utility: true, label: 'Related records' });
        if (this.isGrouped) list.push({ field: GROUP_FIELD, utility: true, label: 'Group' });
        this.shownColumns.forEach(c => list.push(c));
        // The row's actions come last, as a list view's do.
        if (this.hasRowActions) list.push({ field: ACTIONS_FIELD, utility: true, label: 'Actions' });
        m.layoutDeps = deps;
        m.layoutColumns = list.map((c, i) => ({
            ...c,
            colIndex: i + 1,
            wrappable: this.isWrappable(c),
            wrapped: this.isWrapped(c)
        }));
        return m.layoutColumns;
    }

    isWrappable(c) {
        return !c.utility && WRAPPABLE_TYPES.has(c.type || 'text');
    }

    /** The header menu's choice for this session, else the admin default. */
    isWrapped(c) {
        if (!this.isWrappable(c)) return false;
        return has(this.wrapOverrides, c.field) ? this.wrapOverrides[c.field] : c.wrap === true;
    }

    get tableClass() {
        const wraps = this.shownColumns.some(c => this.isWrapped(c));
        return (
            'slds-table slds-table_bordered slds-table_fixed-layout slds-table_resizable-cols slds-table_edit slds-no-cell-focus' +
            (wraps ? ' rh-table_wrap' : '') +
            // Child grids' dialogs must escape this table (see gridTable.css).
            (this.hasChildren ? ' rh-table_parent' : '') +
            // Grouped, the checkbox column draws its own edge (see gridTable.css).
            (this.isGrouped ? ' rh-table_grouped' : '')
        );
    }

    /**
     * Before any resize the table fills the grid and the browser shares the
     * space out. After one, it is exactly the sum of its column widths, so
     * every column renders at the width it was given (see pinWidths).
     */
    get tableStyle() {
        const total = this.layoutColumns.reduce((sum, c) => sum + this.columnWidth(c), 0);
        // The lines a wrapped row shows, for .rh-wrap-text.
        const lines = `--rh-wrap-lines:${this.wrapLines}`;
        // Pinned, the table is exactly its columns. Before that it fills the
        // grid, but is never narrower than its columns: it scrolls sideways
        // rather than squeeze a figure.
        return `${this.widthsPinned ? 'width' : 'min-width'}:${total}px;${lines}`;
    }

    /**
     * px: a column's width. A width the user dragged wins; otherwise the
     * admin's, but never below what the column's type needs, and for numbers
     * and dates never below their widest loaded value.
     */
    columnWidth(c) {
        if (c.field === SELECT_FIELD) return SELECT_WIDTH;
        if (c.field === STATUS_FIELD) return this.statusWidth;
        if (c.field === EXPAND_FIELD) return EXPAND_WIDTH;
        if (c.field === ACTIONS_FIELD) return ACTIONS_WIDTH;
        if (c.field === GROUP_FIELD) return this.widths[GROUP_FIELD] || GROUP_WIDTH;
        if (this.widths[c.field]) return this.widths[c.field];
        const fitted = this.fittedWidths[c.field] || 0;
        const base = c.width || (fitted ? 0 : DEFAULT_WIDTH);
        return Math.max(base, fitted, minWidthFor(c.type));
    }

    /**
     * px: the row-number/error column's width. A list view's 3.25rem holds an
     * error button and numbers of up to three digits; more digits widen it.
     * Sized for every matching row the grid will load, not just those loaded
     * so far, so the columns don't shift right as more rows arrive.
     */
    get statusWidth() {
        if (!this.showRowNumbers) return STATUS_WIDTH;
        const loaded = Array.isArray(this._config.rows) ? this._config.rows.length : 0;
        const total = Math.min(Math.max(Number(this._config.totalRows) || 0, 0), MAX_NUMBERED);
        const last = Math.max(loaded, total);
        return Math.max(STATUS_WIDTH, NUMBER_LEFT + NUMBER_DIGIT * String(last).length);
    }

    /** An editable grid keeps room for the edit button in every cell. */
    get editableGrid() {
        return this.columns.some(c => c.editable);
    }

    /**
     * Up to FIT_SAMPLE of a column's values, the longest by stored text: the
     * widest when shown, for a number or a date, without formatting every row.
     * Unsaved edits count.
     */
    longestValues(c) {
        return this.longestByColumn([c])[0];
    }

    /**
     * longestValues for several columns in one pass over the rows: each row's
     * key and unsaved edits are looked up once, not once per column, and the
     * edits not at all when there are none. At 10,000 rows and nine number and
     * date columns, a pass per column cost about 60ms for every page loaded
     * and every edit.
     */
    longestByColumn(cols) {
        const rows = Array.isArray(this._config.rows) ? this._config.rows : [];
        const drafts = this._config.drafts || {};
        const withDrafts = Object.keys(drafts).length > 0;
        const keyField = this.keyField;
        const fields = cols.map(c => c.field);
        const tops = cols.map(() => []);
        for (const row of rows) {
            const d = withDrafts ? drafts[row[keyField]] : undefined;
            for (let j = 0; j < fields.length; j++) {
                const f = fields[j];
                const v = d && has(d, f) ? d[f] : row[f];
                if (isBlank(v)) continue;
                const top = tops[j];
                const len = String(v).length;
                if (top.length < FIT_SAMPLE) top.push({ v, len });
                else if (len > top[top.length - 1].len) top[top.length - 1] = { v, len };
                else continue;
                top.sort((a, b) => b.len - a.len);
            }
        }
        return tops.map(top => top.map(t => t.v));
    }

    /** A value as its cell shows it: a lookup by name, anything else formatted. */
    shownText(v, c) {
        return isLookup(c.type) ? lookupText(v, this._config.refNames || {}) : formatValue(v, c);
    }

    /**
     * { [field]: px }: each number and date column fitted to its widest loaded
     * value, and to its whole-list subtotal, up to FIT_CAP. Memoised on
     * what it reads.
     */
    get fittedWidths() {
        const m = this._memo;
        const totals = this.shownTotals;
        const deps = [this._config.rows, this._config.columns, this._config.drafts, totals, this._config.refNames];
        if (m.fitDeps && m.fitDeps.every((d, i) => d === deps[i])) return m.fitted;
        const editable = this.editableGrid;
        const out = {};
        const fitted = this.columns.filter(c => fitsToValues(c.type));
        const longest = this.longestByColumn(fitted);
        fitted.forEach((c, i) => {
            const texts = longest[i].map(v => this.shownText(v, c));
            const sub = totals && totals.total ? subtotalFor(totals.total, c) : null;
            if (sub && sub.text) texts.push(SUBTOTAL_SHORT[sub.kind] + ' ' + sub.text);
            out[c.field] = fitWidth(texts, { type: c.type, editable, label: c.label || c.field });
        });
        m.fitDeps = deps;
        m.fitted = out;
        return out;
    }

    /** px: the width a column is drawn at: its own, or its share of the room over. */
    drawnWidth(c) {
        const shared = this.sharedWidths;
        return (shared && shared[c.field]) || this.columnWidth(c);
    }

    /**
     * Lines, 1 to 3, that a wrapped row shows: what the longest wrapped value
     * needs at its column's width, or more when a drawn cell turned out to
     * need more (wrapMin). Every row keeps this one height.
     */
    get wrapLines() {
        const wrapped = this.shownColumns.filter(c => this.isWrapped(c));
        if (!wrapped.length) return MAX_LINES;
        const m = this._memo;
        const deps = [
            this._config.rows,
            this.shownColumns,
            this._config.drafts,
            this.wrapOverrides,
            this.widths,
            this.viewWidth,
            this.widthsPinned,
            this.wrapMin,
            this._config.refNames
        ];
        if (m.wrapDeps && m.wrapDeps.every((d, i) => d === deps[i])) return m.wrapLines;
        const rows = Array.isArray(this._config.rows) ? this._config.rows : [];
        const drafts = this._config.drafts || {};
        const editable = this.editableGrid;
        let lines = 1;
        for (const c of wrapped) {
            const texts = rows.map(row => {
                const d = drafts[row[this.keyField]];
                const v = d && has(d, c.field) ? d[c.field] : row[c.field];
                return isBlank(v) ? '' : this.shownText(v, c);
            });
            lines = Math.max(lines, linesNeeded(texts, this.drawnWidth(c), { editable }));
            if (lines >= MAX_LINES) break;
        }
        m.wrapDeps = deps;
        m.wrapLines = Math.min(MAX_LINES, Math.max(lines, this.wrapMin));
        return m.wrapLines;
    }

    /**
     * Before any resize, when every data column has a width and together they
     * leave room over: { [field]: px } sharing that room out among the data
     * columns, in proportion to their widths. Left to itself, a fixed-layout
     * table shares it among EVERY column, so the checkbox column stretched too
     * (52px became 248px in a two-column child table, found in Lightning
     * Experience). Every data column has a width now, so
     * this applies whenever there is room over; null until the grid's width
     * is measured. The table's borders are not room: shared out, they made
     * the table 2px too wide, and a two-row grid scrolled sideways by that
     * much.
     */
    get sharedWidths() {
        if (this.widthsPinned || !this.viewWidth) return null;
        const cols = this.layoutColumns;
        const data = cols.filter(c => !c.utility);
        if (!data.length) return null;
        const fixed = cols.filter(c => c.utility).reduce((sum, c) => sum + this.columnWidth(c), 0);
        const wanted = data.reduce((sum, c) => sum + this.columnWidth(c), 0);
        const room = this.viewWidth - fixed - TABLE_BORDERS;
        if (room <= wanted) return null;
        const out = {};
        data.forEach(c => {
            out[c.field] = Math.floor((this.columnWidth(c) * room) / wanted);
        });
        return out;
    }

    columnByField(field) {
        return this.columns.find(c => c.field === field);
    }

    get ariaColCount() {
        return this.layoutColumns.length;
    }

    /** Column index of the first data column (after row status, selection, the toggle and the Group column). */
    get firstDataCol() {
        return (
            (this.hasRowStatus ? 1 : 0) +
            (this.hasSelection ? 1 : 0) +
            (this.hasChildren ? 1 : 0) +
            (this.isGrouped ? 1 : 0) +
            1
        );
    }

    // ============================================================ child tables

    /** The tabs of related records under each row: [{ name, label, configName }]. */
    get childTabs() {
        return Array.isArray(this._config.children) ? this._config.children : [];
    }

    get hasChildren() {
        return this.childTabs.length > 0;
    }

    /** This table's level: 1 at the top, 2 or 3 for a child table. */
    get level() {
        const level = Number(this._config.level);
        return Number.isInteger(level) && level > 0 ? level : 1;
    }

    /** The level of this table's child tables: one deeper than its own. */
    get childLevel() {
        return this.level + 1;
    }

    /** px: the most an open row's panel may be in this table: by its level, or its tabs' Heights. */
    get panelHeight() {
        return panelMax(this.level, this.childTabs);
    }

    /** px: one open row's panel: its measured content, up to the panel's maximum. */
    panelHeightOf(rowId) {
        return panelHeightFor(this.panelSizes[rowId], this.level, this.panelHeight);
    }

    /** px: the open rows' panels, in the order of detailRows, for the windowing arithmetic. */
    get detailHeights() {
        if (!this.detailRows.length) return [];
        const m = this._memo;
        const view = this.view;
        if (m.heightsView === view && m.heightsSizes === this.panelSizes) return m.heights;
        m.heightsView = view;
        m.heightsSizes = this.panelSizes;
        m.heights = this.detailRows.map(i => this.panelHeightOf(view[i].__detail.rowId));
        return m.heights;
    }

    /** { total, byTab } for a record, from the server, or null when not known. */
    childCountsOf(rowId) {
        const counts = this._config.childCounts;
        return (counts && counts[rowId]) || null;
    }

    /**
     * Does a row offer its toggle? When it is open, or has related records.
     * A row whose count is still on the way offers none: offered
     * until then, every row showed a chevron that most rows then lost a
     * moment later. With no
     * counts asked for, or when they could not be fetched, every row offers
     * it: better an empty panel than no way in.
     */
    offersToggle(open, counts) {
        if (open) return true;
        if (counts) return counts.total > 0;
        return !this._config.childCounts || this._config.childCountsFailed === true;
    }

    /** Positions of the detail rows in the view, in order. */
    get detailRows() {
        return this.view ? this._memo.detailRows || [] : [];
    }

    /** Rows of the view that are records or groups, not detail rows. */
    get recordRowCount() {
        return this.rowCount - this.detailRows.length;
    }

    /** px from the top of the first row to the top of row `index` (0-based). */
    rowTopOf(index) {
        return rowTop(index, this.rowHeight, this.detailRows, this.detailHeights);
    }

    /** The row at `px` from the top of the first row. */
    rowAtOffset(px) {
        return rowAt(px, this.rowCount, this.rowHeight, this.detailRows, this.detailHeights);
    }

    /** The open row's name, for labels: its first column, as shown. */
    rowName(row) {
        const first = this.shownColumns[0];
        const names = this._config.refNames || {};
        if (!first || !row) return '';
        const value = row[first.field];
        return isLookup(first.type) ? lookupText(value, names) : formatValue(value, first, row);
    }

    handleExpandClick(event) {
        event.stopPropagation();
        this.toggleExpand(event.currentTarget.dataset.rowId);
    }

    /** The records in hand that offer their toggle, in display order, closed groups included. */
    get openableRows() {
        return this.sortedRows.filter(row => {
            const id = String(row[this.keyField]);
            return this.offersToggle(Boolean(this.expanded[id]), this.childCountsOf(id));
        });
    }

    /** Is every row that has related records open? Then the header's button closes them all. */
    get allOpen() {
        const rows = this.openableRows;
        return rows.length > 0 && rows.slice(0, MAX_OPEN_ALL).every(row => this.expanded[String(row[this.keyField])]);
    }

    /**
     * Open every row's related records, or close them all: the button
     * in the toggle column's header, or Enter or Space on that header. Only
     * the rows loaded now with related records, at most MAX_OPEN_ALL; a child
     * grid still loads only when its panel is drawn (the windowing), so
     * opening many rows costs nothing until they are scrolled to.
     */
    toggleAll() {
        if (!this.hasChildren || this.isCards) return;
        const rows = this.openableRows;
        if (!rows.length) {
            this.announcement = 'No row has related records.';
            return;
        }
        const closing = this.allOpen;
        const next = {};
        if (!closing)
            rows.slice(0, MAX_OPEN_ALL).forEach(row => {
                next[String(row[this.keyField])] = true;
            });
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        this.setRange(null, null);
        const k = this.focusKey;
        if (closing && k && k.rowId !== HEADER && String(k.rowId).startsWith(detailId(''))) {
            this.focusKey = { rowId: String(k.rowId).slice(detailId('').length), field: EXPAND_FIELD };
        }
        this.expanded = next;
        const n = Object.keys(next).length;
        this.announcement = closing
            ? 'Hid related records for every row'
            : `Showing related records for ${n} ${n === 1 ? 'row' : 'rows'}` +
              (rows.length > MAX_OPEN_ALL ? `, the first ${MAX_OPEN_ALL} with any` : '');
        this.emitLayout();
    }

    handleExpandAll(event) {
        event.stopPropagation();
        this.toggleAll();
    }

    /** Open or close one row's child tables. Focus inside a panel that closes moves to its toggle. */
    toggleExpand(rowId) {
        if (!rowId || !this.hasChildren || this.groupHeaderFor(rowId) || this.positionOf(rowId) < 0) return;
        const opening = !this.expanded[rowId];
        const counts = this.childCountsOf(rowId);
        if (opening && counts && counts.total === 0) {
            this.announcement = 'No related records.'; // the toggle is hidden; this is the keyboard's answer
            return;
        }
        const next = { ...this.expanded };
        if (opening) next[rowId] = true;
        else delete next[rowId];
        // In cards the toggle keeps focus by itself: it is the same button after the render.
        if (!this.isCards) this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        this.setRange(null, null); // positions below the row change
        this.expanded = next;
        const k = this.focusKey;
        if (!opening && k && k.rowId === detailId(rowId)) this.focusKey = { rowId, field: EXPAND_FIELD };
        const row = this.view.find(r => String(r[this.keyField]) === rowId) || null;
        const name = this.rowName(row);
        this.announcement = `${opening ? 'Showing' : 'Hid'} related records${name ? ' for ' + name : ''}`;
        this.emitLayout();
    }

    /**
     * True for an event from inside an open row's panel: a child grid's own
     * key, click, focus or clipboard event, retargeted to the panel's host as
     * it bubbles through this table's root. It is the child's, not this table's.
     */
    fromChild(event) {
        const cell = this.closestCell(event.target);
        return Boolean(cell) && cell.dataset.field === DETAIL_FIELD && event.target !== cell;
    }

    columnAt(colIndex) {
        const c = this.layoutColumns[colIndex - 1];
        return c && !c.utility ? c : null;
    }

    // ============================================================ range

    /**
     * The selected rectangle in view positions, 1-based and inclusive:
     * { top, bottom, left, right }, or null when only one cell is selected. The
     * anchor must still be in the view; a range never includes the header or
     * a utility column.
     */
    get range() {
        if (!this.rangeActive || this.focusKey.rowId === HEADER) return null;
        if (this.positionOf(this.rangeAnchor.rowId) < 0) return null;
        const a = this.positionOfKey(this.rangeAnchor);
        const f = this.positionOfKey(this.focusKey);
        if (a.row < 1 || f.row < 1 || (a.row === f.row && a.col === f.col)) return null;
        return {
            top: Math.min(a.row, f.row),
            bottom: Math.max(a.row, f.row),
            left: Math.max(this.firstDataCol, Math.min(a.col, f.col)),
            right: Math.max(a.col, f.col)
        };
    }

    /**
     * A range lasts only while focus stays on the corner it was extended to.
     * If focus reached another cell some other way (Tab back into the grid, a
     * screen reader moving focus, a script), the old anchor no longer means
     * anything, and the next Shift+arrow starts a new range from where focus is.
     */
    get rangeActive() {
        const a = this.rangeAnchor;
        const f = this.rangeFocus;
        const k = this.focusKey;
        return Boolean(a && f && k) && f.rowId === k.rowId && f.field === k.field;
    }

    /** The fixed corner of the selected range, { rowId, field }, or null. Not reactive: see setRange. */
    get rangeAnchor() {
        return this._nav.rangeAnchor;
    }
    set rangeAnchor(value) {
        this._nav.rangeAnchor = value;
    }

    /** The focused corner when the range was last set; see rangeActive. */
    get rangeFocus() {
        return this._nav.rangeFocus;
    }
    set rangeFocus(value) {
        this._nav.rangeFocus = value;
    }

    /**
     * Set the range's two corners; focus goes to `corner`. The corners are
     * kept outside LWC's reactivity, as focus is: a Shift+arrow used
     * to redraw the whole table, about 140ms on Consignments' 1,000 cells
     * (measured in Lightning). Once the handler that set them is
     * done, and focus has moved with it, the cells whose shading changed are
     * changed in place (patchRange), or the table is redrawn where that cannot
     * be done.
     */
    setRange(anchor, corner) {
        this._nav.rangeAnchor = anchor ? { ...anchor } : null;
        this._nav.rangeFocus = corner ? { ...corner } : null;
        if (this._nav.rangeQueued) return;
        this._nav.rangeQueued = true;
        Promise.resolve().then(() => {
            this._nav.rangeQueued = false;
            if (!this.patchRange()) this.focusRev++;
        });
    }

    /**
     * Shade the cells of the range now in place, and unshade those that
     * left it: their rh-in-range class and aria-selected, from the range
     * the page shows (_nav.shaded, set by each drawing) to the range now.
     * Returns false, for a redraw instead, when the table is not navigating,
     * shows cards, or a cell that changes is not drawn (windowing) or the
     * change is very large.
     */
    patchRange() {
        const prev = this._nav.shaded || null;
        const next = this.range;
        if (sameRect(prev, next)) return true;
        if (this.isCards || this.mode !== MODE_NAVIGATION || this.editing) return false;
        const box = boundingRect(prev, next);
        if ((box.bottom - box.top + 1) * (box.right - box.left + 1) > MAX_RANGE_PATCH) return false;
        const changes = [];
        for (let row = box.top; row <= box.bottom; row++) {
            const record = this.view[row - 1];
            if (!record || record.__group || record.__detail) continue; // never shaded
            for (let col = box.left; col <= box.right; col++) {
                const wanted = inRect(next, row, col);
                if (wanted === inRect(prev, row, col)) continue;
                const column = this.layoutColumns.find(c => c.colIndex === col);
                if (!column) continue;
                const el = this.cellElement({ rowId: String(record[this.keyField]), field: column.field });
                if (!el) return false; // not drawn: the redraw draws it
                changes.push({ el, wanted });
            }
        }
        changes.forEach(({ el, wanted }) => this.setCellRange(el, wanted));
        this._nav.shaded = next;
        return true;
    }

    /** Shade one cell as in the range, or not, in place; remembered as setCellFocus does. */
    setCellRange(el, inRange) {
        this.rememberCell(el);
        if (inRange) {
            el.classList.add('rh-in-range');
            el.setAttribute('aria-selected', 'true');
        } else {
            el.classList.remove('rh-in-range');
            el.removeAttribute('aria-selected');
        }
        this.forgetIfDrawn(el);
    }

    /** The range, or the focused data cell as a one-cell rectangle. */
    get selectionRect() {
        const r = this.range;
        if (r) return r;
        const key = this.focusKey || this.defaultFocusKey();
        if (!key || key.rowId === HEADER) return null;
        const p = this.positionOfKey(key);
        if (p.row < 1 || p.col < this.firstDataCol) return null;
        return { top: p.row, bottom: p.row, left: p.col, right: p.col };
    }

    announceRange() {
        const r = this.range;
        if (!r) return;
        const rows = r.bottom - r.top + 1;
        const cols = r.right - r.left + 1;
        this.announceInPlace(
            `${rows} ${rows === 1 ? 'row' : 'rows'} by ${cols} ${cols === 1 ? 'column' : 'columns'} selected`
        );
    }

    announceInPlace(text) {
        this.announcement = text;
    }

    /**
     * What the grid says to screen readers, in its live region. Written to the
     * region directly (lwc:dom="manual"), not drawn: saying something must not
     * redraw the table, and a redraw must not take back what was just
     * said. Saying the same words again empties the region first, so they are
     * heard again.
     */
    get announcement() {
        return this._live.text;
    }
    set announcement(text) {
        this._live.text = text == null ? '' : String(text);
        this.writeLive();
    }

    writeLive() {
        const region = this.template.querySelector('.rh-table-live');
        if (!region) return; // written once the table is drawn (renderedCallback)
        const text = this._live.text;
        if (region.textContent === text) region.textContent = '';
        region.textContent = text;
        this._live.written = true;
    }

    // ============================================================ frozen columns

    /** The data columns frozen: the user's choice (Freeze up to this column), else the admin's. */
    get frozenCount() {
        const n = this.userFrozen !== null ? this.userFrozen : Number(this._config.frozenColumns);
        return Number.isInteger(n) && n > 0 && !this.isCards ? Math.min(n, MAX_FROZEN) : 0;
    }

    /** A column's place among the data columns as shown, from 1; 0 when it is not one. */
    dataPosition(field) {
        return this.layoutColumns.filter(c => !c.utility).findIndex(c => c.field === field) + 1;
    }

    /**
     * { [field]: { left, z, last } } for the frozen columns (the utility
     * columns, then the first frozenColumns data columns), or null. Offsets
     * come from the pinned widths, so nothing is frozen until they are pinned.
     * Earlier columns get the higher z-index, so each column's resize handle,
     * which overhangs the next column, stays on top of it.
     */
    get frozenOffsets() {
        if (!this.frozenCount || !this.widthsPinned) return null;
        const frozen = [];
        let data = 0;
        for (const c of this.layoutColumns) {
            if (!c.utility) {
                if (data >= this.frozenCount) break;
                data++;
            }
            frozen.push(c);
        }
        const out = {};
        let left = 0;
        frozen.forEach((c, i) => {
            out[c.field] = { left, z: 2 + frozen.length - i, last: i === frozen.length - 1 };
            left += this.columnWidth(c);
        });
        return out;
    }

    // ============================================================ grouping

    /** The grouping, checked against the columns; the same array until either changes. */
    get grouping() {
        const m = this._memo;
        if (m.groupingRaw !== this._config.grouping || m.groupingColumns !== this._config.columns) {
            m.groupingRaw = this._config.grouping;
            m.groupingColumns = this._config.columns;
            m.grouping = normalizeGrouping(this._config.grouping, this.columns);
        }
        return m.grouping;
    }

    get isGrouped() {
        return this.grouping.length > 0;
    }

    /** The server's counts and subtotals, once they have arrived. */
    get groupTotals() {
        const s = this._config.groupSummary;
        return s && s.status === 'ready' && s.totals ? s.totals : null;
    }

    /**
     * The counts and subtotals shown: the server's with the unsaved edits
     * added in (c/gridGroups withDrafts). The same object until what it
     * is made of changes; the server's own when no edit moves a subtotal.
     */
    get shownTotals() {
        const totals = this.groupTotals;
        if (!totals) return null;
        const m = this._memo;
        const deps = [
            totals,
            this._config.drafts,
            this._config.rows,
            this.grouping,
            this._config.columns,
            this.hasMoreRows,
            this._config.fiscal
        ];
        if (m.shownDeps && m.shownDeps.every((d, i) => d === deps[i])) return m.shownTotals;
        m.shownDeps = deps;
        m.shownTotals = totalsWithDrafts(totals, this._config.rows, this._config.drafts, this.grouping, this.columns, {
            keyField: this.keyField,
            fiscal: this._config.fiscal || null,
            complete: !this.hasMoreRows
        });
        return m.shownTotals;
    }

    /** A group's header, or null when the row is a record. */
    groupHeaderFor(rowId) {
        // Reading the view refreshes the memo, headers included.
        return this.view && this._memo.headers ? this._memo.headers.get(String(rowId)) || null : null;
    }

    get tableRole() {
        return this.isGrouped ? 'treegrid' : 'grid';
    }

    /**
     * The grouping as chips above the table: each level's column (and a
     * date's unit), with a button that stops grouping by it. The Group
     * column's header was too narrow to say it.
     */
    get groupChips() {
        if (!this.isGrouped) return null;
        return this.grouping.map((l, i) => {
            const col = this.columnByField(l.field) || {};
            const name = col.label || l.field;
            return {
                key: l.field,
                field: l.field,
                label: name + (l.unit ? ` (by ${UNIT_LABELS[l.unit].toLowerCase()})` : ''),
                removeLabel: `Stop grouping by ${name}`,
                showArrow: i > 0
            };
        });
    }

    handleChipRemove(event) {
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        this.changeGrouping('remove', event.currentTarget.dataset.field);
    }

    handleClearGrouping() {
        this.changeGrouping('ungroup');
    }

    // ============================================================ view (sort)

    /**
     * Rows in display order, with each group's header row when grouped.
     * Memoised on everything it is built from.
     */
    get view() {
        const rows = Array.isArray(this._config.rows) ? this._config.rows : [];
        const sortSig = this.sortKeys.map(k => k.field + ':' + k.direction).join('|');
        const names = this._config.refNames;
        const levels = this.grouping;
        const totals = this.shownTotals;
        const collapsed = this.collapsed;
        const expanded = this.hasChildren ? this.expanded : null;
        const order = this.groupView.order;
        const fiscal = this._config.fiscal || null;
        const numbered = this.showRowNumbers;
        const newRows = this.newRows;
        const m = this._memo;
        if (
            m.newRows === newRows &&
            m.rows === rows &&
            m.sortSig === sortSig &&
            m.columns === this._config.columns &&
            m.names === names &&
            m.levels === levels &&
            m.totals === totals &&
            m.collapsed === collapsed &&
            m.expanded === expanded &&
            m.order === order &&
            m.fiscal === fiscal &&
            m.numbered === numbered
        ) {
            return m.view;
        }
        // The user's sort. Grouped, buildView gathers each group's rows (in
        // this order) under it and puts the groups themselves in order. A sort
        // on a field that is no column (the admin's first, set in Setup) cannot
        // be compared here: there the rows keep the server's order, which has it.
        const keys = this.sortKeys
            .filter(k => k && k.field)
            .map(k => {
                const column = this.columnByField(k.field);
                if (!column) return { ...k, mixed: true };
                const type = column.type || 'text';
                // A lookup sorts by the name shown; a picklist in its own
                // order, as SOQL's ORDER BY does.
                return {
                    ...k,
                    type,
                    names: isLookup(type) ? names || {} : undefined,
                    ranks: type === 'picklist' ? this.ranksOf(column) : null,
                    // Amounts in mixed currencies stay in the server's order.
                    mixed: isMixedCurrency(column)
                };
            });
        const sorted = keys.length ? sortRows(rows, keys, this.keyField) : rows;
        const built = buildView(sorted, levels, {
            columns: this.columns,
            keyField: this.keyField,
            collapsed,
            totals,
            names: names || {},
            sortKeys: this.sortKeys,
            fiscal,
            order,
            numbered
        });
        // Each open record is followed by its detail row.
        const detailed = withDetails(built.items, expanded, this.keyField);
        // New rows first, above every group, as they were added.
        const view = newRows.length ? newRows.concat(detailed.items) : detailed.items;
        const positionById = new Map();
        view.forEach((r, i) => positionById.set(String(r[this.keyField]), i));
        m.newRows = newRows;
        m.rows = rows;
        m.sortSig = sortSig;
        m.columns = this._config.columns;
        m.names = names;
        m.levels = levels;
        m.totals = totals;
        m.collapsed = collapsed;
        m.expanded = expanded;
        m.order = order;
        m.fiscal = fiscal;
        m.numbered = numbered;
        m.numbers = built.numbers;
        m.detailRows = detailed.detailRows;
        m.view = view;
        m.sorted = sorted;
        m.headers = built.headers;
        m.positionById = positionById;
        return view;
    }

    /**
     * What Export to Excel writes (c/gridExcel): the columns shown, in the
     * user's order, at the widths drawn and wrapped or not; how many are
     * frozen; and every loaded row in the order shown, under its group's
     * heading when grouped, every group open whatever the user folded. Saved
     * rows only: rows added with New are not records yet, and Export writes
     * saved values.
     */
    @api
    exportView() {
        // Reading the view brings the memo up to date: the rows in the user's sort.
        const shownView = this.view;
        const sorted = this._memo.sorted || (Array.isArray(shownView) ? shownView.filter(r => !r.__group) : []);
        const levels = this.grouping;
        const items = levels.length
            ? buildView(sorted, levels, {
                  columns: this.columns,
                  keyField: this.keyField,
                  collapsed: {},
                  totals: this.shownTotals,
                  names: this._config.refNames || {},
                  sortKeys: this.sortKeys,
                  fiscal: this._config.fiscal || null,
                  order: this.groupView.order
              }).items
            : sorted;
        return {
            columns: this.shownColumns.map(c => ({
                field: c.field,
                width: Math.round(this.drawnWidth(c)),
                wrapped: this.isWrapped(c)
            })),
            frozen: this.frozenCount,
            items
        };
    }

    /** A picklist column's values in the field's order (c/gridFormat picklistRanks), made once per column list. */
    ranksOf(column) {
        const m = this._memo;
        if (m.ranksColumns !== this._config.columns) {
            m.ranksColumns = this._config.columns;
            m.ranks = new Map();
        }
        if (!m.ranks.has(column.field)) m.ranks.set(column.field, picklistRanks(column.options));
        return m.ranks.get(column.field);
    }

    /** The loaded records in display order, without group rows, collapsed groups included. */
    get sortedRows() {
        return this.view ? this._memo.sorted || [] : [];
    }

    positionOf(rowId) {
        const view = this.view; // refreshes the memo, including positionById
        const p = view.length ? this._memo.positionById.get(String(rowId)) : undefined;
        return p === undefined ? -1 : p;
    }

    get rowCount() {
        return this.view.length;
    }

    /**
     * HR-10: the header row counts. -1 is the sanctioned value for "unknown".
     * With rows still on the server it is the server's count, so a screen
     * reader says "row 12 of 50,001" rather than of the rows loaded so far.
     */
    get ariaRowCount() {
        if (this._config.totalRows === -1) return -1;
        // Grouped, the rows are records AND group headers, and closed groups
        // hide theirs: the count is the view's, unknown while rows are still
        // on the server (their groups are not known yet).
        if (this.isGrouped) return this.hasMoreRows ? -1 : this.rowCount + 1;
        return this.knownTotal + 1;
    }

    /** Every row there is: the loaded rows, or the server's count when larger, plus any open rows' detail rows. */
    get knownTotal() {
        const total = Number(this._config.totalRows);
        const records = this.recordRowCount;
        return (Number.isInteger(total) && total > records ? total : records) + this.detailRows.length;
    }

    get ariaBusy() {
        return this.isLoadingMore || this._config.totalRows === -1 ? 'true' : 'false';
    }

    // ============================================================ loading more

    get hasMoreRows() {
        return this._config.hasMore === true;
    }

    get isLoadingMore() {
        return this._config.loadingMore === true;
    }

    get showLoadMore() {
        return this.hasMoreRows || this.isLoadingMore;
    }

    get loadMoreLabel() {
        // Records, not rows: group headers are not "not loaded".
        const loaded = Array.isArray(this._config.rows) ? this._config.rows.length : 0;
        const total = Number(this._config.totalRows);
        const rest = (Number.isInteger(total) ? total : loaded) - loaded;
        return rest > 0 ? `Load more rows (${formatCount(rest)} not loaded)` : 'Load more rows';
    }

    /** Ask the parent for the next page when row `rowNumber` (1-based) is near the end. */
    maybeLoadMore(rowNumber) {
        if (!this.hasMoreRows || this.isLoadingMore || !(rowNumber > 0)) return;
        if (rowNumber >= this.rowCount - LOAD_AHEAD) this.dispatchEvent(new CustomEvent('loadmore'));
    }

    handleLoadMoreClick() {
        if (this.hasMoreRows && !this.isLoadingMore) this.dispatchEvent(new CustomEvent('loadmore'));
    }

    /** Cells can always be multi-selected as a range, whatever the row selection mode. */
    get ariaMultiselectable() {
        return 'true';
    }

    get ariaLabel() {
        return this._config.ariaLabel || 'Records';
    }

    /** The grid configuration, which a lookup editor searches through. */
    get configName() {
        return this._config.configName;
    }

    /** The grid's object, for Salesforce's own lookup on a filtered lookup. */
    get objectApiName() {
        return this._config.objectApiName || null;
    }

    /**
     * The display rules as tests, compiled once per rules array and day. TODAY
     * is fixed when they compile, so a new formatToday (a Refresh) compiles
     * them again; without one, they take the day they were first read.
     */
    get displayRules() {
        const rules = this._config.displayRules;
        const today = this._config.formatToday || null;
        const m = this._memo;
        if (!m.displayRules || m.formatSource !== rules || m.formatToday !== today) {
            m.formatSource = rules;
            m.formatToday = today;
            m.displayRules = compileRules(rules, today ? { today } : {});
        }
        return m.displayRules;
    }

    /** How one row is formatted (c/gridDisplayRules formatsFor), or null. */
    rowFormats(row, id, drafts, fields) {
        const rules = this.displayRules;
        return rules.length ? formatsFor(rules, f => this.currentValue(row, id, f, drafts), fields) : null;
    }

    // ============================================================ windowing

    get isWindowed() {
        return this.rowCount > WINDOW_THRESHOLD;
    }

    get windowRange() {
        const total = this.rowCount;
        if (!this.isWindowed) return { start: 0, end: total };
        const start = Math.max(0, Math.min(this.firstRow - WINDOW_BUFFER, total - 1));
        if (!this.detailRows.length) {
            const visible = Math.ceil(this._measurements.viewport / this.rowHeight);
            return { start, end: Math.min(total, start + visible + 2 * WINDOW_BUFFER) };
        }
        // Open rows are taller: the last row in view comes from the offsets.
        const lastVisible = this.rowAtOffset(this.rowTopOf(this.firstRow) + this._measurements.viewport);
        return { start, end: Math.min(total, lastVisible + 1 + WINDOW_BUFFER) };
    }

    get hasTopSpacer() {
        return this.isWindowed && this.windowRange.start > 0;
    }

    get hasBottomSpacer() {
        return this.isWindowed && this.windowRange.end < this.rowCount;
    }

    get topSpacerStyle() {
        return `height:${this.rowTopOf(this.windowRange.start)}px`;
    }

    get bottomSpacerStyle() {
        return `height:${this.rowTopOf(this.rowCount) - this.rowTopOf(this.windowRange.end)}px`;
    }

    get spacerColspan() {
        return this.ariaColCount;
    }

    /** px: the tallest the scroller may be: the configuration's Height, the window's room, or the default. */
    get maxScrollerHeight() {
        return this.fixedHeight || this.fillHeight || DEFAULT_VIEWPORT;
    }

    get scrollerStyle() {
        const max = this.maxScrollerHeight;
        // While an editor or a menu is open, a short grid grows to hold it, never past its maximum.
        const edit = this.editing && this.editRoom ? this.editRoom : 0;
        const menu = this.menuOpenFor !== null || this.rowMenu || this.filterOpenFor !== null ? this.menuRoom : 0;
        const need = Math.max(edit, menu);
        const room = need ? `;min-height:${Math.min(need, max)}px` : '';
        return `max-height:${max}px` + room;
    }

    /** The configuration's Height in px, or 0 to fill the window. */
    get fixedHeight() {
        const h = Number(this._config.height);
        return Number.isFinite(h) && h > 0 ? Math.max(MIN_FIXED_HEIGHT, Math.round(h)) : 0;
    }

    /**
     * Fill the window: from the scroller's top to the bottom of the
     * window. Measured in the next animation frame, not here: LWC updates a
     * parent's children last to first, so something the parent adds ABOVE the
     * grid in the same update (the "Showing the first 10,000" notice) is not
     * in place yet when this runs. Otherwise it is 44px out in Lightning
     * Experience. The height is also written in that frame (HR-20), and only
     * when it changed, so a render never loops.
     */
    measureFill() {
        if (this.fixedHeight || this.isCards || this._layout.fillPending || typeof window === 'undefined') return;
        this._layout.fillPending = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- measured and written outside the render (HR-20)
        requestAnimationFrame(() => {
            this._layout.fillPending = false;
            const want = this.fillWanted();
            if (want && Math.abs(want - this.fillHeight) > 1) {
                // The redraw this causes windows the rows for the new height, not
                // the one measured after the last redraw: on loading, 53 rows were
                // drawn for a 1,347px box, the count for the first render's 480px.
                // A box taller than
                // those rows showed blank space until the first scroll.
                this._measurements.viewport = want;
                this.fillHeight = want;
            }
        });
    }

    /** The scroller height that reaches the bottom of the window, or 0 when it cannot be measured. */
    fillWanted() {
        if (this.fixedHeight || this.isCards) return 0;
        const scroller = this.template.querySelector('[data-scroller]');
        if (!scroller) return 0;
        const top = Math.max(0, scroller.getBoundingClientRect().top);
        const reserve = BOTTOM_RESERVE + (this.showFooter ? FOOTER_RESERVE : 0);
        return Math.max(MIN_FILL_HEIGHT, Math.floor(window.innerHeight - top - reserve));
    }

    // ============================================================ header model

    get headerCells() {
        const primary = this.sortKeys[0];
        const actionTab = this.mode === MODE_ACTION && this.focusKey && this.focusKey.rowId === HEADER ? '0' : '-1';
        const offsets = this.frozenOffsets;
        const shared = this.sharedWidths;
        const editableGrid = this.editableGrid;
        const focus = this.focusKey || this.defaultFocusKey(); // once, not per header cell (see isFocused)
        const movable = !this.isCards && this.shownColumns.length > 1;
        return this.layoutColumns
            .filter(c => !c.utility || c.field === GROUP_FIELD)
            .map(c => {
                if (c.field === GROUP_FIELD) return this.groupHeaderCell(c, offsets, focus);
                const sortable = c.sortable !== false;
                const isPrimary = primary && primary.field === c.field;
                const secondaryIndex = this.sortKeys.findIndex(k => k.field === c.field);
                const direction = secondaryIndex >= 0 ? this.sortKeys[secondaryIndex].direction : null;
                const focused = this.isFocused(HEADER, c.field, focus);
                const menuItems = this.columnMenuItems(c);
                const classes = ['rh-th'];
                if (sortable) classes.push('slds-is-sortable');
                if (menuItems.length) classes.push('slds-has-button-menu');
                classes.push('slds-is-resizable');
                if (isPrimary)
                    classes.push('slds-is-sorted', direction === 'desc' ? 'slds-is-sorted_desc' : 'slds-is-sorted_asc');
                if (focused && this.hasFocus) classes.push('slds-has-focus', 'rh-cell_focus');
                if (this.mode === MODE_ACTION && focused) classes.push('slds-cell_action-mode');
                const frozen = offsets && offsets[c.field];
                if (frozen) classes.push('rh-frozen');
                if (frozen && frozen.last) classes.push('rh-frozen_last');
                // A header being dragged, and where it would land.
                if (this.draggingField === c.field) classes.push('rh-dragging');
                if (this.dropTarget && this.dropTarget.field === c.field)
                    classes.push(this.dropTarget.after ? 'rh-drop_after' : 'rh-drop_before');
                // Once pinned, every column states its width, so the table's
                // width (their sum) and the columns always agree. Before that,
                // any room over goes to the data columns (sharedWidths).
                const width = this.widthsPinned
                    ? this.columnWidth(c)
                    : (shared && shared[c.field]) || this.columnWidth(c);
                const styles = width ? [`width:${width}px`] : [];
                if (frozen) styles.push(`left:${frozen.left}px`, `z-index:${frozen.z}`);
                const label = c.label || c.field;
                const menuOpen = menuItems.length > 0 && this.menuOpenFor === c.field;
                // The column's filter: an icon beside its label, and its panel when open.
                const filter = this.filterOf(c.field);
                const filterOpen = this.filterOpenFor === c.field;
                const align = alignmentFor(c.type);
                const alignRight = align === 'right';
                // Header alignment follows the column's values.
                const alignCls = { right: ' slds-grid_align-end', center: ' slds-grid_align-center', left: '' }[align];
                // In an editable grid, a column no one can edit here says so in its
                // spoken name. No lock is drawn in the header: as in a list view, the
                // lock shows in a cell, on hover or focus.
                const readOnly = editableGrid && !c.editable;
                return {
                    field: c.field,
                    label,
                    ariaLabel: (readOnly ? `${label}, read only` : label) + (filter ? ', filtered' : ''),
                    title: filter ? `${label}: ${describeFilter(filter, c)}` : label,
                    filtered: Boolean(filter),
                    filterOpen,
                    filterColumn: filterOpen ? c : null,
                    filterValue: filterOpen ? filter : null,
                    colIndex: c.colIndex,
                    sortable,
                    sortableAttr: sortable ? 'true' : 'false',
                    // HR-14: "none" for sortable-but-unsorted; a direction on the
                    // primary key only. ARIA cannot express a secondary key.
                    ariaSort: sortable
                        ? isPrimary
                            ? direction === 'desc'
                                ? 'descending'
                                : 'ascending'
                            : 'none'
                        : null,
                    // Always the down arrow: SLDS rotates it for slds-is-sorted_asc. Swapping
                    // in arrowup for descending cancels that out (found in LEX).
                    sortIcon: 'utility:arrowdown',
                    iconFirst: alignRight,
                    iconLast: !alignRight,
                    labelGridCls: 'slds-grid slds-grid_vertical-align-center slds-has-flexi-truncate' + alignCls,
                    staticActionCls: 'slds-th__action' + alignCls,
                    sortAnnouncement: isPrimary ? 'Sorted ' + (direction === 'desc' ? 'descending' : 'ascending') : '',
                    secondaryBadge: secondaryIndex > 0 ? String(secondaryIndex + 1) : '',
                    cls: classes.join(' '),
                    tabindex: this.isTabStop(HEADER, c.field, focus) ? '0' : '-1',
                    actionTabindex: focused ? actionTab : '-1',
                    width: width || DEFAULT_WIDTH,
                    style: styles.join(';'),
                    resizeLabel: label + ' column width',
                    hasMenu: menuItems.length > 0,
                    menuItems,
                    menuCls: menuClass(menuItems.length),
                    menuOpen,
                    menuExpanded: menuOpen ? 'true' : 'false',
                    menuLabel: 'Show ' + label + ' column actions',
                    menuListLabel: label + ' column actions',
                    // Drag the header to move the column; the dialog is the keyboard way.
                    draggable: movable ? 'true' : 'false'
                };
            });
    }

    /**
     * A column menu's items, in sections: Sort ascending and Sort descending
     * for a sortable column (every sortable header has a menu), Wrap
     * text and Clip text for text columns, then, for a column the grid can
     * group by, grouping by it, adding it to the grouping, or taking it out.
     * The first item of each later section has a divider above it.
     */
    columnMenuItems(c) {
        const field = c.field;
        const sections = [];
        if (c.sortable !== false) {
            const primary = this.sortKeys[0];
            const on = Boolean(primary) && primary.field === field;
            sections.push([
                this.menuItem({
                    key: field + ':asc',
                    field,
                    label: 'Sort ascending',
                    radio: true,
                    checked: on && primary.direction === 'asc',
                    sort: 'asc'
                }),
                this.menuItem({
                    key: field + ':desc',
                    field,
                    label: 'Sort descending',
                    radio: true,
                    checked: on && primary.direction === 'desc',
                    sort: 'desc'
                })
            ]);
        }
        if (c.wrappable) {
            sections.push([
                this.menuItem({
                    key: field + ':wrap',
                    field,
                    label: 'Wrap text',
                    radio: true,
                    checked: c.wrapped,
                    wrap: 'true'
                }),
                this.menuItem({
                    key: field + ':clip',
                    field,
                    label: 'Clip text',
                    radio: true,
                    checked: !c.wrapped,
                    wrap: 'false'
                })
            ]);
        }
        // Filter by this column: opens the filter panel under the header.
        // At MAX_FILTERS columns already filtered, only those can change.
        const active = canFilter(c) && Boolean(this.filterOf(field));
        if (canFilter(c) && (active || this.filters.length < MAX_FILTERS)) {
            const filterItems = [
                this.menuItem({
                    key: field + ':filter',
                    field,
                    label: active ? 'Edit filter…' : 'Filter…',
                    filter: 'open'
                })
            ];
            if (active)
                filterItems.push(
                    this.menuItem({ key: field + ':unfilter', field, label: 'Remove filter', filter: 'remove' })
                );
            sections.push(filterItems);
        }
        if (c.groupable === true && !this.isCards) {
            const levels = this.grouping;
            const label = c.label || field;
            const group = [];
            const add = (action, text) =>
                group.push(this.menuItem({ key: field + ':' + action, field, label: text, action }));
            if (levels.some(l => l.field === field)) add('remove', `Stop grouping by ${label}`);
            else if (!levels.length) add('group', `Group by ${label}`);
            else {
                if (levels.length < MAX_LEVELS) add('add', `Add ${label} to grouping`);
                add('group', `Group by ${label} only`);
            }
            sections.push(group);
        }
        // Freeze the columns up to this one, as far as MAX_FROZEN; unfreeze them.
        if (!this.isCards) {
            const position = this.dataPosition(field);
            const freeze = [];
            if (position > 0 && position <= MAX_FROZEN && position !== this.frozenCount)
                freeze.push(
                    this.menuItem({
                        key: field + ':freeze',
                        field,
                        label: 'Freeze up to this column',
                        freeze: String(position)
                    })
                );
            if (this.frozenCount > 0)
                freeze.push(this.menuItem({ key: field + ':unfreeze', field, label: 'Unfreeze columns', freeze: '0' }));
            if (freeze.length) sections.push(freeze);
        }
        // Hide column: not a column the admin keeps on screen, nor the last one showing.
        if (!this.isCards && canHide(this.columns, this._config.columnChoice, field)) {
            sections.push([this.menuItem({ key: field + ':hide', field, label: 'Hide column', hide: 'true' })]);
        }
        const items = [];
        sections.forEach((section, i) => {
            section.forEach((item, j) => {
                if (i > 0 && j === 0) item.cls += ' slds-has-divider_top-space';
                items.push(item);
            });
        });
        return items;
    }

    /** One menu item's model; a radio shows a tick when chosen. */
    menuItem({
        key,
        field,
        label,
        radio = false,
        checkbox = false,
        checked = false,
        wrap,
        action,
        unit,
        sort,
        filter,
        hide,
        freeze,
        divider = false
    }) {
        const ticked = radio || checkbox;
        return {
            key,
            field,
            label,
            sort,
            filter,
            hide,
            freeze,
            role: checkbox ? 'menuitemcheckbox' : radio ? 'menuitemradio' : 'menuitem',
            isRadio: ticked,
            checked: ticked ? String(Boolean(checked)) : null,
            wrap,
            action,
            unit,
            cls:
                'slds-dropdown__item' +
                (ticked && checked ? ' slds-is-selected' : '') +
                (divider ? ' slds-has-divider_top-space' : '')
        };
    }

    /**
     * The Group column's header: what the grid is grouped by, and a menu
     * to open or close every group, change a date's unit, or stop grouping.
     */
    groupHeaderCell(c, offsets, focus) {
        const focused = this.isFocused(HEADER, GROUP_FIELD, focus);
        const actionTab = this.mode === MODE_ACTION && focused ? '0' : '-1';
        const levels = this.grouping;
        const names = levels.map(l => {
            const col = this.columnByField(l.field) || {};
            return (col.label || l.field) + (l.unit ? ` (${UNIT_LABELS[l.unit].toLowerCase()})` : '');
        });
        // The header says "Group"; what the grid is grouped by is in its tooltip,
        // its accessible name and the chips above the table: it was cut
        // off at the column's width.
        const label = 'Grouped by ' + names.join(', then ');
        const items = [
            this.menuItem({ key: 'expand', field: GROUP_FIELD, label: 'Expand all groups', action: 'expand' }),
            this.menuItem({ key: 'collapse', field: GROUP_FIELD, label: 'Collapse all groups', action: 'collapse' })
        ];
        levels.forEach(l => {
            const col = this.columnByField(l.field);
            if (!isDateColumn(col)) return;
            DATE_UNITS.forEach((u, i) =>
                items.push(
                    this.menuItem({
                        key: l.field + ':' + u,
                        field: GROUP_FIELD,
                        label: `${col.label || l.field} by ${UNIT_LABELS[u].toLowerCase()}`,
                        radio: true,
                        checked: l.unit === u,
                        action: 'unit',
                        unit: l.field + ':' + u,
                        divider: i === 0
                    })
                )
            );
        });
        // The groups' order: by name, by record count, or by a subtotal.
        const order = this.groupView.order;
        const measures = [
            { by: 'name', label: 'Order groups by name' },
            { by: 'count', label: 'Order groups by record count' }
        ].concat(
            this.columns
                .filter(col => col.subtotal)
                .map(col => ({
                    by: col.field,
                    label: `Order groups by ${SUBTOTAL_NAMES[col.subtotal].toLowerCase()} of ${col.label || col.field}`
                }))
        );
        measures.forEach((o, i) =>
            items.push(
                this.menuItem({
                    key: 'order:' + o.by,
                    field: GROUP_FIELD,
                    label: o.label,
                    radio: true,
                    checked: order.by === o.by,
                    action: 'order',
                    unit: o.by,
                    divider: i === 0
                })
            )
        );
        if (order.by !== 'name') {
            items.push(
                this.menuItem({
                    key: 'dir:desc',
                    field: GROUP_FIELD,
                    label: 'Largest first',
                    radio: true,
                    checked: order.direction === 'desc',
                    action: 'direction',
                    unit: 'desc',
                    divider: true
                })
            );
            items.push(
                this.menuItem({
                    key: 'dir:asc',
                    field: GROUP_FIELD,
                    label: 'Smallest first',
                    radio: true,
                    checked: order.direction === 'asc',
                    action: 'direction',
                    unit: 'asc'
                })
            );
        }
        items.push(
            this.menuItem({
                key: 'percent',
                field: GROUP_FIELD,
                label: 'Show percent of total',
                checkbox: true,
                checked: this.groupView.percent,
                action: 'percent',
                divider: true
            })
        );
        items.push(
            this.menuItem({
                key: 'ungroup',
                field: GROUP_FIELD,
                label: 'Stop grouping',
                action: 'ungroup',
                divider: true
            })
        );
        const menuOpen = this.menuOpenFor === GROUP_FIELD;
        const frozen = offsets && offsets[GROUP_FIELD];
        const width = this.columnWidth(c);
        const styles = [`width:${width}px`];
        if (frozen) styles.push(`left:${frozen.left}px`, `z-index:${frozen.z}`);
        return {
            field: GROUP_FIELD,
            label: 'Group',
            ariaLabel: label,
            title: label,
            colIndex: c.colIndex,
            sortable: false,
            sortableAttr: 'false',
            ariaSort: null,
            staticActionCls: 'slds-th__action',
            cls:
                'rh-th rh-group-th slds-has-button-menu slds-is-resizable' +
                (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '') +
                (this.dropTarget && this.dropTarget.field === GROUP_FIELD ? ' rh-drop_group' : '') +
                (this.mode === MODE_ACTION && focused ? ' slds-cell_action-mode' : '') +
                (frozen ? ' rh-frozen' : '') +
                (frozen && frozen.last ? ' rh-frozen_last' : ''),
            tabindex: this.isTabStop(HEADER, GROUP_FIELD, focus) ? '0' : '-1',
            actionTabindex: actionTab,
            width,
            style: styles.join(';'),
            resizeLabel: 'Group column width',
            hasMenu: true,
            menuItems: items,
            // Wider than the column, and opening rightwards from its left edge: the
            // Group column is at the grid's left, and its items are long.
            menuCls:
                menuClass(items.length).replace('slds-dropdown_right', 'slds-dropdown_left') + ' rh-column-menu_wide',
            menuOpen,
            menuExpanded: menuOpen ? 'true' : 'false',
            menuLabel: 'Show grouping actions',
            menuListLabel: 'Grouping actions'
        };
    }

    get selectHeader() {
        const col = this.layoutColumns.find(c => c.field === SELECT_FIELD);
        if (!col) return null;
        const rows = this.sortedRows; // records only: a group header is not selectable
        const selectedCount = Object.keys(this.selected).length;
        const focused = this.isFocused(HEADER, SELECT_FIELD);
        return {
            colIndex: col.colIndex,
            tabindex: this.isTabStop(HEADER, SELECT_FIELD) ? '0' : '-1',
            cls:
                'slds-text-align_right rh-select-col' +
                (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '') +
                this.frozenClass(SELECT_FIELD),
            style: `width:${SELECT_WIDTH}px` + this.frozenStyle(SELECT_FIELD, true),
            controlTabindex: focused && this.mode === MODE_ACTION ? '0' : '-1',
            allChecked: rows.length > 0 && selectedCount === rows.length,
            inputId: this._layout.gridId + '-select-all'
        };
    }

    /** The toggle column's header: no control, a name for screen readers. */
    get expandHeader() {
        const col = this.layoutColumns.find(c => c.field === EXPAND_FIELD);
        if (!col) return null;
        const focused = this.isFocused(HEADER, EXPAND_FIELD);
        // Show or hide every row's related records; not in a list of cards.
        const all = this.allOpen;
        const label = all ? 'Hide related records for every row' : 'Show related records for every row';
        return {
            colIndex: col.colIndex,
            tabindex: this.isTabStop(HEADER, EXPAND_FIELD) ? '0' : '-1',
            controlTabindex: this.mode === MODE_ACTION && focused ? '0' : '-1',
            hasAll: this.openableRows.length > 0,
            allLabel: label,
            allIcon: all ? 'utility:collapse_all' : 'utility:expand_all',
            allPressed: String(all),
            cls:
                'rh-expand-col' +
                (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '') +
                this.frozenClass(EXPAND_FIELD) +
                (this.mode === MODE_ACTION && focused ? ' slds-cell_action-mode' : ''),
            style: `width:${EXPAND_WIDTH}px` + this.frozenStyle(EXPAND_FIELD, true)
        };
    }

    /** The Actions column's header: no control, a name for screen readers. */
    get actionsHeader() {
        const col = this.layoutColumns.find(c => c.field === ACTIONS_FIELD);
        if (!col) return null;
        const focused = this.isFocused(HEADER, ACTIONS_FIELD);
        return {
            colIndex: col.colIndex,
            tabindex: this.isTabStop(HEADER, ACTIONS_FIELD) ? '0' : '-1',
            cls: 'rh-actions-col' + (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : ''),
            style: `width:${ACTIONS_WIDTH}px`
        };
    }

    get statusHeader() {
        const col = this.layoutColumns.find(c => c.field === STATUS_FIELD);
        if (!col) return null;
        return {
            colIndex: col.colIndex,
            label: col.label,
            tabindex: this.isTabStop(HEADER, STATUS_FIELD) ? '0' : '-1',
            cls:
                'rh-status-col' +
                (this.isFocused(HEADER, STATUS_FIELD) && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '') +
                this.frozenClass(STATUS_FIELD),
            style: `width:${this.statusWidth}px` + this.frozenStyle(STATUS_FIELD, true)
        };
    }

    /** ' rh-frozen', plus ' rh-frozen_last' for the last frozen column, or ''. */
    frozenClass(field, offsets = this.frozenOffsets) {
        const f = offsets && offsets[field];
        if (!f) return '';
        return ' rh-frozen' + (f.last ? ' rh-frozen_last' : '');
    }

    /** The sticky offset, and for a header cell its z-index; starts with ';'. */
    frozenStyle(field, isHeader, offsets = this.frozenOffsets) {
        const f = offsets && offsets[field];
        if (!f) return '';
        return `;left:${f.left}px` + (isHeader ? `;z-index:${f.z}` : '');
    }

    // ============================================================ row model

    get renderRows() {
        // Read during every render, so that a change of focus the cells could
        // not take in place (focusRev, see focusKey) redraws the table.
        this._nav.drawnRev = this.focusRev;
        // With diagnostics on, a key press's redraw also measures the time spent
        // building the rows' models (rowhouse:rows), apart from LWC's own work
        // (c/gridTiming).
        const diagnostics = this._config.diagnostics === true && this._timing.key;
        if (diagnostics) mark(true, 'rows-start');
        const out = this.buildRows();
        if (diagnostics) measure(true, 'rows', 'rows-start');
        return out;
    }

    /** The rendered window's rows, as models for the template: see renderRows. */
    buildRows() {
        const { start, end } = this.windowRange;
        const view = this.view;
        const drafts = this._config.drafts || {};
        const errors = this._config.errors || {};
        const cols = this.layoutColumns;
        const editableGrid = cols.some(c => c.editable);
        const newIds = this.newRowIds;
        const maxed =
            this.isMulti && this._config.maxSelected && Object.keys(this.selected).length >= this._config.maxSelected;
        // Computed once per render, not once per cell.
        const layout = {
            range: this.range,
            offsets: this.frozenOffsets,
            names: this._config.refNames || {},
            focus: this.focusKey || this.defaultFocusKey(), // see isFocused
            // Row numbers, by record Id (see view), or null.
            numbers: this._memo.numbers || null,
            // New rows, and whether any of their cells can be filled in.
            newIds,
            creatableGrid: newIds.size > 0 && cols.some(c => c.creatable)
        };
        // The range as this drawing shows it, for the next change in place (patchRange).
        this._nav.shaded = layout.range;
        const dataFields = cols.filter(c => !c.utility).map(c => c.field);
        // Grouped: every record sits one level below the innermost group.
        const recordLevel = this.isGrouped ? String(this.grouping.length + 1) : null;
        const out = [];
        for (let i = start; i < end; i++) {
            const row = view[i];
            if (row.__group) {
                out.push(this.groupRowModel(row, i, cols, layout));
                continue;
            }
            if (row.__detail) {
                out.push(this.detailRowModel(row, i, recordLevel, layout.focus));
                continue;
            }
            const id = String(row[this.keyField]);
            const isNew = newIds.size > 0 && newIds.has(id);
            const rowDrafts = drafts[id] || {};
            const rowErrors = errors[id] || {};
            const fieldErrors = rowErrors.fields || {};
            const isSelected = Boolean(this.selected[id]);
            const format = this.rowFormats(row, id, drafts, dataFields);
            const cells = [];
            cols.forEach(c => {
                cells.push(
                    this.cellModel(
                        c,
                        row,
                        id,
                        i + 1,
                        rowDrafts,
                        fieldErrors,
                        rowErrors,
                        editableGrid,
                        isSelected,
                        maxed,
                        layout,
                        format
                    )
                );
            });
            out.push({
                key: id, // HR-19: record-derived, stable, opaque — never the index
                id,
                isRecord: true,
                kind: 'record',
                rowIndex: i + 1,
                ariaRowIndex: i + 2, // the header is row 1
                ariaSelected: this.hasSelection && !isNew ? String(isSelected) : null,
                // A new row is in no group: it sits above them.
                ariaLevel: isNew && recordLevel ? '1' : recordLevel,
                ariaExpanded: null,
                style: null,
                // rh-row_selected and rh-row_open let frozen cells take the row's
                // color without naming an SLDS class (HR-15); a row
                // format's fill is a bar at the row's left edge.
                cls:
                    'slds-hint-parent' +
                    (isSelected ? ' slds-is-selected rh-row_selected' : '') +
                    (this.hasChildren && this.expanded[id] ? ' rh-row_open' : '') +
                    (isNew ? ' rh-row_new' : '') +
                    (format && format.bar ? ' rh-row_bar ' + format.bar : ''),
                statusCell: cells.find(x => x.isStatus) || null,
                selectCell: cells.find(x => x.isSelect) || null,
                expandCell: cells.find(x => x.isExpand) || null,
                groupCell: cells.find(x => x.isGroupCol) || null,
                actionsCell: cells.find(x => x.isActions) || null,
                cells: cells.filter(x => !x.isStatus && !x.isSelect && !x.isExpand && !x.isGroupCol && !x.isActions)
            });
        }
        return out;
    }

    /**
     * An open row's panel: one cell across every column, holding the
     * row's tabs of related records. Its height is fixed, so the windowing
     * arithmetic stays exact (c/gridChildTables).
     */
    detailRowModel(item, index, recordLevel, focus) {
        const id = String(item[this.keyField]);
        const d = item.__detail;
        const focused = this.isFocused(id, DETAIL_FIELD, focus);
        const name = this.rowName(d.row);
        const height = this.panelHeightOf(d.rowId);
        // The panel starts under the row's toggle, with a bar down its left
        // edge that ties it to its row.
        const indent = this.panelIndent;
        // As wide as the grid shows, less the indent and the table's borders:
        // the cell starts after the left border, so a panel as wide as the
        // grid ran 1px past it and the grid scrolled sideways by that pixel
        // (found in Lightning Experience).
        const width = this.viewWidth ? `;width:${Math.max(0, this.viewWidth - indent - TABLE_BORDERS)}px` : '';
        const counts = this.childCountsOf(d.rowId);
        return {
            key: id, // detailId(record Id): record-derived and stable (HR-19)
            id,
            isRecord: false,
            isDetail: true,
            kind: 'detail',
            rowIndex: index + 1,
            ariaRowIndex: index + 2,
            ariaSelected: null,
            ariaLevel: recordLevel,
            ariaExpanded: null,
            style: `height:${height}px`,
            cls: 'rh-detail-row',
            detailCell: {
                id: this.detailCellId(d.rowId),
                colIndex: 1,
                colspan: this.ariaColCount,
                tabindex: this.isTabStop(id, DETAIL_FIELD, focus) ? '0' : '-1',
                label: `Related records for ${name || 'row ' + index}`,
                // Focus inside the child table is shown there; the panel keeps its
                // left bar, not an outline round the whole panel.
                cls:
                    'rh-detail-cell' +
                    (focused && this.hasFocus && !this.childFocus ? ' slds-has-focus rh-cell_focus' : ''),
                panelStyle: `height:${height - 1}px;--rh-panel-indent:${indent}px` + width,
                tabs: this.childTabs,
                counts: counts ? counts.byTab : null,
                parentId: d.rowId,
                parentName: name,
                level: this.childLevel
            }
        };
    }

    /** px: how far an open row's panel is indented: to the middle of its row's toggle. */
    get panelIndent() {
        const before = (this.hasRowStatus ? this.statusWidth : 0) + (this.hasSelection ? SELECT_WIDTH : 0);
        return before + 12;
    }

    /**
     * An open panel's content changed height (c/gridChildTabs measures it):
     * the panel follows, up to its level's maximum. A new object, and
     * only on a real change, so a render never loops.
     */
    handlePanelSize(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        const height = Math.ceil(Number(event.detail && event.detail.height) || 0);
        if (!rowId || !height || Math.abs((this.panelSizes[rowId] || 0) - height) <= 1) return;
        this.panelSizes = { ...this.panelSizes, [rowId]: height };
    }

    /** A child table's row count changed (an import, a delete): the parent's count follows. */
    handleChildCount(event) {
        event.stopPropagation();
        const parentId = event.currentTarget.dataset.rowId;
        const { tab, count } = event.detail || {};
        if (!parentId || !tab) return;
        this.dispatchEvent(new CustomEvent('childcount', { detail: { parentId, tab, count } }));
    }

    detailCellId(rowId) {
        return (this._layout.gridId + '-detail-' + rowId).replace(/[^A-Za-z0-9_-]/g, '_');
    }

    /**
     * A group's header row: the toggle, name and count in the Group
     * column, and each column's subtotal under it. It is exactly as tall as a
     * record row, so the windowing arithmetic (row height x rows) stays exact.
     */
    groupRowModel(item, index, cols, layout) {
        const h = item.__group;
        const id = String(item[this.keyField]);
        const cells = cols.map(c => this.groupCellModel(c, h, id, layout));
        return {
            key: id,
            id,
            isRecord: false,
            isGroup: true,
            kind: 'group',
            rowIndex: index + 1,
            ariaRowIndex: index + 2,
            ariaSelected: null,
            ariaLevel: String(h.level),
            ariaExpanded: String(h.expanded),
            style: `height:${this.rowHeight}px`,
            cls: 'rh-group-row rh-group-row_' + h.level,
            statusCell: cells.find(x => x.isStatus) || null,
            selectCell: cells.find(x => x.isSelect) || null,
            expandCell: cells.find(x => x.isExpand) || null,
            groupCell: cells.find(x => x.isGroupCol) || null,
            actionsCell: cells.find(x => x.isActions) || null,
            cells: cells.filter(x => !x.isStatus && !x.isSelect && !x.isExpand && !x.isGroupCol && !x.isActions)
        };
    }

    groupCellModel(c, h, id, layout) {
        const focused = this.isFocused(id, c.field, layout.focus);
        const inAction = focused && this.mode === MODE_ACTION;
        const base = {
            field: c.field,
            colIndex: c.colIndex,
            tabindex: this.isTabStop(id, c.field, layout.focus) ? '0' : '-1',
            controlTabindex: inAction ? '0' : '-1',
            style: this.frozenStyle(c.field, false, layout.offsets).slice(1)
        };
        const focusCls =
            (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '') +
            this.frozenClass(c.field, layout.offsets) +
            (inAction ? ' slds-cell_action-mode' : '');
        if (c.field === STATUS_FIELD) return { ...base, isStatus: true, cls: 'rh-group-utility' + focusCls };
        if (c.field === SELECT_FIELD) return { ...base, isSelect: true, cls: 'rh-group-utility' + focusCls };
        // A group has no child tables of its own, and no actions.
        if (c.field === EXPAND_FIELD) return { ...base, isExpand: true, cls: 'rh-group-utility' + focusCls };
        if (c.field === ACTIONS_FIELD) return { ...base, isActions: true, cls: 'rh-group-utility' + focusCls };
        const totals = this.shownTotals;
        const percent = this.groupView.percent && totals && totals.total;
        if (c.field === GROUP_FIELD) {
            const label = `${h.columnLabel}: ${h.label}`;
            // Its share of every record listed, with Show percent of total.
            const share = percent && h.count !== null ? shareText(shareOf({ count: h.count }, totals.total, null)) : '';
            return {
                ...base,
                isGroupCol: true,
                label,
                // "(2)", as Salesforce reports show a group's count.
                countText: h.count === null ? '' : `(${formatCount(h.count)})`,
                shareText: share,
                // "Stage: Open, 2 records"; the button adds "expanded" or "collapsed".
                spokenName:
                    h.count === null
                        ? label
                        : `${label}, ${recordsText(h.count)}${share ? `, ${share} of all records` : ''}`,
                expandedAttr: String(h.expanded),
                toggleIcon: h.expanded ? 'utility:chevrondown' : 'utility:chevronright',
                contentStyle: `padding-left:${(h.level - 1) * GROUP_INDENT}px`,
                cls: 'rh-group-cell' + focusCls
            };
        }
        const sub = h.values ? subtotalFor({ values: h.values }, c) : null;
        const align = alignmentFor(c.type);
        // A count of nothing says nothing: left blank.
        const shown = Boolean(sub && sub.text) && !(sub.kind === 'count' && Number(sub.value) === 0);
        const share = shown && percent ? shareText(shareOf({ values: h.values }, totals.total, c)) : '';
        return {
            ...base,
            isSubtotal: true,
            hasSubtotal: shown,
            subtotalKind: shown ? SUBTOTAL_SHORT[sub.kind] : '',
            text: shown ? sub.text : '',
            shareText: share,
            spoken: shown ? this.subtotalSpoken(sub, c, h, share) : '',
            title: shown ? this.subtotalSpoken(sub, c, h, share) : '',
            cls:
                'rh-subtotal-cell' +
                (align !== 'left' ? ' slds-text-align_' + align : '') +
                focusCls +
                (shown && h.edited && h.edited[c.field] ? ' rh-subtotal_edited' : '')
        };
    }

    /**
     * A subtotal in words: "Sum of Amount: $150.00", with its share of the
     * whole list's, the currency it was converted to in an org with more
     * than one, and that it includes unsaved changes, or will be worked out
     * again when they are saved.
     */
    subtotalSpoken(sub, c, h, share) {
        let text = `${SUBTOTAL_NAMES[sub.kind]} of ${c.label || c.field}: ${sub.text}`;
        // In an org with more than one currency, a total converts every amount.
        if (sub.kind !== 'count' && c.type === 'currency' && (c.currencyField || c.currencyCode))
            text += ` (every amount converted to ${c.totalCurrency ? c.totalCurrency + ', ' : ''}the corporate currency)`;
        if (share) text += `, ${share} of the total`;
        if (h && h.unknown && h.unknown[c.field]) text += ' (as saved; updated when your changes are saved)';
        else if (h && h.edited && h.edited[c.field]) text += ' (with your unsaved changes)';
        return text;
    }

    cellModel(
        c,
        row,
        id,
        rowIndex,
        rowDrafts,
        fieldErrors,
        rowErrors,
        editableGrid,
        isSelected,
        maxed,
        layout = {},
        format = null
    ) {
        const focused = this.isFocused(id, c.field, layout.focus);
        const inAction = focused && this.mode === MODE_ACTION;
        const isNew = Boolean(layout.newIds) && layout.newIds.size > 0 && layout.newIds.has(id);
        const base = {
            field: c.field,
            colIndex: c.colIndex,
            tabindex: this.isTabStop(id, c.field, layout.focus) ? '0' : '-1',
            controlTabindex: inAction ? '0' : '-1',
            style: this.frozenStyle(c.field, false, layout.offsets).slice(1)
        };
        const focusCls =
            (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '') +
            this.frozenClass(c.field, layout.offsets);
        if (c.field === GROUP_FIELD) {
            // A record's Group cell is empty: its groups are the header rows above
            // the record. A guide line at its innermost group's indent
            // shows that the record sits under that group.
            const guide = (this.grouping.length - 1) * GROUP_INDENT + 18;
            return {
                ...base,
                isGroupCol: true,
                cls: 'rh-group-cell rh-group-cell_record' + focusCls,
                style: [base.style, `--rh-guide:${guide}px`].filter(Boolean).join(';')
            };
        }
        if (c.field === STATUS_FIELD) {
            // The row's number, with the button for its errors before it, as a
            // list view has them; without numbers, the button alone.
            // A new row has no number yet: it says New where the number goes.
            const number = layout.numbers && !isNew ? layout.numbers.get(id) : undefined;
            const which = isNew ? 'New row' : 'Row ' + (number || rowIndex);
            return {
                ...base,
                isStatus: true,
                hasError: Boolean(rowErrors.row),
                numbered: Boolean(layout.numbers),
                number: isNew ? 'New' : number ? String(number) : '',
                message: rowErrors.row ? which + ' has errors: ' + rowErrors.row : 'No errors',
                cls: 'slds-cell-edit slds-cell-error' + focusCls,
                buttonCls:
                    'slds-button slds-button_icon slds-button_icon-error slds-m-horizontal_xxx-small' +
                    (rowErrors.row ? '' : ' slds-hidden')
            };
        }
        if (c.field === EXPAND_FIELD) {
            // The toggle for the row's child tables, with how many related
            // records there are, and none when there are none.
            const open = Boolean(this.expanded[id]);
            const name = this.rowName(row);
            const counts = this.childCountsOf(id);
            const total = counts ? counts.total : null;
            const countText = total === null ? '' : formatCount(total);
            return {
                ...base,
                isExpand: true,
                // A new row has no related records until it is saved.
                showToggle: !isNew && this.offersToggle(open, counts),
                countText: total ? countText : '',
                expandedAttr: String(open),
                controls: open ? this.detailCellId(id) : null,
                toggleIcon: open ? 'utility:chevrondown' : 'utility:chevronright',
                toggleLabel:
                    `${open ? 'Hide' : 'Show'} related records for ${name || 'row ' + rowIndex}` +
                    (total === null ? '' : ` (${countText})`),
                cls: 'rh-expand-cell' + focusCls + (inAction ? ' slds-cell_action-mode' : '')
            };
        }
        if (c.field === ACTIONS_FIELD) {
            // The row's actions: a menu button; the menu itself only on
            // the row it is open on.
            const open = Boolean(this.rowMenu) && this.rowMenu.rowId === id;
            const name = this.rowName(row);
            return {
                ...base,
                isActions: true,
                // Actions run on saved records: a new row has none until it is saved.
                hasMenu: !isNew,
                label: `Actions for ${name || 'row ' + rowIndex}`,
                disabled: this.isSaving,
                menuOpen: open,
                menuExpanded: open ? 'true' : 'false',
                menuItems: open ? this.rowMenuItems : null,
                triggerCls: 'slds-dropdown-trigger slds-dropdown-trigger_click' + (open ? ' slds-is-open' : ''),
                dropdownCls:
                    'slds-dropdown slds-dropdown_right rh-row-menu' +
                    (open && this.rowMenu.up ? ' slds-dropdown_bottom' : ''),
                cls: 'rh-actions-cell' + focusCls + (inAction ? ' slds-cell_action-mode' : '')
            };
        }
        if (c.field === SELECT_FIELD) {
            return {
                ...base,
                isSelect: true,
                // A new row is selected for nothing until it is saved.
                selectable: !isNew,
                checked: isSelected,
                disabled: Boolean(maxed && !isSelected),
                inputType: this.isMulti ? 'checkbox' : 'radio',
                inputId: this._layout.gridId + '-sel-' + id,
                label: 'Select item ' + rowIndex,
                // Right-aligned, as the header's Select all is, and as in the SLDS
                // data-table blueprint: left-aligned, each row's box sat 20px left
                // of the header's.
                cls: 'slds-cell-edit slds-text-align_right' + focusCls + (inAction ? ' slds-cell_action-mode' : '')
            };
        }
        const hasDraft = Object.prototype.hasOwnProperty.call(rowDrafts, c.field);
        const value = hasDraft ? rowDrafts[c.field] : row[c.field];
        const error = fieldErrors[c.field];
        const names = layout.names || {};
        const lookup = isLookup(c.type);
        const text = lookup ? lookupText(value, names) : formatValue(value, c, row);
        const isCheckbox = c.type === 'checkbox' || c.type === 'boolean';
        const link = this.linkFor(c, id, value);
        const isEditing = Boolean(this.editing && this.editing.rowId === id && this.editing.field === c.field);
        // A new row's cell is filled in where the user may set the field on a new record.
        const editable = isNew ? c.creatable === true : c.editable === true && reachesParent(row, c);
        const affordance = isNew ? Boolean(layout.creatableGrid) : editableGrid;
        const classes = ['slds-cell-edit', 'rh-cell'];
        if (c.wrapped) classes.push('slds-cell-wrap');
        const align = alignmentFor(c.type);
        if (align !== 'left') classes.push('slds-text-align_' + align);
        // rh-cell_draft as well: the row tint stands aside for it (HR-15: no SLDS class in our CSS).
        if (hasDraft) classes.push('slds-is-edited', 'rh-cell_draft');
        if (error) classes.push('slds-has-error');
        if (isEditing) classes.push('rh-is-editing');
        if (focused && this.hasFocus) classes.push('slds-has-focus', 'rh-cell_focus');
        if (inAction) classes.push('slds-cell_action-mode');
        const frozenCls = this.frozenClass(c.field, layout.offsets).trim();
        if (frozenCls) classes.push(frozenCls);
        // An unsaved edit or an error shows as such, not formatted.
        const formatted = Boolean(format) && !hasDraft && !error;
        if (formatted && format.cells[c.field]) classes.push(format.cells[c.field]);
        // An icon before the value, and a data bar behind it.
        const icon = formatted && format.icons ? format.icons[c.field] || null : null;
        // What the format means, in words: the cell's own rules, on the
        // first data cell the row's, and the icon's, which is hidden from
        // screen readers: without it an icon said nothing to them.
        const formatLabel = formatted
            ? [
                  ...new Set(
                      [
                          format.labels[c.field],
                          c.colIndex === this.firstDataCol ? format.rowLabels.join(', ') : '',
                          icon ? icon.label : ''
                      ].filter(Boolean)
                  )
              ].join(', ')
            : '';
        const r = layout.range;
        const inRange =
            Boolean(r) && rowIndex >= r.top && rowIndex <= r.bottom && c.colIndex >= r.left && c.colIndex <= r.right;
        if (inRange) classes.push('rh-in-range');
        // A value the server shortened (TC-055) is edited in the text area
        // editor, which reads the whole text first.
        const cut = !hasDraft && Array.isArray(row._cut) && row._cut.includes(c.field);
        const editor = cut ? 'textarea' : EDITOR_BY_TYPE[c.type] || 'text';
        const label = c.label || c.field;
        const barPct = formatted && format.bars && format.bars[c.field] ? this.barPercent(c.field, value) : null;
        if (barPct !== null) classes.push('rh-rule_databar');
        const style = barPct === null ? base.style : [base.style, `--rh-databar:${barPct}%`].filter(Boolean).join(';');
        return {
            ...base,
            style,
            isData: true,
            hasFormatIcon: Boolean(icon),
            formatIcon: icon ? icon.name : null,
            formatIconVariant: icon ? icon.variant : null,
            formatIconLabel: icon ? icon.label : null,
            // Only cells in a multi-cell range say "selected"; see the
            // range and accessibility notes in docs/spreadsheet.md.
            ariaSelected: inRange ? 'true' : null,
            text,
            titleText: formatLabel ? `${text} · ${formatLabel}` : text,
            formatLabel,
            // A number or a tick fills the space before the edit button, so the
            // cell's alignment reaches it (the wrapper is a flex row).
            textCls: c.wrapped
                ? 'slds-line-clamp rh-wrap-text'
                : 'slds-truncate' + (align !== 'left' ? ' slds-grow' : ''),
            isCheckbox,
            checked: value === true || value === 'true',
            href: link.href,
            linkTarget: link.target,
            recordLink: link.recordId,
            editable,
            // Every cell in an editable grid shows the affordance; a read-only one
            // shows it disabled with the lock icon, exactly as the SLDS blueprint does.
            showEditButton: affordance,
            editIcon: editable ? 'utility:edit' : 'utility:lock',
            editDisabled: !editable,
            editLabel: 'Edit ' + label + (isNew ? ' of the new row' : ' of row ' + rowIndex),
            ariaReadonly: affordance && !editable ? 'true' : null,
            hasError: Boolean(error),
            errorMessage: error || '',
            errorId: error ? this.errorIdFor(id, c.field) : null,
            showErrorPopover: Boolean(error) && focused && this.hasFocus && !isEditing,
            isEditing,
            editorText: isEditing && editor === 'text',
            editorNumber: isEditing && editor === 'number',
            editorDate: isEditing && editor === 'date',
            editorCheckbox: isEditing && editor === 'checkbox',
            editorPicklist: isEditing && editor === 'picklist',
            editorLookup: isEditing && editor === 'lookup',
            editorMultiPicklist: isEditing && editor === 'multipicklist',
            editorDateTime: isEditing && editor === 'datetime',
            editorTime: isEditing && editor === 'time',
            editorTextarea: isEditing && editor === 'textarea',
            cut,
            maxLength: c.length || null,
            // The box is the cell's width; what hangs below it opens leftwards
            // when the cell is too near the right edge (placeEditor).
            dropdownAlign: isEditing && this.editAlignRight ? 'right' : 'left',
            // ... and upwards when there is no room below it, even with the grid grown.
            dropdownUp: isEditing && this.editUp,
            editValue: value,
            editValueLabel: lookup && !isBlank(value) ? names[value] || null : null,
            lookupIcons: lookup ? c.referenceIcons || null : null,
            // A lookup filter, and records the user may create from the list.
            filteredLookup: lookup && c.filteredLookup === true,
            fieldApiName: lookup ? c.fieldApiName || null : null,
            newTargets: lookup ? c.newTargets || null : null,
            // The character typed on the cell to start editing.
            editSeed: isEditing ? this.editing.seed : undefined,
            editType: c.type,
            scale: c.scale,
            // In an org with more than one currency, the record's own currency.
            currencyCode: c.type === 'currency' && currencyFor(c, row).byCode ? currencyFor(c, row).code : null,
            // A dependent picklist offers only the values its controlling value
            // allows, and any picklist only those the row's record type allows.
            options: isEditing ? this.editorOptions(c, row, rowDrafts, value) : c.options || [],
            dependentOn: c.dependentOn || null,
            required: Boolean(c.required),
            editorLabel: label,
            // An edit to one of several selected rows can go to them all, as in a list view.
            ...this.bulkFields(isEditing, id),
            cls: classes.join(' ')
        };
    }

    /**
     * How many selected rows an edit to this row can go to: every selected
     * row, when this row is one of them and the grid allows it (bulkEdit);
     * 0 otherwise. Not in cards, which have the selection bar's Update field.
     */
    bulkCount(rowId) {
        if (this._config.bulkEdit !== true || this.isCards || !rowId || !this.selected[rowId]) return 0;
        const n = Object.keys(this.selected).length;
        return n > 1 ? n : 0;
    }

    /** The open editor's "Update N selected items" box, for the cell it is open on. */
    bulkFields(isEditing, rowId) {
        const n = isEditing ? this.bulkCount(rowId) : 0;
        if (!n) return { bulkEdit: false };
        const keys =
            typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
                ? 'Command+Enter'
                : 'Ctrl+Enter';
        return {
            bulkEdit: true,
            // One editor is open at a time, so one id each will do.
            bulkId: this._layout.gridId + '-bulk',
            bulkHintId: this._layout.gridId + '-bulk-hint',
            bulkText: `Update ${formatCount(n)} selected items`,
            bulkHint: `Or press ${keys} in the editor`,
            bulkChecked: this.editing.applyAll === true
        };
    }

    /** The values a row's picklist editor offers (gridFields.rowOptions). */
    editorOptions(c, row, rowDrafts, value) {
        if (!c.dependentOn && !this._config.recordTypePicklists) return c.options || [];
        const controlling = c.dependentOn
            ? has(rowDrafts, c.dependentOn)
                ? rowDrafts[c.dependentOn]
                : row[c.dependentOn]
            : null;
        return rowOptions(c, row, controlling, this._config.recordTypePicklists || null, value);
    }

    /**
     * Where a cell's value links to: { href, target, recordId }. The name
     * field links to its record, and a lookup to the record it points to, both
     * opened in Lightning (recordId); a URL opens in a new tab; an email or a
     * phone number opens the mail or phone app. Only safe schemes (TC-046).
     */
    linkFor(c, id, value) {
        const none = { href: null, target: null, recordId: null };
        if (c.isName === true && RECORD_ID.test(String(id))) {
            return { href: `/lightning/r/${id}/view`, target: null, recordId: String(id) };
        }
        if (isBlank(value)) return none;
        if (isLookup(c.type)) {
            const href = lookupHref(value);
            return href ? { href, target: null, recordId: String(value) } : none;
        }
        if (c.type === 'url') return { href: safeHref(value), target: '_blank', recordId: null };
        if (c.type === 'email') {
            const address = String(value).trim();
            return /^[^\s@]+@[^\s@]+$/.test(address)
                ? { href: safeHref('mailto:' + address), target: null, recordId: null }
                : none;
        }
        if (c.type === 'phone') {
            const dial = String(value).replace(/[^\d+#*,;]/g, '');
            return dial ? { href: 'tel:' + dial, target: null, recordId: null } : none;
        }
        return none;
    }

    /**
     * A record link opens the record in Lightning, as a list view's does; with
     * Cmd, Ctrl, Shift or Alt, or another button, the browser does what it
     * does (a new tab or window).
     */
    handleLinkClick(event) {
        const recordId = event.currentTarget.dataset.recordId;
        if (!recordId || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        this[NavigationMixin.Navigate]({ type: 'standard__recordPage', attributes: { recordId, actionName: 'view' } });
    }

    errorIdFor(rowId, field) {
        return (this._layout.gridId + '-err-' + rowId + '-' + field).replace(/[^A-Za-z0-9_-]/g, '_');
    }

    /**
     * One hidden description per errored cell in the rendered window, in row
     * order. Read from the errors and the window, not from renderRows: going
     * through renderRows built every cell's model a second time on every
     * redraw, a third of the redraw's own work.
     */
    get errorDescriptions() {
        const errors = this._config.errors || {};
        const ids = Object.keys(errors).filter(id => errors[id] && errors[id].fields);
        if (!ids.length || this.isCards) return [];
        const { start, end } = this.windowRange;
        const out = [];
        ids.map(id => ({ id, at: this.positionOf(id) }))
            .filter(e => e.at >= start && e.at < end)
            .sort((a, b) => a.at - b.at)
            .forEach(({ id }) => {
                const fields = errors[id].fields;
                Object.keys(fields).forEach(f => out.push({ id: this.errorIdFor(id, f), message: fields[f] }));
            });
        return out;
    }

    get gridClass() {
        // Cards: the Save bar sticks to the screen and needs no band of its own.
        return 'rh-grid' + (this.showFooter && !this.isCards ? ' rh-has-footer' : '');
    }

    // ============================================================ the Total row

    /**
     * The whole list's subtotals, in a one-row table of its own under the grid,
     * stuck to the bottom of the scroller. Its cells take the header's widths,
     * so each subtotal sits under its column. It is not a row of the grid: the
     * grid's row count must be known to number a last row, and it is not while
     * rows are still on the server. It is a read-only grid of its own instead,
     * whose cells the arrow keys reach: Down from the last row, once every row
     * is loaded, and Up back again (handleTotalsKey).
     */
    get totalCells() {
        const totals = this.shownTotals;
        if (!totals || !totals.total || !this.columns.some(c => c.subtotal)) return null;
        // Drawn again when a move of focus needs a redraw (focusRev).
        const focus = this.focusRev >= 0 ? this.focusKey || this.defaultFocusKey() : null;
        const t = totals.total;
        const offsets = this.frozenOffsets;
        const cols = this.layoutColumns;
        // "Total" goes in the Group column, or in the first data column when
        // the list is not grouped; never in the narrow status or select column.
        const labelCol = cols.find(c => c.field === GROUP_FIELD) || cols.find(c => !c.utility);
        const labelField = labelCol ? labelCol.field : null;
        const shared = this.sharedWidths;
        return cols.map(c => {
            const sub = c.utility ? null : subtotalFor(t, c);
            const shown = Boolean(sub && sub.text);
            const isLabel = c.field === labelField;
            let width;
            if (c.utility) width = this.columnWidth(c);
            else width = this.widthsPinned ? this.columnWidth(c) : (shared && shared[c.field]) || this.columnWidth(c);
            const styles = width ? [`width:${width}px`] : [];
            const frozen = offsets && offsets[c.field];
            if (frozen) styles.push(`left:${frozen.left}px`);
            const align = c.utility ? 'left' : alignmentFor(c.type);
            const edited = shown && t.edited && t.edited[c.field];
            const focused = this.isFocused(TOTALS, c.field, focus);
            return {
                key: c.field,
                tabindex: this.isTabStop(TOTALS, c.field, focus) ? '0' : '-1',
                isLabel,
                countText: isLabel ? recordsText(t.count) : '',
                hasSubtotal: shown,
                kind: shown ? SUBTOTAL_SHORT[sub.kind] : '',
                text: shown ? sub.text : '',
                spoken: shown ? this.subtotalSpoken(sub, c, t, '') : '',
                style: styles.join(';'),
                cls:
                    'rh-total-cell' +
                    (align !== 'left' ? ' slds-text-align_' + align : '') +
                    this.frozenClass(c.field, offsets) +
                    (edited ? ' rh-subtotal_edited' : '') +
                    (focused && this.hasFocus ? ' slds-has-focus rh-cell_focus' : '')
            };
        });
    }

    /** Can Down from the last row go on to the Total row? Only once every row is loaded. */
    get totalsReachable() {
        return Boolean(this.totalCells) && !this.hasMoreRows && this.rowCount > 0;
    }

    /** Focus a Total row cell, by its column. */
    focusTotals(field) {
        const key = { rowId: TOTALS, field };
        this.focusKey = key;
        const el = this.cellElement(key);
        if (el) el.focus();
        else this._layout.restoreFocus = true;
    }

    /**
     * Keys on a Total row cell: Up (or Page Up) goes back to the last row,
     * Left and Right, Home and End move along the Total row, Ctrl+Home goes
     * to the first cell of the grid. The cells hold no values to edit, copy
     * into or select; undo and redo still work.
     */
    handleTotalsKey(event, key) {
        const cmd = event.metaKey || event.ctrlKey;
        const letter = typeof event.key === 'string' ? event.key.toLowerCase() : '';
        if (cmd && (letter === 'z' || (event.ctrlKey && letter === 'y'))) {
            event.preventDefault();
            this.dispatchEvent(new CustomEvent(letter === 'z' && !event.shiftKey ? 'undo' : 'redo'));
            return;
        }
        const col = this.positionOfKey(key).col;
        const colCount = this.ariaColCount;
        const fieldAt = c => (this.layoutColumns.find(x => x.colIndex === c) || {}).field;
        let next = null;
        switch (event.key) {
            case 'ArrowUp':
            case 'PageUp': {
                event.preventDefault();
                const to = { row: this.rowCount, col };
                const target = this.keyForPosition(to);
                if (target) this.focusCell(target, to.row);
                return;
            }
            case 'ArrowLeft':
                next = Math.max(1, col - 1);
                break;
            case 'ArrowRight':
                next = Math.min(colCount, col + 1);
                break;
            case 'Home':
                if (cmd) {
                    event.preventDefault();
                    const first = this.keyForPosition({ row: 1, col: 1 });
                    if (first) this.focusCell(first, 1);
                    return;
                }
                next = 1;
                break;
            case 'End':
                next = colCount;
                break;
            default:
                return;
        }
        event.preventDefault();
        const field = fieldAt(next);
        if (field) this.focusTotals(field);
    }

    get totalsLabel() {
        return 'Totals for ' + this.ariaLabel;
    }

    // ============================================================ focus helpers

    /**
     * The focused cell, { rowId, field }. Kept outside LWC's reactivity, so
     * that moving it does not redraw the table: a redraw of about 1,000 cells
     * took about 90ms in Lightning, most of an arrow key's cost, for a change
     * to two cells. A move changes the two cells in
     * place instead (patchFocus): their tab stop and SLDS's focus classes.
     * Where that is not safe it asks for a redraw (focusRev), which draws the
     * same focus from here. Every redraw first puts the cells changed in place
     * back as they were last drawn (render, undoFocusPatches), so the template
     * and the page always agree.
     */
    get focusKey() {
        return this._nav.focus;
    }
    set focusKey(next) {
        const prev = this._nav.focus;
        this._nav.focus = next;
        if (prev === next || (prev && next && prev.rowId === next.rowId && prev.field === next.field)) return;
        if (!this.patchFocus(prev, next)) this.focusRev++;
        // Focus reaching another cell some other way ends a range (rangeActive): its shading goes.
        else if (!this._nav.rangeQueued && !sameRect(this._nav.shaded, this.range) && !this.patchRange())
            this.focusRev++;
    }

    /**
     * Move the focus visuals from one cell to another without a redraw.
     * Returns false when a redraw is needed instead: in actionable mode or
     * while editing (controls inside the cells change too), on a cell with
     * an error (its message shows
     * only while focused) or an open row's panel (its focus depends on the
     * child table), or when either cell is not drawn (windowing).
     */
    patchFocus(prev, next) {
        if (this.isCards) return true; // cards show no focused cell
        if (this.mode !== MODE_NAVIGATION || this.editing) return false;
        const from = prev || this.defaultFocusKey();
        const to = next || this.defaultFocusKey();
        if (!from || !to || from.field === DETAIL_FIELD || to.field === DETAIL_FIELD) return false;
        const fromEl = this.cellElement(from);
        const toEl = this.cellElement(to);
        if (!fromEl || !toEl) return false;
        if (fromEl.classList.contains('slds-has-error') || toEl.classList.contains('slds-has-error')) return false;
        this.setCellFocus(fromEl, { tabindex: '-1', ring: false });
        this.setCellFocus(toEl, { tabindex: '0', ring: this.hasFocus });
        if (this._timing.key) {
            // A key press answered without a redraw: its cost ends here.
            this._timing.key = false;
            measure(this._config.diagnostics === true, 'key-render', 'key-start');
        }
        return true;
    }

    /**
     * Give one cell a tab stop and a focus ring, or take them away, in place.
     * The first time a cell is changed since the last redraw, how it was drawn
     * is kept (_nav.patched), and a cell back as it was drawn is let go, so at
     * most two are kept: the cell last drawn with focus and the one with it now.
     */
    setCellFocus(el, { tabindex, ring }) {
        this.rememberCell(el);
        el.setAttribute('tabindex', tabindex);
        if (ring) el.classList.add('slds-has-focus', 'rh-cell_focus');
        else el.classList.remove('slds-has-focus', 'rh-cell_focus');
        this.forgetIfDrawn(el);
    }

    /** How a cell was drawn, the first time it is changed in place since the last drawing. */
    rememberCell(el) {
        const patched = this._nav.patched;
        if (!patched.has(el)) patched.set(el, cellState(el));
    }

    /** A cell back as it was drawn needs no putting back. */
    forgetIfDrawn(el) {
        const drawn = this._nav.patched.get(el);
        if (drawn && sameState(drawn, cellState(el))) this._nav.patched.delete(el);
    }

    /**
     * Put every cell changed in place back as it was last drawn. LWC's redraw
     * compares the new drawing with its last drawing, not with the page: a cell
     * changed in place whose drawing did not change kept what the move gave it,
     * and a range after a plain move showed two focus rings and two tab stops.
     * Run just before each redraw
     * (render), which then draws focus where it is now.
     */
    undoFocusPatches() {
        const patched = this._nav.patched;
        if (!patched.size) return;
        patched.forEach((drawn, el) => {
            if (drawn.tabindex === null) el.removeAttribute('tabindex');
            else el.setAttribute('tabindex', drawn.tabindex);
            if (drawn.ring) el.classList.add('slds-has-focus', 'rh-cell_focus');
            else el.classList.remove('slds-has-focus', 'rh-cell_focus');
            if (drawn.inRange) el.classList.add('rh-in-range');
            else el.classList.remove('rh-in-range');
            if (drawn.selected === null) el.removeAttribute('aria-selected');
            else el.setAttribute('aria-selected', drawn.selected);
        });
        patched.clear();
    }

    /**
     * Is this the focused cell? `key` is the focused cell when the caller has
     * already worked it out: drawing the rows does it once (buildRows), not
     * once per cell, because until a cell has focus it is the default cell,
     * and working that out reads the view.
     */
    isFocused(rowId, field, key = this.focusKey || this.defaultFocusKey()) {
        return Boolean(key) && key.rowId === rowId && key.field === field;
    }

    /** Exactly one element in the grid is in the tab order (roving tabindex). */
    isTabStop(rowId, field, key = this.focusKey || this.defaultFocusKey()) {
        return this.mode === MODE_NAVIGATION && this.isFocused(rowId, field, key);
    }

    /** Tab into the grid lands on the first data cell (SLDS). */
    defaultFocusKey() {
        const firstData = this.layoutColumns.find(c => !c.utility) || this.layoutColumns[0];
        if (!firstData) return null;
        const view = this.view;
        if (!view.length) return { rowId: HEADER, field: firstData.field };
        return { rowId: String(view[0][this.keyField]), field: firstData.field };
    }

    /** { row, col } for a focus key: row 0 is the header. */
    positionOfKey(key) {
        if (!key) return { row: 1, col: 1 };
        const col =
            key.field === DETAIL_FIELD
                ? Math.min(this._layout.detailCol || this.firstDataCol, this.ariaColCount)
                : (this.layoutColumns.find(c => c.field === key.field) || { colIndex: 1 }).colIndex;
        if (key.rowId === TOTALS) return { row: this.rowCount + 1, col };
        const row = key.rowId === HEADER ? 0 : this.positionOf(key.rowId) + 1;
        return { row: Math.max(0, row), col };
    }

    keyForPosition(pos) {
        const col = this.layoutColumns.find(c => c.colIndex === pos.col) || this.layoutColumns[0];
        if (pos.row === 0) return { rowId: HEADER, field: col.field };
        const row = this.view[pos.row - 1];
        if (!row) return null;
        // An open row's panel is one cell across. The column focus came
        // from is kept, so moving on down lands back in it.
        if (row.__detail) {
            this._layout.detailCol = col.colIndex;
            return { rowId: String(row[this.keyField]), field: DETAIL_FIELD };
        }
        return { rowId: String(row[this.keyField]), field: col.field };
    }

    cellElement(key) {
        if (!key) return null;
        const field = String(key.field).replace(/"/g, '\\"');
        if (key.rowId === HEADER) {
            return this.template.querySelector(`[data-row-index="0"][data-field="${field}"]`);
        }
        if (key.rowId === TOTALS) return this.template.querySelector(`.rh-totals [data-total-field="${field}"]`);
        const rowId = String(key.rowId).replace(/"/g, '\\"');
        return this.template.querySelector(`[data-row-id="${rowId}"][data-field="${field}"]`);
    }

    /** First control inside a cell, for actionable mode. */
    firstControl(cellEl) {
        if (!cellEl) return null;
        return cellEl.querySelector('a.slds-th__action, button:not([disabled]), input:not([disabled]), a[href]');
    }

    // ============================================================ lifecycle

    /**
     * LWC calls this before every drawing. Cells whose focus was changed in
     * place go back to how they were last drawn first (undoFocusPatches), so
     * that LWC's comparison with its last drawing matches the page. Only DOM
     * attributes and classes are written here, never a field that is drawn.
     */
    render() {
        this.undoFocusPatches();
        return tableTemplate;
    }

    renderedCallback() {
        // Something said before the live region was drawn is written now.
        if (!this._live.written && this._live.text) this.writeLive();
        // Measurements are read here and written only to non-reactive containers.
        // Anything that must change what renders is scheduled with rAF (HR-20).
        this.measure();
        this.measureFill();
        this.measureWrap();
        if (this._config.diagnostics === true) this.timeRender();
        if (!this._layout.widthWatch) this.watchWidth();
        // Frozen columns need pixel offsets, so they need pinned widths.
        if (
            this.frozenCount &&
            !this.widthsPinned &&
            !this._layout.pinPending &&
            this.template.querySelector('thead th')
        ) {
            this._layout.pinPending = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- reactive change outside the render (HR-20)
            requestAnimationFrame(() => {
                this._layout.pinPending = false;
                this.pinWidths();
            });
        }
        if (this._layout.focusRowId) {
            const rowId = this._layout.focusRowId;
            this._layout.focusRowId = null;
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- focus moves outside the render (HR-20)
            requestAnimationFrame(() => this.focusRowNow(rowId));
        }
        if (this._layout.focusCard) {
            const position = this._layout.focusCard;
            this._layout.focusCard = 0;
            const heading = this.template.querySelector(`[data-card-heading="${position}"]`);
            if (heading) heading.focus();
        }
        if (this._layout.menuRoomCheck) this.measureMenuRoom();
        if (this._layout.focusFilter) {
            this._layout.focusFilter = false;
            const panel = this.template.querySelector('c-grid-filter-panel');
            if (panel && typeof panel.focus === 'function') {
                this._layout.restoreFocus = false;
                panel.focus();
                return;
            }
        }
        if (this._layout.focusMenu) {
            this.focusMenuTarget();
            return;
        }
        if (this._layout.focusRowMenu) {
            this.focusRowMenuTarget();
            return;
        }
        if (this._layout.focusEditor) {
            this._layout.focusEditor = false;
            const editor = this.template.querySelector('[data-editor]');
            if (editor && typeof editor.focus === 'function') editor.focus();
            // An editor on a row near the bottom of the box: scroll it into view.
            const popover = this.template.querySelector('section.rh-edit-popover');
            if (popover && typeof popover.scrollIntoView === 'function')
                popover.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            return;
        }
        if (this._layout.restoreFocus) {
            this._layout.restoreFocus = false;
            this.restoreDomFocus();
        }
    }

    restoreDomFocus() {
        if (this.isCards) {
            const k = this._layout.lastCardEdit;
            if (!k) return;
            const rowId = String(k.rowId).replace(/"/g, '\\"');
            const field = String(k.field).replace(/"/g, '\\"');
            const button = this.template.querySelector(
                `[data-card-edit][data-row-id="${rowId}"][data-field="${field}"]`
            );
            if (button) button.focus();
            return;
        }
        const key = this.focusKey || this.defaultFocusKey();
        const cell = this.cellElement(key);
        if (!cell) return; // scrolled out of the window; the next key brings it back
        // Focus inside an open row's child grid stays there.
        const active = this.template.activeElement;
        if (key.field === DETAIL_FIELD && active && active !== cell && cell.contains(active)) return;
        const target = this.mode === MODE_ACTION ? this.firstControl(cell) || cell : cell;
        if (this.template.activeElement !== target) target.focus();
    }

    measure() {
        const scroller = this.template.querySelector('[data-scroller]');
        if (scroller && scroller.clientHeight) this._measurements.viewport = scroller.clientHeight;
        this.sizeResizeLines(scroller);
        // Measure the SECOND row where there is one: SLDS draws no top border on
        // the first row of the body, so it is 1px shorter than every other row
        // (76px against 77px in Lightning Experience), and at
        // 10,000 rows that pixel would put the spacers 10,000px out. Record rows
        // only: a group's header row is given this height.
        const row =
            this.template.querySelector('tbody tr[data-kind="record"] + tr[data-kind="record"]') ||
            this.template.querySelector('tbody tr[data-kind="record"]');
        const height = row ? row.offsetHeight : 0;
        if (height && Math.abs(height - this.rowHeight) > 1 && !this._measurements.rafPending) {
            this._measurements.rafPending = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => {
                this._measurements.rafPending = false;
                this.rowHeight = height;
            });
        }
        // The scroller's visible width, which changes when a vertical scrollbar
        // comes or goes: an open row's panel takes it, and unpinned
        // columns share it out (sharedWidths).
        const width = scroller ? scroller.clientWidth : 0;
        if (width && width !== this.viewWidth && !this._measurements.viewPending) {
            this._measurements.viewPending = true;
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => {
                this._measurements.viewPending = false;
                this.measureView();
            });
        }
    }

    /**
     * Each column's resize guide line (SLDS's divider, seen while resizing)
     * reaches the bottom of what the scroller shows, and no further. SLDS draws
     * it 100vh tall: invisible, it still counted as content, so a grid of two
     * rows scrolled down into 1,000px of nothing (found in Lightning
     * Experience). The height goes on the sticky header as a CSS
     * variable (gridTable.css .rh-resize-divider), written straight to its
     * style: the header's style is not bound in the template, so a render
     * never wipes it, and changing it re-renders nothing (HR-20). Measured
     * after every render, so a new height, a new row count or a recreated
     * header all get it. A line starts where its header cell does, below the
     * table's top border, so that much is taken off: as tall as the box, it
     * still reached 1px past it. And the box is measured to the fraction of a
     * pixel, then rounded down: a two-row grid's box was 144.5px, which
     * clientHeight reports as 145, and half a pixel of overflow still brought
     * the scrollbar back (both measured in Lightning Experience).
     */
    sizeResizeLines(scroller) {
        const thead = this.template.querySelector('thead.rh-thead');
        const line = thead && thead.querySelector('.rh-resize-divider');
        if (!line || !scroller) return;
        const box = scroller.getBoundingClientRect();
        // The box's height less its borders and any sideways scrollbar. With no
        // layout to measure (Jest), what clientHeight says.
        const inner = box.height
            ? box.height - Math.max(0, scroller.offsetHeight - scroller.clientHeight)
            : scroller.clientHeight;
        const top = Math.max(0, line.getBoundingClientRect().top - box.top - scroller.clientTop);
        const want = Math.max(0, Math.floor(inner - top)) + 'px';
        if (thead.style.getPropertyValue('--rh-divider-height') !== want)
            thead.style.setProperty('--rh-divider-height', want);
    }

    /**
     * A drawn wrapped cell whose text is taller than its lines: the rows need
     * one more line. Checked after a render, written in the next frame
     * (HR-20); the rows grow, never shrink, so this cannot loop.
     */
    measureWrap() {
        if (this._measurements.wrapPending || this.isCards || this.wrapLines >= MAX_LINES) return;
        if (!this.shownColumns.some(c => this.isWrapped(c))) return;
        const cells = this.template.querySelectorAll('.rh-wrap-text');
        let over = false;
        for (let i = 0; i < cells.length && !over; i++) over = cells[i].scrollHeight > cells[i].clientHeight + 1;
        if (!over) return;
        const next = Math.min(MAX_LINES, this.wrapLines + 1);
        this._measurements.wrapPending = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- reactive change outside the render (HR-20)
        requestAnimationFrame(() => {
            this._measurements.wrapPending = false;
            if (next > this.wrapMin) this.wrapMin = next;
        });
    }

    /**
     * The scroller's visible width (see viewWidth). Never from renderedCallback (HR-20).
     *
     * Widths pinned only so that frozen columns have offsets (no width the
     * user chose) are let go when the width changes: the columns share out
     * the new room, and renderedCallback pins them again. Found in Lightning
     * Experience: with a frozen column, closing Charts left a gap at the
     * right, and opening it, or a row's panel bringing a scrollbar, made the
     * grid scroll sideways.
     */
    measureView() {
        if (this.isCards) return;
        const scroller = this.template.querySelector('[data-scroller]');
        const width = scroller ? scroller.clientWidth : 0;
        if (!width || width === this.viewWidth) return;
        if (this.widthsPinned && !this._layout.userResized) {
            this.widths = {};
            this.widthsPinned = false;
        }
        this.viewWidth = width;
    }

    /**
     * Benchmark timings, only with diagnostics on (see c/gridTiming). Called
     * from renderedCallback; each measure is taken after the paint that shows
     * the change. A fresh load (no rows, count unknown) starts the load
     * measures again.
     */
    timeRender() {
        const t = this._timing;
        if (t.key) {
            // Key press to redrawn table, before the paint: the redraw's own cost.
            t.key = false;
            measure(true, 'key-render', 'key-start');
        }
        if (!this.rowCount) {
            if (this._config.totalRows === -1) {
                t.firstRow = false;
                t.fullRender = false;
            }
            return;
        }
        if (!t.firstRow) {
            t.firstRow = true;
            afterPaint(() => measure(true, 'first-row', 'start'));
        }
        if (!t.fullRender && this._config.totalRows !== -1) {
            t.fullRender = true;
            afterPaint(() => measure(true, 'full-render', 'start'));
        }
        if (t.sort) {
            t.sort = false;
            afterPaint(() => measure(true, 'sort', 'sort-start'));
        }
        if (t.commit) {
            t.commit = false;
            afterPaint(() => measure(true, 'commit', 'commit-start'));
        }
    }

    // ============================================================ events: focus

    handleFocusIn(event) {
        // A Total row cell, clicked or reached with the arrow keys.
        const total = this.closestTotalCell(event.target);
        if (total) {
            const field = total.dataset.totalField;
            if (!this.focusKey || this.focusKey.rowId !== TOTALS || this.focusKey.field !== field) {
                this.focusKey = { rowId: TOTALS, field };
            }
            if (!this.editing && this.mode !== MODE_NAVIGATION) this.mode = MODE_NAVIGATION;
            if (!this.hasFocus) this.hasFocus = true;
            if (this.childFocus) this.childFocus = false;
            return;
        }
        const cell = this.closestCell(event.target);
        if (!cell) return;
        const rowId = cell.dataset.rowIndex === '0' ? HEADER : cell.dataset.rowId;
        const field = cell.dataset.field;
        if (!this.focusKey || this.focusKey.rowId !== rowId || this.focusKey.field !== field) {
            this.focusKey = { rowId, field };
        }
        // Focus on the cell itself means navigation mode. Focus on a control inside
        // the cell (after a click on the edit button, say) means actionable mode.
        // Focus inside an open row's child grid is that grid's; here it is the
        // panel's cell, in navigation mode.
        const nextMode = event.target === cell || field === DETAIL_FIELD ? MODE_NAVIGATION : MODE_ACTION;
        if (!this.editing && this.mode !== nextMode) this.mode = nextMode;
        if (!this.hasFocus) this.hasFocus = true;
        const inChild = field === DETAIL_FIELD && event.target !== cell;
        if (this.childFocus !== inChild) this.childFocus = inChild;
    }

    handleFocusOut(event) {
        const root = this.template.querySelector('[data-grid-root]');
        const next = event.relatedTarget;
        if (!next || !root || !root.contains(next)) {
            this.hasFocus = false;
        }
    }

    closestTotalCell(node) {
        let el = node;
        while (el && el.dataset && el.dataset.totalField === undefined) {
            el = el.parentElement;
        }
        return el && el.dataset && el.dataset.totalField !== undefined ? el : null;
    }

    closestCell(node) {
        let el = node;
        while (el && el.dataset && el.dataset.colIndex === undefined) {
            el = el.parentElement;
        }
        return el && el.dataset && el.dataset.colIndex !== undefined ? el : null;
    }

    // ============================================================ events: keys

    handleKeyDown(event) {
        if (this._config.diagnostics === true && !this._timing.key) {
            mark(true, 'key-start');
            this._timing.key = true;
            // A key that changed nothing leaves no redraw to end its measure:
            // clear it once any redraw the key caused has run. LWC queues that
            // redraw as a microtask later in this handler, so this waits one
            // microtask more than it would need to on its own.
            Promise.resolve()
                .then(() => Promise.resolve())
                .then(() => {
                    this._timing.key = false;
                });
        }
        if (this.editing) return; // the editor owns its keys while it is open
        if (this.isCards) return; // cards are ordinary lists and buttons: native keys
        // A key pressed inside an open row's child grid is the child's. Only an
        // Escape it had no use for comes back out, to the row's panel.
        if (this.fromChild(event)) {
            if (event.key === 'Escape' && !event.defaultPrevented) {
                event.preventDefault();
                this.focusCell(this.focusKey, this.positionOfKey(this.focusKey).row);
            }
            return;
        }
        const key = this.focusKey || this.defaultFocusKey();
        if (!key) return;
        if (key.rowId === TOTALS) {
            if (this.mode === MODE_NAVIGATION) this.handleTotalsKey(event, key);
            return;
        }
        // On an open row's panel, Enter goes into the open tab's grid.
        if (this.mode === MODE_NAVIGATION && key.field === DETAIL_FIELD && event.key === 'Enter') {
            event.preventDefault();
            const panel = this.cellElement(key);
            const children = panel && panel.querySelector('c-grid-child-tabs');
            if (children) children.focus();
            return;
        }
        // Enter or Space on a row's toggle opens or closes its child tables;
        // on the column's header, every row's.
        if (
            this.mode === MODE_NAVIGATION &&
            key.field === EXPAND_FIELD &&
            (event.key === 'Enter' || event.key === ' ')
        ) {
            event.preventDefault();
            if (key.rowId === HEADER) this.toggleAll();
            else this.toggleExpand(key.rowId);
            return;
        }
        // Enter, Space or Alt+Down on a record's Actions cell opens its menu.
        if (
            this.mode === MODE_NAVIGATION &&
            key.field === ACTIONS_FIELD &&
            key.rowId !== HEADER &&
            (event.key === 'Enter' || event.key === ' ' || (event.altKey && event.key === 'ArrowDown'))
        ) {
            event.preventDefault();
            this.openRowMenu(key.rowId, 'first');
            return;
        }
        // Enter or Space on a group's Group cell opens or closes the group.
        if (
            this.mode === MODE_NAVIGATION &&
            key.field === GROUP_FIELD &&
            (event.key === 'Enter' || event.key === ' ') &&
            this.groupHeaderFor(key.rowId)
        ) {
            event.preventDefault();
            this.toggleGroup(key.rowId);
            return;
        }
        if (this.mode === MODE_NAVIGATION && this.handleSpreadsheetKey(event, key)) return;
        const isHeader = key.rowId === HEADER;
        const verb = actionFor(event.key, this.mode, {
            isHeader,
            shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            altKey: event.altKey,
            ...this.cellContext(key)
        });
        switch (verb) {
            case 'edit':
                event.preventDefault();
                this.openEditorAt(key);
                break;
            case 'typeToEdit':
                event.preventDefault();
                this.openEditorAt(key, event.key);
                break;
            case 'move':
                event.preventDefault();
                if (this.rangeAnchor) this.setRange(null, null); // a plain move collapses the range
                this.moveFocus(event);
                break;
            case 'enterAction':
                this.enterAction(event);
                break;
            case 'exitAction':
                event.preventDefault();
                this.exitAction();
                break;
            case 'sort':
            case 'addSort':
                if (this.columnByField(key.field)) {
                    event.preventDefault();
                    this.toggleSort(key.field, verb === 'addSort');
                }
                break;
            case 'toggleSelect':
                if (this.hasSelection) {
                    event.preventDefault();
                    this.toggleSelected(key.rowId);
                }
                break;
            default:
        }
    }

    /** Where a navigation key would move focus from the focused cell. */
    targetPosition(event) {
        const from = this.positionOfKey(this.focusKey || this.defaultFocusKey());
        const root = this.template.querySelector('[data-grid-root]');
        const rtl = root ? getComputedStyle(root).direction === 'rtl' : false;
        return nextPosition(
            from,
            event.key,
            { ctrlKey: event.ctrlKey, metaKey: event.metaKey },
            {
                rowCount: this.rowCount,
                colCount: this.ariaColCount,
                pageSize: Math.max(1, Math.floor(this._measurements.viewport / this.rowHeight) - 1),
                rtl
            }
        );
    }

    moveFocus(event) {
        const from = this.positionOfKey(this.focusKey || this.defaultFocusKey());
        const to = this.targetPosition(event);
        if (to.row === from.row && to.col === from.col) {
            // Down from the last row, every row loaded: on to the Total row.
            if (event.key === 'ArrowDown' && from.row === this.rowCount && this.totalsReachable) {
                const field = (this.layoutColumns.find(c => c.colIndex === from.col) || {}).field;
                if (field) {
                    if (this.rangeAnchor) this.setRange(null, null);
                    this.focusTotals(field);
                    return;
                }
            }
            // An edge: stay put. At the last loaded row, the rows below are on
            // their way instead.
            this.maybeLoadMore(from.row);
            return;
        }
        const next = this.keyForPosition(to);
        if (!next) return;
        this.focusCell(next, to.row);
    }

    // ============================================================ spreadsheet keys

    /**
     * The spreadsheet keys (docs/spreadsheet.md), navigation mode only.
     * Returns true when the key was handled here. Cmd+C and Cmd+V are NOT
     * prevented: the browser's copy and paste events must still fire, and they
     * carry the clipboard.
     */
    handleSpreadsheetKey(event, key) {
        const cmd = event.metaKey || event.ctrlKey;
        const letter = typeof event.key === 'string' ? event.key.toLowerCase() : '';
        if (cmd && letter === 'z') {
            event.preventDefault();
            this.dispatchEvent(new CustomEvent(event.shiftKey ? 'redo' : 'undo'));
            return true;
        }
        if (event.ctrlKey && !event.metaKey && letter === 'y') {
            event.preventDefault();
            this.dispatchEvent(new CustomEvent('redo'));
            return true;
        }
        if (key.rowId === HEADER) return false;
        if (event.shiftKey && isNavigationKey(event.key)) {
            event.preventDefault();
            this.extendRange(event);
            return true;
        }
        if (cmd && letter === 'c') {
            this.prepareCopy();
            return true;
        }
        if (cmd && letter === 'v') {
            this.preparePaste();
            return true;
        }
        if (cmd && letter === 'd') {
            event.preventDefault(); // otherwise the browser bookmarks the page
            this.fillDown();
            return true;
        }
        if (!cmd && (event.key === 'Delete' || event.key === 'Backspace')) {
            event.preventDefault();
            this.clearCells();
            return true;
        }
        if (event.key === 'Escape' && this.range) {
            event.preventDefault();
            this.setRange(null, null);
            this.announcement = 'Selection cleared';
            return true;
        }
        return false;
    }

    /** Shift+navigation: move focus, keeping the anchor where the range began. */
    extendRange(event) {
        const key = this.focusKey || this.defaultFocusKey();
        const anchor = this.rangeActive ? this.rangeAnchor : key;
        const to = this.targetPosition(event);
        to.row = Math.max(1, to.row); // never into the header
        to.col = Math.max(this.firstDataCol, to.col); // never into a utility column
        const next = this.keyForPosition(to);
        if (!next) return;
        this.setRange(anchor, next);
        this.focusCell(next, to.row);
        this.announceRange();
    }

    /** Shift+click extends the range to the clicked cell; a plain click collapses it. */
    handleMouseDown(event) {
        if (this.editing || this.isCards || this.fromChild(event)) return; // a click in a child grid is the child's
        const cell = this.closestCell(event.target);
        if (!cell || cell.dataset.rowIndex === '0' || !cell.dataset.rowId) return;
        const field = cell.dataset.field;
        if (field === SELECT_FIELD || field === STATUS_FIELD || field === ACTIONS_FIELD) return;
        if (!event.shiftKey) {
            if (this.rangeAnchor) this.setRange(null, null);
            return;
        }
        event.preventDefault(); // no text selection; focus is placed here instead
        const current = this.focusKey || this.defaultFocusKey();
        const anchor = this.rangeActive ? this.rangeAnchor : current;
        if (!anchor || anchor.rowId === HEADER) return;
        const clicked = { rowId: cell.dataset.rowId, field };
        this.setRange(anchor, clicked);
        this.focusKey = clicked;
        cell.focus();
        this.announceRange();
    }

    /** The value a cell shows: its draft if it has one, else the stored value. */
    currentValue(row, id, field, drafts) {
        const d = drafts[id];
        return d && has(d, field) ? d[field] : row[field];
    }

    /** Data columns from left to right of a rectangle, as column models (null for none). */
    columnsIn(rect) {
        const out = [];
        for (let col = rect.left; col <= rect.right; col++) out.push(this.columnAt(col));
        return out;
    }

    /** Cmd+C: build the text now; the copy event, which follows, writes it. */
    prepareCopy() {
        const rect = this.selectionRect;
        if (!rect) return;
        const names = this._config.refNames || {};
        // A lookup copies the name shown.
        const cols = this.columnsIn(rect)
            .filter(Boolean)
            .map(c => (isLookup(c.type) ? { ...c, names } : c));
        const drafts = this._config.drafts || {};
        const matrix = [];
        for (let r = rect.top; r <= rect.bottom; r++) {
            const row = this.view[r - 1];
            if (row.__group || row.__detail) continue; // records only: a group header or a row's panel holds no values
            const id = String(row[this.keyField]);
            matrix.push(cols.map(c => copyText(this.currentValue(row, id, c.field, drafts), c)));
        }
        if (!matrix.length) return;
        this._clip.copy = { text: toTsv(matrix), count: matrix.length * cols.length };
        // If the copy event never reaches this component, write the text directly.
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- after the browser's own copy event
        setTimeout(() => this.flushCopy(), 0);
    }

    copiedMessage(count) {
        return `Copied ${count} ${count === 1 ? 'cell' : 'cells'}`;
    }

    handleCopy(event) {
        if (this.fromChild(event)) return; // a child grid's copy is its own
        const pending = this._clip.copy;
        if (!pending || !event.clipboardData) return;
        this._clip.copy = null;
        event.preventDefault();
        event.clipboardData.setData('text/plain', pending.text);
        this.announcement = this.copiedMessage(pending.count);
    }

    flushCopy() {
        const pending = this._clip.copy;
        if (!pending) return;
        this._clip.copy = null;
        const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
        if (!clip || typeof clip.writeText !== 'function') {
            this.announcement = 'This browser did not allow copying.';
            return;
        }
        clip.writeText(pending.text).then(
            () => {
                this.announcement = this.copiedMessage(pending.count);
            },
            () => {
                this.announcement = 'This browser did not allow copying.';
            }
        );
    }

    /** Cmd+V: the paste event, which follows, carries the text. */
    preparePaste() {
        this._clip.pastePending = true;
        // If the paste event never reaches this component, ask the clipboard.
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- after the browser's own paste event
        setTimeout(() => this.flushPaste(), 0);
    }

    handlePaste(event) {
        if (this.fromChild(event)) return; // a child grid's paste is its own
        if (this.editing || this.isCards || this.mode !== MODE_NAVIGATION) return;
        const key = this.focusKey;
        if (!key || key.rowId === HEADER || !event.clipboardData) return;
        this._clip.pastePending = false;
        event.preventDefault();
        this.pasteText(event.clipboardData.getData('text/plain'));
    }

    flushPaste() {
        if (!this._clip.pastePending) return;
        this._clip.pastePending = false;
        const clip = typeof navigator !== 'undefined' ? navigator.clipboard : null;
        if (!clip || typeof clip.readText !== 'function') return;
        clip.readText().then(
            text => this.pasteText(text),
            () => {
                this.announcement = 'This browser did not allow pasting.';
            }
        );
    }

    /**
     * Paste tab-separated text into the range, or from the focused cell. A
     * name pasted into a lookup that no record in the grid carries is looked
     * up first (findLookupNames), so it can name any record the user can see;
     * the cells are filled once the answer is in.
     */
    pasteText(text) {
        const rect = this.selectionRect;
        if (!rect) return;
        const block = parseTsv(text);
        const bounds = { rowCount: this.rowCount, colCount: this.ariaColCount };
        // The size first, from the block's and the range's dimensions: a huge
        // paste is refused before a cell of it is listed.
        const size = pasteSize(block, rect, bounds);
        if (size.cells > MAX_PASTE_CELLS) {
            this.announcement = `Nothing was pasted: ${size.cells} cells is more than ${MAX_PASTE_CELLS} at once.`;
            return;
        }
        const plan = pastePlan(block, rect, bounds);
        // The cells to fill, by record, worked out now: the rows may move while names are looked up.
        const targets = [];
        let readOnly = 0;
        plan.cells.forEach(({ row, col, text: cellText }) => {
            if (this.view[row - 1].__group || this.view[row - 1].__detail) return; // a group header or a row's panel takes no values
            const c = this.columnAt(col);
            if (!this.canEditCell(c, String(this.view[row - 1][this.keyField]))) {
                readOnly++;
                return;
            }
            const record = this.view[row - 1];
            targets.push({ id: String(record[this.keyField]), column: c, text: cellText, original: record[c.field] });
        });
        const asks = this.namesToFind(targets);
        if (!asks.length) {
            this.applyPaste(plan, rect, targets, readOnly, {});
            return;
        }
        const token = ++this._clip.token;
        this.announcement = 'Finding the records named in the pasted text…';
        Promise.all(
            asks.map(({ field, names }) =>
                findLookupNames({ configName: this.configName, field, names }).then(namesFound, () => ({}))
            )
        ).then(answers => {
            if (token !== this._clip.token) return; // another paste came first
            const found = Object.assign({}, ...answers);
            // Tell the parent the names, so the cells show them as the grid's own do.
            if (Object.keys(found).length)
                this.dispatchEvent(new CustomEvent('namesfound', { detail: { names: found } }));
            this.applyPaste(plan, rect, targets, readOnly, found);
        });
    }

    /** For each lookup column pasted into: the names neither the grid nor the server has answered for yet. */
    namesToFind(targets) {
        if (!this.configName) return [];
        const byField = new Map();
        targets.forEach(t => {
            if (!isLookup(t.column.type)) return;
            if (!byField.has(t.column.field)) byField.set(t.column.field, []);
            byField.get(t.column.field).push(t.text);
        });
        const out = [];
        byField.forEach((texts, field) => {
            const names = unknownNames(texts, this._config.refNames);
            if (names.length) out.push({ field, names });
        });
        return out;
    }

    /** Fill the pasted cells: each text read for its column, a name against the grid's and the found ones. */
    applyPaste(plan, rect, targets, readOnly, found) {
        const changes = [];
        const errors = [];
        let names = null;
        targets.forEach(({ id, column, text: cellText, original }) => {
            let c = column;
            if (isLookup(c.type)) {
                names = names || nameIndex({ ...(this._config.refNames || {}), ...found });
                c = { ...c, nameIndex: names };
            }
            const parsed = parseCell(cellText, c);
            if (parsed.error) errors.push({ recordId: id, field: c.field, message: parsed.error });
            else changes.push({ recordId: id, field: c.field, value: parsed.value, originalValue: original });
        });
        this.refuseInvalidDependents(changes, errors);
        this.refuseRecordTypeValues(changes, errors);
        // What was pasted becomes the range, with focus on its top-left cell.
        if (plan.cells.length > 1) {
            const last = plan.cells[plan.cells.length - 1];
            const first = this.keyForPosition({ row: rect.top, col: rect.left });
            if (first) {
                this.setRange(this.keyForPosition({ row: last.row, col: last.col }), first);
                this.focusCell(first, rect.top);
            }
        }
        this.emitChanges('paste', changes, errors, { readOnly, dropped: plan.dropped });
    }

    /**
     * Cmd+D: the range's top row into every row below it; for one cell, the
     * cell above into it, as in Excel.
     */
    fillDown() {
        let rect = this.range;
        if (!rect) {
            const one = this.selectionRect;
            if (!one) return;
            if (one.top <= 1) {
                this.announcement = 'There is no row above to fill down from.';
                return;
            }
            rect = { ...one, top: one.top - 1 };
        }
        if (rect.bottom === rect.top) {
            this.announcement = 'Select two or more rows to fill down.';
            return;
        }
        const drafts = this._config.drafts || {};
        const source = this.view[rect.top - 1];
        if (source.__group || source.__detail) {
            this.announcement = source.__group
                ? 'Fill down starts from a record, not a group.'
                : 'Fill down starts from a record, not its related records.';
            return;
        }
        const sourceId = String(source[this.keyField]);
        const changes = [];
        let readOnly = 0;
        const shortened = [];
        this.columnsIn(rect).forEach(c => {
            // A value the server shortened (TC-055) would fill the rows with the
            // shortened copy: that column is left out, and said.
            const cut =
                c &&
                Array.isArray(source._cut) &&
                source._cut.includes(c.field) &&
                !has(drafts[sourceId] || {}, c.field);
            if (cut) {
                shortened.push(c.label || c.field);
                return;
            }
            const value = c ? this.currentValue(source, sourceId, c.field, drafts) : null;
            for (let r = rect.top + 1; r <= rect.bottom; r++) {
                const record = this.view[r - 1];
                if (record.__group || record.__detail) continue; // records only
                if (!this.canEditCell(c, String(record[this.keyField]))) {
                    readOnly++;
                    continue;
                }
                changes.push({
                    recordId: String(record[this.keyField]),
                    field: c.field,
                    value,
                    originalValue: record[c.field]
                });
            }
        });
        const errors = [];
        this.refuseRecordTypeValues(changes, errors);
        this.emitChanges('fill down', changes, errors, { readOnly });
        if (shortened.length) {
            // Said after what was filled, not instead of it.
            const done = changes.length ? `${this.announcement} ` : '';
            this.announcement = `${done}${shortened.join(', ')} not filled down: the text is too long to copy here. Edit it on its own.`;
        }
    }

    /** Delete or Backspace: clear the editable cells of the range. */
    clearCells() {
        const rect = this.selectionRect;
        if (!rect) return;
        const cols = this.columnsIn(rect);
        const changes = [];
        let readOnly = 0;
        for (let r = rect.top; r <= rect.bottom; r++) {
            const record = this.view[r - 1];
            if (record.__group || record.__detail) continue; // records only
            for (const c of cols) {
                if (!this.canEditCell(c, String(record[this.keyField]))) {
                    readOnly++;
                    continue;
                }
                // TC-042: a checkbox is never blank, so clearing unchecks it.
                const blank = c.type === 'checkbox' || c.type === 'boolean' ? false : null;
                changes.push({
                    recordId: String(record[this.keyField]),
                    field: c.field,
                    value: blank,
                    originalValue: record[c.field]
                });
            }
        }
        this.emitChanges('clear', changes, [], { readOnly });
    }

    /**
     * A pasted dependent picklist value must go with its row's controlling
     * value: the one pasted alongside it, else the current one.
     * Refused values move from changes to errors.
     */
    refuseInvalidDependents(changes, errors) {
        if (!this.columns.some(c => c.dependentOn)) return;
        const drafts = this._config.drafts || {};
        const pasted = new Map(changes.map(ch => [ch.recordId + '|' + ch.field, ch.value]));
        for (let i = changes.length - 1; i >= 0; i--) {
            const ch = changes[i];
            const c = this.columnByField(ch.field);
            if (!c || !c.dependentOn) continue;
            const key = ch.recordId + '|' + c.dependentOn;
            const row = this.view[this.positionOf(ch.recordId)];
            const controlling = pasted.has(key)
                ? pasted.get(key)
                : row
                  ? this.currentValue(row, ch.recordId, c.dependentOn, drafts)
                  : null;
            if (!isValidDependent(c, ch.value, controlling)) {
                const controller = (this.columnByField(c.dependentOn) || {}).label || c.dependentOn;
                errors.push({
                    recordId: ch.recordId,
                    field: ch.field,
                    message: `${ch.value} is not offered when ${controller} is ${isBlank(controlling) ? 'blank' : controlling}.`
                });
                changes.splice(i, 1);
            }
        }
    }

    /**
     * A picklist value pasted or filled down must be one the row's record type
     * allows, as Salesforce's record page offers. Refused values move from
     * changes to errors.
     */
    refuseRecordTypeValues(changes, errors) {
        const byType = this._config.recordTypePicklists;
        if (!byType) return;
        for (let i = changes.length - 1; i >= 0; i--) {
            const ch = changes[i];
            const c = this.columnByField(ch.field);
            const row = c && this.view[this.positionOf(ch.recordId)];
            if (row && !isAllowedForRecordType(c, ch.value, row, byType)) {
                errors.push({
                    recordId: ch.recordId,
                    field: ch.field,
                    message: `${ch.value} is not available for this record's record type.`
                });
                changes.splice(i, 1);
            }
        }
    }

    /** One action's changes as one event, so the parent keeps them as one undo step. */
    emitChanges(label, changes, errors, { readOnly = 0, dropped = 0 } = {}) {
        // An edit of a controlling field clears dependent values it invalidates.
        const clears = this.forcedClears(changes);
        if (clears.length) changes = changes.concat(clears);
        if (changes.length || errors.length) {
            this.dispatchEvent(new CustomEvent('cellschange', { detail: { label, changes, errors } }));
        }
        const verbs = { paste: 'Pasted', 'fill down': 'Filled down', clear: 'Cleared' };
        const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
        const parts = [`${verbs[label] || 'Changed'} ${plural(changes.length, 'cell', 'cells')}.`];
        if (readOnly) parts.push(`${plural(readOnly, 'read-only cell', 'read-only cells')} skipped.`);
        if (errors.length) parts.push(`${plural(errors.length, 'value', 'values')} could not be used.`);
        if (dropped) parts.push(`${plural(dropped, 'value', 'values')} did not fit.`);
        if (clears.length) parts.push(this.clearedMessage(clears));
        this.announcement = parts.join(' ');
    }

    /**
     * Focus a row the parent names (config.focusRow): on a new row its first
     * cell that can be filled in, on a saved record its first data cell,
     * bringing the row into view. Cards focus the card's heading.
     */
    focusRowNow(rowId) {
        const index = this.positionOf(rowId);
        if (index < 0) return;
        if (this.isCards) {
            this._layout.focusCard = index + 1;
            this.focusRev++;
            return;
        }
        const data = this.layoutColumns.filter(c => !c.utility);
        const column = (this.isNewRow(rowId) && data.find(c => this.canEditCell(c, rowId))) || data[0];
        if (!column) return;
        this.focusCell({ rowId: String(rowId), field: column.field }, index + 1);
    }

    /** Move focus to a cell, bringing its row into the window first if needed. */
    focusCell(key, rowNumber) {
        this.focusKey = key;
        this.maybeLoadMore(rowNumber);
        if (rowNumber > 0 && this.isWindowed) {
            const { start, end } = this.windowRange;
            const index = rowNumber - 1;
            if (index < start || index >= end) {
                this.firstRow = index;
                const scroller = this.template.querySelector('[data-scroller]');
                if (scroller) scroller.scrollTop = this.rowTopOf(index);
                this._layout.restoreFocus = true; // the cell does not exist yet
                return;
            }
        }
        const el = this.cellElement(key);
        if (el) el.focus();
        else this._layout.restoreFocus = true;
    }

    enterAction(event) {
        const cell = this.cellElement(this.focusKey || this.defaultFocusKey());
        const control = this.firstControl(cell);
        if (!control) return; // nothing actionable in this cell
        event.preventDefault();
        this.mode = MODE_ACTION;
        this._layout.restoreFocus = true; // focus the control once it is tabbable
    }

    exitAction() {
        this.mode = MODE_NAVIGATION;
        this._layout.restoreFocus = true;
    }

    // ============================================================ sorting

    handleSortClick(event) {
        event.preventDefault();
        this.toggleSort(event.currentTarget.dataset.field, event.shiftKey);
    }

    /**
     * Click: sort by this column, or flip it if it is already the primary key.
     * Shift+click: add it as a secondary key, or flip it if already present.
     */
    toggleSort(field, additive) {
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        const keys = this.sortKeys.map(k => ({ ...k }));
        const existing = keys.findIndex(k => k.field === field);
        let next;
        if (additive) {
            if (existing >= 0) keys[existing].direction = keys[existing].direction === 'asc' ? 'desc' : 'asc';
            else keys.push({ field, direction: 'asc' });
            next = keys;
        } else if (existing === 0 && keys.length) {
            next = [{ field, direction: keys[0].direction === 'asc' ? 'desc' : 'asc' }];
        } else {
            next = [{ field, direction: 'asc' }];
        }
        this.setSort(next);
    }

    setSort(next) {
        if (this._config.diagnostics === true) {
            mark(true, 'sort-start');
            this._timing.sort = true;
        }
        // A range is positions in the current order; after a sort those
        // positions hold other records, so the range goes.
        this.setRange(null, null);
        this.sortKeys = next;
        if (!next.length) {
            this.announcement = 'Default order';
            this.dispatchEvent(new CustomEvent('sortchange', { detail: { sort: [] } }));
            return;
        }
        const labelOf = k =>
            ((this.columnByField(k.field) || {}).label || k.field) +
            ' ' +
            (k.direction === 'asc' ? 'ascending' : 'descending');
        this.announcement = 'Sorted by ' + next.map(labelOf).join(', then by ');
        this.dispatchEvent(new CustomEvent('sortchange', { detail: { sort: next.map(k => ({ ...k })) } }));
    }

    // ============================================================ scrolling

    handleScroll(event) {
        this.followScroll(event.currentTarget);
        if ((!this.isWindowed && !this.hasMoreRows) || this._measurements.scrollPending) return;
        const scroller = event.currentTarget;
        this._measurements.scrollPending = true;
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        requestAnimationFrame(() => {
            this._measurements.scrollPending = false;
            const first = this.detailRows.length
                ? this.rowAtOffset(scroller.scrollTop)
                : Math.floor(scroller.scrollTop / this.rowHeight);
            // Re-window only when the viewport has moved a meaningful distance.
            if (this.isWindowed && Math.abs(first - this.firstRow) >= WINDOW_BUFFER / 2) {
                this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
                this.firstRow = first;
                // A row's menu scrolled that far is out of sight: closed, so it
                // does not come back open with its row.
                if (this.rowMenu) this.closeRowMenu(false);
            }
            this.maybeLoadMore(first + Math.ceil(this._measurements.viewport / this.rowHeight));
        });
    }

    /**
     * Open rows' panels stay at the visible left edge as the table scrolls
     * sideways: their left margin is the scroller's scrollLeft, a CSS
     * variable on the tbody. Written straight to the style, not rendered, so a
     * sideways scroll re-renders nothing; the tbody's style is not bound in the
     * template, so a render never wipes it. Not position: sticky, which would
     * trap a child grid's dialogs under the parent's rows (see gridTable.css).
     */
    followScroll(scroller) {
        const x = scroller ? scroller.scrollLeft : 0;
        if (x === this._measurements.scrollLeft) return;
        this._measurements.scrollLeft = x;
        const body = this.template.querySelector('tbody');
        if (body) body.style.setProperty('--rh-scroll-left', x + 'px');
    }

    // ============================================================ selection

    handleSelectClick(event) {
        event.stopPropagation();
        this.toggleSelected(event.currentTarget.dataset.rowId);
    }

    handleSelectAll(event) {
        const checked = event.target.checked;
        const next = {};
        if (checked) {
            const cap = this._config.maxSelected || Infinity;
            // Records only, in closed groups too.
            this.sortedRows.slice(0, cap).forEach(r => {
                next[String(r[this.keyField])] = true;
            });
        }
        this.selected = next;
        this.emitSelection();
    }

    toggleSelected(rowId) {
        if (!rowId || rowId === HEADER || !this.hasSelection || this.groupHeaderFor(rowId)) return;
        const item = this.view[this.positionOf(rowId)];
        if (!item || item.__detail) return; // a row's panel is not a record
        let next;
        if (this.isMulti) {
            next = { ...this.selected };
            if (next[rowId]) delete next[rowId];
            else if (!this._config.maxSelected || Object.keys(next).length < this._config.maxSelected)
                next[rowId] = true;
        } else {
            next = this.selected[rowId] ? {} : { [rowId]: true };
        }
        this.selected = next;
        this.emitSelection();
    }

    emitSelection() {
        this.dispatchEvent(new CustomEvent('selectionchange', { detail: { selectedIds: Object.keys(this.selected) } }));
    }

    // ============================================================ editing

    handleEditClick(event) {
        event.stopPropagation();
        const { rowId, field } = event.currentTarget.dataset;
        this.openEditorAt({ rowId, field }, undefined, event.currentTarget.closest('td'));
    }

    /**
     * { editable, hasLink } for a data cell of a record, for the keys that
     * start editing; both false for a header, a utility column, a group
     * or a panel.
     */
    cellContext(key) {
        const none = { editable: false, hasLink: false };
        if (!key || key.rowId === HEADER) return none;
        const column = this.columnByField(key.field);
        if (!column) return none;
        const row = this.view[this.positionOf(key.rowId)];
        if (!row || row.__group || row.__detail) return none;
        const value = this.currentValue(row, key.rowId, key.field, this._config.drafts || {});
        return {
            editable: this.canEditCell(column, key.rowId) && !this.isSaving,
            hasLink: Boolean(this.linkFor(column, key.rowId, value).href)
        };
    }

    /**
     * Open the editor on a cell: from the pencil, F2, Enter, a double-click, or
     * a typed character (`seed`), which becomes the new value so far in a text,
     * number or lookup editor.
     */
    openEditorAt(key, seed, cellEl) {
        const column = this.columnByField(key.field);
        if (!this.canEditCell(column, key.rowId) || this.isSaving) return;
        const editor = this.editorFor(column, key.rowId);
        this.placeEditor(cellEl || this.cellElement(key), column, editor, this.bulkCount(key.rowId) ? BULK_ROOM : 0);
        const takesSeed = editor === 'text' || editor === 'number' || editor === 'lookup';
        this.focusKey = { rowId: key.rowId, field: key.field };
        this.editing = { rowId: key.rowId, field: key.field, seed: takesSeed ? seed : undefined, applyAll: false };
        this._layout.focusEditor = true;
        this.listenForBulkKey(true);
    }

    /**
     * Ctrl+Enter (Command+Enter on a Mac) is read on the window, in the
     * capture phase, while an editor is open: each editor keeps Enter to
     * itself (it commits), so the table would never see it.
     */
    listenForBulkKey(on) {
        if (typeof window === 'undefined') return;
        if (on && !this._bulk.onKey) {
            this._bulk.onKey = event => this.onBulkKey(event);
            window.addEventListener('keydown', this._bulk.onKey, true);
        } else if (!on && this._bulk.onKey) {
            window.removeEventListener('keydown', this._bulk.onKey, true);
            this._bulk.onKey = null;
        }
    }

    /**
     * Ctrl+Enter in this grid's open editor, on one of several selected rows:
     * the editor's own Enter commits, and the commit goes to every selected
     * row. Not in the text area editor, where Ctrl+Enter is how a long text is
     * committed: there the box sends it to every row. The multi-select
     * picklist has no Enter of its own, so it is committed here.
     */
    onBulkKey(event) {
        // One editor is open at a time on the page: opening another commits this one.
        if (!this.editing || event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
        if (!this.bulkCount(this.editing.rowId)) return;
        const column = this.columnByField(this.editing.field);
        const kind = column ? this.editorFor(column, this.editing.rowId) : 'text';
        if (kind === 'textarea') return;
        this._bulk.all = true;
        clearTimeout(this._bulk.timer);
        // After the editor's own handling of this key, whatever it did.
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- cleared on the next key and on disconnect
        this._bulk.timer = setTimeout(() => {
            this._bulk.all = false;
        }, 0);
        if (kind === 'multipicklist') {
            event.preventDefault();
            event.stopPropagation();
            const editor = this.template.querySelector('[data-editor]');
            if (editor && typeof editor.commit === 'function') editor.commit();
        }
    }

    /** The editor's "Update N selected items": checked or not, focus goes back to the editor. */
    handleBulkToggle(event) {
        if (!this.editing) return;
        this.editing = { ...this.editing, applyAll: event.target.checked === true };
        this._layout.focusEditor = true;
    }

    /** Enter on the box commits the editor, as Enter in the editor does; Escape cancels. */
    handleBulkKeyDown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            const editor = this.template.querySelector('[data-editor]');
            if (editor && typeof editor.commit === 'function') editor.commit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.closeEditor();
        }
    }

    /**
     * The editor a cell opens: its column type's, or the text area for a value
     * the server shortened (TC-055), whatever the column's type.
     */
    editorFor(column, rowId) {
        const row = this.view[this.positionOf(rowId)];
        const drafts = (this._config.drafts || {})[rowId];
        const cut =
            row && Array.isArray(row._cut) && row._cut.includes(column.field) && !(drafts && has(drafts, column.field));
        return cut ? 'textarea' : EDITOR_BY_TYPE[column.type] || 'text';
    }

    /**
     * { [field]: { lo, hi } }: the range a data bar measures against,
     * from zero when every loaded value is on one side of it, else from the
     * lowest to the highest. Memoised on the rows, the edits and the rules.
     */
    get barScales() {
        const m = this._memo;
        const deps = [this._config.rows, this._config.drafts, this.displayRules];
        if (m.barDeps && m.barDeps.every((d, i) => d === deps[i])) return m.barScales;
        const fields = [...new Set(this.displayRules.filter(r => r.kind === 'databar' && r.field).map(r => r.field))];
        const out = {};
        if (fields.length) {
            const rows = Array.isArray(this._config.rows) ? this._config.rows : [];
            const drafts = this._config.drafts || {};
            fields.forEach(f => {
                let lo = 0;
                let hi = 0;
                rows.forEach(row => {
                    const d = drafts[row[this.keyField]];
                    const n = Number(d && has(d, f) ? d[f] : row[f]);
                    if (Number.isFinite(n)) {
                        if (n < lo) lo = n;
                        if (n > hi) hi = n;
                    }
                });
                out[f] = { lo, hi };
            });
        }
        m.barDeps = deps;
        m.barScales = out;
        return out;
    }

    /** A value's bar, 0 to 100 (per cent of the cell), or null for no bar. */
    barPercent(field, value) {
        const n = Number(value);
        const scale = this.barScales[field];
        if (isBlank(value) || !Number.isFinite(n) || !scale || scale.hi === scale.lo) return null;
        return Math.round(((n - scale.lo) / (scale.hi - scale.lo)) * 100);
    }

    /** A double-click on an editable cell edits it, as in a spreadsheet. */
    handleDoubleClick(event) {
        if (this.editing || this.isCards || this.fromChild(event)) return;
        const cell = this.closestCell(event.target);
        if (!cell || cell.dataset.rowIndex === '0' || !cell.dataset.rowId) return;
        // A double-click on a link or a control is theirs.
        if (event.target !== cell && event.target.closest && event.target.closest('a, button, input')) return;
        const key = { rowId: cell.dataset.rowId, field: cell.dataset.field };
        if (!this.cellContext(key).editable) return;
        event.preventDefault();
        this.openEditorAt(key, undefined, cell);
    }

    /**
     * Make room for the editor about to open in `cell`. The edit
     * popover sits inside the scroller, so the scroller clips it: in a grid
     * of one row a lookup's matches were cut off below the row, and a wide
     * editor in the last column ran off the right edge (found in Lightning
     * Experience). So a grid shorter than the editor needs grows
     * while it is open, up to its usual maximum, and a wide editor with no
     * room to its right opens leftwards from the cell's right edge instead.
     * The box itself is always the cell's width; only what
     * hangs below it (DROPDOWN_WIDTH) is wider, so that is what opens
     * leftwards: the editor is told through `dropdown-align`.
     * And a cell near the bottom of a grid already at its full height had
     * nowhere to grow: the date calendar showed only its first week. So what hangs
     * from the box opens upwards instead when the grid cannot grow enough to hold it
     * below and there is room above (`dropdown-up`).
     */
    placeEditor(cell, column, editorKind, extra = 0) {
        const scroller = this.template.querySelector('[data-scroller]');
        if (!cell || !scroller) {
            this.editRoom = 0;
            this.editAlignRight = false;
            this.editUp = false;
            return;
        }
        const box = scroller.getBoundingClientRect();
        const rect = cell.getBoundingClientRect();
        const editor = editorKind || EDITOR_BY_TYPE[column.type] || 'text';
        const room = (EDITOR_ROOM_BY[editor] || EDITOR_ROOM) + extra;
        const need = Math.ceil(rect.bottom - box.top + room);
        const width = DROPDOWN_WIDTH[editor] || 0;
        this.editUp = width > 0 && need > this.maxScrollerHeight && rect.top - box.top >= room;
        this.editRoom = !this.editUp && need > scroller.clientHeight ? need : 0;
        this.editAlignRight = width > 0 && rect.left + width > box.right && rect.right - width >= box.left;
    }

    handleEditorCommit(event) {
        const { rowId, field, applyAll } = this.editing || {};
        if (!rowId) return;
        if (this._config.diagnostics === true) {
            mark(true, 'commit-start');
            this._timing.commit = true;
        }
        const row = this.view[this.positionOf(rowId)];
        const toSelected = (applyAll === true || this._bulk.all) && this.bulkCount(rowId) > 0;
        this._bulk.all = false;
        this.closeEditor();
        if (toSelected) {
            // Every selected row: the parent applies it as Update field does, one undo step.
            const detail = { recordId: rowId, field, value: event.detail.value };
            if (event.detail.label !== undefined) detail.valueLabel = event.detail.label;
            this.dispatchEvent(new CustomEvent('applyselected', { detail }));
            return;
        }
        const change = { recordId: rowId, field, value: event.detail.value, originalValue: row ? row[field] : null };
        // A lookup editor also says the chosen record's name, so the cell can show it at once.
        if (event.detail.label !== undefined) change.valueLabel = event.detail.label;
        const clears = this.forcedClears([change]);
        if (clears.length) {
            // One undo step: the controlling edit and the dependent values it cleared.
            this.dispatchEvent(
                new CustomEvent('cellschange', { detail: { label: 'edit', changes: [change, ...clears], errors: [] } })
            );
            this.announcement = this.clearedMessage(clears);
            return;
        }
        this.dispatchEvent(new CustomEvent('cellchange', { detail: change }));
    }

    /** Dependent picklist values that one action's changes make invalid, as clearing changes. */
    forcedClears(changes) {
        if (!this.columns.some(c => c.dependentOn)) return [];
        const drafts = this._config.drafts || {};
        const rowOf = id => this.view[this.positionOf(id)];
        const current = (id, f) => {
            const r = rowOf(id);
            return r ? this.currentValue(r, id, f, drafts) : null;
        };
        const original = (id, f) => {
            const r = rowOf(id);
            return r ? r[f] : null;
        };
        return dependentClears(changes, this.columns, current, original);
    }

    clearedMessage(clears) {
        const fields = [...new Set(clears.map(c => (this.columnByField(c.field) || {}).label || c.field))];
        return `${fields.join(', ')} cleared: ${clears.length === 1 ? 'its value does' : 'their values do'} not go with the new value.`;
    }

    handleEditorCancel() {
        this.closeEditor();
    }

    /**
     * A lookup's New item: the editor closes and the grid view opens the
     * record form; the new record becomes this cell's value when it is saved.
     */
    handleEditorNewRecord(event) {
        const { rowId, field } = this.editing || {};
        if (!rowId) return;
        this.closeEditor();
        const detail = event.detail || {};
        this.dispatchEvent(
            new CustomEvent('newrecord', {
                detail: {
                    recordId: rowId,
                    field,
                    object: detail.object,
                    objectLabel: detail.label,
                    term: detail.term || ''
                }
            })
        );
    }

    /** Clicking outside the edit popover commits, as in the SLDS blueprint. */
    handleEditorFocusOut(event) {
        const popover = event.currentTarget;
        if (event.relatedTarget && popover.contains(event.relatedTarget)) return;
        const editor = popover.querySelector('[data-editor]');
        if (!editor || typeof editor.commit !== 'function') return;
        // A required field left blank is refused in the editor, which stays
        // open with its message; focus goes back to it.
        if (editor.commit() === false && typeof editor.focus === 'function') {
            Promise.resolve().then(() => editor.focus());
        }
    }

    closeEditor() {
        this.listenForBulkKey(false);
        this.editing = null;
        this.editRoom = 0;
        this.editAlignRight = false;
        this.editUp = false;
        this.mode = MODE_NAVIGATION;
        this._layout.restoreFocus = true;
    }

    // ============================================================ resizing

    /**
     * The first resize pins every column at the width it is rendered at.
     *
     * WHY: the table is fixed-layout at 100% of the grid, and a fixed-layout
     * table stretches its columns to fill that width. A column dragged to
     * 406px rendered at 500.
     * Pinned, the table is exactly the sum of its columns: shrinking a column
     * leaves space at the right, widening one scrolls sideways, as a
     * spreadsheet does. Nothing moves when it happens: each column is pinned
     * at the width it already had, rounded down (columns share the space out
     * in fractions, 500.6px say, and rounding up would add a scrollbar for
     * the sake of a pixel).
     */
    pinWidths() {
        if (this.widthsPinned) return;
        const measured = { ...this.widths };
        this.template.querySelectorAll('thead th[data-field]').forEach(th => {
            const field = th.dataset.field;
            const width = Math.floor(th.getBoundingClientRect().width);
            if (field !== SELECT_FIELD && field !== STATUS_FIELD && width > 0) measured[field] = width;
        });
        this.widths = measured;
        this.widthsPinned = true;
    }

    /** Pin on focus, so the range input starts from the real width, not the default. */
    handleResizeFocus() {
        this.pinWidths();
    }

    handleResizeInput(event) {
        const field = event.target.dataset.field;
        this.pinWidths();
        this.setWidth(field, Number(event.target.value));
        this.emitLayout(); // the parent waits for the last one before keeping it
    }

    /**
     * An arrow key on the width control moves it RESIZE_STEP pixels, as a list
     * view's column does, not the range input's one pixel. Page Up and Page
     * Down, Home and End stay the input's own.
     */
    handleResizeKeydown(event) {
        const sign = RESIZE_KEYS[event.key];
        if (!sign) return;
        event.preventDefault();
        const input = event.target;
        const field = input.dataset.field;
        this.pinWidths();
        const from = Number(this.widths[field]) || Number(input.value) || DEFAULT_WIDTH;
        this.setWidth(field, from + sign * RESIZE_STEP); // the input's value follows from the template
        this.emitLayout();
    }

    handleResizeStart(event) {
        event.preventDefault();
        event.stopPropagation();
        const field = event.currentTarget.dataset.field;
        const th = event.currentTarget.closest('th');
        this.pinWidths();
        const startX = event.clientX;
        const startWidth = this.widths[field] || (th ? th.offsetWidth : DEFAULT_WIDTH);
        const move = e => this.setWidth(field, startWidth + (e.clientX - startX));
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            this.emitLayout(); // the width the user let go at
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    }

    /**
     * A double-click on a column's resize handle fits the column to its
     * widest loaded value, as Excel does: up to FIT_CAP for a number
     * or a date, TEXT_FIT_CAP for text.
     */
    handleResizeDblClick(event) {
        event.preventDefault();
        event.stopPropagation();
        const field = event.currentTarget.dataset.field;
        const column = this.columnByField(field);
        if (!column) return;
        let texts;
        if (fitsToValues(column.type)) {
            texts = this.longestValues(column).map(v => this.shownText(v, column));
        } else {
            // Text by what it shows: a lookup's name, a picklist's label.
            const rows = Array.isArray(this._config.rows) ? this._config.rows : [];
            const seen = new Set();
            rows.forEach(r => {
                const v = r[field];
                if (!isBlank(v)) seen.add(this.shownText(v, column));
            });
            texts = [...seen].sort((a, b) => b.length - a.length).slice(0, FIT_SAMPLE);
        }
        const cap = fitsToValues(column.type) ? FIT_CAP : TEXT_FIT_CAP;
        this.pinWidths();
        this.setWidth(
            field,
            fitWidth(texts, { type: column.type, editable: this.editableGrid, label: column.label || field, cap })
        );
        this.emitLayout();
    }

    setWidth(field, px) {
        this._layout.userResized = true;
        const width = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px)));
        this.widths = { ...this.widths, [field]: width };
        const label = field === GROUP_FIELD ? 'Group' : (this.columnByField(field) || {}).label || field;
        this.announcement = `${label} column width ${width} pixels`;
    }

    // ============================================================ column menu
    //
    // SLDS header-menu markup (a chevron button with aria-haspopup, then an
    // slds-dropdown) with the APG menu-button keyboard model: Enter, Space or
    // Down Arrow opens on the first item, Up Arrow on the last; arrows, Home and
    // End move; Enter or Space chooses; Escape closes. Focus goes back to the
    // button either way. The button is a control inside the header cell, so it
    // is only in the tab order in actionable mode: one tab stop is preserved.

    handleMenuButton(event) {
        event.stopPropagation();
        const field = event.currentTarget.dataset.field;
        if (this.menuOpenFor === field) this.closeMenu(true);
        else this.openMenu(field, 'first');
    }

    handleMenuButtonKeyDown(event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        this.openMenu(event.currentTarget.dataset.field, event.key === 'ArrowUp' ? 'last' : 'first');
    }

    handleMenuKeyDown(event) {
        this.navigateMenu(
            event,
            item => this.chooseMenuItem(item),
            () => this.closeMenu(true)
        );
    }

    /** The menu keys, for a column menu and a row's actions menu alike: move, choose, close. */
    navigateMenu(event, choose, close) {
        const items = [
            ...event.currentTarget.querySelectorAll(
                '[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]'
            )
        ];
        const i = items.indexOf(event.target);
        let next;
        switch (event.key) {
            case 'ArrowDown':
                next = (i + 1) % items.length;
                break;
            case 'ArrowUp':
                next = (i - 1 + items.length) % items.length;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = items.length - 1;
                break;
            case 'Enter':
            case ' ':
                event.preventDefault();
                event.stopPropagation();
                choose(event.target);
                return;
            case 'Escape':
                event.preventDefault();
                event.stopPropagation(); // the grid would otherwise leave actionable mode
                close();
                return;
            default:
                return; // Tab leaves the menu; focusout closes it
        }
        event.preventDefault();
        event.stopPropagation();
        items[next].focus();
    }

    // ============================================================ the user's columns

    /** The parent keeps the choice: say what it is now. */
    emitColumns(choice) {
        this.dispatchEvent(
            new CustomEvent('columnschange', {
                detail: { choice: choice ? { order: choice.order.slice(), hidden: choice.hidden.slice() } : null }
            })
        );
    }

    labelOf(field) {
        const c = this.columnByField(field);
        return (c && c.label) || field;
    }

    /**
     * Hide column, from its menu. Focus goes to the column that takes its
     * place (the next one, or the one before when it was last), on its header.
     */
    hideByUser(field) {
        const choice = this._config.columnChoice;
        if (!canHide(this.columns, choice, field)) return;
        const shown = this.shownColumns;
        const at = shown.findIndex(c => c.field === field);
        const neighbour = shown[at + 1] || shown[at - 1];
        if (neighbour) {
            this._nav.focus = { rowId: HEADER, field: neighbour.field };
            this.focusRev++;
            this._layout.restoreFocus = true;
        }
        this.announcement = `${this.labelOf(field)} hidden. Choose columns shows it again.`;
        this.emitColumns(hideColumn(this.columns, choice, field));
    }

    handleHeaderDragStart(event) {
        const field = event.currentTarget.dataset.field;
        if (!field || this.isCards || this.editing || this._config.saving || this.shownColumns.length < 2) {
            event.preventDefault();
            return;
        }
        this._layout.dragField = field;
        if (this.menuOpenFor !== null) this.closeMenu(false);
        try {
            event.dataTransfer.effectAllowed = 'move';
            // Firefox starts a drag only with some data; the label, not a link.
            event.dataTransfer.setData('text/plain', this.labelOf(field));
        } catch {
            // Some browsers keep dataTransfer read-only here; the drag still works.
        }
        this.draggingField = field;
        // The drop zone that groups by it, a moment later: changing the
        // page under a drag as it starts can end it at once in Chrome.
        if (this.canDropToGroup(field)) {
            // eslint-disable-next-line @lwc/lwc/no-async-operation -- after the drag has begun, not during dragstart
            setTimeout(() => {
                if (this._layout.dragField === field) this.groupZoneField = field;
            }, 0);
        }
    }

    /** A header the grid could group by, dropped on the Group header or the drop zone: not already a level, and room for one more. */
    canDropToGroup(field) {
        const c = this.columnByField(field);
        if (!c || c.groupable !== true || this.isCards) return false;
        const levels = this.grouping;
        return levels.length < MAX_LEVELS && !levels.some(l => l.field === field);
    }

    /** The bar above the table a groupable header is dropped on, while one is dragged. Mouse only, so hidden from screen readers. */
    get groupDropZone() {
        const field = this.groupZoneField;
        if (!field || !this.canDropToGroup(field)) return null;
        const label = this.labelOf(field);
        const over = Boolean(this.dropTarget) && this.dropTarget.field === GROUP_ZONE;
        return {
            label: this.isGrouped ? `Drop here to add ${label} to the grouping` : `Drop here to group by ${label}`,
            cls:
                'slds-grid slds-grid_vertical-align-center slds-m-horizontal_small slds-m-bottom_x-small rh-group-zone' +
                (over ? ' rh-group-zone_over' : '')
        };
    }

    handleGroupZoneDragOver(event) {
        const from = this._layout.dragField;
        if (!from || !this.canDropToGroup(from)) return;
        event.preventDefault();
        try {
            event.dataTransfer.dropEffect = 'move';
        } catch {
            // read-only in some browsers
        }
        if (!this.dropTarget || this.dropTarget.field !== GROUP_ZONE)
            this.dropTarget = { field: GROUP_ZONE, after: false };
    }

    handleGroupZoneDragLeave(event) {
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
        if (this.dropTarget && this.dropTarget.field === GROUP_ZONE) this.dropTarget = null;
    }

    handleGroupZoneDrop(event) {
        event.preventDefault();
        const from = this._layout.dragField;
        this.endDrag();
        if (from && this.canDropToGroup(from)) this.changeGrouping(this.isGrouped ? 'add' : 'group', from);
    }

    /** Over another header: show which side the column would land on. Over the Group header, that it would group by it. */
    handleHeaderDragOver(event) {
        const from = this._layout.dragField;
        const to = event.currentTarget.dataset.field;
        if (from && to === GROUP_FIELD && this.canDropToGroup(from)) {
            event.preventDefault();
            try {
                event.dataTransfer.dropEffect = 'move';
            } catch {
                // read-only in some browsers
            }
            if (!this.dropTarget || this.dropTarget.field !== GROUP_FIELD)
                this.dropTarget = { field: GROUP_FIELD, after: false };
            return;
        }
        if (!from || !to || to === GROUP_FIELD || !this.shownColumns.some(c => c.field === to)) return;
        event.preventDefault();
        try {
            event.dataTransfer.dropEffect = 'move';
        } catch {
            // read-only in some browsers
        }
        if (to === from) {
            if (this.dropTarget) this.dropTarget = null;
            return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        const after = event.clientX > box.left + box.width / 2;
        if (!this.dropTarget || this.dropTarget.field !== to || this.dropTarget.after !== after)
            this.dropTarget = { field: to, after };
    }

    handleHeaderDragLeave(event) {
        const to = event.currentTarget.dataset.field;
        if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) return;
        if (this.dropTarget && this.dropTarget.field === to) this.dropTarget = null;
    }

    handleHeaderDrop(event) {
        event.preventDefault();
        const from = this._layout.dragField;
        const target = this.dropTarget;
        this.endDrag();
        if (!from || !target || target.field === from) return;
        if (target.field === GROUP_FIELD) {
            if (this.canDropToGroup(from)) this.changeGrouping('add', from);
            return;
        }
        this.announcement = `${this.labelOf(from)} moved ${target.after ? 'after' : 'before'} ${this.labelOf(target.field)}.`;
        this.emitColumns(moveColumn(this.columns, this._config.columnChoice, from, target.field, target.after));
    }

    handleHeaderDragEnd() {
        this.endDrag();
    }

    endDrag() {
        this._layout.dragField = null;
        if (this.dropTarget) this.dropTarget = null;
        if (this.draggingField) this.draggingField = null;
        if (this.groupZoneField) this.groupZoneField = null;
    }

    handleMenuChoice(event) {
        event.preventDefault();
        event.stopPropagation();
        this.chooseMenuItem(event.currentTarget);
    }

    /** A menu item: wrap or clip text, or a grouping action. */
    chooseMenuItem(item) {
        if (item.dataset.freeze !== undefined) {
            this.chooseFreeze(item.dataset.field, Number(item.dataset.freeze));
            return;
        }
        if (item.dataset.hide) {
            this.closeMenu(false);
            this.hideByUser(item.dataset.field);
            return;
        }
        if (item.dataset.wrap !== undefined) {
            this.chooseWrap(item);
            return;
        }
        if (item.dataset.filter) {
            const field = item.dataset.field;
            if (item.dataset.filter === 'open') {
                this.closeMenu(false);
                this.openFilter(field);
            } else {
                this.closeMenu(true);
                this.setFilter(field, null);
            }
            return;
        }
        if (item.dataset.sort) {
            // Sort ascending or descending from the column menu.
            const field = item.dataset.field;
            const direction = item.dataset.sort === 'desc' ? 'desc' : 'asc';
            this.closeMenu(true);
            this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
            this.setSort([{ field, direction }]);
            return;
        }
        const action = item.dataset.groupAction;
        const field = item.dataset.field;
        const unit = item.dataset.unit;
        this.closeMenu(true);
        if (action) this.changeGrouping(action, field, unit);
    }

    /** Focus moving anywhere but the menu or its own button closes the menu. */
    handleMenuFocusOut(event) {
        const next = event.relatedTarget;
        if (
            next &&
            (event.currentTarget.contains(next) ||
                (next.dataset && next.dataset.menuButton !== undefined && next.dataset.field === this.menuOpenFor))
        )
            return;
        this.closeMenu(false);
    }

    /** Freeze the data columns up to this one (n of them), or none: the user's own, kept with the layout. */
    chooseFreeze(field, n) {
        const count = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_FROZEN) : 0;
        this.userFrozen = count;
        const label = (this.columnByField(field) || {}).label || field;
        this.announcement = count ? `Columns frozen up to ${label}` : 'Columns unfrozen';
        this.closeMenu(true);
        this.emitLayout();
    }

    chooseWrap(item) {
        const field = item.dataset.field;
        const wrap = item.dataset.wrap === 'true';
        this.wrapOverrides = { ...this.wrapOverrides, [field]: wrap };
        this.wrapMin = 1; // measured again for the new set of wrapped columns
        const label = (this.columnByField(field) || {}).label || field;
        this.announcement = label + (wrap ? ': text wrapped' : ': text clipped');
        this.closeMenu(true);
        this.emitLayout();
    }

    openMenu(field, which) {
        this.menuOpenFor = field;
        this._layout.focusMenu = { field, which };
        this._layout.menuRoomCheck = '.rh-column-menu';
    }

    closeMenu(returnFocus) {
        if (this.menuOpenFor === null) return;
        const field = this.menuOpenFor;
        this.menuOpenFor = null;
        if (!this.rowMenu) this.menuRoom = 0;
        this._layout.focusMenu = returnFocus ? { field, which: 'button' } : null;
    }

    /**
     * Make room for the menu just drawn: a column's menu or a row's actions
     * menu. Both sit inside the scroller, which clips them: on a grid showing
     * one row, a column menu showed only its first item, and a row menu had no
     * room above or below. So, as
     * for an editor (placeEditor), a grid shorter than the open menu
     * needs grows while the menu is open, never past its maximum, and gives the
     * room back when it closes. The menu is measured once drawn, which counts
     * its dividers and long labels; the change is written outside the render
     * (HR-20). A menu that already fits, or opens upwards, changes nothing.
     */
    measureMenuRoom() {
        const selector = this._layout.menuRoomCheck; // the kind of menu just opened
        this._layout.menuRoomCheck = null;
        const scroller = this.template.querySelector('[data-scroller]');
        const menu = this.template.querySelector(selector);
        if (!scroller || !menu) return;
        const box = scroller.getBoundingClientRect();
        // The filter panel's box is inside its own component, which measures it.
        const bottom =
            typeof menu.panelBottom === 'function' ? menu.panelBottom() : menu.getBoundingClientRect().bottom;
        const height = box.bottom - box.top;
        // The visible bottom: a horizontal scrollbar takes the last few pixels.
        const scrollbar = Math.max(0, height - (scroller.clientHeight || height));
        if (bottom <= box.bottom - scrollbar) return;
        const need = Math.ceil(bottom - box.top + MENU_GAP + scrollbar);
        // eslint-disable-next-line @lwc/lwc/no-async-operation -- reactive change outside the render (HR-20)
        requestAnimationFrame(() => {
            if (this.menuOpenFor !== null || this.rowMenu || this.filterOpenFor !== null) this.menuRoom = need;
        });
    }

    /** Runs in renderedCallback, once the menu (or the button) is in the DOM. */
    focusMenuTarget() {
        const { field, which } = this._layout.focusMenu;
        this._layout.focusMenu = null;
        this._layout.restoreFocus = false; // focus is being placed deliberately
        const f = String(field).replace(/"/g, '\\"');
        let target;
        if (which === 'button') {
            target = this.template.querySelector(`[data-menu-button][data-field="${f}"]`);
        } else {
            const items = this.template.querySelectorAll(
                `[role="menuitemradio"][data-field="${f}"], [role="menuitemcheckbox"][data-field="${f}"], [role="menuitem"][data-field="${f}"]`
            );
            target = which === 'last' ? items[items.length - 1] : items[0];
        }
        if (target) target.focus();
    }

    // ============================================================ filters

    /** The user's filters, [{ field, operator, value, valueTo }], from the parent. */
    get filters() {
        return Array.isArray(this._config.filters) ? this._config.filters : [];
    }

    filterOf(field) {
        return this.filters.find(f => f.field === field) || null;
    }

    openFilter(field) {
        this.filterOpenFor = field;
        this._layout.focusFilter = true;
        this._layout.menuRoomCheck = 'c-grid-filter-panel';
    }

    /** Close the panel; focus goes back to the column's menu button. */
    closeFilter(returnFocus = true) {
        if (this.filterOpenFor === null) return;
        const field = this.filterOpenFor;
        this.filterOpenFor = null;
        if (this.menuOpenFor === null && !this.rowMenu) this.menuRoom = 0;
        if (returnFocus) this._layout.focusMenu = { field, which: 'button' };
    }

    /** Apply (a filter) or remove (null) a column's filter: the parent asks the server again. */
    setFilter(field, filter) {
        const next = withFilter(this.filters, field, filter);
        if (next === this.filters) {
            if (filter) this.announcement = `Filter by at most ${MAX_FILTERS} columns. Remove a filter first.`;
            return;
        }
        const column = this.columnByField(field) || {};
        this.announcement = filter
            ? `Filtered: ${describeFilter(filter, column)}`
            : `${column.label || field}: filter removed`;
        this.dispatchEvent(new CustomEvent('filterchange', { detail: { filters: next } }));
    }

    handleFilterApply(event) {
        event.stopPropagation();
        const field = this.filterOpenFor;
        this.closeFilter(true);
        if (field) this.setFilter(field, event.detail.filter);
    }

    handleFilterRemove(event) {
        event.stopPropagation();
        const field = this.filterOpenFor;
        this.closeFilter(true);
        if (field) this.setFilter(field, null);
    }

    handleFilterCancel(event) {
        event.stopPropagation();
        this.closeFilter(true);
    }

    /** Focus leaving the panel for anywhere else closes it, as a menu does. */
    handleFilterFocusOut(event) {
        const next = event.relatedTarget;
        if (next && event.currentTarget.contains(next)) return;
        this.closeFilter(false);
    }

    /** The filters as chips above the table, the admin's first and locked. */
    get filterChips() {
        const admin = (Array.isArray(this._config.adminFilters) ? this._config.adminFilters : []).map((f, i) => ({
            key: 'admin:' + i,
            label: f.text,
            locked: true,
            cls: CHIP_CLS + ' rh-filter-chip_locked',
            title: `${f.text}. Set by your Salesforce admin.`,
            removeLabel: null
        }));
        // With filter logic the user's filters are numbered, as the logic names them.
        const logic = this.filterLogic;
        const user = this.filters.map((f, i) => {
            const column = this.columnByField(f.field) || { field: f.field, label: f.field };
            const text = describeFilter(f, column);
            return {
                key: 'user:' + i,
                index: i,
                label: logic ? `${i + 1}. ${text}` : text,
                locked: false,
                cls: CHIP_CLS,
                title: text,
                removeLabel: `Remove filter: ${text}`
            };
        });
        if (logic) {
            user.push({
                key: 'logic',
                index: -1,
                label: `Filter Logic: ${logic}`,
                locked: false,
                cls: CHIP_CLS + ' rh-filter-chip_logic',
                title: `Filter Logic: ${logic}`,
                removeLabel: 'Remove filter logic'
            });
        }
        const chips = admin.concat(user);
        return chips.length ? chips : null;
    }

    /** How the user's filters join, "1 AND (2 OR 3)", or '' for all of them. */
    get filterLogic() {
        return typeof this._config.filterLogic === 'string' ? this._config.filterLogic : '';
    }

    get hasUserFilters() {
        return this.filters.length > 0;
    }

    /**
     * A chip's remove button: that filter goes (the parent then clears the
     * filter logic, whose numbers no longer match), or the filter logic goes.
     */
    handleFilterChipRemove(event) {
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        const index = Number(event.currentTarget.dataset.index);
        if (index < 0) {
            this.announcement = 'Filter logic removed: every filter must match.';
            this.dispatchEvent(new CustomEvent('filterchange', { detail: { filters: this.filters, logic: '' } }));
            return;
        }
        const filter = this.filters[index];
        if (!filter) return;
        const column = this.columnByField(filter.field) || {};
        this.announcement = `${column.label || filter.field}: filter removed`;
        this.dispatchEvent(
            new CustomEvent('filterchange', { detail: { filters: withoutFilterAt(this.filters, index) } })
        );
    }

    handleClearFilters() {
        if (!this.filters.length) return;
        this.announcement = 'Filters cleared';
        this.dispatchEvent(new CustomEvent('filterchange', { detail: { filters: [] } }));
    }

    // ============================================================ row actions

    /** The open row menu's items: every row action, in the configuration's order. */
    get rowMenuItems() {
        return this.rowActions.map(a => ({ key: a.name, name: a.name, label: a.label || a.name }));
    }

    handleRowMenuButton(event) {
        event.stopPropagation();
        const rowId = event.currentTarget.dataset.rowId;
        if (this.rowMenu && this.rowMenu.rowId === rowId) this.closeRowMenu(true);
        else this.openRowMenu(rowId, 'first');
    }

    /** Down or Up Arrow on the button opens the menu on its first or last item (APG menu button). */
    handleRowMenuButtonKeyDown(event) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        event.stopPropagation();
        this.openRowMenu(event.currentTarget.dataset.rowId, event.key === 'ArrowUp' ? 'last' : 'first');
    }

    handleRowMenuKeyDown(event) {
        this.navigateMenu(
            event,
            item => this.chooseRowAction(item),
            () => this.closeRowMenu(true)
        );
    }

    handleRowMenuChoice(event) {
        event.preventDefault();
        event.stopPropagation();
        this.chooseRowAction(event.currentTarget);
    }

    /** Focus moving anywhere but the menu or its own button closes it. */
    handleRowMenuFocusOut(event) {
        const next = event.relatedTarget;
        const rowId = this.rowMenu && this.rowMenu.rowId;
        if (
            next &&
            (event.currentTarget.contains(next) ||
                (next.dataset && next.dataset.rowMenuButton !== undefined && next.dataset.rowId === rowId))
        )
            return;
        this.closeRowMenu(false);
    }

    /**
     * Open a record row's actions menu. It opens upwards only when it does not
     * fit below the row and does fit above it, under the sticky header, which
     * would cover it; otherwise downwards, and a short grid grows to hold it
     * (measureMenuRoom). With no layout to measure (Jest), downwards.
     */
    openRowMenu(rowId, which) {
        if (!rowId || !this.hasRowActions || this.isSaving) return;
        const row = this.view[this.positionOf(rowId)];
        if (!row || row.__group || row.__detail) return;
        const cell = this.cellElement({ rowId, field: ACTIONS_FIELD });
        const scroller = this.template.querySelector('[data-scroller]');
        let up = false;
        if (cell && scroller) {
            const box = scroller.getBoundingClientRect();
            const at = cell.getBoundingClientRect();
            const head = this.template.querySelector('thead');
            const top = Math.max(box.top, head ? head.getBoundingClientRect().bottom : box.top);
            const need = this.rowActions.length * MENU_ITEM_HEIGHT + 8;
            up = box.bottom - at.bottom < need && at.top - top >= need;
        }
        this.focusKey = { rowId, field: ACTIONS_FIELD };
        this.rowMenu = { rowId, up };
        this._layout.focusRowMenu = { rowId, which };
        this._layout.menuRoomCheck = '.rh-row-menu';
    }

    closeRowMenu(returnFocus) {
        if (!this.rowMenu) return;
        const rowId = this.rowMenu.rowId;
        this.rowMenu = null;
        if (this.menuOpenFor === null) this.menuRoom = 0;
        this._layout.focusRowMenu = returnFocus ? { rowId, which: 'button' } : null;
    }

    chooseRowAction(item) {
        const { rowId, action } = item.dataset;
        this.closeRowMenu(true);
        if (!rowId || !action) return;
        this.dispatchEvent(new CustomEvent('rowaction', { detail: { action, recordId: rowId } }));
    }

    /** Runs in renderedCallback, once the menu (or its button) is in the DOM. */
    focusRowMenuTarget() {
        const { rowId, which } = this._layout.focusRowMenu;
        this._layout.focusRowMenu = null;
        this._layout.restoreFocus = false; // focus is being placed deliberately
        const r = String(rowId).replace(/"/g, '\\"');
        let target;
        if (which === 'button') {
            target = this.template.querySelector(`[data-row-menu-button][data-row-id="${r}"]`);
        } else {
            const items = this.template.querySelectorAll(`[role="menuitem"][data-row-id="${r}"][data-action]`);
            target = which === 'last' ? items[items.length - 1] : items[0];
        }
        if (target) target.focus();
    }

    /** A card's actions menu (lightning-button-menu): the same event as a row's. */
    handleCardAction(event) {
        const recordId = event.currentTarget.dataset.rowId;
        const action = event.detail && event.detail.value;
        if (!recordId || !action) return;
        this.dispatchEvent(new CustomEvent('rowaction', { detail: { action, recordId } }));
    }

    // ============================================================ grouping actions

    handleGroupToggle(event) {
        event.stopPropagation();
        this.toggleGroup(event.currentTarget.dataset.rowId);
    }

    /** Open or close one group. Focus inside a group that closes moves to its header. */
    toggleGroup(id) {
        const header = this.groupHeaderFor(id);
        if (!header) return;
        const next = { ...this.collapsed };
        if (header.expanded) next[header.id] = true;
        else delete next[header.id];
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        this.setRange(null, null); // positions below the group change
        this.collapsed = next;
        const k = this.focusKey;
        if (k && k.rowId !== HEADER && this.positionOf(k.rowId) < 0)
            this.focusKey = { rowId: header.id, field: GROUP_FIELD };
        this.announcement = `${header.columnLabel} ${header.label} ${header.expanded ? 'collapsed' : 'expanded'}`;
    }

    /**
     * A grouping action from a menu. Opening and closing groups is this
     * component's; a new grouping is the parent's, which asks the server for
     * the counts and subtotals, and for rows in group order.
     */
    changeGrouping(action, field, unit) {
        if (action === 'order' || action === 'direction' || action === 'percent') {
            this.changeGroupView(action, unit);
            return;
        }
        if (action === 'expand' || action === 'collapse') {
            this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
            this.setRange(null, null);
            if (action === 'expand') this.collapsed = {};
            else this.collapsed = this.allGroupIds();
            const k = this.focusKey;
            if (action === 'collapse' && k && k.rowId !== HEADER && this.positionOf(k.rowId) < 0) {
                const first = this.view[0];
                this.focusKey = first ? { rowId: String(first[this.keyField]), field: GROUP_FIELD } : null;
            }
            this.announcement = action === 'expand' ? 'All groups expanded' : 'All groups collapsed';
            return;
        }
        let next;
        const levels = this.grouping.map(l => ({ ...l }));
        switch (action) {
            case 'group':
                next = [{ field, unit: null }];
                break;
            case 'add':
                next = levels.concat([{ field, unit: null }]);
                break;
            case 'remove':
                next = levels.filter(l => l.field !== field);
                break;
            case 'unit': {
                const [unitField, value] = String(unit).split(':');
                next = levels.map(l => (l.field === unitField ? { ...l, unit: value } : l));
                break;
            }
            default:
                next = [];
        }
        next = normalizeGrouping(next, this.columns);
        this.setRange(null, null);
        const labelOf = l =>
            ((this.columnByField(l.field) || {}).label || l.field) +
            (l.unit ? ` by ${UNIT_LABELS[l.unit].toLowerCase()}` : '');
        this.announcement = next.length ? 'Grouped by ' + next.map(labelOf).join(', then ') : 'Not grouped';
        this.dispatchEvent(new CustomEvent('groupchange', { detail: { grouping: next.map(l => ({ ...l })) } }));
    }

    /**
     * The groups' order or percentages, from the Group column's menu.
     * The table's own, like Wrap or Clip: kept with the user's layout.
     */
    changeGroupView(action, value) {
        const gv = this.groupView;
        let order = gv.order;
        let percent = gv.percent;
        if (action === 'order') {
            // Largest first is what ordering by a figure is for; by name follows the column's sort.
            order = normalizeOrder(
                { by: value, direction: value === 'name' ? 'asc' : order.by === 'name' ? 'desc' : order.direction },
                this.columns
            );
        } else if (action === 'direction') {
            order = normalizeOrder({ by: order.by, direction: value }, this.columns);
        } else {
            percent = !percent;
        }
        this._layout.restoreFocus = this._layout.restoreFocus || this.hasFocus;
        this.setRange(null, null); // positions change with the order
        this.groupView = { order, percent };
        if (action === 'percent') {
            this.announcement = percent ? "Showing each group's percent of the total" : 'Percent of total hidden';
        } else {
            const what =
                order.by === 'name'
                    ? 'name'
                    : order.by === 'count'
                      ? 'record count'
                      : `${(SUBTOTAL_NAMES[(this.columnByField(order.by) || {}).subtotal] || 'subtotal').toLowerCase()} of ${this.labelOf(order.by)}`;
            this.announcement =
                `Groups ordered by ${what}` +
                (order.by === 'name' ? '' : order.direction === 'desc' ? ', largest first' : ', smallest first');
        }
        this.emitLayout();
    }

    /** Every group's id, closed ones' sub-groups included, for Collapse all. */
    allGroupIds() {
        const all = buildView(this.sortedRows, this.grouping, {
            columns: this.columns,
            keyField: this.keyField,
            fiscal: this._config.fiscal || null
        });
        const out = {};
        all.headers.forEach((h, id) => {
            out[id] = true;
        });
        return out;
    }

    // ============================================================ narrow layout

    get layoutMode() {
        const l = this._config.layout;
        return l === 'cards' || l === 'table' ? l : 'auto';
    }

    get isCards() {
        return this.layoutMode === 'cards' || (this.layoutMode === 'auto' && this.narrow);
    }

    /** Watch the component's OWN root (HR-24); fall back to window resize (HR-23). */
    watchWidth() {
        const root = this.template.querySelector('[data-grid-root]');
        if (!root) return;
        this._layout.widthWatch = true;
        // The window's height decides the grid's when it fills the window.
        this._layout.onWindowResize = () => this.measureFill();
        window.addEventListener('resize', this._layout.onWindowResize);
        const apply = width => {
            const narrow = width > 0 && width < NARROW_WIDTH;
            if (narrow !== this.narrow) this.narrow = narrow;
            this.measureView(); // open rows' panels and unpinned columns follow the grid's width
        };
        if (typeof ResizeObserver === 'function') {
            this._layout.observer = new ResizeObserver(entries => {
                const last = entries[entries.length - 1];
                apply(last && last.contentRect ? last.contentRect.width : root.clientWidth);
            });
            this._layout.observer.observe(root);
        } else {
            this._layout.onResize = () => apply(root.clientWidth);
            window.addEventListener('resize', this._layout.onResize);
            // eslint-disable-next-line @lwc/lwc/no-async-operation
            requestAnimationFrame(() => apply(root.clientWidth)); // outside the render (HR-20)
        }
    }

    disconnectedCallback() {
        this.listenForBulkKey(false);
        clearTimeout(this._bulk.timer);
        if (this._layout.observer) this._layout.observer.disconnect();
        if (this._layout.onResize) window.removeEventListener('resize', this._layout.onResize);
        if (this._layout.onWindowResize) window.removeEventListener('resize', this._layout.onWindowResize);
        this._layout.observer = null;
        this._layout.onResize = null;
        this._layout.onWindowResize = null;
        this._layout.widthWatch = false;
    }

    get cardRows() {
        const view = this.view;
        const drafts = this._config.drafts || {};
        const errors = this._config.errors || {};
        const cols = this.shownColumns;
        // The title's column last: a row rule's icon goes on the first of these,
        // and the title is not a field of the card, so the icon was lost.
        const fields = cols
            .slice(1)
            .concat(cols.slice(0, 1))
            .map(c => c.field);
        const out = [];
        // The limit counts records and groups; an open record's panel comes with
        // its card and is not counted. Without panels, `shown` is i + 1.
        let shown = 0;
        for (let i = 0; i < view.length; i++) {
            const row = view[i];
            if (row.__detail) {
                out.push(this.detailCard(row));
                continue;
            }
            if (shown >= this.cardLimit) break;
            shown++;
            if (row.__group) {
                out.push(this.groupCard(row.__group));
                continue;
            }
            const id = String(row[this.keyField]);
            const isNew = this.isNewRow(id);
            const rowDrafts = drafts[id] || {};
            const rowErrors = errors[id] || {};
            const fieldErrors = rowErrors.fields || {};
            const first = cols[0];
            const titleValue = first ? (has(rowDrafts, first.field) ? rowDrafts[first.field] : row[first.field]) : null;
            const title = (first && this.shownText(titleValue, first)) || (isNew ? 'New record' : 'Record ' + shown);
            const titleLink = first ? this.linkFor(first, id, titleValue) : { href: null };
            const isSelected = Boolean(this.selected[id]);
            const format = this.rowFormats(row, id, drafts, fields);
            const open = this.hasChildren && Boolean(this.expanded[id]);
            const counts = this.childCountsOf(id);
            // The first column is the card's title, not repeated as a field; three
            // fields show, the rest on request. An editable title is a
            // field again among all of them, so it can still be edited.
            const shownAlways = (c, n) => n < CARD_FIELDS || has(rowDrafts, c.field) || fieldErrors[c.field];
            const titleEditable = this.canEditCell(first, id);
            const titleField =
                first && (titleEditable || has(rowDrafts, first.field) || fieldErrors[first.field]) ? [first] : [];
            const rest = cols.slice(1);
            const all = Boolean(this.cardExpanded[id]);
            const more = Math.max(0, rest.length - CARD_FIELDS) + (titleEditable ? 1 : 0);
            // A field with an error or an unsaved edit is shown whatever the limit.
            const visible = all
                ? titleField.concat(rest)
                : titleField
                      .filter(c => has(rowDrafts, c.field) || fieldErrors[c.field])
                      .concat(rest.filter(shownAlways));
            out.push({
                key: id, // HR-19: record-derived, never the index
                id,
                isRecord: true,
                cls:
                    'slds-item rh-card' +
                    (isNew ? ' rh-card_new' : '') +
                    (format && format.bar ? ' rh-card_bar ' + format.bar : ''),
                // A new record is selected for nothing, and has no actions, until it is saved.
                selectable: this.hasSelection && !isNew,
                hasActions: this.hasRowActions && !isNew,
                position: shown,
                title,
                titleHref: titleLink.href,
                titleRecordId: titleLink.recordId,
                headingId: this._layout.gridId + '-card-' + shown,
                rowError: rowErrors.row || '',
                isSelected,
                selectId: this._layout.gridId + '-card-sel-' + shown,
                selectLabel: 'Select ' + title,
                fields: visible.map(c => this.cardField(c, row, id, title, rowDrafts, fieldErrors, format)),
                hasMoreFields: more > 0,
                moreFieldsLabel: all ? 'Show fewer fields' : `Show all fields (${more} more)`,
                moreFieldsExpanded: String(all),
                fieldsId: this._layout.gridId + '-card-fields-' + shown,
                // The card's toggle for its child tables, none with no related records.
                expandable: this.hasChildren && !isNew && this.offersToggle(open, counts),
                expandedAttr: String(open),
                expandIcon: open ? 'utility:chevrondown' : 'utility:chevronright',
                expandText:
                    (open ? 'Hide related records' : 'Show related records') + (counts ? ` (${counts.total})` : ''),
                panelId: open ? this.detailCellId(id) : null,
                // The row's actions, in a menu beside the title.
                actionsLabel: `Actions for ${title}`
            });
        }
        return out;
    }

    /** Show a card's every field, or three again. */
    handleCardFields(event) {
        const id = event.currentTarget.dataset.rowId;
        if (!id) return;
        const next = { ...this.cardExpanded };
        if (next[id]) delete next[id];
        else next[id] = true;
        this.cardExpanded = next;
    }

    /** An open record's child tables in the card list: a region under its card. */
    detailCard(item) {
        const d = item.__detail;
        const name = this.rowName(d.row);
        const id = String(item[this.keyField]);
        return {
            key: id, // detailId(record Id): record-derived and stable (HR-19)
            id,
            isRecord: false,
            isDetail: true,
            cls: 'slds-item rh-card rh-card-detail',
            panelId: this.detailCellId(d.rowId),
            label: name ? `Related records for ${name}` : 'Related records',
            tabs: this.childTabs,
            counts: (this.childCountsOf(d.rowId) || {}).byTab || null,
            parentId: d.rowId,
            parentName: name,
            level: this.childLevel
        };
    }

    /** A group in the card list: a toggle with its name and count, and its subtotals as a line. */
    groupCard(h) {
        const subtotals = h.values
            ? this.shownColumns
                  .map(c => {
                      const sub = subtotalFor({ values: h.values }, c);
                      return sub && sub.text
                          ? `${SUBTOTAL_NAMES[sub.kind]} of ${c.label || c.field}: ${sub.text}`
                          : null;
                  })
                  .filter(Boolean)
                  .join(' · ')
            : '';
        return {
            key: h.id,
            id: h.id,
            isRecord: false,
            cls: 'slds-item rh-card rh-card-group rh-card-group_' + h.level,
            label: `${h.columnLabel}: ${h.label}`,
            countText: h.count === null ? '' : recordsText(h.count),
            expandedAttr: String(h.expanded),
            toggleIcon: h.expanded ? 'utility:chevrondown' : 'utility:chevronright',
            indentStyle: `padding-left:${(h.level - 1) * GROUP_INDENT}px`,
            subtotals
        };
    }

    cardField(c, row, id, title, rowDrafts, fieldErrors, format = null) {
        const hasDraft = has(rowDrafts, c.field);
        const value = hasDraft ? rowDrafts[c.field] : row[c.field];
        const error = fieldErrors[c.field];
        const isEditing = Boolean(this.editing && this.editing.rowId === id && this.editing.field === c.field);
        const cut = !hasDraft && Array.isArray(row._cut) && row._cut.includes(c.field);
        const editor = cut ? 'textarea' : EDITOR_BY_TYPE[c.type] || 'text';
        const label = c.label || c.field;
        const names = this._config.refNames || {};
        const lookup = isLookup(c.type);
        const text = lookup ? lookupText(value, names) : formatValue(value, c, row);
        const isCheckbox = c.type === 'checkbox' || c.type === 'boolean';
        const link = this.linkFor(c, id, value);
        const editable = this.canEditCell(c, id);
        const formatted = Boolean(format) && !hasDraft && !error;
        const fmt = formatted ? format.cells[c.field] : null;
        // A rule's icon, and its data bar, as in the table.
        const icon = formatted && format.icons ? format.icons[c.field] || null : null;
        const barPct = formatted && format.bars && format.bars[c.field] ? this.barPercent(c.field, value) : null;
        return {
            field: c.field,
            labelKey: c.field + ':label',
            valueKey: c.field + ':value',
            label,
            text,
            isBlank: !isCheckbox && text === '',
            isCheckbox,
            checked: value === true || value === 'true',
            href: link.href,
            linkTarget: link.target,
            recordLink: link.recordId,
            editable,
            // Tap the value to edit it. A value that is a link keeps its
            // link, and a small edit button beside it.
            editOnValue: editable && !link.href,
            editButton: editable && Boolean(link.href),
            editLabel: 'Edit ' + label + ' of ' + title,
            hasDraft,
            hasError: Boolean(error),
            errorMessage: error || '',
            errorId: error ? this.errorIdFor(id, c.field) : null,
            // In a card, a value sits beside its label, whatever its type.
            valueCls: 'rh-card-value' + (fmt ? ' ' + fmt : '') + (barPct !== null ? ' rh-rule_databar' : ''),
            valueStyle: barPct !== null ? `--rh-databar:${barPct}%` : null,
            hasFormatIcon: Boolean(icon),
            formatIcon: icon ? icon.name : null,
            formatIconVariant: icon ? icon.variant : null,
            formatIconLabel: icon ? icon.label : null,
            isEditing,
            editorText: isEditing && editor === 'text',
            editorNumber: isEditing && editor === 'number',
            editorDate: isEditing && editor === 'date',
            editorCheckbox: isEditing && editor === 'checkbox',
            editorPicklist: isEditing && editor === 'picklist',
            editorLookup: isEditing && editor === 'lookup',
            editorMultiPicklist: isEditing && editor === 'multipicklist',
            editorDateTime: isEditing && editor === 'datetime',
            editorTime: isEditing && editor === 'time',
            editorTextarea: isEditing && editor === 'textarea',
            cut,
            maxLength: c.length || null,
            editValue: value,
            editValueLabel: lookup && !isBlank(value) ? names[value] || null : null,
            lookupIcons: lookup ? c.referenceIcons || null : null,
            // A lookup filter, and records the user may create from the list.
            filteredLookup: lookup && c.filteredLookup === true,
            fieldApiName: lookup ? c.fieldApiName || null : null,
            newTargets: lookup ? c.newTargets || null : null,
            editSeed: undefined,
            editType: c.type,
            scale: c.scale,
            currencyCode: c.type === 'currency' && currencyFor(c, row).byCode ? currencyFor(c, row).code : null,
            options: isEditing ? this.editorOptions(c, row, rowDrafts, value) : c.options || [],
            dependentOn: c.dependentOn || null,
            required: Boolean(c.required),
            editorLabel: label
        };
    }

    /** Every record and group there is, without open records' panels. */
    get cardTotal() {
        return this.knownTotal - this.detailRows.length;
    }

    get cardCountText() {
        return `Showing ${Math.min(this.cardLimit, this.recordRowCount)} of ${this.cardTotal}`;
    }

    /** More cards to show: loaded ones beyond the limit, or rows still on the server. */
    get hasMoreCards() {
        return this.recordRowCount > this.cardLimit || this.showLoadMore;
    }

    get showMoreLabel() {
        const rest = this.recordRowCount - this.cardLimit;
        if (rest <= 0) return this.isLoadingMore ? 'Loading more…' : this.loadMoreLabel;
        return `Show ${Math.min(CARD_PAGE, rest)} more (${this.cardTotal - this.cardLimit} remaining)`;
    }

    handleShowMore() {
        if (this.recordRowCount <= this.cardLimit) {
            // Every loaded card is showing: fetch the next page first.
            this.handleLoadMoreClick();
            return;
        }
        const firstNew = this.cardLimit + 1;
        this.cardLimit += CARD_PAGE;
        this.announcement = this.cardCountText;
        // Keyboard and screen-reader users land on the first card that appeared.
        this._layout.focusCard = firstNew;
    }

    get cardSortOptions() {
        const primary = this.sortKeys[0];
        const options = [{ value: '', label: 'Default order', selected: !primary }];
        this.shownColumns
            .filter(c => c.sortable !== false)
            .forEach(c =>
                options.push({
                    value: c.field,
                    label: c.label || c.field,
                    selected: Boolean(primary && primary.field === c.field)
                })
            );
        return options;
    }

    get cardSortDirectionLabel() {
        const primary = this.sortKeys[0];
        return primary && primary.direction === 'desc' ? 'Descending' : 'Ascending';
    }

    get cardSortDisabled() {
        return !this.sortKeys.length;
    }

    handleCardSortField(event) {
        const field = event.target.value;
        this.setSort(field ? [{ field, direction: 'asc' }] : []);
    }

    handleCardSortDirection() {
        const primary = this.sortKeys[0];
        if (!primary) return;
        this.setSort([{ field: primary.field, direction: primary.direction === 'asc' ? 'desc' : 'asc' }]);
    }

    handleCardEdit(event) {
        const { rowId, field } = event.currentTarget.dataset;
        const column = this.columnByField(field);
        if (!this.canEditCell(column, rowId)) return;
        this._layout.lastCardEdit = { rowId, field };
        this.editing = { rowId, field, seed: undefined };
        this._layout.focusEditor = true;
    }

    // ============================================================ empty

    /**
     * What an empty list says, from the parent (config.emptyState): a search
     * that matched nothing, or a list with no records. Only once loading is
     * done, so it never flashes while rows arrive.
     */
    get emptyState() {
        const e = this._config.emptyState;
        if (!e || this.rowCount || this._config.totalRows === -1 || this.isLoadingMore) return null;
        return {
            title: e.title || 'No records',
            message: e.message || '',
            actionLabel: e.actionLabel || '',
            icon: e.icon || 'utility:search'
        };
    }

    handleEmptyAction() {
        this.dispatchEvent(new CustomEvent('emptyaction'));
    }

    // ============================================================ footer

    /** Undo and redo, from the parent: { canUndo, canRedo, undoLabel, redoLabel }. */
    get history() {
        return this._config.history || null;
    }

    get hasHistory() {
        return Boolean(this.history);
    }

    get undoDisabled() {
        return this.isSaving || !(this.history && this.history.canUndo);
    }

    get redoDisabled() {
        return this.isSaving || !(this.history && this.history.canRedo);
    }

    get undoTitle() {
        return (this.history && this.history.undoLabel) || 'Undo';
    }

    get redoTitle() {
        return (this.history && this.history.redoLabel) || 'Redo';
    }

    get saveDisabled() {
        return this.isSaving || (!this.draftCount && !this.newRecordCount);
    }

    handleUndoClick() {
        this.dispatchEvent(new CustomEvent('undo'));
    }

    handleRedoClick() {
        this.dispatchEvent(new CustomEvent('redo'));
    }

    /** Unsaved values typed, a new row's mark aside. */
    /**
     * Unsaved changes, counted as Save writes them: a field of a related
     * record changed on rows that share that record (Account: Industry on
     * three of its contacts) is one change, to the account.
     */
    get draftCount() {
        const drafts = this._config.drafts || {};
        const paths = new Set(this.columns.filter(c => c.isPath).map(c => c.field));
        const holders = new Set();
        let n = 0;
        Object.keys(drafts).forEach(id => {
            const draft = drafts[id];
            Object.keys(draft).forEach(field => {
                if (field === NEW_MARK && draft[NEW_MARK] === true) return;
                if (paths.has(field)) {
                    const row = this.view[this.positionOf(id)];
                    const holder = row && row._parents ? row._parents[field] : null;
                    if (holder) {
                        const key = `${holder}|${field.slice(field.lastIndexOf('.') + 1)}`;
                        if (holders.has(key)) return;
                        holders.add(key);
                    }
                }
                n += 1;
            });
        });
        return n;
    }

    /** New rows not saved yet. */
    get newRecordCount() {
        const drafts = this._config.drafts || {};
        return Object.values(drafts).filter(r => r[NEW_MARK] === true).length;
    }

    /** With unsaved changes, or a change undone that can be redone (Undo and Redo live here). */
    get showFooter() {
        return this.draftCount > 0 || this.newRecordCount > 0 || Boolean(this.history && this.history.canRedo);
    }

    /**
     * The Save bar floats as a light-blue pill, like the selection bar.
     * Table: it sits in a band of its own under the scroller (.rh-has-footer),
     * so it never covers rows, the Total row or the scrollbar.
     * Cards: the list scrolls with the page, so a bar at the end of fifty
     * cards is out of reach; it sticks to the bottom of the screen instead
     * (found in Lightning Experience at 460px).
     */
    get footerClass() {
        return 'rh-footer ' + (this.isCards ? 'rh-footer_sticky' : 'rh-footer_docked');
    }

    get errorCount() {
        const errors = this._config.errors || {};
        return Object.values(errors).reduce((n, e) => n + Object.keys(e.fields || {}).length + (e.row ? 1 : 0), 0);
    }

    get footerSummary() {
        const n = this.draftCount;
        const r = this.newRecordCount;
        const e = this.errorCount;
        if (this.isSavingEdits) {
            // What is being saved; with many batches, how far it has got.
            const what = [
                r ? `${formatCount(r)} new ${r === 1 ? 'record' : 'records'}` : '',
                n ? `${formatCount(n)} ${n === 1 ? 'change' : 'changes'}` : ''
            ].filter(Boolean);
            return this._config.saveProgress || `Saving ${what.join(' and ') || 'changes'}…`;
        }
        const parts = [
            r ? `${formatCount(r)} new ${r === 1 ? 'record' : 'records'}` : '',
            n ? `${formatCount(n)} unsaved ${n === 1 ? 'change' : 'changes'}` : ''
        ].filter(Boolean);
        const edits = parts.length ? parts.join(', ') : 'No unsaved changes';
        return e ? `${edits}, ${formatCount(e)} ${e === 1 ? 'error' : 'errors'}` : edits;
    }

    get isSaving() {
        return Boolean(this._config.saving);
    }

    /**
     * The edits are being saved: not a delete or an action, which hold editing
     * too (config.saving). The Save button shows a spinner and "Saving…" in its
     * own blue, and the line above it says what is being saved.
     */
    get isSavingEdits() {
        return Boolean(this._config.savingEdits);
    }

    /** While saving, Save is not greyed out: it says so instead, and does nothing (aria-disabled). */
    get saveButtonDisabled() {
        return this.isSavingEdits ? false : this.saveDisabled;
    }

    get saveAriaDisabled() {
        return this.isSavingEdits ? 'true' : null;
    }

    handleSave() {
        if (this.isSaving) return;
        this.dispatchEvent(new CustomEvent('save'));
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('cancel'));
    }
}
