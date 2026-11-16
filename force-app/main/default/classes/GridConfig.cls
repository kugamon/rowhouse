/**
 * GridConfig — reads a grid's configuration from Custom Metadata.
 *
 * Configuration is deployable metadata, not records: it moves between orgs in a
 * change set or a package, and it is readable here without a SOQL query against
 * the governor limit (getInstance / getAll).
 *
 * Two views of one configuration:
 *   load()    — the configuration as an admin wrote it, validated against the
 *               schema. The save path uses its editable columns as the HR-6
 *               allow-list.
 *   forUser() — what the running user may actually see and edit: unreadable
 *               columns removed, editability narrowed by field-level security.
 *
 * DISPLAY RULES
 * Conditional formatting comes from Grid_Display_Rule__mdt records. Each rule is
 * checked here against the schema. A rule an admin got wrong (an unknown field,
 * an operator that means nothing for the field's type, a value that is not a
 * number or a date) is skipped with a warning rather than breaking the grid for
 * everyone, and the warning is shown only to users with the
 * Rowhouse_Grid_Diagnostics permission. forUser() drops a rule on a field the user
 * cannot read, silently: a colored row would otherwise reveal the value.
 *
 * GROUPING AND SUBTOTALS
 * A Grid Column may carry a Group Level (1 to 3: the grouping the grid opens
 * with), a Group Date Unit for a date, and a Subtotal. The same rule applies:
 * a setting that cannot work (grouping by a number, a sum of a checkbox) is
 * left out with a warning, and forUser() drops what the user cannot read.
 *
 * CHILD TABLES
 * Grid Child Table records list the tabs of related records under each row;
 * GridChildTables checks them, and forUser() drops a tab the user cannot read.
 *
 * ACTIONS
 * Grid Action records list what users can run on a row or on the selection;
 * GridActions checks them, and forUser() drops one whose custom permission the
 * user does not hold. GridActionService runs them.
 *
 * FILTERS AND THE RECORD PAGE
 * Grid Filter records narrow the records every user of the grid sees; a
 * Record Page Field narrows them, on a record page, to that record's. Both
 * become SOQL in GridFilters. A filter that cannot work stops the grid: unlike
 * a display rule, skipping it would show records the admin meant to keep out.
 *
 * CHILD TOTALS
 * A Grid Column with a Child Table is a child total column: on each row, a
 * sum, average, lowest, highest or count of that child table's records for
 * the row, worked out on the server with the child grid's own filters
 * (GridChildTables). One that cannot be built is skipped with a warning;
 * forUser() drops one whose records or fields the user cannot read.
 *
 * FORMULAS
 * A Grid Column with a Formula is a formula column, worked out on the server
 * for each row (GridFormulas); a display rule with a Formula is tested the
 * same way. A formula that cannot be built is skipped with a warning, as a
 * rule is; forUser() drops one that reads a field the user cannot.
 *
 * DRAFTS AND TURNED-OFF RECORDS
 * build() reads a configuration from records in hand, so the Grid Admin
 * tab checks a draft with the same code the grid uses (GridAdmin). Columns,
 * actions and child tables marked Inactive are left out, as are rules not
 * Active: the Grid Admin tab turns records off, since Apex cannot delete
 * Custom Metadata.
 */
