# PRFC-0026 Authorization：双表面权限模型与路由级 HTTP 授权

[English](PRFC-0026-authorization.md)

- Feature Name: `authorization`
- Start Date: 2026-11-20
- PRFC PR: none yet (native to this repository)
- Implementation PR: —

## Summary
[summary]: #summary

本 RFC 定义这套 harness 的授权模型，将能力边界划分为 **CLI** 与 **HTTP** 两个 API 表面。**CLI 表面**在本地进程中执行，以当前操作系统环境（terminal、TTY、filesystem）为权限核心，代表调用方的 **system permissions**（系统权限），并通过访问 HTTP 表面获得 Penguin 的业务能力。**HTTP 表面**在 Server 进程中执行，承载 **penguin permissions**（应用权限），通过具名的路由 `id`、用户会话与 Agent 角色会话（Agent role/session）对每次调用做授权判定。对 Penguin 数据根（Penguin Home Root）拥有本地访问权限等价于拥有 Penguin 管理员权限（`Access to Penguin Home Root = penguin admin`）。

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

### 路由 ID 注册与 Agent 角色授权

每一条注册到 `HttpModule.routes` 槽的 HTTP 路由都带有一个点分结构的 `id`，这个 `id` 直接用于管理授权：

```ts
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "penguin.session.list", method: "GET", prefix: "/api/projects/:projectId/sessions", auth: "user", order: 130 },
      { id: "penguin.session.create", method: "POST", prefix: "/api/projects/:projectId/sessions", auth: "user", order: 130 },
    ],
  },
})
```

组件用 `endpointOf(group, method, subPath)` 将单条路由贡献绑定到 `Hono` 路由组上的对应处理器。每个 Agent 会话绑定一个角色模板（`AgentAuthRole`：`general`、`system-maintainer`、`admin`、`full-permissions`）与一份当前授权（`AgentAuthGrant`），声明该会话是否放行全部端点（`allEndpoints`）、是否允许访问 Agent 自身 API 与密钥设置（`agentApi`），以及允许访问的路由 `id` 列表（`apiIds`）。

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### HTTP 路由贡献形状与 `endpointOf`

`HttpModule.routes` 槽的数据类型包含五个字段：

- `id: string`——路由的唯一标识，按 `<域>.<资源>.<动作>` 命名（例如 `penguin.agent.list`、`penguin.workspace.read`、`penguin.command.exec`、`penguin.config.providers.get`、`penguin.vault.set`）。
- `method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"`——可选的单方法限定。指定时，宿主只在该 HTTP 方法与路径上挂载处理器；省略时，挂载整个子路由组。
- `prefix: string`——挂载在 HTTP 应用上的路径模式。
- `auth: "user" | "token" | "none"`——路由的鉴权门类（`"user"` 接受人类会话、本机 API 令牌或被授权的 Agent 会话；`"token"` 仅接受本机 API 令牌；`"none"` 为公开路由）。
- `order: number`——路由挂载顺序。

当一个路由组件在一个 `Hono` 实例上定义多个动作时，`endpointOf(group, method, subPath)` 构造一个只响应指定方法与路径的轻量 `Hono` 包装，保留原路由组的中间件与错误处理器，并将请求分发到目标处理器。这样既保持组件内部共享依赖，又让每条端点在清单中拥有独立的路由 `id`。

### Agent 角色模板与权限范围

系统定义四种固定的 Agent 角色模板（`AgentAuthRole`）：

| 角色（`AgentAuthRole`） | `allEndpoints` | `agentApi`（通过 `requireHuman`） | 端点与项目范围 |
| --- | --- | --- | --- |
| `general`（默认） | `false` | `false` | 仅限显式授予的 `apiIds`，且 `:projectId` 限于所属项目 |
| `system-maintainer` | `false` | `true` | 显式授予的 `apiIds` + Agent API/密钥端点，`:projectId` 限于所属项目 |
| `admin` | `true` | `false` | 全部 `auth: "user"` 路由（跨项目），不含 `requireHuman` 端点 |
| `full-permissions` | `true` | `true` | 全部 `auth: "user"` 路由（跨项目），含 `requireHuman` 端点 |

### Agent 会话存储与按代（Generation）实时派生

