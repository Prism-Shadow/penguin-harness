# PR 关系图把底座上的几个 stack 并排画出来

- **Date:** 2026-10-01
- **Type:** feature
- **Scope:** `plugins`, `server`, `cli`, `web`

[English](2026-10-01-pr-graph-several-stacks.md)

从底座分支各自起头、并且继续往上走的几个 stack 都在链上，各自画成一条线。`GET …/proposals/graph` 新增 `tops`：每个 stack 的最后一层，按 PR 号排序；只有一个链顶时，`top` 仍是那一个。网页关系图与 `penguin org proposal graph` 给每个 stack 的链顶都标上 top，底座上显示「底座上 N 个 stack」（CLI 里是 `[N stacks]`），不再当成一个待决的分叉。别的 stack 继续往上走时，底座上不再往上走的那一支仍不在链上，与以前相同。

比这次改动更早的服务端回的关系图没有 `tops`，网页和 CLI 退回去用它唯一的 `top`。
