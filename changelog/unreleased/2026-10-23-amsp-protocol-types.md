# The OmniMessage types and markers move into `@prismshadow/amsp`

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `amsp`, `core`
- **PR:** [#1300](https://github.com/Prism-Shadow/penguin-harness/pull/1300)

[中文版](2026-10-23-amsp-protocol-types.zh.md)

The records a Trace holds are the records AMSP streams, so their types and the message markers now live in the SDK package, which has no dependency and runs in browsers. Core re-exports both, and nothing written to disk changes.

## Details

- `packages/core/src/omnimessage/types.ts` and `omnimessage/markers/*` move to `packages/amsp/src/omnimessage/`. `@prismshadow/amsp` exports them from two new entry points, `@prismshadow/amsp/omnimessage` (the envelope, every payload and the guards) and `@prismshadow/amsp/markers` (the marker producers and parsers). Its root entry is unchanged.
- `@prismshadow/penguin-core` depends on `@prismshadow/amsp` and re-exports both from their old paths: the package root, `@prismshadow/penguin-core/omnimessage` and `@prismshadow/penguin-core/markers`. `ThinkingLevelName` is defined with the records and re-exported from `interfaces` as before.
- A workspace build builds `@prismshadow/amsp` before core, and the release already publishes it first.
- A new core test pins the bytes of one record of every stored kind against a checked-in Trace file.
