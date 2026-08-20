---
title: Server 启动与子系统
description: 从进程入口到 HTTP 监听的组装顺序、各子系统的对外表面，以及插件在进程级与 App 级两层生命周期中的位置。
---

`server/src/index.ts` 是一个副作用模块：import 它即启动服务——CLI 就是靠这一条契约在自己进程里跑起 server 的。启动次序写在 `main()` 里，每一步是 `PenguinServer` 的一个方法，方法名即步骤名。组装本身又拆成两个函数——`buildAppDeps(config)` 构建服务对象图，`createApp(deps)` 组装 Hono 路由表但不监听——因此测试可以拿到完整的 app 直接 `app.request(...)`，不占端口，也不经过 `index.ts`。

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
├─ ④ buildDeps                     对象图：SQLite → 仓储 → 服务 → SessionManager → HmrHost
├─ ⑤ applyPersistedProxy           库已打开，用持久化的代理设置校准 dispatcher
├─ ⑥ buildApp                      中间件与路由表（只组装，不监听）
├─ ⑦ bootPlatform                  hmr.ensure() = 首次 App 创建：插件在这里加载并收到投递
├─ ⑧ seedAdmin · startScheduler · reconcileOrphanedGoals
├─ ⑨ listen                        开始监听；回调里回填真实端口、取实例锁、写端口文件、开 ::1 伴随监听
└─ ⑩ installProcessHandlers        信号、Desktop 退出路径、进程级错误兜底
```

这个顺序不是随意排的，其中三条是硬约束：代理在任何出站请求可能发生之前接管全局 `fetch`（持久化的代理设置要等 ④ 开库后才补读，中间没有任何出站调用）；单实例锁在开库**之前**预检，因为 `web.db` 是单写者；`bootPlatform` 在 `listen` 之前完成，因此**没有任何请求会在插件就位之前被服务**。收尾的 `installProcessHandlers` 排在 `listen` 之后，这样关停流程不会在监听器存在之前被触发。

## 两级生命周期：进程与 App

大多数子系统在 ④ 随进程构建一次、活到进程退出。**平台层**不同：它是热更新（`POST /api/hmr/upgrade` 推送新 bundle）的可替换单元，每次启动与每次热更新都会创建一个新的 **App**——终端管理器、插件投递、workflow 实例都属于 App 级。

```text
进程级（构建一次）                      App 级（每次启动 + 每次热更新重跑）
────────────────────────              ────────────────────────────────
SQLite 与全部仓储                       TerminalManager（接管寄存的 pty）
认证 / Project / Session 服务           插件定义视图 iface{ workflow, tool }
SessionManager · ChannelHub            onCreateApp 投递
Scheduler · HmrHost                    workflow 实例（全部急切构建）
plugins.json 加载 + pluginHost.use()   "create" 事件投递
```

pty 进程本身寄存在运行时的资源注册表里跨 App 存活，新 App 只是接管句柄——所以热更新对正在敲终端的人不可见。

## App 创建：插件的舞台

App 创建的完整顺序在 `server/src/platform/platform.ts` 的 `platformImpl.create`：

```text
platformImpl.create
│
├─ new TerminalManager(resources)    # 接管上一实例寄存的 pty
├─ ensureConfiguredPlugins(root)     # 仅首个 App：读 <root>/plugins.json → import → pluginHost.use()
├─ iface = { workflow: new Map(), tool: new Map() }   # 每个 App 全新的定义视图
├─ pluginHost.createApp(iface)       # 每个插件的 onCreateApp，按注册顺序同步执行
└─ pluginHost.emit("create", {       # 目前平台发出的唯一事件
     workflows: instantiateWorkflows(iface.workflow),  # 全部 factory 在此被急切调用
     terminals,
   })
