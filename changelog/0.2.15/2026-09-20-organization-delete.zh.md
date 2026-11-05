# 公司模式：组织可以删除

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#803](https://github.com/Prism-Shadow/penguin-harness/pull/803)

[English](2026-09-20-organization-delete.md)

此前启停就是组织的全部生命周期：除了手工移除它的目录，没有办法让一个组织消失。现在 Project 的 owner 可以删除组织。

- `DELETE /api/projects/:projectId/organizations/:orgId`——仅 owner，与删除 Agent 同一口径（成员得到 403）；成功为 `204`，组织不存在为 `404`。
- **只删组织本身。** 它的目录整个移入 Project 的回收目录——`organizations/.trash/<orgId>-<时间戳>/`——因此把目录移回来即可撤销删除。以点开头的目录不会被任何地方列出：组织从所有界面消失。旧 CEO 的 Agent（`<orgId>_ceo`，与其他员工一样被保留）删除之后，这个 id 才能再次用于新组织，否则请换一个 id。服务端由它派生的行（会话归属、日程与工单状态、已读游标、待送达的工位通知、预算状态）随之删除，同 id 的新组织不会继承任何东西。
- **它拥有的东西原样保留。** 员工仍是 Project 的 Agent，学到的一切都在。工位与工单会话保留，并继续带着「属于组织」的标记，因而不会散落到开发模式的列表里——组织不在了，也就没有页面再列出它们。
- Web：组织的设置弹窗末尾新增「删除组织」一行。确认框说明删什么、留什么，指出「只想让组织停下来而不丢任何东西」应当用暂停，并要求输入组织 id 才能确认。
