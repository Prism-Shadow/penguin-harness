# A workbench tab no longer shows the bottom dock's resize line through its page

- **Date:** 2026-10-28
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1379](https://github.com/Prism-Shadow/penguin-harness/pull/1379)

[中文版](2026-10-28-workbench-tab-covers-dock.zh.md)

With the bottom dock open, a workbench tab showed the dock's resize line through its page: where the dock's top edge lay under the page, moving the pointer lit up a horizontal line across it, turned the cursor into the resize cursor and showed the "Resize panel" hint, and a press there resized the hidden dock instead of reaching the page. A dock in full screen lay over the page whole. While a workbench tab is shown, the toolbar and everything under it now stay mounted but are not drawn and take no pointer, so only the page shows below the tab strip; the Chat tab brings them back as they were.
