# PRFC-0026 Authorization：双表面权限模型与路由级 HTTP 授权

[English](PRFC-0026-authorization.md)

- Feature Name: `authorization`
- Start Date: 2026-11-20
- PRFC PR: [#1875](https://github.com/Prism-Shadow/penguin-harness/pull/1875)
- Implementation PR: —

## Summary
[summary]: #summary

这套 harness 的授权模型将能力边界划分为 **CLI 表面**（承载本地系统权限）与 **HTTP 表面**（承载应用级 Penguin 权限）两个表面。**CLI 表面**在本地进程中执行，以当前操作系统环境（terminal、TTY、filesystem）为权限核心，并通过访问 HTTP 表面获得 Penguin 的业务能力。**HTTP 表面**在 Server 进程中执行，通过具名的路由 `id`、声明式角色树、上下文感知的权限精化器与绑定角色的授权会话对每次调用做授权判定。对 Penguin 数据根（`PENGUIN_HOME`）拥有本地读取权限等价于拥有 Penguin 管理员权限（`Access to Penguin Home Root = penguin admin`）。

## Motivation
[motivation]: #motivation

### 两个表面各自守住不同的信任边界

终端命令与服务端接口运行在不同的上下文中，各自持有不同的权限来源。CLI 运行在调用方自己的进程与工作目录里，受操作系统用户、TTY 与文件系统命名空间约束。HTTP 表面运行在 Server 进程里，面对跨进程或跨网络的调用方，靠请求凭证识别调用方身份并限制可访问的资源范围。

### CLI 直接操作数据根会绕过 HTTP 授权层

当业务命令在 CLI 进程内直接读写数据根下的配置文件或数据库时，HTTP 表面的角色与范围检查便无法介入。将所有 Penguin 业务能力收敛到 HTTP 表面，让 CLI 统一通过 HTTP 访问 Server（仅保留本机 Server 生命周期、Web 启动器以及本机令牌与版本读取命令在本地执行），应用权限就能集中在同一处判定与审计。

### Agent 调用需要按路由 ID 收窄的凭证

不同职责的 Agent 需要不同范围的 HTTP 访问权限。例如，默认对话 Agent 管理会话、工作区以及自身的定时任务与工作台；Agent 创建者或插件维护者 Agent 管理技能、模型或插件；组织内的员工 Agent 调用组织协作接口。为每个 Agent 签发绑定角色的会话令牌，并将每条 HTTP 路由以稳定的 `id` 注册到模块树上，授权层就能按路由 `id` 集合、上下文精化器与项目边界精确放行。

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

### 权限哲学：CLI = system permissions，HTTP = penguin permissions

这套 harness 的权限由两条规则锚定：**CLI = system permissions**，**HTTP = penguin permissions**。

- **CLI 表面**在本地执行，以当前系统环境（terminal、TTY、fs）为权限核心。它能读写哪些本地路径、能附加哪个终端流、能访问哪个本地套接字，由操作系统赋给当前进程的权限决定。当 CLI 执行 Penguin 业务操作（管理 Agent、会话、模型配置、Vault 机密、定时任务、插件与版本报告）时，它作为客户端请求 HTTP 表面。
- **HTTP 表面**守护所有 Penguin 业务能力。Server 验证每次请求携带的凭据，识别调用方身份与角色授权，再根据目标路由的 `id`、项目范围与绑定的权限精化器决定放行或拒绝。

### HTTP 表面的三类认证凭据

HTTP 表面识别三类请求凭据：

1. **人类登录会话（`auth_sessions`）**：人类用户通过 `/api/auth/login` 或 `/api/auth/setup` 登录时签发，通过 `penguin_session` Cookie 或会话 Bearer 令牌传递，解析为该人类用户的身份与管理员标志。
2. **本机实例 API 令牌（`<root>/api-token`）**：Server 启动时在 `PENGUIN_HOME` 下以 `0600` 权限生成，作为 Bearer 令牌在 `"token"` 与 `"user"` 两类路由门下均以管理员权限放行。
3. **绑定角色的授权会话（`auth_role_sessions` 中的 `pga_...`）**：按绑定的角色与权限代际签发给 Agent（或受限角色调用方），作为 Bearer 令牌在 `"user"` 路由门下接受路由级授权检查。

### Access to Penguin Home Root = penguin admin

对 Penguin 数据根（`PENGUIN_HOME`）拥有本地文件系统读取权限，等价于拥有该实例的 `penguin admin` 权限。

Server 启动时在数据根下写入权限为 `0600` 的 `api-token` 与 `server.lock`。能读取数据根的本地用户或进程，既可以通过 `penguin auth token` 等系统命令读取该令牌并作为管理员调用全部 HTTP 接口，也可以直接管理本地 Server 进程的生命周期。限制调用方低于管理员权限的运行环境，通过文件系统隔离将数据根排除在可读范围之外。

### 示例：Sandbox 内的双表面协作

一个在沙盒（Sandbox）内执行命令的 Agent 示例展示了两个表面如何协同工作：

1. **注入沙盒视角与 Agent 令牌**：宿主在沙盒内启动工具子进程时，将文件系统的可见范围限制在工作区目录与沙盒临时目录内（宿主的数据根不可见），同时向环境变量注入为该 Agent 签发的绑定角色会话令牌 `PENGUIN_API_TOKEN`（`pga_...`）。
2. **在沙盒内执行本地系统操作（CLI = system permissions）**：Agent 在沙盒内运行 shell 命令或 `penguin` CLI 时，CLI 在沙盒进程内本地启动，在沙盒的终端与文件系统视图内操作。
3. **通过令牌调用受控的 Penguin 能力（HTTP = penguin permissions）**：当沙盒内的 CLI 请求 Server 时，它携带 `PENGUIN_API_TOKEN`。Server 根据令牌对应的 Agent 角色、路由 `id` 授权与精化器规则校验权限，放行该角色允许的接口并把数据范围限制在该 Agent 所属的项目中。

### 路由 ID 注册与声明式角色树（`ROLE_TREE`）

每一条注册到 `HttpModule.routes` 槽的 HTTP 路由都带有一个点分结构的 `id`，这个 `id` 直接作为角色树的叶子节点用于管理授权。以下示例展示了 `session` 域的两条路由贡献：

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

组件用 `endpointOf(group, method, subPath)` 将单条路由贡献绑定到 `Hono` 路由组上的对应处理器。

角色预设组织为一棵声明式的有向无环角色树（`ROLE_TREE`）：

- **域级三层角色节点**：每个业务域（`session`、`workspace`、`agent`、`memory`、`schedule`、`skill`、`plugin`、`workbench`、`model`、`vault`、`trace`、`benchmark`、`org`、`browser`、`machine`、`agents.messaging`、`messaging`、`project`、`command`、`system`、`admin`）提供 `<domain>.read`、`<domain>.maintain`、`<domain>.all` 三层递进节点。`<domain>.maintain` 继承 `<domain>.read` 子节点并追加日常维护写路由；`<domain>.all` 继承 `<domain>.maintain` 子节点并追加删除与管理路由。
- **复合工作流角色节点**：内置工作流角色（`none`、`readonly`、`general`、`general-with-ask`、`agent-creator`、`plugin-maintainer`、`workbench-maintainer`、`system-maintainer`、`admin`、`full-permissions`）作为同一棵树上的高层节点，通过 `children` 数组组合各域的角色节点。
- **权限精化器（`<roleOrRoute>@<refinerId>`）**：角色节点引用或额外授权项可以附加 `@<refinerId>` 后缀（例如 `agent.maintain@self` 或 `agent.maintain@withAsk`），将对应写路由绑定到具名的 `AuthRefiner` 组件上执行上下文校验。

每个绑定角色的授权会话关联一个角色标识与一份按代际（`generation`）缓存的当前授权，由 `expandRoleGrant(role, extraGrants)` 展开角色树，构建有效路由 `id` 哈希集合（`apiIds: ReadonlySet<string>`）、预编译的路由精化器映射（`routeRefiners`）与能力标志（`allEndpoints`、`agentApi`）。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### HTTP 路由贡献形状与 `endpointOf`

`HttpModule.routes` 槽的数据类型包含以下字段：

- `id: string`——路由或路由组的唯一标识，按 `<域>.<动作>` 或 `<域>.<子域>.<动作>` 命名（例如 `session.list`、`workspace.readFile`、`command.run`、`model.updateConfig`、`vault.set`、`org.ticket.start`）。
- `method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "ALL"`——可选的单方法限定。指定时，宿主只在该 HTTP 方法与路径上挂载处理器；省略时，挂载整个子路由组。
- `prefix: string`——挂载在 HTTP 应用上的路径模式。
- `auth: "user" | "token" | "none"`——路由的鉴权门类（`"user"` 接受人类登录会话、本机 API 令牌或被授权的角色会话；`"token"` 仅接受本机 API 令牌；`"none"` 为公开路由）。
- `order: number`——路由挂载顺序。
- `role?: string` 与 `roles?: readonly string[]`——可选的角色绑定声明（支持 `<roleId>@<refinerId>`，例如 `"readonly"` 或 `["myPlugin.maintain", "general@self"]`），将当前路由直接授予指定角色节点。路由 `id` 与角色声明均使用精确标识，拒绝 `*` 通配符。

当一个路由组件在一个 `Hono` 实例上定义多个动作时，`endpointOf(group, method, subPath)` 构造一个只响应指定方法与路径的轻量 `Hono` 包装，复制原路由组的顶层 `ALL /*` 中间件与 `errorHandler`，并将请求分发到目标处理器。这样既保持组件内部共享依赖，又让每条端点在清单中拥有独立的路由 `id`。

### 可扩展角色注册表（`RoleRegistry`）与 `roles`、`roleBindings` 槽

角色树与路由授权映射通过模块声明式贡献组装（`AgentAuthPermissionProvider` 贡献内置复合角色，各业务模块及外部插件各自贡献所属域角色、路由 `role` 声明与 `roleBindings`）：

1. **角色节点贡献（`HttpModule.roles` / `AgentAuthPermissionProvider.roles`）**：组件通过贡献 `RoleContribution` 条目按并集方式定义新角色节点或扩展既有角色。以下示例展示了一个插件贡献 `.read` 与 `.maintain` 角色节点并挂载到父复合角色：

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
        parents: ["general@self", "plugin-maintainer", "system-maintainer"],
      },
    ],
  },
})
```

- `role?: string`——目标角色名，默认取贡献条目的 `id`；当多个模块扩展同一个既有角色（如 `"readonly"`）时，各自保持全局唯一的 `id` 并通过 `role` 指向同一角色节点。
- `children?: readonly string[]`、`routes?: readonly string[]`、`flags?: RoleFlags`——向目标角色节点按集合并集追加子角色、精确路由 `id` 与能力标志。注册与授权展开阶段均拒绝任何包含 `*` 的通配符模式。
- `parents?: readonly string[]`——将当前角色挂载到指定父角色的 `children` 中（支持在父角色项上附加 `@<refinerId>`，例如 `"general@self"` 会向 `general` 注入 `<role>@self`）。

2. **统一 `role -> http` 绑定贡献（`HttpModule.roleBindings` / `AgentAuthPermissionProvider.roleBindings`）**：模块可在路由定义之外独立贡献 `RoleHttpBindingContribution` 条目，统一声明角色到 HTTP 路由 `id` 的绑定：

- `role?: string` 与 `routes?: readonly string[]`——将单个角色（支持 `<roleId>@<refinerId>`）绑定到一组精确的 HTTP 路由 `id`。
- `bindings?: Readonly<Record<string, readonly string[]>>`——批量映射多个角色标识到各自的精确 HTTP 路由 `id` 列表。
- `aliases?: Readonly<Record<string, string>>`——注册路由 `id` 前缀兼容别名。

### 声明式角色树（`ROLE_TREE`）与权限范围

角色树中的每个节点（`RoleTreeNode`）由三部分构成：包含的子角色节点列表 `children`、直接授予的叶子路由 `routes`、以及能力标志 `flags`。

各业务域遵循统一的三层递进结构：

| 域角色层级 | 树包含关系（`children`） | 直接授予的叶子路由（`routes`） |
| --- | --- | --- |
| `<domain>.read` | `[]` | 该域下的只读查询、列表与流式订阅路由（例如 `session.list`、`session.get`、`session.stream`） |
| `<domain>.maintain` | `["<domain>.read"]` | 该域下的创建、更新、执行与日常协作写路由（例如 `session.create`、`session.runTask`、`session.steer`） |
| `<domain>.all` | `["<domain>.maintain"]` | 该域下的删除、清理与管理路由（例如 `session.delete`、`session.deleteArchived`） |

复合角色通过组合域角色节点与能力标志构成内置工作流角色梯度：

| 复合角色 | 包含的子角色节点（`children`） | `allEndpoints` | `agentApi`（通过 `requireHuman`） |
| --- | --- | --- | --- |
| `none` | `[]` | `false` | `false` |
| `readonly` | 全部业务域的 `*.read` 节点 | `false` | `false` |
| `general`（默认） | `readonly` + `session.maintain`、`workspace.maintain`、`agent.maintain@self`、`memory.maintain@self`、`schedule.maintain@self`、`workbench.maintain@self`、`org.maintain`、`browser.maintain` | `false` | `false` |
| `general-with-ask` | `general` + `agent.maintain@withAsk`、`memory.maintain@withAsk`、`schedule.maintain@withAsk`、`workbench.maintain@withAsk`、`skill.maintain@withAsk`、`plugin.maintain@withAsk`、`model.maintain@withAsk`、`vault.maintain@withAsk`、`trace.maintain@withAsk`、`benchmark.maintain@withAsk`、`machine.maintain@withAsk`、`agents.messaging.maintain@withAsk`、`messaging.maintain@withAsk` | `false` | `false` |
| `agent-creator` | `general` + `agent.maintain`、`memory.maintain`、`schedule.maintain`、`skill.maintain`、`model.maintain`、`vault.maintain`、`agents.messaging.maintain`、`messaging.maintain` | `false` | `false` |
| `plugin-maintainer` | `general` + `plugin.maintain`、`skill.maintain`、`workbench.maintain` | `false` | `false` |
| `workbench-maintainer` | `general` + `workbench.maintain` | `false` | `false` |
| `system-maintainer` | `general`、`agent-creator`、`plugin-maintainer`、`workbench-maintainer` + `trace.maintain`、`benchmark.maintain`、`machine.maintain` | `false` | `true` |
| `admin` | `system-maintainer` + 全部业务域的 `*.all` 节点 | `true` | `true`（继承自 `system-maintainer`） |
| `full-permissions` | `["admin"]` | `true` | `true` |

### 权限精化器（`<roleOrRoute>@<refinerId>`）与优先级覆盖

权限精化器（`AuthRefiner`）是通过 `HttpModule.authRefiners` 槽贡献的轻量鉴权组件，使用 `<roleOrRoute>@<refinerId>` 语法对角色节点或单条路由施加上下文约束（例如 `agent.maintain@self` 或 `agent.maintain@withAsk`）。以下示例展示了内置的 `self` 精化器：

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
    if (action.params.agentId !== undefined) {
      return action.params.agentId === ctx.agentId;
    }
    return !action.routeId.startsWith("agent.");
  }
}
```

