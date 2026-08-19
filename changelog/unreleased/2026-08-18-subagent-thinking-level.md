# Subagent thinking-level override on run_subagent

The `run_subagent` tool gains an optional `thinking_level` argument, so the model can pick the thinking level a subagent runs at — lower for cheap mechanical subtasks, higher for hard analysis — instead of every child Session always running at the parent's level (#306).

## Core

The tool schema (in each Agent's editable `system_config.yaml`) declares `thinking_level` as an enum of the four selectable tiers — `low` / `medium` / `high` / `xhigh` — mirroring the thinking-level pickers: `none` stays a valid stored/wire value but is not offered, because many models cannot disable thinking. Omitting the argument keeps the existing behavior exactly: the child inherits the parent Session's effective level (including "no level" when the parent has none, the tri-state `null`). An unknown value fails the call loudly with the valid options, rather than silently running the child at an inherited level the caller did not ask for; a JSON `null` counts as omitted.

The override is plumbed through `SubagentRunner.spawn` (new optional `thinkingLevel`) into the spawn closure's `createSession` call, sitting above the inherit-or-null resolution — so an explicit level also applies when the parent itself has no level. The valid tiers are exported as `SUBAGENT_THINKING_LEVELS`.

Because the default `run_subagent` tool entry changed, the config kernel advances to generation `2026-08-18` (only the `tools.builtin.run_subagent` leaf changed): existing Agents whose entry still matches an older default pick the new schema up through the normal kernel update, while customized entries are left alone as usual. The pre-toggles reconstruction proof in the kernel tests self-retires as designed now that the defaults evolved past the toggles generation.

## Docs

The bilingual tools and interfaces pages document the new argument and the spawn interface field (the `SubagentRunner` snippet also catches up on the `provider` half of the model pair it was missing).
