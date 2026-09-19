# 工作流：Agent 自己的页面与服务端代码，热重载并可回滚

- **Date:** 2026-08-30
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `skills`

[English](2026-08-30-workflows.md)

Agent 现在可以在自己的目录里保存*工作流*：`workflows/<id>/` 是一个插件包——`package.json#penguin.modules` 里的清单、默认导出把清单与代码按名配对的 `index.ts`、放在 `ui/` 下的页面——服务器把它作为一棵独立的模块树启动。这与服务器自身以及插件所用的是同一套机制，并且一切检查都在工作流的任何代码运行之前完成：类型检查不过、它所依据的接口版本已与本服务器不合、或清单自身不成立的工作流，都会带着具名的问题加载失败，而上一个版本继续服务。

## 契约

根模块 `Workflow` 要求 `WorkflowHost`（服务器以 `Host` 模块发布：限定在本 Project 之内的 SDK 动词——`listAgents()`、`createSession({ agentId? })` 为本 Agent 或同一 Project 的另一个 Agent 开一个 Session，`run(sessionId, [{ text: "…" }])` 在新的或已有的 Session 里跑一轮，Session 正忙时作为后续消息排队——以及 `sessionStatus`、基于工作流 `state.json` 的 `getState` / `setState`、`log`），并提供 `WorkflowMain`——一个 JSON 处理器 `handle({ method, path, query, body })`，服务器把它挂在 `/api/projects/:p/agents/:a/workflows/:id/api/*`。工作流的 `ui/` 从 `…/workflows/:id/ui/*` 提供。不向任何 Agent 的系统提示词添加内容：目录布局与契约由 `penguin-sdk` 技能承载，Agent 被要求做工作流时才加载。

## TypeScript，由服务器检查

工作流以 TypeScript 编写——`index.ts`；只有 `index.js` 或 `index.mjs` 的目录会被拒绝。服务器以入口文件构建一个编译器程序，编译选项由服务器固定（`strict`；目录里的 `tsconfig.json` 不被采用）；同时把默认导出赋给 `WorkflowPackage`，因此无论作者是否写了 `satisfies WorkflowPackage`，形状都会被检查。任何诊断都使加载失败，并以文件、行、列与原因报出；通过的程序被输出到 `<workflow>/.build/<revision>/`——一个点目录，不计入修订、不进版本记录、也不触发监视器——被导入的正是它。编译器现在是服务器的运行时依赖，在第一个工作流需要时加载；没有它的安装不加载任何工作流，并说明原因。

## 类型来自 harness，跨代比较

工作流不安装任何东西：一台机器上可以有多个 harness——发行版、某个检出、别人推送的带着自己接口的平台——它们都不是 npm 上的某个版本。第一次加载时服务器写下 `<workflow>/.harness/`，内容由**这个**平台自己的接口表渲染：`plugin.d.ts`（该工作流里 `@prismshadow/penguin-server/plugin` 解析到的就是它）与 `ifaces.json`（渲染它所用的那一部分表）。此后服务器不再动它——它是「这个工作流写下时依据什么」的记录——直到有人删除。接口比较靠的正是这份记录：在平台自己的表里查一个被依赖的接口，是拿一条声明与它自己比较，永远不会失败；现在两侧各带自己的那一份——工作流的 `.harness/ifaces.json` 与平台的表——各渲染为一份自包含的 `.d.ts`，由 TypeScript 编译器在两个方向上判定：平台的接口须可赋值给工作流所依赖的，工作流所提供的须可赋值给平台所要求的。工作流写下时依据、此后已被删除的宿主方法，是一条点名它的加载错误；平台一侧的新增不影响任何工作流。读不出来的表是问题而绝不算通过；渲染器无法如实写成 TypeScript 的表达式按名拒绝，而不是放宽。插件在加载时接受同样的比较，以每个插件包本来就带着的那张表作为它的一侧；表里没有副本的接口记为未比较并写入日志；程序早于「编译器成为依赖」的安装上，插件照旧加载，日志写明未做比较。

## 标签页是贡献

