# Readers learn the `session_update` record

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`
- **PR:** [#1652](https://github.com/Prism-Shadow/penguin-harness/pull/1652)
- **Breaking:** yes — `@prismshadow/amsp/records` no longer exports `lastNonTaskRecord`

[中文版](2026-11-19-session-update-record.zh.md)

Every reader of a Trace now understands `session_update`, a new `event_msg` that records the new
value of a Session-level setting: today the model a Session's next context opens on (`provider`,
`model_id`). Nothing writes it yet; the change that makes an in-session model switch write it
follows separately ([PRFC-0035](https://github.com/Prism-Shadow/penguin-harness-design/pull/498)).

## Records

- `@prismshadow/amsp/records` gained the `SessionUpdatePayload` type, the `sessionUpdate`
  builder, and three helpers: `closingCompaction` (the completed `compaction_end` that closed a
  file's context, when no `request_begin` follows it), `updatedModel` (the model a record names)
  and `pendingModel` (the last model a `session_update` names, when no `request_begin` follows
  it). Only the main Session's records count.

## Resume

- A file's context is closed when its last `compaction_end` is `completed` and no
  `request_begin` follows it, as the spec's replay rule 1 states. Before, the last record that
  was not a Task record had to be that `compaction_end`, so a stop hook's record (the goal hook,
  continual-learning) behind it, or the input of a first run stopped during its MCP connect,
  made a restart replay the closed context whole and lose the summary. That input now rides on
  behind the summary, without tool outputs. It applies to Traces already on disk.
- A file whose last model-naming `session_update` has no `request_begin` after it is closed too,
  and the resumed Session opens its next context on that model (the last record wins). The
  compaction decides the opening when there is one; without one it is the `[model_switch_from]`
  hand-off regenerated from the file after completed turns, else the text the context opened
  with; unanswered input from before the record rides on as text alone. A target no longer
  configured is refused as any missing model is.

## Readers

- Server: the context composition reports `contextClosed` by the same rule; the Session row and
  the model listeners follow a main-session `session_update` on the stream; a history window
  that starts behind one names its model as `contextModel`; a round's end time and the fork's cut
  leave it out, so the last reply before a switch can be forked; a switch's Trace hand-off is held
  for history reads until the next file opens. The window scanner treats the record like
  `session_meta` (`CACHE_VERSION` 5, so shard summaries cached by an older version are rebuilt
  once).
- Web: the 「A → B」 marker is drawn from the record, the confirming `session_meta` that follows
  adds none, and the record adds no Task timing; Traces without it keep the marker from two
  `session_meta` records. The Trace viewer and the API try-it log show it as a labelled row.
- CLI: the renderer prints nothing for it and does not start its clock on it.
- Landing and docs: the AMSP pages list fifteen event payloads.

## Compatibility

- `lastNonTaskRecord` was removed from `@prismshadow/amsp/records`. A caller that asked whether a
  file was closed by a compaction uses `closingCompaction(records) !== undefined`, and
  `pendingModel(records) !== undefined` for a pending switch.
