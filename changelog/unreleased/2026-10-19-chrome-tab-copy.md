# The Chrome extension no longer says your cookies go unused

- **Date:** 2026-10-19
- **Type:** fix
- **Scope:** `browser-extension`, `docs`
- **PR:** [#1213](https://github.com/Prism-Shadow/penguin-harness/pull/1213)

[中文版](2026-10-19-chrome-tab-copy.zh.md)

The extension's pairing page said Chrome's cookie store stays out of reach, which read as if the tabs an agent drives ran without your sign-ins. It now says those tabs keep your sign-ins, and that agents cannot see your other tabs or browsing history, or read and change Chrome's cookies directly. The "Use your own Chrome" docs section words the same limit the same way.

## Details

- In Chinese, the extension's description, pairing page and popup, and the zh docs page on the browser, say 操作 instead of 驱动 for what an agent does in a tab. The zh heading 在命令行中驱动 is now 在命令行中操作, and its anchor changed with it.
