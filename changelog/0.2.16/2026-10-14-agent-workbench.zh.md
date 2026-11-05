# Agent Workbench 与预置产品客服

- **Date:** 2026-10-14
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `plugins`, `docs`
- **PR:** [#1133](https://github.com/Prism-Shadow/penguin-harness/pull/1133)
- **Breaking:** yes — Workflow 接口统一改名为 Workbench

[English](2026-10-14-agent-workbench.md)

首页的三个 AI 应用示例统一创建智能体及其独立的 Agent Workbench 标签页。用户进入智能体，新建对话后选择工作台即可使用应用。

## 应用创建

切换示例会替换已选 Skill，即使两个示例的 Skill 数量相同也会更新。Plugin Skill 明确了新智能体工作台的加载入口、后台任务轮询和通过服务器附件直链下载报告的方式。`WorkbenchHost.sessionResult` 返回最新任务的最终答案或失败原因，不暴露工具与思考消息。页面布局设置 display 样式后，隐藏的提示条仍保持隐藏。

## 产品客服

默认 Project 初始化时会创建 PenguinHarness 客服智能体，附带提问、搜索、追问、来源链接和解决状态的工作台。回答依据官方文档与代码仓库。工作台重载保留工单状态；智能体文件可编辑，重复初始化不会覆盖已有文件。

客服 Agent 通过通用插件安装器安装 `penguin-support`，Skill 与工作台源文件放在 `plugins/penguin-support/`。默认界面是居中问题列表，新建问题和对话详情均以弹窗打开。插件工作台支持安装、更新和卸载，更新保留已有状态。回答用正文内的编号引用 [1] 等标注依据，不再单独罗列链接。客服 Skill 跨工单复用参考仓库，并同时检索 Workbench 与旧称 Workflow。

## 兼容性

目录、接口及版本历史的一次性迁移见[向后兼容](2026-10-14-backward-compatibility.zh.md)。
