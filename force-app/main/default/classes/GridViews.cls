/**
 * GridViews — the views of a grid that users save and name, as list views
 * are: Grid View records.
 *
 * WHAT A VIEW IS
 * A record owned by the user who saved it: the grid's API name, the view's
 * name, and what it keeps, as JSON: the columns and their order, the frozen
 * columns, the grouping and the groups' order, the filters and their filter
 * logic, the sort it opens with, and its charts (a list of one for now, so
 * named charts can come later without a new field). The object is private.
 * Its owner shares it with all internal users, public groups or roles by
 * Manual share rows (GridSecurity.replaceShares), so Salesforce decides who
 * sees it, and anyone it is shared with may only read it: here only the owner
 * renames, changes, shares or deletes a view. Rowhouse Grid Admins may delete
 * any view on the Grid Admin tab (GridAdmin).
 *
 * WHAT IS CHECKED
 * Everything here comes from the browser (HR-6). A view is of a grid that
 * exists and that this user may open; its name is 1 to 80 characters and not
 * the name of another of this user's views of the grid; what it keeps is a
 * JSON object of at most 30,000 characters whose filters and filter logic fit
 * the grid as this user sees it. The rest is the browser's to check as it
 * opens the view, as for a layout (GridLayouts). Each time a view opens, its
 * filters are checked again against the grid as the user who opens it sees it
 * (startOf), and they only ever narrow it: the admin's Grid Filters and the
 * page's record still apply.
 *
 * Sharing with all users or with groups needs Salesforce's Manage Public
 * List Views (GridSecurity.canSharePublicly), as sharing a list view does.
 *
 * WHICH VIEWS A GRID LISTS
 * The user's own, and other people's that are shared with them. Someone with
 * View All on Grid View (Rowhouse Grid Admin, or View All Data) can read every
 * view, so other people's views that have no share row, which only their
 * owners can see in Salesforce, are left out of the list for them too.
 */
