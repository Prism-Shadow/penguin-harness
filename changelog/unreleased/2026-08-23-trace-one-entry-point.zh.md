# Web App：会话轨迹只保留一个入口

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `web`, `docs`

[English](2026-08-23-trace-one-entry-point.md)

轨迹观测此前同时有三个入口：停靠区的 Trace 面板、会话详情卡中的轨迹文件行，以及 Agent 列表
每一行上的眼睛按钮。本次移除了通往 `/traces` 页的那两个深链接，读取某个会话的轨迹只经由停靠区
的 Trace 面板。`/traces` 页本身及其数据与 API 均未改动，仍可通过 URL 直接访问。

## 细节

- 会话头部统计背后的详情卡不再包含轨迹文件行：文件名、完整路径的悬浮提示与复制完整路径按钮一并
  移除，打开详情卡时为其取数的单会话请求也随之移除。
- Agent 列表的行去掉了轨迹观测按钮。新建对话、设置、用量与删除保持不变，行内其余按钮顺序不变。
- `S.chat.traceFile` 与 `S.chat.copyTracePath` 从两份字典中移除，眼睛图标从 Agent 列表的图标表中
  移除，`pathFileName` 的唯一调用方即上述被移除的行，因此它与其单元测试一并从 `file-path.ts` 移除。
- `/traces` 路由予以保留：Benchmark 页按次运行的 Session 列仍指向它，既有的
  `?agentId=`／`?sessionId=` URL 也仍可解析。

## 文档

- Web App 指南的详情卡一节以两种语言删去了轨迹文件条目。
