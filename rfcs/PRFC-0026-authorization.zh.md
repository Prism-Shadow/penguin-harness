# PRFC-0026 Authorization：双表面权限模型与路由级 HTTP 授权

[English](PRFC-0026-authorization.md)

- Feature Name: `authorization`
- Start Date: 2026-11-20
- PRFC PR: none yet (native to this repository)
- Implementation PR: —

## Summary
[summary]: #summary

本 RFC 定义这套 harness 的授权模型，将能力边界划分为 **CLI** 与 **HTTP** 两个 API 表面。**CLI 表面**在本地进程中执行，以当前操作系统环境（terminal、TTY、filesystem）为权限核心，代表调用方的 **system permissions**（系统权限），并通过访问 HTTP 表面获得 Penguin 的业务能力。**HTTP 表面**在 Server 进程中执行，承载 **penguin permissions**（应用权限），通过具名的路由 `id` 与绑定角色的授权会话对每次调用做授权判定。对 Penguin 数据根（Penguin Home Root）拥有本地访问权限等价于拥有 Penguin 管理员权限（`Access to Penguin Home Root = penguin admin`）。

## Motivation
[motivation]: #motivation

### 两个表面各自守住不同的信任边界

终端命令与服务端接口运行在不同的上下文中，各自持有不同的权限来源。CLI 运行在调用方自己的进程与工作目录里，受操作系统用户、TTY 与文件系统命名空间约束。HTTP 运行在 Server 进程里，面对跨进程或跨网络的调用方，靠请求凭证（本机 `api-token`、人类用户会话、Agent 会话令牌）识别身份并限制可访问的资源范围。

### CLI 直接操作数据根会绕过 HTTP 授权层

当业务命令在 CLI 进程内直接读写数据根下的配置文件或数据库时，HTTP 表面的角色与范围检查便无法介入。将所有 Penguin 业务能力收敛到 HTTP 表面，让 CLI 统一通过 HTTP 访问 Server（仅保留少量系统引导与令牌读取命令在本地执行），应用权限就能集中在同一处判定与审计。

### Agent 调用需要按路由 ID 收窄的凭证

不同职责的 Agent 需要不同范围的 HTTP 访问权限。普通对话 Agent 只需管理定时任务与自身工作台，系统初始化与自演进 Agent 需要管理技能与插件，组织内的员工 Agent 需要调用组织协作接口。为每个 Agent 签发绑定角色的会话令牌，并将每条 HTTP 路由以合理的 `id` 注册到模块树上，授权层就能按路由 `id` 集合与项目边界精确放行。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 权限哲学：CLI = system permissions，HTTP = penguin permissions

这套 harness 的权限由两条规则锚定：**CLI = system permissions**，**HTTP = penguin permissions**。

- **CLI 表面**在本地执行，以当前系统环境（terminal、TTY、fs）为权限核心。它能读写哪些本地路径、能附加哪个终端流、能访问哪个本地套接字，完全由操作系统赋给当前进程的权限决定。当 CLI 需要执行 Penguin 业务操作（管理 Agent、会话、模型配置、Vault 机密、定时任务、插件与版本报告）时，它作为客户端请求 HTTP 表面。
- **HTTP 表面**守护所有 Penguin 业务能力。Server 验证请求携带的 Bearer 令牌，识别调用方身份与角色，再根据目标路由的 `id` 与项目归属决定放行或拒绝。

### Access to Penguin Home Root = penguin admin

对 Penguin 数据根（`PENGUIN_HOME`）拥有本地文件系统读取权限，等价于拥有该实例的 `penguin admin` 权限。

Server 启动时在数据根下写入权限为 `0600` 的 `api-token` 与 `server.lock`。能读取数据根的本地用户或进程，既可以通过 `penguin auth token` 等系统命令读取该令牌并作为管理员调用全部 HTTP 接口，也可以直接管理本地 Server 进程的生命周期。需要限制为非管理员的运行环境，通过文件系统隔离将数据根排除在可读范围之外。

