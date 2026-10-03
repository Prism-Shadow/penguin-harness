# The PR graph reads the chain the way the organization's handbook defines the one PR stack

- **Date:** 2026-10-01
- **Type:** fix
- **Scope:** `plugins`, `cli`, `web`, `server`
- **PR:** [Myriad-Dreamin/penguin-harness#108](https://github.com/Myriad-Dreamin/penguin-harness/pull/108)

[中文版](2026-10-01-proposal-graph-reads-the-stack.zh.md)

`GET …/proposals/graph`, `penguin org proposal graph` and the graph page now judge the chain by the same rules as the organization's stack reader:

- A layer whose declared base is the branch of a merged PR, or of one closed without merging, stays on the chain: the walk goes on from that PR's own base. The PRs walked through are listed on the node (`via`), and a closed one is marked, since its commits are still in the layer.
- An edge holds by ancestry. A head that only lacks commits carrying no content still holds. A head behind its parent still holds, marked `stale`, when it forked inside the parent's own layer. A fork point below that layer is an old line.
- At a fork the chain takes the one branch that keeps going, and the others are off the chain. When none or several keep going, the graph walks every branch, marks the fork and names no top, because the roadmap's order would have to decide there.

Every node off the chain says why (`off`: an old line, not taken at a fork, on an off-chain layer, a base that leads to no PR, a cycle, or not compared), and so does every proposal whose impl PR is not on the graph (`reason`: merged and into which branch, already in the base branch, closed, open on another repository, or an open PR here carries its branch). The CLI prints these reasons on its `Off the chain:` and unplaced lines. The page lists three things apart under the graph: the PRs off the chain, the PRs the graph cannot draw, and the proposals whose impl PR is not on it.
