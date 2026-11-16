/**
 * GridLayouts — each user's layout of each grid, kept in Salesforce:
 * the column widths they set, Wrap or Clip, the sort, the grouping and the
 * rows whose related records are open, so the grid looks the same the next
 * time, on any device.
 *
 * One Grid User Layout record per user per grid, owned by the user; the object
 * is private, and every read and write is in user mode (GridSecurity), so a
 * user reaches only their own. Its Key is the user's Id and the grid's API
 * name, which makes the record unique and lets a save upsert by it. A grid
 * shown as a child table has a layout of its own for each tab that shows it
 * (each Grid Child Table record), keyed by the tab as well: the same grid on
 * a page, or under another grid's rows, keeps its own.
 *
 * What the layout holds is the browser's business: the server checks only
 * that it is a JSON object of a sensible size, for a grid that exists. The
 * browser checks each part against the grid as it loads it, and leaves out
 * what no longer fits (a column the grid no longer has).
 *
 * A layout is a convenience. A user without access to Grid User Layout (no
 * Rowhouse Grid User permission set) gets none, and the grid works as before.
 */
public with sharing class GridLayouts {
    /** Characters a layout may hold: well inside the field's 32,768. */
    public static final Integer MAX_LENGTH = 30000;

    /** This user's layout of the grid, as JSON, or null. */
    public static String read(String configName) {
        return read(configName, null);
    }

    /** This user's layout of the grid shown in that child table tab (blank: on its own), or null. */
    public static String read(String configName, String parentLink) {
        String name = configNamed(configName);
        String link = linkNamed(name, parentLink);
        if (
            !GridSecurity.canRead(Grid_User_Layout__c.SObjectType) ||
            !GridSecurity.canRead(Grid_User_Layout__c.Layout__c)
        ) {
            return null;
        }
        List<Grid_User_Layout__c> rows = own(name, link);
        return rows.isEmpty() ? null : rows[0].Layout__c;
    }

    /**
     * Keep this user's layout of the grid. False when the user may not keep
     * one; throws when the layout is not one (HR-6: it comes from the browser).
     */
    public static Boolean save(String configName, String layout) {
        return save(configName, layout, null);
    }

    /** The same, for the grid shown in that child table tab (blank: on its own). */
    public static Boolean save(String configName, String layout, String parentLink) {
        String name = configNamed(configName);
        String link = linkNamed(name, parentLink);
        if (String.isBlank(layout)) {
            throw new GridException('There is no layout to keep.');
        }
        if (layout.length() > MAX_LENGTH) {
            throw new GridException(
                'A layout is ' + MAX_LENGTH + ' characters at most; this one is ' + layout.length() + '.'
            );
        }
        Object parsed;
        try {
            parsed = JSON.deserializeUntyped(layout);
        } catch (Exception e) {
            throw new GridException('A layout must be JSON.');
        }
        if (!(parsed instanceof Map<String, Object>)) {
            throw new GridException('A layout must be a JSON object.');
        }
        if (
            !GridSecurity.canCreate(Grid_User_Layout__c.SObjectType) ||
            !GridSecurity.canUpdate(Grid_User_Layout__c.SObjectType) ||
            !GridSecurity.canEdit(Grid_User_Layout__c.Layout__c)
        ) {
            return false;
        }
        Grid_User_Layout__c record = new Grid_User_Layout__c(
            Name = name,
            Key__c = keyFor(name, link),
            Layout__c = layout
        );
        GridSecurity.upsertOwnRecord(record, Grid_User_Layout__c.Key__c);
        return true;
    }

    /** Forget this user's layout of the grid (Reset layout). */
    public static void reset(String configName) {
        reset(configName, null);
    }

    /** The same, for the grid shown in that child table tab (blank: on its own). */
    public static void reset(String configName, String parentLink) {
        String name = configNamed(configName);
        String link = linkNamed(name, parentLink);
        if (
            !GridSecurity.canRead(Grid_User_Layout__c.SObjectType) ||
            !GridSecurity.canDelete(Grid_User_Layout__c.SObjectType)
        ) {
            return;
        }
        GridSecurity.deleteOwnRecords(own(name, link));
    }

    /**
     * The sort and grouping a grid's first page is fetched with when it opens:
     * the layout's where they still fit the grid, the admin's where
     * they do not. It reads the layout exactly as the browser does (gridView's
     * readLayout): a sort key on a column the grid no longer has, or cannot
     * sort by, is passed over and the first one left is the sort; a grouping
     * level on a column that cannot be grouped is passed over, a date level
     * without a known unit is by month, and a grouping with levels none of
     * which is left falls back to the admin's, while an empty one is none.
     *
     * The answer is { sortField, sortDirection, thenSort, groupBy }: the sort
     * as the server applies it (the admin's when the layout has none; null
     * when neither has one), thenSort being the sorts after the first
     * ([{ field, direction }]), and the grouping as fetchRows takes it
     * ("Field__c" or "Field__c:month"). The browser compares it with its own
     * reading and fetches the rows again where they differ, so a difference
     * here costs a call, never a wrong order.
     */
    public static Map<String, Object> startOf(GridConfig.Definition def, String layout) {
        Map<String, Object> saved = parsed(layout);
        // Keyed exactly as the browser keys them: by the column's own spelling.
        Map<String, GridConfig.Column> byField = new Map<String, GridConfig.Column>();
        for (GridConfig.Column c : def.columns) {
            byField.put(c.field, c);
        }
        String sortField = String.isBlank(def.sortField) ? null : def.sortField;
        String sortDirection = sortField == null ? null : ('desc'.equals(def.sortDirection) ? 'desc' : 'asc');
        List<Map<String, Object>> thenSort = new List<Map<String, Object>>();
        if (sortField != null) {
            for (Map<String, String> level : def.thenSort) {
                thenSort.add(
                    new Map<String, Object>{ 'field' => level.get('field'), 'direction' => level.get('direction') }
                );
            }
        }
        Object savedSort = saved == null ? null : saved.get('sort');
        if (savedSort instanceof List<Object>) {
            List<Map<String, Object>> fit = new List<Map<String, Object>>();
            for (Object key : (List<Object>) savedSort) {
                Map<String, Object> k = key instanceof Map<String, Object> ? (Map<String, Object>) key : null;
                GridConfig.Column c = k != null && k.get('field') instanceof String
                    ? byField.get((String) k.get('field'))
                    : null;
                if (c != null && c.sortable != false && fit.size() < GridConfig.MAX_SORT_LEVELS) {
                    fit.add(
                        new Map<String, Object>{
                            'field' => c.field,
                            'direction' => 'desc'.equals(k.get('direction')) ? 'desc' : 'asc'
                        }
                    );
                }
            }
            if (!fit.isEmpty()) {
                sortField = (String) fit[0].get('field');
                sortDirection = (String) fit[0].get('direction');
                thenSort = new List<Map<String, Object>>();
                for (Integer i = 1; i < fit.size(); i++) {
                    thenSort.add(fit[i]);
                }
            }
        }
        List<String> groupBy = null;
        Object savedGrouping = saved == null ? null : saved.get('grouping');
        if (savedGrouping instanceof List<Object>) {
            List<Object> levels = (List<Object>) savedGrouping;
            List<String> fit = groupingThatFits(levels, byField);
            if (!fit.isEmpty() || levels.isEmpty()) {
                groupBy = fit;
            }
        }
        if (groupBy == null) {
            List<Object> admin = new List<Object>();
            for (Map<String, String> level : def.grouping) {
                admin.add(new Map<String, Object>{ 'field' => level.get('field'), 'unit' => level.get('unit') });
            }
            groupBy = groupingThatFits(admin, byField);
        }
        return new Map<String, Object>{
            'sortField' => sortField,
            'sortDirection' => sortDirection,
            'thenSort' => thenSort,
            'groupBy' => groupBy
        };
    }

    /**
     * The saved view this user pinned for the grid (the layout's pin), or
     * null: the grid then opens as the admin built it.
     */
    public static String pinned(String layout) {
        Map<String, Object> saved = parsed(layout);
        Object pin = saved == null ? null : saved.get('pin');
        return pin instanceof String && String.isNotBlank((String) pin) ? (String) pin : null;
    }

    /**
     * What this user keeps of their own for one saved view (the layout's
     * views, by the view's Id): the sort they last chose, and a change to the
     * view not yet saved (draft). Null when there is nothing.
     */
    public static Map<String, Object> viewState(String layout, String viewId) {
        Map<String, Object> saved = parsed(layout);
        Object views = saved == null ? null : saved.get('views');
        Object mine = views instanceof Map<String, Object> && viewId != null
            ? ((Map<String, Object>) views).get(viewId)
            : null;
        return mine instanceof Map<String, Object> ? (Map<String, Object>) mine : null;
    }

    /** gridGroups' normalizeGrouping, as fetchRows takes the levels. */
    private static List<String> groupingThatFits(List<Object> levels, Map<String, GridConfig.Column> byField) {
        List<String> out = new List<String>();
        Set<String> seen = new Set<String>();
        for (Object entry : levels) {
            Map<String, Object> level = entry instanceof Map<String, Object> ? (Map<String, Object>) entry : null;
            GridConfig.Column c = level != null && level.get('field') instanceof String
                ? byField.get((String) level.get('field'))
                : null;
            if (
                c == null ||
                c.groupable != true ||
                out.size() >= GridConfig.MAX_GROUP_LEVELS ||
                seen.contains(c.field)
            ) {
                continue;
            }
            seen.add(c.field);
            if ('date'.equals(c.type) || 'datetime'.equals(c.type)) {
                Object unit = level.get('unit');
                out.add(
                    c.field +
                        ':' +
                        (unit instanceof String && GridConfig.GROUP_UNITS.contains((String) unit)
                            ? (String) unit
                            : 'month')
                );
            } else {
                out.add(c.field);
            }
        }
        return out;
    }

    /** A layout as a JSON object, or null for none or anything else. */
    private static Map<String, Object> parsed(String layout) {
        if (String.isBlank(layout)) {
            return null;
        }
        try {
            Object value = JSON.deserializeUntyped(layout);
            return value instanceof Map<String, Object> ? (Map<String, Object>) value : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** The record's Key: the user's Id and the grid's API name. */
    @TestVisible
    private static String keyFor(String configName) {
        return keyFor(configName, null);
    }

    /** ... and, for a child table, the tab's API name: at most 18 + 1 + 40 + 1 + 40 characters. */
    @TestVisible
    private static String keyFor(String configName, String link) {
        return UserInfo.getUserId() + ':' + configName + (String.isBlank(link) ? '' : '/' + link);
    }

    /** This user's record for the grid, if there is one. */
    private static List<Grid_User_Layout__c> own(String configName, String link) {
        return (List<Grid_User_Layout__c>) GridSecurity.query(
            'SELECT Id, Layout__c FROM Grid_User_Layout__c WHERE Key__c = :layoutKey AND OwnerId = :me LIMIT 1',
            new Map<String, Object>{ 'layoutKey' => keyFor(configName, link), 'me' => UserInfo.getUserId() }
        );
    }

    /**
     * The child table tab's API name as the org spells it, or null for a grid
     * on its own. Throws when there is no such tab, or it does not show this
     * grid: the Key is made from it, and it comes from the browser (HR-6).
     */
    private static String linkNamed(String configName, String parentLink) {
        if (String.isBlank(parentLink)) {
            return null;
        }
        Grid_Child_Table__mdt link = Grid_Child_Table__mdt.getInstance(parentLink.trim());
        Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance(configName);
        if (link == null || cfg == null || !GridConfig.belongsTo(link.Child_Configuration__c, cfg)) {
            throw new GridException(
                'No Grid Child Table named "' + parentLink + '" shows the grid ' + configName + '.'
            );
        }
        return link.DeveloperName;
    }

    /**
     * The grid's API name as the org spells it, so one grid has one Key
     * whatever the case it is asked for in (a saved view's Grid, too).
     * Throws when there is no such grid.
     */
    public static String configNamed(String configName) {
        if (String.isNotBlank(configName)) {
            Grid_Configuration__mdt cfg = Grid_Configuration__mdt.getInstance(configName.trim());
            if (cfg != null) {
                return cfg.DeveloperName;
            }
            for (String name : Grid_Configuration__mdt.getAll().keySet()) {
                if (name.equalsIgnoreCase(configName.trim())) {
                    return name;
                }
            }
        }
        throw new GridException('No Grid Configuration named "' + configName + '".');
    }
}
