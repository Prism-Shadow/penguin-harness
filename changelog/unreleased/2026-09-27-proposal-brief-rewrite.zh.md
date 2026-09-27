# 公司提案：提案的简介可以改写

- **Date:** 2026-09-27
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-27-proposal-brief-rewrite.md)

提案的简介（brief）在创建时就定死了：队列里一直显示发起时那句委托，哪怕它是一段派单说明（「为已经打开的 PR … 写一份提案」）而不是这份提案要做什么的概括；想改只能重建提案，评论与事件随之丢失。现在作者或人可以原地改写它。

## Details

- `penguin org proposal brief <n> -m <text>`（或 `--file <f>`，两者恰给其一）改写简介；背后的路由是 `PUT /api/projects/:projectId/organizations/:orgId/proposals/:number/brief`，body 为 `{ brief }`。只有作者或人可以改（否则 403 `not_author`）；空简介回 400，与现有一字不差回 409 `brief_unchanged`。
- 只动简介：修订、标题、评论、事件与已有的认可都不变，所以任何状态下都允许。账本记一行 `brief`，时间线记一条 `brief_edited` 事件，新简介写在事件下方（「改写了简介」）；`show` 打印新简介与这条事件。
- 别人改写一份作者仍在起草（drafting）的提案的简介时，作者的工位会收到一行 `[proposal #<n>]`；过了起草阶段，或作者自己改写时，不通知任何人。
- `proposal-author` 技能列出了这条命令（`agent-company-proposals` 2026.09.27.3）。
- 不含这项改动的版本读到带 `brief` 行的账本时会跳过这些行，显示创建时的简介；盘上的文件不会被改写。
