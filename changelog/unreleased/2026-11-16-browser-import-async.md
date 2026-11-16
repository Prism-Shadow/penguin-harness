# Server: browser imports no longer block concurrent requests

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1565](https://github.com/Prism-Shadow/penguin-harness/pull/1565)
- **Issue:** [#1437](https://github.com/Prism-Shadow/penguin-harness/issues/1437)

[中文版](2026-11-16-browser-import-async.zh.md)

Browser import source discovery and Chromium key loading now use asynchronous filesystem operations. A slow or blocking browser profile can no longer stall request handling while an import is being prepared, so unrelated API calls such as loading settings remain responsive. Profile ordering, display names, newest-copy selection, and import errors are unchanged.
