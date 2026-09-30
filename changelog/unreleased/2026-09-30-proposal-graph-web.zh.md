# 提案页点进 PR 关系图，按提交图画出

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `plugins`

[English](2026-09-30-proposal-graph-web.md)

提案列表与每份提案的页头多了一个**关系图**按钮，点开组织下的 `proposals/graph`：把 `GET …/proposals/graph` 的应答（见 [2026-09-30-proposal-pr-graph.zh.md](2026-09-30-proposal-pr-graph.zh.md)）照 `git log --graph` 的画法画出来。最新的一层在上，底座分支在最下。分叉另占一条泳道，链外的层以虚线挂在它声明的 base 上。每行给出 PR（链到 GitHub）、它是哪份提案的 impl PR（链到那份提案）、比下一层多几个提交、链顶／分叉／链外标注，以及各 origin 上同名分支的 PR 与它的关系。

从某份提案点进来时，图滚到那份提案的 impl PR 并高亮；那份提案在图上没有 impl PR 时，用一行说明。声明的 base 不在图上的 PR、impl PR 不是交付仓库上 open PR 的提案，列在图下；GitHub 没答上的项目列在图上方。
