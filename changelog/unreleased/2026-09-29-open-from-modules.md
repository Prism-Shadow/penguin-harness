# Open products from the modules in place

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `web`, `activities`

**Open from modules** on the activities page lists the products in the WAF workspace's modules that no project has open, such as ones Loom authored under `generated/`. Opening one makes the project its owner and indexes its refs where they are; nothing is copied.

- **What Penguin writes:** each Loom-authored ref gets Penguin's files beside Loom's. Loom's specification is used as it is, with an old module-folder spelling repaired. The media plan is made from that specification, and Loom's bindings (paths, scripts, word timings, playback, book words) are carried onto it.
- **What Penguin keeps:** Loom's specification and manifest are kept as `activity_spec.loom.json` and `asset_manifest.loom.json`. The dialog shows what was repaired and what could not be carried.
- **Stability:** a ref is stable when it is the canonical one and Loom's product-level `templateStable` is set. Loom's ref-level copy of that flag is stale and is not read.
- **One owner:** a product another project owns is neither listed nor claimable (409 `product_taken`), and opening one twice is refused (409 `product_open`).
- **Previously owned products:** a product this project owned before its index was lost is listed again. Opening it reuses its refs' ids and drafts.
- **Routes:** `GET .../activities/module-products` for any member; `POST .../activities/module-products/claim` for the owner only.

A read-only trial against the local checkout's 19 Loom products (39 refs) accepted 37 of the refs' specifications. The most common things that could not be carried were Loom's per-asset recorded voice, and word timings that no longer match their script.
