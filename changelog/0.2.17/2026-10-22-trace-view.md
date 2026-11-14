# Trace records each request's thinking level; one-line round heads and a round navigator

- **Date:** 2026-10-22
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `ui`
- **PR:** [#1295](https://github.com/Prism-Shadow/penguin-harness/pull/1295)

[中文版](2026-10-22-trace-view.zh.md)

Each `request_begin` record now carries the thinking level that request went out at, and the Trace view uses it to show where the level changed. Each round card's head is one line of four readings, and a round navigator lists every round of the file with a jump to it and a way back.

## Thinking level on `request_begin`

- `request_begin` gained an optional `thinking_level`: the level the engine sent for that request — the Session's pinned level, else the level the context opened with. Turns and compaction requests both carry it. When no level is sent at all (a subagent whose parent had none), the field is absent.
- The engine resolves the level once per request and uses the same value for the record and for the request to the model. `LLMInterface` gained an optional `defaultThinkingLevel`, which `GenerativeModel` exposes; requests to the model are byte-identical to before.
- This is an explicit, user-requested exception to the rule that AMSP records take no new fields: `session_meta` does not record the level, and the level can change in the middle of a context.
- The Trace analysis copies the field onto each request (`RequestSpan.thinkingLevel`). Traces written before this change have no level: nothing is migrated or rewritten, and the view shows no level for them.

## Trace view

- A round head shows only tool calls, cache hit rate, cost and duration, in that order, on one line. At narrow widths the line ends in an ellipsis, and hovering it shows all four readings as one sentence. Input (with its cache hits), output, output TPS and the context ring moved to the first line of the opened round.
- A navigator under the global summary lists every round: its number, the first line of the prompt that started it, and its four readings. A row click draws, opens and scrolls to that round, and a number box jumps by round number. Each round head has a "back to navigation" button. The list takes arrow keys, Home, End and Enter. Files with fewer than two rounds show no navigator.
- Where the level changes (including the first level in a file), the `request_begin` row and that round's navigator row show the new level as a pill. Hovering the pill shows the change, for example "medium → high". A `request_begin` row's summary reads `thinking_level=<level>`.
- `StatChip` gained an `inline` form for a line of readings that truncates as a whole.
