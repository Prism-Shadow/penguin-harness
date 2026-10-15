# 工单列只列出以工单 id 命名的文件

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1141](https://github.com/Prism-Shadow/penguin-harness/pull/1141)
- **Issue:** [#735](https://github.com/Prism-Shadow/penguin-harness/issues/735)

[English](2026-10-15-ticket-listing-names.md)

一个工单列现在只贡献其名称为工单 id 的 `.md` 文件，列内的其他文件一概不读：散落在列里的
`README.md` 不再进入看板行、不计入任何花费，也不会在每一轮 pass 里记录 `org_ticket_invalid`
报错。

## 细节

- `isTicketId`（`packages/server/src/organization/files.ts`）同时接受两种 id 形态——当前的，
  以及 slug 规则收紧之前写下的；旧的形态与当前形态并列声明为 `LEGACY_TICKET_ID_PATTERN`。
  因此 slug 中含数字的工单仍会出现在看板上，读写路由也一如既往地拒绝它。
- `OrgStore.listTickets` 在读取文件之前，先过滤由文件名推导出的 id，于是一个并非工单的文件
  不产生解析，也不产生报错记录；方法上的注释改为陈述这条规则。