- **作用域声明（`scope`）与 O(1) 路由分发**：每个精化器声明自己覆盖的 `scope`（路由 ID、角色节点名或域前缀，例如 `["agent."]`），`AuthRefinerRegistry` 在启动时将其编译为哈希集合与前缀索引，请求到达时仅评估目标 `routeId` 绑定的 `refinerId`。对于带 `@self` 约束的 `agent.*` 写路由，`self` 要求路径参数提供且满足 `action.params.agentId === ctx.agentId`，当路由参数不含 `agentId`（例如项目级的 `agent.create`）时按默认拒绝（fail closed）处理，交由后续 `@withAsk` 审批或显式的 `agent-creator` 角色授权放行新 Agent 创建。
- **按列表顺序覆盖（Override）**：`HttpModule.authRefiners` 槽按模块 `children` 列表声明顺序收集条目，并按可选的 `order ?? 0` 做稳定排序（内置 `AuthWithAskRefiner` 与 `AuthSelfRefiner` 设为 `1000+`，使未指定 `order` 的自定义组件与外部插件默认优先）。同 `id` 的精化器按列表顺序优先匹配；若排在前面的自定义精化器仅声明了窄 `scope`，其余路由回退到列表中后续同 `id` 的实现。
- **多精化器评估顺序与 `@withAsk` 升级决策**：当一条路由同时绑定多个精化器（例如 `general-with-ask` 下 `agent.maintain` 绑定 `["self", "withAsk"]`）时，非交互式精化器（`self`）优先执行；若非交互式精化器放行，请求立即通过且不弹出询问。仅当非交互式精化器未放行时，才回退执行 `AuthWithAskRefiner`（`@withAsk`）向用户发起审批，支持三种审批决策：`allowed_once`（仅放行本次请求）、`allowed_for_agent`（在当前 Agent 会话内持久放行）、`always_allowed`（将授权写入 `auth_generations.allowed_apis` 并递增该主体的 `generation`）。
- **失败与失配保护**：若授权引用了未定义的 `@<refinerId>`，请求直接拒绝并返回 `403 auth_refiner_undefined`。若会话内精化器的 `scope` 未能匹配目标动作或执行抛出异常，服务端返回 `403 auth_refiner_mismatch`，提示用户以 `admin` 权限启动 Agent 修复授权配置。当 `<domain>.maintain@<refinerId>` 展开时，其继承的 `<domain>.read` 只读层保持无条件放行，且同一路由上的无条件授权优先于带精化器的授权。

