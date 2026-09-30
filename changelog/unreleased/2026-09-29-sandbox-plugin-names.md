# The sandbox backends are named like every other plugin

- **Date:** 2026-09-29
- **Type:** refactor
- **Scope:** `plugins`, `server`, `docs`, `release`, `ci`
- **PR:** [Myriad-Dreamin/penguin-harness#68](https://github.com/Myriad-Dreamin/penguin-harness/pull/68)

[中文版](2026-09-29-sandbox-plugin-names.zh.md)

The four sandbox backends now follow the rule the Agent plugins already follow: `plugins/<dir>`
is the npm package `@penguinharness/<dir>`.

| Before | Now |
| --- | --- |
| `@prismshadow/penguin-plugin-sandbox-bwrap` | `@penguinharness/sandbox-bwrap` |
| `@prismshadow/penguin-plugin-sandbox-seatbelt` | `@penguinharness/sandbox-seatbelt` |
| `@prismshadow/penguin-plugin-sandbox-wsl` | `@penguinharness/sandbox-wsl` |
| `@prismshadow/penguin-plugin-sandbox-dsh` | `@penguinharness/sandbox-dsh` |

- The new names are used everywhere the old ones appeared:
  - the builtin plugin index, and each backend's README and entry module;
  - the backend table in the server's sandbox module;
  - the configuration and plugins docs pages, and the contributing guide;
  - the release workflow's check that the CLI payload carries the bwrap backend;
  - the CI shard that builds it.
- A test pins the rule for the four backends.
- What a backend is inside the harness did not change: its settings group (`sandbox-<x>`), its
  backend name (`penguin-<x>`) and its contribution ids carry no package name, so saved sandbox
  settings are kept.
- The backends stay private and unpublished; only the name changed.
