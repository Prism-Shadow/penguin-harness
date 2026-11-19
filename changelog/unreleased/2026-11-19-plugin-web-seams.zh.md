# 随构建发布的插件的 Web 半在构建期经槽并入 Web App

- **Date:** 2026-11-19
- **Type:** refactor
- **Scope:** `web`, `web-plugin`, `server`, `ui-gallery`
- **PR:** [#1648](https://github.com/Prism-Shadow/penguin-harness/pull/1648)

[English](2026-11-19-plugin-web-seams.md)

随构建发布的插件现在可以带上自己的界面：`./web` 导出指向其 `src/web/` 下的 TypeScript，与 Web App 一起编译，Web App 把其中的模块与自己的模块一同启动（penguin-harness-design [#489](https://github.com/Prism-Shadow/penguin-harness-design/pull/489)）。Agent 浏览器的 Web 半如今只经这条路、经下列新接缝触及 Web App，因此可以原样移入它的插件。界面上没有任何变化。

## 细节

- Web App 的 `gen:ifaces`（`scripts/gen-web-table.mjs`）先写出依赖中各 Web 半的生成清单（`src/plugin-web.gen.ts`，不入版本库），再把各包的 `tsconfig.web.json` 一并读进 Web App 自己的接口表；`bootWeb()` 把清单里的每个模块作为根的又一个子节点启动。Tailwind 扫描 `plugins/*/src/web`。
- 新增私有包 `@prismshadow/penguin-web-plugin`：Web 半引入 Web App 的唯一入口。Web App 在启动前把自己的 `apiFetch`、`ApiError`、报错与提示条工具、打开设置、停靠操作、日期格式与色调表交给它（`web-app/plugin-host.ts`）；`defineStrings` 让插件自己的中英两张表随界面语言切换，表中的 `apiErrors` 在 Web App 自己的错误码之后查找。
- 新增槽：`SettingsModule.sections`（按 order 与自带页混排的设置页）、`ChatModule.sessionHandovers`（对话换 id 时随之移交的内容）、`ChatModule.linkActions`（网页链接菜单中排在自带行之前的行）、`DockModule.scopeListeners` 与 `DockModule.layoutListeners`、`DockModule.panels` 数据半的 `lead`（空停靠栏选单中排在最前），以及 `WebAppModule.serverModules`。
- 在 `WebAppModule.serverModules` 声明了服务端模块的 Web 模块，其图层、停靠面板、设置页与链接菜单行只在 `GET /api/contributions` 的新字段 `modules`（本代由插件提供、正在运行的服务端模块）列出该模块时画出。
- Agent 浏览器经这些槽贡献它的两页设置、链接菜单行、草稿到 Session 的交接、作用域与全屏通知以及选单首位；它的文案、接口封装、起始站点、导入途径与光圈样式移入 `features/builtin-browser/`。画廊的模拟接口覆盖检查也逐一检查它的接口封装。
