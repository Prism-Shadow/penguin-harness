# Built-in plugins

The PenguinHarness plugin library. Each plugin is its own npm package — `@penguinharness/<name>`, a directory under `plugins/` — with a `plugin.json` manifest (and an `icon.svg` beside it: the icon of everything the plugin ships, which its installed skills and hook package inherit) plus the content it ships: **skills** (`skills/<name>/SKILL.md`, installed into an Agent's `agent_state/skills/`) and/or a **hook package** (`hooks/*.mjs`, installed into `agent_state/hooks/<plugin>/` with a generated `hooks.json`). The loader lives in `@prismshadow/penguin-core`, which depends on these packages and reads their directories at runtime — the files are the source of truth.

Versions are dates with a sequence number — `YYYY-MM-DD.N` — on the manifest and on every skill a plugin ships. Skills follow the "index first, body on demand" design: only their metadata is injected into an Agent's system prompt; the Agent reads the full `SKILL.md` via shell when it actually needs it. Hook scripts are plain Node (builtins only): the harness runs them as subprocesses at the loop's hook points with `{ hook, session_id, trace_path }` on stdin and reads their JSON answer from stdout.

Included plugins, by category (`PLUGIN_CATEGORIES` in `packages/core/src/plugins/index.ts`; a plugin with no or an unknown category lands in an "Other" group). A plugin built around someone else's product carries a `use-` prefix — `use-firecrawl`, `use-bento-slides`, `use-remote-claude-code` — so the package name says what it is for rather than claiming the product; the skills inside keep their own names:

| Category | Plugins |
| --- | --- |
| Office Productivity | `data-analysis`, `use-firecrawl`, `use-bento-slides`, `humanizer`, `goal`, `continual-learning` |
| Software Development | `software-development`, `use-remote-claude-code` |
| AI App Development | `agent-development`, `model-development`, `skill-porting`, `agent-tuning` |

`humanizer`, `use-remote-claude-code` and `continual-learning` carry `preinstall: false`, so `default_agent` does not get them at initialization — they are installed from the library on demand. `goal` is the stop hook behind goal mode: its `start.mjs` writes the Session's `GOAL.json` and composes round 1, its `stop.mjs` reads the Trace after every Task and injects the next round or ends the goal. `continual-learning` hands a long task's condensed excerpt to a background subagent that folds the findings into the agent's skills.

`agent-tuning` powers the self-improvement loop: create the Target Agent, design a Benchmark, evaluate it, optimize it to version N+1 with a snapshot before every round.

## Documentation

- [Skills & Plugins](https://penguin.ooo/docs/skills)
- [Goal Mode](https://penguin.ooo/docs/goal-mode)
- [Self-Improvement](https://penguin.ooo/docs/self-improvement)

## Development

The plugins are data, not code — there is nothing to build here. The loader, its types and their tests live in `packages/core`:

```bash
pnpm --filter @prismshadow/penguin-core build       # includes the plugin loader
pnpm --filter @prismshadow/penguin-core test        # loader, README tables, the hook scripts against fake Traces
```