### 授权会话与按代（Generation）实时派生

授权会话机制将**会话凭据**（`auth_role_sessions`）与主体的**当前权限代际**（`auth_generations`）解耦存储，当前服务于 Agent 会话并可自然扩展至人类用户的受限角色会话：

- **会话记录（`auth_role_sessions`）**：仅存储原始令牌的 SHA-256 哈希（明文 `pga_...` 令牌仅在签发时返回一次）、主体标识（`subject_id`、`subject_kind`）、`project_id`、`agent_id`、签发时的 `role` 与 `generation`、`created_at`, `expires_at` 及 `last_used_at`。
- **权限代际记录（`auth_generations`）**：按主体维护当前代数 `generation`、当前角色 `role` 以及 `allowed_apis`（持久化的授权表达式 JSON 数组，元素可为路由 ID、角色 ID 或 `<roleOrRoute>@<refinerId>`）。

当请求携带绑定角色的会话 Bearer 令牌到达时，鉴权层验证会话未过期后读取该主体的当前代际记录，并按主体（`subject_id` / `(projectId, agentId)`）隔离、以 `(subject_id, generation, role, registryVersion, sessionExtraKey)` 为缓存键解析展开后的授权集（`{ role, generation, allEndpoints, agentApi, apiIds, routeRefiners }`）。只要该主体的 `generation`、角色、角色注册表版本与会话级临时附加授权未变，请求直接复用该主体的缓存实例做 $O(1)$ 查找；通过 `bumpGeneration` 更新角色或 `allowed_apis` 即在下一次请求时使该主体的缓存失效并按新权限生效，无需重发令牌；停用或删除主体时一次性吊销其全部活跃会话与代际状态。

