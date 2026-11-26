# CLI History and Session Log Model-Switch Handoff Rendering

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1890](https://github.com/Prism-Shadow/penguin-harness/pull/1890)

[中文版](2026-11-26-cli-history-model-switch.zh.md)

Updated CLI history replay and `penguin session log -f` to render in-place model-switch Trace handoffs as the single switch line rather than raw `[model_switch_from]` prompt blocks.

## Details

- Rendered in-place `[model_switch_from]` handoff records as the compact switch line when replaying transcripts in `penguin chat --resume` and `penguin session log`.
- Passed the active session identifier into history replay and `penguin session log -f`, keeping in-place handoffs recognized when `--tail` omitted earlier session metadata or a live stream had not emitted one yet.
- Left cross-session `[model_switch_from]` messages and nested subagent messages rendered as regular user prompts.
