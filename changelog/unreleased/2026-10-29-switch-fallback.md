# A model switch hands the history over by its Trace path when the current model is unavailable

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#1388](https://github.com/Prism-Shadow/penguin-harness/pull/1388)

[中文版](2026-10-29-switch-fallback.zh.md)

The in-session model switch kept compacting on the current model first and continuing on the target with the summary. When the summary could not be had, the switch completed by Trace handoff instead of staying on the old model: the next context opened on the target with a user message that was one `[model_switch_from]` block, the one the `/model` handoff uses, naming the Session itself, the absolute path of the left context's Trace file, the Workspace and the previous model pair, and telling the model to read that file when it needed the history. Only a stopped compaction kept the old model.

## When the switch hands over

- The current model was no longer in the Project config, or its client could not be built (a deleted key). It was sent nothing and no compaction pair was written.
- The summary request ended other than completed or stopped: a provider outage, a timeout or network error, a rate limit the retries did not outlast, a rejected credential, a context too long to summarize, or no compaction configured.

The handoff was written where the summary would have been, carried to the next file like a summary when the Session switched again before a turn completed, recognized as the context's opening text at resume (a `/model` source block, which names another Session, was not), and sent with the next run's first request, together with any text the context still held. The left file was not touched. A stop that landed after a failed summary, and a target whose context could not be opened, still left the old model in place.

## Server

- `POST /sessions/:id/switch-model` loaded a Session that was not in memory the ordinary way first. Only one the ordinary load refused was loaded for the switch alone: with a Trace it was resumed anyway (`resumeSession({ allowUnreachableModel: true })`), and without one it was rebuilt on the target (200, or the target's 409). Such a runtime ran no Task or compaction on the model it could not reach, answering each with the ordinary load's refusal, and one the switch did not move was not kept.
- The endpoint no longer answered `compaction_not_configured`, and `model_not_configured` / `model_unavailable` were about the target only.
- `GET /messages` windows counted the handoff like a summary: no unit of its own.
- A fork rewrote a handoff to name the fork and its own copy of the Trace file.

## Web App and CLI

- The confirm dialog said, when the current model was unavailable (missing from the model list, or without a key on an endpoint that wants one), that nothing would be summarized and the picked model would get the Trace file path, with a **Switch** button. The default body said a failed compaction hands over the Trace path instead of keeping the model.
- The transcript folded the handoff into the switch marker, which read "Model switched · A → B · handed over by Trace" and named the file on hover. A `/model` source block, which names another Session, stayed a banner.
- `/switch-model` printed a line naming the Trace file before the model line.

## SDK

`ContextEngine.switchContext` took an optional second argument, `{ handoff, summarize }`; without it a failed summary still ended the switch as before. `ModelSwitchRefusal` kept `compaction_not_configured`, which `switchModel` no longer produced, so callers that branch on it still compile; it can be removed at the next breaking release (0.3.0).