### 示例：Sandbox 内的双表面协作

一个在沙盒（Sandbox）内执行命令的 Agent 示例展示了两个表面如何协同工作：

1. **注入沙盒视角与 Agent 令牌**：宿主在沙盒内启动工具子进程时，将文件系统的可见范围限制在工作区目录与沙盒临时目录内（宿主的数据根不可见），同时向环境变量注入宿主 Server 的 `PENGUIN_API_URL` 与为该 Agent 签发的会话令牌 `PENGUIN_API_TOKEN`。
2. **在沙盒内执行本地系统操作（CLI = system permissions）**：Agent 在沙盒内运行 shell 命令或 `penguin` CLI 时，CLI 在沙盒进程内本地启动，只能看到并操作以沙盒为视角的终端与文件系统。
3. **通过令牌调用受控的 Penguin 能力（HTTP = penguin permissions）**：当沙盒内的 CLI 请求 Server 时，它携带环境变量中的 Agent 会话令牌。Server 根据令牌对应的 Agent 角色与目标路由 `id` 校验权限，放行该角色允许的接口并把数据范围限制在该 Agent 所属的项目中。

### 路由 ID 注册与声明式角色树（Role Tree Bind）

每一条注册到 `HttpModule.routes` 槽的 HTTP 路由都带有一个点分结构的 `id`，这个 `id` 直接作为角色树的叶子节点用于管理授权：

```ts
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "session.list", method: "GET", prefix: "/api/projects/:projectId/agents/:agentId/sessions", auth: "user", order: 250 },
      { id: "session.create", method: "POST", prefix: "/api/projects/:projectId/agents/:agentId/sessions", auth: "user", order: 250 },
    ],
  },
})
```

组件用 `endpointOf(group, method, subPath)` 将单条路由贡献绑定到 `Hono` 路由组上的对应处理器；对按前缀挂载的多端点路由组，鉴权网关通过 `resolveHttpRouteId(groupId, method, subPath)` 将每个 `(method, subPath)` 子路由映射为稳定的细粒度路由 `id`。

角色预设组织为一棵声明式的有向无环角色树（`ROLE_TREE`）：

- **域级三层角色节点**：每个业务域（如 `session`、`workspace`、`agent`、`memory`、`schedule`、`skill`、`plugin`、`workbench`、`model`、`vault`、`trace`、`benchmark`、`org`、`browser`、`machine`、`agents.messaging`、`messaging`、`project`、`command`、`system`、`admin`）提供 `<domain>.read`、`<domain>.maintain`、`<domain>.all` 三层递进节点。`<domain>.maintain` 继承 `<domain>.read` 子节点并追加日常维护写路由；`<domain>.all` 继承 `<domain>.maintain` 子节点并追加删除与高危管理路由。
- **复合角色节点**：顶层预设角色（`none`、`readonly`、`general`、`system-maintainer`、`admin`、`full-permissions`）作为同一棵树上的高层节点，通过 `children` 数组组合各域的角色节点。
- **权限精化器（`<roleOrRoute>@<refinerId>`）**：角色节点引用或额外授权项可以附加 `@<refinerId>` 后缀（例如 `agent.maintain@self`、`agent.maintain@withAsk`），将对应写路由绑定到具名的 `AuthRefiner` 组件上执行上下文校验。

每个受控授权会话绑定一个角色标识与一份当前授权，在请求时由 `expandRoleGrant(role, extraGrants)` 递归展开角色树，计算出有效路由 `id` 集合（`apiIds`）、每条路由绑定的精化器列表（`routeRefiners`）以及正交能力标志（`allEndpoints`、`agentApi`、`crossAgent`）。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### HTTP 路由贡献形状与 `endpointOf`

`HttpModule.routes` 槽的数据类型包含以下字段：

