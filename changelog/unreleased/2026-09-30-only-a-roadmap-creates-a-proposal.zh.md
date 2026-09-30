# 员工的提案只由 roadmap 建出

- **Date:** 2026-09-30
- **Type:** feat
- **Scope:** `plugins`, `cli`
- **PR:** PR_LINK
- **Breaking:** an employee's `penguin org proposal create` is refused; company-roadmaps needs company-proposals installed beside it

[English](2026-09-30-only-a-roadmap-creates-a-proposal.md)

员工不再能建提案。员工调用 `POST …/proposals`（即 `penguin org proposal create`）回 403 `roadmap_only`，不写任何一行，错误消息写明出路：新提案来自一条获得人与 moderator 批准的 roadmap 条目；要改动已有提案，就给它出新 revision。人的 `create` 不变。

roadmap 条目的第二把批准现在自己建卡：在同一步里经 company-proposals 建出提案（作者是条目 owner，标题与 brief 取自条目），把它链接到条目，并告诉 owner 提案号；堆叠在它上面的条目的 owner 也会收到这个号。提案的 `created` 行记下来源的 roadmap 与条目（`roadmap: { number, key }`）。建卡失败时，这次批准被拒（409 `proposal_not_created`），什么都不记，可以再批一次。收编已有提案（adopt）、把 brief 条目链接到它本来就是的那份提案，这两条路照旧不建卡。

CLI 里 `proposal create` 的帮助与 `proposal-author` Skill（版本 `2026.09.30.2`）同步改了说法。

## 兼容性

- 员工（包括 CEO）运行 `penguin org proposal create` 得到 403 `roadmap_only`。为已有 PR 补提案，改由人来 `create`。
- company-roadmaps 需要 company-proposals 的模块（`CompanyProposalsPlugin`）。只列了 company-roadmaps、没列 company-proposals 的 Project，其插件不再能启动；按 README 一直要求的那样两个都列上。
- 本版本之前已拿到两把批准、但还没有提案的条目不会被补建：照旧由人建卡，再由 owner 或人链接。
