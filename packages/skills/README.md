# @prismshadow/penguin-skills

The PenguinHarness built-in skill library. A Skill is a directory with a `SKILL.md` (frontmatter: name, description, version, updated) — files are the runtime source of truth and ship raw in this package's npm tarball.

Skills follow the "index first, body on demand" design: only their metadata is injected into an Agent's system prompt; the Agent reads the full `SKILL.md` via shell when it actually needs it.

Included skills, in the order of the `SKILL_GROUPS` manifest in `src/index.ts` (a skill directory missing from the manifest is still loaded, and lands in an "Other" group):

| Group | Skills |
| --- | --- |
| Office Productivity | `data-analysis`, `firecrawl` |
| Software Development | `web-design`, `software-engineering` |
| AI App Development | `penguin-sdk`, `penguin-cli`, `agenthub-models` |
| Agent Tuning | `agent-creation`, `benchmark-design`, `agent-evaluation`, `agent-optimization` |

Agent Tuning powers the self-improvement loop: create the Target Agent, design a Benchmark, evaluate it, optimize it to version N+1 with a snapshot before every round.

## Documentation

- [Skills](https://penguin.ooo/docs/skills)
- [Self-Improvement](https://penguin.ooo/docs/self-improvement)

## Development

```bash
pnpm --filter @prismshadow/penguin-skills build      # tsup → dist/ (loader API)
pnpm --filter @prismshadow/penguin-skills typecheck
pnpm --filter @prismshadow/penguin-skills test
```

Part of [PenguinHarness](https://github.com/Prism-Shadow/penguin-harness) · Apache-2.0
