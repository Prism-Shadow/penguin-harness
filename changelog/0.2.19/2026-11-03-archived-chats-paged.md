# Archived chats pages each group's rows, ten per page

- **Date:** 2026-11-03
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1426](https://github.com/Prism-Shadow/penguin-harness/pull/1426)

[中文版](2026-11-03-archived-chats-paged.zh.md)

On Settings › Archived chats, each Project / Workspace group now shows its rows one page of ten at a time. The group's "Show N more chats" and "Show less" rows were replaced by the shared `Pager` (previous, `k/N`, next), which appears once a group has more than one page. The groups themselves are unchanged, and so is "More groups", which still adds twenty groups at a time.

## Details

- A page not read yet is fetched below the previous page's last row through the existing `before` cursor of `GET /api/me/archived-sessions`. While it loads, the rows on screen stay and the pager is disabled. A page already read opens with no request.
- A refresh, after an action or on a live event, reads each group again as far as it was paged and keeps it on its page. If an unarchive or delete leaves the page shown with no rows, the group steps back to the last page that still has rows. The page count follows the group's count.
- Rows ticked on different pages stay ticked when the page changes. Select all still chooses the whole group, including pages not read yet. A new search or filter puts every group back on its first page.
- Reads of one group run one after another, so a page turned during a refresh continues below what the refresh brought.
- The paging logic lives in `features/settings/archived-sessions-paging.ts`.
- On a phone, the Settings dialog (`PagedDialog`) scrolls a long page inside its bottom sheet again. The page column had grown past the sheet, so the bottom of the archive list was out of reach, and that included the old "show more" row and the pager.
