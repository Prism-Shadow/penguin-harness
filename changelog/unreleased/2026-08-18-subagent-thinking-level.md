# Subagent thinking level: `thinking_level` on `run_subagent`

- **Date:** 2026-08-18
- **Type:** feature
- **Scope:** `core`, `docs`
- **PR:** [#323](https://github.com/Prism-Shadow/penguin-harness/pull/323)
- **Issue:** [#306](https://github.com/Prism-Shadow/penguin-harness/issues/306)

[中文版](2026-08-18-subagent-thinking-level.zh.md)

The `run_subagent` tool gained an optional `thinking_level` argument, so the model can pick the thinking level a subagent runs at — lower for cheap mechanical subtasks, higher for hard analysis — instead of every child Session always running at the parent Session's level. Changing the default tool entry advanced the config kernel to a new generation, so existing Agents take a kernel update.

## Details

- The tool schema declares `thinking_level` as an enum of the four selectable tiers, `low` / `medium` / `high` / `xhigh`, mirroring the thinking-level pickers. `none` was left out of the offered set because many models cannot disable thinking, and stayed valid as a stored and wire value.
- Omitting the argument reproduces the previous behavior exactly: the child inherits the parent Session's effective level, including the tri-state `null` that stands for "no level" when the parent has none. A JSON `null` counts as omitted.
- An unrecognized value fails the call and names the valid options, instead of quietly running the child at an inherited level the caller did not ask for.
- The override travels through a new optional `thinkingLevel` on `SubagentRunner.spawn` into the spawn closure's `createSession` call, resolved above the inherit-or-null fallback, so an explicit level also applies when the parent Session has no level of its own.
- The four tiers were exported as `SUBAGENT_THINKING_LEVELS` and pinned by a test against the project-default tier list and the shipped tool schema, so the parallel copies of that set cannot drift apart.

## Compatibility

- The default `run_subagent` tool entry changed, so `KERNEL_VERSION` advanced to generation `2026-08-18`, with `tools.builtin.run_subagent` as its only changed leaf. Every existing Agent therefore takes a kernel update.
- An Agent whose stored `run_subagent` entry still matches an older default advances to the new schema on its own. An entry the user edited is kept untouched, and an entry the user deleted to switch the tool off stays deleted rather than being re-added. Nothing has to be done by hand either way.
- This was the first generation whose defaults differ from the previous one in a tool leaf, which brought the kernel update's "a stored tool entry matching an older generation advances" branch under test for the first time, driven through the history seam so the coverage cannot rot. The pre-toggles reconstruction proof was rescoped to retire per leaf rather than per generation, so it kept proving `system_prompt`, the leaf its frozen `LEGACY_*` constants are about.

## Docs

- The bilingual tools and interfaces pages documented the new argument and the matching `spawn` field. The `SubagentRunner` snippet also caught up on the `provider` half of the model pair it had been missing.
