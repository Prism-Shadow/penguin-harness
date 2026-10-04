# PR 关系图按组织手册对「唯一一条 PR stack」的定义读链

- **Date:** 2026-10-01
- **Type:** fix
- **Scope:** `plugins`, `cli`, `web`, `server`
- **PR:** [Myriad-Dreamin/penguin-harness#108](https://github.com/Myriad-Dreamin/penguin-harness/pull/108)

[English](2026-10-01-proposal-graph-reads-the-stack.md)

`GET …/proposals/graph`、`penguin org proposal graph` 与关系图页现在按组织栈读数器的同一套规则判链：

- 声明的 base 是某张已合并 PR、或未合并即关闭的 PR 的分支时，这一层仍在链上，从那张 PR 自己的 base 接着往下走。走过的 PR 列在节点上（`via`），已关闭的那种单独标出，因为它的提交仍在这一层里。
- 边按祖系判。只缺无内容提交的 head 仍算叠着。落后于父层、但分叉点落在父层自己那一层内部的，仍在链上，标为 `stale`（待重排）。分叉点在那一层之下的是旧线。最底一层的父层是底座分支：底座前进之后，从底座历史上分出的最底一层仍在链上，标为 `stale` 并以 `behind` 给出底座多出的提交数（「落后 main N 个提交」），其上各层照常在链上；只有分叉点不在底座历史上的才是旧线。
- 分叉处取继续往上走的那一支，其余为链外。没有或有多支继续往上走时，图把每一支都走到、标出分叉、不给链顶，因为那里要靠路线图的位次来定。

每个链外节点都写明原因（`off`：旧线、分叉处没被取、叠在链外的层上、base 走不到任何 PR、成环、没比对上），impl PR 不在图上的提案也写明原因（`reason`：已合并及合进哪条分支、已在底座分支里、已关闭、开在别的仓库，或者这里有一张 open PR 带着它的分支）。CLI 在 `Off the chain:` 与 impl PR 不在图上的那几行打出这些原因。页面在图下分开列出三类：链外的 PR、画不出来的 PR、impl PR 不在图上的提案。
