---
title: Server 启动与子系统
description: 从进程入口到 HTTP 监听的组装顺序、各子系统的对外表面，以及插件在进程级与 App 级两层生命周期中的位置。
---

`server/src/index.ts` 是一个副作用模块：import 它即启动服务——CLI 就是靠这一条契约在自己进程里跑起 server 的。启动次序写在 `main()` 里，每一步是 `PenguinServer` 的一个方法，方法名即步骤名。组装本身又拆成两个函数——`bootAppDeps(config)` 构建运行时核心、发布能力并启动平台（业务面在平台内组装），`createApp(deps)` 组装运行时壳层的 Hono 路由表但不监听——因此测试可以拿到完整的 app 直接 `app.request(...)`，不占端口，也不经过 `index.ts`。

本页回答两个问题：进程从入口到监听按什么顺序把子系统立起来；每个子系统的**对外表面**（surface）是什么——即别人依赖它的方式：导出类型、HTTP 路由、事件，或插件拿到的 context 成员。

## 进程入口

| 进入方式                              | 机制                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 直接运行                              | `node dist/index.js`（`server/package.json` 的 `start`）                                                                                    |
| CLI（`penguin server` / `penguin web`）| 设好 `PORT`/`HOST` 环境变量后**同进程** `import("@prismshadow/penguin-server")`，不 fork；`penguin web` 额外轮询就绪后打开浏览器            |
| Desktop                               | `utilityProcess.fork` 拉起**独立** server 进程，经环境变量注入 `PENGUIN_HOME`、`PORT`、`PENGUIN_DESKTOP_TOKEN`、`PENGUIN_PORT_FILE`         |

三种方式殊途同归：都以同一份环境变量驱动同一个模块。Server 自身的配置只来自环境变量（`server/src/config.ts`）；`system_config.yaml` 是 Agent 级状态，在 Session 运行时才被读取，与 server 启动无关。

## 启动时序

```text
main()  —— 每行一个 PenguinServer 方法
│
├─ ① loadEnv · installProxy        dotenv 先行（.env 自己可能定义 HTTP_PROXY），随后全局代理接管 fetch
├─ ② readConfig                    仅环境变量：PENGUIN_HOME、PORT、HOST、PENGUIN_WEB_DB …
├─ ③ ensureSoleInstance            数据根被另一存活实例持有 → 退出码 3（先于开库）
├─ ④ loadPlugins                   读 <root>/plugins.json → import → 装进本进程唯一的 PluginHost
├─ ⑤ buildDeps = bootAppDeps      开库 → 运行时核心（auth、ChannelHub、HmrHost）→ 发布能力（db/auth/
│                                  channels/config/proxy/desktop/插件 host）→ hmr.ensure() 启动平台：
│                                  其 create() 组装整个业务面（服务、路由、scheduler）并投递插件钩子
├─ ⑥ applyPersistedProxy           库已打开，用持久化的代理设置校准 dispatcher
├─ ⑦ buildApp                      运行时壳层：守卫、/api/auth、/api/desktop、/api/hmr、seam、静态托管
├─ ⑧ seedAdmin                     内置 admin 种子（初始 Project 供给经注册表晚绑定到当前业务面）
├─ ⑨ listen                        开始监听；回调里回填真实端口、取实例锁、写端口文件、开 ::1 伴随监听
└─ ⑩ installProcessHandlers        信号、Desktop 退出路径、进程级错误兜底
```

这个顺序不是随意排的，其中四条是硬约束：代理在任何出站请求可能发生之前接管全局 `fetch`；单实例锁在开库**之前**预检，因为 `web.db` 是单写者；插件在 ⑤ **之前**加载完毕，host 随其他能力一起在平台 boot 前进入注册表，因此首个 App 创建时它们已经在场；平台（连同整个业务面）在 `listen` 之前完成启动，因此**没有任何请求会在业务与插件就位之前被服务**。收尾的 `installProcessHandlers` 排在 `listen` 之后，这样关停流程不会在监听器存在之前被触发。

插件加载排在 `ensureSoleInstance` 之后也是有意的：一个即将以退出码 3 退出的进程不应该先去 import 一堆第三方模块、执行它们的顶层副作用。

## 两级生命周期：进程与 App

运行时核心（DB、认证、ChannelHub、HmrHost）随进程构建一次、活到进程退出。**其余全部是平台层**：整个业务面——服务、路由、SessionManager、Scheduler——连同终端管理器、插件投递、workflow 实例，都在每次 App 创建时重建（每次启动 + 每次热更新，`POST /api/hmr/upgrade` 推送新 bundle）。

