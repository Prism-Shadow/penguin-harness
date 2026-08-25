# Each sidebar group counts its own hidden chats, and the groups paginate

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#461](https://github.com/Prism-Shadow/penguin-harness/pull/461)

[中文版](2026-08-25-sidebar-group-paging.zh.md)

The chat sidebar's grouped list gains a reveal row that speaks for its own group, a way to fold a
revealed group back, and real pagination over the groups themselves.

## Details

- **Each Workspace group pages its own server stream.** The list is fetched per Agent, and the
  sidebar groups it by Workspace, so one cursor used to feed every group: the first page filled
  them unevenly — whichever group owned the newest rows got most of it — and one group's "more"
  consumed the page its siblings were about to read. Their rows appeared untouched, their counts
  moved, and the group that asked could grow by less than a page, or by nothing. The list endpoint
  takes a `workspaceGroup` filter (applied before paging, like `category`), each group carries its
  own cursor, and every rendered group opens on its own first page.
- A group's reveal row reads **Show N more chats** instead of a bare "More", where N is that
  group's own hidden conversations: its exact server share minus the rows on screen. Nothing about
  another group reaches the count.
- Once every Agent that could hold one of the group's rows has been fetched out, the loaded rows
  *are* the group's share. The stored totals refresh only on reload, so a count that drifted above
  reality used to leave a row that revealed nothing; it now disappears with the last hidden row.
- One click reveals one page more, and fetches the next page of that group's stream only when the
  reveal runs past what is already loaded.
- Sessions created without an explicit Workspace get a single-use temporary directory each, and the
  sidebar has always merged those into one group; the server names that group `temp` so it pages
  like any other.
- A group's first scoped fetch starts at the rows it already holds, not at offset 0: those arrived
  on pages of the Agent's whole stream, and a prefix of that stream cut by Workspace is a prefix of
  the group's own — so the click reads new rows instead of re-reading the ones on screen.
- A **Show less** row folds a revealed group back to its first page. Rows already fetched stay in
  memory, so revealing them again costs no request.
- The collapsed folders inside a group — Subagents, Scheduled, Archived — label their own reveal row
  the same way, counted off each folder's own share.
- The groups themselves now paginate: at most ten per page, stepped by a `‹ 1/3 ›` pager below the
  list, replacing the row that revealed ten groups more. The window remains a display concern — no
  group's data loading depends on the page it sits on.
- Searching bypasses the pagination entirely, as it already bypassed the old cap: a match on page 3
  would read as no match at all.
- The manual group order still commits over the full group sequence rather than the page on screen,
  so a drag on page 2 cannot drop the groups that are not rendered.
- Adding a Workspace turns to the page that now holds it. An empty registered group is appended and
  nothing pins or orders it yet, so past ten groups the new Workspace would otherwise land on a page
  the user is not looking at and the click would read as a no-op.
- Time mode has at most three buckets — last day / last month / earlier — so it does not paginate.
- A Project switch or a grouping-mode switch clears the per-group reveal state: a cap keyed by an
  Agent id means nothing to a Workspace group, and the other Project's groups are gone.
- The Traces page's group tree is unaffected; this changes the chat sidebar only.
