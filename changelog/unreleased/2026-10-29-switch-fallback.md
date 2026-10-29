# A model switch hands the history over by its Trace path when the current model is unavailable

- **Date:** 2026-10-29
- **Type:** feature
- **Scope:** `amsp`, `core`, `server`, `web`, `cli`, `docs`
- **PR:** [#1388](https://github.com/Prism-Shadow/penguin-harness/pull/1388)
- **Breaking:** yes — SDK: `ModelSwitchSupport` requires `reachable`, `ContextEngine.switchContext` takes an options object, and `ModelSwitchRefusal` no longer has `compaction_not_configured`

[中文版](2026-10-29-switch-fallback.zh.md)

The in-session model switch kept compacting on the current model first and continuing on the target with the summary. When the summary could not be had, the switch completed by Trace handoff instead of staying on the old model: the next context opened on the target with a user message that was one `[model_switch_from]` block, the one the `/model` handoff uses, naming the Session itself, the absolute path of the left context's Trace file, the Workspace and the previous model pair, and telling the model to read that file when it needed the history. Only a stopped compaction kept the old model.

## When the switch hands over

- The current model was no longer in the Project config, or its client could not be built (a deleted key). It was sent nothing and no compaction pair was written.
- The summary request ended other than completed or stopped: a provider outage, a timeout or network error, a rate limit the retries did not outlast, a rejected credential, a context too long to summarize, or no compaction configured.

The handoff was written where the summary would have been, carried to the next file like a summary when the Session switched again before a turn completed, recognized as the context's opening text at resume, and sent with the next run's first request. The left file was not touched.

## Server

- `POST /sessions/:id/switch-model` loaded a Session that was not in memory for the switch alone: one whose model could no longer be reached was resumed anyway (`resumeSession({ allowUnreachableModel: true })`), and one that left no Trace was rebuilt on the target (200). A runtime loaded this way that the switch did not move was not kept, so a new Task still met the ordinary load's 409.
- The endpoint no longer answered `compaction_not_configured`, and `model_not_configured` / `model_unavailable` were about the target only.
- `GET /messages` windows counted the handoff like a summary: no unit of its own. The cached page statistics were recomputed once.

## Web App and CLI

- The confirm dialog said, when the current model was unavailable, that nothing would be summarized and the picked model would get the Trace file path, with a **Switch** button. The default body said a failed compaction hands over the Trace path instead of keeping the model.
- The transcript folded the handoff into the switch marker, which read "Model switched · A → B · handed over by Trace" and named the file on hover. A `/model` source block, which names another Session, stayed a banner.
- `/switch-model` printed a line naming the Trace file before the model line.

## Compatibility

SDK embedders that build a Session by hand: add `reachable(ref)` to the `modelSwitch` support object (answer whether the model is still configured and its client can be built), pass `{ signal, handoff, summarize }` to `ContextEngine.switchContext`, and drop any branch on the `compaction_not_configured` refusal.