```text
进程级（运行时机制，构建一次）              App 级（业务面，每次启动 + 每次热更新重跑）
──────────────────────────              ────────────────────────────────
SQLite · 认证（AuthService）              全部业务服务与路由（services + http/routes）
ChannelHub（SSE 跨 swap 存活）            SessionManager · Scheduler
HmrHost · 资源注册表                      TerminalManager（接管寄存的 pty）
plugins.json 加载（⑤ 发布）                插件模块作为树的子节点创建
```

**swap 语义：未实现 park 的状态一律硬中止**——待审批全部拒绝、运行中任务中止、scheduler 随旧 App 死掉，新 App 从认领的能力重建一切。只有实现了 park/adopt 的资源（终端 pty）跨 swap 存活。

资源本身也有接口契约，但它不进 kernel 的 iface——声明本身就是注册表里的一个条目（`resource-interfaces`，按 ID 前缀组记版本，如 `{ terminal: 1, platform: 1 }`），由每代 App 的 `create()` 写入并留给继任者。新 App 在 adopt 任何东西之前读前任的声明、与自己编译期的声明比对：同版本的组整体集成存续；版本不同或本代不再声明的组，按**逆注册序**逐一 dispose 后重建（活对象无法像 context 文档那样 strict-parse，声明一致就是集成的判据）。kernel 的 park/validate/swap 机制不参与也不感知这套约定，因此调和策略本身也随平台热推送演进。运行时能力（`runtime:*`）走另一条对称防线：bundle 编译期携带能力契约版本，`claimRuntimeCapabilities` 先与运行时发布的版本握手，不符则整组拒领、退化为 terminals-only，而不是在使用时抛 TypeError。

分界线是**资源注册表**：它位于可重载的平台树之外，因此跨 App 存活。pty 进程本身寄存在里面，新 App 只是接管句柄——所以热更新对正在敲终端的人不可见；PluginHost、DB 句柄、认证服务、SSE hub 走的是同一条路：运行时发布进注册表，每个 App 认领同一份。

这一点不只是整洁问题。推送的 bundle 是**独立编译**的自包含 ESM（`bundle: true`，无 external），拥有自己的模块图；若平台侧持有一个模块级 host 单例，推送后拿到的会是 bundle 自己那个空 host，所有已配置插件都会在第一次热推送时静默消失。认领而非导入，正是为了让打包的 App 与推送的 App 驱动同一个 host。运行时未发布 host 时回退为空 host——「这个运行时不认识插件」的诚实读法。同样的理由见 `terminal/identity.ts`。

## App 创建：插件的舞台

App 创建的完整顺序在 `server/src/hmr/platform.ts` 的 `platformImpl.create`：

```text
platformImpl.create
│
├─ caps = claimRuntimeCapabilities(resources)   # db/auth-state/channels/config/proxy/hmr/desktop
├─ plugins = pluginHostFrom(resources)  # 认领运行时在 ④ 加载好的那个 host（未发布则为空 host）
├─ tree = bootModules(platformTree(caps, …, 插件模块), { ifaces, parked: context.modules })
│    # 模块树（server/src/platform.ts）：
│    # 每个服务和 repo 是一个 @Component（导出自己的 class），session 运行时、终端管理器和
│    # http 装配是 @Module（导出别人的 class）。先校验它们的 manifest（gen-ifaces 从装饰器
│    # 读出）——requires 按签名解析、contribution 按槽位校验——再按依赖顺序执行 setup()。
│    # 插件模块（package.json#penguin.modules）是同一棵树的子节点。
└─ ctx.effect：tree.dispose()（每个模块的 effect，逆序）+ manager.shutdown 排空
```
插件是一组模块——与 harness 自身的构成单位相同。`package.json#penguin.modules` 承载 manifest（requires / provides / contributes / context / children）；包的默认导出是 `{ modules: { <name>: { create } } }`，加载时按名字配对。按频率拆开：

| 时机          | 频率        | 发生什么                                                                                                                                         |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 加载          | 每进程一次  | 启动步骤 ④ `loadPlugins`：解析 `plugins.json` 里的 specifier、import、读它的 `package.json#penguin.modules`，把每个 manifest 与默认导出里同名的模块配对。没有 manifest 的包、代码与 manifest 不一致的包会带原因被跳过；`plugins.json` 不可读或格式错误则启动失败 |
| 校验 + 创建   | 每 App 一次 | platform 把插件模块加入它的树；整棵树先作为数据校验（requires 按签名解析、contribution 按槽位校验），再按依赖顺序创建——所以模块在每次启动、每次热替换时都是全新创建的 |
| 释放          | 每 App 一次 | 模块通过 `effect()` 登记的清理在 App 释放时按创建逆序执行；插件的任何东西都不会进入下一代 |

