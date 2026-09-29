# 公司提案：员工也可以驳回提案

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `cli`, `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#57](https://github.com/Myriad-Dreamin/penguin-harness/pull/57)

[English](2026-09-29-proposal-reject-by-employees.md)

过去只有人能驳回提案。人让员工把一批提案撤下时，员工只能回答「做不了」，这些提案一直挂着，直到人逐条亲手驳回。现在组织里的任何员工都可以驳回提案，做法与人相同。

## Details

- `penguin org proposal reject <n> --reason <text>` 与 `POST /api/projects/:projectId/organizations/:orgId/proposals/:number/reject`（body 为 `{ reason }`）除人之外也接受员工。驳回的其余规则不变：理由必填（为空回 400），已合并或已驳回的提案回 409 `proposal_status`，组织外的调用者仍回 403。
- 账本的状态行与 `rejected` 事件记下是谁驳回的（`agent:<id>` 或 `user:<id>`），员工的驳回与人的驳回在账上分得开。作者与 implementer（若有）照常收到 `[proposal #<n>] rejected by <who>: <reason> — stop work on it, and close its PR if one is open.` 这一行；驳回者本人不会收到自己这一行。
- CLI 的帮助文本不再写「（人）」。
- `proposal-author` 技能列出了这条命令并写明何时用：人让你撤的时候，或你自己的提案不该继续的时候；凭自己的判断要关掉同事的提案，则改用 `feedback` 交给人决定（`agent-company-proposals` 2026.09.29.1）。
- 没有新的状态、事件种类或账本行：不含这项改动的版本读到员工的驳回，与读其他驳回一样。
