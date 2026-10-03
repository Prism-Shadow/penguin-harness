# Web App 启动一棵 module tree，每条路由都是模块贡献的页面

- **Date:** 2026-10-03
- **Type:** refactor
- **Scope:** `web`, `ui-gallery`

[English](2026-10-03-web-module-tree-pages.md)

Web App 在首次渲染前启动一棵 kernel module tree，与服务端用同一套 `@Module` / `@Provide` / `@Bind` 与槽位。`src/web-root.ts` 是组合根：`WebRoot` 列出各模块，`bootWeb()` 启动它们并返回 WebApp 的根组件；`main.tsx` 等它与 install-scope 的核对都完成后再 mount。组件库画廊的框内 app 走同一个 `bootWeb()`。

路由的页面来自同一个槽位。`web-app/module.ts` 声明接口 `WebApp` 及其 `WebAppSlots`，由 `WebAppModule` 提供；`pages` 槽位的数据是页面的 key、path、frame（`shell` 或 `bare`）、导航位置、admin 与 released 标记和 order，代码半部是页面组件。每个拥有路由的 feature 都有一个 `module.ts`，向 `WebAppModule.pages` 贡献页面并绑定组件：chat（能识别 surface 的 chat 路由）、agents、models、plugins、machines、单台机器的端口、usage、benchmark、dashboard 在应用布局内；terminal 与 workflow 的两条 app 路径在应用布局外；company 只贡献一条 `/org/*`，子路由在它自己的 `OrgRoutes` 里。`src/module.json` 与路由里的 `BUILTIN_PAGES` 删除，`web-app/router.tsx` 不再 import 任何 feature。

kernel 把 arktype 带进了浏览器包：生产包入口 chunk 增加约 184 kB（gzip 约 55.5 kB，其中 arktype 约 47 kB），这是两端共用一个 kernel 的已接受代价。启动耗时 2–3 ms，不发请求。

## 细节

- `src/router.tsx` 搬到 `web-app/router.tsx`，`lib/pages.ts` 搬到 `web-app/page-table.ts`。
- `GET /api/contributions` 的两个读取方（`state/contributions.tsx` 与公司模式的 `use-org-pages.ts`）改从启动后的页面表取 app 自有页面的 key：`contributedPages`（原 `mergePages`）返回可挂在其旁的服务端页面。iframe 页面由 WebApp 自己绘制（`web-app/contributed-page.tsx`）；公司模式的 `OrgRoutes` 把插件贡献的公司模式页面挂在组织布局下，提案页用它自己的组件绘制。公司模式之外以 builtin 名义贡献的页面不再挂载。
- runtime languages hook 搬到 `lib/use-runtime-languages.ts`，路由从公司状态读取首页路径（`useCompany().homePath`）。
- `lib/module-deps.tsx` 新增 `createDeps()`：模块把依赖绑进自己的根组件，其下的组件经 `useDeps()` 读取。WebApp 以此绑定页面表，路由、侧栏与折叠窄栏经 `useWebAppPages()` 读取。
- 侧栏的导航决策（`lib/nav-group-collapse.ts`）改为接收主导航页面列表，不再在加载时读取 manifest。导航顺序与 admin、released 规则不变。
- `ifaces.json` 由 `pnpm gen:ifaces` 生成（web 包的 `dev`、`build`、`typecheck`、`test` 先跑它，根 `gen:ifaces` 也会生成），不入库。
- web 与画廊的 Vite 配置把 `esbuild.target` 设为 `es2022`，dev server 才会降级装饰器。
- 边界测试允许 `web-root.ts` import `module.ts`，其他文件不许；路由 import feature 的基线全部删除（公司模式的路由现在 import 提案页）。
- 用户可见的行为没有变化。