```

按频率拆开，插件生命周期是三层：

| 时机           | 频率        | 发生什么                                                                                             |
| -------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| 模块加载       | 每进程一次  | 解析 `plugins.json` 里的 specifier 并 import；单条失败被隔离并记日志，不阻断启动                     |
| onCreateApp    | 每 App 一次 | 插件向全新的 `iface` 注册 workflow factory（`tool` 槽位保留未用）                                    |
| workflow 实例化 | 每 App 一次 | `instantiateWorkflows` 在 emit 之前同步调用**全部** factory——实例随 App 创建整批诞生，不是首次调用时 |
| `"create"`     | 每 App 一次 | 插件拿到实例视图 `ctx`（`workflows` + `terminals`）                                                  |
| `workflows.run` | 每次调用    | 纯函数调用：无 Session、无审批、无流式                                                               |

由此可以读出几条行为事实：

- **每 App 重投递**：`onCreateApp` 与 `"create"` 在每次 App 创建时重新投递，注册永远落在当前实例上——热更新后的新 App 不可能带着空注册运行。
- **实例不跨热更新**：factory 每 App 重新执行，带状态的 workflow 不会把上一个实例的状态带过热更新。
- **hook 同步且不被包裹**：插件*加载*失败是隔离的（跳过并记日志），但 `onCreateApp` / `subscribe` 抛错没有 try/catch——会使该次平台启动失败。
- **事件名是开放集合**：`"create"` 是目前唯一由平台发出的事件。

插件的类型面（`RawPlugin` / `PenguinInterface` / `PenguinContext`）经包子路径 `@prismshadow/penguin-server/plugin` 导出，只导出类型；哪些插件存在由部署的 `<root>/plugins.json` 决定，harness 自身不 import 任何插件。

## 子系统一览

各子系统的构建位置与对外表面（时序编号对应上文启动时序）：

| 子系统               | 构建位置                                      | 对外表面                                                                                                     |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 配置                 | `config.ts` `resolveServerConfig`（②）        | `ServerConfig`；监听后唯一一次改写是回填真实端口                                                             |
| 单实例锁             | `lock.ts`（③ 预检、⑨ 取锁）                   | 包子路径 `@prismshadow/penguin-server/lock`；CLI 与 Desktop 用它做启动前探测                                 |
| 数据库               | `db/database.ts` `openDatabase`（④ 首步）     | `db/repos/*` 仓储类；WAL、外键、增量 `ensureColumn` 迁移                                                     |
| 认证                 | `auth/service.ts`（④）                        | `/api/auth/*`、cookie `authMiddleware`、终端 WS 升级的鉴权                                                   |
| Project / Session    | `services/*`（④）                             | `/api/projects/**`、`/api/sessions/**`（路由细目见 [Server API](/server-api)）                               |
| Agent 运行时         | `runtime/session-manager.ts`（④）             | 任务 / 审批 / 中止 / 压缩路由与 SSE `GET /:sessionId/stream`；内部经 `createAgent` 委托给 core               |
| 事件                 | `runtime/channel.ts` `ChannelHub`（④）        | 用户级 SSE `GET /api/events`；`ServerEvent` 类型族                                                           |
| Scheduler            | `runtime/scheduler.ts`（④ 组装、⑧ 启动）      | schedules 路由；执行结果发布进 ChannelHub                                                                    |
| HMR 宿主 / 平台      | `hmr/host.ts`（④ 末尾）                       | `PlatformApi`（`park` / `info` / `http` / `terminals` / `attachStream`）；`POST /api/hmr/upgrade` 为运行时自留路由，不经平台 |
| 终端                 | `platform/terminal/`——**App 级**              | `/api/terminals*` 路由（经平台 HTTP seam 挂进主 app）、WS `GET /api/terminals/:id/stream`；pty 寄存跨热更新存活 |
| 插件宿主             | `platform/plugin.ts` 模块级单例（进程级）     | `RawPlugin` / `PenguinInterface` / `PenguinContext`；配置面是 `<root>/plugins.json`                          |
| 模型目录             | 无启动期构建——core 静态数据                   | `/api/projects/:projectId/models`；目录本体在 `core/src/state/model-catalog.ts`                              |

请求期还有一条固定路径值得知道：平台的 HTTP seam 把每个请求先交给当前 App 的 `http(request)`，返回 `null` 才落到运行时自己的路由；热更新进行中时请求在 seam 上排队等新 App 就绪，而不是打到半旧的实例上。

整体分层与 core 引擎的边界见[架构总览](/architecture)；HTTP 路由细目见 [Server API](/server-api)。
