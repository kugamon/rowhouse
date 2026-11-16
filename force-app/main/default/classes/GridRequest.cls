/**
 * What the grid is asking for: one page of one object.
 *
 * Nothing here is trusted. GridDataService re-validates every field name
 * against describe and strips anything the running user cannot read.
 */
public with sharing class GridRequest {
    public String objectApiName;
    public List<String> fields;
    public String cursorLocator;
    public Integer pageSize;
    public String sortField;
    public String sortDirection;
    /**
     * The sorts after sortField, in order: [{ field, direction }]. The caller
     * has checked each against the grid (GridController); GridDataService
     * checks each against describe and field access, as it does sortField.
     */
    public List<Map<String, String>> thenSort = new List<Map<String, String>>();
    public String searchTerm;
    public List<Id> recordIds;
    /** The cursor token the previous page returned; see GridDataService. */
    public String cursorToken;
    /**
     * The fields the grid is grouped by, outermost first. Rows come in
     * group order, so the groups arrive whole as the grid scrolls.
     */
    public List<String> groupFields = new List<String>();
    /**
     * A child grid's parent: only records whose field points to the
     * parent. Both come from GridChildTables.scopeFor, never from the browser.
     */
    public String parentField;
    public Id parentId;
    /**
     * What else narrows the records: the admin's filters, the
     * user's, the record page's. Each is checked before it gets here
     * (GridFilters); its value is bound, never concatenated.
     */
    public List<GridFilters.Condition> conditions = new List<GridFilters.Condition>();
    /**
     * Fields the grid's formulas read, as SOQL paths, such as
     * Shipper__r.Name: read with the rows, never sent as columns. They
     * come from the configuration (GridConfig.Definition.formulaPaths), and
     * forUser has already dropped any formula with a path the user cannot read.
     */
    public List<String> formulaPaths = new List<String>();
    /**
     * Read each row's RecordTypeId and send it, when the grid's picklists
     * follow the row's record type (GridConfig.Definition.byRecordType). Not
     * a column: never searched, sorted or grouped by.
     */
    public Boolean withRecordType = false;
    /**
     * Where each row's currency codes are, in an org with more than one
     * currency (GridCurrency.fieldsToRead): read and sent with the row. Not
     * columns: never searched, sorted or grouped by.
     */
    public List<String> currencyFields = new List<String>();

    public GridRequest(String objectApiName, List<String> fields, String cursorLocator, Integer pageSize) {
        this.objectApiName = objectApiName;
        this.fields = fields == null ? new List<String>() : fields;
        this.cursorLocator = cursorLocator;
        this.pageSize = pageSize;
    }

    public GridRequest orderBy(String field, String direction) {
        this.sortField = field;
        this.sortDirection = direction;
        return this;
    }

    /** The sorts after the first, in order; none for null. */
    public GridRequest thenBy(List<Map<String, String>> keys) {
        this.thenSort = keys == null ? new List<Map<String, String>>() : keys;
        return this;
    }

    /** Quick search. The term is always bound, never concatenated (TC-021). */
    public GridRequest withSearch(String term) {
        this.searchTerm = term;
        return this;
    }

    /** Continue on the cursor the previous page opened, instead of opening another. */
    public GridRequest withCursor(String token) {
        this.cursorToken = token;
        return this;
    }

    /** Order the rows by these fields first; the caller has checked them against the grid. */
    public GridRequest groupedBy(List<String> fields) {
        this.groupFields = fields == null ? new List<String>() : fields;
        return this;
    }

    /** Only the records under one parent; null leaves the request as it is. */
    public GridRequest underParent(GridChildTables.Scope scope) {
        if (scope != null) {
            this.parentField = scope.fieldApiName;
            this.parentId = scope.parentId;
        }
        return this;
    }

    /** Only the records that meet these conditions; null leaves the request as it is. */
    public GridRequest narrowedBy(List<GridFilters.Condition> conditions) {
        if (conditions != null) {
            this.conditions = conditions;
        }
        return this;
    }

    /** Read these paths too, for the grid's formulas. */
    public GridRequest reading(List<String> paths) {
        if (paths != null) {
            this.formulaPaths = paths;
        }
        return this;
    }

    /** Restrict to specific records — used to re-read rows after a save. */
    public GridRequest onlyIds(List<Id> ids) {
        this.recordIds = ids;
        return this;
    }
}
