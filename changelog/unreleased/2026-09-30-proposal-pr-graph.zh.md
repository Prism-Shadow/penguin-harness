# 每份提案登记一条 impl PR，PR 关系图画出整条栈及其提案与各 origin

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `plugins`, `cli`, `server`
- **PR:** PR_LINK

[English](2026-09-30-proposal-pr-graph.md)

提案现在有一条 impl PR：`penguin org proposal impl <n> <url>` 登记它（作者、实施者或人均可），再登记即替换；已是另一份提案 impl PR 的 PR 会被拒绝（409 `impl_pr_taken`）。`show` 单列一行显示它，提案数据里是 `implPr` 字段。`pr` 材料不变，也不会被拿来推断 impl PR。

`penguin org proposal graph`（`GET …/proposals/graph`）把交付仓库的 open PR 排成提交关系图。每张 PR 的边指向它声明的 base 的 head，并用 GitHub 的 compare 核对：领先于那个 head 的算叠在栈上，其余的列为链外。图会标出分叉，只有链上只剩一个叶子时才标出栈顶。每张 PR 标出以它为 impl PR 的提案，以及每个已配置的 origin 在同名分支上的 PR 和它的 head 关系（相同、领先、落后、分叉）。impl PR 不在图上的提案列在图下。所有数据都经本机的 `gh` 读取，服务器不 fetch、不写任何 git ref。

它由「设置 → 插件 → 公司提案」下的三项设置驱动：**交付仓库**（`owner/repo`；留空时关系图回 409 `graph_not_configured`）、**栈底分支**（`dev`）、**各 origin**（每行一个 `name=owner/repo`）。存量账本的处理见 [2026-09-30-backward-compatibility-proposal-impl.zh.md](2026-09-30-backward-compatibility-proposal-impl.zh.md)。
