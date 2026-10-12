# 组织存储原子写文件，并保留崩溃后同时出现在两列的工单

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#850](https://github.com/Prism-Shadow/penguin-harness/pull/850)

[English](2026-10-10-org-store-atomic-write.md)

组织存储写出的每个文件——`org_config.toml`、`org_chart.yaml`、工单、频道、日程项、手册——现在都经由核心的 `atomicWriteFile` 写入：唯一命名的临时文件再重命名到位，写到一半崩溃不会再留下被对账判为非法并从看板移除的截断文件。`moveTicket` 不再吞掉旧列文件删除失败的错误，只放过文件本已不存在的情形。同一工单 id 出现在两列时——移动的写入与删除之间崩溃——看板保留最新的一份，过期的一份列入非法文件，而不是两份一起从看板消失。
