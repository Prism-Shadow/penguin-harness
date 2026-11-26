# Workbenches load again in the desktop app

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `desktop`, `workbenches`

[中文版](2026-11-26-desktop-node-types.zh.md)

- The packed desktop app now carries the declarations of `@types/node` and `undici-types` as extra resources, so electron-builder's `*.d.ts` exclusion no longer leaves a manifest with nothing behind it.
- The server takes a `@types/node` only when its entry declarations are present, passing over a stripped copy like a compiler without its default libraries; with no complete copy a workbench that does not import `node:` still loads.
- `verify-packed-cli.mjs` fails when the packed app lacks those declarations.
