/**
 * GridController — the only Apex the grid's LWC calls.
 *
 * public, not global (HR-1): Salesforce's documented recommendation for a
 * package's own controllers. The cost, stated in the install guide: a
 * subscriber can grant access to a public controller only through a permission
 * set (Rowhouse_Grid_User), never through a profile.
 *
 * Every method takes a configuration NAME, never a list of fields or an object:
 * the server decides what is read and written from deployable configuration, and
 * the client cannot widen it (HR-6).
 */
public with sharing class GridController {
    /** A long text's characters a row carries (TC-055); a longer one ends in "…" after them. */
    public static final Integer LONG_TEXT_PREVIEW = 1000;

    /** The configuration as this user may see it, with what openGrid sends beside it. */
    private static Map<String, Object> gridConfig(String configName) {
        GridConfig.Definition def = GridConfig.forUser(configName);
        // Icons only here, once per grid opened, and never on the per-page or
        // per-keystroke calls: describing the tabs takes about 55 ms.
        GridIcons.decorate(def);
        Boolean diagnostics = GridSecurity.hasCustomPermission(GridException.DIAGNOSTICS);
        // Configuration warnings are for whoever maintains the grid.
        if (!diagnostics) {
            def.warnings = new List<String>();
        }
        return new Map<String, Object>{
            'definition' => def,
            'diagnostics' => diagnostics,
            // The gear that opens this grid's settings; the server checks again on every call.
            'canConfigure' => GridSecurity.hasCustomPermission(GridAdmin.PERMISSION),
            // For grouping the rows in hand by fiscal quarter and year; null without a date to group by.
            'fiscal' => GridGroupService.fiscalCalendarFor(def)
        };
    }

    /**
     * One page of rows, as plain maps keyed by LOCAL field name (HR-4).
     * Decimals travel as strings: an 18-digit value is beyond a JavaScript
     * number's precision, and the REST/Aura JSON path would otherwise round it
     * (verified in a Developer Edition org: TC-024 comes back as 1.0E18 through REST).
     *
     * cursorLocator and cursorToken come from the previous page and go back
     * unchanged; both are null for a first page. The token lets the next page
     * continue on the same cursor instead of opening, and paying for, another.
     *
     * groupBy is the grid's grouping, outermost first ("Field__c" or
     * "Field__c:month"); rows then come in group order.
     *
     * A child grid passes its tab (parentLink, a Grid Child Table name)
     * and its parent record; GridChildTables checks both and the rows are only the
     * parent's. A top-level grid passes neither.
     *
     * filters are the user's column filters, [{ field, operator, value,
     * valueTo }], joined by filterLogic ("1 AND (2 OR 3)"; blank: all must
     * hold); recordId is the record whose page a top-level grid is
     * on. GridFilters checks them all; the admin's filters always apply.
     *
     * thenSort is the sort after sortField, in order: [{ field, direction }],
     * each checked as sortField is. Without a sortField the admin's sort
     * applies, every level of it.
     */
    @AuraEnabled
    public static Map<String, Object> fetchRows(
        String configName,
        String searchTerm,
        String sortField,
        String sortDirection,
        String cursorLocator,
        Integer pageSize,
        String cursorToken,
        List<String> groupBy,
        String parentLink,
        String parentId,
        List<Map<String, Object>> filters,
        String recordId,
        String filterLogic,
        List<Map<String, Object>> thenSort
    ) {
        try {
            Long started = System.now().getTime();
            GridConfig.Definition def = GridConfig.forUser(configName);
            return page(
                def,
                searchTerm,
                sortField,
                sortDirection,
                thenSort,
                cursorLocator,
                pageSize,
                cursorToken,
                groupBy,
                parentLink,
                parentId,
                filters,
                filterLogic,
                recordId,
                started
            );
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Everything a grid needs to open, in one call: the configuration as this
     * user may see it, this user's layout (GridLayouts.read) and the first page
     * of rows (as fetchRows), sorted and grouped as the layout says where that
     * still fits the grid, else as the admin set it (GridLayouts.startOf).
     *
     * `start` is the sort and grouping the rows came in. The browser reads the
     * layout itself and, where it reads it differently, asks for the rows
     * again: this call can only save a trip, never show rows in the wrong order.
     *
     * A child table (parentLink and parentId) keeps no layout; a grid on
     * a record page passes recordId; searchTerm is a search the user
     * typed before the grid opened again (after its settings were saved, say).
     * A layout that cannot be read is no layout (`layoutError` says why), and
     * rows that cannot be read are no page (`pageError` says why, and the grid
     * shows it under its title, as before). `newRow` says how this user adds
     * records here, with the New button (GridCreateService.newRowFor), or is
     * null for no New button. Not cacheable: rows must be
     * fresh, so this is never answered from the browser's cache, and neither
     * is the configuration in it.
     *
     * A grid on its own opens on a saved view (GridViews): viewId, the one
     * asked for (from the page's address), else the one this user pinned
     * (the layout's pin), else none, as the admin built it. `view` is that
     * view, with what it keeps; `start` then also has its filters and filter
     * logic as they can be used now (GridViews.startOf), and the first page
     * is narrowed by them. A view asked for that this user can't see is no
     * view (`viewError` says so). A child table has no views.
     */
    @AuraEnabled
    public static Map<String, Object> openGrid(
        String configName,
        String searchTerm,
        String parentLink,
        String parentId,
        String recordId,
        String viewId
    ) {
        try {
            Long started = System.now().getTime();
            Map<String, Object> out = gridConfig(configName);
            GridConfig.Definition def = (GridConfig.Definition) out.get('definition');
            // A child table's layout is its own for each tab that shows it.
            String layout = null;
            try {
                layout = GridLayouts.read(configName, parentLink);
            } catch (Exception e) {
                out.put('layoutError', messageOf(e));
            }
            out.put('layout', layout);
            GridViews.View view = null;
            if (String.isBlank(parentLink)) {
                view = GridViews.readIfVisible(
                    configName,
                    String.isNotBlank(viewId) ? viewId : GridLayouts.pinned(layout)
                );
                if (view == null && String.isNotBlank(viewId)) {
                    out.put('viewError', 'The view you opened was deleted, or is no longer shared with you.');
                }
            }
            out.put('view', view);
            Map<String, Object> start = view == null
                ? GridLayouts.startOf(def, layout)
                : GridViews.startOf(def, view.view, GridLayouts.viewState(layout, view.id));
            out.put('start', start);
            try {
                out.put(
                    'page',
                    page(
                        def,
                        searchTerm,
                        (String) start.get('sortField'),
                        (String) start.get('sortDirection'),
                        (List<Map<String, Object>>) start.get('thenSort'),
                        null,
                        null,
                        null,
                        (List<String>) start.get('groupBy'),
                        parentLink,
                        parentId,
                        (List<Map<String, Object>>) start.get('filters'),
                        (String) start.get('logic'),
                        recordId,
                        started
                    )
                );
            } catch (Exception e) {
                out.put('pageError', messageOf(e));
            }
            // How this user adds records here; none when it cannot be worked out.
            try {
                out.put('newRow', GridCreateService.newRowFor(def, parentLink, parentId, recordId));
            } catch (Exception e) {
                out.put('newRow', null);
            }
            return out;
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** One page of rows for a configuration already worked out: fetchRows' and openGrid's. */
    private static Map<String, Object> page(
        GridConfig.Definition def,
        String searchTerm,
        String sortField,
        String sortDirection,
        List<Map<String, Object>> thenSort,
        String cursorLocator,
        Integer pageSize,
        String cursorToken,
        List<String> groupBy,
        String parentLink,
        String parentId,
        List<Map<String, Object>> filters,
        String filterLogic,
        String recordId,
        Long started
    ) {
        GridRequest request = new GridRequest(
            def.objectApiName,
            def.fieldNames(),
            cursorLocator,
            pageSize == null ? def.pageSize : pageSize
        );
        GridChildTables.Scope scope = GridChildTables.scopeFor(def, parentLink, parentId);
        request.underParent(scope);
        request.narrowedBy(GridFilters.forRequest(def, filters, filterLogic, recordId, scope != null));
        request.reading(def.formulaPaths());
        request.withRecordType = def.byRecordType == true;
        request.currencyFields = GridCurrency.fieldsToRead(def.columns);
        request.withSearch(searchTerm);
        request.withCursor(cursorToken);
        request.groupedBy(GridGroupService.fields(GridGroupService.levels(def, groupBy)));
        if (String.isNotBlank(sortField)) {
            request.orderBy(sortableColumn(def, sortField), sortDirection);
            request.thenBy(thenSortOf(def, thenSort));
        } else if (String.isNotBlank(def.sortField)) {
            request.orderBy(def.sortField, def.sortDirection);
            request.thenBy(def.thenSort);
        }
        GridPage page = GridDataService.fetchPage(request);
        return new Map<String, Object>{
            'rows' => toClientRows(page, def),
            'hasMore' => page.hasMore,
            'cursorLocator' => page.cursorLocator,
            'cursorToken' => page.hasMore ? page.cursorToken : null,
            'totalRows' => page.totalRows,
            'serverMs' => System.now().getTime() - started,
            'cpuMs' => Limits.getCpuTime()
        };
    }

    /**
     * The sort the browser asked for, checked against the grid (HR-6): a
     * column of this user's grid that can be sorted, as the grid spells it, or
     * the admin's default sort, which comes from the configuration. A saved
     * layout's sort is read the same way (GridLayouts.startOf). Whether the
     * user may read the field is GridDataService's to check.
     */
    /**
     * The sorts the browser asked for after the first, each checked as the
     * first is (sortableColumn), in order, up to the grid's limit; a blank one
     * is passed over.
     */
    private static List<Map<String, String>> thenSortOf(GridConfig.Definition def, List<Map<String, Object>> keys) {
        List<Map<String, String>> out = new List<Map<String, String>>();
        if (keys == null) {
            return out;
        }
        for (Map<String, Object> key : keys) {
            if (out.size() >= GridConfig.MAX_SORT_LEVELS - 1) {
                break;
            }
            Object field = key == null ? null : key.get('field');
            if (!(field instanceof String) || String.isBlank((String) field)) {
                continue;
            }
            out.add(
                new Map<String, String>{
                    'field' => sortableColumn(def, (String) field),
                    'direction' => 'desc'.equals(key.get('direction')) ? 'desc' : 'asc'
                }
            );
        }
        return out;
    }

    private static String sortableColumn(GridConfig.Definition def, String sortField) {
        String wanted = sortField.trim();
        if (String.isNotBlank(def.sortField) && wanted.equalsIgnoreCase(def.sortField.trim())) {
            return def.sortField.trim();
        }
        for (GridConfig.Column c : def.columns) {
            if (c.sortable == true && c.field != null && c.field.equalsIgnoreCase(wanted)) {
                return c.field;
            }
        }
        throw new GridException(
            'Cannot sort by ' + wanted + ': this grid has no column of that name that can be sorted.'
        );
    }

    /**
     * A grid's screen-flow action, for the page that runs it (c/rowhouseFlow):
     * its label, its flow and the input that takes a record's Id. The
     * page names only the grid and the action; which flow runs, and whether
     * this user may run it at all (its custom permission), is the
     * configuration's, as for every action. Throws for an action the
     * grid does not offer this user, or one that is not a screen flow; the
     * message does not repeat the name, which came from the page's address.
     */
    @AuraEnabled
    public static Map<String, Object> screenFlow(String configName, String actionName) {
        try {
            for (GridConfig.Action a : GridConfig.forUser(configName).actions) {
                if (a.name == actionName && a.type == 'screen_flow') {
                    return new Map<String, Object>{
                        'name' => a.name,
                        'label' => a.label,
                        'flowName' => a.flowName,
                        'inputName' => a.inputName,
                        'onRow' => a.onRow,
                        'onSelection' => a.onSelection
                    };
                }
            }
            throw new GridException('This grid has no screen flow of that name that you can run.');
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Re-read specific rows, after a save, so formulas and rounding show truly. */
    @AuraEnabled
    public static List<Map<String, Object>> fetchRowsById(String configName, List<Id> recordIds) {
        try {
            GridConfig.Definition def = GridConfig.forUser(configName);
            GridRequest request = new GridRequest(
                def.objectApiName,
                def.fieldNames(),
                null,
                GridDataService.MAX_PAGE_SIZE
            );
            request.onlyIds(recordIds);
            request.reading(def.formulaPaths());
            request.withRecordType = def.byRecordType == true;
            request.currencyFields = GridCurrency.fieldsToRead(def.columns);
            return toClientRows(GridDataService.fetchPage(request), def);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Records a lookup cell can point to, for the typeahead: [{ id, name, kind, object }].
     * The field must be an editable lookup or owner column of this grid (HR-6).
     */
    @AuraEnabled
    public static List<Map<String, String>> searchLookup(String configName, String field, String term) {
        try {
            return GridLookup.search(configName, field, term);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * The name of a record a lookup cell now points to: one chosen in
     * Salesforce's own lookup (a filtered lookup) or created from its New
     * item. The field must be an editable lookup column of this grid (HR-6).
     */
    @AuraEnabled
    public static String lookupName(String configName, String field, String recordId) {
        try {
            return GridLookup.nameOf(configName, field, String.isBlank(recordId) ? null : Id.valueOf(recordId));
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * The records with exactly these names, for names pasted or imported into
     * a lookup column: { lower-case name: [{ id, name }] }. The field must be
     * an editable lookup or owner column of this grid (HR-6).
     */
    @AuraEnabled
    public static Map<String, List<Map<String, String>>> findLookupNames(
        String configName,
        String field,
        List<String> names
    ) {
        try {
            return GridLookup.namesFor(configName, field, names);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    @AuraEnabled
    public static GridSaveResult save(String configName, List<Map<String, Object>> rows) {
        try {
            return GridSaveService.save(configName, rows);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Create the records of the grid's new rows, up to 200: each row is
     * { key, <field>: value }, answered by its key with the new record's Id
     * or why it was not created. A child table passes its tab and parent; a
     * grid on a record page passes the record (GridCreateService).
     */
    @AuraEnabled
    public static GridCreateService.Result createRows(
        String configName,
        List<Map<String, Object>> rows,
        String parentLink,
        String parentId,
        String recordId
    ) {
        try {
            return GridCreateService.create(configName, rows, parentLink, parentId, recordId);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    @AuraEnabled
    public static GridSaveResult saveStatus(String saveId) {
        try {
            return GridSaveService.status(saveId);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Delete up to 200 selected rows: { deletedIds, errors }. Refused
     * unless the configuration allows it and the user may delete the object.
     */
    @AuraEnabled
    public static GridDeleteService.Result deleteRows(String configName, List<Id> recordIds) {
        try {
            return GridDeleteService.deleteRows(configName, recordIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Users and queues a record of this grid can be given to, for a row's
     * Change Owner: [{ id, name, kind, object }]. Refused unless the grid
     * offers Change Owner to this user.
     */
    @AuraEnabled
    public static List<Map<String, String>> searchOwners(String configName, String term) {
        try {
            return GridOwnerService.searchOwners(configName, term);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Change Owner, saved at once: { changedIds, errors }. Refused unless the
     * grid offers Change Owner to this user and the owner is an active user
     * or a queue that accepts the object.
     */
    @AuraEnabled
    public static GridOwnerService.Result changeOwner(String configName, List<Id> recordIds, String ownerId) {
        try {
            return GridOwnerService.changeOwner(
                configName,
                recordIds,
                String.isBlank(ownerId) ? null : Id.valueOf(ownerId)
            );
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Undo a delete: put up to 200 records the grid just deleted back
     * from the Recycle Bin. { restoredIds, errors }.
     */
    @AuraEnabled
    public static GridDeleteService.RestoreResult restoreRows(String configName, List<Id> recordIds) {
        try {
            return GridDeleteService.restoreRows(configName, recordIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * For "delete every matching record": the next slice of Ids, in Id
     * order after afterId (null for the first), of the records the grid's
     * search, filters, parent and record page match, as fetchRows would read
     * them (filterLogic as fetchRows'). { ids }. Only for a grid that allows deleting.
     */
    @AuraEnabled
    public static Map<String, Object> matchingIds(
        String configName,
        String searchTerm,
        String parentLink,
        String parentId,
        List<Map<String, Object>> filters,
        String recordId,
        String afterId,
        String filterLogic
    ) {
        try {
            GridConfig.Definition def = GridConfig.forUser(configName);
            GridRequest request = new GridRequest(def.objectApiName, def.fieldNames(), null, null);
            GridChildTables.Scope scope = GridChildTables.scopeFor(def, parentLink, parentId);
            request.underParent(scope);
            request.narrowedBy(GridFilters.forRequest(def, filters, filterLogic, recordId, scope != null));
            request.withSearch(searchTerm);
            Id after = String.isBlank(afterId) ? null : Id.valueOf(afterId);
            return new Map<String, Object>{ 'ids' => GridDeleteService.matchingIds(def, request, after) };
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Run one of the grid's actions on up to 50 rows: { succeededIds,
     * errors }. The action is named, never described: what it runs comes from
     * the configuration. A screen flow runs in the browser and is refused here.
     */
    @AuraEnabled
    public static GridActionService.Result runAction(String configName, String actionName, List<Id> recordIds) {
        try {
            return GridActionService.run(configName, actionName, recordIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * One batch of an imported file, up to 200 rows: a row with an Id
     * updates that record, a row without one creates a record. Refused unless
     * the configuration allows import. With matchField, an External Id column
     * of the grid matches the records instead of the Id.
     */
    @AuraEnabled
    public static GridImportService.Result importRows(
        String configName,
        List<Map<String, Object>> rows,
        String parentLink,
        String parentId,
        String recordId,
        String matchField
    ) {
        try {
            return GridImportService.importRows(configName, rows, parentLink, parentId, recordId, matchField);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Undo import, for the records it created: up to 200 at a time, to
     * the Recycle Bin; only records this user created in the last day.
     */
    @AuraEnabled
    public static GridDeleteService.Result undoImport(String configName, List<Id> recordIds) {
        try {
            return GridImportService.undoCreates(configName, recordIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Counts and subtotals over every matching record, by the grouping.
     * A first call passes no Ids and may return slice boundaries; the browser
     * then asks for each slice by fromId and toId and adds the answers up.
     */
    @AuraEnabled
    public static GridGroupService.Result summarizeGroups(
        String configName,
        String searchTerm,
        List<String> grouping,
        String fromId,
        String toId,
        String parentLink,
        String parentId,
        List<Map<String, Object>> filters,
        String recordId,
        String filterLogic
    ) {
        try {
            return GridGroupService.summarize(
                configName,
                searchTerm,
                grouping,
                fromId,
                toId,
                parentLink,
                parentId,
                filters,
                filterLogic,
                recordId
            );
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * A chart's numbers: { groups, boundaries, tooManyGroups }, as
     * summarizeGroups answers, for one column to group by (and, for stacked
     * bars, a second to stack by; blank for none) and what to measure
     * (count, or sum or average of a number column). Both columns must be the
     * grid's, and the user's to read (HR-6). Sliced as summarizeGroups is.
     */
    @AuraEnabled
    public static GridGroupService.Result chartGroups(
        String configName,
        String searchTerm,
        String groupBy,
        String stackBy,
        String measure,
        String measureField,
        String fromId,
        String toId,
        String parentLink,
        String parentId,
        List<Map<String, Object>> filters,
        String recordId,
        String filterLogic
    ) {
        try {
            return GridGroupService.chart(
                configName,
                searchTerm,
                groupBy,
                stackBy,
                measure,
                measureField,
                fromId,
                toId,
                parentLink,
                parentId,
                filters,
                filterLogic,
                recordId
            );
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * How many related records each of these rows has, per tab:
     * { parentId: { total, byTab: { tab: n } } }, for at most 2,000 rows a
     * call. The tabs are the named grid's own, as this user may open them;
     * the rows must be records of the grid's object.
     */
    @AuraEnabled
    public static Map<String, Object> countChildren(String configName, List<String> parentIds) {
        try {
            return GridChildTables.countChildren(GridConfig.forUser(configName), parentIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * The whole of a long text value, for its editor: the rows carry at
     * most LONG_TEXT_PREVIEW characters (TC-055). The field must be a text
     * area column of this grid (whatever Cell Type it is shown as) that the
     * user can read, and the record one of the grid's object the user can see
     * (user mode).
     */
    @AuraEnabled
    public static String fetchFullText(String configName, String recordId, String field) {
        try {
            GridConfig.Definition def = GridConfig.forUser(configName);
            GridConfig.Column column = null;
            for (GridConfig.Column c : def.columns) {
                if (c.isFormula != true && field != null && c.field.equalsIgnoreCase(field.trim())) {
                    column = c;
                }
            }
            Schema.SObjectType objectType = GridDescribe.typeFor(def.objectApiName);
            // The column may be on a parent record (GridPaths): read through the row.
            GridPaths.FieldPath fp = column == null ? null : GridPaths.resolve(objectType, column.field);
            if (fp == null || fp.field.getDescribe().getType() != Schema.DisplayType.TEXTAREA) {
                throw new GridException('Not a long text column of this grid: ' + field);
            }
            Id rowId;
            try {
                rowId = Id.valueOf(recordId);
            } catch (Exception e) {
                throw new GridException('Not a record Id: ' + recordId);
            }
            if (rowId.getSObjectType() != objectType) {
                throw new GridException('Record ' + recordId + ' is not a ' + def.objectApiName + '.');
            }
            List<SObject> rows = GridSecurity.query(
                'SELECT ' + fp.soql + ' FROM ' + GridDescribe.apiName(objectType) + ' WHERE Id = :rowId',
                new Map<String, Object>{ 'rowId' => rowId }
            );
            if (rows.isEmpty()) {
                throw new GridException('The record could not be found. It may have been deleted.');
            }
            return (String) GridPaths.valueAt(rows[0], fp);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    // ------------------------------------------------------- layouts
    // A grid reads its layout when it opens (openGrid).

    /** Keep this user's layout of the grid (in that child table tab). False when it could not be kept: the grid works on without it. */
    @AuraEnabled
    public static Boolean saveLayout(String configName, String layout, String parentLink) {
        try {
            return GridLayouts.save(configName, layout, parentLink);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Forget this user's layout of the grid (in that child table tab): Reset layout. */
    @AuraEnabled
    public static void resetLayout(String configName, String parentLink) {
        try {
            GridLayouts.reset(configName, parentLink);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    // ------------------------------------------------------------ saved views

    /**
     * The grid's saved views this user can open, A to Z, without what they
     * keep: { views: [{ id, name, ownerName, mine, lastModified }], canShare }.
     * canShare: this user may share a view with all users or groups.
     */
    @AuraEnabled
    public static Map<String, Object> listViews(String configName) {
        try {
            return GridViews.listFor(configName);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** One saved view, with what it keeps (and, for its owner, who sees it). */
    @AuraEnabled
    public static GridViews.View readView(String configName, String viewId) {
        try {
            return GridViews.read(configName, viewId);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /**
     * Save a view: new when viewId is blank, else one of this user's own,
     * renamed (name) or changed (view, JSON; null keeps it). shareMode (me,
     * all, groups, with groupIds) sets who sees it too; null leaves that
     * as it is. Everything is checked on the server (GridViews).
     */
    @AuraEnabled
    public static GridViews.View saveView(
        String configName,
        String viewId,
        String name,
        String view,
        String shareMode,
        List<String> groupIds
    ) {
        try {
            return GridViews.save(configName, viewId, name, view, shareMode, groupIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Who sees one of this user's own views: me, all, or groups (groupIds). */
    @AuraEnabled
    public static GridViews.View shareView(String configName, String viewId, String shareMode, List<String> groupIds) {
        try {
            return GridViews.share(configName, viewId, shareMode, groupIds);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Delete one of this user's own views. */
    @AuraEnabled
    public static void deleteView(String configName, String viewId) {
        try {
            GridViews.remove(configName, viewId);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** The kinds of group a view can be shared with in this org: [{ value, label }]. */
    @AuraEnabled
    public static List<Map<String, String>> viewGroupTypes() {
        try {
            return GridViews.groupTypes();
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    /** Groups of one kind whose names contain the term, to share a view with. */
    @AuraEnabled
    public static List<GridViews.ShareGroup> searchViewGroups(String type, String term) {
        try {
            return GridViews.searchGroups(type, term);
        } catch (Exception e) {
            throw auraError(e);
        }
    }

    // ---------------------------------------------------------------- helpers

    @TestVisible
    private static List<Map<String, Object>> toClientRows(GridPage page, GridConfig.Definition def) {
        List<Map<String, Object>> out = toClientRows(page, def.objectApiName);
        if (def.hasFormulas()) {
            addFormulas(page.rows, out, def);
        }
        if (def.hasChildTotals()) {
            GridChildTables.addChildTotals(out, def);
        }
        return out;
    }

    /**
     * Each formula column's value, and the names of the formula rules a row
     * meets as `_rules`, worked out from the row as read.
     */
    private static void addFormulas(List<SObject> rows, List<Map<String, Object>> out, GridConfig.Definition def) {
        for (Integer i = 0; i < rows.size(); i++) {
            SObject row = rows[i];
            Map<String, Object> m = out[i];
            for (GridConfig.Column c : def.columns) {
                if (c.formula != null) {
                    Object value = GridFormulas.evaluate(c.formula.instance, row);
                    if (c.type == 'percent' && value instanceof Decimal) {
                        // A formula works out 25% as 0.25, as a Salesforce formula field does
                        // (Fuel_Surcharge__c of 25 reads as 0.25); the grid shows a percent as the number before the % sign.
                        value = ((Decimal) value) * 100;
                    }
                    m.put(c.field, value instanceof Decimal ? (Object) ((Decimal) value).toPlainString() : value);
                }
            }
            List<String> matched = new List<String>();
            for (GridConfig.DisplayRule r : def.displayRules) {
                Object meets = r.formula == null ? null : GridFormulas.evaluate(r.formula.instance, row);
                if (meets instanceof Boolean && (Boolean) meets) {
                    matched.add(r.name);
                }
            }
            if (!matched.isEmpty()) {
                m.put('_rules', matched);
            }
        }
    }

    @TestVisible
    private static List<Map<String, Object>> toClientRows(GridPage page, String objectApiName) {
        Schema.SObjectType objectType = GridDescribe.typeFor(objectApiName);
        Map<String, Schema.SObjectField> fields = new Map<String, Schema.SObjectField>();
        for (String local : page.selectedFields) {
            fields.put(
                local,
                page.paths.containsKey(local) ? page.paths.get(local).field : GridDescribe.field(objectType, local)
            );
        }
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (SObject row : page.rows) {
            Map<String, Object> m = new Map<String, Object>{ 'Id' => row.Id };
            Map<String, Object> populated = row.getPopulatedFieldsAsMap();
            List<String> cut = new List<String>();
            // A parent record's field: the record that holds it, by column, so an
            // edit shows on every row with the same parent and is saved to it.
            Map<String, String> parents = new Map<String, String>();
            for (String local : fields.keySet()) {
                Schema.SObjectField f = fields.get(local);
                Object stored;
                GridPaths.FieldPath fp = page.paths.get(local);
                if (fp != null) {
                    stored = GridPaths.valueAt(row, fp);
                    Id holder = GridPaths.holderIdAt(row, fp);
                    if (holder != null) {
                        parents.put(local, String.valueOf(holder));
                    }
                } else if (!populated.containsKey(GridDescribe.apiName(f))) {
                    m.put(local, null);
                    continue;
                } else {
                    stored = row.get(f);
                }
                Object value = toClientValue(stored, f);
                m.put(local, value);
                // Compared as text, not by length: a text of exactly 1,001 characters
                // is shortened to 1,000 and "…", which is as long.
                if (stored instanceof String && !((String) value).equals((String) stored)) {
                    cut.add(local); // shortened (TC-055): its editor reads the whole text first
                }
            }
            if (!cut.isEmpty()) {
                m.put('_cut', cut);
            }
            if (!parents.isEmpty()) {
                m.put('_parents', parents);
            }
            // Lookup display names, keyed by field: '_' cannot start a field name.
            if (!page.namePaths.isEmpty()) {
                Map<String, String> labels = new Map<String, String>();
                for (String local : page.namePaths.keySet()) {
                    Object name = valueAtPath(row, page.namePaths.get(local));
                    if (name != null) {
                        labels.put(local, String.valueOf(name));
                    }
                }
                m.put('_labels', labels);
            }
            out.add(m);
        }
        return out;
    }

    /** The value at the end of a SOQL path ('Account.Name', 'Account.Parent.Name'); null where a record on the way is blank. */
    private static Object valueAtPath(SObject row, String path) {
        List<String> steps = path.split('\\.');
        SObject current = row;
        for (Integer i = 0; i < steps.size() - 1; i++) {
            if (current == null || !current.getPopulatedFieldsAsMap().containsKey(steps[i])) {
                return null;
            }
            current = current.getSObject(steps[i]);
        }
        return current == null ? null : current.get(steps[steps.size() - 1]);
    }

    /** A field's value as the browser reads it; also a new row's defaults (GridCreateService). */
    public static Object toClientValue(Object value, Schema.SObjectField f) {
        if (value instanceof Decimal) {
            return ((Decimal) value).toPlainString();
        }
        if (value instanceof Time) {
            // As Salesforce writes a Time ("17:30:00.000Z"): returned from Apex as it
            // is, a Time reaches the browser as milliseconds after midnight (seen in
            // Lightning Experience).
            return timeText((Time) value);
        }
        if (value instanceof String) {
            Schema.DescribeFieldResult d = f.getDescribe();
            String text = (String) value;
            // TC-055: never ship a 32,000-character value into a grid cell.
            if (
                d.getType() == Schema.DisplayType.TEXTAREA &&
                d.getLength() > 255 &&
                text.length() > LONG_TEXT_PREVIEW
            ) {
                return text.left(LONG_TEXT_PREVIEW) + '…';
            }
        }
        return value;
    }

    /** A Time as "HH:mm:ss.SSSZ", the form the grid's editors and the save path read. */
    @TestVisible
    private static String timeText(Time t) {
        return String.valueOf(t.hour()).leftPad(2, '0') +
            ':' +
            String.valueOf(t.minute()).leftPad(2, '0') +
            ':' +
            String.valueOf(t.second()).leftPad(2, '0') +
            '.' +
            String.valueOf(t.millisecond()).leftPad(3, '0') +
            'Z';
    }

    /**
     * What a failure says: a GridException's own words; anything else in a
     * plain sentence, with the platform's text only for Rowhouse Grid
     * Diagnostics users (GridException.messageFor).
     */
    private static String messageOf(Exception e) {
        return GridException.messageFor(e);
    }

    /** Subscribers catch bare Exception (HR-1), so the message is the diagnostic. */
    private static AuraHandledException auraError(Exception e) {
        String message = messageOf(e);
        AuraHandledException wrapped = new AuraHandledException(message);
        wrapped.setMessage(message);
        return wrapped;
    }
}
