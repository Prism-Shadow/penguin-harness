# The builtin plugins ship with every build, and a push carries only what the target lacks

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `desktop`, `tooling`

[中文版](2026-09-01-builtin-plugins.zh.md)

The plugins this repository builds — the sandbox backends and the language floor under `plugins/` — are now part of what a deployment gets, rather than packages it would have to fetch: a hot push carries them, the desktop build stages them, and the server loads them without their being listed.

## Packed once, by content

`scripts/build-plugins.mjs` bundles each `plugins/*` self-contained (esbuild, dependencies inlined; only the SDK's type-only surface stays external) into the shape of an npm prefix — `plugins/package.json` plus `plugins/node_modules/<name>/{index.js,package.json,README.md}` — which is the one layout every consumer resolves from. The bundle is cached under `node_modules/.cache/penguin-plugins/` by the hash of the plugin's sources, manifest and README, so a push that touched nothing there packs nothing again. A plugin that could not bundle would be reported and left out, never shipped broken.

## Where they land, and how they load

A hot push ships the prefix among its assets (`plugins/…`); the desktop build stages it beside `skills/` (`scripts/build-assets.mjs`, `electron-builder.yml`). The loader resolves plugins from, in order: `<root>/plugins` (what the Plugins page installs), the committed push's `plugins/` (read from `harness.json`, no host needed), the installation's `plugins/`, and the installation entry. **Shipping one is not installing it.** `builtin` is a tag on where a package came from, never a second way of being installed: a plugin the build carries appears in the catalogue marked *built in* — installing it copies nothing over the network — and it is installed, loaded and removed exactly like any other, by an operator listing it in `plugins.json`. Installing a shipped plugin therefore runs no npm; it is a list edit. The installed view reports the shipped set separately from what is installed, so a row can carry the tag without implying consent nobody gave.

Loading is the runtime's, once per process: a push that carries newer builtins takes effect at the next start, like every other plugin change.

## A push carries only what the target lacks

Assets are content-addressed on the target now: `store/blobs/<sha256>` holds each distinct file once, and a materialized assets directory is assembled from those blobs and records which it used (`.manifest.json`). Before pushing, `scripts/deploy.mjs` asks `POST /api/hmr/assets/probe { hashes }` which blobs the target is missing and sends only those, naming the rest by hash (`assets.manifest` + `assets.blobs`). A manifest naming a blob the store does not hold is refused with a message, never materialized as a hole. A target without the probe — a runtime older than this — answers 404 and gets every file inline, exactly the push it always received. Unchanged native modules, skills and plugins therefore never cross the wire twice.

## Unused assets are collected

The store already kept the current and one rollback assets set; blobs are now swept after that: any blob no remaining set records is removed, along with half-written temporaries. A set materialized before records existed keeps nothing alive through the blob store and is itself untouched.
