# An opened app fills its pane, with no bar above it

- **Date:** 2026-11-25
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1871](https://github.com/Prism-Shadow/penguin-harness/pull/1871)

[中文版](2026-11-25-workbench-no-toolbar.zh.md)

Removed the row with the More button that sat above an opened workbench, in the App Center window, beside a conversation and on the full page. The app starts at the top edge of its pane. A workbench with several pages kept its page switch above the content.

## Details

- Moved **Reload**, **Version history**, **Download ZIP** and **Remove workbench** into the menu of the app's row in the sidebar's Apps group, in a group of their own under the window actions. The Agent's settings kept the same actions on each workbench row.
- On the full page and in full screen, where no sidebar is shown, the command palette offered reload, version history and the download for the app on screen.
- A workbench that is listed but has no page to draw showed its load error in the pane with a **Reload** button.
