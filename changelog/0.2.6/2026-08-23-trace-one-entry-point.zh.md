# Web App：会话轨迹只保留一个入口

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `web`, `docs`
- **PR:** [#429](https://github.com/Prism-Shadow/penguin-harness/pull/429)

[English](2026-08-23-trace-one-entry-point.md)

除展示当前会话轨迹的停靠区 Trace 面板之外，`/traces` 页此前还被三处深链接指向：会话详情卡中的
轨迹文件行、Agent 列表每一行上的眼睛按钮，以及 Benchmark 页按次运行表格的 Session 列。本次移除了
这三处链接，应用内读取轨迹只经由停靠区的 Trace 面板。`/traces` 页本身及其数据与 API 均未改动。

## 细节

- 会话头部统计背后的详情卡不再包含轨迹文件行：文件名、完整路径的悬浮提示与复制完整路径按钮一并
  移除，打开详情卡时为其取数的单会话请求也随之移除。
- Agent 列表的行去掉了轨迹观测按钮。新建对话、设置、用量与删除保持不变，行内其余按钮顺序不变。
- `S.chat.traceFile` 与 `S.chat.copyTracePath` 从两份字典中移除，眼睛图标从 Agent 列表的图标表中
  移除，`pathFileName` 的唯一调用方即上述被移除的行，因此它与其单元测试一并从 `file-path.ts` 移除。
- Benchmark 页按次运行的 Session 列改为纯文本展示 Session id，不再是链接。`CaseRow` 与
  `EvaluationRow` 仅为拼接该链接而携带的 `agentId` 参数一并移除，该文件唯一的 `Link` 引入也随之移除。
- `/traces` 路由在应用内已无任何链接指向的情况下仍予保留：既有的 `?agentId=`／`?sessionId=` URL
  仍可解析——这对已经分享出去的链接很重要——且该页承载着别处没有的轨迹导入／导出操作。注释中
  提及已移除入口的措辞一并更正，避免过时。

## 文档

- Web App 指南的详情卡一节以两种语言删去了轨迹文件条目。
