# 存量安装兼容说明

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `server`, `cli`, `web`
- **PR:** [#1795](https://github.com/Prism-Shadow/penguin-harness/pull/1795), [#1823](https://github.com/Prism-Shadow/penguin-harness/pull/1823), [#1825](https://github.com/Prism-Shadow/penguin-harness/pull/1825)

[English](2026-11-24-backward-compatibility.md)

## 已有公司工单

以 `2026-09-02-launch-the-site` 立单的工单保留原 ID 和 Markdown 文件名。已有的看板书签、父工单、阻塞关系、频道引用和 Session 继续使用记录中的 ID。新旧工单可以相互引用，无需迁移或手动操作。

只要已有文件或外部引用仍使用日期开头的 ID，服务端和客户端就继续支持它。维护者只有在另行确认并完成覆盖这些引用的迁移后，才可移除这项支持。

## 既有 Trace

状态栏直接读取历史会话。旧 Trace 没有记录思考或工具参数的首个片段时间时，这段生成耗时省略；能从记录中确定的工具执行时间仍然计入。用户无需迁移或操作。只要产品还支持读取缺少该字段的 Trace，就保留这一读取方式。

## 第一个工作台引导的书签和进度

原有引导书签会在同一机器、同一 Agent 的对话中恢复引导。引导可以读取当前标签页已保存的进度，已安装的清单工作台及其内容仍保存在 Agent 中，无需迁移。后续若要停止支持这些书签和已保存的进度，需另行决定，再由维护者移除相应处理。
