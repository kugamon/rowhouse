/**
 * GridAdmin — the Grid Admin tab and the gear on each grid: read a
 * grid configuration as records, check a draft of it, and save the draft.
 *
 * WHO
 * Everything here needs the Rowhouse_Grid_Admin custom permission (the Rowhouse
 * Grid Admin permission set). Saving also needs Customize Application, which
 * deploying Custom Metadata needs and a packaged permission set cannot grant,
 * so only the org's real admins can save. Hiding the page and the gear from
 * everyone else is a convenience; these checks are the protection.
 *
 * SAVING IS A DEPLOY
 * Grid configurations are Custom Metadata, which Apex cannot insert or update.
 * A save deploys the records with Metadata.Operations.enqueueDeployment: not a
 * callout (HR-9), and no global Apex (HR-1). It runs in the background, a few
 * seconds; GridAdminDeploy writes the outcome to a Grid Save Result row the
 * page polls for (saveStatus). A deploy replaces each record whole, so every
 * field of every record in the draft is sent. Apex cannot delete Custom
 * Metadata either, so the page turns a column, an action or a child table off
 * (Inactive) and a rule off (Active), rather than removing it, and a whole
 * grid is archived (Archived) rather than deleted: its records are then
 * listed with links to Setup, where an admin can delete them.
 *
 * ROW ACTIONS
 * The Grid Admin tab's list has Edit, Clone and Archive on each grid, and
 * Restore and Delete in Setup on each archived one. Clone and archive are
 * deploys like a save: clone deploys a copy of every record under new names,
 * archive deploys the configuration record alone with Archived changed.
 *
 * ONE CHECK
 * A draft is checked by GridConfig.build, the code the grid itself reads a
 * configuration with, on records made in memory: what the page warns about is
 * exactly what the grid would skip. A few things that would stop the grid
 * outright, or the deploy, are errors here and block the save.
 */
