# impl 的 base 必须在 PR 图上，链外的行说明原因

- **Date:** 2026-10-06
- **Type:** feature
- **Scope:** `company-proposals`, `server`, `web`, `cli`

[English](2026-10-06-impl-base-on-graph.md)

登记提案的 impl 新增两条保持 PR 图可绘制的默认规则；因 base 而落在链外的节点会说明怎样修复。改动只涉及校验与展示，已登记的 impl 没有被改写。

## 细节

- `proposal.impl` 对请求声明的 base 以 400 `base_not_on_graph` 拒绝，除非它是图的 base 分支、另一个未合并也未拒绝的提案的 impl head，或最近一次读到的图中交付仓库上某个 open PR 的 head（写入过程中不访问网络）。拒绝信息会列出可接受的 base。尚未读过图时跳过 open PR 一项，并在应答的 `hints` 中注明；`penguin org proposal impl` 会打印这些提示。
- 登记的 PR 已合并（以本次登记对该 PR 的读取结果为准，读不到时看缓存状态）、且其 head 分支仍是另一个未合并也未拒绝的提案所登记的 base 时，`proposal.impl` 以 409 `base_in_use` 拒绝，并列出这些提案。状态未知时不拒绝。
- 两条规则都在写入过程中作为 `proposal.impl` 默认 guard 的一部分执行，替换该 guard 的公司 workflow 可以改变它们。
- 图节点的 `off` 改为 `ProposalGraphOff`，新增可选的 `missing`（图上没有节点的那个 base）与 `by`（`{ proposal, pr? }`：登记该 base 的提案，或以已合并 PR 把 base 分支带离图的提案）。
- PR 图页面在链外节点下方显示这些说明，中英文皆有。
