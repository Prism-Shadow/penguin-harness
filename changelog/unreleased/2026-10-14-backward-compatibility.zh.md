# 工作台迁移

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)
- **Breaking:** yes — Workflow 目录与公开接口统一改名为 Workbench

[English](2026-10-14-backward-compatibility.md)

已有智能体的工作台在访问时执行一次性迁移。`workflows/` 和 `workflows-history/` 分别改为 `workbenches/` 和 `workbenches-history/`，模块名、接口名、API 路径、事件名及共享样式表统一使用 Workbench。

## 兼容性

迁移先转换暂存副本，完成后再发布，原样保留 `state.json`，重新计算历史版本号以便继续恢复代码。原文件保留在智能体的 `.workbench-migration/backup/` 下。发布中断后，下次访问继续迁移；目标目录冲突或历史无效时停止，不覆盖原文件。

外部调用方需使用 `/workbenches` 路由和 `workbench_updated` / `workbench_removed` 事件，不保留旧路由别名。工作台 ID 和全屏链接保持不变，已发布教程与媒体的 URL 保持稳定。

## 保留期限

Workbench 维护者在 0.2.x 期间保留迁移代码。当最低支持的数据版本达到 0.3，且不再需要从 Workflow 版本升级时移除。迁移备份保留在磁盘上供恢复使用。
