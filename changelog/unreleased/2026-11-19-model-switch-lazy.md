# A model switch opens no Trace file of its own

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `core`, `server`, `cli`, `docs`
- **PR:** [#1653](https://github.com/Prism-Shadow/penguin-harness/pull/1653)
- **Breaking:** yes — a switch's stream ends with `session_update`, not the new context's `session_meta`

[中文版](2026-11-19-model-switch-lazy.zh.md)

An in-session model switch no longer opens the next Trace file at once. When it completes, the
Session appends a `session_update` naming the target to the file it leaves and streams it as the
switch's last record; the next context's file opens with the next message, as it does after any
compaction ([PRFC-0035](https://github.com/Prism-Shadow/penguin-harness-design/pull/498); the
readers learned the record in [Readers learn the `session_update` record](2026-11-19-session-update-record.md)).

## Details

- Consecutive switches, or a switch with no message after it, leave no file that holds only a
  context's head. One file holds the records; the last one names the model.
- The next message writes its `task_begin` to the old file, then opens the new one: the target's
  `session_meta` (streamed behind the `task_begin`, ahead of the input), the opener's records,
  and the text the context opens with — the summary, the hand-off note, or the switch's
  `[model_switch_from]` hand-off — written once, at the head. The rotation became the one place a
  context's opening is written.
- A refused, stopped or `fatal` switch writes no record; a Session that never ran writes none.
- A restart after a switch and before the next message lands on the target with the summary or
  the hand-off. A switch away from a context that never answered keeps that context's unanswered
  text across a restart, which an eagerly opened file lost. When the switch's own compaction got
  no summary, a restart in that window opens with the in-place hand-off note rebuilt from the
  file instead of the `[model_switch_from]` block.
- Server: the Session row and the model listeners move at the record, and the switch's hand-off
  is held for history reads until the next file opens.
- CLI: a chat that resumed a Session and has sent nothing yet still reads a switch's hand-off as
  the switch's.

## Compatibility

- SDK hosts: `Session.switchModel` streams `session_update` (then the hand-off, when that is the
  opening) where it streamed the new context's `session_meta`; that `session_meta` comes with the
  next run, behind its `task_begin`. Read the new model from the record's `provider` /
  `model_id`, or from `Session.provider` / `Session.modelId`.
- `ContextEngine.switchContext` and `ContextEngine.handOverContext` no longer yield the meta or
  the hand-off; `ContextEngine.opensWith(record)` says whether the next context opens with the
  hand-off.
- An older build reading a Trace that switched and received no message since resumes it on the
  old model and replays the old context whole: nothing is lost, but the Session is neither
  switched nor compacted. A Session that received a message after the switch is unaffected. No
  compatibility code is kept for this.
- Traces already on disk replay unchanged, files an older build opened for a switch included.
