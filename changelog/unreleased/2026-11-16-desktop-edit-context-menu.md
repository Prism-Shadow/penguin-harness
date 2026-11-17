# Desktop: a right-click edit menu in the app's windows

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1567](https://github.com/Prism-Shadow/penguin-harness/pull/1567)
- **Issue:** [#1522](https://github.com/Prism-Shadow/penguin-harness/issues/1522)

[中文版](2026-11-16-desktop-edit-context-menu.zh.md)

The desktop app's main window and every window it opens gained a native right-click menu: Cut, Copy, Paste and Select all in a text field (only the entries the field allows), Copy over selected text elsewhere, and no menu anywhere else. Before, Electron showed nothing at all. The labels follow the Web App's language.

## Details

- A right-click the page handles itself (the conversation's selection menu, the Files panel, the terminal) still opens only the page's menu.
- Paste runs the field's own paste handling, so an image or a long text pasted into the composer behaves as with the keyboard shortcut.
- The built-in browser's right-click menu takes its edit entries from the same place and is unchanged.
