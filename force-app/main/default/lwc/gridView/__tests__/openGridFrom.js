/**
 * openGrid, answered from the calls it replaced: getGridConfig for the
 * configuration, getLayout for the layout and fetchRows for the first page,
 * each asked exactly as the grid used to ask them. So the suites written
 * against those calls keep their mocks and their assertions on those calls, and test
 * what they were written to test; gridView.open.test.js tests openGrid itself.
 *
 * The first page is sorted and grouped as the grid reads the layout, which is
 * what the server does (GridLayouts.startOf, tested in Apex), and `start` says
 * so in the server's terms.
 *
 *   openGrid.mockImplementation(openGridFrom({ getGridConfig, getLayout, fetchRows }));
 */
import { readLayout, messageOf } from 'c/gridView';
import { normalizeGrouping, levelParam } from 'c/gridGroups';

export function openGridFrom({ getGridConfig, getLayout, fetchRows }) {
    return async ({ configName, searchTerm = null, parentLink = null, parentId = null, recordId = null }) => {
        const nested = Boolean(parentLink);
        const [config, layout] = await Promise.all([
            getGridConfig({ configName }),
            !getLayout
                ? { json: null }
                : Promise.resolve(getLayout(nested ? { configName, parentLink } : { configName })).then(
                      json => ({ json: typeof json === 'string' && json ? json : null }),
                      error => ({ json: null, error: messageOf(error) })
                  )
        ]);
        const d = config.definition;
        const saved = readLayout(layout.json, d.columns);
        const adminSort = d.sortField
            ? [
                  { field: d.sortField, direction: d.sortDirection === 'desc' ? 'desc' : 'asc' },
                  ...(d.thenSort || []).map(k => ({
                      field: k.field,
                      direction: k.direction === 'desc' ? 'desc' : 'asc'
                  }))
              ]
            : [];
        const sort = saved && saved.sort ? saved.sort : adminSort;
        const grouping = saved && saved.grouping ? saved.grouping : normalizeGrouping(d.grouping, d.columns);
        const primary = sort[0];
        const sortField = primary ? primary.field : d.sortField || null;
        const start = {
            sortField,
            sortDirection: primary
                ? primary.direction
                : sortField
                  ? d.sortDirection === 'desc'
                      ? 'desc'
                      : 'asc'
                  : null,
            // The sorts after the first, the user's or else the admin's, five in all at most.
            thenSort: (primary ? sort : adminSort).slice(1, 5),
            groupBy: grouping.map(levelParam)
        };
        const answer = { ...config, layout: layout.json, start };
        if (layout.error) answer.layoutError = layout.error;
        try {
            answer.page = await fetchRows({
                configName,
                searchTerm,
                sortField: primary ? primary.field : null,
                sortDirection: primary ? primary.direction : null,
                thenSort: primary && sort.length > 1 ? sort.slice(1, 5) : undefined,
                groupBy: grouping.length ? grouping.map(levelParam) : undefined,
                ...(nested ? { parentLink, parentId } : {}),
                filters: null,
                recordId: nested ? null : recordId || null,
                cursorLocator: null,
                cursorToken: null,
                pageSize: null
            });
        } catch (e) {
            answer.pageError = messageOf(e);
        }
        return answer;
    };
}
