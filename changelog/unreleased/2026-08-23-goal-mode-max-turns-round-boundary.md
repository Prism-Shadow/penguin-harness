# Goal mode continues past a per-Task max_turns cutoff

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `core`, `docs`
- **Issue:** [#171](https://github.com/Prism-Shadow/penguin-harness/issues/171)

[中文版](2026-08-23-goal-mode-max-turns-round-boundary.zh.md)

A goal no longer ends as `aborted` when one Task reaches the per-Task turn cap (`max_turns`). The loop now treats that cutoff as a round boundary and starts the next round with a fresh turn budget, replaying the cut-off round's unsubmitted tool outputs (held as engine carry-over) so the workspace and progress carry over.

## Details

- The engine's `max_turns` cutoff finishes a round with a `[reached max turns (…); stopping]` final assistant notice stamped `stop_reason: "failed"`. The loop now recognises that sentinel and re-fires instead of reading any `failed` final text as terminal; other `failed` final texts (an output-length finish, for example) still end the goal as `aborted`.
- A goal whose every round hits `max_turns` without ever writing the goal file still stops at the round cap (`maxRounds`, default 100), which remains the runaway backstop.