public with sharing class GridViews {
    /** Characters a view's name may have, as a list view's. */
    public static final Integer MAX_NAME = 80;
    /** Characters what a view keeps may have: well inside the field's 32,768. */
    public static final Integer MAX_LENGTH = 30000;
    /** Views one user may save of one grid. */
    public static final Integer MAX_OWN_VIEWS = 100;
    /** Views a grid's list shows at most. */
    public static final Integer MAX_LISTED = 2000;
    /** Groups one view may be shared with. */
    public static final Integer MAX_GROUPS = 50;
    /** Groups a search finds at most. */
    public static final Integer MAX_FOUND = 20;

    /** Who sees a view: its owner alone, all internal users, or groups. */
    public static final String ONLY_ME = 'me';
    public static final String ALL_USERS = 'all';
    public static final String WITH_GROUPS = 'groups';

    /** The kinds of group a view can be shared with, in the order Salesforce lists them, and their names there. */
    public static final Map<String, String> GROUP_TYPES = new Map<String, String>{
        'Role' => 'Roles',
        'RoleAndSubordinatesInternal' => 'Roles and Internal Subordinates',
        'RoleAndSubordinates' => 'Roles and Subordinates',
        'Regular' => 'Public Groups'
    };

    /** One view, as the grid and the Grid Admin tab show it. */
    public class View {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String ownerName;
        /** This user saved it, so may change, share and delete it. */
        @AuraEnabled
        public Boolean mine;
        @AuraEnabled
        public Datetime lastModified;
        /** What it keeps, as JSON: only when one view is read. */
        @AuraEnabled
        public String view;
        /** Who sees it (me, all, groups): for its owner, and on the Grid Admin tab. */
        @AuraEnabled
        public String sharing;
        @AuraEnabled
        public List<ShareGroup> groups;
    }

    /** A group a view can be shared with: a public group, or a role's group. */
    public class ShareGroup {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String type;
        @AuraEnabled
        public String typeLabel;
    }

    // ------------------------------------------------------------ reading

    /**
     * The views of a grid this user may open: { views, canShare }, the views
     * A to Z, without what they keep. Nothing when the user has no access to
     * Grid View.
     */
    public static Map<String, Object> listFor(String configName) {
        String grid = GridLayouts.configNamed(configName);
        List<View> out = new List<View>();
        if (readable()) {
            List<Grid_View__c> rows = (List<Grid_View__c>) GridSecurity.query(
                'SELECT Id, Name, OwnerId, Owner.Name, LastModifiedDate FROM Grid_View__c' +
                    ' WHERE Grid__c = :grid ORDER BY Name, Id LIMIT ' +
                    MAX_LISTED,
                new Map<String, Object>{ 'grid' => grid }
            );
            Set<Id> shared = sharedOfOthers(rows);
            for (Grid_View__c r : rows) {
                if (r.OwnerId == UserInfo.getUserId() || shared.contains(r.Id)) {
                    out.add(viewOf(r, null));
                }
            }
        }
        return new Map<String, Object>{ 'views' => out, 'canShare' => GridSecurity.canSharePublicly() };
    }

    /**
     * One view of the grid, with what it keeps; for its owner, who sees it
     * too. Throws when there is none this user can see.
     */
    public static View read(String configName, String viewId) {
        Grid_View__c r = visible(GridLayouts.configNamed(configName), viewId);
        View v = viewOf(r, r.View__c);
        if (v.mine) {
            addSharing(new List<View>{ v });
        }
        return v;
    }

    /**
     * Every view of the grid this user can read, A to Z, with who sees each:
     * for the Grid Admin tab, whose admins read them all (View All on Grid
     * View). Without what they keep.
     */
    public static List<View> everyViewOf(String configName) {
        String grid = GridLayouts.configNamed(configName);
        List<View> out = new List<View>();
        if (!readable()) {
            return out;
        }
        for (
            Grid_View__c r : (List<Grid_View__c>) GridSecurity.query(
                'SELECT Id, Name, OwnerId, Owner.Name, LastModifiedDate FROM Grid_View__c' +
                    ' WHERE Grid__c = :grid ORDER BY Name, Id LIMIT ' +
                    MAX_LISTED,
                new Map<String, Object>{ 'grid' => grid }
            )
        ) {
            out.add(viewOf(r, null));
        }
        addSharing(out);
        return out;
    }

    /**
     * Delete a view of the grid, whoever owns it, when this user may: the Grid
     * Admin tab's, for admins with Modify All on Grid View. Salesforce refuses
     * anyone else.
     */
    public static void removeAny(String configName, String viewId) {
        deleteView(visible(GridLayouts.configNamed(configName), viewId).Id);
    }

    /**
     * The view, or null when there is none this user can see: openGrid's,
     * for the view a grid opens on (one deleted or no longer shared is no
     * view, and the grid opens as the admin built it).
     */
    public static View readIfVisible(String configName, String viewId) {
        try {
            return String.isBlank(viewId) ? null : read(configName, viewId);
        } catch (GridException e) {
            return null;
        }
    }

    // ------------------------------------------------------------ saving

    /**
     * Save a view: a new one when viewId is blank, else one of this user's
     * own, renamed (name) or changed (view; null keeps what it keeps). With
     * a share mode (me, all, groups and groupIds), who sees it, in the same
     * transaction: a refusal saves nothing. Returns the view as read.
     */
    public static View save(
        String configName,
        String viewId,
        String name,
        String view,
        String shareMode,
        List<String> groupIds
    ) {
        String grid = GridLayouts.configNamed(configName);
        GridConfig.Definition def = GridConfig.forUser(grid);
        String cleanName = name == null ? null : name.trim();
        Boolean creating = String.isBlank(viewId);
        if (creating || cleanName != null) {
            requireName(cleanName);
        }
        if (creating || view != null) {
            requireView(def, view);
        }
        // A refusal part way (sharing, say) leaves nothing half done.
        Savepoint before = Database.setSavepoint();
        try {
            return saved(grid, viewId, cleanName, view, shareMode, groupIds, creating);
        } catch (Exception e) {
            Database.rollback(before);
            throw e;
        }
    }

    private static View saved(
        String grid,
        String viewId,
        String cleanName,
        String view,
        String shareMode,
        List<String> groupIds,
        Boolean creating
    ) {
        Grid_View__c record;
        if (creating) {
            if (!GridSecurity.canCreate(Grid_View__c.SObjectType) || !GridSecurity.canEdit(Grid_View__c.View__c)) {
                throw new GridException('You don\'t have access to save views. Ask your Salesforce admin.');
            }
            List<Grid_View__c> own = ownViews(grid);
            if (own.size() >= MAX_OWN_VIEWS) {
                throw new GridException(
                    'You have ' + MAX_OWN_VIEWS + ' views of this grid, the most you can save. Delete one first.'
                );
            }
            requireUnique(own, cleanName, null);
            record = new Grid_View__c(Name = cleanName, Grid__c = grid, View__c = view);
            GridSecurity.insertOwnRecords(new List<SObject>{ record });
        } else {
            // Only what changes: nothing read with the view goes back.
            record = new Grid_View__c(Id = owned(grid, viewId).Id);
            if (cleanName != null) {
                requireUnique(ownViews(grid), cleanName, record.Id);
                record.Name = cleanName;
            }
            if (view != null) {
                record.View__c = view;
            }
            if (cleanName != null || view != null) {
                Database.SaveResult result = GridSecurity.updateRecords(new List<SObject>{ record })[0];
                if (!result.isSuccess()) {
                    throw new GridException(firstError(result.getErrors()));
                }
            }
        }
        if (shareMode != null) {
            share(record.Id, shareMode, groupIds);
        }
        return read(grid, record.Id);
    }

    /** Who sees one of this user's own views: only them, all users, or these groups. */
    public static View share(String configName, String viewId, String shareMode, List<String> groupIds) {
        String grid = GridLayouts.configNamed(configName);
        Grid_View__c record = owned(grid, viewId);
        share(record.Id, shareMode, groupIds);
        return read(grid, record.Id);
    }

    /** Delete one of this user's own views. Throws when it is not theirs, or is gone. */
    public static void remove(String configName, String viewId) {
        Grid_View__c record = owned(GridLayouts.configNamed(configName), viewId);
        deleteView(record.Id);
    }

    /** Delete a view, which the user may delete (its owner; an admin with Modify All). */
    public static void deleteView(Id viewId) {
        Database.DeleteResult result = GridSecurity.deleteRecords(Grid_View__c.SObjectType, new List<Id>{ viewId })[0];
        if (!result.isSuccess()) {
            throw new GridException(firstError(result.getErrors()));
        }
    }

    // ------------------------------------------------------------ sharing

    /**
     * The groups this user may share a view with, of one kind (Regular,
     * Role, RoleAndSubordinatesInternal, RoleAndSubordinates), whose names
     * contain the term; at most 20, A to Z. Only for someone who may share.
     */
    public static List<ShareGroup> searchGroups(String type, String term) {
        requireCanShare();
        if (type == null || !GROUP_TYPES.containsKey(type)) {
            throw new GridException('Choose the kind of group to share with.');
        }
        String pattern = '%' + GridDataService.escapeLike(term == null ? '' : term.trim()) + '%';
        List<ShareGroup> out = new List<ShareGroup>();
        if (type == 'Regular') {
            for (
                SObject g : GridSecurity.query(
                    'SELECT Id, Name FROM Group WHERE Type = \'Regular\' AND Name LIKE :term ORDER BY Name LIMIT ' +
                    MAX_FOUND,
                    new Map<String, Object>{ 'term' => pattern }
                )
            ) {
                out.add(groupOf(g.Id, (String) g.get('Name'), type));
            }
            return out;
        }
        Map<Id, String> roles = new Map<Id, String>();
        for (
            SObject r : GridSecurity.query(
                'SELECT Id, Name FROM UserRole WHERE Name LIKE :term ORDER BY Name LIMIT ' + MAX_FOUND,
                new Map<String, Object>{ 'term' => pattern }
            )
        ) {
            roles.put(r.Id, (String) r.get('Name'));
        }
        if (roles.isEmpty()) {
            return out;
        }
        Set<Id> roleIds = roles.keySet();
        Map<Id, Id> groupOfRole = new Map<Id, Id>();
        for (
            SObject g : GridSecurity.query(
                'SELECT Id, RelatedId FROM Group WHERE Type = :type AND RelatedId IN :roles',
                new Map<String, Object>{ 'type' => type, 'roles' => roleIds }
            )
        ) {
            groupOfRole.put((Id) g.get('RelatedId'), g.Id);
        }
        for (Id roleId : roles.keySet()) {
            if (groupOfRole.containsKey(roleId)) {
                out.add(groupOf(groupOfRole.get(roleId), roles.get(roleId), type));
            }
        }
        return out;
    }

    /**
     * The kinds of group this org has to share with, as Salesforce offers
     * them: Roles, Roles and Internal Subordinates (or Roles and Subordinates
     * in an org without Experience Cloud), and Public Groups when there are
     * some. [{ value, label }]. Only for someone who may share.
     */
    public static List<Map<String, String>> groupTypes() {
        requireCanShare();
        Set<String> present = new Set<String>();
        for (
            SObject row : GridSecurity.query(
                'SELECT Type FROM Group WHERE Type IN :types GROUP BY Type',
                new Map<String, Object>{ 'types' => GROUP_TYPES.keySet() }
            )
        ) {
            present.add((String) row.get('Type'));
        }
        if (present.contains('RoleAndSubordinatesInternal')) {
            // With Experience Cloud, Roles and Subordinates includes partner and customer users too.
            present.remove('RoleAndSubordinates');
        }
        List<Map<String, String>> out = new List<Map<String, String>>();
        for (String type : GROUP_TYPES.keySet()) {
            if (present.contains(type)) {
                out.add(new Map<String, String>{ 'value' => type, 'label' => GROUP_TYPES.get(type) });
            }
        }
        return out;
    }

    /** Fill in who sees each view: sharing (me, all, groups) and the groups. For the owner, or an admin. */
    public static void addSharing(List<View> views) {
        Map<Id, View> byId = new Map<Id, View>();
        for (View v : views) {
            v.sharing = ONLY_ME;
            v.groups = new List<ShareGroup>();
            byId.put(v.id, v);
        }
        if (byId.isEmpty()) {
            return;
        }
        Set<Id> ids = byId.keySet();
        List<SObject> shares = GridSecurity.query(
            'SELECT ParentId, UserOrGroupId FROM Grid_View__Share WHERE ParentId IN :ids AND RowCause = \'Manual\'',
            new Map<String, Object>{ 'ids' => ids }
        );
        Set<Id> groupIds = new Set<Id>();
        for (SObject s : shares) {
            groupIds.add((Id) s.get('UserOrGroupId'));
        }
        Map<Id, ShareGroup> groups = groupsById(groupIds);
        for (SObject s : shares) {
            View v = byId.get((Id) s.get('ParentId'));
            ShareGroup g = groups.get((Id) s.get('UserOrGroupId'));
            if (g == null) {
                continue;
            }
            if (g.type == 'Organization') {
                v.sharing = ALL_USERS;
            } else if (v.sharing != ALL_USERS) {
                v.sharing = WITH_GROUPS;
                v.groups.add(g);
            }
        }
        for (View v : views) {
            if (v.sharing == ALL_USERS) {
                v.groups = new List<ShareGroup>();
            }
        }
    }

    private static void share(Id viewId, String shareMode, List<String> groupIds) {
        String mode = shareMode == null ? '' : shareMode.trim().toLowerCase();
        List<Id> to = new List<Id>();
        if (mode == ALL_USERS) {
            requireCanShare();
            to.add(everyone());
        } else if (mode == WITH_GROUPS) {
            requireCanShare();
            to.addAll(shareableGroups(groupIds));
        } else if (mode != ONLY_ME) {
            throw new GridException('Choose who sees this view.');
        }
        List<SObject> old = GridSecurity.query(
            'SELECT Id FROM Grid_View__Share WHERE ParentId = :viewId AND RowCause = \'Manual\'',
            new Map<String, Object>{ 'viewId' => viewId }
        );
        List<SObject> fresh = new List<SObject>();
        for (Id groupId : to) {
            fresh.add(
                new Grid_View__Share(
                    ParentId = viewId,
                    UserOrGroupId = groupId,
                    AccessLevel = 'Read',
                    RowCause = 'Manual'
                )
            );
        }
        GridSecurity.replaceShares(old, fresh);
    }

    /** The groups named, checked to be groups a view may be shared with (HR-6). */
    private static List<Id> shareableGroups(List<String> groupIds) {
        Set<Id> wanted = new Set<Id>();
        for (String raw : groupIds == null ? new List<String>() : groupIds) {
            try {
                wanted.add(Id.valueOf(raw.trim()));
            } catch (Exception e) {
                throw new GridException('Not a group: ' + raw);
            }
        }
        if (wanted.isEmpty()) {
            throw new GridException('Choose at least one group to share this view with.');
        }
        if (wanted.size() > MAX_GROUPS) {
            throw new GridException('Share a view with at most ' + MAX_GROUPS + ' groups.');
        }
        List<Id> out = new List<Id>();
        for (
            SObject g : GridSecurity.query(
                'SELECT Id FROM Group WHERE Id IN :ids AND Type IN :types',
                new Map<String, Object>{ 'ids' => wanted, 'types' => GROUP_TYPES.keySet() }
            )
        ) {
            out.add(g.Id);
        }
        if (out.size() != wanted.size()) {
            throw new GridException('A view can be shared only with roles and public groups.');
        }
        return out;
    }

    /** The all internal users group. */
    private static Id everyone() {
        List<SObject> rows = GridSecurity.query(
            'SELECT Id FROM Group WHERE Type = \'Organization\' LIMIT 1',
            new Map<String, Object>()
        );
        if (rows.isEmpty()) {
            throw new GridException('This org has no group of all internal users to share with.');
        }
        return rows[0].Id;
    }

    /** These groups by Id, named as Salesforce names them: a role's groups by the role. */
    private static Map<Id, ShareGroup> groupsById(Set<Id> ids) {
        Map<Id, ShareGroup> out = new Map<Id, ShareGroup>();
        if (ids.isEmpty()) {
            return out;
        }
        Map<Id, Id> roleOf = new Map<Id, Id>();
        List<SObject> rows = GridSecurity.query(
            'SELECT Id, Name, Type, RelatedId FROM Group WHERE Id IN :ids',
            new Map<String, Object>{ 'ids' => ids }
        );
        for (SObject g : rows) {
            String type = (String) g.get('Type');
            if (type == 'Organization' || type == 'Regular') {
                out.put(
                    g.Id,
                    groupOf(g.Id, type == 'Organization' ? 'All Internal Users' : (String) g.get('Name'), type)
                );
            } else if (GROUP_TYPES.containsKey(type) && g.get('RelatedId') != null) {
                roleOf.put(g.Id, (Id) g.get('RelatedId'));
            }
        }
        if (!roleOf.isEmpty()) {
            Set<Id> roleIds = new Set<Id>(roleOf.values());
            Map<Id, String> roleNames = new Map<Id, String>();
            for (
                SObject r : GridSecurity.query(
                    'SELECT Id, Name FROM UserRole WHERE Id IN :ids',
                    new Map<String, Object>{ 'ids' => roleIds }
                )
            ) {
                roleNames.put(r.Id, (String) r.get('Name'));
            }
            for (SObject g : rows) {
                if (roleOf.containsKey(g.Id) && roleNames.containsKey(roleOf.get(g.Id))) {
                    out.put(g.Id, groupOf(g.Id, roleNames.get(roleOf.get(g.Id)), (String) g.get('Type')));
                }
            }
        }
        return out;
    }

    private static ShareGroup groupOf(Id id, String name, String type) {
        ShareGroup g = new ShareGroup();
        g.id = id;
        g.name = name;
        g.type = type;
        g.typeLabel = GROUP_TYPES.containsKey(type) ? GROUP_TYPES.get(type) : null;
        return g;
    }

    private static void requireCanShare() {
        if (!GridSecurity.canSharePublicly()) {
            throw new GridException(
                'Sharing a view needs the Manage Public List Views permission. Ask your Salesforce admin.'
            );
        }
    }

    // ------------------------------------------------------------ opening a view

    /**
     * How a grid opens on a view: what it keeps, or this user's unsaved change
     * to it (draft, from their layout), sorted as this user last sorted it
     * (sort, from their layout) else as it was saved. Returns { sortField,
     * sortDirection, thenSort, groupBy } as GridLayouts.startOf does, and the view's
     * filters and filter logic as they can be used now: { filters, logic,
     * notes }. A filter that no longer fits the grid as this user sees it (its
     * column was removed, say) is left out and named in notes, and then the
     * filter logic, whose numbers no longer match, is left out too.
     */
    public static Map<String, Object> startOf(GridConfig.Definition def, String view, Map<String, Object> mine) {
        Map<String, Object> kept = parsed(view);
        Map<String, Object> draft = mine == null ? null : asMap(mine.get('draft'));
        Map<String, Object> shown = draft != null ? draft : (kept == null ? new Map<String, Object>() : kept);
        Object sortKeys = mine != null && mine.get('sort') instanceof List<Object>
            ? mine.get('sort')
            : shown.get('sort');
        Map<String, Object> layout = new Map<String, Object>{ 'sort' => sortKeys };
        // No grouping kept is none; GridLayouts would read it as the admin's.
        layout.put(
            'grouping',
            shown.get('grouping') instanceof List<Object> ? shown.get('grouping') : new List<Object>()
        );
        Map<String, Object> out = GridLayouts.startOf(def, JSON.serialize(layout));

        List<Map<String, Object>> filters = new List<Map<String, Object>>();
        List<String> notes = new List<String>();
        Integer offered = 0;
        Object raw = shown.get('filters');
        if (raw instanceof List<Object>) {
            for (Object entry : (List<Object>) raw) {
                if (offered >= GridFilters.MAX_USER_FILTERS) {
                    break;
                }
                Map<String, Object> f = asMap(entry);
                if (f == null) {
                    continue;
                }
                offered++;
                try {
                    GridFilters.userConditions(def, new List<Map<String, Object>>{ f });
                    filters.add(f);
                } catch (Exception e) {
                    notes.add(e.getMessage());
                }
            }
        }
        String logic = shown.get('logic') instanceof String ? (String) shown.get('logic') : null;
        if (String.isNotBlank(logic)) {
            if (filters.size() < offered) {
                notes.add('The view\'s filter logic was left out with the filter.');
                logic = null;
            } else {
                try {
                    GridFilterLogic.parse(logic, filters.size());
                } catch (Exception e) {
                    notes.add(e.getMessage());
                    logic = null;
                }
            }
        }
        out.put('filters', filters);
        out.put('logic', String.isBlank(logic) ? null : logic);
        out.put('notes', notes);
        return out;
    }

    // ------------------------------------------------------------ checks

    private static void requireName(String name) {
        if (String.isBlank(name)) {
            throw new GridException('Enter a view name.');
        }
        if (name.length() > MAX_NAME) {
            throw new GridException('A view name is ' + MAX_NAME + ' characters at most.');
        }
    }

    private static void requireUnique(List<Grid_View__c> own, String name, Id except) {
        for (Grid_View__c v : own) {
            if (v.Id != except && v.Name != null && v.Name.equalsIgnoreCase(name)) {
                throw new GridException('You already have a view named "' + name + '" of this grid.');
            }
        }
    }

    /** What a view keeps: a JSON object of a sensible size, whose filters and filter logic fit the grid. */
    private static void requireView(GridConfig.Definition def, String view) {
        if (String.isBlank(view)) {
            throw new GridException('There is no view to save.');
        }
        if (view.length() > MAX_LENGTH) {
            throw new GridException(
                'A view is ' + MAX_LENGTH + ' characters at most; this one is ' + view.length() + '.'
            );
        }
        Map<String, Object> kept = parsed(view);
        if (kept == null) {
            throw new GridException('A view must be a JSON object.');
        }
        Object raw = kept.get('filters');
        List<Map<String, Object>> filters = new List<Map<String, Object>>();
        if (raw != null && !(raw instanceof List<Object>)) {
            throw new GridException('A view\'s filters must be a list.');
        }
        for (Object entry : raw == null ? new List<Object>() : (List<Object>) raw) {
            if (!(entry instanceof Map<String, Object>)) {
                throw new GridException('A view\'s filters must be a list of filters.');
            }
            filters.add((Map<String, Object>) entry);
        }
        List<GridFilters.Condition> conditions = GridFilters.userConditions(def, filters);
        Object logic = kept.get('logic');
        if (logic != null && !(logic instanceof String)) {
            throw new GridException('A view\'s filter logic must be text.');
        }
        GridFilterLogic.parse((String) logic, conditions.size());
    }

    // ------------------------------------------------------------ records

    private static Boolean readable() {
        return GridSecurity.canRead(Grid_View__c.SObjectType) && GridSecurity.canRead(Grid_View__c.View__c);
    }

    /** A view of this grid this user can see, or a refusal. viewId comes from the browser (HR-6). */
    private static Grid_View__c visible(String grid, String viewId) {
        Id id = idOf(viewId);
        List<Grid_View__c> rows = readable()
            ? (List<Grid_View__c>) GridSecurity.query(
                  'SELECT Id, Name, OwnerId, Owner.Name, LastModifiedDate, View__c FROM Grid_View__c' +
                  ' WHERE Id = :id AND Grid__c = :grid LIMIT 1',
                  new Map<String, Object>{ 'id' => id, 'grid' => grid }
              )
            : new List<Grid_View__c>();
        if (rows.isEmpty()) {
            throw new GridException('This view was deleted, or is no longer shared with you.');
        }
        return rows[0];
    }

    /** One of this user's own views of this grid, or a refusal. */
    private static Grid_View__c owned(String grid, String viewId) {
        Grid_View__c r = visible(grid, viewId);
        if (r.OwnerId != UserInfo.getUserId()) {
            throw new GridException('Only the view\'s owner can change it. Clone it to make a view of your own.');
        }
        return r;
    }

    private static List<Grid_View__c> ownViews(String grid) {
        return (List<Grid_View__c>) GridSecurity.query(
            'SELECT Id, Name FROM Grid_View__c WHERE Grid__c = :grid AND OwnerId = :me LIMIT ' + (MAX_OWN_VIEWS + 1),
            new Map<String, Object>{ 'grid' => grid, 'me' => UserInfo.getUserId() }
        );
    }

    /** Of these views, other people's that are shared: those with a share row (which their viewers can read). */
    private static Set<Id> sharedOfOthers(List<Grid_View__c> rows) {
        Set<Id> others = new Set<Id>();
        for (Grid_View__c r : rows) {
            if (r.OwnerId != UserInfo.getUserId()) {
                others.add(r.Id);
            }
        }
        Set<Id> out = new Set<Id>();
        if (others.isEmpty()) {
            return out;
        }
        for (
            SObject s : GridSecurity.query(
                'SELECT ParentId FROM Grid_View__Share WHERE ParentId IN :ids AND RowCause = \'Manual\'',
                new Map<String, Object>{ 'ids' => others }
            )
        ) {
            out.add((Id) s.get('ParentId'));
        }
        return out;
    }

    public static View viewOf(Grid_View__c r, String view) {
        View v = new View();
        v.id = r.Id;
        v.name = r.Name;
        v.ownerName = r.Owner == null ? null : r.Owner.Name;
        v.mine = r.OwnerId == UserInfo.getUserId();
        v.lastModified = r.LastModifiedDate;
        v.view = view;
        return v;
    }

    private static Id idOf(String viewId) {
        try {
            Id id = Id.valueOf(viewId.trim());
            if (id.getSObjectType() == Grid_View__c.SObjectType) {
                return id;
            }
        } catch (Exception e) {
            // Not an Id at all: refused below, the same way.
        }
        throw new GridException('This view was deleted, or is no longer shared with you.');
    }

    private static String firstError(List<Database.Error> errors) {
        return errors.isEmpty() ? 'The view could not be saved.' : errors[0].getMessage();
    }

    private static Map<String, Object> parsed(String text) {
        if (String.isBlank(text)) {
            return null;
        }
        try {
            return asMap(JSON.deserializeUntyped(text));
        } catch (Exception e) {
            return null;
        }
    }

    private static Map<String, Object> asMap(Object value) {
        return value instanceof Map<String, Object> ? (Map<String, Object>) value : null;
    }
}
