# An agent searches from `CWD` down, and runs one dev instance at a time

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `core`, `skills`
- **PR:** [#604](https://github.com/Prism-Shadow/penguin-harness/pull/604)

[中文版](2026-09-03-search-scope-and-dev-instance-rules.zh.md)

Nothing in the default system prompt said where an agent should look for a file, so a path that did not resolve was answered by widening the search root — `find /`, a walk of the home directory, a scan of the whole disk. That is slow, and it reads files that have nothing to do with the task. The prompt now steers an agent to search from `CWD` down and to narrow rather than widen, and the two repo-development skills carry the matching guidance for agents working on PenguinHarness.

## Details

- The default system prompt's `# File system` section gained one bullet: search from `CWD` down, since walking the user's home or the whole filesystem is rarely worth its cost, and prefer narrowing a path that does not resolve — by reasoning about the project's layout — over widening the root.
- That is a kernel change (generation `2026-09-03`, prompt tab): an existing Agent whose prompt tab is still the built-in default picks the rule up on a kernel update, while one the user has edited keeps what it says.
- The kernel record's pre-#257 reconstruction proof now reads a frozen copy of the template that generation shipped (`core/test/fixtures/toggles-generation-system-prompt.txt`) instead of the live default, so it stays anchored as the prompt goes on changing.

## Development skills

- `penguin-harness-dev` gained the same guidance scoped to a worktree, naming the sibling checkouts (`../penguin-harness-design`, `../penguin-harness-wt/*`, `../agenthub`) as the only paths outside it worth reading and asking that it be passed to subagents. It also states that findings belong in PR comments and the PR description rather than in a standalone report, and that a clone with no design repo beside it carries no `AGENTS.md` at all, which makes the checked-in skills its whole contract.
- `penguin-harness-manual-test` gained two rules: one local dev instance at a time across all agents, since cookies and the admin claim are shared and a second instance corrupts the first's session state; and the first-login link the server prints is the user's to open, never followed with `curl`, a browser or a headless fetch.
