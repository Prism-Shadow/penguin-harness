# 随构建发布的插件的 Web 半在构建期经槽并入 Web App

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `web`, `web-plugin`, `server`, `library`, `ui`, `ui-gallery`
- **PR:** [#1648](https://github.com/Prism-Shadow/penguin-harness/pull/1648)

[English](2026-11-19-plugin-web-seams.md)

随构建发布的插件现在可以带上自己的界面：`./web` 导出指向其 `src/web/` 下的 TypeScript，与 Web App 一起编译，Web App 把其中的模块与自己的模块一同启动（penguin-harness-design [#489](https://github.com/Prism-Shadow/penguin-harness-design/pull/489)）。Agent 浏览器的 Web 半如今只经这条路、经下列新接缝触及 Web App，因此可以原样移入它的插件。界面上没有任何变化。

## 细节

- Web App 的 `gen:ifaces`（`scripts/gen-web-table.mjs`）先写出依赖中各 Web 半的生成清单（`src/plugin-web.gen.ts`，不入版本库；依赖未安装即报错，导出可带嵌套条件），再把各包的 `tsconfig.web.json` 一并读进 Web App 自己的接口表，这张表现在只读 `src/`（`tsconfig.app.json`）；typecheck 与 test 另写 `test/ifaces.json`，供测试启动自己的模块。`bootWeb()` 把清单里的每个模块作为根的又一个子节点启动。Tailwind 与 Web App 的源码检查（去 AI 味、控件尺寸、层级）扫描 `plugins/*/src/web`。
- 新增私有包 `@prismshadow/penguin-web-plugin`：Web 半引入 Web App 的唯一入口。Web App 在启动前把自己的 `apiFetch`、`ApiError`、报错与提示条工具、打开设置、停靠操作、日期格式与色调表交给它（`web-app/plugin-host.ts`）；`defineStrings` 让插件自己的中英两张表随界面语言切换，表中的 `apiErrors` 在 Web App 自己的错误码之后查找。`@prismshadow/penguin-web-plugin/testing` 为插件自己的测试交出一个替身宿主。
- 新增槽：`SettingsModule.sections`（按 order 与自带页混排的设置页）、`ChatModule.sessionHandovers`（对话换 id 时随之移交的内容）、`ChatModule.linkActions`（网页链接菜单中排在自带行之前的行）、`DockModule.scopeListeners` 与 `DockModule.layoutListeners`、`DockModule.panels` 数据半的 `lead`（空停靠栏选单中排在最前），以及 `WebAppModule.serverModules`。
- 在 `WebAppModule.serverModules` 声明了服务端模块的 Web 模块，只在 `GET /api/contributions` 的新字段 `modules`（本代由插件提供、正在运行的服务端模块）列出该模块时画出：页面与页面渲染器、图层、停靠面板、设置页、Session 标签页、文件渲染器、侧栏区块、模式与徽标、会话行菜单项与标记、链接菜单行。它不能贡献 session provider 与侧栏区块的 scope。平台重组后服务端在每个用户通道发出 `contributions_changed`，页面收到它或 `resync_required` 即重读；读失败按递增的间隔重试，首个应答到达前沿用本浏览器为该账号上次记下的名单（`penguin.serverModules.<账号>`，install 作用域）。画廊答它的 Web 模块声明过的每个服务端模块都在运行。
- Agent 浏览器经这些槽贡献它的两页设置、链接菜单行、草稿到 Session 的交接、作用域与全屏通知以及选单首位；它的文案、接口封装、起始站点、导入途径与光圈样式移入 `features/builtin-browser/`。画廊的模拟接口覆盖检查改为逐一调用每个 `features/*/api.ts` 与每个 Web 半导出的 `api`，不再手写清单。与其他贡献者同键的设置页、同名的链接菜单行被丢弃，并在控制台说明。