public with sharing class GridAdmin {
    public static final String PERMISSION = 'Rowhouse_Grid_Admin';
    /** A Custom Metadata record's name and label: at most 40 characters. */
    public static final Integer MAX_NAME = 40;
    /** What the metadata fields hold: a value, and a formula (Long Text Area). */
    private static final Integer MAX_VALUE = 255;
    private static final Integer MAX_FORMULA = 3900;
    private static final Integer MAX_COLUMN_LABEL = 80;
    private static final Pattern API_NAME_PATTERN = Pattern.compile('^[A-Za-z][A-Za-z0-9_]*$');

    // ---------------------------------------------------------------- shapes

    /** A grid configuration and its records, as the Grid Admin tab edits them. */
    public class Draft {
        @AuraEnabled
        public ConfigDraft config = new ConfigDraft();
        @AuraEnabled
        public List<ColumnDraft> columns = new List<ColumnDraft>();
        @AuraEnabled
        public List<RuleDraft> rules = new List<RuleDraft>();
        @AuraEnabled
        public List<ActionDraft> actions = new List<ActionDraft>();
        @AuraEnabled
        public List<ChildDraft> children = new List<ChildDraft>();
        /** The admin's filters. */
        @AuraEnabled
        public List<FilterDraft> filters = new List<FilterDraft>();
    }

    public class ConfigDraft {
        /** The configuration's API name (DeveloperName). */
        @AuraEnabled
        public String name;
        /** Its label: the grid's title. */
        @AuraEnabled
        public String label;
        /** True until it has been saved once. */
        @AuraEnabled
        public Boolean isNew = false;
        @AuraEnabled
        public String objectApiName;
        @AuraEnabled
        public Integer pageSize;
        @AuraEnabled
        public String sortField;
        @AuraEnabled
        public String sortDirection;
        /** The sorts after sortField, in order (Then Sort By): columns with Sort selected. */
        @AuraEnabled
        public List<SortLevel> thenSort = new List<SortLevel>();
        @AuraEnabled
        public Boolean allowInlineEdit = true;
        @AuraEnabled
        public Boolean allowCsvExport = true;
        /** Export only for users with Salesforce's Export Reports permission. */
        @AuraEnabled
        public Boolean requireExportReports = false;
        @AuraEnabled
        public Boolean allowMassDelete = false;
        @AuraEnabled
        public Boolean allowImport = false;
        /** The grid has a New button (Allow New Records); on for a new grid. */
        @AuraEnabled
        public Boolean allowNewRecords = true;
        @AuraEnabled
        public Boolean logChanges = false;
        @AuraEnabled
        public Integer frozenColumns;
        /** True: the rows are numbered down the grid's left edge (Show Row Numbers). */
        @AuraEnabled
        public Boolean showRowNumbers = true;
        @AuraEnabled
        public Integer height;
        /** On a record page, the lookup that points to the page's record; blank for none. */
        @AuraEnabled
        public String recordPageField;
        /** Out of use. Read for the page; a save keeps what the org has, and only archive changes it. */
        @AuraEnabled
        public Boolean archived = false;
    }

    /** One sort after the first: a column's field, and asc or desc. */
    public class SortLevel {
        @AuraEnabled
        public String field;
        @AuraEnabled
        public String direction = 'asc';
    }

    /** A Grid Column. The list's order is the grid's order. */
    public class ColumnDraft {
        /** The record's API name; blank for a column not saved yet. */
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String field;
        /** The header; blank uses the field's label. */
        @AuraEnabled
        public String columnLabel;
        @AuraEnabled
        public Boolean editable = false;
        @AuraEnabled
        public Boolean sortable = true;
        @AuraEnabled
        public Boolean wrap = false;
        @AuraEnabled
        public Boolean alwaysShown = false;
        @AuraEnabled
        public Integer width;
        @AuraEnabled
        public String cellType;
        @AuraEnabled
        public Integer groupLevel;
        @AuraEnabled
        public String groupUnit;
        /** Users may group by it from its menu, without the grid opening grouped by it. */
        @AuraEnabled
        public Boolean allowGrouping = false;
        @AuraEnabled
        public String subtotal;
        @AuraEnabled
        public Boolean inactive = false;
        /** A formula column's formula; blank for a column on a field. */
        @AuraEnabled
        public String formula;
        /** What the formula returns: text, number, currency, percent, date, datetime or checkbox. */
        @AuraEnabled
        public String formulaType;
        @AuraEnabled
        public Integer decimalPlaces;
        /** A child total column: the Grid Child Table it totals, by API name; blank for a column on a field. */
        @AuraEnabled
        public String childTable;
        /** sum, average, min, max or count. */
        @AuraEnabled
        public String childTotal;
        /** The child records' field to total; blank with count counts the records. */
        @AuraEnabled
        public String childField;
    }

    /** A Grid Display Rule. The list's order is the order the rules apply in. */
    public class RuleDraft {
        @AuraEnabled
        public String name;
        /** What the color means: the record's label, shown in the Display Key. */
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String field;
        @AuraEnabled
        public String operator;
        @AuraEnabled
        public String value;
        @AuraEnabled
        public String style;
        @AuraEnabled
        public String applyTo;
        @AuraEnabled
        public Boolean inactive = false;
        /** Between's upper end. */
        @AuraEnabled
        public String valueTo;
        /** Another field to compare with instead of a value. */
        @AuraEnabled
        public String compareField;
        /** A true-or-false formula instead of a condition. */
        @AuraEnabled
        public String formula;
    }

    /** A Grid Filter. The list's order is the order they are listed in; every one applies. */
    public class FilterDraft {
        @AuraEnabled
        public String name;
        /** The record's label; blank makes one from the field and the operator. */
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String field;
        @AuraEnabled
        public String operator;
        @AuraEnabled
        public String value;
        @AuraEnabled
        public String valueTo;
        @AuraEnabled
        public Boolean inactive = false;
    }

    /** A Grid Action. The list's order is the menu's order. */
    public class ActionDraft {
        @AuraEnabled
        public String name;
        /** What the menu item says: the record's label. */
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String type;
        @AuraEnabled
        public String actionName;
        @AuraEnabled
        public String inputName;
        @AuraEnabled
        public String showIn;
        @AuraEnabled
        public String confirmation;
        @AuraEnabled
        public String requiredPermission;
        @AuraEnabled
        public Boolean inactive = false;
    }

    /** A Grid Child Table. The list's order is the tabs' order. */
    public class ChildDraft {
        @AuraEnabled
        public String name;
        /** The child grid's configuration, by API name. */
        @AuraEnabled
        public String childConfig;
        @AuraEnabled
        public String relationshipField;
        @AuraEnabled
        public String tabLabel;
        /** The child grid's height in pixels; blank for the standard height. */
        @AuraEnabled
        public Integer height;
        @AuraEnabled
        public Boolean inactive = false;
    }

    /** What a check found: errors block a save; warnings are what the grid would skip. */
    public class Check {
        @AuraEnabled
        public List<String> errors = new List<String>();
        @AuraEnabled
        public List<String> warnings = new List<String>();
    }

    // ---------------------------------------------------------------- who

    public static void requireAdmin() {
        if (!GridSecurity.hasCustomPermission(PERMISSION)) {
            throw new GridException('This needs the Rowhouse Grid Admin permission set.');
        }
    }

    /** May the running user save? Customize Application, as well as Rowhouse Grid Admin. */
    public static Boolean canSave() {
        return GridSecurity.hasCustomPermission(PERMISSION) && GridSecurity.canCustomizeApplication();
    }

    /**
     * The version of Rowhouse installed in this org, as Setup's Installed
     * Packages names it without its patch number: '1.2'. For the Grid Admin
     * tab's line that links to rowhouse.app's What's new. Read from
     * Publisher, an ordinary query any user may run, not a callout (HR-9):
     * Rowhouse never asks anything outside the org; the admin's click on the
     * link is what leaves it. Null where Rowhouse is not installed as the
     * package (an org that deploys the source has no version of its own).
     * Publisher has no version name, so none is given. An org that also
     * publishes the namespace (linked to it as a Dev Hub) has been seen to
     * give the package's own code 0.0 there; that is no version, so none is
     * shown. System.requestVersion() is no way round it: outside a managed
     * package's context it throws an exception no catch can stop.
     */
    public static String installedVersion() {
        requireAdmin();
        return versionOf(GridDescribe.NAMESPACE);
    }

    /**
     * The views people saved of a grid, for its Views tab: every one, A to Z,
     * with its owner, who sees it and when it last changed (GridViews), but
     * not what it keeps. Rowhouse Grid Admin reads them all.
     */
    public static List<GridViews.View> views(String configName) {
        requireAdmin();
        return GridViews.everyViewOf(configName);
    }

    /** Delete a saved view of a grid, whoever owns it (Rowhouse Grid Admin can: Modify All on Grid View). */
    public static void deleteView(String configName, String viewId) {
        requireAdmin();
        GridViews.removeAny(configName, viewId);
    }

    /**
     * A namespace's installed version, '1.2'; null for a blank namespace, one
     * not installed, or one Publisher lists only at 0.0. The highest row is
     * taken: an org that also publishes the package (its namespace linked to
     * the org as a Dev Hub) can list the namespace at 0.0, which is no version.
     */
    @TestVisible
    private static String versionOf(String namespace) {
        if (String.isBlank(namespace)) {
            return null;
        }
        List<SObject> rows = GridSecurity.query(
            'SELECT MajorVersion, MinorVersion FROM Publisher WHERE NamespacePrefix = :namespace' +
            ' AND IsSalesforce = false ORDER BY MajorVersion DESC, MinorVersion DESC LIMIT 1',
            new Map<String, Object>{ 'namespace' => namespace }
        );
        return rows.isEmpty() ? null : versionText(rows[0].get('MajorVersion'), rows[0].get('MinorVersion'));
    }

    /** '1.2' from 1 and 2; null unless both are there, and for 0.0, which no released version is. */
    @TestVisible
    private static String versionText(Object major, Object minor) {
        if (major == null || minor == null) {
            return null;
        }
        if (Integer.valueOf(major) == 0 && Integer.valueOf(minor) == 0) {
            return null;
        }
        return String.valueOf(major) + '.' + String.valueOf(minor);
    }

    // ---------------------------------------------------------------- read

    /**
     * Every grid configuration: { name, label, objectApiName, objectLabel, columns,
     * childTables, logChanges, archived, usedBy }, by label. Columns and child
     * tables count those that are on; usedBy is the titles of the grids, not
     * archived, that show this one as a child table that is on.
     */
    public static List<Map<String, Object>> listConfigs() {
        requireAdmin();
        Map<String, Integer> columnCounts = new Map<String, Integer>();
        List<Grid_Configuration__mdt> configs = Grid_Configuration__mdt.getAll().values();
        for (Grid_Column__mdt c : Grid_Column__mdt.getAll().values()) {
            if (c.Inactive__c == true) {
                continue;
            }
            for (Grid_Configuration__mdt cfg : configs) {
                if (GridConfig.belongsTo(c.Grid_Configuration__c, cfg)) {
                    columnCounts.put(
                        cfg.DeveloperName,
                        (columnCounts.containsKey(cfg.DeveloperName) ? columnCounts.get(cfg.DeveloperName) : 0) + 1
                    );
                }
            }
        }
        // Child tables that are on, for the Grid Admin tab's count of grids with child tables,
        // and which grids show each grid as one, for the archive dialog.
        Map<String, Integer> childCounts = new Map<String, Integer>();
        Map<String, List<String>> usedBy = new Map<String, List<String>>();
        for (Grid_Child_Table__mdt c : Grid_Child_Table__mdt.getAll().values()) {
            if (c.Inactive__c == true) {
                continue;
            }
            Grid_Configuration__mdt parent = null;
            for (Grid_Configuration__mdt cfg : configs) {
                if (GridConfig.belongsTo(c.Grid_Configuration__c, cfg)) {
                    parent = cfg;
                    childCounts.put(
                        cfg.DeveloperName,
                        (childCounts.containsKey(cfg.DeveloperName) ? childCounts.get(cfg.DeveloperName) : 0) + 1
                    );
                }
            }
            if (parent == null || parent.Archived__c == true) {
                continue;
            }
            for (Grid_Configuration__mdt cfg : configs) {
                if (GridConfig.belongsTo(c.Child_Configuration__c, cfg) && cfg.DeveloperName != parent.DeveloperName) {
                    if (!usedBy.containsKey(cfg.DeveloperName)) {
                        usedBy.put(cfg.DeveloperName, new List<String>());
                    }
                    if (!usedBy.get(cfg.DeveloperName).contains(parent.MasterLabel)) {
                        usedBy.get(cfg.DeveloperName).add(parent.MasterLabel);
                    }
                }
            }
        }
        List<ConfigSummary> sorted = new List<ConfigSummary>();
        for (Grid_Configuration__mdt cfg : configs) {
            List<String> parents = usedBy.containsKey(cfg.DeveloperName)
                ? usedBy.get(cfg.DeveloperName)
                : new List<String>();
            parents.sort();
            sorted.add(
                new ConfigSummary(cfg, columnCounts.get(cfg.DeveloperName), childCounts.get(cfg.DeveloperName), parents)
            );
        }
        sorted.sort();
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (ConfigSummary s : sorted) {
            out.add(s.values);
        }
        return out;
    }

    private class ConfigSummary implements Comparable {
        public Map<String, Object> values;
        public ConfigSummary(Grid_Configuration__mdt cfg, Integer columns, Integer childTables, List<String> usedBy) {
            String objectLabel = cfg.Object_API_Name__c;
            try {
                objectLabel = GridDescribe.typeFor(cfg.Object_API_Name__c)
                    .getDescribe(SObjectDescribeOptions.DEFERRED)
                    .getLabelPlural();
            } catch (GridException e) {
                objectLabel = cfg.Object_API_Name__c + ' (unknown object)';
            }
            values = new Map<String, Object>{
                'name' => cfg.DeveloperName,
                'label' => cfg.MasterLabel,
                'objectApiName' => cfg.Object_API_Name__c,
                'objectLabel' => objectLabel,
                'columns' => columns == null ? 0 : columns,
                'childTables' => childTables == null ? 0 : childTables,
                'logChanges' => cfg.Log_Changes__c == true,
                'archived' => cfg.Archived__c == true,
                'usedBy' => usedBy
            };
        }
        public Integer compareTo(Object other) {
            String a = ((String) values.get('label')).toLowerCase();
            String b = ((String) ((ConfigSummary) other).values.get('label')).toLowerCase();
            return a == b ? 0 : (a < b ? -1 : 1);
        }
    }

    /**
     * One configuration as a draft, with what the grid currently skips
     * ({ draft, warnings, canSave }). Turned-off records are included, so the
     * page can turn them back on.
     */
    public static Map<String, Object> readConfig(String configName) {
        requireAdmin();
        Grid_Configuration__mdt cfg = configNamed(configName);
        Draft d = draftOf(cfg);
        List<String> warnings = new List<String>();
        try {
            warnings = GridConfig.load(cfg.DeveloperName).warnings;
        } catch (Exception e) {
            warnings.add('The grid cannot open: ' + e.getMessage());
        }
        return new Map<String, Object>{ 'draft' => d, 'warnings' => warnings, 'canSave' => canSave() };
    }

    /**
     * One configuration as a draft, turned-off records included, for export
     * (GridAdminTransfer). Checks nothing: callers check who may read it.
     */
    public static Draft draftNamed(String configName) {
        return draftOf(configNamed(configName));
    }

    /** The configuration of that API name. Throws when there is none. */
    private static Grid_Configuration__mdt configNamed(String configName) {
        Grid_Configuration__mdt cfg = String.isBlank(configName)
            ? null
            : Grid_Configuration__mdt.getInstance(configName.trim());
        if (cfg == null) {
            throw new GridException('No Grid Configuration named "' + configName + '".');
        }
        return cfg;
    }

    /** A configuration and every record of it, turned off or not, as a draft. */
    private static Draft draftOf(Grid_Configuration__mdt cfg) {
        Draft d = new Draft();
        d.config.name = cfg.DeveloperName;
        d.config.label = cfg.MasterLabel;
        d.config.objectApiName = cfg.Object_API_Name__c;
        d.config.pageSize = toInteger(cfg.Page_Size__c);
        d.config.sortField = cfg.Default_Sort_Field__c;
        d.config.sortDirection = cfg.Default_Sort_Direction__c;
        for (Map<String, String> level : GridConfig.parseSortLevels(cfg.Then_Sort_By__c)) {
            if (!level.containsKey('error')) {
                SortLevel l = new SortLevel();
                l.field = level.get('field');
                l.direction = level.get('direction');
                d.config.thenSort.add(l);
            }
        }
        d.config.allowInlineEdit = cfg.Allow_Inline_Edit__c == true;
        d.config.allowCsvExport = cfg.Allow_CSV_Export__c == true;
        d.config.requireExportReports = cfg.Require_Export_Reports__c == true;
        d.config.allowMassDelete = cfg.Allow_Mass_Delete__c == true;
        d.config.allowImport = cfg.Allow_Import__c == true;
        d.config.allowNewRecords = cfg.Allow_New_Records__c == true;
        d.config.logChanges = cfg.Log_Changes__c == true;
        d.config.frozenColumns = toInteger(cfg.Frozen_Columns__c);
        d.config.showRowNumbers = cfg.Show_Row_Numbers__c == true;
        d.config.height = toInteger(cfg.Height_Px__c);
        d.config.recordPageField = cfg.Record_Page_Field__c;
        d.config.archived = cfg.Archived__c == true;

        for (SObject record : inOrder(GridConfig.columnsOf(cfg))) {
            Grid_Column__mdt c = (Grid_Column__mdt) record;
            ColumnDraft col = new ColumnDraft();
            col.name = c.DeveloperName;
            col.field = c.Field_API_Name__c;
            col.columnLabel = c.Column_Label__c;
            col.editable = c.Editable__c == true;
            col.sortable = c.Sortable__c != false;
            col.wrap = c.Wrap_Text__c == true;
            col.alwaysShown = c.Always_Shown__c == true;
            col.width = toInteger(c.Width_Px__c);
            col.cellType = c.Cell_Type__c;
            col.groupLevel = toInteger(c.Group_Level__c);
            col.groupUnit = c.Group_Date_Unit__c;
            col.allowGrouping = c.Allow_Grouping__c == true;
            col.subtotal = c.Subtotal__c;
            col.inactive = c.Inactive__c == true;
            col.formula = c.Formula__c;
            col.formulaType = c.Formula_Type__c;
            col.decimalPlaces = toInteger(c.Decimal_Places__c);
            col.childTable = c.Child_Table__c;
            col.childTotal = c.Child_Total__c;
            col.childField = c.Child_Field__c;
            d.columns.add(col);
        }
        for (SObject record : inOrder(GridConfig.rulesOf(cfg))) {
            Grid_Display_Rule__mdt r = (Grid_Display_Rule__mdt) record;
            RuleDraft rule = new RuleDraft();
            rule.name = r.DeveloperName;
            rule.label = r.MasterLabel;
            rule.field = r.Field_API_Name__c;
            rule.operator = r.Operator__c;
            rule.value = r.Value__c;
            rule.style = r.Style__c;
            rule.applyTo = r.Apply_To__c;
            rule.inactive = r.Inactive__c == true;
            rule.valueTo = r.Value_To__c;
            rule.compareField = r.Compare_Field__c;
            rule.formula = r.Formula__c;
            d.rules.add(rule);
        }
        for (SObject record : inOrder(GridFilters.recordsOf(cfg))) {
            Grid_Filter__mdt f = (Grid_Filter__mdt) record;
            FilterDraft filter = new FilterDraft();
            filter.name = f.DeveloperName;
            filter.label = f.MasterLabel;
            filter.field = f.Field_API_Name__c;
            filter.operator = f.Operator__c;
            filter.value = f.Value__c;
            filter.valueTo = f.Value_To__c;
            filter.inactive = f.Inactive__c == true;
            d.filters.add(filter);
        }
        for (SObject record : inOrder(GridActions.recordsOf(cfg))) {
            Grid_Action__mdt a = (Grid_Action__mdt) record;
            ActionDraft action = new ActionDraft();
            action.name = a.DeveloperName;
            action.label = a.MasterLabel;
            action.type = a.Action_Type__c;
            action.actionName = a.Action_Name__c;
            action.inputName = a.Input_Name__c;
            action.showIn = a.Show_In__c;
            action.confirmation = a.Confirmation__c;
            action.requiredPermission = a.Required_Permission__c;
            action.inactive = a.Inactive__c == true;
            d.actions.add(action);
        }
        for (SObject record : inOrder(GridChildTables.linksOf(cfg))) {
            Grid_Child_Table__mdt link = (Grid_Child_Table__mdt) record;
            ChildDraft child = new ChildDraft();
            child.name = link.DeveloperName;
            child.childConfig = configNameOf(link.Child_Configuration__c);
            child.relationshipField = link.Relationship_Field__c;
            child.tabLabel = link.Tab_Label__c;
            child.height = toInteger(link.Height_Px__c);
            child.inactive = link.Inactive__c == true;
            d.children.add(child);
        }
        return d;
    }

    /**
     * Objects that hold the platform's bookkeeping rather than records people
     * work with: sharing rows, field history, feeds, change events, platform
     * events, big objects, tags, and Custom Metadata.
     */
    private static final List<String> NOT_OFFERED_ENDINGS = new List<String>{
        '__mdt',
        '__Share',
        '__History',
        '__Feed',
        '__ChangeEvent',
        '__e',
        '__b',
        '__Tag',
        'Share',
        'History',
        'Feed',
        'ChangeEvent',
        'Tag'
    };

    /**
     * The objects a grid can show: queryable, with records people work with,
     * and readable by the admin, so the list names no object they cannot
     * see. { name, label }, by label.
     */
    public static List<Map<String, String>> listObjects() {
        requireAdmin();
        List<ObjectOption> options = new List<ObjectOption>();
        for (Schema.SObjectType t : Schema.getGlobalDescribe().values()) {
            Schema.DescribeSObjectResult d = t.getDescribe(SObjectDescribeOptions.DEFERRED);
            if (offered(d) && GridSecurity.canRead(t)) {
                options.add(new ObjectOption(d.getLocalName(), d.getLabel()));
            }
        }
        options.sort();
        List<Map<String, String>> out = new List<Map<String, String>>();
        for (ObjectOption o : options) {
            out.add(new Map<String, String>{ 'name' => o.name, 'label' => o.label });
        }
        return out;
    }

    private static Boolean offered(Schema.DescribeSObjectResult d) {
        if (!d.isQueryable() || d.isCustomSetting() || d.isDeprecatedAndHidden()) {
            return false;
        }
        String name = d.getName();
        for (String ending : NOT_OFFERED_ENDINGS) {
            if (name.endsWith(ending)) {
                return false;
            }
        }
        return true;
    }

    private class ObjectOption implements Comparable {
        public String name;
        public String label;
        public ObjectOption(String name, String label) {
            this.name = name;
            this.label = label;
        }
        public Integer compareTo(Object other) {
            String a = label.toLowerCase();
            String b = ((ObjectOption) other).label.toLowerCase();
            return a == b ? 0 : (a < b ? -1 : 1);
        }
    }

    /**
     * An object's fields, for choosing columns and rules, and the child tables
     * it could have: { name, label, labelPlural, fields: [...], children:
     * [{ config, label, fields: [relationship field names] }] }.
     * Each field: { name, label, type, sortable, groupable, editable (can ever
     * be edited in the grid), isName, subtotals: [kinds that fit] }.
     *
     * The admin must be able to read the object. A field they cannot read is
     * listed only when they hold View Setup and Configuration, as Setup lists
     * it for them: a grid can then be built for people who can read it, and
     * the check says the column is hidden from the admin (hiddenFromYou).
     */
    public static Map<String, Object> describeObject(String objectApiName) {
        requireAdmin();
        Schema.SObjectType objectType = GridDescribe.typeFor(objectApiName);
        GridSecurity.requireRead(objectType);
        Boolean viewSetup = GridSecurity.canViewSetup();
        Schema.DescribeSObjectResult od = objectType.getDescribe(SObjectDescribeOptions.DEFERRED);
        List<FieldOption> fields = new List<FieldOption>();
        for (Schema.SObjectField f : GridDescribe.fieldsFor(objectApiName).values()) {
            if (!viewSetup && !GridSecurity.canRead(f)) {
                continue;
            }
            Schema.DescribeFieldResult d = f.getDescribe();
            String type = GridDescribe.cellType(f);
            List<String> subtotals = new List<String>();
            for (String kind : new List<String>{ 'sum', 'average', 'min', 'max', 'count' }) {
                if (GridDescribe.subtotalFits(kind, d)) {
                    subtotals.add(kind);
                }
            }
            Boolean richText = d.getType() == Schema.DisplayType.TEXTAREA && d.isHtmlFormatted();
            // What a lookup points to, for the Record Page Field choice.
            List<String> referenceTo = new List<String>();
            for (Schema.SObjectType t : d.getReferenceTo()) {
                referenceTo.add(t.getDescribe(SObjectDescribeOptions.DEFERRED).getLocalName());
            }
            fields.add(
                new FieldOption(
                    new Map<String, Object>{
                        'name' => d.getLocalName(),
                        'label' => d.getLabel(),
                        // What a column of it is headed when it has no Column Label.
                        'heading' => GridConfig.defaultLabel(d),
                        'type' => type,
                        'sortable' => d.isSortable(),
                        'groupable' => GridDescribe.isGroupable(d),
                        'filterable' => d.isFilterable(),
                        'editable' => GridConfig.writableByType(d) &&
                        GridConfig.EDITABLE_TYPES.contains(type) &&
                        !richText,
                        'isName' => d.isNameField(),
                        'referenceTo' => referenceTo,
                        // A column can reach through a lookup to one kind of record to that record's fields (GridPaths).
                        'relationship' => d.getRelationshipName() == null
                            ? null
                            : GridPaths.withoutNamespace(d.getRelationshipName()),
                        'reachable' => d.getType() == Schema.DisplayType.REFERENCE &&
                        d.getRelationshipName() != null &&
                        referenceTo.size() == 1 &&
                        !d.isNamePointing(),
                        'subtotals' => subtotals
                    }
                )
            );
        }
        fields.sort();
        List<Map<String, Object>> fieldMaps = new List<Map<String, Object>>();
        for (FieldOption o : fields) {
            fieldMaps.add(o.values);
        }
        return new Map<String, Object>{
            'name' => od.getLocalName(),
            'label' => od.getLabel(),
            'labelPlural' => od.getLabelPlural(),
            'fields' => fieldMaps,
            'children' => childOptions(objectType, viewSetup)
        };
    }

    private class FieldOption implements Comparable {
        public Map<String, Object> values;
        public FieldOption(Map<String, Object> values) {
            this.values = values;
        }
        public Integer compareTo(Object other) {
            String a = ((String) values.get('label')).toLowerCase();
            String b = ((String) ((FieldOption) other).values.get('label')).toLowerCase();
            return a == b ? 0 : (a < b ? -1 : 1);
        }
    }

    /**
     * Configurations that could be a child table of this object: their object
     * has a lookup to it. As in describeObject, the admin must be able to read
     * the child object, and a lookup they cannot read is offered only with
     * View Setup and Configuration (viewSetup).
     */
    private static List<Map<String, Object>> childOptions(Schema.SObjectType parentType, Boolean viewSetup) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Grid_Configuration__mdt cfg : Grid_Configuration__mdt.getAll().values()) {
            if (cfg.Archived__c == true) {
                continue; // out of use: not offered as a new child table
            }
            Schema.SObjectType childType;
            try {
                childType = GridDescribe.typeFor(cfg.Object_API_Name__c);
            } catch (GridException e) {
                continue;
            }
            if (!GridSecurity.canRead(childType)) {
                continue;
            }
            // Lookups a new record can set come first, each group A to Z, so the
            // editor's first choice is a real link: an Account's Parent Account,
            // not its Master Record ID, which only a merge fills in.
            List<String> links = new List<String>();
            List<String> systemLinks = new List<String>();
            Map<String, String> labels = new Map<String, String>();
            for (Schema.SObjectField f : GridDescribe.fieldsFor(cfg.Object_API_Name__c).values()) {
                if (!viewSetup && !GridSecurity.canRead(f)) {
                    continue;
                }
                Schema.DescribeFieldResult d = f.getDescribe();
                if (d.getType() == Schema.DisplayType.REFERENCE && d.getReferenceTo().contains(parentType)) {
                    labels.put(d.getLocalName(), d.getLabel());
                    if (GridSecurity.canSetOnCreate(f)) {
                        links.add(d.getLocalName());
                    } else {
                        systemLinks.add(d.getLocalName());
                    }
                }
            }
            if (!links.isEmpty() || !systemLinks.isEmpty()) {
                links.sort();
                systemLinks.sort();
                links.addAll(systemLinks);
                // The child's object too: a child total column's field is chosen from it.
                out.add(
                    new Map<String, Object>{
                        'config' => cfg.DeveloperName,
                        'label' => cfg.MasterLabel,
                        'fields' => links,
                        'fieldLabels' => labels,
                        'objectApiName' => GridDescribe.localName(childType)
                    }
                );
            }
        }
        return out;
    }

    // ---------------------------------------------------------------- check

    /** Check a draft without saving it. */
    public static Check check(Draft d) {
        requireAdmin();
        return checkDraft(d);
    }

    private static Check checkDraft(Draft d) {
        Check result = new Check();
        if (d == null || d.config == null) {
            result.errors.add('There is nothing to save.');
            return result;
        }
        if (d.filters == null) {
            d.filters = new List<FilterDraft>(); // a draft from before filters
        }
        ConfigDraft c = d.config;
        if (String.isBlank(c.label)) {
            result.errors.add('Give the grid a title (its Label).');
        } else if (c.label.trim().length() > MAX_NAME) {
            result.errors.add('The title is ' + c.label.trim().length() + ' characters; ' + MAX_NAME + ' at most.');
        }
        String nameProblem = nameProblem(c.name);
        // In any case: getInstance() is case-sensitive, and record names are not.
        Grid_Configuration__mdt existing = String.isBlank(c.name) ? null : configIgnoringCase(c.name.trim());
        if (nameProblem != null) {
            result.errors.add('API name: ' + nameProblem);
        } else if (c.isNew == true && existing != null) {
            result.errors.add('A grid named ' + c.name.trim() + ' already exists. Choose another API name.');
        } else if (c.isNew != true && existing == null) {
            result.errors.add('No Grid Configuration named "' + c.name + '".');
        } else if (c.isNew != true) {
            c.name = existing.DeveloperName; // the org's spelling, which the save reads it back by
        }
        checkRecordNames(d, c.isNew == true ? null : existing, result);
        Schema.SObjectType objectType;
        try {
            objectType = GridDescribe.typeFor(c.objectApiName);
        } catch (GridException e) {
            result.errors.add(String.isBlank(c.objectApiName) ? 'Choose the object the grid shows.' : e.getMessage());
            return result;
        }
        if (existing != null && c.isNew != true && !sameObject(existing.Object_API_Name__c, objectType)) {
            result.errors.add('A grid\'s object cannot be changed. Create a new grid for another object.');
        }
        if (String.isNotBlank(c.sortField)) {
            try {
                if (!GridPaths.resolve(objectType, c.sortField).field.getDescribe().isSortable()) {
                    result.errors.add('The grid cannot be sorted by ' + c.sortField + '.');
                }
            } catch (GridException e) {
                result.errors.add('Default sort: ' + e.getMessage());
            }
        }
        checkThenSort(d, result);
        checkColumns(d, objectType, result);
        for (Integer i = 0; i < d.rules.size(); i++) {
            RuleDraft r = d.rules[i];
            if (String.isBlank(r.label)) {
                result.errors.add(
                    'Display rule ' + (i + 1) + ' needs a meaning, such as "Overdue": the Display Key shows it.'
                );
            } else if (r.label.trim().length() > MAX_NAME) {
                result.errors.add(
                    'Display rule "' + r.label.trim() + '": its meaning is ' + MAX_NAME + ' characters at most.'
                );
            }
            // Longer than the metadata field holds: the deploy would fail after Save.
            tooLong('Display rule "' + label(r.label, i) + '": its value', r.value, MAX_VALUE, result);
            tooLong('Display rule "' + label(r.label, i) + '": its Value To', r.valueTo, MAX_VALUE, result);
            tooLong('Display rule "' + label(r.label, i) + '": its formula', r.formula, MAX_FORMULA, result);
            if (String.isNotBlank(r.formula)) {
                // A formula that does not build is an error here, not a skipped rule.
                if (String.isBlank(r.field) && r.applyTo != 'row') {
                    result.errors.add(
                        'Display rule "' + label(r.label, i) + '": choose the cell it colors, or the whole row.'
                    );
                }
                String problem = formulaProblem(objectType, r.formula, FormulaEval.FormulaReturnType.BOOLEAN);
                if (problem != null) {
                    result.errors.add('Display rule "' + label(r.label, i) + '": ' + problem);
                }
            } else if (String.isBlank(r.field)) {
                result.errors.add('Display rule ' + (i + 1) + ' needs a field to test.');
            }
        }
        for (Integer i = 0; i < d.filters.size(); i++) {
            FilterDraft f = d.filters[i];
            if (String.isBlank(f.field)) {
                result.errors.add('Filter ' + (i + 1) + ' needs a field to test.');
            } else if (String.isNotBlank(f.label) && f.label.trim().length() > MAX_NAME) {
                result.errors.add('Filter ' + (i + 1) + ': its label is ' + MAX_NAME + ' characters at most.');
            }
            tooLong('Filter ' + (i + 1) + ': its value', f.value, MAX_VALUE, result);
            tooLong('Filter ' + (i + 1) + ': its Value To', f.valueTo, MAX_VALUE, result);
        }
        for (Integer i = 0; i < d.actions.size(); i++) {
            ActionDraft a = d.actions[i];
            if (String.isBlank(a.label)) {
                result.errors.add('Action ' + (i + 1) + ' needs a label: what its menu item says.');
            } else if (a.label.trim().length() > MAX_NAME) {
                result.errors.add('Action "' + a.label.trim() + '": its label is ' + MAX_NAME + ' characters at most.');
            }
            String type = String.isBlank(a.type) ? '' : a.type.trim().toLowerCase();
            String named = String.isBlank(a.label) ? 'Action ' + (i + 1) : 'Action "' + a.label.trim() + '"';
            String showIn = String.isBlank(a.showIn) ? 'row_menu_and_selection' : a.showIn.trim().toLowerCase();
            if (type == 'apex') {
                result.errors.add(named + ': ' + GridActions.NO_APEX);
            } else if (type == 'autolaunched_flow' && a.inactive != true && String.isBlank(a.requiredPermission)) {
                result.errors.add(named + ': ' + GridActions.PERMISSION_NEEDED);
            } else if (type == 'quick_action' && a.inactive != true && showIn == 'selection') {
                result.errors.add(named + ': ' + GridActions.QUICK_ACTION_ON_ROW);
            }
        }
        for (Integer i = 0; i < d.children.size(); i++) {
            ChildDraft ch = d.children[i];
            if (String.isBlank(ch.childConfig) || Grid_Configuration__mdt.getInstance(ch.childConfig.trim()) == null) {
                result.errors.add('Child table ' + (i + 1) + ' needs the grid it shows.');
            } else if (String.isNotBlank(c.name) && ch.childConfig.trim() == c.name.trim()) {
                result.errors.add('A grid cannot be a child table of itself.');
            }
        }
        if (!result.errors.isEmpty()) {
            return result;
        }
        try {
            GridConfig.Definition def = GridConfig.build(
                configRecord(d),
                columnRecords(d),
                ruleRecords(d),
                childRecords(d),
                actionRecords(d),
                filterRecords(d)
            );
            result.warnings.addAll(def.warnings);
            result.warnings.addAll(hiddenFromYou(d, objectType));
        } catch (Exception e) {
            result.errors.add(e.getMessage());
        }
        return result;
    }

    /**
     * What the admin will not see of the grid because field-level security
     * hides a field from them: the grid leaves such a column or display rule
     * out for anyone who cannot read its field, and does not open at all for
     * someone who cannot read a filter's field. People who can read the field
     * see the grid as built, so these are warnings, not errors.
     */
    @TestVisible
    private static List<String> hiddenFromYou(Draft d, Schema.SObjectType objectType) {
        List<String> out = new List<String>();
        for (ColumnDraft col : d.columns) {
            if (col.inactive == true || String.isNotBlank(col.formula) || String.isNotBlank(col.childTable)) {
                continue;
            }
            String hidden = hiddenField(objectType, col.field);
            if (hidden != null) {
                out.add(
                    hidden +
                    ' is hidden from you by field-level security, so the grid leaves its column out for you. People who can read the field see it.'
                );
            }
        }
        for (RuleDraft r : d.rules) {
            String hidden = r.inactive != true && String.isBlank(r.formula) ? hiddenField(objectType, r.field) : null;
            if (hidden != null) {
                out.add(
                    'Display rule "' +
                        r.label +
                        '" tests ' +
                        hidden +
                        ', which is hidden from you by field-level security, so the grid skips the rule for you.'
                );
            }
        }
        for (FilterDraft f : d.filters) {
            String hidden = f.inactive == true ? null : hiddenField(objectType, f.field);
            if (hidden != null) {
                out.add(
                    'A filter tests ' +
                        hidden +
                        ', which is hidden from you by field-level security, so the grid will not open for you, or for anyone else who cannot read it.'
                );
            }
        }
        return out;
    }

    /** "Product Code (ProductCode)" when the running user cannot read the field; null when they can, or it is no field. */
    private static String hiddenField(Schema.SObjectType objectType, String name) {
        if (String.isBlank(name)) {
            return null;
        }
        try {
            GridPaths.FieldPath fp = GridPaths.resolve(objectType, name);
            return GridSecurity.canReadPath(fp) ? null : fp.field.getDescribe().getLabel() + ' (' + name.trim() + ')';
        } catch (GridException e) {
            return null; // an unknown field is the grid's own check's to report
        }
    }

    /** Why a formula will not build, or null. */
    private static String formulaProblem(
        Schema.SObjectType objectType,
        String formula,
        FormulaEval.FormulaReturnType returnType
    ) {
        try {
            GridFormulas.compile(objectType, formula, returnType);
            return null;
        } catch (GridException e) {
            return e.getMessage();
        }
    }

    private static String label(String label, Integer index) {
        return String.isBlank(label) ? String.valueOf(index + 1) : label.trim();
    }

    /**
     * The sorts after the first: each a column of the grid that is on, on a
     * field, with Sort selected; none twice; up to GridConfig.MAX_SORT_LEVELS in
     * all; and only after a first sort.
     */
    private static void checkThenSort(Draft d, Check result) {
        List<Map<String, String>> levels = sortLevels(d.config.thenSort);
        if (levels.isEmpty()) {
            return;
        }
        if (String.isBlank(d.config.sortField)) {
            result.errors.add('Default sort: choose the first column to sort by before the others.');
            return;
        }
        if (levels.size() > GridConfig.MAX_SORT_LEVELS - 1) {
            result.errors.add('Default sort: a grid sorts by up to ' + GridConfig.MAX_SORT_LEVELS + ' columns.');
        }
        Set<String> sortable = new Set<String>();
        for (ColumnDraft col : d.columns) {
            Boolean onField =
                String.isNotBlank(col.field) &&
                String.isBlank(col.formula) &&
                String.isBlank(col.childTable);
            if (onField && col.inactive != true && col.sortable != false) {
                sortable.add(col.field.trim().toLowerCase());
            }
        }
        Set<String> used = new Set<String>{ d.config.sortField.trim().toLowerCase() };
        for (Map<String, String> level : levels) {
            String field = level.get('field').toLowerCase();
            if (!sortable.contains(field)) {
                result.errors.add(
                    'Default sort: ' +
                        level.get('field') +
                        ' is not a column of this grid that is on and can be sorted.'
                );
            } else if (used.contains(field)) {
                result.errors.add('Default sort: ' + level.get('field') + ' is in the sort twice.');
            }
            used.add(field);
        }
        String kept = GridConfig.formatSortLevels(levels);
        if (kept != null && kept.length() > 255) {
            result.errors.add('Default sort: too long to keep. Sort by fewer columns.');
        }
    }

    private static void checkColumns(Draft d, Schema.SObjectType objectType, Check result) {
        Set<String> seen = new Set<String>();
        Integer turnedOn = 0; // 'on' is a reserved word in Apex
        Integer formulas = 0;
        for (Integer i = 0; i < d.columns.size(); i++) {
            ColumnDraft col = d.columns[i];
            // A child total column: a child table of this grid, a kind of
            // total and a field it fits, checked by the code the grid uses.
            if (String.isNotBlank(col.childTable) || String.isNotBlank(col.childTotal)) {
                String heading = String.isBlank(col.columnLabel)
                    ? 'Child total column ' + (i + 1)
                    : col.columnLabel.trim();
                tooLong(heading + ': the column label', col.columnLabel, MAX_COLUMN_LABEL, result);
                if (String.isBlank(col.childTable)) {
                    result.errors.add(heading + ': choose the child table it totals.');
                } else if (col.inactive != true) {
                    String problem = childTotalProblem(d, objectType, col);
                    if (problem != null) {
                        result.errors.add(heading + ': ' + problem);
                    }
                }
                if (col.inactive != true) {
                    turnedOn++;
                }
                continue;
            }
            // A formula column: one with a formula, or one added as a formula
            // column (a Formula Type, no field) whose formula is not written yet.
            if (String.isNotBlank(col.formula) || (String.isBlank(col.field) && String.isNotBlank(col.formulaType))) {
                // A header, a type, a formula that builds. The words are the editor's
                // own (gridConfigEditor localErrors), so the list shows each once.
                String heading = String.isBlank(col.columnLabel) ? 'Formula column ' + (i + 1) : col.columnLabel.trim();
                if (String.isBlank(col.columnLabel)) {
                    result.errors.add('Formula column ' + (i + 1) + ': give it a header.');
                }
                tooLong(heading + ': the column label', col.columnLabel, MAX_COLUMN_LABEL, result);
                tooLong(heading + ': the formula', col.formula, MAX_FORMULA, result);
                if (col.decimalPlaces != null && (col.decimalPlaces < 0 || col.decimalPlaces > 9)) {
                    result.errors.add(heading + ': decimal places are 0 to 9.');
                }
                String type = String.isBlank(col.formulaType) ? 'text' : col.formulaType.trim().toLowerCase();
                if (String.isBlank(col.formula)) {
                    result.errors.add(heading + ': write its formula.');
                } else if (!GridFormulas.RETURN_TYPES.containsKey(type)) {
                    result.errors.add(heading + ': unknown Formula Type "' + col.formulaType + '".');
                } else {
                    String problem = formulaProblem(objectType, col.formula, GridFormulas.RETURN_TYPES.get(type));
                    if (problem != null) {
                        result.errors.add(heading + ': ' + problem);
                    }
                }
                if (col.inactive != true) {
                    turnedOn++;
                    formulas++;
                }
                continue;
            }
            if (String.isBlank(col.field)) {
                result.errors.add('Column ' + (i + 1) + ' needs a field.');
                continue;
            }
            String local;
            try {
                // A field of the grid's object, or of a parent record (GridPaths).
                local = GridPaths.resolve(objectType, col.field).local;
            } catch (GridException e) {
                result.errors.add(e.getMessage());
                continue;
            }
            if (col.columnLabel != null && col.columnLabel.trim().length() > MAX_COLUMN_LABEL) {
                result.errors.add(local + ': the column label is ' + MAX_COLUMN_LABEL + ' characters at most.');
            }
            if (col.inactive == true) {
                continue;
            }
            turnedOn++;
            if (!seen.add(local.toLowerCase())) {
                result.errors.add(local + ' is a column twice. Turn one of them off.');
            }
        }
        if (turnedOn == 0) {
            result.errors.add('A grid needs at least one column turned on.');
        }
        // Formula display rules count too: every one is worked out for every row.
        for (RuleDraft r : d.rules) {
            if (String.isNotBlank(r.formula) && r.inactive != true) {
                formulas++;
            }
        }
        if (formulas > GridFormulas.MAX_FORMULAS) {
            result.errors.add(
                'A grid has at most ' +
                    GridFormulas.MAX_FORMULAS +
                    ' formulas, columns and display rules together; this one has ' +
                    formulas +
                    '.'
            );
        }
    }

    /** Why a child total column will not build, or null; null too when its child tables cannot be read yet (they have errors of their own). */
    private static String childTotalProblem(Draft d, Schema.SObjectType objectType, ColumnDraft col) {
        List<Grid_Child_Table__mdt> links;
        try {
            links = childRecords(d);
        } catch (Exception e) {
            return null; // a child table with no grid: said by the child tables' own check
        }
        try {
            GridChildTables.childTotalOf(col.childTable, col.childTotal, col.childField, objectType, links);
            return null;
        } catch (GridException e) {
            return e.getMessage();
        }
    }

    /** An error when a text is longer than the metadata field that keeps it. */
    private static void tooLong(String what, String text, Integer max, Check result) {
        Integer length = text == null ? 0 : text.trim().length();
        if (length > max) {
            result.errors.add(what + ' is ' + length + ' characters; ' + max + ' at most.');
        }
    }

    /** The configuration of this API name, in any case, or null. */
    private static Grid_Configuration__mdt configIgnoringCase(String name) {
        for (Grid_Configuration__mdt cfg : Grid_Configuration__mdt.getAll().values()) {
            if (cfg.DeveloperName.equalsIgnoreCase(name)) {
                return cfg;
            }
        }
        return null;
    }

    /**
     * The record names a draft carries. Each must be an API name, and a name
     * that is already a record's must be a record of this grid (owner; null
     * for a new grid): a save deploys the record of that name whole, so
     * another grid's column, display rule, filter, action or child table would
     * otherwise become this grid's.
     */
    private static void checkRecordNames(Draft d, Grid_Configuration__mdt owner, Check result) {
        List<String> columns = new List<String>();
        for (ColumnDraft x : d.columns) {
            columns.add(x.name);
        }
        List<String> rules = new List<String>();
        for (RuleDraft x : d.rules) {
            rules.add(x.name);
        }
        List<String> filters = new List<String>();
        for (FilterDraft x : d.filters) {
            filters.add(x.name);
        }
        List<String> actions = new List<String>();
        for (ActionDraft x : d.actions) {
            actions.add(x.name);
        }
        List<String> children = new List<String>();
        for (ChildDraft x : d.children) {
            children.add(x.name);
        }
        checkNames(
            'Column',
            columns,
            Grid_Column__mdt.getAll().values(),
            Grid_Column__mdt.Grid_Configuration__c,
            owner,
            result
        );
        checkNames(
            'Display rule',
            rules,
            Grid_Display_Rule__mdt.getAll().values(),
            Grid_Display_Rule__mdt.Grid_Configuration__c,
            owner,
            result
        );
        checkNames(
            'Filter',
            filters,
            Grid_Filter__mdt.getAll().values(),
            Grid_Filter__mdt.Grid_Configuration__c,
            owner,
            result
        );
        checkNames(
            'Action',
            actions,
            Grid_Action__mdt.getAll().values(),
            Grid_Action__mdt.Grid_Configuration__c,
            owner,
            result
        );
        checkNames(
            'Child table',
            children,
            Grid_Child_Table__mdt.getAll().values(),
            Grid_Child_Table__mdt.Grid_Configuration__c,
            owner,
            result
        );
    }

    /** One kind of record: `records` are the org's, `link` the field that names their grid. */
    private static void checkNames(
        String kind,
        List<String> given,
        List<SObject> records,
        Schema.SObjectField link,
        Grid_Configuration__mdt owner,
        Check result
    ) {
        Map<String, SObject> byName = new Map<String, SObject>();
        for (SObject r : records) {
            byName.put(((String) r.get('DeveloperName')).toLowerCase(), r);
        }
        for (String name : given) {
            if (String.isBlank(name)) {
                continue; // a new record: the save names it
            }
            String problem = nameProblem(name);
            if (problem != null) {
                result.errors.add(kind + ' API name: ' + problem);
                continue;
            }
            SObject record = byName.get(name.trim().toLowerCase());
            if (record != null && (owner == null || !GridConfig.belongsTo(record.get(link), owner))) {
                result.errors.add(kind + ' ' + name.trim() + ' belongs to another grid.');
            }
        }
    }

    /** Why a record's API name will not do, or null. */
    public static String nameProblem(String name) {
        if (String.isBlank(name)) {
            return 'it is blank.';
        }
        String n = name.trim();
        if (n.length() > MAX_NAME) {
            return n + ' is ' + n.length() + ' characters; ' + MAX_NAME + ' at most.';
        }
        if (!API_NAME_PATTERN.matcher(n).matches() || n.contains('__') || n.endsWith('_')) {
            return n +
                ' must start with a letter and use only letters, numbers and single underscores, not ending with one.';
        }
        return null;
    }

    // ---------------------------------------------------------------- save

    /** How a save is deployed; a test puts a stand-in here, since a test cannot deploy metadata. */
    public interface Deployer {
        Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback);
    }

    private class PlatformDeployer implements Deployer {
        public Id deploy(Metadata.DeployContainer container, Metadata.DeployCallback callback) {
            try {
                return Metadata.Operations.enqueueDeployment(container, callback);
            } catch (Exception e) {
                throw explained(e);
            }
        }
    }

    /**
     * What a save says when Salesforce refuses it because the package has not
     * yet passed its security review. Salesforce's documentation says an
     * uncertified package's Apex may deploy metadata only with this setting
     * on; a Developer Edition, a scratch org and a production org allowed it
     * with the setting off, so this message is for an org that refuses.
     */
    public static final String BEFORE_REVIEW =
        'Salesforce did not let Rowhouse save it. In this org, a package that has not yet passed Salesforce\'s ' +
        'security review saves settings only with Deploy Metadata from Non-Certified Package Versions via Apex ' +
        'turned on: in Setup, Apex Settings.';

    /** A refusal for want of the security review, in plain words; anything else as it came. */
    @TestVisible
    private static Exception explained(Exception e) {
        String message = e == null ? null : e.getMessage();
        return message != null && message.containsIgnoreCase('certified') ? new GridException(BEFORE_REVIEW) : e;
    }

    // Not named after its type: Apex names are case-insensitive.
    @TestVisible
    private static Deployer deployWith = new PlatformDeployer();

    /**
     * Check a draft and, if it has no errors, deploy it. Returns the
     * deployment's Id, which saveStatus answers for. Throws, with every
     * error, when it cannot save.
     */
    public static String save(Draft d) {
        requireAdmin();
        if (!GridSecurity.canCustomizeApplication()) {
            throw new GridException(
                'Saving a grid needs the Customize Application permission as well as Rowhouse Grid Admin. ' +
                'Ask a Salesforce admin to save it.'
            );
        }
        Check result = checkDraft(d);
        if (!result.errors.isEmpty()) {
            throw new GridException(String.join(result.errors, ' '));
        }
        // Archived is what the org has: only archive and restore change it.
        Grid_Configuration__mdt existing = d.config.isNew == true
            ? null
            : Grid_Configuration__mdt.getInstance(d.config.name.trim());
        d.config.archived = existing != null && existing.Archived__c == true;
        Id jobId = deployWith.deploy(container(d), new GridAdminDeploy(UserInfo.getUserId()));
        return String.valueOf(jobId);
    }

    // ---------------------------------------------------------------- row actions

    private static void requireSave() {
        requireAdmin();
        if (!GridSecurity.canCustomizeApplication()) {
            throw new GridException(
                'This needs the Customize Application permission as well as Rowhouse Grid Admin. ' +
                'Ask a Salesforce admin to do it.'
            );
        }
    }

    /**
     * Archive a grid, or restore it (`archived` false): the configuration
     * record alone is deployed, every field as the org has it, with Archived
     * changed. Its columns, rules and the rest are untouched. Returns the
     * deployment's Id, which saveStatus answers for.
     */
    public static String setArchived(String configName, Boolean archived) {
        requireSave();
        Grid_Configuration__mdt cfg = configNamed(configName);
        Draft d = new Draft();
        d.config = draftOf(cfg).config;
        d.config.archived = archived == true;
        Metadata.DeployContainer out = new Metadata.DeployContainer();
        out.addMetadata(
            record(Grid_Configuration__mdt.SObjectType, cfg.DeveloperName, cfg.MasterLabel, configValues(d.config))
        );
        return String.valueOf(deployWith.deploy(out, new GridAdminDeploy(UserInfo.getUserId())));
    }

    /**
     * Clone a grid as a new one with this title and API name: every column,
     * display rule, filter, action and child table, turned off or not, under
     * new record names made from the new API name. A child total column
     * follows its child table to the copy's. Checked like a save, then
     * deployed. Returns the deployment's Id, which saveStatus answers for.
     */
    public static String cloneConfig(String sourceName, String label, String name) {
        requireSave();
        Draft d = cloneDraft(configNamed(sourceName), label, name);
        Check result = checkDraft(d);
        if (!result.errors.isEmpty()) {
            throw new GridException(String.join(result.errors, ' '));
        }
        return String.valueOf(deployWith.deploy(container(d), new GridAdminDeploy(UserInfo.getUserId())));
    }

    @TestVisible
    private static Draft cloneDraft(Grid_Configuration__mdt source, String label, String name) {
        Draft d = draftOf(source);
        d.config.isNew = true;
        d.config.archived = false;
        d.config.label = label;
        d.config.name = name == null ? null : name.trim();
        for (ColumnDraft c : d.columns) {
            c.name = null;
        }
        for (RuleDraft r : d.rules) {
            r.name = null;
        }
        for (FilterDraft f : d.filters) {
            f.name = null;
        }
        for (ActionDraft a : d.actions) {
            a.name = null;
        }
        // The child tables are named now, so a child total column can name its copy's.
        List<String> oldNames = new List<String>();
        for (ChildDraft ch : d.children) {
            oldNames.add(ch.name);
            ch.name = null;
        }
        if (String.isNotBlank(d.config.name) && nameProblem(d.config.name) == null) {
            List<String> newNames = childNames(d);
            Map<String, String> renamed = new Map<String, String>();
            for (Integer i = 0; i < d.children.size(); i++) {
                d.children[i].name = newNames[i];
                if (oldNames[i] != null) {
                    renamed.put(oldNames[i].toLowerCase(), newNames[i]);
                }
            }
            for (ColumnDraft c : d.columns) {
                if (String.isNotBlank(c.childTable) && renamed.containsKey(c.childTable.trim().toLowerCase())) {
                    c.childTable = renamed.get(c.childTable.trim().toLowerCase());
                }
            }
        }
        return d;
    }

    /**
     * What to delete in Setup to delete a grid for good, in the order to
     * delete it: other grids' child tables that show it, then its own
     * columns, display rules, filters, actions and child tables, then the grid
     * itself. Each: { kind (the type, as Setup names it), label, name, url, note }; url is the record's page
     * in Setup. Deleting is Setup's: Apex cannot delete Custom Metadata.
     */
    public static List<Map<String, String>> setupRecords(String configName) {
        requireAdmin();
        Grid_Configuration__mdt cfg = configNamed(configName);
        List<Map<String, String>> out = new List<Map<String, String>>();
        List<Grid_Configuration__mdt> configs = Grid_Configuration__mdt.getAll().values();
        for (Grid_Child_Table__mdt link : Grid_Child_Table__mdt.getAll().values()) {
            if (
                !GridConfig.belongsTo(link.Child_Configuration__c, cfg) ||
                GridConfig.belongsTo(link.Grid_Configuration__c, cfg)
            ) {
                continue;
            }
            String parentLabel = '';
            for (Grid_Configuration__mdt other : configs) {
                if (GridConfig.belongsTo(link.Grid_Configuration__c, other)) {
                    parentLabel = other.MasterLabel;
                }
            }
            out.add(
                setupItem(
                    link,
                    'A child table of ' +
                        parentLabel +
                        ' that shows this grid. Deleting it removes that tab from ' +
                        parentLabel +
                        '.'
                )
            );
        }
        for (SObject r : inOrder(GridConfig.columnsOf(cfg))) {
            out.add(setupItem(r, null));
        }
        for (SObject r : inOrder(GridConfig.rulesOf(cfg))) {
            out.add(setupItem(r, null));
        }
        for (SObject r : inOrder(GridFilters.recordsOf(cfg))) {
            out.add(setupItem(r, null));
        }
        for (SObject r : inOrder(GridActions.recordsOf(cfg))) {
            out.add(setupItem(r, null));
        }
        for (SObject r : inOrder(GridChildTables.linksOf(cfg))) {
            out.add(setupItem(r, null));
        }
        out.add(setupItem(cfg, 'The grid itself: delete it last.'));
        return out;
    }

    /** One record, with its type as Setup names it (Grid Display Rule, Grid Column and so on). */
    private static Map<String, String> setupItem(SObject record, String note) {
        return new Map<String, String>{
            'kind' => record.getSObjectType().getDescribe(SObjectDescribeOptions.DEFERRED).getLabel(),
            'label' => (String) record.get('MasterLabel'),
            'name' => (String) record.get('DeveloperName'),
            'url' => '/lightning/setup/CustomMetadata/page?address=%2F' + String.valueOf(record.get('Id')),
            'note' => note
        };
    }

    /**
     * Save how long the edit log keeps its entries: the Rowhouse
     * Setting record, deployed like a grid, and the nightly clean-up
     * scheduled to run as the user saving, or removed for forever. Returns
     * the deployment's Id, which saveStatus answers for.
     */
    public static String saveLogRetention(Integer days) {
        requireAdmin();
        if (!GridSecurity.canCustomizeApplication()) {
            throw new GridException(
                'Saving needs the Customize Application permission as well as Rowhouse Grid Admin. ' +
                'Ask a Salesforce admin to save it.'
            );
        }
        if (!GridLogRetention.offered(days)) {
            throw new GridException('Keep the edit log for 90 days, 1 year, 2 years or 7 years, or forever.');
        }
        if (days != null && !GridLogRetention.canRun()) {
            throw new GridException(
                'The nightly clean-up runs as you, and you cannot delete Grid Edit Log entries. ' +
                'Ask a Salesforce admin who can, such as a System Administrator, to set it.'
            );
        }
        Metadata.DeployContainer container = new Metadata.DeployContainer();
        container.addMetadata(
            record(
                Rowhouse_Setting__mdt.SObjectType,
                GridLogRetention.SETTING,
                GridLogRetention.SETTING,
                new Map<Schema.SObjectField, Object>{ Rowhouse_Setting__mdt.Log_Retention_Days__c => days }
            )
        );
        Id jobId = deployWith.deploy(container, new GridAdminDeploy(UserInfo.getUserId()));
        GridLogRetention.schedule(days);
        return String.valueOf(jobId);
    }

    /**
     * How a save is going: { status: 'pending' | 'Succeeded' | 'Failed',
     * messages }. The row GridAdminDeploy wrote is deleted once read.
     */
    public static Map<String, Object> saveStatus(String jobId) {
        requireAdmin();
        if (String.isBlank(jobId)) {
            throw new GridException('No save to report on.');
        }
        List<Grid_Save_Result__c> rows = (List<Grid_Save_Result__c>) GridSecurity.query(
            'SELECT Id, Status__c, Errors_JSON__c FROM Grid_Save_Result__c WHERE Save_Id__c = :jobId AND OwnerId = :ownerId',
            new Map<String, Object>{ 'jobId' => jobId.trim(), 'ownerId' => UserInfo.getUserId() }
        );
        if (rows.isEmpty()) {
            return new Map<String, Object>{ 'status' => 'pending', 'messages' => new List<String>() };
        }
        Grid_Save_Result__c row = rows[0];
        List<String> messages = String.isBlank(row.Errors_JSON__c)
            ? new List<String>()
            : (List<String>) JSON.deserialize(row.Errors_JSON__c, List<String>.class);
        GridSecurity.deleteOwnRecords(rows);
        return new Map<String, Object>{ 'status' => row.Status__c, 'messages' => messages };
    }

    // ------------------------------------------------------- records in memory

    /**
     * The draft as Custom Metadata records in memory, for GridConfig.build.
     * Their fields cannot be assigned in Apex, so each is made from JSON.
     */
    @TestVisible
    private static Grid_Configuration__mdt configRecord(Draft d) {
        ConfigDraft c = d.config;
        Map<String, Object> m = new Map<String, Object>{
            'DeveloperName' => c.name.trim(),
            'MasterLabel' => c.label.trim()
        };
        Map<Schema.SObjectField, Object> values = configValues(c);
        for (Schema.SObjectField f : values.keySet()) {
            m.put(GridDescribe.apiName(f), values.get(f));
        }
        return (Grid_Configuration__mdt) JSON.deserialize(JSON.serialize(m), Grid_Configuration__mdt.class);
    }

    @TestVisible
    private static List<Grid_Column__mdt> columnRecords(Draft d) {
        List<Grid_Column__mdt> out = new List<Grid_Column__mdt>();
        List<String> names = columnNames(d);
        for (Integer i = 0; i < d.columns.size(); i++) {
            Map<String, Object> m = new Map<String, Object>{ 'DeveloperName' => names[i], 'MasterLabel' => names[i] };
            Map<Schema.SObjectField, Object> values = columnValues(d.columns[i], i);
            for (Schema.SObjectField f : values.keySet()) {
                if (f != Grid_Column__mdt.Grid_Configuration__c) {
                    m.put(GridDescribe.apiName(f), values.get(f));
                }
            }
            out.add((Grid_Column__mdt) JSON.deserialize(JSON.serialize(m), Grid_Column__mdt.class));
        }
        return out;
    }

    private static List<Grid_Display_Rule__mdt> ruleRecords(Draft d) {
        List<Grid_Display_Rule__mdt> out = new List<Grid_Display_Rule__mdt>();
        List<String> names = ruleNames(d);
        for (Integer i = 0; i < d.rules.size(); i++) {
            Map<String, Object> m = new Map<String, Object>{
                'DeveloperName' => names[i],
                'MasterLabel' => d.rules[i].label.trim()
            };
            Map<Schema.SObjectField, Object> values = ruleValues(d.rules[i], i);
            for (Schema.SObjectField f : values.keySet()) {
                if (f != Grid_Display_Rule__mdt.Grid_Configuration__c) {
                    m.put(GridDescribe.apiName(f), values.get(f));
                }
            }
            out.add((Grid_Display_Rule__mdt) JSON.deserialize(JSON.serialize(m), Grid_Display_Rule__mdt.class));
        }
        return out;
    }

    private static List<Grid_Filter__mdt> filterRecords(Draft d) {
        List<Grid_Filter__mdt> out = new List<Grid_Filter__mdt>();
        List<String> names = filterNames(d);
        for (Integer i = 0; i < d.filters.size(); i++) {
            Map<String, Object> m = new Map<String, Object>{
                'DeveloperName' => names[i],
                'MasterLabel' => filterLabel(d.filters[i])
            };
            Map<Schema.SObjectField, Object> values = filterValues(d.filters[i], i);
            for (Schema.SObjectField f : values.keySet()) {
                if (f != Grid_Filter__mdt.Grid_Configuration__c) {
                    m.put(GridDescribe.apiName(f), values.get(f));
                }
            }
            out.add((Grid_Filter__mdt) JSON.deserialize(JSON.serialize(m), Grid_Filter__mdt.class));
        }
        return out;
    }

    private static List<Grid_Action__mdt> actionRecords(Draft d) {
        List<Grid_Action__mdt> out = new List<Grid_Action__mdt>();
        List<String> names = actionNames(d);
        for (Integer i = 0; i < d.actions.size(); i++) {
            Map<String, Object> m = new Map<String, Object>{
                'DeveloperName' => names[i],
                'MasterLabel' => d.actions[i].label.trim()
            };
            Map<Schema.SObjectField, Object> values = actionValues(d.actions[i], i);
            for (Schema.SObjectField f : values.keySet()) {
                if (f != Grid_Action__mdt.Grid_Configuration__c) {
                    m.put(GridDescribe.apiName(f), values.get(f));
                }
            }
            out.add((Grid_Action__mdt) JSON.deserialize(JSON.serialize(m), Grid_Action__mdt.class));
        }
        return out;
    }

    private static List<Grid_Child_Table__mdt> childRecords(Draft d) {
        List<Grid_Child_Table__mdt> out = new List<Grid_Child_Table__mdt>();
        List<String> names = childNames(d);
        for (Integer i = 0; i < d.children.size(); i++) {
            ChildDraft ch = d.children[i];
            Map<String, Object> m = new Map<String, Object>{ 'DeveloperName' => names[i], 'MasterLabel' => names[i] };
            Map<Schema.SObjectField, Object> values = childValues(ch, i);
            for (Schema.SObjectField f : values.keySet()) {
                if (
                    f != Grid_Child_Table__mdt.Grid_Configuration__c &&
                    f != Grid_Child_Table__mdt.Child_Configuration__c
                ) {
                    m.put(GridDescribe.apiName(f), values.get(f));
                }
            }
            // In memory a metadata relationship holds the record's Id; a deploy names it.
            m.put(
                GridDescribe.apiName(Grid_Child_Table__mdt.Child_Configuration__c),
                Grid_Configuration__mdt.getInstance(ch.childConfig.trim()).Id
            );
            out.add((Grid_Child_Table__mdt) JSON.deserialize(JSON.serialize(m), Grid_Child_Table__mdt.class));
        }
        return out;
    }

    // ------------------------------------------------------- field values

    /** The draft's sorts after the first, as GridConfig reads and writes them. */
    private static List<Map<String, String>> sortLevels(List<SortLevel> levels) {
        List<Map<String, String>> out = new List<Map<String, String>>();
        for (SortLevel l : levels == null ? new List<SortLevel>() : levels) {
            if (l != null && String.isNotBlank(l.field)) {
                out.add(new Map<String, String>{ 'field' => l.field.trim(), 'direction' => l.direction });
            }
        }
        return out;
    }

    private static Map<Schema.SObjectField, Object> configValues(ConfigDraft c) {
        return new Map<Schema.SObjectField, Object>{
            Grid_Configuration__mdt.Object_API_Name__c => trimmed(c.objectApiName),
            Grid_Configuration__mdt.Page_Size__c => toDecimal(c.pageSize),
            Grid_Configuration__mdt.Default_Sort_Field__c => trimmed(c.sortField),
            Grid_Configuration__mdt.Default_Sort_Direction__c => trimmed(c.sortDirection),
            Grid_Configuration__mdt.Then_Sort_By__c => GridConfig.formatSortLevels(sortLevels(c.thenSort)),
            Grid_Configuration__mdt.Allow_Inline_Edit__c => c.allowInlineEdit == true,
            Grid_Configuration__mdt.Allow_CSV_Export__c => c.allowCsvExport == true,
            Grid_Configuration__mdt.Require_Export_Reports__c => c.requireExportReports == true,
            Grid_Configuration__mdt.Allow_Mass_Delete__c => c.allowMassDelete == true,
            Grid_Configuration__mdt.Allow_Import__c => c.allowImport == true,
            Grid_Configuration__mdt.Allow_New_Records__c => c.allowNewRecords == true,
            Grid_Configuration__mdt.Log_Changes__c => c.logChanges == true,
            Grid_Configuration__mdt.Frozen_Columns__c => toDecimal(c.frozenColumns),
            Grid_Configuration__mdt.Show_Row_Numbers__c => c.showRowNumbers == true,
            Grid_Configuration__mdt.Height_Px__c => toDecimal(c.height),
            Grid_Configuration__mdt.Record_Page_Field__c => trimmed(c.recordPageField),
            Grid_Configuration__mdt.Archived__c => c.archived == true
        };
    }

    private static Map<Schema.SObjectField, Object> columnValues(ColumnDraft col, Integer index) {
        return new Map<Schema.SObjectField, Object>{
            Grid_Column__mdt.Field_API_Name__c => trimmed(col.field),
            Grid_Column__mdt.Column_Label__c => trimmed(col.columnLabel),
            Grid_Column__mdt.Sort_Order__c => sortOrder(index),
            Grid_Column__mdt.Editable__c => col.editable == true,
            Grid_Column__mdt.Sortable__c => col.sortable != false,
            Grid_Column__mdt.Wrap_Text__c => col.wrap == true,
            Grid_Column__mdt.Always_Shown__c => col.alwaysShown == true,
            Grid_Column__mdt.Width_Px__c => toDecimal(col.width),
            Grid_Column__mdt.Cell_Type__c => trimmed(col.cellType),
            Grid_Column__mdt.Group_Level__c => toDecimal(col.groupLevel),
            Grid_Column__mdt.Group_Date_Unit__c => trimmed(col.groupUnit),
            Grid_Column__mdt.Allow_Grouping__c => col.allowGrouping == true,
            Grid_Column__mdt.Subtotal__c => trimmed(col.subtotal),
            Grid_Column__mdt.Inactive__c => col.inactive == true,
            Grid_Column__mdt.Formula__c => trimmed(col.formula),
            Grid_Column__mdt.Formula_Type__c => String.isBlank(col.formula) ? null : trimmed(col.formulaType),
            Grid_Column__mdt.Decimal_Places__c => String.isBlank(col.formula) ? null : toDecimal(col.decimalPlaces),
            Grid_Column__mdt.Child_Table__c => trimmed(col.childTable),
            Grid_Column__mdt.Child_Total__c => String.isBlank(col.childTable) ? null : trimmed(col.childTotal),
            Grid_Column__mdt.Child_Field__c => String.isBlank(col.childTable) ? null : trimmed(col.childField),
            Grid_Column__mdt.Grid_Configuration__c => null
        };
    }

    private static Map<Schema.SObjectField, Object> ruleValues(RuleDraft r, Integer index) {
        return new Map<Schema.SObjectField, Object>{
            Grid_Display_Rule__mdt.Field_API_Name__c => trimmed(r.field),
            Grid_Display_Rule__mdt.Operator__c => trimmed(r.operator),
            Grid_Display_Rule__mdt.Value__c => trimmed(r.value),
            Grid_Display_Rule__mdt.Style__c => trimmed(r.style),
            Grid_Display_Rule__mdt.Apply_To__c => trimmed(r.applyTo),
            Grid_Display_Rule__mdt.Sort_Order__c => sortOrder(index),
            Grid_Display_Rule__mdt.Inactive__c => r.inactive == true,
            Grid_Display_Rule__mdt.Value_To__c => trimmed(r.valueTo),
            Grid_Display_Rule__mdt.Compare_Field__c => trimmed(r.compareField),
            Grid_Display_Rule__mdt.Formula__c => trimmed(r.formula),
            Grid_Display_Rule__mdt.Grid_Configuration__c => null
        };
    }

    private static Map<Schema.SObjectField, Object> filterValues(FilterDraft f, Integer index) {
        return new Map<Schema.SObjectField, Object>{
            Grid_Filter__mdt.Field_API_Name__c => trimmed(f.field),
            Grid_Filter__mdt.Operator__c => trimmed(f.operator),
            Grid_Filter__mdt.Value__c => trimmed(f.value),
            Grid_Filter__mdt.Value_To__c => trimmed(f.valueTo),
            Grid_Filter__mdt.Sort_Order__c => sortOrder(index),
            Grid_Filter__mdt.Inactive__c => f.inactive == true,
            Grid_Filter__mdt.Grid_Configuration__c => null
        };
    }

    /** A filter's label: the admin's, or what it tests ("StageName not_equals"), 40 characters at most. */
    private static String filterLabel(FilterDraft f) {
        if (String.isNotBlank(f.label)) {
            return f.label.trim().left(MAX_NAME);
        }
        Grid_Filter__mdt existing = String.isBlank(f.name) ? null : Grid_Filter__mdt.getInstance(f.name.trim());
        if (existing != null) {
            return existing.MasterLabel;
        }
        String made =
            (f.field == null ? 'Filter' : f.field.trim().removeEndIgnoreCase('__c').replace('_', ' ')) +
            ' ' +
            (f.operator == null ? 'equals' : f.operator.trim().replace('_', ' '));
        return made.left(MAX_NAME);
    }

    private static Map<Schema.SObjectField, Object> actionValues(ActionDraft a, Integer index) {
        return new Map<Schema.SObjectField, Object>{
            Grid_Action__mdt.Action_Type__c => trimmed(a.type),
            Grid_Action__mdt.Action_Name__c => trimmed(a.actionName),
            Grid_Action__mdt.Input_Name__c => trimmed(a.inputName),
            Grid_Action__mdt.Show_In__c => trimmed(a.showIn),
            Grid_Action__mdt.Confirmation__c => trimmed(a.confirmation),
            Grid_Action__mdt.Required_Permission__c => trimmed(a.requiredPermission),
            Grid_Action__mdt.Sort_Order__c => sortOrder(index),
            Grid_Action__mdt.Inactive__c => a.inactive == true,
            Grid_Action__mdt.Grid_Configuration__c => null
        };
    }

    private static Map<Schema.SObjectField, Object> childValues(ChildDraft ch, Integer index) {
        return new Map<Schema.SObjectField, Object>{
            Grid_Child_Table__mdt.Child_Configuration__c => trimmed(ch.childConfig),
            Grid_Child_Table__mdt.Relationship_Field__c => trimmed(ch.relationshipField),
            Grid_Child_Table__mdt.Tab_Label__c => trimmed(ch.tabLabel),
            Grid_Child_Table__mdt.Height_Px__c => toDecimal(ch.height),
            Grid_Child_Table__mdt.Sort_Order__c => sortOrder(index),
            Grid_Child_Table__mdt.Inactive__c => ch.inactive == true,
            Grid_Child_Table__mdt.Grid_Configuration__c => null
        };
    }

    // ------------------------------------------------------- the deploy

    /**
     * Every record of the draft, every field of each, as one deployment. The
     * configuration first; each record's link to it by API name, which is how
     * a deploy names a metadata relationship.
     */
    @TestVisible
    private static Metadata.DeployContainer container(Draft d) {
        Metadata.DeployContainer out = new Metadata.DeployContainer();
        String configName = d.config.name.trim();
        out.addMetadata(
            record(Grid_Configuration__mdt.SObjectType, configName, d.config.label.trim(), configValues(d.config))
        );
        List<String> names = columnNames(d);
        for (Integer i = 0; i < d.columns.size(); i++) {
            Map<Schema.SObjectField, Object> values = columnValues(d.columns[i], i);
            values.put(Grid_Column__mdt.Grid_Configuration__c, configName);
            out.addMetadata(record(Grid_Column__mdt.SObjectType, names[i], columnRecordLabel(d.columns[i]), values));
        }
        names = ruleNames(d);
        for (Integer i = 0; i < d.rules.size(); i++) {
            Map<Schema.SObjectField, Object> values = ruleValues(d.rules[i], i);
            values.put(Grid_Display_Rule__mdt.Grid_Configuration__c, configName);
            out.addMetadata(record(Grid_Display_Rule__mdt.SObjectType, names[i], d.rules[i].label.trim(), values));
        }
        names = actionNames(d);
        for (Integer i = 0; i < d.actions.size(); i++) {
            Map<Schema.SObjectField, Object> values = actionValues(d.actions[i], i);
            values.put(Grid_Action__mdt.Grid_Configuration__c, configName);
            out.addMetadata(record(Grid_Action__mdt.SObjectType, names[i], d.actions[i].label.trim(), values));
        }
        names = childNames(d);
        for (Integer i = 0; i < d.children.size(); i++) {
            Map<Schema.SObjectField, Object> values = childValues(d.children[i], i);
            values.put(Grid_Child_Table__mdt.Grid_Configuration__c, configName);
            out.addMetadata(
                record(Grid_Child_Table__mdt.SObjectType, names[i], childRecordLabel(d.children[i]), values)
            );
        }
        names = filterNames(d);
        for (Integer i = 0; i < d.filters.size(); i++) {
            Map<Schema.SObjectField, Object> values = filterValues(d.filters[i], i);
            values.put(Grid_Filter__mdt.Grid_Configuration__c, configName);
            out.addMetadata(record(Grid_Filter__mdt.SObjectType, names[i], filterLabel(d.filters[i]), values));
        }
        return out;
    }

    private static Metadata.CustomMetadata record(
        Schema.SObjectType type,
        String name,
        String label,
        Map<Schema.SObjectField, Object> values
    ) {
        Metadata.CustomMetadata md = new Metadata.CustomMetadata();
        md.fullName = GridDescribe.apiName(type) + '.' + name;
        md.label = label.left(MAX_NAME);
        for (Schema.SObjectField f : values.keySet()) {
            Metadata.CustomMetadataValue v = new Metadata.CustomMetadataValue();
            v.field = GridDescribe.apiName(f);
            v.value = values.get(f);
            md.values.add(v);
        }
        return md;
    }

    /** An existing column keeps its label in Setup; a new one is labelled with what its header says. */
    private static String columnRecordLabel(ColumnDraft col) {
        Grid_Column__mdt existing = String.isBlank(col.name) ? null : Grid_Column__mdt.getInstance(col.name.trim());
        if (existing != null) {
            return existing.MasterLabel;
        }
        if (String.isNotBlank(col.columnLabel)) {
            return col.columnLabel.trim().left(MAX_NAME);
        }
        if (String.isNotBlank(col.childTable)) {
            return ('Total of ' + col.childTable.trim()).left(MAX_NAME); // a child total column
        }
        return col.field == null ? 'Formula' : col.field.trim();
    }

    private static String childRecordLabel(ChildDraft ch) {
        Grid_Child_Table__mdt existing = String.isBlank(ch.name)
            ? null
            : Grid_Child_Table__mdt.getInstance(ch.name.trim());
        if (existing != null) {
            return existing.MasterLabel;
        }
        return String.isNotBlank(ch.tabLabel) ? ch.tabLabel.trim() : ch.childConfig.trim();
    }

    // ------------------------------------------------------- record names

    private static List<String> columnNames(Draft d) {
        List<String> wanted = new List<String>();
        for (ColumnDraft col : d.columns) {
            wanted.add(String.isNotBlank(col.name) ? col.name.trim() : null);
        }
        List<String> hints = new List<String>();
        for (ColumnDraft col : d.columns) {
            hints.add(
                String.isNotBlank(col.field)
                    ? col.field
                    : String.isNotBlank(col.columnLabel)
                          ? col.columnLabel
                          : (String.isNotBlank(col.childTable) ? 'Total_' + col.childTable : null)
            );
        }
        return names(d.config.name, wanted, hints, Grid_Column__mdt.getAll().keySet());
    }

    private static List<String> ruleNames(Draft d) {
        List<String> wanted = new List<String>();
        List<String> hints = new List<String>();
        for (RuleDraft r : d.rules) {
            wanted.add(String.isNotBlank(r.name) ? r.name.trim() : null);
            hints.add(r.label);
        }
        return names(d.config.name, wanted, hints, Grid_Display_Rule__mdt.getAll().keySet());
    }

    private static List<String> actionNames(Draft d) {
        List<String> wanted = new List<String>();
        List<String> hints = new List<String>();
        for (ActionDraft a : d.actions) {
            wanted.add(String.isNotBlank(a.name) ? a.name.trim() : null);
            hints.add(a.label);
        }
        return names(d.config.name, wanted, hints, Grid_Action__mdt.getAll().keySet());
    }

    private static List<String> filterNames(Draft d) {
        List<String> wanted = new List<String>();
        List<String> hints = new List<String>();
        for (FilterDraft f : d.filters) {
            wanted.add(String.isNotBlank(f.name) ? f.name.trim() : null);
            hints.add(String.isNotBlank(f.label) ? f.label : f.field);
        }
        return names(d.config.name, wanted, hints, Grid_Filter__mdt.getAll().keySet());
    }

    private static List<String> childNames(Draft d) {
        List<String> wanted = new List<String>();
        List<String> hints = new List<String>();
        for (ChildDraft ch : d.children) {
            wanted.add(String.isNotBlank(ch.name) ? ch.name.trim() : null);
            hints.add(String.isNotBlank(ch.tabLabel) ? ch.tabLabel : ch.childConfig);
        }
        return names(d.config.name, wanted, hints, Grid_Child_Table__mdt.getAll().keySet());
    }

    /**
     * A record name for each entry: the one it has, or for a new one the
     * grid's name and a hint (the field, the label), cleaned up, 40 characters
     * at most, and numbered if taken, by the org's records or the draft.
     */
    public static List<String> names(String configName, List<String> wanted, List<String> hints, Set<String> taken) {
        Set<String> used = new Set<String>();
        for (String t : taken) {
            used.add(t.toLowerCase());
        }
        for (String w : wanted) {
            if (w != null) {
                used.add(w.toLowerCase());
            }
        }
        List<String> out = new List<String>();
        for (Integer i = 0; i < wanted.size(); i++) {
            if (wanted[i] != null) {
                out.add(wanted[i]);
                continue;
            }
            String base = clean(
                configName + '_' + clean(hints[i] == null ? 'Item' : hints[i].removeEndIgnoreCase('__c'))
            );
            String candidate = base.left(MAX_NAME).removeEnd('_');
            Integer n = 2;
            while (used.contains(candidate.toLowerCase())) {
                String suffix = '_' + n++;
                candidate = base.left(MAX_NAME - suffix.length()).removeEnd('_') + suffix;
            }
            used.add(candidate.toLowerCase());
            out.add(candidate);
        }
        return out;
    }

    /** Letters, numbers and single underscores, starting with a letter. */
    public static String clean(String s) {
        String out = (s == null ? '' : s).replaceAll('[^A-Za-z0-9]+', '_').replaceAll('_+', '_');
        out = out.removeStart('_').removeEnd('_');
        if (String.isBlank(out)) {
            return 'Item';
        }
        return Pattern.matches('^[A-Za-z].*', out) ? out : 'X' + out;
    }

    // ------------------------------------------------------- helpers

    private static Boolean sameObject(String objectName, Schema.SObjectType objectType) {
        try {
            return GridDescribe.typeFor(objectName) == objectType;
        } catch (GridException e) {
            return false;
        }
    }

    private static String configNameOf(Object ref) {
        if (ref == null) {
            return null;
        }
        for (Grid_Configuration__mdt cfg : Grid_Configuration__mdt.getAll().values()) {
            if (GridConfig.belongsTo(ref, cfg)) {
                return cfg.DeveloperName;
            }
        }
        return String.valueOf(ref);
    }

    private static Decimal sortOrder(Integer index) {
        return Decimal.valueOf((index + 1) * 10);
    }

    private static String trimmed(String s) {
        return String.isBlank(s) ? null : s.trim();
    }

    private static Decimal toDecimal(Integer n) {
        return n == null ? null : Decimal.valueOf(n);
    }

    private static Integer toInteger(Decimal d) {
        return d == null ? null : d.intValue();
    }

    /** Records of any of the five types, by Sort Order, then API name. */
    private static List<SObject> inOrder(List<SObject> records) {
        List<Ordered> wrapped = new List<Ordered>();
        for (SObject r : records) {
            wrapped.add(new Ordered(r));
        }
        wrapped.sort();
        List<SObject> out = new List<SObject>();
        for (Ordered o : wrapped) {
            out.add(o.record);
        }
        return out;
    }

    private class Ordered implements Comparable {
        public SObject record;
        private Decimal position;
        private String name;
        public Ordered(SObject record) {
            this.record = record;
            Decimal p = (Decimal) record.get('Sort_Order__c');
            this.position = p == null ? 9999 : p;
            this.name = (String) record.get('DeveloperName');
        }
        public Integer compareTo(Object other) {
            Ordered o = (Ordered) other;
            if (position != o.position) {
                return position < o.position ? -1 : 1;
            }
            return name.compareTo(o.name);
        }
    }
}
