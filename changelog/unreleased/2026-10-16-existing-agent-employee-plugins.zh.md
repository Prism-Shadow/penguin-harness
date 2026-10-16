# 招聘已有 Agent 时安装缺少的员工插件

- **Date:** 2026-10-16
- **Type:** fix
- **Scope:** `server`
- **Issue:** [#736](https://github.com/Prism-Shadow/penguin-harness/issues/736)

[English](2026-10-16-existing-agent-employee-plugins.md)

招聘已有 Agent 时，在将员工加入组织并打开工位之前，补装了缺少的 `agent-company` 和 `agent-development` 插件。

## 细节

- 招聘保留了 Agent 的 `AGENTS.md` 和已有插件，包括仅安装部分内容的插件副本。已有的员工插件旧版本同步逻辑未变。
- 安装失败时，招聘在写入组织架构、发布加入通知和创建工位之前停止。重试复用了上次尝试中已成功安装的插件。
