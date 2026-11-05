# 统一 Agent 设置中的列表样式

- **Date:** 2026-10-14
- **Type:** fix
- **Scope:** `ui`, `web`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[English](./2026-10-14-workbench-settings-list.md)

Agent 设置中的工作台与技能共用 UI 包的列表容器、条目、版本信息及图标操作。工作台设置不再显示“浏览插件”入口。窄屏下操作区自动换行，空列表采用相同的空状态。

工作台列表、Agent 数量与会话来源标记统一使用铁砧图标，并适配三套图标主题。

Agent 选择器采用 UI 包的紧凑搜索弹窗：每个 Agent 占一行，技能与工作台数量同行显示，详细信息在悬停时展示，列表在限定高度内滚动。支持方向键与回车选择搜索结果。
