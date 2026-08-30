# 工作流：Agent 自己的页面与服务端代码，热重载并可回滚

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

[English](2026-08-30-workflows.md)

Agent 现在可以在自己的目录里保存*工作流*：`workflows/<id>/` 是一个扩展包——`package.json#penguin.modules` 里的清单、把清单与代码按名配对的 `index.mjs` 默认导出、可选的 `ui/`——服务器把它作为一棵独立的模块树启动，并在任何代码运行之前用服务器自己的接口表检查。这与服务器自身以及用户扩展所用的是同一套机制：工作流要求了宿主没有发布的东西，或者提供的处理器形状不对，就会带着具名的问题加载失败，而上一个版本继续服务。

## 契约

根模块 `Workflow` 要求 `WorkflowHost`（服务器以 `Host` 模块发布：`runAgent({ text, sessionId? })`、`sessionStatus`、基于工作流 `state.json` 的 `getState` / `setState`、`log`），并提供 `WorkflowMain`——一个 JSON 处理器 `handle({ method, path, query, body })`，服务器把它挂在 `/api/projects/:p/agents/:a/workflows/:id/api/*`。工作流的 `ui/` 从 `…/workflows/:id/ui/*` 提供。每个 Agent 的系统提示词新增一节 *Workflows* 描述目录布局，Agent 因此能自己编写、修改和修复自己的工作流。

## 重载与回滚

服务器监视 Agent 的 `workflows/` 目录，文件变化时重新导入对应工作流（也可 `POST …/:id/reload`）；导入以目录内容哈希为键，改过的模块不会从模块缓存里被拿出来。每次成功加载都记录在 `workflows-history/<id>/<revision>/`（保留二十个，`GET …/:id/history`），`POST …/:id/rollback { revision }` 恢复该版本的文件——`state.json` 不动——并重新加载。Project 的用户会在事件流上收到 `workflow_updated`。

## Web App

带 UI 的工作流在聊天页顶部成为 *聊天* 旁的一个标签页；标签页以 iframe 展示页面（UI 版本变化时重新加载，聊天在其下保持挂载），并显示工作流的版本与修订、当前文件启动失败时的加载错误、*重新加载* 按钮，以及每个已记录版本带 *恢复* 按钮的 *历史* 折叠面板。

`penguin-sdk` 技能记录了目录布局与契约。