- `id: string`——路由或路由组的唯一标识，按 `<域>.<动作>` 或 `<域>.<子域>.<动作>` 命名（例如 `session.list`、`workspace.readFile`、`command.run`、`model.updateConfig`、`vault.set`、`org.ticket.start`）。
- `method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"`——可选的单方法限定。指定时，宿主只在该 HTTP 方法与路径上挂载处理器；省略时，挂载整个子路由组，并在路由网关内按 `(groupId, method, subPath)` 解析出每个端点的细粒度路由 `id`。
- `prefix: string`——挂载在 HTTP 应用上的路径模式。
- `auth: "user" | "token" | "none"`——路由的鉴权门类（`"user"` 接受人类会话、本机 API 令牌或被授权的 Agent 会话；`"token"` 仅接受本机 API 令牌；`"none"` 为公开路由）。
- `order: number`——路由挂载顺序。
- `endpoints?: Readonly<Record<string, string>>`——可选的多端点子路由映射表（键为 `"METHOD /subpath"`，值为细粒度路由 `id`），让模块或插件在贡献 Hono 路由组时直接注册子端点 `id`。
- `roles?: readonly string[]`——可选的角色绑定列表（支持 `<roleId>@<refinerId>`，例如 `["readonly"]` 或 `["myPlugin.maintain", "general@self"]`），将当前路由（及 `endpoints` 中的子路由）直接授予指定角色节点。

当一个路由组件在一个 `Hono` 实例上定义多个动作时，`endpointOf(group, method, subPath)` 构造一个只响应指定方法与路径的轻量 `Hono` 包装，保留原路由组的中间件与错误处理器，并将请求分发到目标处理器。这样既保持组件内部共享依赖，又让每条端点在清单中拥有独立的路由 `id`。

### 可扩展角色注册表（`RoleRegistry`）与 `HttpModule.roles` 槽

角色树由可扩展的 `RoleRegistry` 管理。核心模块与外部插件通过 `HttpModule.roles`（或 `AgentAuthPermissionProvider.roles`）槽贡献 `RoleContribution` 条目，按并集方式定义新角色节点或扩展既有角色，无需修改中心静态表：

```ts
@Component({
  contributes: {
    "HttpModule.roles": [
      {
        id: "myPlugin.read",
        routes: ["myPlugin.items.list"],
        parents: ["readonly"],
      },
      {
        id: "myPlugin.maintain",
        children: ["myPlugin.read"],
        routes: ["myPlugin.items.update"],
        parents: ["general@self", "system-maintainer"],
      },
    ],
  },
})
```

- `role?: string`——目标角色名，默认取贡献条目的 `id`；当多个模块扩展同一个既有角色（如 `"readonly"`）时，各自保持全局唯一的 `id` 并通过 `role` 指向同一角色节点。
- `children?: readonly string[]`、`routes?: readonly string[]`、`flags?: RoleFlags`——向目标角色节点按集合并集追加子角色、路由（支持点分通配符如 `myPlugin.*` 与 `agents.messaging.*.get`）与能力标志。
- `parents?: readonly string[]`——将当前角色挂载到指定父角色的 `children` 中（支持在父角色项上附加 `@<refinerId>`，例如 `"general@self"` 会向 `general` 注入 `<role>@self`）。

### 声明式角色树（`ROLE_TREE`）与权限范围

角色树中的每个节点（`RoleTreeNode`）由三部分构成：包含的子角色节点列表 `children`、直接授予的叶子路由 `routes`、以及正交能力标志 `flags`。

各业务域遵循统一的三层递进结构：

| 域角色层级 | 树包含关系（`children`） | 直接授予的叶子路由（`routes`） |
| --- | --- | --- |
| `<domain>.read` | `[]` | 该域下的只读查询、列表与流式订阅路由（如 `session.list`、`session.get`、`session.stream`） |
| `<domain>.maintain` | `["<domain>.read"]` | 该域下的创建、更新、执行与日常协作写路由（如 `session.create`、`session.runTask`、`session.steer`） |
| `<domain>.all` | `["<domain>.maintain"]` | 该域下的删除、强制清理与高危管理路由（如 `session.delete`、`session.deleteArchived`） |

