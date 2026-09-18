---
title: Server 启动与子系统
description: 从进程入口到 App 开始服务的组装顺序、各子系统的对外表面，以及插件在进程级与 App 级两层生命周期中的位置。
---

`server/src/index.ts` 是一个带副作用的模块：导入它，Server 就会启动。CLI 正是依赖这一约定，才能把 Server 跑在自己选定的 Node 进程里。

启动顺序写在 `main()` 里：每一步对应一个 `PenguinServer` 方法，方法名就是步骤名。组装本身分成两部分：

- `bootAppDeps(config)` 构建进程核心（数据库、ChannelHub、HMR host），把它们发布进资源注册表，然后启动平台；业务面在平台内部组装。
- `createApp(boot)` 组装这一层自己的 Hono 应用（网络守卫、平台接缝、静态托管），但不监听端口。因此测试可以拿到完整的应用，直接用 `app.request(...)` 驱动，不占端口，也完全不经过 `index.ts`。

本页回答两个问题：

- 进程从入口到 App 开始服务，按什么顺序把各个子系统立起来？见[进程入口](#进程入口)和[启动时序](#启动时序)。
- 每个子系统的**对外表面**是什么，即别人依赖它的方式：导出类型、HTTP 路由、事件，或插件模块可以 require 的接口？见[子系统一览](#子系统一览)。

## 进程入口

启动 Server 的机制有四种，殊途同归：同一组环境变量驱动同一个模块。

| 入口 | 机制 |
| --- | --- |
| 直接运行 | `node dist/index.js`（`server/package.json` 里的 `start`） |
| CLI（`penguin server` / `penguin web`） | 设好 `PORT`/`HOST` 并导出 `PENGUIN_CLI_ENTRY`，然后以**受监管的子进程**运行 Server，由子进程导入 `@prismshadow/penguin-server` |
| CLI 自动启动 | CLI 命令发现没有运行中的 Server 时，以 `PORT=0` 派生一个分离的 `server` 子命令，等数据根的锁生效后再接入 |
| 桌面应用 | `utilityProcess.fork` 拉起一个**独立**的 Server 进程，并注入它需要的环境变量 |

受监管的子进程以 `node <entry> server …` 运行，带有 `PENGUIN_SERVE_CHILD=1` 标记，并通过 `PENGUIN_SUPERVISED=1` 得知有监管者。父进程转发终端的信号，以子进程的退出码退出；子进程以 **重启以更新** 所要求的重启码退出时，父进程重新拉起它。用 tsx 运行的开发实例无法由 node 重新派生，CLI 就改为在本进程内导入 Server。`penguin web` 还会轮询到就绪后打开浏览器。

自动启动的输出写入 `<root>/logs/server-auto-<date>.log`。

桌面应用经环境变量注入 `PENGUIN_HOME`、`HOST`、`PORT`、`PENGUIN_DESKTOP_TOKEN` 和 `PENGUIN_PORT_FILE`；应用指定了 `PENGUIN_WEB_DIST` 和 `PENGUIN_CLI_ENTRY` 时，也一并注入。

> [!NOTE]
> Server 自身的配置只来自环境变量（`server/src/config.ts`）。`system_config.yaml` 是 Agent 级状态，在 Session 运行时读取，与 Server 启动无关。

## 启动时序

`main()` 把顺序写了出来，每行一个 `PenguinServer` 方法：

```text
main()  —— one PenguinServer method per line
│
├─ ① loadEnv · installProxy        dotenv first (.env may define HTTP_PROXY itself), then the proxy takes over fetch
├─ ② readConfig                    env only: PENGUIN_HOME, PORT, HOST, PENGUIN_WEB_DB …
├─ ③ ensureSoleInstance            data root held by another live instance → exit code 3 (before the DB opens)
├─ ④ listen                        bind the port now; answer 503 "starting" until ⑧. The callback writes back
│                                  the real port, takes the lock, and opens the ::1 companion on a loopback bind
├─ hmrMain(createHost(), replace, start)          the HMR layer's entry runs start, then makes the first generation current
│  ├─ ⑤ loadPlugins                a shim for platforms that predate loading their own plugins: import what the
│  │                               Projects' [plugins] tables name into a host the first App can reuse
│  ├─ ⑥ buildDeps = bootAppDeps    open the DB → process core (ChannelHub, auth state + local API token, CLI shim) →
│  │                               publish the capabilities (interfaces descriptor, config, db, auth state, channels,
│  │                               proxy, HMR host + control, desktop, lifecycle, plugin host) → hmr.ensure() boots
│  │                               the platform: its create() assembles the WHOLE business surface
│  ├─ ⑦ applyPersistedProxy        the DB is open: align the dispatcher with the persisted settings
│  ├─ ⑧ buildApp                   the layer's app: guards, the platform seam, static hosting; terminal WS on each listener
│  ├─ ⑨ seedAdmin                  built-in admin seed; decides whether a first-login link is due
│  ├─ ⑩ installProcessHandlers     signals, the desktop quit path, restart-to-update, the process-level error fallback
│  └─ ⑪ printFirstLoginNotice      the one-time sign-in link, when one is due
└─ ⑫ announce                      write the port to PENGUIN_PORT_FILE: the App is up
```

这个顺序不是随意排的，其中的约束都是硬性的：

- 代理必须在任何出站请求发出之前接管全局 `fetch`。
- 实例锁在数据库打开**之前**检查，因为 `web.db` 只允许一个写入者。
- 插件宿主随其他能力在平台启动前进入注册表，因此 ⑤ 导入的插件对象可供首个 App 复用，每个 App 的插件对象也同样留给下一个 App。
- 平台（连同整个业务面）在 ⑧ 把应用交给监听器之前完成启动。
- 端口是刻意提前绑定的。⑧ 之前的每个请求都得到 `503 penguin-server is starting`（带 `retry-after: 1`），早到的客户端看到的是「启动中」，而不是连接被拒。**没有任何业务请求会在平台与插件就位之前被处理。**
- 端口公告放在最后，因为桌面外壳在收到它之后才打开窗口。
- `installProcessHandlers` 排在 `listen` 之后，这样关停流程不会在监听器存在之前被触发。

插件加载排在 `ensureSoleInstance` 之后也是有意的：一个即将以退出码 3 退出的进程，不应该先去导入一堆第三方模块、执行它们的顶层副作用。

## 进程与 App 两级生命周期

进程核心只构建一次，活到进程退出，包括 SQLite 句柄、ChannelHub、进程级的认证值（例如本地 API token），以及带资源注册表的 HMR host。

其余全部是平台级的：整个业务面（服务、路由、AuthService、SessionManager、Scheduler）连同终端管理器、插件宿主和插件模块，在每次创建 App 时重建。每次启动、每次热替换、每次修改 Project 的插件列表都会创建 App：热替换时，新的 bundle 经 `POST /api/hmr/upgrade` 推送进来；修改插件列表时，App 用同一个 bundle [自行重组](#重组)。

```text
Process-level (HMR layer, once)           App-level (the business surface, re-run per boot + per hot swap + per re-assembly)
───────────────────────────────           ─────────────────────────────────────────────────
SQLite · auth state (API token …)         every business service and route (AuthService included)
ChannelHub (SSE survives swaps)           SessionManager · Scheduler · messaging bridge
HmrHost · the resource registry           TerminalManager (adopts parked ptys)
the plugin host (imported objects)        plugin lists read + imported, modules created as children of the tree
```

两级之间的分界线是**资源注册表**。它位于可重载的平台树之外，因此跨 App 存活。pty 进程寄存在里面，新 App 只是取回句柄，所以正在终端里打字的人感觉不到热替换。数据库句柄、认证状态和 SSE hub 走的是同一条路：由进程发布，由每个 App 认领。插件宿主也以同样的方式传递：每个 App 登记自己构建的宿主，下一个 App 认领它，复用其中的插件对象。

### 热替换语义

**未寄存的状态在热替换时一律硬中止**：待审批全部拒绝，运行中的任务中止，调度器、消息桥和机器连接随旧 App 一起停止，由下一个 App 从认领的能力重建。旧 App 销毁之后、新 App 启动之前，内核会等已中止的运行收尾，最多 5 秒。

跨热替换存续的有：

| 存续内容 | 方式 |
| --- | --- |
| 终端 pty | 寄存在注册表里，新 App 取回句柄 |
| 机器隧道 | ssh 子进程，由后继 App 按 pid 接管 |
| 进程级单例 | 属于进程核心，在所有 App 之外 |

### 资源接口契约

资源本身也有接口契约，但它不进内核的 iface：声明本身就是注册表里的一个条目 `platform.resourceInterfaces`。这个描述符写明所属家族（`penguin`），并按 ID 前缀分组，列出接管者会用到的成员；`terminal` 组列出了使用一个寄存 pty 时会碰到的全部成员。每一代 App 的 `create()` 写入声明，留给继任者。

新 App 在接管任何东西之前，先读前任的声明，与自己编译期内置的声明比对：

- 同一家族、且提供了本构建所需全部成员的组，整组集成，资源跨代存续。
- 其他组（家族不同、缺少成员，或本构建不再声明）按**逆注册序**逐条销毁后重建。

活对象无法像上下文文档那样严格解析，所以声明一致就是集成的判据。

判定先做，但要等新 App 完全建好才执行，因此中途失败的启动仍能把活着的资源交还给上一代。

内核的 park/validate/swap 机制不参与、也不感知这套约定，因此调和策略本身也随平台推送演进。

### 能力认领

进程能力一侧有对称的防线：进程发布描述符 `platform.interfaces`，为每项能力列出认领方会用到的成员。在信任任何认领之前，`claimHmrCapabilities` 先把描述符及其背后的活对象，与 bundle 编译期内置的副本比对。

对不上就拒绝认领：启动失败、推送回滚，而不是在使用时才抛出 `TypeError`。同一家族却不提供任何能力的描述符，声明的是裸内核，只启动终端。

从注册表认领而不是导入，不只是图整洁。推送的 bundle 是**独立编译**的自包含 ESM 文件（`bundle: true`，无 externals），拥有自己的模块图。若平台侧持有模块级单例，推送后拿到的会是 bundle 自己那份全新的副本，进程构建的东西一样也没有。认领而非导入，才让打包的 App 与推送的 App 驱动同一个数据库、ChannelHub 和认证状态。插件宿主遵循同一规则：推送的 App 能复用之前的 App 导入的插件对象，正是因为它认领了这些对象。没有任何发布时，认领得到的是空宿主，这是「这个运行时不认识插件」的如实表达。

## App 创建

App 创建写在 `server/src/hmr/platform.ts` 里。`platformImpl.create` 把真正的 App（`createInner`）作为内层实例启动，外面是一层由运行时持有的外壳，App 因此能够[自行重组](#重组)。`createInner` 的完整顺序：

```text
createInner
│
├─ claim = claimHmrCapabilities(resources)   # refused → throw (the boot fails); bare → terminals only
├─ migrate(caps.db, { swapPath: true })      # a pushed platform brings its own migrations
├─ decide which parked resource groups to adopt (platform.resourceInterfaces)
├─ plugins = loadPluginHost(resources, root, assetsDir)
│    # read the Projects' [plugins] tables and import what they name, reusing the objects of the
│    # host an earlier App registered; a bare kernel keeps the claimed host (empty if none)
├─ tree = bootModules(platformDef(caps, adoptable, plugin modules, replacements, reassemble), { ifaces, resources, parked })
│    # THE TREE (server/src/platform.ts): every service and repo is a @Component
│    # (a class that exports itself), the session runtime, the terminal manager and the
│    # http assembly are @Modules (classes that export others). Their manifests (read off
│    # the decorators by gen-ifaces) are checked first — requires resolved by signature,
│    # contributions validated against their slots — then setup() runs in dependency
│    # order. Plugin modules (a package's ifaces.json) are children of the same tree.
├─ ctx.effect: manager.shutdown drain + tree.dispose() (every module's effects, reverse order)
└─ commit: dispose the groups not adopted, register this build's resource declaration and this App's plugin host
```

### 插件是什么

插件是一组模块，与 harness 自身的构成单位相同，写法也相同：`@Component` / `@Module` 类，字段上是 `@Use` / `@Provide` / `@Bind`。

包的 manifest 是生成的，不是手写的：包的构建对自己的 tsconfig 运行 `gen-ifaces`，把生成的 `ifaces.json` 放在 `package.json` 旁一起发布。这张表就是包的模块载荷；一个包列进某个 Project 的 `[plugins]` 表，就是插件。

默认导出是 `{ modules?: [<class>, …], replaces?: [<class>, …] }`：

- `modules`——包新增的节点。
- `replaces`——它顶替的节点：一个以被顶替节点命名的类，可以是组件、模块或整个组。

加载时，默认导出点名的每个类都要对照表中自己的 manifest 核对。替身放入时不做检查；组装出的树在任何节点运行之前作为整体校验，替身提供的少于消费者所需时，按名字拒绝。

### 插件生命周期

按频率划分：

| 时机 | 频率 | 发生什么 |
| --- | --- | --- |
| 加载 | 每 App 一次 | 平台的 `create()` 读取闭包，即所有 Project 的 `[plugins]` 表的并集。它解析每个 specifier（从数据根的 `plugins/` 前缀、随正在启动的版本发布的插件或安装目录中查找）并导入，读取它 `package.json` 旁的 `ifaces.json`（没有即没有模块），把默认导出点名的每个类对照表中的 manifest 核对。之前的 App 从同一个未改动的文件导入过的条目直接复用，不再重新导入。点名了类却没有表的包（没构建过）、类与表不一致的包（构建陈旧）会带原因被跳过，原因显示在该 Project 的插件列表里；`.project_config.toml` 无法读取或解析的 Project 不贡献任何插件 |
| 校验 + 创建 | 每 App 一次 | 平台把插件模块加入自己的树；整棵树先作为数据校验（requires 按签名解析、contribution 按槽位校验），再按依赖顺序创建，所以模块在每次启动、每次热替换、每次重组时都是全新创建的 |
| 释放 | 每 App 一次 | App 释放时，模块通过 `effect()` 登记的清理按创建逆序执行；插件的任何东西都不会进入下一代 |

### 重组

修改 Project 的插件列表无需重启进程即可生效。运行时持有 `platformImpl.create` 返回的外壳，外壳 API 的每个成员都转发给当下的内层 App。`reassemble()` 在这个内层实例上运行内核自己的 `upgrade`，bundle 和寄存文档都不变：这正是热推送执行的那次替换，只是没有新的 bundle。[热替换语义](#热替换语义)中的一切照样适用，因此所有 Project 中正在进行的 Agent 运行都会被中止。

插件路由把改动交给重组，由重组在自己的队列里写入，因此对同一个文件的两次修改不会交错。新 App 启动失败时，先撤销改动，再从之前的文档重新启动上一个 App，列表因此回到修改之前的样子。`packages/hmr` 不参与其中，所以重组在任何运行时上都能工作。相关路由见 [Server API](/server-api#插件注册表与-project-插件)。

### 插件契约

插件契约（`Plugin`、各装饰器，以及沙箱词汇表）声明在 SDK 里，即 `@prismshadow/penguin-core/plugin`；`@prismshadow/penguin-server/plugin` 导出插件模块可以 require 的接口（`Sandbox`、`Terminals`、`Sessions`、`AgentService`、`Messaging`、`Http` 等），只有类型。

装饰器是插件随身携带的唯一一段 SDK 运行时。它们把记录写在类自身上，所以插件 bundle 里的那份和宿主读到的是同一样东西。

哪些插件运行由各 Project 的 `[plugins]` 表决定，这些表由 Web App 的**插件市场**页写入；harness 自身不导入任何插件。

组件的接口是它的类的公开表面；模块的 provides 与消费者的窄 requires 是声明在所属代码旁边的抽象类（`extends Interface<…>()`）。`pnpm gen:ifaces` 把两者投影进 `src/ifaces.json`（生成物，不进版本库；`typecheck`、`build`、`test` 都会重新生成），模块树就依据这张表校验。

## 子系统一览

各子系统的构建位置与对外表面。步骤编号 ① 到 ⑫ 对应上文的[启动时序](#启动时序)。

| 子系统 | 构建位置 | 对外表面 |
| --- | --- | --- |
| 配置 | `config.ts` 的 `resolveServerConfig`（②） | `ServerConfig`；监听后唯一一次改写是回填真实端口 |
| 单实例锁 | `lock.ts`（③ 预检，④ 在监听回调中取锁） | 包子路径 `@prismshadow/penguin-server/lock`；CLI 与桌面应用用它做启动前探测 |
| 数据库 | `db/database.ts` 的 `openDatabase`（⑥ 首步） | `db/repos/*` 仓储类；WAL、外键、按版本顺序执行的迁移（`db/migrations.ts`，版本记在 `PRAGMA user_version`） |
| 认证 | `auth/service.ts`——**App 级**（每个 App 各建一份）；进程级的值（`auth/runtime-state.ts`，含本地 API token）在 ⑥ 发布 | `/api/auth/*`、支持 cookie 与 Bearer token 的 `authMiddleware`、终端 WS 升级的鉴权 |
| Project / Session | `services/*`——**App 级**（在 create 内组装） | `/api/projects/**`、`/api/sessions/**`（路由细目见 [Server API](/server-api)） |
| Agent 运行时 | `runtime/session-manager.ts`——**App 级** | 任务 / 审批 / 中止 / 压缩路由与 SSE `GET /api/sessions/:sessionId/stream`；内部经 `createAgent` 委托给 core |
| 事件 | `runtime/channel.ts` 的 `ChannelHub`（⑥，进程级；SSE 流跨热替换存活） | 用户级 SSE `GET /api/events`；`ServerEvent` 类型族 |
| Scheduler | `runtime/scheduler.ts`——**App 级**（随 create 启停） | schedules 路由；执行结果发布进 ChannelHub |
| HMR 宿主 / 平台 | `@prismshadow/penguin-hmr`（`HmrHost`、`hmrMain`）与 `hmr/platform.ts`（平台） | `PlatformApi`（`info` / `log` / `http` / `terminals` / `attachStream` / `business` / `shutdown` / `drained`，外加内核的 `park`）；`/api/hmr/*`（含 `POST /api/hmr/upgrade`）是平台贡献的路由组，推送的新一代若不提供这组路由，会在提交前被拒 |
| 终端 | `terminal/`——**App 级** | `/api/terminals*` 路由组、WS `GET /api/terminals/:id/stream`；pty 寄存在注册表中，跨热替换存活 |
| 插件宿主 | 每个 App 的 `create()` 构建，在提交时登记进注册表供下一个 App 复用；⑤ `loadPlugins` 为早于这一改动的平台构建一份，在 ⑥ 发布 | 一个 npm 包：生成的 `ifaces.json`（模块载荷）、默认导出 `{ modules?: [<class>, …], replaces?: [<class>, …] }`；配置面是各 Project 的 `.project_config.toml` 中的 `[plugins]` 表，经 `/api/projects/:projectId/plugins/installed` 写入 |
| 沙箱 | `sandbox/service.ts`——**App 级**（一个模块；后端向它的 `providers` 槽位投递） | 插件模块向 `SandboxModule.providers` 投递的一条 contribution；约束经 core 的 spawn 接缝落到命令上 |
| 模块树 | `src/platform.ts`——**App 级**（create 在认领的能力之上启动它） | 每个服务 / repo 类用 `@Component()` 标注（节点以类命名），依赖写成 `@Use()` 字段；`@Module({ children, exports })` 组（`IdentityModule`、`ProjectsModule` 等），exports 就是子节点向树里其余部分提供的东西；一个类要构建多个东西时，用带 `@Provide()` 字段的 `@Module({ … })` 类；消费方的窄接口是抽象类，声明在消费方旁边（`extends Interface<…>()`）；没有 `modules/` 目录——每个节点就住在它对应事物所在的文件里；`src/ifaces.json` 为生成文件；`GET /api/contributions` 列出到达 web 槽位的内容 |
| 模型目录 | 无启动期构建——core 的静态数据 | `/api/projects/:projectId/models`；目录本体在 `core/src/state/model-catalog.ts` |

### 请求时的 HTTP 接缝

平台的 HTTP 接缝把每个请求先交给当前 App 的 `http(request)`，各情形的处理：

| 情形 | 行为 |
| --- | --- |
| 当前 App 返回 `null` | 落到这一层自己的末端：静态托管与 SPA 回退 |
| 当前 App 抛出异常 | 直接返回 `500`，不再向下传 |
| 当前没有任何一代 App | 返回 `503` |
| 热替换进行中 | 请求在接缝上排队等新 App 就绪，而不是打到半释放的旧 App 上 |

整体分层与 core 引擎的边界见[架构总览](/architecture)；HTTP 路由细目见 [Server API](/server-api)。