public with sharing class GridConfig {
    /** Types whose length the text editors count against. */
    private static final Set<Schema.DisplayType> LENGTH_TYPES = new Set<Schema.DisplayType>{
        Schema.DisplayType.STRING,
        Schema.DisplayType.TEXTAREA,
        Schema.DisplayType.EMAIL,
        Schema.DisplayType.PHONE,
        Schema.DisplayType.URL
    };

    /** Types the grid has an editor for, date/time, time and text areas among them. */
    public static final Set<String> EDITABLE_TYPES = new Set<String>{
        'text',
        'email',
        'phone',
        'url',
        'number',
        'currency',
        'percent',
        'date',
        'checkbox',
        'picklist',
        'multipicklist',
        'reference',
        'owner',
        'datetime',
        'time',
        'textarea'
    };
    private static final Set<String> KNOWN_TYPES = new Set<String>{
        'text',
        'email',
        'phone',
        'url',
        'textarea',
        'number',
        'currency',
        'percent',
        'date',
        'datetime',
        'time',
        'checkbox',
        'picklist',
        'multipicklist',
        'reference',
        'owner',
        'id'
    };

    /**
     * The looks a display rule may give; the grid maps each to one class.
     * There is no blue fill: a blue row would look selected.
     */
    public static final Set<String> FORMAT_STYLES = new Set<String>{
        'fill_green',
        'fill_amber',
        'fill_red',
        'fill_purple',
        'fill_gray',
        'text_red',
        'text_green',
        'text_gray',
        'bold',
        'icon_warning',
        'icon_error',
        'icon_success',
        'icon_info',
        'icon_up',
        'icon_down',
        'data_bar'
    };
    /**
     * The types a column is offered for grouping by, unless the admin gives it
     * a Group Level: values that repeat. Grouping by a name or a note
     * makes a group per row, and "Group by" on every column's menu was noise.
     */
    public static final Set<String> GROUP_OFFERED_TYPES = new Set<String>{
        'picklist',
        'checkbox',
        'reference',
        'owner',
        'date',
        'datetime'
    };
    private static final Set<String> NUMBER_TYPES = new Set<String>{ 'number', 'currency', 'percent' };
    private static final Set<String> DATE_TYPES = new Set<String>{ 'date', 'datetime' };
    /** Types with an order, for greater and less than. */
    private static final Set<String> ORDERED_TYPES = new Set<String>{
        'number',
        'currency',
        'percent',
        'date',
        'datetime',
        'time'
    };
    /** Types whose values are text, for contains and starts with. */
    private static final Set<String> TEXT_TYPES = new Set<String>{
        'text',
        'email',
        'phone',
        'url',
        'textarea',
        'id',
        'picklist',
        'multipicklist'
    };
    private static final Set<String> OPERATORS = new Set<String>{
        'equals',
        'not_equals',
        'greater_than',
        'greater_or_equal',
        'less_than',
        'less_or_equal',
        'between',
        'contains',
        'not_contains',
        'starts_with',
        'is_blank',
        'is_not_blank'
    };
    /** Operators a two-field rule may use. */
    private static final Set<String> COMPARE_OPERATORS = new Set<String>{
        'equals',
        'not_equals',
        'greater_than',
        'greater_or_equal',
        'less_than',
        'less_or_equal'
    };
    /**
     * How a date column can be grouped: by calendar period, by the week
     * (from the first day of the week in the user's locale), or by the org's
     * fiscal quarter or year.
     */
    public static final Set<String> GROUP_UNITS = new Set<String>{
        'day',
        'week',
        'month',
        'quarter',
        'year',
        'fiscal_quarter',
        'fiscal_year'
    };
    public static final Integer MAX_GROUP_LEVELS = 3;
    /** The sorts a grid can open with: Default Sort Field and up to four in Then Sort By, as a list view's Column Sort. */
    public static final Integer MAX_SORT_LEVELS = 5;
    private static final Pattern RELATIVE_DATE = Pattern.compile('^TODAY(?:([+-])(\\d{1,4}))?$');
    private static final Pattern ISO_DATE = Pattern.compile('^\\d{4}-\\d{2}-\\d{2}$');
    private static final Pattern TIME_OF_DAY = Pattern.compile('^([01]\\d|2[0-3]):([0-5]\\d)(?::([0-5]\\d))?$');

    public class Column {
        @AuraEnabled
        public String field;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String type;
        @AuraEnabled
        public Boolean editable;
        /**
         * The cell can be filled in on a new row: an editable column this user
         * may set on a new record. Not `editable`, which is about changing a
         * saved record: a field can be settable on create and not after.
         * User-independent from build(); forUser() narrows it.
         */
        @AuraEnabled
        public Boolean creatable = false;
        @AuraEnabled
        public Boolean sortable;
        @AuraEnabled
        public Integer scale;
        /** A text field's most characters, for the text area editor's count; null for other types. */
        @AuraEnabled
        public Integer length;
        @AuraEnabled
        public Integer width;
        @AuraEnabled
        public Boolean required;
        /** Admin default: show up to three lines instead of clipping to one. */
        @AuraEnabled
        public Boolean wrap;
        /** The admin keeps it on screen: users can move it but not hide it. */
        @AuraEnabled
        public Boolean alwaysShown;
        /**
         * Picklist values: { value, label }, and for a dependent picklist also
         * validFor, the controlling values the value is offered for.
         */
        @AuraEnabled
        public List<Map<String, Object>> options;
        /** A lookup's target objects, local names. */
        @AuraEnabled
        public List<String> referenceTo;
        /** A dependent picklist's controlling field, local name. */
        @AuraEnabled
        public String dependentOn;
        /** The object's name field: its cells link to the record, as a list view's do. */
        @AuraEnabled
        public Boolean isName = false;
        /** An External Id field: an import can match records by it. */
        @AuraEnabled
        public Boolean externalId = false;
        /**
         * The lookup field has a lookup filter: its cell edits with
         * Salesforce's own lookup, which applies the filter, by fieldApiName.
         */
        @AuraEnabled
        public Boolean filteredLookup = false;
        /** The field's API name, namespace included, for Salesforce's own lookup; set for a filtered lookup only. */
        @AuraEnabled
        public String fieldApiName;
        /**
         * The target objects this user may create a record of from the lookup's
         * New item: [{ object: API name, label }]. forUser() sets it, for
         * an editable lookup only.
         */
        @AuraEnabled
        public List<Map<String, String>> newTargets;
        /** A lookup's targets' icons, by local name; set by GridIcons, when a grid opens only. */
        @AuraEnabled
        public Map<String, String> referenceIcons;
        /** The grid can group by this column; forUser() narrows it. */
        @AuraEnabled
        public Boolean groupable = false;
        /** sum, average, min, max or count: what groups and the Total row show; null for none. */
        @AuraEnabled
        public String subtotal;
        /** The user may filter by this column from its menu; forUser() narrows it. */
        @AuraEnabled
        public Boolean filterable = false;
        /**
         * Search this list looks in this column (GridDataService.isSearchable):
         * the grid names the columns it does not, when the search box has focus.
         */
        @AuraEnabled
        public Boolean searchable = false;
        /** A formula column: worked out on the server, read only; field is _fx_ and its API name. */
        @AuraEnabled
        public Boolean isFormula = false;
        /** A formula column's formula, built. Never sent. */
        public GridFormulas.Compiled formula;
        /**
         * The column shows a field of a parent record, reached through lookups
         * (GridPaths): `field` is its path, "Account.Industry", and each row
         * carries the Id of the record that holds it in `_parents`. An edit
         * is saved to that record, and shows on every row with the same parent.
         */
        @AuraEnabled
        public Boolean isPath = false;
        /**
         * The field is encrypted (Shield Platform Encryption or Classic
         * encrypted text): shown and edited as usual, never sorted, filtered,
         * grouped, searched or subtotalled, and logged without its values.
         */
        @AuraEnabled
        public Boolean encrypted = false;
        /** A child total column: worked out on the server, read only; field is _ct_ and its API name. */
        @AuraEnabled
        public Boolean isChildTotal = false;
        /**
         * In an org with more than one currency (GridCurrency): where each row
         * carries the currency its amount is in, 'CurrencyIsoCode' or
         * 'Account.CurrencyIsoCode'; null otherwise.
         */
        @AuraEnabled
        public String currencyField;
        /** In an org with more than one currency: the one currency every value is in (a child total's). */
        @AuraEnabled
        public String currencyCode;
        /** In an org with more than one currency: the corporate currency, which the Total row and subtotals are in. */
        @AuraEnabled
        public String totalCurrency;
        /** What a child total column totals. Never sent. */
        public GridChildTables.ChildTotal childTotal;
        /**
         * What the admin allowed, before any display limitation. This — not
         * `editable` — is the server's HR-6 allow-list: the grid may choose not
         * to offer an editor (long text, say), but that is a UI decision, and the
         * security boundary must not move with it.
         */
        public Boolean adminEditable = false;
    }

    /**
     * One conditional format, as the grid applies it: when `field` meets
     * `operator` and `value`, the cell in that field's column (applyTo 'cell')
     * or every cell of the row ('row') takes `style`. `value` arrives
     * normalised: a picklist label becomes its API value, a number is plain, a
     * date is ISO or TODAY with an offset in days, a time is HH:MM:SS, a lookup
     * is an 18-character Id or $User.
     */
    public class DisplayRule {
        @AuraEnabled
        public String name;
        /** What the rule means, in the admin's words: its Label. The grid shows it in the legend. */
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String field;
        @AuraEnabled
        public String type;
        @AuraEnabled
        public String operator;
        @AuraEnabled
        public String value;
        @AuraEnabled
        public String style;
        @AuraEnabled
        public String applyTo;
        /** Between's upper end; null otherwise. */
        @AuraEnabled
        public String valueTo;
        /** The field compared with, instead of a value; null otherwise. */
        @AuraEnabled
        public String compareField;
        /** That field's cell type: a date compared with a date/time reads each by its own. */
        @AuraEnabled
        public String compareType;
        /** Tested by a formula on the server: a row matches when its _rules lists this rule. */
        @AuraEnabled
        public Boolean isFormula = false;
        /** The formula, built. Never sent. */
        public GridFormulas.Compiled formula;
    }

    /**
     * One tab of related records under each row: the Grid Child Table
     * `name` the browser hands back to ask for its rows, the tab's `label`, and
     * the child grid's configuration. See GridChildTables.
     */
    public class Child {
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String configName;
        @AuraEnabled
        public String objectApiName;
        /** The child object's field that points to the row, local name; the server filters by it. */
        @AuraEnabled
        public String relationshipField;
        /** The child grid's height in pixels, the admin's Height; null for the standard height. */
        @AuraEnabled
        public Integer height;
    }

    /**
     * One action users can run from the grid: a screen flow, an autolaunched
     * flow or a quick action. `name` is the Grid Action's DeveloperName, which
     * the browser hands back to run it. A screen flow and a quick action run in
     * the browser, so the browser is told the flow and its input (flowName,
     * inputName) or the quick action (quickActionName); for an autolaunched
     * flow it is told neither.
     */
    public class Action {
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String label;
        /** screen_flow, autolaunched_flow or quick_action: the Action Type value. */
        @AuraEnabled
        public String type;
        /** Offered in each row's menu. */
        @AuraEnabled
        public Boolean onRow = true;
        /** Offered in the bar that appears with a selection. */
        @AuraEnabled
        public Boolean onSelection = true;
        /** The admin's question before it runs; null asks nothing of its own. */
        @AuraEnabled
        public String confirmation;
        /** A screen flow's API name, for the browser; null for the other types. */
        @AuraEnabled
        public String flowName;
        /** A screen flow's input for one record's Id; null for the other types. */
        @AuraEnabled
        public String inputName;
        /** A quick action's name for Salesforce's window: Object.Name, or Global.Name; null for the other types. */
        @AuraEnabled
        public String quickActionName;
        /** The Grid Action's Action Name: the flow's or the quick action's. Never sent. */
        public String actionName;
        /** The input the server fills with the record Id; blank finds it (GridActionService). Never sent. */
        public String serverInput;
        /** A custom permission the user must hold; blank for none. Never sent. */
        public String requiredPermission;
    }

    public class Definition {
        @AuraEnabled
        public String name;
        /** The configuration's label, which the grid shows as its title. */
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String objectApiName;
        @AuraEnabled
        public String objectLabel;
        /** The object's icon, "standard:account"; set by GridIcons, when a grid opens only. */
        @AuraEnabled
        public String objectIcon;
        @AuraEnabled
        public Integer pageSize;
        @AuraEnabled
        public String sortField;
        @AuraEnabled
        public String sortDirection;
        /**
         * The sorts after sortField, in order: [{ field, direction }], each a
         * column the grid can sort by, direction "asc" or "desc"; up to
         * MAX_SORT_LEVELS - 1. Empty without a sortField.
         */
        @AuraEnabled
        public List<Map<String, String>> thenSort = new List<Map<String, String>>();
        @AuraEnabled
        public Boolean allowInlineEdit;
        /**
         * The admin allows Export. forUser() narrows it, in a grid that
         * requires Export Reports, to users who hold that permission.
         */
        @AuraEnabled
        public Boolean allowCsvExport;
        /** Export needs Salesforce's Export Reports permission (forUser). Never sent. */
        public Boolean requireExportReports = false;
        /** The user's full name, for a Formatted Report's "Generated by"; set by forUser(). */
        @AuraEnabled
        public String userName;
        /**
         * The admin allows deleting the selected rows. forUser() narrows
         * it to users who may delete the object.
         */
        @AuraEnabled
        public Boolean allowMassDelete;
        /**
         * The admin allows importing a file, in a grid that also allows new
         * records (an import creates a record for each row without an Id).
         * forUser() narrows it to users who may edit the object, since an
         * import writes the grid's editable columns.
         */
        @AuraEnabled
        public Boolean allowImport;
        /** This user may create records of the object; set by forUser(). */
        @AuraEnabled
        public Boolean canCreate = false;
        /**
         * The grid has a New button. forUser() narrows it to users who may
         * create records of the object.
         */
        @AuraEnabled
        public Boolean allowNewRecords = false;
        /**
         * Each row's menu has Edit, which opens Salesforce's own edit form
         * for the record: in a grid that edits cells, for a user who may edit
         * the object. forUser() sets it.
         */
        @AuraEnabled
        public Boolean canEditRecords = false;
        /**
         * Each row's menu has Change Owner (GridOwnerService): in a grid that
         * edits cells, on an object with an owner, for a user who may edit the
         * object and its owner. forUser() sets it.
         */
        @AuraEnabled
        public Boolean canChangeOwner = false;
        /**
         * The object has record types and the grid an editable picklist: each
         * row carries its RecordTypeId, so its picklists offer only the values
         * its record type allows (the browser reads those from Salesforce).
         * forUser() sets it.
         */
        @AuraEnabled
        public Boolean byRecordType = false;
        /**
         * Every change this grid makes is written to Grid Edit Log.
         * Server-side only: each write reads it from the configuration.
         */
        public Boolean logChanges = false;
        /** Columns, from the left, that stay in place when the grid scrolls sideways. */
        @AuraEnabled
        public Integer frozenColumns;
        /** True: the rows are numbered down the grid's left edge. */
        @AuraEnabled
        public Boolean showRowNumbers = true;
        /** The grid's height in pixels; null fills the window. */
        @AuraEnabled
        public Integer height;
        @AuraEnabled
        public List<Column> columns = new List<Column>();
        /** Conditional formats, in the order they apply. */
        @AuraEnabled
        public List<DisplayRule> displayRules = new List<DisplayRule>();
        /**
         * The grouping the grid opens with, outermost first:
         * [{ field, unit }], unit being day, month, quarter or year for a date
         * and null otherwise. Users change it for their session.
         */
        @AuraEnabled
        public List<Map<String, String>> grouping = new List<Map<String, String>>();
        /** Tabs of related records under each row, in order; forUser() drops what the user cannot read. */
        @AuraEnabled
        public List<Child> children = new List<Child>();
        /** Actions users can run on a row or the selection, in order; forUser() drops what the user may not run. */
        @AuraEnabled
        public List<Action> actions = new List<Action>();
        /** Configuration problems that did not stop the grid, such as a skipped display rule. */
        @AuraEnabled
        public List<String> warnings = new List<String>();
        /** The admin's filters, in words for the grid to show; every one holds. */
        @AuraEnabled
        public List<GridFilters.Condition> filters = new List<GridFilters.Condition>();
        /**
         * On a record page, the field pointing to the page's record;
         * null for none. The browser uses it only to say the list is filtered.
         */
        @AuraEnabled
        public String recordPageField;

        /** HR-6: lower-case local names of the columns an admin marked editable. */
        public Set<String> editableFields() {
            Set<String> out = new Set<String>();
            if (allowInlineEdit != true) {
                return out;
            }
            for (Column c : columns) {
                if (c.adminEditable == true) {
                    out.add(c.field.toLowerCase());
                }
            }
            return out;
        }

        /**
         * The fields to read: every column, then the controlling field of any
         * dependent picklist that is not itself a column, since the grid needs
         * it to offer the right values, then the field of any format
         * rule, which the grid tests on every row.
         */
        public List<String> fieldNames() {
            List<String> out = new List<String>();
            Set<String> seen = new Set<String>();
            for (Column c : columns) {
                if (c.isFormula != true && c.isChildTotal != true) {
                    out.add(c.field);
                    seen.add(c.field.toLowerCase());
                }
            }
            for (Column c : columns) {
                if (c.dependentOn != null && seen.add(c.dependentOn.toLowerCase())) {
                    out.add(c.dependentOn);
                }
            }
            for (DisplayRule r : displayRules) {
                // A formula rule's field is only the cell it colors; a
                // two-field rule reads its other field too.
                if (r.field != null && r.isFormula != true && seen.add(r.field.toLowerCase())) {
                    out.add(r.field);
                }
                if (r.compareField != null && seen.add(r.compareField.toLowerCase())) {
                    out.add(r.compareField);
                }
            }
            return out;
        }

        /** The paths the grid's formulas read, each once, read with the rows but not sent. */
        public List<String> formulaPaths() {
            Set<String> seen = new Set<String>();
            List<String> out = new List<String>();
            for (Column c : columns) {
                if (c.formula != null) {
                    for (String p : c.formula.paths) {
                        if (seen.add(p.toLowerCase())) {
                            out.add(p);
                        }
                    }
                }
            }
            for (DisplayRule r : displayRules) {
                if (r.formula != null) {
                    for (String p : r.formula.paths) {
                        if (seen.add(p.toLowerCase())) {
                            out.add(p);
                        }
                    }
                }
            }
            return out;
        }

        /** The child total columns, which the server works out for each page of rows. */
        public Boolean hasChildTotals() {
            for (Column c : columns) {
                if (c.childTotal != null) {
                    return true;
                }
            }
            return false;
        }

        /** The formula columns and formula rules, which the server works out for each row. */
        public Boolean hasFormulas() {
            for (Column c : columns) {
                if (c.formula != null) {
                    return true;
                }
            }
            for (DisplayRule r : displayRules) {
                if (r.formula != null) {
                    return true;
                }
            }
            return false;
        }
    }

    /**
     * The configuration as authored. Throws with the name if it does not
     * exist, and says so if it is archived: a page that shows it then
     * says what happened, rather than showing a grid the admin took away.
     */
    public static Definition load(String developerName) {
        return load(developerName, false);
    }

    /**
     * The same, archived or not when `evenIfArchived`: a parent grid's child
     * total column still totals the related records of a child table
     * whose grid is archived, and reads that grid's filters to do it.
     */
    public static Definition load(String developerName, Boolean evenIfArchived) {
        Grid_Configuration__mdt cfg = String.isBlank(developerName)
            ? null
            : Grid_Configuration__mdt.getInstance(developerName);
        if (cfg == null) {
            throw new GridException('No Grid Configuration named "' + developerName + '".');
        }
        if (cfg.Archived__c == true && evenIfArchived != true) {
            throw new GridException(
                'The grid ' + cfg.MasterLabel + ' is archived. A Rowhouse admin can restore it on the Grid Admin tab.'
            );
        }
        return build(
            cfg,
            columnsOf(cfg),
            rulesOf(cfg),
            GridChildTables.linksOf(cfg),
            GridActions.recordsOf(cfg),
            GridFilters.recordsOf(cfg)
        );
    }

    /**
     * getAll() and getInstance() return only the first 255 characters of a
     * Long Text Area field (Salesforce documents this); SOQL returns all of it.
     * A formula that long is read again with SOQL, so it is never used, or
     * saved back by the Grid Admin tab, cut short.
     */
    @TestVisible
    private static final Integer CACHED_TEXT_LIMIT = 255;

    /**
     * Every Grid Column of a configuration, turned off or not, in no particular order.
     *
     * By SOQL on the configuration, in user mode as every query is
     * (GridSecurity): about 25 ms for Consignments' 16 columns, where getAll()
     * read every grid's columns, all 144 in a test org, in 100–140 ms,
     * and more with every grid an org adds. SOQL also
     * returns a long formula whole. A user who may not query the type (no
     * Rowhouse Grid User) is read with getAll(), as everyone was before.
     */
    public static List<Grid_Column__mdt> columnsOf(Grid_Configuration__mdt cfg) {
        if (cfg.Id != null) {
            try {
                return (List<Grid_Column__mdt>) GridSecurity.query(
                    'SELECT ' +
                        String.join(allFieldsOf(Grid_Column__mdt.SObjectType), ', ') +
                        ' FROM ' +
                        GridDescribe.apiName(Grid_Column__mdt.SObjectType) +
                        ' WHERE ' +
                        GridDescribe.apiName(Grid_Column__mdt.Grid_Configuration__c) +
                        ' = :configId',
                    new Map<String, Object>{ 'configId' => cfg.Id }
                );
            } catch (Exception e) {
                // No access to the type: read below, as every user can.
            }
        }
        List<Grid_Column__mdt> out = new List<Grid_Column__mdt>();
        Set<Id> longFormulas = new Set<Id>();
        for (Grid_Column__mdt c : Grid_Column__mdt.getAll().values()) {
            if (belongsTo(c.Grid_Configuration__c, cfg)) {
                out.add(c);
                if (c.Formula__c != null && c.Formula__c.length() >= CACHED_TEXT_LIMIT) {
                    longFormulas.add(c.Id);
                }
            }
        }
        if (!longFormulas.isEmpty()) {
            Map<Id, Grid_Column__mdt> whole = new Map<Id, Grid_Column__mdt>();
            try {
                whole.putAll(
                    (List<Grid_Column__mdt>) GridSecurity.query(
                        'SELECT Id, ' +
                            GridDescribe.apiName(Grid_Column__mdt.Formula__c) +
                            ' FROM ' +
                            GridDescribe.apiName(Grid_Column__mdt.SObjectType) +
                            ' WHERE Id IN :ids',
                        new Map<String, Object>{ 'ids' => longFormulas }
                    )
                );
            } catch (Exception e) {
                // A user who cannot query the type keeps the first 255 characters:
                // such a formula then fails to build and is skipped, with a warning.
            }
            for (Integer i = 0; i < out.size(); i++) {
                if (whole.containsKey(out[i].Id)) {
                    // getAll()'s records are read-only: the whole formula goes on a copy.
                    Grid_Column__mdt copy = out[i].clone(true, true, true, true);
                    copy.Formula__c = whole.get(out[i].Id).Formula__c;
                    out[i] = copy;
                }
            }
        }
        return out;
    }

    /** Every field of a type, by API name: what getAll() hands back, for a query to match it. */
    private static List<String> allFieldsOf(Schema.SObjectType objectType) {
        List<String> names = new List<String>();
        for (Schema.SObjectField f : objectType.getDescribe(SObjectDescribeOptions.DEFERRED).fields.getMap().values()) {
            names.add(GridDescribe.apiName(f));
        }
        return names;
    }

    /** Every Grid Display Rule of a configuration, active or not, in no particular order. */
    public static List<Grid_Display_Rule__mdt> rulesOf(Grid_Configuration__mdt cfg) {
        List<Grid_Display_Rule__mdt> out = new List<Grid_Display_Rule__mdt>();
        Set<Id> longFormulas = new Set<Id>();
        for (Grid_Display_Rule__mdt r : Grid_Display_Rule__mdt.getAll().values()) {
            if (belongsTo(r.Grid_Configuration__c, cfg)) {
                out.add(r);
                if (r.Formula__c != null && r.Formula__c.length() >= CACHED_TEXT_LIMIT) {
                    longFormulas.add(r.Id);
                }
            }
        }
        if (!longFormulas.isEmpty()) {
            Map<Id, Grid_Display_Rule__mdt> whole = new Map<Id, Grid_Display_Rule__mdt>();
            try {
                whole.putAll(
                    (List<Grid_Display_Rule__mdt>) GridSecurity.query(
                        'SELECT Id, ' +
                            GridDescribe.apiName(Grid_Display_Rule__mdt.Formula__c) +
                            ' FROM ' +
                            GridDescribe.apiName(Grid_Display_Rule__mdt.SObjectType) +
                            ' WHERE Id IN :ids',
                        new Map<String, Object>{ 'ids' => longFormulas }
                    )
                );
            } catch (Exception e) {
                // A user who cannot query the type keeps the first 255 characters:
                // such a formula then fails to build and is skipped, with a warning.
            }
            for (Integer i = 0; i < out.size(); i++) {
                if (whole.containsKey(out[i].Id)) {
                    // getAll()'s records are read-only: the whole formula goes on a copy.
                    Grid_Display_Rule__mdt copy = out[i].clone(true, true, true, true);
                    copy.Formula__c = whole.get(out[i].Id).Formula__c;
                    out[i] = copy;
                }
            }
        }
        return out;
    }

    /**
     * A configuration from records in hand: the org's (load), or a draft the
     * Grid Admin tab has not saved yet (GridAdmin), so that a draft
     * is checked by exactly the code that will read it once saved. Columns,
     * actions and child tables marked Inactive, and rules not Active, are left
     * out, as if they were not there.
     */
    public static Definition build(
        Grid_Configuration__mdt cfg,
        List<Grid_Column__mdt> allColumns,
        List<Grid_Display_Rule__mdt> allRules,
        List<Grid_Child_Table__mdt> links,
        List<Grid_Action__mdt> actionRecords
    ) {
        return build(cfg, allColumns, allRules, links, actionRecords, new List<Grid_Filter__mdt>());
    }

    /** The most columns a grid freezes: what the column menu and the Grid Admin tab allow. */
    public static final Integer MAX_FROZEN = 5;

    /**
     * Rows a page, as Page Size says: blank is the default; a number Setup
     * accepts but the grid cannot use is brought within 1 to the most a page
     * holds, with a warning.
     */
    @TestVisible
    private static Integer pageSizeOf(Decimal value, List<String> warnings) {
        if (value == null) {
            return GridDataService.DEFAULT_PAGE_SIZE;
        }
        Integer n = value.intValue();
        if (n < 1) {
            warnings.add(
                'Page Size: ' +
                    n +
                    ' is less than 1, so the grid loads ' +
                    GridDataService.DEFAULT_PAGE_SIZE +
                    ' rows at a time, as when it is blank.'
            );
            return GridDataService.DEFAULT_PAGE_SIZE;
        }
        if (n > GridDataService.MAX_PAGE_SIZE) {
            warnings.add(
                'Page Size: ' +
                    n.format() +
                    ' is more than ' +
                    GridDataService.MAX_PAGE_SIZE.format() +
                    ', so the grid loads ' +
                    GridDataService.MAX_PAGE_SIZE.format() +
                    ' rows at a time.'
            );
            return GridDataService.MAX_PAGE_SIZE;
        }
        return n;
    }

    /**
     * Frozen Columns, as far as MAX_FROZEN: more frozen than that leaves the
     * columns after them out of reach on a narrower screen.
     */
    @TestVisible
    private static Integer frozenColumnsOf(Decimal value, List<String> warnings) {
        Integer n = value == null ? 0 : Math.max(0, value.intValue());
        if (n > MAX_FROZEN) {
            warnings.add(
                'Frozen Columns: ' + n + ' is more than ' + MAX_FROZEN + ', so the grid freezes ' + MAX_FROZEN + '.'
            );
            return MAX_FROZEN;
        }
        return n;
    }

    /** The same, with the configuration's Grid Filters. */
    public static Definition build(
        Grid_Configuration__mdt cfg,
        List<Grid_Column__mdt> allColumns,
        List<Grid_Display_Rule__mdt> allRules,
        List<Grid_Child_Table__mdt> links,
        List<Grid_Action__mdt> actionRecords,
        List<Grid_Filter__mdt> filterRecords
    ) {
        Schema.SObjectType objectType = GridDescribe.typeFor(cfg.Object_API_Name__c);

        Definition def = new Definition();
        def.name = cfg.DeveloperName;
        def.label = cfg.MasterLabel;
        def.objectApiName = GridDescribe.localName(objectType);
        def.objectLabel = objectType.getDescribe(SObjectDescribeOptions.DEFERRED).getLabelPlural();
        def.pageSize = pageSizeOf(cfg.Page_Size__c, def.warnings);
        def.sortField = cfg.Default_Sort_Field__c;
        // An encrypted field cannot be sorted by: the grid opens in the order SOQL gives.
        // A field of a parent record (GridPaths) is checked at the end of its path.
        Schema.SObjectField sortBy;
        try {
            sortBy = GridPaths.isPath(def.sortField)
                ? GridPaths.resolve(objectType, def.sortField).field
                : GridDescribe.fieldOrNull(objectType, def.sortField);
        } catch (GridException e) {
            sortBy = null; // a path that cannot work is reported where the sort is used
        }
        if (sortBy != null && GridDescribe.isEncrypted(sortBy.getDescribe())) {
            def.warnings.add(
                'Default Sort Field: ' +
                    sortBy.getDescribe().getLabel() +
                    ' is encrypted, so the grid cannot sort by it.'
            );
            def.sortField = null;
        }
        def.sortDirection = 'desc'.equalsIgnoreCase(cfg.Default_Sort_Direction__c) ? 'desc' : 'asc';
        def.allowInlineEdit = cfg.Allow_Inline_Edit__c;
        def.allowCsvExport = cfg.Allow_CSV_Export__c;
        def.requireExportReports = cfg.Require_Export_Reports__c == true;
        def.allowMassDelete = cfg.Allow_Mass_Delete__c == true;
        def.allowNewRecords = cfg.Allow_New_Records__c == true;
        // An import creates a record for each row without a record Id, so a grid
        // without new records offers no import at all.
        def.allowImport = cfg.Allow_Import__c == true && def.allowNewRecords;
        if (cfg.Allow_Import__c == true && !def.allowNewRecords) {
            def.warnings.add('Allow Import: the grid offers no import, because Allow New Records is off.');
        }
        def.logChanges = cfg.Log_Changes__c == true;
        def.frozenColumns = frozenColumnsOf(cfg.Frozen_Columns__c, def.warnings);
        def.showRowNumbers = cfg.Show_Row_Numbers__c == true;
        def.height = cfg.Height_Px__c == null || cfg.Height_Px__c <= 0 ? null : cfg.Height_Px__c.intValue();
        // Checked here, so a Record Page Field that is not a lookup stops the grid
        // at once rather than on the first record page.
        def.recordPageField = String.isBlank(cfg.Record_Page_Field__c) ? null : cfg.Record_Page_Field__c.trim();
        if (def.recordPageField != null) {
            def.recordPageField = GridDescribe.localName(GridFilters.recordField(def));
        }
        def.filters = GridFilters.fromRecords(filterRecords, objectType);
        Integer formulas = 0;

        List<Grid_Column__mdt> columns = new List<Grid_Column__mdt>();
        for (Grid_Column__mdt c : allColumns) {
            if (c.Inactive__c != true) {
                columns.add(c);
            }
        }
        columns.sort(new BySortOrder());

        List<GroupDefault> groupDefaults = new List<GroupDefault>();
        Integer childTotals = 0;
        for (Grid_Column__mdt c : columns) {
            if (String.isNotBlank(c.Child_Table__c)) {
                if (childTotals >= GridChildTables.MAX_CHILD_TOTALS) {
                    def.warnings.add(
                        'Grid Column ' +
                            c.DeveloperName +
                            ' was skipped: a grid has at most ' +
                            GridChildTables.MAX_CHILD_TOTALS +
                            ' child total columns.'
                    );
                    continue;
                }
                try {
                    def.columns.add(childTotalColumn(c, objectType, links));
                    childTotals++;
                } catch (GridException e) {
                    def.warnings.add('Child total column ' + c.DeveloperName + ' was skipped: ' + e.getMessage());
                }
                continue;
            }
            if (String.isNotBlank(c.Formula__c)) {
                if (formulas >= GridFormulas.MAX_FORMULAS) {
                    def.warnings.add(
                        'Grid Column ' +
                            c.DeveloperName +
                            ' was skipped: a grid has at most ' +
                            GridFormulas.MAX_FORMULAS +
                            ' formulas.'
                    );
                    continue;
                }
                try {
                    def.columns.add(formulaColumn(c, objectType));
                    formulas++;
                } catch (GridException e) {
                    def.warnings.add('Formula column ' + c.DeveloperName + ' was skipped: ' + e.getMessage());
                }
                continue;
            }
            // A field of the grid's object, or of a parent record through lookups (GridPaths).
            GridPaths.FieldPath fp;
            try {
                fp = GridPaths.resolve(objectType, c.Field_API_Name__c);
            } catch (GridException e) {
                if (!GridPaths.isPath(c.Field_API_Name__c)) {
                    throw e; // an unknown field of the grid's own object stops the grid, as before
                }
                def.warnings.add('Grid Column ' + c.DeveloperName + ' was skipped: ' + e.getMessage());
                continue;
            }
            Schema.SObjectField f = fp.field;
            Schema.DescribeFieldResult d = f.getDescribe();
            Column col = new Column();
            col.field = fp.local;
            col.isPath = fp.isPath();
            col.label = String.isNotBlank(c.Column_Label__c)
                ? c.Column_Label__c
                : fp.isPath() ? GridPaths.defaultLabel(fp) : defaultLabel(d);
            String configured = String.isBlank(c.Cell_Type__c) ? null : c.Cell_Type__c.trim().toLowerCase();
            if (configured != null && !KNOWN_TYPES.contains(configured)) {
                throw new GridException(
                    'Grid Column ' + c.DeveloperName + ' has an unknown Cell Type "' + c.Cell_Type__c + '".'
                );
            }
            col.type = configured != null ? configured : GridDescribe.cellType(f);
            // Rich text stays read only: the grid edits plain text, and its markup
            // would be lost. Long plain text is editable: its editor
            // reads the whole value first (GridController.fetchFullText), so the
            // shortened copy the rows carry (TC-055) is never what is saved.
            Boolean richText = d.getType() == Schema.DisplayType.TEXTAREA && d.isHtmlFormatted();
            // The allow-list ignores the RUNNING USER's field-level security on
            // purpose: describe is user-scoped, and FLS is stripInaccessible's job.
            // Mixing the two would let an FLS strip masquerade as an allow-list
            // refusal, and the tests could no longer tell which mechanism worked.
            col.adminEditable = c.Editable__c == true && writableByType(d);
            // User-independent here. forUser() narrows it with GridSecurity.canEdit
            // (HR-5: access decisions are made in GridSecurity and nowhere else).
            col.editable = col.adminEditable && EDITABLE_TYPES.contains(col.type) && !richText;
            col.creatable = col.editable;
            col.encrypted = GridDescribe.isEncrypted(d);
            col.sortable = c.Sortable__c != false && d.isSortable() && !col.encrypted;
            if (col.encrypted) {
                // In a grid that logs, the log keeps no copy of an encrypted
                // value (GridEditLog), so the admin is told when they set it up.
                def.warnings.add(
                    'Grid Column ' +
                        c.DeveloperName +
                        ': ' +
                        d.getLabel() +
                        ' is encrypted, so the grid cannot sort, filter, group, search or subtotal it.' +
                        (def.logChanges == true && col.editable
                            ? ' Its changes are logged without their old and new values.'
                            : '')
                );
            }
            col.scale = d.getScale();
            col.length = LENGTH_TYPES.contains(d.getType()) && d.getLength() > 0 ? d.getLength() : null;
            col.width = c.Width_Px__c == null ? null : c.Width_Px__c.intValue();
            col.wrap = c.Wrap_Text__c == true;
            col.alwaysShown = c.Always_Shown__c == true;
            col.required = writableByType(d) && GridDescribe.isRequired(d);
            if (d.getType() == Schema.DisplayType.PICKLIST || d.getType() == Schema.DisplayType.MULTIPICKLIST) {
                Map<String, List<String>> validFor = GridDescribe.dependencies(f);
                if (validFor != null) {
                    // On a parent record, its controlling field is that record's too.
                    String controlling = GridDescribe.localName(d.getController());
                    col.dependentOn = fp.isPath() ? fp.local.substringBeforeLast('.') + '.' + controlling : controlling;
                }
                col.options = new List<Map<String, Object>>();
                for (Schema.PicklistEntry e : d.getPicklistValues()) {
                    if (e.isActive()) {
                        Map<String, Object> option = new Map<String, Object>{
                            'value' => e.getValue(),
                            'label' => e.getLabel()
                        };
                        if (validFor != null) {
                            option.put('validFor', validFor.get(e.getValue()));
                        }
                        col.options.add(option);
                    }
                }
            }
            if (d.getType() == Schema.DisplayType.REFERENCE) {
                col.referenceTo = GridDescribe.referenceTargets(f);
                // A lookup filter is applied by Salesforce's own lookup:
                // Apex can tell a field has one, but not what it says.
                if (d.getFilteredLookupInfo() != null) {
                    col.filteredLookup = true;
                    col.fieldApiName = GridDescribe.apiName(f);
                    // Salesforce's own lookup edits a field of the row's record; one
                    // on a parent record is shown, not edited, in the grid.
                    if (fp.isPath()) {
                        col.editable = false;
                        col.creatable = false;
                    }
                }
            }
            // The name field links to the row's record; a parent record's name does not.
            col.isName = d.isNameField() && !fp.isPath();
            // A new row sets fields of its own record; a parent record's are edited once it is saved.
            if (fp.isPath()) {
                col.creatable = false;
            }
            col.externalId = d.isExternalId();
            // Offered where values repeat; any groupable column the admin groups by,
            // or lets users group by with Allow Grouping.
            col.groupable =
                GridDescribe.isGroupable(d) &&
                (GROUP_OFFERED_TYPES.contains(col.type) ||
                c.Group_Level__c != null ||
                c.Allow_Grouping__c == true);
            if (c.Allow_Grouping__c == true && !GridDescribe.isGroupable(d)) {
                def.warnings.add(
                    'Grid Column ' +
                        c.DeveloperName +
                        ': Allow Grouping does not apply to ' +
                        d.getLabel() +
                        ', a ' +
                        col.type +
                        ' field the grid cannot group by.'
                );
            }
            String subtotal = String.isBlank(c.Subtotal__c) ? null : c.Subtotal__c.trim().toLowerCase();
            if (subtotal != null && GridDescribe.subtotalFits(subtotal, d)) {
                col.subtotal = subtotal;
            } else if (subtotal != null) {
                def.warnings.add(
                    'Grid Column ' +
                        c.DeveloperName +
                        ': a ' +
                        subtotal +
                        ' subtotal does not apply to ' +
                        d.getLabel() +
                        ', a ' +
                        col.type +
                        ' field, so it is not shown.'
                );
            }
            if (c.Group_Level__c != null) {
                groupDefaults.add(new GroupDefault(c, col, d));
            }
            // A user filters by the values SOQL can filter on.
            col.filterable = d.isFilterable() && col.type != 'id' && !col.encrypted;
            col.searchable = GridDataService.isSearchable(d);
            def.columns.add(col);
        }
        loadGrouping(def, groupDefaults);
        loadThenSort(def, cfg.Then_Sort_By__c);
        loadDisplayRules(def, allRules, objectType, GridFormulas.MAX_FORMULAS - formulas);
        def.children = GridChildTables.childrenFrom(links, objectType, def.warnings);
        def.actions = GridActions.actionsFrom(actionRecords, objectType, def.warnings);
        return def;
    }

    /** One column's Group Level, waiting to be put in order. */
    private class GroupDefault {
        public Grid_Column__mdt source;
        public Column col;
        public Schema.DescribeFieldResult d;
        public GroupDefault(Grid_Column__mdt source, Column col, Schema.DescribeFieldResult d) {
            this.source = source;
            this.col = col;
            this.d = d;
        }
    }

    /**
     * The grouping the grid opens with: the columns with a Group Level, level 1
     * first. A level that is not 1, 2 or 3, a column the grid cannot group by,
     * and a second column on a level already taken are left out with a warning.
     */
    private static void loadGrouping(Definition def, List<GroupDefault> defaults) {
        Map<Integer, GroupDefault> byLevel = new Map<Integer, GroupDefault>();
        for (GroupDefault g : defaults) {
            Decimal raw = g.source.Group_Level__c;
            String name = 'Grid Column ' + g.source.DeveloperName;
            if (raw < 1 || raw > MAX_GROUP_LEVELS || raw != raw.setScale(0, System.RoundingMode.DOWN)) {
                def.warnings.add(name + ': Group Level must be 1, 2 or 3.');
            } else if (!g.col.groupable) {
                def.warnings.add(
                    name + ': the grid cannot group by ' + g.d.getLabel() + ', a ' + g.col.type + ' field.'
                );
            } else if (byLevel.containsKey(raw.intValue())) {
                def.warnings.add(
                    name +
                        ': Group Level ' +
                        raw.intValue() +
                        ' is already used by ' +
                        byLevel.get(raw.intValue()).source.DeveloperName +
                        '.'
                );
            } else {
                byLevel.put(raw.intValue(), g);
            }
        }
        for (Integer level = 1; level <= MAX_GROUP_LEVELS; level++) {
            GroupDefault g = byLevel.get(level);
            if (g == null) {
                continue;
            }
            String unit = null;
            if (GridDescribe.isDateLike(g.d)) {
                unit = String.isBlank(g.source.Group_Date_Unit__c)
                    ? 'month'
                    : g.source.Group_Date_Unit__c.trim().toLowerCase();
                if (!GROUP_UNITS.contains(unit)) {
                    def.warnings.add(
                        'Grid Column ' +
                            g.source.DeveloperName +
                            ': unknown Group Date Unit "' +
                            g.source.Group_Date_Unit__c +
                            '"; grouping by month.'
                    );
                    unit = 'month';
                }
            }
            def.grouping.add(new Map<String, String>{ 'field' => g.col.field, 'unit' => unit });
        }
    }

    /**
     * Then Sort By: the sorts after Default Sort Field, each a column the grid
     * can sort by, in order, up to MAX_SORT_LEVELS in all. One that does not
     * fit is skipped with a warning. Without a Default Sort Field (none set,
     * or one the grid cannot sort by), the first that fits takes its place.
     */
    private static void loadThenSort(Definition def, String raw) {
        if (String.isBlank(raw)) {
            return;
        }
        Map<String, Column> sortable = new Map<String, Column>();
        for (Column c : def.columns) {
            if (c.sortable == true && c.field != null) {
                sortable.put(c.field.toLowerCase(), c);
            }
        }
        Set<String> used = new Set<String>();
        if (String.isNotBlank(def.sortField)) {
            used.add(def.sortField.trim().toLowerCase());
        }
        for (Map<String, String> level : parseSortLevels(raw)) {
            if (level.containsKey('error')) {
                def.warnings.add(
                    'Then Sort By: "' +
                        level.get('error') +
                        '" is not a field followed by ASC or DESC, so it is skipped.'
                );
                continue;
            }
            String field = level.get('field');
            Column c = sortable.get(field.toLowerCase());
            if (c == null) {
                def.warnings.add(
                    'Then Sort By: ' + field + ' is not a column of this grid that can be sorted, so it is skipped.'
                );
                continue;
            }
            if (used.contains(c.field.toLowerCase())) {
                def.warnings.add('Then Sort By: ' + field + ' is already in the sort, so it is skipped.');
                continue;
            }
            Integer levels = (String.isBlank(def.sortField) ? 0 : 1) + def.thenSort.size();
            if (levels >= MAX_SORT_LEVELS) {
                def.warnings.add(
                    'Then Sort By: a grid sorts by up to ' +
                        MAX_SORT_LEVELS +
                        ' fields, so ' +
                        field +
                        ' and any after it are skipped.'
                );
                break;
            }
            used.add(c.field.toLowerCase());
            if (String.isBlank(def.sortField)) {
                def.sortField = c.field;
                def.sortDirection = level.get('direction');
            } else {
                def.thenSort.add(new Map<String, String>{ 'field' => c.field, 'direction' => level.get('direction') });
            }
        }
    }

    /**
     * Then Sort By as written, "LastModifiedDate DESC, CloseDate ASC": one
     * { field, direction } per part, direction "asc" unless DESC is given. A
     * part that is not a field and an optional ASC or DESC comes back as
     * { error } with the part. Nothing here is checked against the object.
     */
    public static List<Map<String, String>> parseSortLevels(String raw) {
        List<Map<String, String>> out = new List<Map<String, String>>();
        if (String.isBlank(raw)) {
            return out;
        }
        for (String part : raw.split(',')) {
            String text = part.trim();
            if (String.isBlank(text)) {
                continue;
            }
            List<String> words = text.split('\\s+');
            String direction = words.size() > 1 ? words[1].toLowerCase() : 'asc';
            if (words.size() > 2 || (direction != 'asc' && direction != 'desc')) {
                out.add(new Map<String, String>{ 'error' => text });
            } else {
                out.add(new Map<String, String>{ 'field' => words[0], 'direction' => direction });
            }
        }
        return out;
    }

    /** The sorts as Then Sort By keeps them: "LastModifiedDate DESC, CloseDate ASC"; null for none. */
    public static String formatSortLevels(List<Map<String, String>> levels) {
        List<String> parts = new List<String>();
        for (Map<String, String> level : levels == null ? new List<Map<String, String>>() : levels) {
            if (level != null && String.isNotBlank(level.get('field'))) {
                parts.add(
                    level.get('field').trim() + ('desc'.equalsIgnoreCase(level.get('direction')) ? ' DESC' : ' ASC')
                );
            }
        }
        return parts.isEmpty() ? null : String.join(parts, ', ');
    }

    /** The display rules that are on, in Sort Order; a rule that does not make sense is skipped with a warning. */
    private static void loadDisplayRules(
        Definition def,
        List<Grid_Display_Rule__mdt> allRules,
        Schema.SObjectType objectType,
        Integer formulaBudget
    ) {
        List<Grid_Display_Rule__mdt> rules = new List<Grid_Display_Rule__mdt>();
        for (Grid_Display_Rule__mdt r : allRules) {
            if (r.Inactive__c != true) {
                rules.add(r);
            }
        }
        rules.sort(new RulesInOrder());
        Map<String, Column> byField = new Map<String, Column>();
        for (Column c : def.columns) {
            byField.put(c.field.toLowerCase(), c);
        }
        Integer budget = formulaBudget;
        for (Grid_Display_Rule__mdt r : rules) {
            try {
                if (String.isNotBlank(r.Formula__c) && budget <= 0) {
                    throw new GridException('a grid has at most ' + GridFormulas.MAX_FORMULAS + ' formulas.');
                }
                DisplayRule rule = displayRule(r, objectType, byField);
                if (rule.formula != null) {
                    budget--;
                }
                def.displayRules.add(rule);
            } catch (GridException e) {
                def.warnings.add('Display rule ' + r.DeveloperName + ' was skipped: ' + e.getMessage());
            }
        }
    }

    /**
     * A formula column: its key, label, type and formula, built for the
     * grid's object. Throws a GridException in an admin's terms.
     */
    private static Column formulaColumn(Grid_Column__mdt c, Schema.SObjectType objectType) {
        if (String.isBlank(c.Column_Label__c)) {
            throw new GridException('a formula column needs a Column Label.');
        }
        String type = String.isBlank(c.Formula_Type__c) ? 'text' : c.Formula_Type__c.trim().toLowerCase();
        if (!GridFormulas.RETURN_TYPES.containsKey(type)) {
            throw new GridException('unknown Formula Type "' + c.Formula_Type__c + '".');
        }
        Column col = new Column();
        col.field = GridFormulas.KEY_PREFIX + c.DeveloperName;
        col.label = c.Column_Label__c.trim();
        col.type = type;
        col.isFormula = true;
        col.formula = GridFormulas.compile(objectType, c.Formula__c, GridFormulas.RETURN_TYPES.get(type));
        col.scale = NUMBER_TYPES.contains(type)
            ? (c.Decimal_Places__c == null ? 2 : Math.max(0, Math.min(9, c.Decimal_Places__c.intValue())))
            : null;
        col.width = c.Width_Px__c == null ? null : c.Width_Px__c.intValue();
        col.wrap = c.Wrap_Text__c == true;
        col.alwaysShown = c.Always_Shown__c == true;
        col.editable = false;
        col.sortable = false;
        col.required = false;
        col.groupable = false;
        col.filterable = false;
        return col;
    }

    /**
     * A child total column: its key, label, type and what it totals,
     * checked against this grid's child tables (`links`, the org's or a
     * draft's). Throws a GridException in an admin's terms.
     */
    public static Column childTotalColumn(
        Grid_Column__mdt c,
        Schema.SObjectType objectType,
        List<Grid_Child_Table__mdt> links
    ) {
        GridChildTables.ChildTotal total = GridChildTables.childTotalOf(
            c.Child_Table__c,
            c.Child_Total__c,
            c.Child_Field__c,
            objectType,
            links
        );
        Column col = new Column();
        col.field = GridChildTables.TOTAL_PREFIX + c.DeveloperName;
        col.label = String.isNotBlank(c.Column_Label__c) ? c.Column_Label__c.trim() : total.defaultLabel;
        col.type = total.type;
        col.scale = total.scale;
        col.isChildTotal = true;
        col.childTotal = total;
        col.width = c.Width_Px__c == null ? null : c.Width_Px__c.intValue();
        col.wrap = c.Wrap_Text__c == true;
        col.alwaysShown = c.Always_Shown__c == true;
        col.editable = false;
        col.sortable = false;
        col.required = false;
        col.groupable = false;
        col.filterable = false;
        return col;
    }

    /**
     * A field's heading when the admin gives none: its label, less the
     * " ID" describe puts after a standard lookup's ("Account ID", "Owner ID"),
     * which is not what a record page or a list view says.
     */
    public static String defaultLabel(Schema.DescribeFieldResult d) {
        String label = d.getLabel();
        if (d.getType() == Schema.DisplayType.REFERENCE && label.endsWith(' ID') && label.length() > 3) {
            return label.removeEnd(' ID');
        }
        return label;
    }

    /**
     * One display rule, checked against the schema and normalised. Throws a
     * GridException whose message says what is wrong, in an admin's terms.
     */
    @TestVisible
    private static DisplayRule displayRule(
        Grid_Display_Rule__mdt r,
        Schema.SObjectType objectType,
        Map<String, Column> columnsByField
    ) {
        DisplayRule rule = new DisplayRule();
        rule.name = r.DeveloperName;
        rule.label = String.isNotBlank(r.MasterLabel) ? r.MasterLabel : r.DeveloperName;
        rule.style = String.isBlank(r.Style__c) ? null : r.Style__c.trim().toLowerCase();
        if (rule.style == null) {
            throw new GridException('it has no Style.');
        }
        if (!FORMAT_STYLES.contains(rule.style)) {
            throw new GridException('unknown Style "' + r.Style__c + '".');
        }
        rule.applyTo = 'row'.equalsIgnoreCase(String.isBlank(r.Apply_To__c) ? '' : r.Apply_To__c.trim())
            ? 'row'
            : 'cell';
        if (String.isNotBlank(r.Formula__c)) {
            return formulaRule(rule, r, objectType, columnsByField);
        }
        // A parent record's field too (GridPaths): the rows carry it under its path.
        GridPaths.FieldPath fp = GridPaths.resolve(objectType, r.Field_API_Name__c);
        Schema.SObjectField f = fp.field;
        Schema.DescribeFieldResult d = f.getDescribe();
        rule.field = fp.local;
        Column col = columnsByField.get(rule.field.toLowerCase());
        rule.type = col != null ? col.type : GridDescribe.cellType(f);
        rule.operator = String.isBlank(r.Operator__c) ? 'equals' : r.Operator__c.trim().toLowerCase();
        if (!OPERATORS.contains(rule.operator)) {
            throw new GridException('unknown Operator "' + r.Operator__c + '".');
        }
        if (rule.applyTo == 'cell' && col == null) {
            throw new GridException(
                d.getLabel() +
                    ' is not a column of this grid, so there is no cell to format.' +
                    ' Set Apply To to Row, or add the column.'
            );
        }
        requireStyleFits(rule, d);
        requireOperatorFits(rule, d);
        if (String.isNotBlank(r.Compare_Field__c)) {
            compareWith(rule, r, objectType, d);
            return rule;
        }
        rule.value = ruleValue(rule, d, r.Value__c);
        if (rule.operator == 'between') {
            if (String.isBlank(r.Value_To__c)) {
                throw new GridException('Between needs Value To, the upper end of the range.');
            }
            rule.valueTo = ruleValue(rule, d, r.Value_To__c);
        }
        return rule;
    }

    /** A data bar needs a number in a cell; the other styles fit anything. */
    private static void requireStyleFits(DisplayRule rule, Schema.DescribeFieldResult d) {
        if (rule.style != 'data_bar') {
            return;
        }
        if (!NUMBER_TYPES.contains(rule.type)) {
            throw new GridException(
                'a data bar shows a number, and ' + d.getLabel() + ' is a ' + rule.type + ' field.'
            );
        }
        if (rule.applyTo != 'cell') {
            throw new GridException('a data bar goes in a cell. Set Apply To to Cell.');
        }
    }

    /**
     * A two-field rule: Field compared with Compare Field, both of the
     * same kind; Value must be blank. Equals and does not equal for any kind,
     * greater and less than for numbers, dates and times.
     */
    private static void compareWith(
        DisplayRule rule,
        Grid_Display_Rule__mdt r,
        Schema.SObjectType objectType,
        Schema.DescribeFieldResult d
    ) {
        if (String.isNotBlank(r.Value__c)) {
            throw new GridException('it has both a Value and a Compare Field. Clear one of them.');
        }
        if (!COMPARE_OPERATORS.contains(rule.operator)) {
            throw new GridException('the ' + rule.operator.replace('_', ' ') + ' operator cannot compare two fields.');
        }
        GridPaths.FieldPath otherPath = GridPaths.resolve(objectType, r.Compare_Field__c);
        Schema.SObjectField other = otherPath.field;
        Schema.DescribeFieldResult od = other.getDescribe();
        String otherType = GridDescribe.cellType(other);
        if (kindOf(rule.type) != kindOf(otherType)) {
            throw new GridException(
                d.getLabel() + ' and ' + od.getLabel() + ' are not the same kind of field, so they cannot be compared.'
            );
        }
        if (od.getLocalName().equalsIgnoreCase(rule.field)) {
            throw new GridException('it compares ' + d.getLabel() + ' with itself.');
        }
        rule.compareField = otherPath.local;
        rule.compareType = otherType;
    }

    /** Which fields can be compared with which. */
    private static String kindOf(String type) {
        if (NUMBER_TYPES.contains(type)) {
            return 'number';
        }
        if (DATE_TYPES.contains(type)) {
            return 'date';
        }
        if (type == 'reference' || type == 'owner') {
            return 'reference';
        }
        if (type == 'time' || type == 'checkbox' || type == 'multipicklist') {
            return type;
        }
        return 'text';
    }

    /**
     * A formula rule: a true-or-false formula, built for the grid's
     * object. Field names the cell it colors; with Apply To Row it may be
     * blank. Operator and Value are not used.
     */
    private static DisplayRule formulaRule(
        DisplayRule rule,
        Grid_Display_Rule__mdt r,
        Schema.SObjectType objectType,
        Map<String, Column> columnsByField
    ) {
        rule.isFormula = true;
        rule.operator = 'formula';
        if (String.isNotBlank(r.Field_API_Name__c)) {
            String name = r.Field_API_Name__c.trim();
            Column col = columnsByField.get(name.toLowerCase());
            if (col == null) {
                Schema.DescribeFieldResult d = GridDescribe.field(objectType, name).getDescribe();
                col = columnsByField.get(d.getLocalName().toLowerCase());
                if (col == null && rule.applyTo == 'cell') {
                    throw new GridException(
                        d.getLabel() +
                            ' is not a column of this grid, so there is no cell to format.' +
                            ' Set Apply To to Row, or add the column.'
                    );
                }
                rule.field = d.getLocalName();
            } else {
                rule.field = col.field;
            }
            rule.type = col == null ? null : col.type;
        } else if (rule.applyTo == 'cell') {
            throw new GridException(
                'a formula rule that colors a cell needs the Field of that cell. Or set Apply To to Row.'
            );
        }
        if (rule.style == 'data_bar') {
            throw new GridException('a data bar needs a number to measure, not a formula.');
        }
        rule.formula = GridFormulas.compile(objectType, r.Formula__c, FormulaEval.FormulaReturnType.BOOLEAN);
        return rule;
    }

    private static void requireOperatorFits(DisplayRule rule, Schema.DescribeFieldResult d) {
        requireFits(rule.operator, rule.type, d.getLabel());
    }

    /**
     * Does the operator mean something for a field of this type? Throws, in an
     * admin's terms, when it does not. Display rules and filters alike.
     */
    public static void requireFits(String op, String type, String fieldLabel) {
        if (!OPERATORS.contains(op)) {
            throw new GridException('unknown Operator "' + op + '".');
        }
        Boolean fits;
        if (op == 'is_blank' || op == 'is_not_blank') {
            fits = type != 'checkbox'; // a checkbox is never blank: test it for false
        } else if (op == 'equals' || op == 'not_equals') {
            fits = true;
        } else if (op == 'starts_with') {
            fits = TEXT_TYPES.contains(type) && type != 'multipicklist';
        } else if (op == 'contains' || op == 'not_contains') {
            fits = TEXT_TYPES.contains(type);
        } else {
            fits = ORDERED_TYPES.contains(type);
        }
        if (!fits) {
            throw new GridException(
                'the ' + op.replace('_', ' ') + ' operator does not apply to ' + fieldLabel + ', a ' + type + ' field.'
            );
        }
    }

    /** The rule's value, checked for the field's type and normalised; null for the blank tests. */
    private static String ruleValue(DisplayRule rule, Schema.DescribeFieldResult d, String raw) {
        return conditionValue(rule.operator, rule.type, d, raw);
    }

    /**
     * A condition's value, checked for the field's type and normalised; null
     * for the blank tests. Display rules and filters alike.
     */
    public static String conditionValue(String operator, String type, Schema.DescribeFieldResult d, String raw) {
        if (operator == 'is_blank' || operator == 'is_not_blank') {
            return null;
        }
        String value = raw == null ? '' : raw.trim();
        if (value == '') {
            throw new GridException('it has no Value. To test for an empty field, use Is blank.');
        }
        if (NUMBER_TYPES.contains(type)) {
            try {
                return Decimal.valueOf(value).toPlainString();
            } catch (Exception e) {
                throw new GridException(
                    'Value "' + value + '" is not a number. Write it as 1234.5, without separators or symbols.'
                );
            }
        }
        if (DATE_TYPES.contains(type)) {
            return dateValue(value);
        }
        if (type == 'time') {
            Matcher m = TIME_OF_DAY.matcher(value);
            if (!m.matches()) {
                throw new GridException('Value "' + value + '" is not a time. Write it as 17:30 or 17:30:00.');
            }
            return m.group(1) + ':' + m.group(2) + ':' + (m.group(3) == null ? '00' : m.group(3));
        }
        if (type == 'checkbox') {
            if (value.equalsIgnoreCase('true') || value.equalsIgnoreCase('false')) {
                return value.toLowerCase();
            }
            throw new GridException('Value "' + value + '" is not true or false.');
        }
        if (type == 'reference' || type == 'owner') {
            return referenceValue(value, d);
        }
        // A picklist's equals, and a multi-select's every test, name whole values. A single
        // picklist's contains and starts with match part of one, as they do for text.
        if (
            (type == 'multipicklist' && operator != 'starts_with') ||
            (type == 'picklist' && (operator == 'equals' || operator == 'not_equals'))
        ) {
            return picklistValue(
                value,
                d,
                type == 'multipicklist' && (operator == 'equals' || operator == 'not_equals')
            );
        }
        return value;
    }

    /** An ISO date, or TODAY with an optional offset in days, upper-cased and without spaces. */
    private static String dateValue(String value) {
        String compact = value.deleteWhitespace().toUpperCase();
        if (RELATIVE_DATE.matcher(compact).matches()) {
            return compact;
        }
        if (ISO_DATE.matcher(compact).matches()) {
            try {
                Date parsed = Date.valueOf(compact);
                // Date.valueOf rolls 2026-02-30 over to 2 March; a real date comes back unchanged.
                if (String.valueOf(parsed) == compact) {
                    return compact;
                }
            } catch (Exception e) {
                // falls through to the message below
            }
        }
        throw new GridException(
            'Value "' + value + '" is not a date. Write it as 2026-12-31, TODAY, TODAY+7 or TODAY-30.'
        );
    }

    /** $User, or the Id of a record the lookup can point to, as 18 characters. */
    private static String referenceValue(String value, Schema.DescribeFieldResult d) {
        if (value.equalsIgnoreCase('$User')) {
            return '$User';
        }
        Id recordId;
        try {
            recordId = Id.valueOf(value);
        } catch (Exception e) {
            throw new GridException('Value "' + value + '" is not a record Id or $User.');
        }
        if (!d.getReferenceTo().contains(recordId.getSObjectType())) {
            throw new GridException(
                'Value "' + value + '" is not the Id of a record ' + d.getLabel() + ' can point to.'
            );
        }
        return String.valueOf(recordId);
    }

    /**
     * A picklist value by API name or label, in any case, as its API name.
     * Inactive values count: a rule may want to flag rows that still hold one.
     * For a multi-select equals, each semicolon-separated value is matched.
     */
    private static String picklistValue(String value, Schema.DescribeFieldResult d, Boolean several) {
        List<String> parts = several ? value.split(';') : new List<String>{ value };
        List<String> out = new List<String>();
        for (String part : parts) {
            String wanted = part.trim();
            String found = null;
            for (Schema.PicklistEntry e : d.getPicklistValues()) {
                if (e.getValue().equalsIgnoreCase(wanted)) {
                    found = e.getValue();
                    break;
                }
            }
            if (found == null) {
                for (Schema.PicklistEntry e : d.getPicklistValues()) {
                    if (e.getLabel().equalsIgnoreCase(wanted)) {
                        found = e.getValue();
                        break;
                    }
                }
            }
            if (found == null) {
                throw new GridException('"' + wanted + '" is not a value of ' + d.getLabel() + '.');
            }
            out.add(found);
        }
        return String.join(out, ';');
    }

    /**
     * The lookup targets this user may create a record of, for a
     * lookup's New item: not users or queues, which are not created from a
     * lookup in Salesforce either.
     */
    private static List<Map<String, String>> newTargets(List<String> referenceTo) {
        List<Map<String, String>> out = new List<Map<String, String>>();
        for (String name : referenceTo) {
            Schema.SObjectType t = GridDescribe.typeFor(name);
            if (t == User.SObjectType || t == Group.SObjectType || !GridSecurity.canCreate(t)) {
                continue;
            }
            out.add(
                new Map<String, String>{
                    'object' => GridDescribe.apiName(t),
                    'label' => t.getDescribe(SObjectDescribeOptions.DEFERRED).getLabel()
                }
            );
        }
        return out.isEmpty() ? null : out;
    }

    /** What this user may see and edit. */
    /**
     * Does a row's record type narrow its picklists? When the object has record
     * types beyond the master, the user can read RecordTypeId, and the grid
     * edits a picklist of its own object.
     */
    @TestVisible
    private static Boolean byRecordType(Schema.SObjectType objectType, List<Column> columns) {
        Boolean picklists = false;
        for (Column c : columns) {
            if (
                c.editable == true &&
                (c.type == 'picklist' ||
                c.type == 'multipicklist') &&
                c.field != null &&
                !c.field.contains('.')
            ) {
                picklists = true;
            }
        }
        if (!picklists) {
            return false;
        }
        Schema.SObjectField rt = GridDescribe.fieldOrNull(objectType, 'RecordTypeId');
        return rt != null &&
            GridSecurity.canRead(rt) &&
            objectType.getDescribe(SObjectDescribeOptions.DEFERRED).getRecordTypeInfos().size() > 1;
    }

    /**
     * The sort the grid opens with keeps only fields this user can read:
     * sorting by one they cannot would hint at its values, and the query
     * could not run. The sorts after one left out move up. A field that cannot
     * be found at all stays, and is reported where the sort is used.
     */
    @TestVisible
    private static void narrowSort(Definition def, Schema.SObjectType objectType) {
        List<Map<String, String>> levels = new List<Map<String, String>>();
        if (String.isNotBlank(def.sortField)) {
            levels.add(new Map<String, String>{ 'field' => def.sortField, 'direction' => def.sortDirection });
        }
        levels.addAll(def.thenSort);
        List<Map<String, String>> readable = new List<Map<String, String>>();
        for (Map<String, String> level : levels) {
            Boolean ok = true;
            try {
                ok = GridSecurity.canReadPath(GridPaths.resolve(objectType, level.get('field')));
            } catch (GridException e) {
                ok = true;
            }
            if (ok) {
                readable.add(level);
            }
        }
        if (readable.size() == levels.size()) {
            return;
        }
        def.sortField = readable.isEmpty() ? null : readable[0].get('field');
        if (!readable.isEmpty()) {
            def.sortDirection = readable[0].get('direction');
        }
        def.thenSort = new List<Map<String, String>>();
        for (Integer i = 1; i < readable.size(); i++) {
            def.thenSort.add(readable[i]);
        }
    }

    public static Definition forUser(String developerName) {
        Definition def = load(developerName);
        Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
        GridSecurity.requireRead(objectType);
        Boolean objectEditable = def.allowInlineEdit == true && GridSecurity.canUpdate(objectType);
        def.allowMassDelete = def.allowMassDelete == true && GridSecurity.canDelete(objectType);
        def.allowImport = def.allowImport == true && objectEditable;
        // As Salesforce does for a report, when the grid asks for it.
        def.allowCsvExport =
            def.allowCsvExport == true && (def.requireExportReports != true || GridSecurity.canExportReports());
        def.userName = UserInfo.getName();
        def.canCreate = GridSecurity.canCreate(objectType);
        def.allowNewRecords = def.allowNewRecords == true && def.canCreate;
        def.canEditRecords = objectEditable;
        Schema.SObjectField owner = GridDescribe.fieldOrNull(objectType, 'OwnerId');
        def.canChangeOwner = objectEditable && owner != null && GridSecurity.canEdit(owner);
        // A new row's cells are filled in only in a grid that edits cells.
        Boolean objectCreatable = def.allowNewRecords && def.allowInlineEdit == true;
        // The admin's filters narrow every query; one on a field this user cannot
        // read could not be run in user mode, and leaving it out would widen
        // what the user sees. So the grid does not open.
        for (GridFilters.Condition fc : def.filters) {
            GridPaths.FieldPath fp = GridPaths.resolve(objectType, fc.field);
            if (!GridSecurity.canReadPath(fp)) {
                throw new GridException(
                    'This grid shows only the records chosen by ' +
                        defaultLabel(fp.field.getDescribe()) +
                        ', a field you do not have access to. Ask your Salesforce admin.'
                );
            }
        }
        List<Column> visible = new List<Column>();
        for (Column c : def.columns) {
            if (c.isFormula == true) {
                // A formula column shows what its fields add up to, so it needs
                // every one of them readable.
                if (GridFormulas.canReadAll(objectType, c.formula.paths)) {
                    visible.add(c);
                }
                continue;
            }
            if (c.isChildTotal == true) {
                // A child total shows what the child records add up to, so it needs
                // them, their link to the row and the field totalled readable.
                if (GridChildTables.canTotal(c.childTotal)) {
                    visible.add(c);
                }
                continue;
            }
            GridPaths.FieldPath fp = GridPaths.resolve(objectType, c.field);
            Schema.SObjectField f = fp.field;
            if (!GridSecurity.canReadPath(fp)) {
                continue; // unreadable columns are not rendered, exported or sent
            }
            // A parent record's field is saved to that record: the user edits it
            // there, whatever they may do to the grid's own records.
            c.editable = fp.isPath()
                ? c.editable && def.allowInlineEdit == true && GridSecurity.canEditPath(fp)
                : c.editable && objectEditable && GridSecurity.canEdit(f);
            c.creatable = c.creatable == true && objectCreatable && !fp.isPath() && GridSecurity.canSetOnCreate(f);
            // A lookup is edited by searching its target, so the user must be
            // able to read the target's names.
            if (c.referenceTo != null) {
                Boolean names = GridSecurity.canReadName(f);
                c.editable = c.editable && names;
                c.creatable = c.creatable && names;
                c.newTargets = (c.editable == true || c.creatable == true) && c.type == 'reference'
                    ? newTargets(c.referenceTo)
                    : null;
            }
            // A dependent picklist is only offered with its controlling value.
            if (c.dependentOn != null) {
                Boolean controlling = GridSecurity.canReadPath(GridPaths.resolve(objectType, c.dependentOn));
                c.editable = c.editable && controlling;
                c.creatable = c.creatable && controlling;
            }
            // A lookup's groups are labelled with the records' names.
            if (c.referenceTo != null) {
                c.groupable = c.groupable && GridSecurity.canReadName(f);
                // ... and is filtered by them.
                c.filterable = c.filterable && GridSecurity.canReadName(f);
            }
            visible.add(c);
        }
        def.columns = visible;
        def.byRecordType = byRecordType(objectType, visible);
        GridCurrency.describe(objectType, visible);
        // The default grouping keeps only columns this user can group by.
        Set<String> groupable = new Set<String>();
        for (Column c : visible) {
            if (c.groupable) {
                groupable.add(c.field);
            }
        }
        List<Map<String, String>> grouping = new List<Map<String, String>>();
        for (Map<String, String> level : def.grouping) {
            if (groupable.contains(level.get('field'))) {
                grouping.add(level);
            }
        }
        def.grouping = grouping;
        narrowSort(def, objectType);
        // A rule on a field this user cannot read would reveal the value by its
        // color, so it goes, without a warning that would name the field.
        // The same for a rule's other field and a formula rule's fields; a
        // formula rule's own Field is only the cell it colors, a column.
        Set<String> shown = new Set<String>();
        for (Column c : visible) {
            shown.add(c.field.toLowerCase());
        }
        List<DisplayRule> readable = new List<DisplayRule>();
        for (DisplayRule r : def.displayRules) {
            Boolean ok;
            if (r.isFormula == true) {
                ok =
                    GridFormulas.canReadAll(objectType, r.formula.paths) &&
                    (r.field == null ||
                    r.applyTo == 'row' ||
                    shown.contains(r.field.toLowerCase()));
            } else {
                ok =
                    GridSecurity.canReadPath(GridPaths.resolve(objectType, r.field)) &&
                    (r.compareField == null || GridSecurity.canReadPath(GridPaths.resolve(objectType, r.compareField)));
            }
            if (ok) {
                readable.add(r);
            }
        }
        def.displayRules = readable;
        // A tab of records the user cannot read is not offered, silently,
        // as for a column.
        List<Child> children = new List<Child>();
        for (Child c : def.children) {
            if (GridChildTables.canOpen(c)) {
                children.add(c);
            }
        }
        def.children = children;
        // An action that needs a custom permission the user lacks is not
        // offered; the server checks again when one is run.
        List<Action> actions = new List<Action>();
        for (Action a : def.actions) {
            if (GridActions.canRun(a)) {
                actions.add(a);
            }
        }
        def.actions = actions;
        return def;
    }

    /** Can this field ever be written, for anyone? (Not an FLS question.) */
    public static Boolean writableByType(Schema.DescribeFieldResult d) {
        return !d.isCalculated() &&
            !d.isAutoNumber() &&
            d.getType() != Schema.DisplayType.ID &&
            d.getName() != 'CreatedDate' &&
            d.getName() != 'LastModifiedDate' &&
            d.getName() != 'SystemModstamp';
    }

    /**
     * A metadata relationship field holds the parent's Id (a draft, its name);
     * match on either. Names compare as Salesforce compares API names, ignoring
     * case. Ids do not: two records' 15-character Ids can differ only in case,
     * and Apex's == on Strings ignores case, so the Id's first 15 characters
     * (an 18-character Id adds only a checksum) are compared exactly, with
     * equals().
     */
    public static Boolean belongsTo(Object parent, Grid_Configuration__mdt cfg) {
        if (parent == null || cfg == null) {
            return false;
        }
        String ref = String.valueOf(parent);
        if (ref == cfg.DeveloperName || ref == cfg.QualifiedApiName) {
            return true;
        }
        return cfg.Id != null && ref.length() >= 15 && ref.left(15).equals(String.valueOf(cfg.Id).left(15));
    }

    private class BySortOrder implements Comparator<Grid_Column__mdt> {
        public Integer compare(Grid_Column__mdt a, Grid_Column__mdt b) {
            Decimal x = a.Sort_Order__c == null ? 9999 : a.Sort_Order__c;
            Decimal y = b.Sort_Order__c == null ? 9999 : b.Sort_Order__c;
            if (x != y) {
                return x < y ? -1 : 1;
            }
            return a.DeveloperName.compareTo(b.DeveloperName);
        }
    }

    private class RulesInOrder implements Comparator<Grid_Display_Rule__mdt> {
        public Integer compare(Grid_Display_Rule__mdt a, Grid_Display_Rule__mdt b) {
            Decimal x = a.Sort_Order__c == null ? 9999 : a.Sort_Order__c;
            Decimal y = b.Sort_Order__c == null ? 9999 : b.Sort_Order__c;
            if (x != y) {
                return x < y ? -1 : 1;
            }
            return a.DeveloperName.compareTo(b.DeveloperName);
        }
    }
}
