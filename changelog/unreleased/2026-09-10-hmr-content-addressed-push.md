# A push names its parts by hash, uploads only the blobs the target lacks, and unreferenced blobs are collected

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `hmr`, `server`, `tooling`
- **PR:** [#656](https://github.com/Prism-Shadow/penguin-harness/pull/656)

A hot push used to carry every part inline on every push — both bundles, the whole web dist, every native asset — base64 inside one gzip JSON body, whether or not the target already held it. The store is content-addressed now and a push works the way `git push` does: ask what the target lacks, upload only that, then name everything by hash.

## Blobs are uploaded one at a time, raw

`store/blobs/<sha256>` holds each distinct file once. `PUT /api/hmr/blobs/<sha256>` takes one blob as a raw body and stores it only if the bytes hash to the name. `POST /api/hmr/assets/probe { hashes }` answers which blobs the target is missing. Both are the mechanism's, like the push: `HMR_PROBE_PATH`, `HMR_BLOBS_PATH`, `probeEndpoint` and `blobEndpoint` live in `packages/hmr`, and the platform's routes hand the request to the control object.

## A push names its parts by hash

The push body keeps its one shape, and every content value in it — `platform`, `cli`, each `web.files` entry, each `assets.files` entry — may be `{ sha }` instead of inline content. The upgrade resolves those from the store before anything boots; a name the store does not hold is refused with the hash and what to do, never materialized as a hole. `scripts/deploy.mjs` probes, uploads the missing blobs, and pushes a body of names, so a push carries only what changed since the last one: with vite's content-hashed chunks, a one-line web change sends one chunk. A materialized assets directory records which blobs it used (`.manifest.json`). A target without the probe — a generation older than this — answers 404 and gets every part inline, exactly the push it always received.

## Unused assets are collected

The store already kept the current and one rollback assets set; blobs are now swept after that: any blob no remaining set records is removed, along with half-written temporaries. A set materialized before records existed keeps nothing alive through the blob store and is itself untouched.
