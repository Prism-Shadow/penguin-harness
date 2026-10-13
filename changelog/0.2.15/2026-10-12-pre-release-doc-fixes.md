# Docs and Skills: the Agent API limit, its approval example, the full-page exit chord and the toolkit plugins

- **Date:** 2026-10-12
- **Type:** process
- **Scope:** `docs`, `skills`, `landing`
- **PR:** [#1080](https://github.com/Prism-Shadow/penguin-harness/pull/1080)

[中文版](2026-10-12-pre-release-doc-fixes.zh.md)

Four statements that no longer matched the product were corrected ahead of 0.2.15.

## Details

- The Agent API page said an agent runs at most four *API* runs. The limit counts every running conversation of the agent, Web App ones included, and refuses a run on a new or idle conversation while four are running. The `penguin-sdk` Skill's API reference said the same and was corrected with it.
- The approval example on that page and in the `penguin-sdk` Skill read `args?.command`, but `exec_command` takes `cmd`, so the example denied every call. It now reads `args?.cmd`.
- The `penguin-plugin` Skill named Ctrl+P and Ctrl+Shift+P as the way out of a full-page workflow. The command palette's chord is Ctrl+Alt+P (⌥⌘P on macOS) and can be rebound; the Skill now says so and tells a page never to `preventDefault` it. Both Skills moved to version 2026.10.12.2.
- The tutorial "Create, evaluate and evolve as many agents as you like" still sent readers to the `agent-tuning` plugin. It now names `agent-evaluation` (for `benchmark-design` and `agent-evaluation`) and `default-rsi-toolkit` (for `agent-optimization`).
