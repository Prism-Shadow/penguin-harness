# Memory files keep one order whatever locale the server runs under

- **Date:** 2026-09-04
- **Type:** fix
- **Scope:** `server`

[中文版](2026-09-04-memory-file-order-locale.zh.md)

The Memory service sorted a scope's topic files with `String.localeCompare` called without a locale argument, so the order followed the locale of the server process: a scope holding `testing-conventions.md` and `项目背景.md` listed them in that order on an `en_US.UTF-8` host and reversed on a `zh_CN.UTF-8` one. That order is what the Memory file list shows and what the `files` array of an exported scope document carries, so the same scope exported to two different hosts produced two different documents. The comparator now folds case and breaks ties on code units — total, identical on every host, and reproducing the order `en_US.UTF-8` already produced, so existing exports do not reorder.
