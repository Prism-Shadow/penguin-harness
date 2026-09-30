# The proposals page opens the PR graph, drawn as a commit graph

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `plugins`

[中文版](2026-09-30-proposal-graph-web.zh.md)

The proposals queue and every proposal's page have a **Graph** button in their header. It opens the PR graph (`proposals/graph` under the organization) that `GET …/proposals/graph` answers with (see [2026-09-30-proposal-pr-graph.md](2026-09-30-proposal-pr-graph.md)), drawn the way `git log --graph` draws history. The newest layer is on top and the base branch is at the bottom. A fork takes a lane of its own, and a layer off the chain hangs from its declared base on a dashed edge. Each row shows the PR (linked to GitHub), the proposal whose impl PR it is (linked to that proposal), how many commits it adds, the top, fork and off-chain marks, and the other origins' PRs on the same branch with how they stand.

Opened from a proposal, the graph scrolls to that proposal's impl PR and highlights it. When the proposal has no impl PR on the graph, one line says so. PRs whose declared base is not on the graph, and proposals whose impl PR is not an open PR there, are listed under the graph. What GitHub could not answer is listed above it.
