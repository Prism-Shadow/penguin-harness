# The conversation header names the pull request its Workspace is on

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#555](https://github.com/Prism-Shadow/penguin-harness/pull/555)

[中文版](2026-08-30-workspace-pr-chip.zh.md)

A conversation whose Workspace has an open pull request now says so in the header, at the end of the statistics row: the number, hovering shows the title, and clicking opens the pull request in a new tab.

## What is shown

The open pull request whose head is the branch the Workspace is on, and only that. A merged or closed one is not what the Workspace is working on, and a pull request whose head is a different branch is `gh` having resolved through a tracking branch — a branch that tracks `main` would otherwise show `main`'s.

## Where it comes from

Two sources, in order, both asked by the server that owns the Workspace.

`gh` first, run in the Workspace: it already holds the user's authentication, already knows the remote, and reaches private repositories, so nothing has to be stored or configured. Where there is no `gh` — a machine that only ever runs an agent usually has none — GitHub's REST API answers instead: anonymously, which covers public repositories, or with `GH_TOKEN` / `GITHUB_TOKEN` when the environment has one. `gh`'s own credential store is deliberately not read; it belongs to another program.

A `gh` that answers "no pull requests found" is taken at its word, and no request is made.

The answer is cached per Workspace and branch for 30 seconds, so opening conversations neither spawns a process nor makes a request each time, and it is re-asked when the conversation changes and when the window regains focus — which is what makes the chip follow a branch switched in a terminal.

Everything that could go wrong shows the same way: nothing. No pull request for the branch, no `gh` and no reachable API, not signed in anywhere, a private repository with no token, not a repository, a detached HEAD, a remote that is not GitHub, no network — the chip simply does not appear. A header chip reports work, not problems.