### HTTP 鉴权与路由级授权流程

每个进入 `HttpModule` 的受保护请求依次执行两步判定：

1. **身份鉴别（Authentication）**：
   - 携带有效人类登录会话（`penguin_session` Cookie 或 `auth_sessions` Bearer 令牌）或本机实例 API 令牌（`<root>/api-token`）的请求，获得对应人类用户的身份（`c.var.user`）。
   - 在 `auth: "user"` 路由门下，匹配 `AgentAuthService.authenticate(bearer, now)` 的 Bearer 令牌在 `c.var.agentAuth` 上填充 `{ tokenHash, projectId, agentId, grant, agentApi }`，并将项目所有者（或默认管理员）映射为 `c.var.user`（身份鉴别阶段仅当 `grant.allEndpoints === true` 时保留 `isAdmin: true`）。
2. **路由级授权（Route Authorization）**：
   - 人类用户请求按既有的用户与管理员规则执行。
   - 绑定角色的 Agent 请求（`c.var.agentAuth` 存在）在路由处理器前执行 `checkRouteAuth(c, route.id)`：
     - 端点检查：要求 `grant.allEndpoints === true` 或精确命中 `grant.apiIds.has(routeId)`，否则返回 `403 permission_required`。
     - 项目隔离检查：当 `grant.allEndpoints === false` 且路由带有 `:projectId` 路径参数时，要求 `:projectId === agentAuth.projectId`，否则返回 `403 permission_required`。不带 `:projectId` 参数的集合路由（例如 `project.list`）由其路由 `id` 授权（`project.read`）门控，且在 `grant.allEndpoints === false` 时将返回结果过滤至 `agentAuth.projectId`。
     - 权限精化器检查：当路由带有精化器绑定（例如 `<domain>.maintain@self` 或 `<domain>.maintain@withAsk`）时，按上述多精化器顺序执行绑定的 `AuthRefiner` 组件。
     - 门禁通过后的上下文提升：一旦请求通过端点检查、项目隔离与权限精化器校验，除 `session.*` 与 `usage.*` 外的路由将 `c.var.user.isAdmin` 提升为 `true`，使已由路由树与精化器放行的下游处理器顺利执行。
     - 人类专属门（`requireHuman`）：仅当 `agentAuth.agentApi === true`（`system-maintainer`、`admin` 或 `full-permissions`）时放行 Agent 请求，否则返回 `403 human_required`。
     - 鉴权失败来源模块（`sourceModule`）诊断记录：每条角色贡献、HTTP 路由贡献、统一 `role -> http` 绑定贡献与 `AuthRefiner` 注册均记录其来源模块标识（`sourceModule`，取自内核贡献项的 `c.from`）。当鉴权失败时，服务端记录诊断日志并在 `403` 响应的 `details` 字段中附加结构化 `sourceModule` 诊断明细（`sourceModule`、`routeSourceModule`、`roleSourceModules`、`bindingSourceModules`、`refinerSourceModule` 与 `requiredRoles`）。