在此基础上，六个顶层复合角色通过组合域角色节点与正交能力标志构成标准权限梯度：

| 复合角色 | 包含的子角色节点（`children`） | `allEndpoints` | `agentApi`（通过 `requireHuman`） | `crossAgent`（跨 Agent 写） |
| --- | --- | --- | --- | --- |
| `none` | `[]` | `false` | `false` | `false` |
| `readonly` | 全部业务域的 `*.read` 节点 | `false` | `false` | `false` |
| `general`（默认） | `readonly` + `session.maintain`、`workspace.maintain`、`agent.maintain@self`、`memory.maintain@self`、`schedule.maintain@self`、`workbench.maintain@self`、`org.maintain`、`browser.maintain` | `false` | `false` | `false` |
| `system-maintainer` | `general` + `agent.maintain`、`memory.maintain`、`schedule.maintain`、`workbench.maintain`、`skill.maintain`、`plugin.maintain`、`model.maintain`、`vault.maintain`、`trace.maintain`、`benchmark.maintain`、`machine.maintain`、`agents.messaging.maintain`、`messaging.maintain` | `false` | `true` | `true` |
| `admin` | `system-maintainer` + 全部业务域的 `*.all` 节点 | `true` | `false` | `true` |
| `full-permissions` | `["admin"]` | `true` | `true` | `true` |

### 权限精化器（`<roleOrRoute>@<refinerId>`）与优先级覆盖

权限精化器（`AuthRefiner`）是通过 `HttpModule.authRefiners` 槽贡献的轻量鉴权组件，使用 `<roleOrRoute>@<refinerId>` 语法对角色节点或单条路由施加上下文约束（例如 `agent.maintain@self`、`agent.maintain@withAsk`）：

```ts
@Component({
  contributes: {
    "HttpModule.authRefiners": [
      { id: "self", scope: ["agent.", "memory.", "schedule.", "workbench."], order: 1001 },
    ],
  },
})
export class AuthSelfRefiner {
  @Bind("self") readonly refiner: AuthRefiner = this;
  async authenticate(
    ctx: AuthRefinerContext,
    action: AuthRefinerAction,
    request: Request,
  ): Promise<boolean> {
    return action.params.agentId === undefined || action.params.agentId === ctx.agentId;
  }
}
```

- **作用域声明（`scope`）与 O(1) 路由分发**：每个精化器声明自己匹配的 `scope`（路由 ID、角色节点名或域前缀，如 `["agent."]`），注册表在启动时将其编译为哈希集合与前缀索引。请求到达时仅按当前 `routeId` 绑定的 `refinerId` 直接查找，避免遍历无关中间件。
- **按列表顺序覆盖（Override）**：`HttpModule.authRefiners` 槽按模块 `children` 列表声明顺序（如 `[AuthMyRefiner, AuthWithAskRefiner, AuthSelfRefiner]`）收集条目，并按可选的 `order ?? 0` 做稳定排序（内置 `AuthWithAskRefiner` 与 `AuthSelfRefiner` 设为 `1000+`，使未指定 `order` 的自定义组件与外部插件默认优先）。同 `id` 的精化器按列表顺序优先匹配；若排在前面的自定义精化器仅声明了窄 `scope`（如 `["agent.config.update"]`），其余路由自动回退到列表中后续同 `id` 的内置实现。
- **失败与失配保护**：若授权引用了未定义的 `@<refinerId>`，请求直接拒绝并返回 `403 auth_refiner_undefined`。若会话内精化器的 `scope` 未能匹配目标动作或执行异常，服务端返回 `403 auth_refiner_mismatch`，提示用户以 `admin` 权限启动 Agent 修复授权配置。当 `<domain>.maintain@<refinerId>` 展开时，其继承的 `<domain>.read` 只读层保持无条件放行，且同一路由上的无条件授权优先于带精化器的授权，保证常规会话下的高可靠匹配。

