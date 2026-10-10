# 增删单个路线图条目，无需重写草稿

- **Date:** 2026-10-07
- **Type:** feature
- **Scope:** `company-roadmaps`, `agent-company-proposals`, `cli`

[English](2026-10-07-roadmap-item-add.md)

新增两个路线图 Action，只改讨论中路线图草稿里的一个条目，其余条目、记录与正文保持原样。

## 细节

- `roadmap.item.add`（主题 `roadmap:<n>`）追加一个条目，参数即条目本身，按 `roadmap.draft` 的 `items` 元素同样校验；其 `stackedOn` 可指向草稿里已有的任一条目。草稿已有的 key 会被拒绝：409 `item_exists`。
- `roadmap.item.remove { key }` 移除一个条目；对代表某份提案（采纳的，或经批准关联的）的条目拒绝 409 `item_has_proposal`，对有其他条目叠在其上的拒绝 409 `item_stacked_on`；不存在的 key 返回 404 `item_not_found`。
- 两者沿用 `roadmap.draft` 的默认守卫：仅在路线图讨论中时可用。
- `roadmap.draft` 仍整体替换条目列表；其应答列出这次替换移除的 key（`removed`）。
- CLI 新增 `penguin org roadmap item` 命令组：`item add <number>` 以命令旗标给出条目字段，运行 `roadmap.item.add`（`--key`、`--kind`、`--title`、`--brief` 必填；`--owner`、`--employees`、`--cites`、`--stacked-on`、`--proposal` 可选，列表用逗号分隔），`item remove <number> <key>` 运行 `roadmap.item.remove`——走的都是 `penguin org action run` 所发的同一条路由，加一条条目不再需要手写 JSON 对象。`penguin-proposal` Skill（`agent-company-proposals` 2026.10.07.2）仍通过 `penguin org action run` 调用二者，并以 `roadmap.item.add` 作为添加条目的方式。
