# CLI: runtime thinking-level control and collapsed tool output

Two quality-of-life changes for CLI mode (#305): the thinking level can now be changed without editing the Agent config, and long tool outputs no longer flood the chat screen.

## Thinking level

- `penguin run --thinking <low|medium|high|xhigh>` and `penguin chat --thinking <level>` pin the Session's thinking level at creation (spawned subagent sessions follow it). Omitted, the existing configured chain applies: the Agent's `model.thinking_level`, else the Project's `default_chat.thinking_level`, else `medium`.
- In the chat REPL, `/thinking` shows the level the next turn will run at and `/thinking <level>` overrides subsequent turns (a per-turn `RunOptions.thinkingLevel` override, mirroring the web active-session picker — never written back to the Agent config). Under `--resume`, `--thinking` becomes the initial override, since a resumed Session's construction values are fixed.
- The selectable tiers reuse core's `DEFAULT_CHAT_THINKING_LEVELS` (no `none`, matching the web picker); a stored legacy `none` still displays as-is.

## Collapsed tool output

- Chat now collapses long tool outputs by default: the first 4 lines stream live, then an elision marker (`… (+N lines, /verbose for full output)`) and the last 4 lines print when the stream ends; outputs of up to 9 lines render whole, and the marker never hides fewer than 2 lines. Resumed history (`--resume`) is collapsed the same way. Display-only: the model, the Trace, and the Web App always receive the complete output.
- `/verbose` toggles full output mid-chat and `penguin chat --verbose` starts with it. `penguin run` never collapses — its output feeds pipes and nested CLIs.
- A tool-output stream cut off by an interrupt still settles its held-back tail at task end, so nothing silently vanishes from the screen.
