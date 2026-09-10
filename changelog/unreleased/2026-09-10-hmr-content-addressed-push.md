# A push carries only the blobs the target lacks, and unreferenced blobs are collected

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `hmr`, `server`, `tooling`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

A hot push used to carry every native asset inline on every push, whether or not the target already held it. Assets are content-addressed on the target now, and a pusher sends only what the target is missing.

## A push carries only what the target lacks

`store/blobs/<sha256>` holds each distinct file once, and a materialized assets directory is assembled from those blobs and records which it used (`.manifest.json`). Before pushing, `scripts/deploy.mjs` asks `POST /api/hmr/assets/probe { hashes }` which blobs the target is missing and sends only those, naming the rest by hash (`assets.manifest` + `assets.blobs`). The probe is the mechanism's, like the push: `HMR_PROBE_PATH` and `probeEndpoint` live in `packages/hmr`, and the platform's route hands the request to the control object. A manifest naming a blob the store does not hold is refused with a message, never materialized as a hole. A target without the probe — a generation older than this — answers 404 and gets every file inline, exactly the push it always received. Unchanged native modules and skills therefore never cross the wire twice.

## Unused assets are collected

The store already kept the current and one rollback assets set; blobs are now swept after that: any blob no remaining set records is removed, along with half-written temporaries. A set materialized before records existed keeps nothing alive through the blob store and is itself untouched.
