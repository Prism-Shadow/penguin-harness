# The conversation header names the pull request its Workspace is on

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-08-30-workspace-pr-chip.zh.md)

A conversation whose Workspace has an open pull request now says so in the header, at the end of the statistics row: the number, hovering shows the title, and clicking opens the pull request in a new tab.

## What is shown

The open pull request whose head is the branch the Workspace is on, and only that. A merged or closed one is not what the Workspace is working on, and a pull request whose head is a different branch is `gh` having resolved through a tracking branch — a branch that tracks `main` would otherwise show `main`'s.

## Where it comes from

`gh`, run in the Workspace by the server that owns it. No credential is stored or configured: `gh` already holds the user's authentication and already knows the remote. The answer is cached per Workspace and branch for 30 seconds, so opening conversations does not spawn a process each time, and it is re-asked when the conversation changes and when the window regains focus — which is what makes the chip follow a branch switched in a terminal.

Everything that could go wrong shows the same way: nothing. No pull request for the branch, no `gh` installed, not signed in, not a repository, a detached HEAD, no network — the chip simply does not appear. A header chip reports work, not problems.
