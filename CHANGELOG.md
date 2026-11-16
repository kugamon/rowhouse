# Changelog

Each release is a version of the Rowhouse Grid managed package (namespace
`rowhouse`). Install or upgrade from its links; an upgrade keeps your grids.

## 1.5 — Winter 2027 (16 November 2026)

The version to install. It upgrades 1.0, 1.1, 1.2, 1.3 or 1.4 in place and
keeps your grids, layouts and saved views.

- **Package version:** 1.5.0.3, ID `04tUK000000VNI5YAO`
- **Install:**
  [production or Developer Edition](https://login.salesforce.com/packaging/installPackage.apexp?p0=04tUK000000VNI5YAO)
  ·
  [sandbox](https://test.salesforce.com/packaging/installPackage.apexp?p0=04tUK000000VNI5YAO)
  · `sf package install --package 04tUK000000VNI5YAO --target-org <your org> --wait 20`

- **A default sort of up to five columns.** The Grid Admin tab's Columns tab
  says the order the grid opens in, over the columns ("Opens sorted by Stage
  (ascending), then Last Modified Date (descending)"), and **Edit sort** opens
  a Sort dialog: Sort by, then up to four Then by rows, each Ascending or
  Descending, with arrows to reorder and Add sort. Sort by can be any field
  the grid can sort by, a column or not; the Then by rows are the grid's
  sortable columns. Each sorted column shows its place beside its Sort box
  (1 ↑, 2 ↓). In Setup, Default Sort Field and Default Sort Direction stay the
  first level and a new field, **Then Sort By**, holds the rest
  (`LastModifiedDate DESC, CloseDate ASC`). Asked for in issue #16.
- **Everyone follows the default until they sort.** Users who have not sorted
  a grid get the whole default sort, new users included, and any later change
  to it. A user's own sort is kept until Reset layout, which brings the
  default back. Salesforce orders the rows by every level, so the order holds
  past the first 10,000 rows. A level on a field a user can't read is left out
  for that user.
- **A new grid starts sorted** by the name column it starts with, A to Z.
- **The toolbar folds into List actions** wherever its buttons don't all fit
  across the grid, such as a narrow column of a record page, not only on a
  phone. The search and View Controls stay beside it.
- **The Grid Guide beside the grid editor** covers every setting on each tab:
  Sort, Width, Field, Frozen columns, Delete selected rows, Log every change,
  a filter's Label, an action's Runs, Input and Asks first, a child table's
  Tab label, and what still applies under a saved view.
- **Fixed:** the Grid Admin tab could read "Rowhouse 0.0" instead of the
  installed version. It now reads the version installed in the org, and
  without one still offers Check for a newer version.

## 1.4 — Winter 2027 (27 October 2026)

Package version 1.4.0.2. Replaced by 1.5: install 1.5 instead.

- **Saved views, as list views have them.** The grid's title is a view
  picker: Recent Views, All Other Views and a search. **View Controls** (a
  gear with ▾ beside the search) has New, Clone, Rename, Sharing Settings,
  Select Fields to Display, Delete, Reset Column Sorting and Reset Column
  Widths. A view keeps its columns and their order, frozen columns, grouping,
  filters and filter logic, the sort it opens with, and its chart. Change one
  and a bar says what changed, with **Save**, **Save As** and **Revert**. Pin
  the view the grid opens on for you. Widths, Wrap or Clip and open rows stay
  your own on every view.
- **Sharing a view** with all users, roles or public groups goes through
  Salesforce's own sharing and needs the **Manage Public List Views**
  permission, as sharing a list view does. A view shared with you says who
  shared it; you can use it and save a copy, not change it. Views are for a
  grid on its own, not a tab of related records.
- **The Filters panel and OR.** The funnel opens a panel with your admin's
  filters, locked, and yours, numbered. A column can have more than one
  filter, and **Add Filter Logic** joins them with AND, OR, NOT and
  parentheses, such as `1 AND (2 OR 3)`. Your admin's filters still apply to
  every record.
- **The Grid Admin tab's Views tab** lists every saved view of a grid, private
  ones too, with its owner, who sees it and when it last changed, and lets an
  admin delete one.
- **Permission sets:** Rowhouse Grid User now lets people save views of their
  own; Rowhouse Grid Admin also gives View All and Modify All on Grid View, the
  new object that holds them. Nothing to set up after upgrading.
- **Reset layout** shows only on the grid as your admin built it; your views
  and your pin stay.
- **Grid Guide:** the pipeline review tutorial saves, shares and pins a view,
  and Troubleshooting covers sharing and views.

## 1.3 — Winter 2027 (26 October 2026)

Package version 1.3.0.1. Replaced by 1.4: install 1.4 instead.

- **Check for a newer version.** Under the Grid Admin tab's name, the version
  of Rowhouse installed in the org and a link that opens rowhouse.app's What's
  new with that version, which says whether a newer one is out. Rowhouse makes
  no call outside the org: the version is read from the org, and only the
  admin's click leaves it.
- **Fixed:** a grid could take another grid's filters, actions, display rules,
  columns or child tables when the two grids' Salesforce Ids differed only in
  upper and lower case. Ids are now compared exactly. (Reported in issue #12.)

## 1.2 — Winter 2027 (19 October 2026)

Package version 1.2.0.2. Replaced by 1.3: install 1.3 instead.

- **Charts, as a list view's.** The gear beside the chart's title is a menu:
  **Display as** draws the chart another way at once, then **Edit chart**.
  Two new chart types, **Stacked vertical bar** and **Stacked horizontal
  bar**, stack a second column's groups within each bar (**Stack by**; counts
  and sums). Pointing at a bar, a stack or a slice shows its figure and its
  share of the total, and **Show as a table** adds the share. The chart fills
  the panel.
- **Fixed:** when a request to keep a layout change failed, the next opening
  brought back that change, not the ones made after it.
- **Unsaved changes are no longer lost without a question:** while there are
  any, reloading or closing the page asks first, in the browser's own words.
- **Resizing a column from the keyboard** moves it 10 pixels a press, as a
  list view does (it moved 1).
- **Fixed:** Frozen Columns above 5 set in Setup froze them all, leaving the
  columns after them out of reach; the grid now freezes 5. A Page Size above
  2,000 loads 2,000, and 0 or less the default, 200. The Grid Admin tab warns
  about both.
- **Fixed:** a Log Retention of 0 or less set in Setup would have deleted every
  edit log entry; it now keeps them forever, as blank does. A period set in
  Setup that the Settings page does not offer now shows in its box.
- **Export, as Salesforce exports a report.** Export opens a dialog with the
  same two views. **Formatted Report** is an Excel workbook (.xlsx) of the
  grid as it looks, under the report's header (the grid's name; As of,
  Generated by and Sorted by; Filtered By and each filter) and above its
  footer ("Confidential Information - Do Not Distribute", "Made with Rowhouse
  Grid by Kugamon"): numbers, amounts,
  percents and dates with their formats, the columns you see at their widths,
  frozen and wrapped columns, display rules' fills, text colors and bold, and,
  in a grouped grid, a heading and a subtotal row for each group and a Total
  row, as formulas Excel's outline folds. **Details Only** is each row without
  formatting, as an Excel workbook or a CSV (UTF-8), the record Id first.
  Lookups are written as their record's name and picklists as their labels.
  Every matching record is exported, up to 100,000: the rows not yet loaded
  load first. The Grid Configuration setting is now labelled **Allow Export**.
- **Require Export Reports Permission**, a new grid setting: Export shows only
  for users with Salesforce's Export Reports permission.
- **Import** looks up any number of record names in a lookup column, 200 at a
  time, so a Details Only file with names comes back in.
- **Import** reads a number Excel shows as a percent (12.5% is 0.125 in the
  file) into a percent field as 12.5.
- **Fixed:** a layout change (a hidden column, a new sort) made just before
  the page was reloaded or closed was lost. It is now kept as the page goes,
  and held in the browser until Salesforce has it.

## 1.1 — Winter 2027 (15 October 2026)

Package version 1.1.0.1, the first under the GNU Affero General Public License
v3.0 (AGPL-3.0); see NOTICE. Replaced by 1.3: install 1.3 instead.

## 1.0 — Winter 2027 (15 October 2026)

The first release, package version 1.0.0.2. Replaced by 1.3: install 1.3
instead.

What it includes is in the README's [What it does](README.md#what-it-does):
inline editing with every common field type, spreadsheet keys, undo and redo;
sort, search, filters, grouping with subtotals, charts and child tables;
formula columns and display rules; bulk update and delete, CSV and Excel
import and CSV export; flow and quick actions; each user's own layout; the
Grid Admin tab, an optional audit trail and the Grid Guide; Lightning Web
Security and Lightning Locker; up to 100,000 rows.

Not yet: an AppExchange listing (it follows Salesforce's security review), so
upgrades are installed from each version's link rather than pushed.
