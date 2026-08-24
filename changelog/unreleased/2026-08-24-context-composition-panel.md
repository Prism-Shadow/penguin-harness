# Click the context ring to see what the context is full of

- **Date:** 2026-08-24
- **Type:** feature
- **Scope:** `web`, `server`

[中文版](2026-08-24-context-composition-panel.zh.md)

The context ring in the chat composer became a button. Clicking it opens a panel that splits the
current model context into six parts — system prompt, tool definitions, user messages, model
messages, tool requests, tool results — as a stacked bar and a legend of tokens and percentages,
followed by the five tools whose traffic occupies the most of it. The ring's resting appearance is
unchanged.

## Details

- `GET /api/sessions/:sessionId/context` returns the six parts, their sum, and the tool ranking. It
  reads the Session's **newest Trace shard**, which is one complete model context: the Trace writer
  rotates on compaction and opens the new file with `session_meta` and `tool_list_ready`, and
  Session resumption keeps appending to the shard it left off in.
- Sizes come from the character heuristic core already applies to request inputs
  (`approximateMessagesTokens`), so images carry their flat allowance instead of their base64
  length, and no tokenizer is introduced.
- The panel spends those figures on **shares only**. Each part is drawn as its share of the
  occupancy the ring itself reports — the last `token_usage`'s `request.total` — so the parts add up
  to the figure in the panel header, and every derived value is marked `~`. Both columns are
  apportioned by largest remainder, so the percentages total exactly 100 and the token column
  exactly the measured occupancy.
- Events are skipped (none of them is sent to the model), and so are the messages between a
  `compaction_begin` and its `compaction_end`: the compaction prompt and the summary it produces
  are recorded in the shard but were never part of the context being described.
- The tool ranking counts each tool's calls and their results. A tool's *definition* is counted in
  the tool-definitions part instead, and a result whose call is not in the same shard still counts
  toward tool results but has no tool to be attributed to — so the ranking can sum to less than the
  two tool parts.
- A shard ending in a completed `compaction_end` reports `contextClosed`, the same test Trace replay
  uses to decide it must replay nothing. The panel then shows `—` and says the next request will
  report the usage, matching what the ring already shows in that state, rather than describing the
  context that was just compacted away.
- The panel is portaled and positioned by `usePortalPanel`, closing on outside click, Esc, scroll or
  resize. It is offered where a Session-level endpoint can serve it: not in the draft composer,
  which has no Session, and not in the subagent composer, whose child Session is not registered in
  the sessions table.

## Colours

- The six parts took a categorical palette of their own in `lib/category-colors.ts`, separate from
  `SERIES_COLORS` whose length is also the cost center's fold cap.
- Legend rows are drawn in the same order as the bar segments, so only neighbours have to be told
  apart; the order clears the adjacent-pair gates in both light and dark (worst adjacent ΔE 21.1
  simulated for protanopia and deuteranopia, 22.1 unsimulated, OKLab ×100). Six hues cannot also
  clear those gates for arbitrary pairs, so every legend row carries its own value beside its name.