工作流在清单里向 `WebModule.sessionTabs` 投稿它的标签页——与插件投稿的是同一个槽、同一种写法，由宿主发布进工作流的树并限定于该 Agent：`key`、`title` / `titleZh`，以及 `iframe.src` 指向 `ui/` 下某个文件的 `renderer`。几条投稿即几张标签页；没有投稿即纯服务端的工作流；宿主未开放的槽按名拒绝。列表以 `tabs` 返回它们，各页面的 URL 已解析；报告一次失败的编辑时，保留的是服务着的那个实例的标签页。该槽的形状增加 `title` / `titleZh`，其 renderer 去掉了无人使用的 `namespace`。`ui/` 不再有缺省文档：标签页自己点名页面。

## 重载与回滚

服务器监视 Agent 的 `workflows/` 目录，文件变化时重新加载对应工作流（也可 `POST …/:id/reload`）；输出的代码放在以目录内容哈希命名的位置，改过的模块是一个新的导入 URL，不会从模块缓存里被拿出来。同一个工作流的加载逐次进行，因为每次加载现在都要跑一遍编译器。每次加载的结果写入 `<workflow>/.build/status.json`（`ok`、`revision`、`checkedAt`、`error`、`tabs`）：写工作流的 Agent 手里只有文件、没有 HTTP API 的会话，它由此得知刚才的修改是否加载成功、失败时编译器说了什么；Agent 的第一个 `workflows/` 目录在出现时即被发现，而不必等有人再次列出工作流。每次成功加载都记录在 `workflows-history/<id>/<revision>/`（保留二十个，`GET …/:id/history`），`POST …/:id/rollback { revision }` 恢复该版本的文件——`state.json` 不动——并重新加载。`DELETE …/:id` 连同版本一起删除工作流。Project 的用户会在事件流上收到 `workflow_updated` 与 `workflow_removed`，标签页因此无需刷新即可出现、更新或消失。

## Web App

每一条投稿的标签页都在聊天页顶部、*聊天* 旁边，标题随用户的语言显示；标签页以 iframe 展示其页面（UI 版本变化时重新加载，聊天在其下保持挂载），并显示工作流的版本与修订、当前文件启动失败时的加载错误、*重新加载* 按钮、每个已记录版本带 *恢复* 按钮的 *历史* 折叠面板，以及需点击两次的 *移除*。

## 占满应用

页面可以成为整个应用：`/app/:projectId/:agentId/:workflowId[/:tabKey]` 只显示某个 workflow 的一张页面——该 key 所指的标签页，缺省为第一张——没有侧栏、聊天和标签条。标签页上的 *占满应用* 按钮会跳到这里，页面自己也可以用 `parent.postMessage({ type: "penguin:fill-app" }, "*")` 请求，`penguin web --app <project>/<agent>/<workflow>[/<tab>]` 则让浏览器直接打开到这个页面（spec 不是三段或四段时在启动任何东西之前就报 `Invalid --app`）。这个路由刻意没有任何可点的退出入口；出口是命令面板——它现在同时响应 **Ctrl+Shift+P 与 Ctrl+P**（macOS 为 ⌘），页面拿走其中一个也困不住用户——并在该路由上多出 *退出全页模式（回到聊天）*，会记住 Project 与 Agent 并落到它们的聊天页。

## 主题

工作流页面是独立文档，应用的样式表照不进去。现在框架会在页面根节点打上 `light` / `dark`，把应用*已解析*的令牌复制过去——灰阶、强调色对、字体栈、根字号——并把 `/workflow-ui.css` 注入到 head 最前面：这份基础样式表按应用的观感为纯 HTML（标题、列表、表单、表格、代码）定样，并暴露 `--wf-bg`、`--wf-fg`、`--wf-muted`、`--wf-border`、`--wf-surface`、`--wf-accent`、`--wf-accent-fg`，以及 `wf-primary`、`wf-card`、`wf-rows`、`wf-row`、`wf-muted` 等类。页面自己的规则依然优先；调色板只有一份定义——应用复制它已经解析出来的值，样式表不再重述一遍。切换主题或强调色会直接给已打开的页面换装，无需重新加载。技能要求用这些变量书写标记，因此 Agent 写出的工作流在明暗两种主题下都与用户的主题一致。

`penguin-sdk` 技能记录了目录布局与契约。新建对话页的「搭建和优化智能体」示例新增 **搭建自定义工作流界面：Agent 指挥台**——一个把同一任务并行派给本 Project 多个 Agent、实时显示每个 Session 状态的工作流，另有一张统计标签页与占满应用的大屏视图——取代了原来的 Claude Code 文档 RAG 示例。
