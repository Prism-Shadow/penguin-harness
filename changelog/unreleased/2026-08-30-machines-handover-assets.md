# Handing a build to a machine carries its native assets

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `server`
- **PR:** [#549](https://github.com/Prism-Shadow/penguin-harness/pull/549)

[中文版](2026-08-30-machines-handover-assets.zh.md)

Connecting to a machine hands it this server's hot-pushed build over the machine's own update channel. The body carried the platform, CLI and web artifacts and dropped the native assets — so a machine that received a build this way ran a platform that could resolve `node-pty` against nothing, and every terminal opened on it failed with `node-pty is unavailable to the platform … no assets directory available`, while the same build pushed directly by `deploy.mjs` worked.

## Details

- The hand-over body now re-packs the materialized assets directory as it was pushed — every file, exec bits from the files' modes — together with the recorded provenance (`source`), so what a machine receives from a connect and what it receives from a direct push are the same version.
- A build that was pushed without assets is still handed on as before.