`AgentAuthService` 与 `AgentAuthSessionsRepo` 通过两张数据库表管理 Agent 令牌与权限状态：

- `agent_auth_sessions`：存储令牌的 SHA-256 哈希 `token_hash`、`project_id`、`agent_id`、签发时的 `role` 与 `generation`、`created_at`、`expires_at` 以及 `last_used_at`。明文令牌仅在 `issueSession` 时返回一次，落盘只存哈希。
- `agent_auth_generations`：以 `(project_id, agent_id)` 为复合主键，记录当前代数 `generation`、当前 `role` 以及显式授予的路由 ID 列表 `allowed_apis`（JSON 数组，读取为 `apiIds`）。

每次请求携带 Agent 令牌到达时，`AgentAuthService.authenticate` 在验证会话未过期后，从 `agent_auth_generations` 读取该 Agent 的当前行并实时派生 `AgentAuthGrant { role, generation, allEndpoints, apiIds }`。通过 `bumpGeneration` 调整 Agent 的角色或 `apiIds` 时，已签发的活跃令牌无需重新签发即可在下一次请求时按新权限生效。当 Agent 被归档或删除时，`revokeAll(projectId, agentId)` 一并删除该 Agent 的全部会话行与代数行。

### HTTP 鉴权与路由级授权流程

每个进入 `HttpModule` 的受保护请求依次执行两步判定：

1. **身份鉴别（Authentication）**：
   - 若 Bearer 令牌匹配本机 API 令牌或人类用户的登录会话令牌，请求获得对应人类用户的身份（`c.var.user`）。
   - 若请求在 `auth: "user"` 门下携带 Agent 会话令牌并通过 `AgentAuthService.authenticate(bearer, now)`，中间件在 `c.var.agentAuth` 上挂载 `{ projectId, agentId, grant, agentApi }`，并将关联项目所有者（或默认管理员）映射为请求上下文用户（仅当 `grant.allEndpoints` 为真时保留 `isAdmin`）。
2. **路由级授权（Route Authorization）**：
   - 对人类用户请求：按既有的用户与管理员规则放行。
   - 对 Agent 请求（`c.var.agentAuth` 存在）：在路由入口执行 `checkRouteAuth(c, route.id)`：
     - 校验端点授权：要求 `grant.allEndpoints === true` 或 `grant.apiIds.includes(route.id)`，未命中时返回 `403 permission_required`。
     - 校验项目隔离：当 `grant.allEndpoints === false` 且路由包含 `:projectId` 参数时，要求 `:projectId === agentAuth.projectId`，跨项目访问返回 `403 permission_required`。
     - 校验人类专属门（`requireHuman`）：仅当 `agentAuth.agentApi === true`（即 `system-maintainer` 或 `full-permissions` 角色）时放行，其余返回 `403 human_required`。

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

**代数计数器加会话表替代无状态令牌**：数据库中的 `agent_auth_generations` 支持在 Agent 删除或角色变更时立即吊销该 Agent 名下的全部令牌，同时保留按单个 `sessionId` 撤销的能力。

## Prior art
[prior-art]: #prior-art

**Docker CLI / Daemon 与 Kubernetes `kubectl` / `kube-apiserver`** 采用了相同的双表面划分：CLI 在调用方的本地系统环境中运行并受本地文件权限约束，所有守护进程与集群状态变更通过带认证的 HTTP API 完成；对守护进程 socket 或管理员凭据文件拥有本地读取权限即等价于拥有管理员权限。

**AWS IAM Action IDs** 以 `<service>:<action>` 形式的具名动作标识（而非底层 HTTP URL 路径）作为角色策略的授权单元，本设计的路由 `id` 扮演同样的角色。

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- 插件贡献的 HTTP 路由如何声明自己可被哪些非管理员 Agent 角色访问。
- 角色的 `apiIds` 白名单是否支持按点分前缀通配（例如 `penguin.session.*`）。

## Future possibilities
[future-possibilities]: #future-possibilities

- 在管理界面展示并编辑每个 Agent 角色的路由 `id` 白名单，支持按项目或单个 Agent 覆盖默认授权。
- 为沙盒内的短期子任务签发带过期时间与更窄路由 `id` 子集的临时会话令牌。

---

## Changes

### v1.0.0

- 初始版本（草案，原生于此仓库）。
