---
title: Server 启动与子系统
description: 从进程入口到 HTTP 监听的组装顺序、各子系统的对外表面，以及扩展在进程级与 App 级两层生命周期中的位置。
---

`server/src/index.ts` 是一个副作用模块：import 它即启动服务——CLI 就是靠这一条契约在自己进程里跑起 server 的。启动次序写在 `main()` 里，每一步是 `PenguinServer` 的一个方法，方法名即步骤名。组装本身又拆成两个函数——`bootAppDeps(config)` 构建运行时核心、发布能力并启动平台（业务面在平台内组装），`createApp(deps)` 组装运行时壳层的 Hono 路由表但不监听——因此测试可以拿到完整的 app 直接 `app.request(...)`，不占端口，也不经过 `index.ts`。

本页回答两个问题：进程从入口到监听按什么顺序把子系统立起来；每个子系统的**对外表面**（surface）是什么——即别人依赖它的方式：导出类型、HTTP 路由、事件，或扩展拿到的 context 成员。

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
├─ ④ loadExtensions                   读 <root>/extensions.json → import → 装进本进程唯一的 ExtensionHost
├─ ⑤ buildDeps = bootAppDeps      开库 → 运行时核心（auth、ChannelHub、HmrHost）→ 发布能力（db/auth/
│                                  channels/config/proxy/desktop/扩展 host）→ hmr.ensure() 启动平台：
│                                  其 create() 组装整个业务面（服务、路由、scheduler）并投递扩展钩子
├─ ⑥ applyPersistedProxy           库已打开，用持久化的代理设置校准 dispatcher
├─ ⑦ buildApp                      运行时壳层：守卫、/api/auth、/api/desktop、/api/hmr、seam、静态托管
├─ ⑧ seedAdmin                     内置 admin 种子（初始 Project 供给经注册表晚绑定到当前业务面）
├─ ⑨ listen                        开始监听；回调里回填真实端口、取实例锁、写端口文件、开 ::1 伴随监听
└─ ⑩ installProcessHandlers        信号、Desktop 退出路径、进程级错误兜底
```

这个顺序不是随意排的，其中四条是硬约束：代理在任何出站请求可能发生之前接管全局 `fetch`；单实例锁在开库**之前**预检，因为 `web.db` 是单写者；扩展在 ⑤ **之前**加载完毕，host 随其他能力一起在平台 boot 前进入注册表，因此首个 App 创建时它们已经在场；平台（连同整个业务面）在 `listen` 之前完成启动，因此**没有任何请求会在业务与扩展就位之前被服务**。收尾的 `installProcessHandlers` 排在 `listen` 之后，这样关停流程不会在监听器存在之前被触发。

扩展加载排在 `ensureSoleInstance` 之后也是有意的：一个即将以退出码 3 退出的进程不应该先去 import 一堆第三方模块、执行它们的顶层副作用。

## 两级生命周期：进程与 App

运行时核心（DB、认证、ChannelHub、HmrHost）随进程构建一次、活到进程退出。**其余全部是平台层**：整个业务面——服务、路由、SessionManager、Scheduler——连同终端管理器、扩展投递、workflow 实例，都在每次 App 创建时重建（每次启动 + 每次热更新，`POST /api/hmr/upgrade` 推送新 bundle）。

```text
进程级（运行时机制，构建一次）              App 级（业务面，每次启动 + 每次热更新重跑）
──────────────────────────              ────────────────────────────────
SQLite · 认证（AuthService）              全部业务服务与路由（services + http/routes）
ChannelHub（SSE 跨 swap 存活）            SessionManager · Scheduler
HmrHost · 资源注册表                      TerminalManager（接管寄存的 pty）
extensions.json 加载 + activate（⑤ 发布）    "initialize" / "create" 事件投递 · workflow 实例
```

**swap 语义：未实现 park 的状态一律硬中止**——待审批全部拒绝、运行中任务中止、scheduler 随旧 App 死掉，新 App 从认领的能力重建一切。只有实现了 park/adopt 的资源（终端 pty）跨 swap 存活。

资源本身也有接口契约，但它不进 kernel 的 iface——声明本身就是注册表里的一个条目（`resource-interfaces`，按 ID 前缀组记版本，如 `{ terminal: 1, platform: 1 }`），由每代 App 的 `create()` 写入并留给继任者。新 App 在 adopt 任何东西之前读前任的声明、与自己编译期的声明比对：同版本的组整体集成存续；版本不同或本代不再声明的组，按**逆注册序**逐一 dispose 后重建（活对象无法像 context 文档那样 strict-parse，声明一致就是集成的判据）。kernel 的 park/validate/swap 机制不参与也不感知这套约定，因此调和策略本身也随平台热推送演进。运行时能力（`runtime:*`）走另一条对称防线：bundle 编译期携带能力契约版本，`claimRuntimeCapabilities` 先与运行时发布的版本握手，不符则整组拒领、退化为 terminals-only，而不是在使用时抛 TypeError。

分界线是**资源注册表**：它位于可重载的平台树之外，因此跨 App 存活。pty 进程本身寄存在里面，新 App 只是接管句柄——所以热更新对正在敲终端的人不可见；ExtensionHost、DB 句柄、认证服务、SSE hub 走的是同一条路：运行时发布进注册表，每个 App 认领同一份。

这一点不只是整洁问题。推送的 bundle 是**独立编译**的自包含 ESM（`bundle: true`，无 external），拥有自己的模块图；若平台侧持有一个模块级 host 单例，推送后拿到的会是 bundle 自己那个空 host，所有已配置扩展都会在第一次热推送时静默消失。认领而非导入，正是为了让打包的 App 与推送的 App 驱动同一个 host。运行时未发布 host 时回退为空 host——「这个运行时不认识扩展」的诚实读法。同样的理由见 `terminal/identity.ts`。

## App 创建：扩展的舞台

App 创建的完整顺序在 `server/src/hmr/platform.ts` 的 `platformImpl.create`：

```text
platformImpl.create
│
├─ new TerminalManager(resources)    # 接管上一实例寄存的 pty
├─ extensions = extensionHostFrom(resources)  # 认领运行时在 ④ 加载好的那个 host（未发布则为空 host）
├─ iface = { workflow, tool, sandbox }   # 每个 App 全新的定义视图
├─ extensions.emit("initialize", iface) # 定义视图，按激活顺序投递给每个 handler
├─ sandbox = new SandboxService(已注册的后端)   # 由寄存的设置重新水合
├─ extensions.emit("create", {          # 实例视图，注册关闭后组装
│    workflows: instantiateWorkflows(iface.workflow),  # 全部 factory 在此被急切调用
│    terminals,
│    sandbox: { configure, settings },
│  })
├─ caps = claimRuntimeCapabilities(resources)   # db/auth/channels/config/proxy/desktop
└─ 业务面组装（caps 齐全时）：buildAppDeps——sandbox confiner 作为普通参数传入，
   进入 session loader 的 spawn 路径 → scheduler.start() → 孤儿 Goal 回收
   → createApp（终端组 + 业务组注册进同一个 Hono app）
   → 一次注册表写入发布 {deps, app, shutdown} 指针 → ctx.effect 注册 swap 硬中止
