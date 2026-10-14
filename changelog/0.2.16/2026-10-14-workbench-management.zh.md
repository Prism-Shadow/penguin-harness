# 在 Agent 设置中管理工作台

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)

[English](./2026-10-14-workbench-management.md)

Agent 设置新增工作台标签页，可打开、重新加载、恢复版本和移除已安装的工作台。Agent 卡片与可搜索的 Agent 选择弹窗显示工作台数量。

## 导航与对话

退出占满应用模式后回到原工作台。新建对话只显示当前所选 Agent 的工作台标签。从工作台创建的会话标记为 `workbench` 来源并自动归档，应用仍可读取和运行这些会话。已有对话保留其记录的来源。

## 应用交互

客服弹窗支持点击空白处关闭并保留草稿。工作台构建 Skill 增加列表与详情分离、可访问的弹窗、进度反馈及两条独立对话的浏览器验收要求。插件的中英文展示名称同步更新。
