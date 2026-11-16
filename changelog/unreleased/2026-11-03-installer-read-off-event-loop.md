# Installing a machine no longer parks the server while it reads the install files

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1492](https://github.com/Prism-Shadow/penguin-harness/pull/1492)
- **Issue:** [#1435](https://github.com/Prism-Shadow/penguin-harness/issues/1435)

[中文版](2026-11-03-installer-read-off-event-loop.zh.md)

A machine install read two files synchronously on its request path: the installer script, and, for a machine that cannot reach GitHub or the release mirror, the release package this server fetched to send over ssh (tens of megabytes). Both reads went through `fs.promises.readFile`, so the server kept answering other requests while an install was being prepared. A missing or unreadable installer still ended the install at the `prepare the installer` step with the filesystem's own message.
