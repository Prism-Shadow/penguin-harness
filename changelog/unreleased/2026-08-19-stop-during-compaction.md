# The composer can interrupt a compaction again

- **Date:** 2026-08-19
- **Type:** fix
- **Scope:** `web`
- **PR:** [#345](https://github.com/Prism-Shadow/penguin-harness/pull/347)

[中文版](2026-08-19-stop-during-compaction.zh.md)

The chat composer's single action button offers Stop while a compaction is running, so a compaction can be interrupted from the Web App again.

## Details

The button asked `running && midRunAction(...) === "stop"` to decide whether it wore the Stop face, but a compacting Session's status is `compacting`, not `running`. It therefore fell through to the Send branch — which `canSend` disables for the whole compaction — leaving a dead button exactly where the only available action belonged.

- The decision moved into `isStopAction` alongside `midRunAction` in `composer-send.ts`, which already exists to stop this class of mistake being repeated: a state where nothing can be sent must leave Stop, never a disabled Send. Compacting is unconditionally such a state — neither the steering nor the follow-up channel is offered while a compaction runs — so the button is Stop there whatever the composer holds.
- Nothing changed for the states that already worked: an idle Session never offers Stop, and a running one offers it exactly where the draft has no send channel.

The server and core were never part of this: the abort route accepts an interrupt in any non-idle state, and core stops the compaction request on the signal, settling the pair as `aborted` with the original context kept — the same well-defined outcome a compaction interrupted by quitting reaches. Both halves are now pinned by tests.
