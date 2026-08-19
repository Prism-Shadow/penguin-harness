# CLI: runtime thinking-level control and collapsed tool output

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `cli`, `docs`
- **PR:** [#322](https://github.com/Prism-Shadow/penguin-harness/pull/322)
- **Issue:** [#305](https://github.com/Prism-Shadow/penguin-harness/issues/305)

[中文版](2026-08-18-cli-thinking-and-output-collapse.zh.md)

CLI mode gained two runtime controls that previously needed an Agent config edit or nothing at all: a thinking level settable per invocation and changeable mid-chat, and head/tail collapsing of long tool output in the chat REPL with a `/verbose` escape hatch. The CLI reference documents both.

## Thinking level

- `penguin run --thinking <low|medium|high|xhigh>` and `penguin chat --thinking <level>` pin the Session's thinking level at creation, so spawned subagent sessions inherit it. Omitted, the configured chain applies: the Agent's `model.thinking_level`, else the Project's `default_chat.thinking_level`, else `medium`.
- In the chat REPL, `/thinking` reports the level the next turn will run at — naming whether it is this Session's default or an active per-turn override, and which default that override replaces — and `/thinking <level>` overrides subsequent turns. The override is a per-turn `RunOptions.thinkingLevel`, mirroring the web active-session picker, and is never written back to the Agent config; only the Session's own level is inherited by spawned subagent sessions (a `run_subagent` call can still name its own `thinking_level`). Under `--resume` the flag becomes that initial override instead, since a resumed Session's construction values are fixed.
- The selectable tiers reuse core's `DEFAULT_CHAT_THINKING_LEVELS` (no `none`, matching the web picker); a stored legacy `none` still displays as-is.

## Collapsed tool output

- The chat REPL collapses long tool output by default: the first 4 lines stream live, then an elision marker (`… (+N lines, /verbose for full output)`) and the last 4 lines print when the stream ends. Outputs of up to 9 lines render whole, and the marker never hides fewer than 2 lines. Resumed history (`--resume`) is collapsed the same way, down to reporting the same hidden count as the live stream for the same output.
- Collapsing is display-only: the model, the Trace, and the Web App receive the complete text either way.
- `/verbose` toggles full output mid-chat, and `penguin chat --verbose` starts a session with collapsing already off. `penguin run` never collapses — its output feeds pipes and nested CLIs.
- A tool-output stream cut off by an interrupt still settles its held-back tail at task end, so nothing silently vanishes from the screen.
