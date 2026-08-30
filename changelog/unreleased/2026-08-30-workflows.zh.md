# 工作流：Agent 自己的页面与服务端代码，热重载并可回滚

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`, `skills`

[English](2026-08-30-workflows.md)

Agent 现在可以在自己的目录里保存*工作流*：`workflows/<id>/` 是一个扩展包——`package.json#penguin.modules` 里的清单、把清单与代码按名配对的 `index.mjs` 默认导出、可选的 `ui/`——服务器把它作为一棵独立的模块树启动，并在任何代码运行之前用服务器自己的接口表检查。这与服务器自身以及用户扩展所用的是同一套机制：工作流要求了宿主没有发布的东西，或者提供的处理器形状不对，就会带着具名的问题加载失败，而上一个版本继续服务。

## 契约

根模块 `Workflow` 要求 `WorkflowHost`（服务器以 `Host` 模块发布：`runAgent({ text, sessionId? })`、`sessionStatus`、基于工作流 `state.json` 的 `getState` / `setState`、`log`），并提供 `WorkflowMain`——一个 JSON 处理器 `handle({ method, path, query, body })`，服务器把它挂在 `/api/projects/:p/agents/:a/workflows/:id/api/*`。工作流的 `ui/` 从 `…/workflows/:id/ui/*` 提供。每个 Agent 的系统提示词新增一节 *Workflows* 描述目录布局，Agent 因此能自己编写、修改和修复自己的工作流。

## 重载与回滚

服务器监视 Agent 的 `workflows/` 目录，文件变化时重新导入对应工作流（也可 `POST …/:id/reload`）；导入以目录内容哈希为键，改过的模块不会从模块缓存里被拿出来。每次成功加载都记录在 `workflows-history/<id>/<revision>/`（保留二十个，`GET …/:id/history`），`POST …/:id/rollback { revision }` 恢复该版本的文件——`state.json` 不动——并重新加载。`DELETE …/:id` 连同版本一起删除工作流。Project 的用户会在事件流上收到 `workflow_updated` 与 `workflow_removed`，标签页因此无需刷新即可出现、更新或消失。

## Web App

带 UI 的工作流在聊天页顶部成为 *聊天* 旁的一个标签页；标签页以 iframe 展示页面（UI 版本变化时重新加载，聊天在其下保持挂载），并显示工作流的版本与修订、当前文件启动失败时的加载错误、*重新加载* 按钮、每个已记录版本带 *恢复* 按钮的 *历史* 折叠面板，以及需点击两次的 *移除*。

## 占满应用

页面可以成为整个应用：`/app/:projectId/:agentId/:workflowId` 只显示某个 workflow 的页面，没有侧栏、聊天和标签条。标签页上的 *占满应用* 按钮会跳到这里，页面自己也可以用 `parent.postMessage({ type: "penguin:fill-app" }, "*")` 请求，`penguin web --app <project>/<agent>/<workflow>` 则让浏览器直接打开到这个页面（spec 不是三段时在启动任何东西之前就报 `Invalid --app`）。这个路由刻意没有任何可点的退出入口；出口是命令面板——它现在同时响应 **Ctrl+Shift+P 与 Ctrl+P**（macOS 为 ⌘），页面拿走其中一个也困不住用户——并在该路由上多出 *退出全页模式（回到聊天）*，会记住 Project 与 Agent 并落到它们的聊天页。

## 主题

工作流页面是独立文档，应用的样式表照不进去。现在框架会在页面根节点打上 `light` / `dark`，把应用*已解析*的令牌复制过去——灰阶、强调色对、字体栈、根字号——并把 `/workflow-ui.css` 注入到 head 最前面：这份基础样式表按应用的观感为纯 HTML（标题、列表、表单、表格、代码）定样，并暴露 `--wf-bg`、`--wf-fg`、`--wf-muted`、`--wf-border`、`--wf-surface`、`--wf-accent`、`--wf-accent-fg`，以及 `wf-primary`、`wf-card`、`wf-rows`、`wf-row`、`wf-muted` 等类。页面自己的规则依然优先；调色板只有一份定义——应用复制它已经解析出来的值，样式表不再重述一遍。切换主题或强调色会直接给已打开的页面换装，无需重新加载。Agent 的提示词一节要求用这些变量书写标记，因此 Agent 写出的工作流在明暗两种主题下都与用户的主题一致。

`penguin-sdk` 技能记录了目录布局与契约。
