# The builtin plugins ship with every build, and a push carries only what the target lacks

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `desktop`, `tooling`
- **PR:** [#383](https://github.com/Prism-Shadow/penguin-harness/pull/383)

[中文版](2026-09-01-builtin-plugins.zh.md)

The plugins this repository builds — the sandbox backends and the language floor under `plugins/` — are now part of what a deployment gets, rather than packages it would have to fetch: a hot push carries them, the desktop build stages them, and the server loads them without their being listed.

## Shipped as the npm packages they are

`scripts/build-plugins.mjs` takes every `plugins/*` package that declares `penguin`, runs the package's own `build`, packs it with `pnpm pack` — exactly what `npm publish` would send, `files` honored — and installs the tarballs with `npm install` into a staging directory laid out as an npm prefix: `plugins/package.json` plus `plugins/node_modules/<name>/…`, each package's dependencies beside it the way npm installs them anywhere. Nothing about a package is rewritten: its `package.json`, its `exports`, its `dist/` and its `README.md` reach the target as its own build produced them. The SDK is not among the installed dependencies — a plugin compiles against `@prismshadow/penguin-core`'s types and shares the host's copy at run time. The staged prefix is cached under `node_modules/.cache/penguin-plugins/` by the hash of every plugin's sources, manifest, README and build config, so a push that touched nothing there builds, packs and installs nothing again; the registry is needed the first time only, for the dependencies.

## Where they land, and how they load

A hot push ships the prefix among its assets (`plugins/…`); the desktop build stages it beside `skills/` (`scripts/build-assets.mjs`, `electron-builder.yml`). The loader resolves plugins from, in order: `<root>/plugins` (the data root's own prefix), the committed push's `plugins/` (read from `harness.json`, no host needed), the installation's `plugins/`, and the installation entry — looking a package up the way Node does (`node_modules` upward from the base) and reading the entry an importer would, its `exports` import condition or `main`. A plugin's readme is served from the same package: the `README.md` npm shipped with it, read on request, so the catalogue holds no copy of the prose. **Shipping one is not installing it.** `builtin` is a tag on where a package came from, never a second way of being installed: a plugin the build carries appears in the catalogue marked *built in* — installing it copies nothing over the network — and it is installed, loaded and removed exactly like any other, by an operator listing it in `plugins.json`. Installing a shipped plugin therefore runs no npm; it is a list edit. The installed view reports the shipped set separately from what is installed, so a row can carry the tag without implying consent nobody gave.

Loading is the runtime's, once per process: a push that carries newer builtins takes effect at the next start, like every other plugin change.
