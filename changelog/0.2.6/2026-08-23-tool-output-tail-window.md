# Truncated tool output keeps a tail window next to the head

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#432](https://github.com/Prism-Shadow/penguin-harness/pull/432)

[中文版](2026-08-23-tool-output-tail-window.zh.md)

Tool output that exceeds `maxOutputLength` used to keep the first `maxOutputLength`
characters and drop everything after them. For command output — the common way to exceed
the budget — the most informative part is usually the end: the test verdict, the error,
the last lines before exit. The model saw a head full of passing noise and had to read
the recovery file to learn how the run ended.

The budget now splits in half. The head window streams live exactly as before; text past
it is withheld into a fixed-capacity rolling tail. At finalization, output that stayed
within the budget is flushed verbatim — a complete result whose later part simply arrives
at completion — while over-budget output ends as head, a counting marker, and the last
tail window:

```
<first half of the budget>
[output truncated: kept first 8000 and last 8000 of 913482 chars]
<last half of the budget>
[output archived: <session scratchpad>/truncated-tool-output/exec_command-<hash>.log]
```

The marker's total is new signal: the model can judge from `C` whether opening the
recovery file is worth a call at all. The 50/50 split mirrors the archive file's own
head/tail rule and is a single constant.

## Unchanged

- The streaming invariant holds: streamed deltas still concatenate to exactly the complete
  `tool_call_output`, truncation included. The marker, tail, terminal note (e.g. exit
  code), and archive note are all emitted as compensating deltas at finalization.
- The recovery archive is untouched: same trigger, same 8 MiB − 1 per-call bound, same
  file format, same lifecycle with the Session scratchpad.
- `maxOutputLength <= 0` still disables the budget entirely, and standalone SDK embedders
  without a Session scratchpad keep truncation-only behavior — now with the tail window.

## Details

- Both cuts are UTF-16 surrogate-safe: the head window never closes on a pairable high
  surrogate (the character is withheld and reunites with its low half in the flush), and a
  tail window never starts with a severed low surrogate. Visible output no longer shows a
  replacement character at the cut.
- Output that ends past the head window but within the budget now reaches the stream at
  finalization rather than live. Only that band's delivery timing changes; its content is
  complete and unmarked.
- The truncation marker moved from the appended notes into the content, between the two
  windows, and its wording changed from `exceeded N chars` to
  `kept first H and last T of C chars`. Frontends render tool output as plain text, so no
  renderer changes are needed; old Traces keep the old marker and render as before.
- A compatibility tool that returns one complete message gets the same windows applied to
  that message.

Design: the head/tail contract and the recovery archive are recorded in the design specs
([penguin-harness-design #54](https://github.com/Prism-Shadow/penguin-harness-design/pull/54)).
