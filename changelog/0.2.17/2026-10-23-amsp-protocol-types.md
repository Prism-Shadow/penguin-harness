# The record types and markers move into `@prismshadow/amsp`

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `amsp`, `core`
- **PR:** [#1300](https://github.com/Prism-Shadow/penguin-harness/pull/1300), [#1304](https://github.com/Prism-Shadow/penguin-harness/pull/1304)

[中文版](2026-10-23-amsp-protocol-types.zh.md)

The records a Trace holds are the records AMSP streams, so their types and the message markers now live in the SDK package, which has no dependency and runs in browsers. Core re-exports both, and nothing written to disk changes.

## Details

- The record types and the message markers move from core to `packages/amsp/src/records/` and `packages/amsp/src/markers/`. `@prismshadow/amsp` exports them from two entry points, `@prismshadow/amsp/records` (the envelope, every payload and the guards) and `@prismshadow/amsp/markers` (the marker producers and parsers); its root exports the records too.
- `@prismshadow/penguin-core` depends on `@prismshadow/amsp` and re-exports both from its root. `ThinkingLevelName` is defined with the records and re-exported from `interfaces` as before.
- A workspace build builds `@prismshadow/amsp` before core, and the release already publishes it first.
- A new core test pins the bytes of one record of every stored kind against a checked-in Trace file.
