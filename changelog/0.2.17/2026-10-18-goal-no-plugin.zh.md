# 未安装 goal 插件时的目标模式不再在列表里留下空对话

- **Date:** 2026-10-18
- **Type:** fix
- **Scope:** `web`, `server`, `cli`
- **PR:** [#1205](https://github.com/Prism-Shadow/penguin-harness/pull/1205)

[English](2026-10-18-goal-no-plugin.md)

在未安装 goal 插件的 Agent 上从新对话发起目标，侧栏可能留下一行、点开却显示「还没有 Session」：服务端建好 Session 后拒绝了它的首条 Task，页面随即删除了它——但侧栏在收到新会话通知时发起的刷新已经读到了它，又把它放回了列表。现在挂上目标模式时输入区即提示缺少插件并可一键安装；首条 Task 被拒的对话不再留下任何东西。

## 细节

- 挂上 goal chip 时，输入区按该对话的 Agent 检查已装插件（Agent 在机器上时查那台机器上的）。缺少 goal 插件时，输入区上方提示目标模式需要它并提供「安装到此 Agent」，同时禁发；安装前不创建任何东西。安装失败以 toast 说明原因，提示保留。读不到插件列表时不禁发，仍由服务端拒绝兜底。
- 为首条 Task 创建的 Session 若随后被拒或失败——新建对话页、`/model` 与 `/agent` 皆然——先从列表移除，再在服务端删除；列表也不再显示本页已知被删除的会话，不论它来自哪一份应答。获取列表期间收到删除时，该次获取作废并重取，计数随之准确。
- 服务端对未装 goal 钩子包的 Agent 在载入 Session 之前即拒绝目标，不再载入后才答 `goal_plugin_not_installed`。
- `penguin chat`：服务端拒绝刚建 Session 的第一条消息时（4xx，如未装插件的目标、缺少 credential 的模型），删除该 Session 并保留消息，与创建 Session 失败时相同；下一次回车以相同设置重新创建。它不再作为空对话留在每个 Web 侧栏里。
- 新增 Playwright 场景（`packages/web/e2e/goal-no-plugin.spec.mjs`）：在侧栏应答被延迟时发出一个被服务端拒绝的目标，检查列表不留下任何一行，再从提示一键安装插件并发送。它随整套浏览器用例运行（`pnpm --filter @prismshadow/penguin-web test:e2e`），不进 CI 的冒烟任务。
