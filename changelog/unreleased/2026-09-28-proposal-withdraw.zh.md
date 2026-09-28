# 公司提案：作者可以撤回仍在起草中的提案

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-28-proposal-withdraw.md)

作者可以自己撤回一份尚未标记就绪的提案——`penguin org proposal withdraw <n> [--reason <text>]`——不必等人来拒绝。提案仍留在账上，状态是单独的 `withdrawn`，与人给出的 `rejected` 区分开。

## Details

- `POST …/proposals/:number/withdraw`，body 为 `{ reason? }`：只有作者或人可以（其他人 403 `not_author`，不是作者的实施者也一样），且只在提案处于 `drafting` 时可以（否则 409 `proposal_status`，并说明已就绪的提案要由人来拒绝）。第 0 修订的空稿也能撤回。
- 账本追加一行状态行（`status: "withdrawn"`，给了理由就带上）；时间线显示一条 `withdrawn` 事件。修订、评论与材料都保留，提案照旧可以列出、可以读。
- 撤回的提案与被拒绝的一样算关闭：发布修订（409 `proposal_closed`）、实施、讨论、拒绝、就绪与认可都会被拒绝。
- 作者与实施者会在工位上收到一行——`withdrawn by <who>[: <reason>] — stop work on it, and close its PR if one is open.`——撤回者本人除外。
- `penguin org proposal ls --status withdrawn` 可以列出它们。提案页上撤回的提案显示为灰色标签，计入 `is:closed` 与 `is:withdrawn`，不在默认的 `is:open` 里；页面上没有撤回按钮。
- proposal-author 技能要求：不该存在的提案就撤回，不要把简介改写成留档说明；proposal-tester 技能对待 `dev` 上撤回提案的分支与被拒绝的一样（agent-company-proposals `2026.09.28.1`）。
- 不含这项改动的版本读到带 `withdrawn` 行的账本时不会跳过它：状态显示为原词、没有颜色，也不把提案当作已关闭。盘上的文件不会被改写。
