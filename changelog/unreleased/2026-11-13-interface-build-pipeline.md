# Reduce interface generation work

- **Date:** 2026-11-13
- **Type:** fix
- **Scope:** `core`, `server`, `web`, `cli`, `tooling`

[中文版](2026-11-13-interface-build-pipeline.zh.md)

Interface generation now uses one compiler graph per target, with source mappings and production source roots shared by package builds and deployment. Re-exported interfaces and types reached through slot code remain available in the generated table. Conflicting input aliases are reported before a table is written.

Runtime interface checks reserve the TypeScript library and helper names used by their generated declarations. Core builds honor `PENGUIN_BUILD_JS_ONLY` for development and test builds; full builds continue to emit the SDK's public declarations.
