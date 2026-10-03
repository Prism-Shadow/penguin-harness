# The PR graph is always drawn, from the workspace's remotes when no delivery repository is set

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#123](https://github.com/Myriad-Dreamin/penguin-harness/pull/123)

[中文版](2026-09-30-proposal-graph-workspace-remote.zh.md)

`GET …/proposals/graph` no longer answers 409 `graph_not_configured`. While **Delivery repository** is empty, the graph reads the organization's shared workspace with `git remote -v` and takes its GitHub remotes. The remote whose repository holds the most of the ledger's impl PRs becomes the delivery repository; when none holds any, `origin`, else the first. The base is **Stack base branch**, or the repository's default branch when that setting is empty. While **Origins** is empty, the workspace's other GitHub remotes annotate the graph under their remote names. With no GitHub remote at all, the graph is the base branch alone and `errors` says why.

`penguin org proposal impl --adopt` settles its repository the same way; it still answers 409 `graph_not_configured` when neither the settings nor the workspace name one. Settings that are filled in are used as they are.
