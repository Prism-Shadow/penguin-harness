# Each proposal registers one impl PR, and the PR graph shows the stack with its proposals and origins

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`, `server`
- **PR:** PR_LINK

[中文版](2026-09-30-proposal-pr-graph.zh.md)

A proposal now has one impl PR: `penguin org proposal impl <n> <url>` registers it (the author, the implementer or a person), a later one replaces it, and a PR that is already another proposal's impl PR is refused with 409 `impl_pr_taken`. `show` prints it on its own line, and the proposal carries it as `implPr`. The `pr` materials are unchanged and are never read to guess it.

`penguin org proposal graph` (`GET …/proposals/graph`) lays out the delivery repository's open PRs as a commit graph. Each PR's edge goes to the head of its declared base and is checked with GitHub's compare. A PR that is ahead of that head is stacked; any other PR is listed off the chain. The graph marks forks, and names the top only when the chain has a single leaf. Each PR shows the proposal whose impl PR it is and, for every configured origin, that origin's PR on the same branch and how its head stands (same, ahead, behind, diverged). Proposals whose impl PR is not on the graph are listed below it. Everything is read through the machine's `gh`; the server fetches nothing and writes no git ref.

Three settings under Settings → Plugins → Company proposals drive it: **Delivery repository** (`owner/repo`; the graph answers 409 `graph_not_configured` while it is empty), **Stack base branch** (`dev`), and **Origins** (`name=owner/repo` per line). Existing ledgers are covered in [2026-09-30-backward-compatibility-proposal-impl.md](2026-09-30-backward-compatibility-proposal-impl.md).
