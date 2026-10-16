# 切换 Project 不再显示或请求上一个 Project 的 Agent

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `web`, `ci`
- **PR:** [#1165](https://github.com/Prism-Shadow/penguin-harness/pull/1165)

[English](2026-10-15-project-switch-isolation.md)

在 Web App 里切换 Project 时，可能出现刚离开的 Project 的 Agent：智能体页把它们列在新 Project 下，还能打开其设置；同时会发出把新 Project 与它并不拥有的 Agent 配对的请求，得到「该 Agent 已不存在。」。切换时打开着的对话也会留在新 Project 下。机器越慢越常见：列表的应答次序被打乱，渲染落后于网络。

## 细节

- 每个 Project 范围的应答都带上发起请求时的 Project，只在该 Project 仍是当前 Project 时才生效；为某个 Project 保存的状态也只在该 Project 下发布（`lib/project-scope.ts`）。覆盖 Project 的 Agent 列表、会话列表（重新加载、翻页与外部交给它的行）、会话列表询问的机器 Agent、组织的工位与工单会话、智能体页的机器 Agent，以及对话页的模型配置。
- 当前 Project 从刷新后的 Project 列表中消失时，按切换 Project 的方式离开：回退到的 Project 不会显示旧 Project 的 Agent。
- 路由指向的对话只在其所属 Project 下显示，无论它来自列表、直接查询，还是在重新加载期间被保留；切换后页面打开新 Project 最近的对话或新对话。
- Agent 设置页在切换 Project 时转到新 Project 的智能体列表，不再向新 Project 询问该 Agent；另一个 Agent 迟到的配置应答也不再显示在页面上。
- Agent 的记忆列表同样按 Project 区分，一个 Project 的 `default_agent` 不再顶替另一个 Project 的。
- 成本中心的 Agent 筛选归属于选定它时的 Project（`?agentId=` 深链接归属于打开页面时的 Project），切换后页面按新 Project 不加筛选读取；刚离开的 Project 的用量应答，或筛选已改变后才到的应答，一律丢弃。
- Benchmark 详情页在切换 Project 时转到新 Project 的 Benchmark 列表，不再向新 Project 询问该 Benchmark。
- CI 的浏览器任务新增运行 `project-switch.spec.mjs`：两个各有专属 Agent 的 Project，在列表加载期间来回切换——一次用路由延迟制造迟到的 Agent 列表，一次把渲染进程 CPU 降速并按固定种子给每个 API 应答加随机延迟。只要一个 Project 的内容出现在另一个之下、有请求把 Project 与其不拥有的 Agent 配对，或有应答返回 `agent_not_found`，就判失败。该 spec 原有的插件页检查改为卸载默认自进化工具包自己的 Skill `agent-optimization`。