```

按频率拆开，扩展生命周期是三层：

| 时机           | 频率        | 发生什么                                                                                             |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| 加载 + `activate(ctx)` | 每进程一次 | 启动步骤 ④ `loadExtensions`：解析 `extensions.json` 里的 specifier、import、执行其导出的 `activate`（async 会被等待）——`ctx.on(...)` 订阅与 `ctx.disposables` 登记只在这个窗口内有效。单条失败会回滚（跑掉它已登记的 disposable）并跳过；`extensions.json` 不可读或格式错误则启动失败 |
| `"initialize"` 事件 | 每 App 一次 | handler 向全新的 `iface` 注册 workflow factory 与 sandbox 后端（`tool` 槽位保留未用）               |
| workflow 实例化 | 每 App 一次 | `instantiateWorkflows` 在 emit 之前同步调用**全部** factory——实例随 App 创建整批诞生，不是首次调用时 |
| `"create"`     | 每 App 一次 | 扩展拿到实例视图 `ctx`（`workflows` + `terminals` + `sandbox`）                                      |
| `workflows.run` | 每次调用    | 纯函数调用：无 Session、无审批、无流式                                                               |
| Disposables    | 每进程一次  | 优雅关停时被 await（≤5s）；disposer 可以是 async，全部并发执行、单条失败被隔离——因此彼此必须独立     |

由此可以读出几条行为事实：

- **每 App 重投递**：`"initialize"` 与 `"create"` 在每次 App 创建时重新投递，注册永远落在当前实例上——热更新后的新 App 不可能带着空注册运行。
- **实例不跨热更新**：factory 每 App 重新执行，带状态的 workflow 不会把上一个实例的状态带过热更新。
- **订阅窗口就是 `activate`，返回即封闭**：handler 里再调 `ctx.on(...)` 会每次热 swap 累积一份，所以它直接抛错——在打包启动时就大声失败，而不是变成慢泄漏。disposables 与订阅同窗封闭，理由相同。
- **handler 同步且不被包裹**：扩展*加载*失败（import，或 `activate` 抛错/reject）按条目隔离，但事件 handler 没有 try/catch——抛错会使该次平台启动失败；返回 promise 的 handler 出于同样理由被拒绝（App 是围绕这次 emit 同步组装的，它的 rejection 只能以未处理形式逃逸）。
- **workflow 重名被拒绝**：`iface.workflow` 是一个 `set` 会抛错的注册表，名字的归属不会随 `extensions.json` 顺序改变。
- **事件词汇表有类型且只有一处**：`ExtensionEvents` 把每个事件名映射到它的载荷——加一个事件，平台的 emit 端和所有 handler 同时获得类型。
- **约束是同代接线**：confiner 作为 `buildAppDeps` 的普通参数进入 core，经它 spawn 的 session 随所属 App 硬停——跨过 swap 的是寄存上下文上的生效设置，因此一次推送无法悄悄解除一个部署的约束。

扩展契约（`Extension` / `ExtensionContext` / `ExtensionEvents` / `PenguinInterface` / `PenguinContext`）声明在 SDK 里，即 `@prismshadow/penguin-core/extension`。`PenguinContext` 与 `PenguinInterface` 是开放的：harness 通过对该模块做声明合并，贡献自己拥有的成员——`terminals`——并从 `@prismshadow/penguin-server/extension` 一并再导出。两个子路径都只产出类型。哪些扩展存在由部署的 `<root>/extensions.json` 决定，harness 自身不 import 任何扩展。

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
| 扩展宿主             | ④ `loadExtensions` 构建，⑤ 发布进资源注册表      | `activate(ctx: ExtensionContext)` + `ExtensionEvents` 事件表；配置面是 `<root>/extensions.json`                       |
| 沙盒                 | `sandbox/service.ts`——**App 级**（create 内基于扩展注册的后端构建） | `iface.sandbox.registerProvider` / `ctx.sandbox.{configure,settings}`；约束经 core 的 spawn seam 落到命令上，后端是 `extensions.json` 里点名的扩展包 |
| 模型目录             | 无启动期构建——core 静态数据                   | `/api/projects/:projectId/models`；目录本体在 `core/src/state/model-catalog.ts`                              |

请求期还有一条固定路径值得知道：平台的 HTTP seam 把每个请求先交给当前 App 的 `http(request)`，返回 `null` 才落到运行时自己的路由；热更新进行中时请求在 seam 上排队等新 App 就绪，而不是打到半旧的实例上。

整体分层与 core 引擎的边界见[架构总览](/architecture)；HTTP 路由细目见 [Server API](/server-api)。
