# Keep error notices read after restarting

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1118](https://github.com/Prism-Shadow/penguin-harness/pull/1118)

[中文版](2026-10-14-error-read-status.zh.md)

Refreshed the unexpected-error notice when loading the Cost Center, so marking errors as read
also covers errors that arrived after the app opened. Those errors stay read after restarting;
later errors still raise the notice.

Read markers now hide a notice only after saving succeeds. Failed saves show an error and leave
the action available to retry. Consecutive dismissals save in order so an earlier request cannot
overwrite a later marker.
