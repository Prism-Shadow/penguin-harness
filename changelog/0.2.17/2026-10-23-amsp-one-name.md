# One name for a record: the AMSP record

- **Date:** 2026-10-23
- **Type:** refactor
- **Scope:** `amsp`, `core`, `server`, `web`, `docs`
- **PR:** [#1304](https://github.com/Prism-Shadow/penguin-harness/pull/1304)
- **Breaking:** yes — `OmniMessage`, `OmniPayload` and `OmniMessageType` were renamed, and `@prismshadow/penguin-core` dropped its `./omnimessage` and `./markers` exports.

[中文版](2026-10-23-amsp-one-name.zh.md)

The name OmniMessage was retired. A Trace line, an SDK output and an unnamed event of a Session stream are one thing, and the types, modules, docs, skills and landing page now call it an AMSP record. Nothing written to disk or sent on the wire changed.

## Details

- `OmniMessage<P>` became `AmspRecord<P>`, `OmniPayload` became `AmspPayload` and `OmniMessageType` became `AmspRecordType`; core's `mergeOmniToUniMessage` became `mergeRecordsToUniMessage`. No alias was kept for the old names.
- The record builders, `isTaskRecord` / `isTaskBegin` / `lastNonTaskRecord` and `normalizeSessionSource` moved from core into `@prismshadow/amsp`, beside the types, so the Web App imports everything it reads records with from that package. The package's unpublished `./omnimessage` entry became `./records`.
- The `@prismshadow/penguin-core` root re-exports `@prismshadow/amsp/records` and `@prismshadow/amsp/markers`, so every name stayed available there.
- The docs page moved to `/docs/amsp-records`, titled "AMSP Records". The old address `/docs/omni-message` was not redirected.
- The Web App's stream modules moved from `src/lib/omni/` to `src/lib/amsp/`, and the stream handler `onOmniMessage` became `onRecord`.

## Compatibility

- An import of `@prismshadow/penguin-core/omnimessage` or `@prismshadow/penguin-core/markers` no longer resolves. Import the same names from `@prismshadow/amsp` (the records, guards and builders, also at `@prismshadow/amsp/records`) and `@prismshadow/amsp/markers`, or from the `@prismshadow/penguin-core` root.
- Rename `OmniMessage`, `OmniPayload` and `OmniMessageType` in TypeScript code to `AmspRecord`, `AmspPayload` and `AmspRecordType`.
- Traces, `web.db`, exported Agents and the AMSP stream carry no type names, so they need nothing.