### CLI 表面的边界划分

CLI 命令按执行位置分为两类：

- **本地系统命令**：直接在本地进程访问操作系统与数据根，包括 `penguin server`（启动、停止、状态查询、重置管理员密码）、`penguin web`、`penguin auth token`（读取本地数据根的 `api-token`）以及打印本地编译构建标识的 `penguin version`。
- **HTTP 业务命令**：涵盖其余全部命令，包括 `penguin chat`、`penguin agent`、`penguin session`、`penguin send`、`penguin cost`、`penguin schedule`、`penguin org`、`penguin plugin`、`penguin exec`、`penguin config model`、`penguin config vault` 以及 `penguin version --json`。这些命令通过 `resolveConnection` 解析目标 Server 与认证凭据（使用会话令牌 `PENGUIN_API_TOKEN`，或从指定 `--root` / `PENGUIN_HOME` 解析 `server.lock`、`cli-session.json` 与 `api-token`），再通过 `ServerClient` 请求 HTTP 表面。

## Invariants
[invariants]: #invariants

### 业务能力经由 HTTP 表面授权

> 无论调用方从终端 CLI 还是外部客户端发起请求，读写 Penguin 业务状态的操作都经由 [HTTP 表面](#guide-level-explanation) 执行，并受同一套路由级授权规则约束。

CLI 持有本地进程的 system permissions，而 Penguin 的业务状态归 Server 守护。保持业务操作统一经由 HTTP 表面，确保用户会话与 Agent 角色的权限边界在所有入口上一致生效。

### 数据根访问权即管理员权限

> 无论部署在何种环境中，对 [Penguin 数据根](#guide-level-explanation) 具备本地读取权限的进程都可取得管理员凭证；限制调用方低于管理员权限的运行环境在文件系统层面隔离数据根。

数据根存放实例的 `api-token`、数据库与机密文件。把数据根的文件系统访问权定义为系统层的管理员分界线，使本地管理与沙盒隔离都遵循操作系统原生的文件权限模型。

### 每条受保护的 HTTP 路由由唯一 ID 标识

> 无论 HTTP 路由由核心模块还是插件贡献，每条挂入 `HttpModule.routes` 的路由都携带唯一的 [路由 `id`](#reference-level-explanation)，Agent 角色的端点白名单始终按该 `id` 判定。

路由 `id` 将 URL 结构与授权策略解耦。路径参数或挂载前缀演进时，角色授权表仍以稳定的 `id` 引用端点。

## Drawbacks
[drawbacks]: #drawbacks

业务类 CLI 子命令（包括 `penguin config model`、`penguin config vault` 与 `penguin version --json`）依赖一个可达的 Server 进程来执行请求。将多动作路由拆分为按 `method` 与子路径粒度的独立贡献条目，也增加了 `HttpModule.routes` 清单中的条目数量。

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

**按表面划分权限（CLI = system，HTTP = penguin）**：让操作系统负责进程、TTY 与文件系统隔离，让 HTTP Server 负责角色、路由白名单与项目隔离，两层各自使用原生原语。

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
