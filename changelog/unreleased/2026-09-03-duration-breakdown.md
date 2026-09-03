# Durations split into model-API time and tool wall time

- **Date:** 2026-09-03
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#598](https://github.com/Prism-Shadow/penguin-harness/pull/598)

[中文版](2026-09-03-duration-breakdown.zh.md)

The chat header's details card and the Trace view now print each duration with its two components
in parentheses — `Elapsed 10.3s (API 5s, tools 5.3s)` — so a slow turn says whether it was slow
waiting on the model or running tools.

## Details

- **API time** is the time inside LLM requests with the human approval wait deducted. The wait
  falls inside a request span because core awaits approval in the streaming loop, and it is not
  time the model spent working.
- **Tool wall time** is the union of the tool execution intervals, so tools running in parallel
  count once instead of being summed. It excludes the approval wait, and excludes the segment
  where the model streams a tool's arguments — that segment is API time.
- The two are measurements of the same span, not a split of it: a background tool keeps running
  while the model decodes, and approval waits and harness overhead belong to neither. They may
  therefore exceed or fall short of the duration they follow, and neither is derived from it.
- The Trace analysis response carries `apiMs` and `toolMs` file-wide and per turn, each global
  figure being the sum of the per-turn figures exactly as `elapsedMs` already is. The Trace
  view prints the breakdown inline in the file summary and in each turn's elapsed tooltip.
- In the chat header the parentheses are omitted while both components are zero, so a
  conversation that has not run shows the bare time. The components advance as each Request and
  tool closes rather than ticking, so mid-turn they trail the running total.
- A windowed history load seeds the breakdown alongside the total it belongs to: the message
  window's prior stats gained the same two figures, and its cached per-shard scan records were
  versioned up so stale ones recompute.
