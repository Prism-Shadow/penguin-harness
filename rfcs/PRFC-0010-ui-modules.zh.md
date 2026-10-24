# PRFC-0010 UI Modules：Web App 是一棵模块树，页面与全局 UI 都是贡献

[English](PRFC-0010-ui-modules.md)

> **来源**：设计仓 [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) 的 `rfcs/PRFC-0010-ui-modules.md`——草案，见设计 PR [#317](https://github.com/Prism-Shadow/penguin-harness-design/pull/317)（open）。
> **修订**：v1.0.0（迁入主仓，取草案当前版本）；本面的约定见 [README.zh.md](README.zh.md)，逐版本改动记在文末 `## Changes`。

- Feature Name: `ui_modules`
- Start Date: 2026-10-13
- PRFC PR: [Prism-Shadow/penguin-harness-design#317](https://github.com/Prism-Shadow/penguin-harness-design/pull/317)

## Summary
[summary]: #summary

Web App 的前端不再是一份 import 出来的整块，而是一棵 **kernel module tree**：与服务端同一套机制（PRFC-0001 的 `@Interface` / `@Component` / `@Module`，同一份由 `gen-ifaces` 生成的 `ifaces.json`，同一个「整棵树在第一个节点运行之前先校验」的 boot）。本 PRFC 定下六件事：

1. **首次渲染前启动。** 组合根 `web-root.ts` 是唯一 import 各 `module.ts` 的文件；`bootWeb()` 装配整棵树、交回应用要挂载的根组件。启动不联网、耗时数毫秒。
2. **组合模块名为 WebApp。** `WebAppModule` 提供接口 `WebApp`（成员 `webApp`，持根组件 `Root`），住在 `web-app/` 目录。应用布局、路由与页面表归它；**路由全部来自 `pages` 槽位**，贡献键按模块名寻址：`"WebAppModule.pages"`。
3. **feature 的一切 UI 以命名槽位到达，基座不 import 任何 feature。** 登录会话的 provider（`sessionProviders`）、每页旁挂一次的层（`layers`）、builtin 页面的渲染器（`pageRenderers`）挂在 WebAppModule 名下；用户事件流的认领分发挂在 SessionsModule 名下（`userEvents`）；侧栏的分区、模式与徽标挂在 SidebarModule；停靠面板挂在 DockModule；会话旁的标签条挂在 ChatModule。会话列表的行操作（`SessionListModule.rowActions`）与草稿接口（`ChatDrafts`）同样只经接口取得。
4. **服务端贡献的页面折进同一张页面表。** `GET /api/contributions` 只剩一个读取方（`web-app/contributions.tsx`）：fetch、失败与合并都在这一个文件里，路由与侧栏经 `useWebAppPages()` 读合并后的表，不知道页面来自哪里。`iframe` 页由 WebApp 自己画，`builtin` 页按名字取 `pageRenderers` 槽位的组件，冲突跳过、编译期页面优先。
5. **恢复面常驻组合根之外。** 路由根的错误边界之外挂唯一的命令面板与安全模式标记；启动装配失败时以兜底根渲染同一个恢复面板。恢复入口不跟随坏页面或坏树消失。
6. **命名与兼容的边界。** 组合模块的内部寻址（模块类名、接口、成员、目录、贡献键）随**同一个 bundle** 一次迁移到 WebApp 词汇，不为旧的 ShellModule 寻址留别名；已发布的 `frame: "shell" | "bare"` 是**布局判别值**，不是模块地址，原样保留；terminal 页本身仍是一个 `frame: "bare"` 的页面贡献，真实的 PTY、terminal 与 desktop/server 宿主 shell 一概不在本设计内、不改动。

## Motivation
[motivation]: #motivation

改造之前的前端是四笔账：

- **加一页要动基座。** `router.tsx` import 每个 feature 的页面组件才能挂路由，页面清单是一份手工维护的 manifest；侧栏的标题与图标按 key 在基座里查表。页面本该是 feature 的声明，却长在组装处的代码里。
- **挂一次的东西由基座点名。** `RequireAuth` 写着 `CompanyProvider`；`AppLayout` import 四个 feature 的运行时组件才挂上停靠运行时、快捷键、内置浏览器与命令面板；用户事件流一到，分发函数直接调用 company、内置浏览器与定时任务各自的发布函数。基座认识每一个 feature，feature 就永远搬不走——company 将来要迁出成插件，缺的就是这些接缝。
- **feature 互相 import 内部文件。** workspace 浏览与模型选择被十几个 feature 当作 chat 的内部文件引用；chat、dock、traces、messaging 互相点名；侧栏与聊天页各自长到三千行上下，任何改动都要先读完整个文件。
- **词撞车。** 组合模块此前叫 shell：terminal 页本身就是一个 shell，宿主侧另有 desktop/server shell，检索「shell」三处都命中，阅读与写码都要先问「哪个 shell」。

这与 PRFC-0001 在服务端解决的是同一组问题——那只什么都装的 `AppDeps` 在前端的化身，就是 router 的 import 表与点名的挂载。服务端把业务面收进一棵树之后，前端是下一个现场：机制现成（PRFC-0014 已让 Workflow 的标签页经 `WebModule.sessionTabs` 以数据形式向 Web 贡献），缺的是前端自己也站到同一套机制上，让「贡献一个页面」与「贡献一条路由」成为同一件事。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 组合根

`web-root.ts` 是前端的 `platform.ts`：一个 `@Module` 的 `children` 列出 `WebAppModule` 与各 feature 模块，是唯一 import 任何 `module.ts` 的文件。`bootWeb()` 用生成的接口表走 `moduleDefOf` + `bootModules`（树的 resource registry 为空实现——前端树不 park 任何东西），返回根组件；`main.tsx` 等安装作用域与它都完成后再 mount。`packages/ui-gallery` 里框内演示的 app 走同一个 `bootWeb()`，不另装配一套。

`ifaces.json` 由 `gen-ifaces` 从本包源码静态读出、不入库；`dev` / `build` / `typecheck` / `test` 都先生成它。启动无网络请求，耗时数毫秒——内核与其校验依赖是入口包里的一笔固定体积，见 Drawbacks。

### 加一个页面

在该 feature 的 `module.ts` 里加一条贡献与一个绑定，基座零改动：

```ts
@Module({
  contributes: {
    "WebAppModule.pages": [
      {
        id: "terminal.page",
        key: "terminal",
        path: "/terminal",
        frame: "bare",
        nav: "none",
        admin: false,
        released: true,
        order: 100,
      },
    ],
  },
})
export class TerminalModule {
  @Bind("terminal.page") page = TerminalPage;
}
```

数据半声明路由与归属（key、path、frame、nav、admin、released、order），代码半是画这一页的组件。侧栏与路由都读页面表，页面在表里的次序就是导航的次序。

### 基座从槽位拿到的东西

- **`sessionProviders`**：登录会话的 provider，挂在 `Project + Sessions` 之内、按 `order` 由外到内嵌套。company 的状态由 company 模块自己贡献，不再被 `RequireAuth` 点名。
- **`layers`**：每页旁挂**一次**的 overlay 与无头运行时——停靠运行时、快捷键、内置浏览器、命令面板——`AppLayout` 在原位置依次挂出，不取 props、不闭包。
- **`userEvents`**：用户事件流（`/api/events`）的认领分发。各 feature 绑定自己的处理器，声明认领哪些事件；列表自己的事件照旧先处理，`resync_required` 时先清空重取再叫各处理器的 `resync`。
- **侧栏**：分区（`sections`）、工作模式（`modes`）、行上徽标（`navBadges`）。框架只画切换器、页面导航、账户行，装什么由贡献决定。
- **停靠面板**（`DockModule.panels`）与会话旁的**标签条**（`ChatModule.sessionTabs`）：面板与标签由所属模块贡献，chat 与 dock 不再点名。
- **接口**：会话列表的行操作（`rowActions`）、chat 的草稿（`ChatDrafts`）——基座与 feature 之间要握手的东西一律走接口，不走 import。

### 服务端贡献的页面

服务端的模块与插件也能给 Web 贡献页面：`GET /api/contributions` 的答复折进同一张页面表。按登录用户取一次，换用户即丢弃重取；请求进行中兜底路由不渲染，直接打开贡献页的 URL 不会被送走；失败不重试，表里只剩编译期页面——**没有哪个贡献页是承重的**。一个 builtin 页面按名字取 `pageRenderers` 槽位里的组件，本 build 没带的名字跳过；iframe 页由 WebApp 自己的 FramePage 绘制。

### 恢复面

命令面板在路由根的错误边界之外、全应用唯一一份；安全模式按标签页记在 sessionStorage（`?safe` 在首次渲染前生效并移出地址栏，存储不可用回落内存）；启动装配失败时以兜底根画同一个恢复面板。安全模式下贡献的取数被禁并清空，拒绝在途旧答复，离开后重取。

### 谁不叫 shell

组合模块叫 **WebApp**。`PageData.frame` 的两个取值 `shell` / `bare` 是**已发布的布局判别值**——「带不带应用布局」——不是任何模块的名字，保持原样。terminal 是页面表里 `frame: "bare"` 的一页；PTY、terminal 会话 shell、desktop/server 宿主 shell 与 `desktop_shell_only` 这类宿主权限词都不在本设计内。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### 启动

```ts
export async function bootWeb(): Promise<ComponentType<AppRouterProps>> {
  const tree = await bootModules(
    moduleDefOf(WebRoot, { manifests: table.modules as unknown as ManifestTable }),
    { ifaces: table as unknown as IfaceTable, resources: NO_RESOURCES },
  );
  return tree.api<WebApp>("WebAppModule", "webApp").Root;
}
```

- 组合根 `WebRoot` 的 `children`：`WebAppModule` 与各 feature 模块（chat、agents、models、plugins、machines、ports、usage、benchmark、dashboard、terminal、workflows、company）。新增一个 feature 模块＝在 `children` 里加一行，别处不改。
- `ifaces.json` 不入库：`gen-ifaces` 进入 web 的 `gen:ifaces`，`dev` / `build` / `typecheck` / `test` 先跑它；根目录的 `gen:ifaces` 同时生成 web 的表。
- 装饰器不降级：web 与 ui-gallery 的 Vite 配置给 esbuild 指定 `target: "es2022"`。
- 体积：内核依赖使生产包入口 chunk 增加约 184 kB（gzip 约 +55.5 kB，其中 arktype 约 47 kB），无法 tree-shake；启动耗时约 2–3 ms。已接受，见 Drawbacks。

### WebApp 与它的槽位

```ts
@Interface()
export abstract class WebApp {
  /** The whole routed app, everything it renders under WebApp's bindings. */
  abstract readonly Root: ComponentType<AppRouterProps>;
}

export interface WebAppSlots {
  /** A routed page; its component is the code half. */
  pages: Slot<PageData, ComponentType>;
  /** Providers of the signed-in session, mounted inside Project + Sessions, outermost first. */
  sessionProviders: Slot<Ordered, ComponentType<{ children: ReactNode }>>;
  /** Mounted once beside every page: overlays and headless runtimes. */
  layers: Slot<Ordered, ComponentType>;
  /** A builtin page the server can name in a contribution; resolved by its name. */
  pageRenderers: Slot<PageRendererData, ComponentType>;
}
```

- 槽位键按**提供方的模块名**寻址（`"WebAppModule.pages"`），槽位声明挂在它提供的**接口**上（`WebAppSlots` 伴着 `WebApp`）——与服务端 `HttpModule.routes` / `HttpSlots` 同一个分法：模块名是稳定寻址，接口是类型所在。
- `Ordered` 只有一个成员 `order`：同一槽位的贡献按它升序排，先到先挂。次序是数据、不是树的形状（PRFC-0001 的同一句）。
- `WebAppModule` 在 `setup()` 里把三面贡献（pages 按 `pageTableOf` 整理、providers 与 layers 按 `order`）连同用户事件处理器表一起绑进根组件；它还 `@Use` 侧栏接口 `Sidebar` 与草稿接口 `ChatDrafts`，把布局要用的东西一并递进去。

### `PageData` 与页面表

```ts
export interface PageData {
  key: string;
  path: string;
  /** "bare" mounts outside the app shell (no sidebar, no Project context): the terminal, a workflow's app page. */
  frame: "shell" | "bare";
  nav: "main" | "none";
  admin: boolean;
  /** Built but not yet offered: reachable by URL and tests, hidden from the nav. */
  released: boolean;
  /** The page's place in the table, and so in the nav. */
  order: number;
}
```

- `frame: "bare"` 的页面挂在**同样要求登录**的裸布局下（无侧栏、无 Project 上下文）：terminal 页与 workflow 的全页应用。`frame: "shell"` 的页面挂应用布局。两个取值是已发布的判别值，保持不变。
- `pageTableOf` 把贡献按 `order` 排成 `WebAppPage[]`（补上贡献 id 与绑定的组件）；`navPagesOf` 取主导航页面。标题与图标在数据里（`title` / `titleZh` / `icon`，`icon` 是 UI 包图标注册表里的名字），基座不再持有按 key 查的表。
- 路由：应用布局内的页面挂在登录门下，`bare` 页面挂在裸门下；`/login` 与兜底路由不变。首页改由 company 模块贡献一条 `path: "*"` 的页面（`HomeRedirect`，按当前模式重定向），路由不再自带 index 与 catch-all、不读 company 状态。

### 服务端贡献的折入（`web-app/contributions.tsx`）

- **store**：`createContributionsStore(fetch)` 按登录用户取一次；用户切换时丢掉上一位的答复并重取，迟到的旧答复丢弃；登出清空；失败不重试，表回落为编译期页面。`refresh()` 为当前用户重取（插件安装或移除后），失败保留已有答复。
- **合并**：服务端页面以 `frame: "shell"` 追加在编译期页面之后，保留其声明的 renderer 与 `released`。key 或 path 与编译期页面（及 `/login`）冲突的条目跳过——**插件加页，不遮应用的页**。`iframe` 页由 `FramePage` 绘制（沿用工作流 iframe 的主题拷贝、按键转发与 sandbox 属性）；`builtin` 按名字取 `WebAppModule.pageRenderers` 里的组件，无人贡献的名字跳过。公司模式页面（`nav: "org"`）的路径相对组织，判冲突前先加根。
- **pending 门**：`WebAppPagesProvider` 挂在路由内；请求进行中兜底路由（company 的 `home`，`path: "*"`）不渲染，贡献页直达不被送走。
- **读取方收拢为一个**：路由、侧栏与公司模式都只读这张表；`useOrgPages()` 成为表上的纯 selector（`nav: "org"` 的服务端页面）；提案页由 `ProposalsModule` 以 `OrgProposalsPage` 之名贡献进 `pageRenderers`，公司模式内外都由它绘制；未读计数锚定在 renderer 的名字上，不写死某个页面的 key。

### 用户事件流（`SessionsModule.userEvents`）

```ts
export interface UserEventHandler {
  event(ev: Opaque<"ServerEvent", ServerEvent>, source: string | null): void;
  resync?(source: string | null): void;
}
```

- `SessionsModule` 提供接口 `UserEventHandlers`（按 `order` 排好的处理器列表）；feature 各自绑定处理器（company、内置浏览器、定时任务……），认领的事件类型互不相交。
- `applyUserEvent`：列表自己的事件（`web_updated`、`session_*`）照旧先处理；`resync_required` 先清空重取，再依次调各处理器的 `resync(source)`；其余事件先交各处理器、列表再处理与自己相关的份额（定时任务刷新列表、workflow 事件派发到 window）。
- `source` 是事件来自的机器、本服务器为 `null`：内置浏览器只认本服务器的 resync，company 认所有来源的——这个差别由各处理器自己声明，分发处不写。

### 侧栏（`SidebarModule`）

- 接口 `Sidebar` 给出三样：`Column`（整条侧栏）、`Rail`（收起的窄栏）与 `useColumnState()`（布局外围要读的：是否在默认模式、抽屉按钮名、聚合徽标说明）。
- 三个槽位：
  - **`sections`**（数据半 `{ mode, place: "header" | "body", order }`）：一个分区。代码半 `{ Scope?, Overlays?, Full, Rail? }`——`Full` / `Rail` 只在其模式为当前模式时挂载；`Scope` 与 `Overlays` 在侧栏存续期间**一直挂载**，承载跨模式切换要保留的状态（会话列表的控制器、对话框），切换开发/公司模式不重置任何东西。
  - **`modes`**（数据半 `{ key, title, titleZh, icon, order }`）：默认开发模式之外的工作模式；代码半给出 `useMode()`（是否可用、是否当前、切换并返回要去的路由、该模式的导航行）。
  - **`navBadges`**（数据半 `{ anchor, order }`）：导航行（页面 key）、账户行（`account`）、手机抽屉按钮（`menu`）上的标记；代码半是 `useNote()`（圆点与说明）或 `Mark`（行尾组件）。
- 贡献方要实现的形状放库文件（`lib/sidebar-contributions.ts`），贡献方不 import 侧栏框架；`DEFAULT_MODE` 为 `"dev"`。
- 会话列表：`SessionListModule` 向 `sections` 贡献开发模式分区，`@Use` `ChatDrafts`；它的 `rowActions` 槽收行菜单项、行标记与工作区分组菜单项，贡献项插在重命名与归档之间。草稿归 chat 的接口 `ChatDrafts`（`newChatId`、`useParked()`、`prepareNewChat()`、`useNewChat()`……），会话列表与窄栏不再引用 chat 的内部文件。

### 停靠与会话标签（`DockModule.panels`、`ChatModule.sessionTabs`）

- `DockPanelData`：`{ kind, title, titleZh, icon, order }`。`kind` 是停靠布局存储里的标签键，**跨版本稳定**；`icon` 是图标注册表的名字。代码半 `DockPanel = ComponentType<{ active: boolean }>`——正文在标签存在期间常驻，`active` 是「标签在前且停靠区打开」，轮询以它为门。
- `DockModule` 在 `setup()` 把贡献整理成面板注册表，经 `WebAppModule.sessionProviders` 绑进 React 树；八个面板由所属模块贡献（chat 的 agents 与 memory、workspace、trace、消息绑定、定时任务、内置浏览器、端口转发）。**Browser 标签（`browser:<id>`）不是面板 kind**，chat 页直接渲染。
- 已存布局的格式不变：读入保留全部标签，启动时登记已贡献的 kind，无人贡献的 kind 在内存中丢弃（激活项照现有规则回落），**不改写存储**。
- 会话上下文放库文件（`lib/chat-session.ts`，workspace 与 chat 互相 import，放哪一边的 `index.ts` 都成环）：`ChatSession` 只带外部面板实际用到的字段，`ChatSessionProvider` 同时供会话上下文与 chat 内部的控制器上下文。
- `ChatModule.sessionTabs`：`Slot<SessionTabData, SessionTab>`，`SessionTab` 接收 `{ projectId, agentId, machineId }`。内置 workflows 模块贡献标签条组件（含覆盖聊天的 iframe）；**标签的数据半**——一个 Agent 的 workflow 页面清单——经 `/api/contributions` 抵达，那是服务端树里挂给插件与 Workflow 的槽（PRFC-0014 的 `WebModule.sessionTabs`），前端只消费数据、不复刻其机制。
- 做完后 chat 不再 import traces、messaging、workflows、ports；dock 不再 import chat。

### 恢复面（rescue）

- 命令面板与安全模式标记挂在**路由根错误边界之外**，全应用唯一一份、各自隔离。错误面板给出：错误文本、重新加载、不加载贡献重新加载、Harness 历史。workflow 的整页退出动作向共享面板登记、随卸载撤销。
- `palette.toggle` 默认 `Mod+Shift+P`，可越过对话框，保留用户改绑；Firefox 可能优先占用该键——不声称它是跨浏览器唯一的逃生路径。
- 安全模式按标签页存 sessionStorage；`?safe` 在首次渲染前生效并移出地址栏；存储不可用回落内存；可从面板与标记退出。安全模式下对贡献的取数被禁并清空，在途旧答复被拒，离开后重取。
- 启动装配失败（树校验不过、接口表过时）以 `bootFailedRoot` 渲染**同一个**恢复面板。
- 命令面板与 Harness 历史组件**不作为模块层的贡献**：恢复面在树外，页面加载常驻；其目录归属是一次纯搬家（不夹带行为），安全模式与启动兜底的**行为**属另一条行为层——两者分开交付、分开验证。

### 边界规则

- 任何 `module.ts`（含 `*.module.ts`）只被组合根 import。
- `web-app/`、`state/`、`lib/`、`api/`、`app.tsx` 不 import 任何 feature 的内部文件；feature 之间只经对方 `index.ts` 引用，并参与环检测。
- 以上的每一条都是一条**棘轮基线**：源码扫描测试记录现行的边，只减不增（新边须随改动显式声明）；基线随文件归位只做路径改写与删除。

### 层次与热推送

- Web bundle 是平台载荷的一部分，随一次在线热推送原子送达（05「安装与发布」）；前端树**每次页面加载**重新装配，没有自己的热换机制——本 PRFC 不改 HMR 层、不改运行时。
- 不迁移持久数据：localStorage 里的导航折叠与常驻键值、停靠布局的存储格式、页面 key、HTTP 数据与存储键全部不变。

### 命名与兼容

- 组合模块的内部寻址（`WebAppModule` / `WebApp` / `webApp` / `web-app/` / 贡献键）随**同一个 bundle** 一次迁移；调用方与贡献方同包同发，**不为旧名留别名**——这是内存态契约，无持久消费方，硬升级成本最低（PRFC-0002 对 registry id 的同一判断）。
- `frame: "shell" | "bare"` 是已发布的数据取值，不是模块地址，原样保留。
- terminal 页、PTY、terminal 会话 shell、desktop/server 宿主 shell、`desktop_shell_only` 宿主权限词、UI 包的 `AppShell` 布局组件：一概不在本设计内、不改动。

### 迁移与合入次序

设计先落地：本 PRFC 的合入是各层代码合入的前提。代码按一条栈推进，每层的净改动在批准前对照本文逐节核对；次序由依赖决定：

1. **边界棘轮与文件归位**——先立扫描基线，后续每层才有「只减不增」可依。
2. **组合根与 `pages` 槽位**——树先立起来，页面先成为贡献。
3. **全局槽位**（`sessionProviders` / `layers` / `userEvents`）——基座点名的三处改为贡献。
4. **侧栏拆分**，随后**侧栏槽位**——先按职责拆开，才谈槽位化。
5. **聊天页拆分**，随后**停靠与会话标签槽位**——同一条规矩。
6. **服务端贡献折入**——两个读取方收拢，依赖页面表已在。
7. **恢复面目录归位**——搬家放最后；其行为（安全模式、启动兜底、面板登记）已在独立的行为层交付，不随搬家重复。

三条横切规矩：**纯重构层不夹带行为**（其验收是搬家前后整树等效，不是新测试）；**行为改动只随行为层**；**改名随同一 bundle**——引用新寻址的代码与改名同包发布、不为旧名留别名，因此改名的发布以边界棘轮的真修复为门：红门未解前不发布，也不以修改基线换绿。

## 验证策略
[verification strategy]: #verification-strategy

本节是**拟验证**的清单：写明每一层合入时用什么证明自己没有改坏。本文落笔时一条都未运行——每层的读数随该层的实现评审落档，不在此预填，也不以历史数字替代。按验证对象分：

- **边界与环（棘轮）**：源码扫描测试逐条记录现行的 import 边与环，基线只减不增——新边随改动显式声明，删一条基线必须给出「这条边为什么真的不存在了」的核对，不为凑绿机械增删；环检测照常。改名的候选当前正停在一次这样的核对上（两个用例红）：红门未解前不发布。
- **装配与页面**：单测以真实组合根启动——页面表的唯一性、每个 key 的代码半已绑定、`frame` 划分、主导航的次序与 `admin` / `released` 同改造前一致、贡献页的 key / path 冲突被跳过、boot 交回可挂载的根组件。
- **槽位生命周期**：sessionProviders 按 `order` 由外到内嵌套；layers 每页只挂一次；userEvents 的分发次序、各处理器认领不相交、`resync(source)` 的来源差别（内置浏览器只认本服务器、company 认所有来源）；侧栏分区的 `Scope` / `Overlays` 在模式切换间常驻（切换不重置任何状态）、`Full` / `Rail` 只在所属模式为当前时挂载；dock 面板启动时注册、已存布局完整读回（无人贡献的 kind 只在内存丢弃、存储不改写）、`active` 门控轮询；会话标签条按贡献绑定。
- **贡献与用户换代**：store 语义逐条——按登录用户取一次、换用户丢弃并重取、迟到的旧答复丢弃、登出清空、失败只剩编译期页面、`refresh` 失败保留已有答复；请求进行中兜底路由不渲染；安全模式禁取、清空、拒在途旧答复、离开后重取。
- **纯重构层**：搬家前后源码按明确的路径替换逐字相等、调用方只改 import、后继整树等价——**等效本身就是验收**，不新增测试；既有守卫测试改路径后原断言不变。
- **动态面（照实未测）**：正常 socket 流、真实浏览器交互（focus / Escape / 对话框）、Electron、热推送回滚；SSR 或手工状态的检查只证明 fallback 文本，不冒充真实客户端验证。这些须在真实机器上跑，本文落笔时均未运行。

## 落地状态
[status]: #status

**设计先行，实现分层推进中；本文描述的是目标契约，不以未发布的候选充当已落地实现。**

- 第一层（模块边界棘轮与文件归位）已有开放的实现 PR；其余各层在一个未合并的分支栈上逐层推进，尚未开出全部实现 PR。任何一层合入前，其净层须与本文逐节核对。
- 组合模块此前以 Shell 词汇实现于未合并的分支上；按本 PRFC 选定的 **WebApp** 名称所做的改名候选已准备、**未发布**——尚无任何分支带着新名推送，发布被一处边界棘轮的基线核对（两个用例）挡住，修复在另一条线进行。本文一律以 WebApp 词汇书写契约。
- 恢复面的行为（安全模式、启动兜底、面板登记）已从目录搬家中拆出、单独成层交付与验证；两条实现基底（含非模块化的先行修复与模块化适配）分别登记，不以其中一条冒充另一条。
- 本 PRFC 只覆盖上述八面：组合根与页面、全局槽位、侧栏、聊天页拆分与停靠/标签槽位、服务端贡献折入、恢复面归属。同一张页面表的后续伸展（页面父子、按页文件渲染器、服务端驱动的页面移除）是后续层，不在本文范围内。

## Drawbacks
[drawbacks]: #drawbacks

- **入口包的固定成本**：内核依赖使入口 chunk 增加约 184 kB（gzip 约 +55.5 kB）。这是为「整树先校验再运行」付出的价；已接受。
- **贡献键按模块名寻址，改名要全 bundle 同步**：组合模块自己这次从 Shell 改到 WebApp 就是例证——所以第一次就把名字选对；也因此不为旧名留别名（留了别名，下次改名要同步两套）。
- **迁移是一条多层栈**，不是一次替换：期间「设计词」（本文）与「未合并分支上的现名」有一段并存；各层合入顺序由交付面决定，本文不锁。
- **`frame` 的取值与模块名分属两层**，`"shell"` 一词仍在 `PageData` 里——它是已发布判别值，保留它换取存储与数据兼容，读者需记得它不是模块地址（本文两处声明）。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**为什么叫 WebApp。** 组合模块原先叫 Shell，与三处撞车：terminal 页（一个 shell）、宿主 shell（desktop/server/HMR）、以及 UI 包既有的 `AppShell` 布局组件。候选里比较过：**Workbench**（产品语义强，但中文译名会与 Workspace 相混）；**WebFrame**（偏布局画框，盖不住页面表与全局槽位，且与 `PageData.frame` 撞词）；**WebHost**（与 host 分层再次相撞，最差）；**AppShell**（保留 Shell 词根，且与 UI 包同名组件冲突）。WebApp 覆盖组合模块的全部职责——根组件、路由、页面表、后续的全局槽位——又不暗示命令解释器，是唯一不与既有分层词相撞的候选。

**为什么复用 PRFC-0001，而不是前端自造一套依赖注入。** 前端的问题与服务端同形（谁声明需要什么、怎么换、跨编译怎么判），机制现成意味着：同一份 `ifaces.json` 的签名级数据、同一个整树校验、同一套贡献寻址。自造一套轻量 DI 看似省了内核体积，代价是将来第三方（插件、Workflow）向前端贡献时，跨编译的接口比较又要发明第二遍——PRFC-0014 已经让 Workflow 经服务端树走到这一步了。

**为什么页面表归组合模块、服务端贡献折进同一张表。** 同一个接口此前有两个各自取数、各自合并的读取方，提案页还被路由与公司模式各自硬编码导入。收为一处后，换接口只动一个文件；「一个页面两种来路、一张表」也消掉了「贡献页要不要进主导航」的第二套判据——它就是表里的一行。

**为什么恢复面在树外。** 命令面板若作为模块层的贡献，坏页面或坏树会把它一起带走，恢复入口随之消失。把它挂在错误边界之外、启动失败另有兜底根，恢复路径不依赖任何被恢复的对象。它带来的代价——命令面板不能由 feature 贡献项扩展——由宿主动作登记（workflow 整页退出）那一半补足。

**为什么不给旧寻址留别名。** 前端树的寻址是 bundle 内部的内存态：调用方与被调方同一次构建产出，同包发布。别名只在「两次独立编译的边界」（插件、Workflow）上换来真实兼容，而那两侧用的是数据（`/api/contributions`）不是前端树的寻址。为一个无持久消费方的名字背永久双名，是 PRFC-0002 已否决过的账。

## Prior art
[prior-art]: #prior-art

- **PRFC-0001「Module」**：机制本身与服务端的第一次应用；本文是「前端那棵树」的落地——它在 Guide 里预告过这一步。
- **PRFC-0014「Workflow」**：第一条真正由第三方抵达的 Web 槽（服务端树里的 `WebModule.sessionTabs`，以数据经 `/api/contributions` 抵达前端）；本文把它在前端的着落点收进 `ChatModule.sessionTabs` 的统一形状。
- **服务端 `HttpModule.routes`**：槽挂接口、键按模块名寻址的分法，WebApp 的槽位是同一个形状。
- **PRFC-0002「HMR」**：内存态契约不留别名的同一判断。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 第三方代码（插件、Workflow）将来**直接**向前端树贡献前端半的形态：今天服务端贡献一律以数据折入、渲染组件由平台 bundle 携带；若要第三方带组件半，跨编译的接口校验在前端一侧怎么跑（PRFC-0014 的判定机制可复用多少）仍开放。
- 命令面板默认键的跨浏览器唯一性：Firefox 可能优先占用 `Mod+Shift+P`；改键面已有，是否需要一个不与浏览器原生行为相争的默认键，留用户定。
- 前端树自身的运行时扩展（不整包热推送、单独换前端模块）是否需要：今天 Web bundle 随平台原子送达，树每次页面加载重建，没有单独热换的需求面。

## Future possibilities
[future-possibilities]: #future-possibilities

- **同一张页面表继续长**：页面的父子（导航行的缩进层级）、按页的文件渲染器、服务端驱动的页面移除——同一槽位族的后续层，本文的合并与判冲突规则直接复用。
- **服务端贡献伸展到页面之外**：侧栏分区、徽标、停靠面板以数据形式从服务端抵达（今天这些槽只收编译期贡献）。
- **一个插件带着前端半**：跨编译校验落地后的自然终点——插件在服务端树贡献数据、在前端树贡献组件，两侧同一份清单。

## Changes

### v1.0.0

- 新增：迁入主仓；正文取设计仓的同一版本，与英文版逐节对应。
