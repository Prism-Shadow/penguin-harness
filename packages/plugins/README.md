# @prismshadow/penguin-plugins

The PenguinHarness plugin library. A plugin is a directory under `plugins/` with a `plugin.json` manifest and the content it ships: **skills** (`skills/<name>/SKILL.md`, installed into an Agent's `agent_state/skills/`) and/or a **hook package** (`hooks/*.mjs`, installed into `agent_state/hooks/<plugin>/` with a generated `hooks.json`). The files are the runtime source of truth and ship raw in this package's npm tarball.

Versions are dates with a sequence number — `YYYY-MM-DD.N` — on the manifest and on every skill a plugin ships. Skills follow the "index first, body on demand" design: only their metadata is injected into an Agent's system prompt; the Agent reads the full `SKILL.md` via shell when it actually needs it. Hook scripts are plain Node (builtins only): the harness runs them as subprocesses at the loop's hook points with `{ hook, session_id, trace_path }` on stdin and reads their JSON answer from stdout.

Included plugins, by category (`PLUGIN_CATEGORIES` in `src/index.ts`; a plugin with no or an unknown category lands in an "Other" group):

| Category | Plugins |
| --- | --- |
| Office Productivity | `data-analysis`, `firecrawl`, `bento-slides`, `humanizer` |
| Software Development | `web-design`, `software-engineering`, `remote-claude-code` |
| AI App Development | `penguin-sdk`, `penguin-cli`, `penguin-orchestration`, `agenthub-models`, `vllm`, `ollama`, `llamafactory`, `skill-porting` |
| Agent Tuning | `agent-initialization`, `benchmark-design`, `agent-evaluation`, `agent-optimization` |
| Session Hooks | `goal`, `skill-summary` |

`humanizer`, `remote-claude-code` and `skill-summary` carry `preinstall: false`, so `default_agent` does not get them at initialization — they are installed from the library on demand. `goal` is the stop hook behind goal mode: its `start.mjs` writes the Session's `GOAL.json` and composes round 1, its `stop.mjs` reads the Trace after every Task and injects the next round or ends the goal. `skill-summary` hands a long session's condensed excerpt to a background subagent that folds the findings into the agent's skills.

Agent Tuning powers the self-improvement loop: create the Target Agent, design a Benchmark, evaluate it, optimize it to version N+1 with a snapshot before every round.

## Documentation

- [Skills & Plugins](https://penguin.ooo/docs/skills)
- [Goal Mode](https://penguin.ooo/docs/goal-mode)
- [Self-Improvement](https://penguin.ooo/docs/self-improvement)

## Development

```bash
pnpm --filter @prismshadow/penguin-plugins build      # tsup → dist/ (loader API)
pnpm --filter @prismshadow/penguin-plugins typecheck
pnpm --filter @prismshadow/penguin-plugins test       # loader, README tables, the hook scripts against fake Traces
```