### 授权会话与按代（Generation）实时派生

授权会话机制将**会话凭证**与**当前权限代际（Generation）**解耦存储，当前用于 Agent 会话并可同样服务于人类用户的受限角色会话：

- **会话记录**：仅落盘会话令牌的 SHA-256 哈希（明文令牌仅在签发时返回一次）、关联主体标识、签发时的角色与代数（`generation`）、创建时间、过期时间及最近使用时间。
- **权限代际记录**：按主体维护当前代数 `generation`、当前角色 `role` 以及显式授予的路由 ID 列表 `apiIds`。

每次请求携带会话令牌到达时，鉴权层在验证会话未过期后，读取该主体的当前权限代际并实时展开角色树，派生出有效授权集（`{ role, generation, allEndpoints, apiIds, routeRefiners }`）。调整主体的角色或额外路由授权时，只需递增代数（`bumpGeneration`），已签发的活跃令牌无需重新签发即可在下一次请求时按新权限生效；当主体被归档或注销时，可一次性吊销其全部活跃会话与代际记录。

### HTTP 鉴权与路由级授权流程

每个进入 `HttpModule` 的受保护请求依次执行两步判定：

1. **身份鉴别（Authentication）**：
   - 若 Bearer 令牌匹配本机 API 令牌或人类用户的登录会话令牌，请求获得对应人类用户的身份（`c.var.user`）。
   - 若请求在 `auth: "user"` 门下携带 Agent 会话令牌并通过 `AgentAuthService.authenticate(bearer, now)`，中间件在 `c.var.agentAuth` 上挂载 `{ projectId, agentId, grant, agentApi }`，并将关联项目所有者（或默认管理员）映射为请求上下文用户（仅当 `grant.allEndpoints` 为真时保留 `isAdmin`）。
2. **路由级授权（Route Authorization）**：
   - 对人类用户请求：按既有的用户与管理员规则放行。
   - 对 Agent 请求（`c.var.agentAuth` 存在）：在路由入口执行 `checkRouteAuth(c, route.id)`：
     - 校验端点授权：要求 `grant.allEndpoints === true` 或 `grant.apiIds.includes(routeId)`，未命中时返回 `403 permission_required`。
     - 校验项目隔离：当 `grant.allEndpoints === false` 且路由包含 `:projectId` 参数时，要求 `:projectId === agentAuth.projectId`，跨项目访问返回 `403 permission_required`。
     - 校验跨 Agent 写隔离：当 `grant.allEndpoints === false` 且 `grant.crossAgent !== true` 时，若路由带有 `:agentId` 参数且 `:agentId !== agentAuth.agentId`，除只读 `GET` 请求与跨 Agent 发起会话（`session.create`）外，其余修改其他 Agent 的写请求返回 `403 permission_required`。
     - 校验人类专属门（`requireHuman`）：仅当 `agentAuth.agentApi === true`（如 `system-maintainer` 或 `full-permissions` 角色）时放行，其余返回 `403 human_required`。

### CLI 表面的边界划分

CLI 命令按执行位置分为两类：

- **本地系统命令**：直接在本地进程访问操作系统与数据根，包括 `penguin server`（启动、停止、状态查询、重置管理员密码）、`penguin web`、`penguin auth token`（读取本地数据根的 `api-token`）以及打印本地编译构建标识的 `penguin version`。
- **HTTP 业务命令**：涵盖其余全部命令，包括 `penguin chat`、`penguin agent`、`penguin session`、`penguin send`、`penguin cost`、`penguin schedule`、`penguin org`、`penguin plugin`、`penguin exec`、`penguin config model`、`penguin config vault` 以及 `penguin version --json`。这些命令通过 `resolveConnection` 读取连接参数（优先使用 `PENGUIN_API_URL` 与 `PENGUIN_API_TOKEN`，否则从指定 `--root` 或 `PENGUIN_HOME` 解析 `server.lock`、`cli-session.json` 或 `api-token`），再通过 `ServerClient` 请求 HTTP 表面。

