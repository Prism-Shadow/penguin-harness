# Switching the model inside a Session

- **Date:** 2026-09-16
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#748](https://github.com/Prism-Shadow/penguin-harness/pull/748)

[中文版](2026-09-16-in-session-model-switch.zh.md)

A Session could run on only one model: the model reference was fixed when the Session was created, and changing it meant `/model`, which opens a new conversation. A Session can now switch models in place. The switch compacts the context on the current model first, and only when that compaction completes does the next model context open on the target model, carrying the summary. One Session can therefore run several models over its life. Changing the thinking level still leaves compacting first to the user; a model switch always compacts.

## Core

- `Session.switchModel({ provider, modelId, signal })` streams the switch and returns `{ status, previous, next }`. The target is checked against the Project config on disk and its client is constructed before any event, so a missing model or credential is refused without touching the Trace. Switching to the current model does nothing.
- The model reference moved from the Session to the model context. Context assembly resolves the entry each context opens on, and `Session.provider` / `Session.modelId` read the running context's `session_meta`. Subagents spawned after a switch inherit the new model; the image fold and `read_file`'s vision describer follow the current entry; explicit SDK credentials apply only to the model the Session was created with.
- A switch always summarizes, whatever `compaction.mode` says. A context with nothing to summarize still switches: right after a compaction the held summary is carried over; an open context whose first request never completed is closed in discard mode with its pending text carried over in memory, and the summary that context opened with, if any, written again at the head of the new file; a Session that never ran is re-assembled on the target without writing anything. Input carried to a model without vision has its images folded into path lines first.
- A switch's compaction is an ordinary `manual` compaction; the next context's Trace file opens as soon as the switch completes, headed by its `session_meta`, and that record is also streamed — no OmniMessage field or enum value was added. `resumeSession` therefore lands on the new model from the Trace alone, with the summary pending.
- A summary too large for the target's context window ends the switch `fatal`, naming both numbers; a summary already held from an earlier compaction refuses the switch before any event. A failed or aborted switch leaves the Session on its model.
- The switch's known refusals are thrown as `ModelSwitchRefusedError` with a `reason` (`model_not_configured`, `model_unavailable`, `compaction_not_configured`, `summary_too_large`), so a host maps them without reading messages; any other error is a failure.

## Server

- `POST /api/sessions/:sessionId/switch-model` with `{ provider, modelId }`. It answers 202 and streams like `/compact` (status `compacting`), or 200 with the updated Session when the Session had never run. Refusals are 409 `task_in_progress`, `compacting`, `same_model`, `model_not_configured`, `model_unavailable`, `compaction_not_configured` and `summary_too_large` (a held summary does not fit the target's window); any other error core throws before its first event answers 500.
- The Session row's `provider` / `model_id` became the current model: they move as the new context's `session_meta` passes through the stream and are reconciled from the loaded Session. The switch's compaction request is billed to the old model and later requests to the new one. A fork takes its model from the shard it cuts, and the trace index reads a Session's model from its latest shard.

## Web

- The model badge of an open conversation became a model picker. Picking another model asks for confirmation (compact and switch, or cancel); an empty conversation switches directly, and right after a compaction the dialog says the conversation continues from the existing summary and only offers "Switch". The picker is disabled while the conversation runs or compacts. The conversation shows the switch as an ordinary compaction row followed by a "Model switched · A → B" marker, derived from two consecutive `session_meta` records, and the page picks up the new model when the switch completes.
- `/model` keeps opening a new conversation on another model; its description, picker, chip and banner now say so, and point to the toolbar picker for switching inside the conversation.

## CLI

- `penguin chat` gained `/switch-model <provider> <model_id>`; bare `/switch-model` prints the current model. The REPL renders the switch's compaction like any other and prints `model: A → B` when it completes. `--resume` still rejects model flags and points to `/switch-model`.
