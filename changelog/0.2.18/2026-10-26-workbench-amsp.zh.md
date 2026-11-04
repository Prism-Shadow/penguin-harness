# Workbench 经 AMSP 实时跟随 Agent

- **Date:** 2026-10-26
- **Type:** feature
- **Scope:** `server`, `web`, `skills`, `docs`
- **PR:** [#1350](https://github.com/Prism-Shadow/penguin-harness/pull/1350)

[English](2026-10-26-workbench-amsp.md)

工作台现在可以在 Agent 工作时实时跟随自己发起的会话，读的是与对话视图相同的 AMSP 记录，不必再轮询到回答写完才看到结果。AMSP 本身没有变化。发起任务、保存结果和其他副作用仍由工作台的处理器完成，用 `sessionResult` 读取结果、定时轮询的做法照常可用。设计见 PRFC-0023（[penguin-harness-design #391](https://github.com/Prism-Shadow/penguin-harness-design/pull/391)）。

## 细节

- 页面：应答工作台的服务端在 `GET …/workbenches/:id/sdk/workbench.js` 与 `…/sdk/amsp.js` 提供页面 SDK。`ui/` 下的页面引入 `../sdk/workbench.js`，即可使用 `followSession`、`abortSession`、`apiBase`、`transport` 以及 `@prismshadow/amsp` 导出的全部内容。页面经当前登录用户的入口 `GET /api/sessions/:id/amsp` 读取，因此其他机器上的工作台和 `pnpm dev` 下的工作台都以同样的方式跟随。它取代了 AMSP 设计中提到、却一直没有服务端提供的 `/workbench-sdk/amsp.js`。详见[Workbench 页面从自己的服务端加载 AMSP 页面 SDK](2026-10-26-workbench-page-sdk.zh.md)。
- 服务端代码：`WorkbenchHost.subscribe(sessionId, listener)` 在会话记录写出时交给监听函数，并返回停止订阅的函数。重载或移除工作台会结束它的全部订阅。详见[Workbench 的处理器可以实时跟随 Session](2026-10-26-workbench-host-subscribe.zh.md)。
- 外观：工作台页面获得应用的主题、强调色、字体与设计令牌。`/workbench-ui.css` 保留原有的 `--wb-*` 变量与 `wb-*` 类，改为映射到应用的令牌，并新增色调颜色 `--wb-tone-<tone>-{fg,bg,line}` 以及按 `data-tone` 着色的状态徽标 `wb-badge`。详见[工作台页面经 Token 契约跟随应用主题](2026-10-26-workbench-theme-tokens.zh.md)。
- PenguinHarness Support：问题运行时，对话框随生成显示回答，用一行平实的话说明 Agent 正在做什么，并提供需要确认的**停止**按钮；任务一结束，问题即显示为已回答，状态以色调徽标显示。已安装的副本以插件更新的形式获得这一版本。详见[PenguinHarness 客服边写边显示回答](2026-10-26-penguin-support-live.zh.md)。
- Skill 与文档：`penguin-plugin` Skill 新增「Follow the Agent live (AMSP)」一节，其 `scripts/check.mjs --follow <sessionId>` 按页面收到的样子逐条打印会话记录，直到主会话的 `task_end`。`penguin-sdk` Skill 写明工作台不走它的两种方式。文档见「技能与插件 › Workbench 插件」和「Agent API › 在浏览器中」。
