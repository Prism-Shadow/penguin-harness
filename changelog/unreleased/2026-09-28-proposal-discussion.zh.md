# 公司提案：与负责人讨论一份提案

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[English](2026-09-28-proposal-discussion.md)

提案页多了「讨论」按钮。点它会以提案的负责人——已有实施者时是实施者，否则是作者——开一个会话来讨论这份提案，与负责人的工位分开；双方谈定之后，结论送到负责人的工位，只送一次。

## Details

- 会话的开法与实施会话相同：负责人的 Agent、它的模型（缺省组织的）、它工位的 Workspace、组织的 `approvalMode`，标记为组织的会话。首个输入写明提案的定位（`proposal:<n>`、组织、修订号），并带上提案正文；还没有发布修订时带简介。
- 在讨论会话里执行 `penguin org proposal conclude <n> -m <text>`，结论就以一行 `[proposal #<n>]` 送到负责人的工位；人也可以加 `--discussion <session_id>` 替它收尾。背后的路由是 `POST …/proposals/:number/discussions/:sessionId/conclude`，body 为 `{ text }`；开讨论是 `POST …/proposals/:number/discussions`（只有人可以）。
- 一次讨论只收尾一次（409 `discussion_concluded`）；负责人的工位与其他员工不能替它收尾（403 `not_discussion`）。工位收不下结论时（409 `org_paused`、`employee_paused`、`desk_unavailable`）原样回报原因、记一条 `notify_failed` 事件，讨论保持进行中，可以再次收尾。
- 已合并或已拒绝的提案（409 `proposal_status`）、已暂停的组织（409 `org_paused`）、负责人已不是员工（409 `owner_unavailable`）都开不出讨论。
- 页面列出各次讨论（进行中，或已送出结论），各带一个打开会话的链接；时间线显示 `discussion_started` 与 `discussion_concluded`，结论写在那一行下面。
- 不含这项改动的版本读到带 `discussion` 行的账本时会跳过这些行；盘上的文件不会被改写。
