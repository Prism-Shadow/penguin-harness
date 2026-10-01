# The PR graph shows several stacks on the base branch side by side

- **Date:** 2026-10-01
- **Type:** feature
- **Scope:** `plugins`, `server`, `cli`, `web`

[中文版](2026-10-01-pr-graph-several-stacks.zh.md)

Stacks that each start on the base branch and keep going are all on the chain, each drawn as its own line. `GET …/proposals/graph` answers `tops`: the last layer of every stack, in PR order; `top` stays the single top when there is exactly one. The web graph page and `penguin org proposal graph` mark every stack's top, and the base reads "N stacks on the base" (`[N stacks]` in the CLI) instead of a fork to resolve. A branch on the base that does not keep going while others do is still off the chain, as before.

A graph answer from a server older than this change has no `tops`; the page and the CLI fall back to its single `top`.
