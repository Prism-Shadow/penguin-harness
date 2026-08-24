# Web App: one entry point for reading a conversation's Trace

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#429](https://github.com/Prism-Shadow/penguin-harness/pull/429)

[中文版](2026-08-23-trace-one-entry-point.zh.md)

Alongside the dock's Trace panel, which shows the Trace of the conversation on screen, the
`/traces` page was deep-linked from three places: a Trace file row in the conversation's
details card, an eye button on every row of the Agent list, and the Session column of the
Benchmark page's per-run table. All three links were removed, leaving the dock's Trace panel
as the only way into a Trace from the app. The `/traces` page itself, its data and its API
are untouched.

## Details

- The details card behind the conversation's header stats no longer carries a Trace file
  row: the file name, its full-path tooltip and the copy-full-path button went with it,
  together with the single-session fetch that filled them when the card opened.
- Rows of the Agent list lost their Traces button. New chat, Settings, Usage and Delete
  are unchanged, and the row's remaining buttons keep their order.
- `S.chat.traceFile` and `S.chat.copyTracePath` left both string dictionaries, the eye
  glyph left the Agent list's icon table, and `pathFileName` — whose only caller was the
  removed row — left `file-path.ts` along with its unit tests.
- The Benchmark page's per-run Session column shows the Session id as plain text instead of
  a link. `CaseRow` and `EvaluationRow` lost the `agentId` prop they carried only to build
  that link, and the file's only `Link` import went with it.
- The `/traces` route was kept even though nothing in the app now links to it: an existing
  `?agentId=`/`?sessionId=` URL still resolves, which matters for links already shared, and
  the page holds the Trace import/export controls, which exist nowhere else. Comments naming
  the removed entry points were corrected rather than left to rot.

## Docs

- The Web App guide's details-card section dropped its Trace file bullet, in both languages.
