# An unknown organization address opens its overview instead of growing `/overview`

- **Date:** 2026-10-21
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1267](https://github.com/Prism-Shadow/penguin-harness/pull/1267)

[中文版](2026-10-21-org-fallback-absolute.zh.md)

An address under an organization that no page claims — an old link, a bookmark, a typo — was sent to the overview by a relative redirect, so that segment was appended to the address that had already failed to match: `/org/<projectId>/<orgId>/notes` became `/org/<projectId>/<orgId>/notes/overview`, the layout remounted, and every pass added another `/overview` while the screen drew nothing. The fallback now builds `/org/<projectId>/<orgId>/overview` from the route's own ids, so the address the reader ends on is the overview's own and the layout is mounted once.

## Details

- The organization layout's catch-all reads `projectId` and `orgId` from the route and navigates to an absolute `orgPagePath(projectId, orgId, "overview")`.
- The organization layout's index redirect stays relative — an index route rightly opens the page beneath it — and so does the app-wide `/chat` fallback for addresses the app does not serve.
