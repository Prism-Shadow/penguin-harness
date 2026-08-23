# The penguin-cli skill covers the commands the CLI has grown

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `skills`
- **PR:** [#415](https://github.com/Prism-Shadow/penguin-harness/pull/415)

[中文版](2026-08-23-penguin-cli-skill-covers-recent-commands.zh.md)

The `penguin-cli` library skill documented the CLI as it stood in late July, so four
command surfaces shipped since then were invisible to any agent following it. All four were
added (skill `v9`): `penguin config model remove`, the `--fast-mode` / `--no-fast-mode` pair
on `model add`, and `--thinking` and `--goal` on `run` / `chat`.

## Details

- `model remove` joined the other model commands, with its exact `(provider, model_id)`
  matching, its non-zero exit on an unconfigured pair, and the default / vision pointer
  clearing that follows a removal.
- `--fast-mode` / `--no-fast-mode` joined the `model add` synopsis and its option list as a
  tri-state alongside `--vision`, including the stderr warning for a model whose AgentHub
  client has no fast tier.
- The "Running agents" section gained `--thinking <level>` — its fallback chain, the
  session-creation pinning that subagents inherit, and its per-turn meaning under `--resume`
  — and `--goal [budget]`, with the token-budget value and the `/goal` form inside
  `penguin chat`.
