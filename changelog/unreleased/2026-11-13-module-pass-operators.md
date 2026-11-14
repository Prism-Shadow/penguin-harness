# Pipeable module passes and deferred instrumentation

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `core`, `server`
- **PR:** [#1560](https://github.com/Prism-Shadow/penguin-harness/pull/1560)

[中文版](2026-11-13-module-pass-operators.zh.md)

Module trees now compile between assembly and boot, with passes registered as manifest data in `CompileModule.passes`. Added pipeable operators for module addition, removal, replacement, conditional edits and slot contribution filtering. Decoration rules select providers after structural rewrites finish, including providers introduced by later passes.

## Details

- Added typed interface handles and method wrappers that preserve prototype methods and private-field receivers, with telemetry over service interfaces as an authoring example.
- Protected source manifests with immutable snapshots and attached operator origins to final errors, including removed providers.
- Resolved plugin pass factories for each retained generation and rebuilt from source after best-effort exclusions.
- Routed final structural interface comparisons through generated TypeScript assignments and reused their results during boot.
- Made independent pass ordering deterministic by id and rejected duplicate registrations before execution.
- Added optional per-pass and final-verification timing through `PENGUIN_MODULE_COMPILE_DEBUG=1`.