## Invariants
[invariants]: #invariants

### 业务能力经由 HTTP 表面授权

> 无论调用方从终端 CLI 还是外部客户端发起请求，读写 Penguin 业务状态的操作都经由 [HTTP 表面](#guide-level-explanation) 执行，并受同一套路由级授权规则约束。

CLI 持有本地进程的 system permissions，而 Penguin 的业务状态归 Server 守护。保持业务操作统一经由 HTTP 表面，确保用户会话与 Agent 角色的权限边界在所有入口上一致生效。

### 数据根访问权即管理员权限

> 无论部署在何种环境中，对 [Penguin 数据根](#guide-level-explanation) 具备本地读取权限的进程都可取得管理员凭证；需要限制为非管理员的运行环境必须隔离数据根的文件系统访问。

数据根存放实例的 `api-token`、数据库与机密文件。把数据根的文件系统访问权定义为系统层的管理员分界线，使本地管理与沙盒隔离都遵循操作系统原生的文件权限模型。

### 每条受保护的 HTTP 路由由唯一 ID 标识

> 无论 HTTP 路由由核心模块还是插件贡献，每条挂入 `HttpModule.routes` 的路由都携带唯一的 [路由 `id`](#reference-level-explanation)，Agent 角色的端点白名单始终按该 `id` 判定。

路由 `id` 将 URL 结构与授权策略解耦。路径参数或挂载前缀演进时，角色授权表仍以稳定的 `id` 引用端点。

## Drawbacks
[drawbacks]: #drawbacks

业务类 CLI 子命令（包括 `penguin config model`、`penguin config vault` 与 `penguin version --json`）依赖一个可达的 Server 进程来执行请求。将多动作路由拆分为按 `method` 与子路径粒度的独立贡献条目，也增加了 `HttpModule.routes` 清单中的条目数量。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**按表面划分权限（CLI = system，HTTP = penguin）**：让操作系统负责进程、TTY 与文件系统隔离，让 HTTP Server 负责角色、路由白名单与项目隔离，两层各自使用最直接的原语。

**按路由 `id` 授权替代按 URL 路径正则授权**：路由 `id` 在编译期投影进 `ifaces.json`，语义稳定且可静态枚举；URL 正则容易随路径重构而失效。

**代数计数器加服务端会话替代无状态令牌**：按代际实时派生权限支持在主体注销或角色变更时立即使该主体名下的全部令牌切换到新权限或失效，同时保留按单个会话撤销的能力。

## Prior art
[prior-art]: #prior-art

**Docker CLI / Daemon 与 Kubernetes `kubectl` / `kube-apiserver`** 采用了相同的双表面划分：CLI 在调用方的本地系统环境中运行并受本地文件权限约束，所有守护进程与集群状态变更通过带认证的 HTTP API 完成；对守护进程 socket 或管理员凭据文件拥有本地读取权限即等价于拥有管理员权限。

**AWS IAM Action IDs** 以 `<service>:<action>` 形式的具名动作标识（而非底层 HTTP URL 路径）作为角色策略的授权单元，本设计的路由 `id` 扮演同样的角色。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 当前无未决问题。

## Future possibilities
[future-possibilities]: #future-possibilities

- 将同一套声明式角色树与按代派生的授权会话扩展至人类用户的精细角色会话与受限访问令牌。
- 在管理界面展示并编辑每个角色的路由 `id` 白名单，支持按项目或单个主体覆盖默认授权。
- 为沙盒内的短期子任务签发带过期时间与更窄路由 `id` 子集的临时会话令牌。

---

## Changes

### v1.0.0

- 初始版本（草案，原生于此仓库）。
