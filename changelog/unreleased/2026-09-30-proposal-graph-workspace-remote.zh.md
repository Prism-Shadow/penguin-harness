# PR 关系图总能画出来：未设交付仓库时读工作区的 remote

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`

[English](2026-09-30-proposal-graph-workspace-remote.md)

`GET …/proposals/graph` 不再回 409 `graph_not_configured`。**交付仓库**留空时，关系图对组织的共享工作区执行 `git remote -v`，取其中的 GitHub remote：账本里 impl PR 落在哪个 remote 的仓库上最多，就以它为交付仓库；都没有时取 `origin`，再没有则取第一个。基座取**栈底分支**，该设置留空时取仓库的默认分支。**各 origin** 留空时，工作区其余的 GitHub remote 以各自的 remote 名标注关系图。工作区连一个 GitHub remote 都没有时，关系图只画基座，并在 `errors` 里写明原因。

`penguin org proposal impl --adopt` 以同样的方式确定仓库；设置与工作区都给不出仓库时，它仍回 409 `graph_not_configured`。已填写的设置照原样使用。
