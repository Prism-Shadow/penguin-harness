# Workbench pages load the AMSP page SDK from their own server

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`, `amsp`
- **PR:** [#1347](https://github.com/Prism-Shadow/penguin-harness/pull/1347)

[中文版](2026-10-26-workbench-page-sdk.zh.md)

The server began serving a page SDK beside every workbench, so a workbench page can follow the Agent's conversation live over the signed-in Session stream and stop a running Task.

## Details

- `GET /api/projects/:projectId/agents/:agentId/workbenches/:id/sdk/amsp.js` serves the browser build of `@prismshadow/amsp` byte for byte. `…/sdk/workbench.js` re-exports it and adds `apiBase`, `transport`, `followSession(id, { tailLimit? })` and `abortSession(id)`. A page imports `../sdk/workbench.js`; the same relative path works for a workbench on a machine (`/server/<machineId>/api/…`) and under `pnpm dev`.
- Both answer `text/javascript` with `cache-control: no-cache` and an ETag, only to members of the Project, and 404 for an unknown Project or workbench.
- `@prismshadow/amsp` gained the `@prismshadow/amsp/browser-source` export, the browser build as the string `BROWSER_SOURCE`. The server imports it, so the desktop app and hot-pushed builds, which run the server bundled without `node_modules`, carry the SDK too.
