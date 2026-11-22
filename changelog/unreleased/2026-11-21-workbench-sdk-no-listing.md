# A workbench page's SDK no longer waits for the Agent's other workbenches

- **Date:** 2026-11-21
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1681](https://github.com/Prism-Shadow/penguin-harness/pull/1681)

[中文版](2026-11-21-workbench-sdk-no-listing.zh.md)

A workbench page loads its SDK (`sdk/amsp.js`, `sdk/workbench.js`) as soon as it opens. The server used to answer only after loading every workbench of the Agent. Now it checks that the page's own workbench exists and is switched on, and loads nothing else. An app opened straight from the App Center no longer waits while the Agent's other workbenches compile.