插件契约（`Plugin` / `PluginModule`，加上沙箱词汇表）声明在 SDK 里，即 `@prismshadow/penguin-core/plugin`；`@prismshadow/penguin-server/plugin` 把它与插件模块可以 require 的接口（`Sandbox`、`Terminals`、`SessionManager`、`Agents`……）一并再导出。两个子路径都只产出类型。哪些插件存在由部署的 `<root>/plugins.json` 决定，harness 自身不 import 任何插件。组件的接口是它 class 的公开表面；模块的 provides 与消费者的窄 requires 是声明在归属代码旁边的抽象类（`extends Interface<…>()`）。`pnpm gen:ifaces` 把两者投影进 `src/ifaces.json`（生成物，不进版本库——`typecheck`、`build`、`test` 都会重新生成），即模块树据以校验的表。

## 子系统一览

各子系统的构建位置与对外表面（时序编号对应上文启动时序）：

| 子系统               | 构建位置                                      | 对外表面                                                                                                     |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 配置                 | `config.ts` `resolveServerConfig`（②）        | `ServerConfig`；监听后唯一一次改写是回填真实端口                                                             |
| 单实例锁             | `lock.ts`（③ 预检、⑨ 取锁）                   | 包子路径 `@prismshadow/penguin-server/lock`；CLI 与 Desktop 用它做启动前探测                                 |
| 数据库               | `db/database.ts` `openDatabase`（⑤ 首步）     | `db/repos/*` 仓储类；WAL、外键、增量 `ensureColumn` 迁移                                                     |
| 认证                 | `auth/service.ts`（⑤，运行时机制）            | `/api/auth/*`、cookie `authMiddleware`、终端 WS 升级的鉴权                                                   |
| Project / Session    | `services/*`——**App 级**（平台 create 内组装）| `/api/projects/**`、`/api/sessions/**`（路由细目见 [Server API](/server-api)）                               |
| Agent 运行时         | `runtime/session-manager.ts`——**App 级**      | 任务 / 审批 / 中止 / 压缩路由与 SSE `GET /:sessionId/stream`；内部经 `createAgent` 委托给 core               |
| 事件                 | `runtime/channel.ts` `ChannelHub`（⑤，运行时；SSE 流跨 swap 存活）| 用户级 SSE `GET /api/events`；`ServerEvent` 类型族                                                           |
| Scheduler            | `runtime/scheduler.ts`——**App 级**（create 内启停）| schedules 路由；执行结果发布进 ChannelHub                                                                    |
| HMR 宿主 / 平台      | `hmr/host.ts`（⑤ 末尾）                       | `PlatformApi`（`park` / `info` / `http` / `terminals` / `attachStream`）；`POST /api/hmr/upgrade` 为运行时自留路由，不经平台 |
| 终端                 | `terminal/`——**App 级**              | `/api/terminals*` 路由组（注册进平台唯一的 Hono app）、WS `GET /api/terminals/:id/stream`；pty 寄存跨热更新存活 |
| 插件宿主             | ④ `loadPlugins` 构建，⑤ 发布进资源注册表      | `package.json#penguin.modules` + 默认导出 `{ modules }`；配置面是 `<root>/plugins.json` |
| 模块树               | `src/platform.ts`——**App 级**（create 在认领的能力之上启动） | 每个服务 / repo class 上 `@Component()`（节点以 class 命名），依赖是 `@Use()` 字段；一个 class 造出多个东西时用带 `@Provide()` 字段的 `@Module({ … })`；消费者的窄接口是紧挨消费者声明的抽象类（`extends Interface<…>()`）；没有 `modules/` 目录——每个节点就住在它所是的那个东西的文件里；生成的 `src/ifaces.json`；`GET /api/contributions` 列出到达 web 槽位的内容 |
| 沙盒                 | `sandbox/service.ts`——**App 级**（一个模块；后端向它的 `providers` 槽位投递） | 插件模块向 `SandboxModule.providers` 投递的一条 contribution；约束经 core 的 spawn seam 落到命令上 |
| 模型目录             | 无启动期构建——core 静态数据                   | `/api/projects/:projectId/models`；目录本体在 `core/src/state/model-catalog.ts`                              |

请求期还有一条固定路径值得知道：平台的 HTTP seam 把每个请求先交给当前 App 的 `http(request)`，返回 `null` 才落到运行时自己的路由；热更新进行中时请求在 seam 上排队等新 App 就绪，而不是打到半旧的实例上。

整体分层与 core 引擎的边界见[架构总览](/architecture)；HTTP 路由细目见 [Server API](/server-api)。
