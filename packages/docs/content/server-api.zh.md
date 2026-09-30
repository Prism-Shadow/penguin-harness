---
title: Server API
description: PenguinHarness 服务器的 HTTP API 参考：认证、全部路由分组、SSE 流式协议和 DTO 类型导入。
---

PenguinHarness 服务器提供一组同源 HTTP API，内置 Web App 和其他任何 HTTP 客户端用的都是它。本页先讲认证，再按功能分组介绍路由（每组先给路由表，再补充细节），最后讲 SSE 流式协议。启动服务器的方法见[快速开始](/quickstart)。

## 概览

- 技术栈：Hono 和 `@hono/node-server`，要求 Node >= 24。
- 存储：SQLite（内置的 `node:sqlite`，WAL 模式）只保存索引和聚合数据：用户、认证会话、Project 授权、Agent 与 Session 索引、用量、UI 偏好、错误记录和定时任务状态。所有 Agent、Trace 和 Workspace 数据都以文件形式存放在 `~/.penguin/data` 下，与 CLI 和 SDK 共享；参见[配置参考](/configuration)。
- 绑定地址：默认 `127.0.0.1:7364`，可通过 `PORT` / `HOST` 环境变量调整。
- 请求体：写操作只接受 JSON，检查 Content-Type 是防 CSRF 的手段之一。请求体大小上限并非固定值，而是由附件额度推导出来的。附件以 base64 `data:` URL 的形式随请求传输，体积会膨胀 4/3，所以上限按 `base64(attachmentTotalMb)` 计算，再为一张内嵌图片和 JSON 封装留出余量。按默认 120MB 的总量计，约为 190MB；管理员调低总量，上限也会随之下降。服务器边读请求体边统计字节数，因此不声明长度（chunked）的请求同样受此限制。
- 所有错误共用同一种结构：

```text
{ "error": { "code": "<machine-readable code>", "message": "<user-facing text>" } }
```

## 源码结构

```text
packages/server/src
├── index.ts / config.ts / app.ts   # startup entry · env config · the HMR layer's app (network guards, /api/hmr, the platform seam, static hosting; binds no port, testable)
├── api/types.ts                    # the outward DTO contract (type-only import via the "./api" subpath)
├── auth/                           # scrypt passwords, admin seeding, cookie sessions, auth middleware
├── db/                             # node:sqlite connection, schema SQL, one repo per table
├── hmr/                            # hot update: the platform seam and the /api/hmr routes
├── http/                           # the business routes' assembly (app.ts), error bodies, request validation, SSE adapter, routes/
├── machines/                       # remote machines: ssh config, install and connect jobs, the /server/<machineId> proxy
├── organization/                   # company mode's files: chart, tickets, channels, handbook
├── runtime/                        # session-manager (runtime driving) · channel (SSE ring buffer)
│                                   # approvals · usage-recorder · scheduler · title-generator · messaging/ · organization/
├── services/                       # authorization rules, TOML/YAML config IO, Session/Trace/usage/snapshot services
└── terminal/                       # terminals: /api/terminals and the byte-stream WebSocket
```

## 认证

API 接受两种凭证：Cookie 会话和本地 API token。

- Cookie 会话：`penguin_session`（HttpOnly，SameSite=Lax），有效期 30 天，滑动续期。
- 密码以 scrypt 哈希存储。会话是 `auth_sessions` 表中的一行，以随机 Cookie token 的 sha256 为键；原始 token 从不存储。会话重启后依然有效，并在原地续期；登出则删除这一行。
- 不开放注册。启动时，服务器会用一个随机密码初始化内置管理员 `admin`：密码哈希后保存，明文随即丢弃，没有任何人见过它。在设置密码之前，每次启动都会打印一条首次登录链接，用来认领账号。自动化场景可以改用 `PENGUIN_SEED_ADMIN_PASSWORD` 固定一个已知密码。其余所有账号都由管理员创建。
- 仅限同源：未启用任何 CORS 中间件。
- 标为「仅管理员」的路由，对其他用户一律返回 `403` `admin_required`。

```bash
# Use the password you set when claiming the account from the first-login link.
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"<your password>"}' \
  http://localhost:7364/api/auth/login
```

### 本地 API token（Bearer）

所有受保护的路由也接受携带**本地 API token** 的 `Authorization: Bearer <token>`。CLI，以及通过 CLI 驱动 harness 的 Agent，都用这个本机凭证代替登录。

- 服务器每次启动都生成一个新 token，写入 `<root>/api-token`，文件权限仅限所有者（`0600`）。新 token 一经生成，上一次启动的 token 立即失效。
- 有效的 Bearer token 以内置 `admin` 的身份通过认证。这是有意设计的授权模型：在本机文件系统上能访问数据根目录，本身就等于管理员权限，因为能读 `api-token` 的人也能读它旁边的 `web.db`。`penguin server reset-admin-password` 依赖的正是这条规则。
- 服务器驱动的会话会把当前 token 注入每个工具子进程的环境变量 `PENGUIN_API_TOKEN`，同时注入 `PENGUIN_API_URL`、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID` 和 `PENGUIN_SESSION_ID`。Agent 自己的 `penguin` 命令和 API 调用正是靠这些变量获得授权，才能连上运行自己的服务器。
- SSE 端点和其他路由一样接受这个请求头。消费它们要用 `fetch`，不要用 `EventSource`——后者无法发送请求头。
- 写请求只接受 JSON 的 Content-Type 检查，对 Bearer 请求同样生效。

```bash
curl -H "Authorization: Bearer $(cat ~/.penguin/data/api-token)" \
  http://127.0.0.1:7364/api/me
```

## 认证与账号

登录、登出、账号认领，以及当前用户的密码、资料和偏好设置。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录：`{userId, password}` → `{user}` |
| POST | `/api/auth/logout` | 登出，返回 `204` |
| GET | `/api/auth/claim?token=…` | 兑换登录链接：设置 Cookie 并重定向到 `/` |
| GET | `/api/install` | 公开：返回 `{installId}`，即当前数据根目录的 id |
| GET | `/api/me` | 当前用户的信息 |
| PUT | `/api/me/password` | 修改密码：`{oldPassword, newPassword}` |
| PUT | `/api/me/profile` | 设置头像和昵称：`{displayName?, avatar?}` → `{user}` |
| GET | `/api/me/prefs` | 读取 UI 偏好 |
| PUT | `/api/me/prefs` | 写入 UI 偏好（浅合并） |

- `GET /api/auth/claim` 用于兑换首次登录链接或桌面 shell 的一次性 token。链接无效或已被使用时，会改为重定向到 `/login?claimFailed=…`，Web App 会在那里说明如何获取一条有效链接。
- `GET /api/install` 无需身份验证。`installId` 是一个不透明的 id，存储在 `<root>/install-id`，在数据根目录首次使用时生成。Web App 将它与本地保存的 id 比对，不一致时清空浏览器端引用服务器实体的 UI 状态，这样替换数据根目录后就不会残留旧的 Workspace、草稿和置顶项。返回 `null` 表示服务器无法确立 id，此时客户端不得改动任何状态。
- `PUT /api/me/password`：桌面会话和首次登录会话可以省略 `oldPassword`，因为这类会话的当前密码是随机生成的，从未展示过。
- `PUT /api/me/profile` 是补丁式更新：省略的字段保留原值，`null` 表示清除这个字段，请求体若两个字段都不含则返回 `400`。
  - `displayName` 去除首尾空白后必须在 1–32 个字符之间，按字符计数（因此中文名可以满 32 个），且不能包含控制字符。
  - `avatar` 必须是 `data:image/(png|jpeg|webp);base64,…` 形式的 URL，最长 131072 个字符，且其中的数据能够正常解码。
  - 任何已认证的会话都可以调用，包括桌面 shell 的 token 会话。与修改密码的接口不同，修改资料没有旧凭证需要校验。

## 用户管理（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/users` | 列出用户 |
| POST | `/api/admin/users` | 创建用户：`{userId, password}` |
| POST | `/api/admin/users/:userId/password` | 重置密码，并使这个用户的所有登录会话失效 |
| DELETE | `/api/admin/users/:userId` | 删除用户 |

用户列表的每一行都会带上账号昵称（如果设置过）。列表中刻意不放头像：列表不分页，每个账号再附一个 data URL 会让响应体膨胀到淹没其他内容。

桌面模式（由桌面应用拉起的服务器）下，这组路由一律返回 `403`，错误码为 `desktop_single_user`。桌面应用面向单用户，不提供用户管理；数据根目录中已有的用户不受影响。

## 服务器设置（仅管理员）

服务器全局的代理、附件和公司模式设置，以及插件声明的设置分组。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/settings` | 服务器全局设置：`{settings: {proxyForApp, proxyForAgent, proxyUrl, attachmentMaxMb, attachmentTotalMb, companyMode}}` |
| PUT | `/api/admin/settings` | 更新设置；省略的字段保持当前值，任何字段非法都会拒绝整个 PUT。返回更新后的完整设置 |
| GET | `/api/admin/settings/proxy-probe` | 可达性探测的目标：`{targets: [{provider, url}]}`。不发起任何请求 |
| POST | `/api/admin/settings/proxy-probe/:provider` | 经服务器的出站链路探测其中一个目标，不发送任何凭证：`{probe: {provider, url, outcome, ms, status?}}` |
| GET | `/api/admin/plugin-config` | 模块声明的每个设置分组，沙盒的排在最前：`{plugins: [{name, configuration, values, parent?, notices?}]}`。见[插件设置](#插件设置) |
| PUT | `/api/admin/plugin-config` | 保存一个分组的值：`{name, values}`。返回全部分组，与 GET 相同 |
| POST | `/api/admin/plugin-config/action` | 执行某个分组的一个动作：`{name, action}`。返回执行结果，以及执行后的全部分组 |

只要有 HTTP 响应返回，探测的 `outcome` 就是 `reachable`，否则为 `timeout`、`dns`、`refused`、`tls` 或 `network`。`:provider` 不在目标列表里时返回 `404` `probe_target_not_found`。

### 代理设置

代理设置是两个相互独立的开关，共用一个可选的显式地址。改动立即作用于新建连接和新启动的进程，无需重启。

`proxyForApp`（即**应用程序使用代理**开关，默认开启）管理服务器自身的出站流量：LLM 请求、更新检查和图片拉取。

- 开启且设置了 `proxyUrl`：http 和 https 都走这个地址，优先于代理环境变量，无需配置任何环境变量。
- 开启但未设置地址：服务器遵循 `HTTP_PROXY`、`HTTPS_PROXY` 和 `NO_PROXY` 环境变量，大小写两种拼写都认。
- 关闭：始终直连。

`proxyForAgent`（即 **Agent 环境使用代理**开关，默认开启）管理 Agent 命令子进程的环境。

- 开启且设置了 `proxyUrl`：注入 `HTTP_PROXY` 和 `HTTPS_PROXY`（含对应的小写变量），值为这个地址，同时注入合并后的 `NO_PROXY`，覆盖继承来的值。`socks5://` 地址原样注入；各工具能否在这些变量中接受 SOCKS URL 并不一致。
- 开启但未设置地址：宿主环境原样透传。
- 关闭：移除代理变量，保留 `NO_PROXY`。

`proxyUrl` 是共用的显式地址，默认为 `null`，即跟随环境变量。PUT 按如下规则校验：

- 先去除首尾空白，空值或 `null` 表示清除这个地址。
- 可接受的值是 undici dispatcher 支持的代理 URL（`http://`、`https://`，以及实验性的 `socks5://` / `socks://`，允许带凭证），另外也接受裸的 `host[:port]`，并归一化为 `http://host[:port]`。只存储归一化后的值，响应返回的也是这个值。
- 其他任何值——无论是无法解析，还是 undici 不接受的协议（如 `socks4://`）——都返回 `400`，错误码为 `invalid_proxy_url`，且这次 PUT 不会写入任何内容。

无论哪种开启状态，最终生效的 `NO_PROXY` 都包含 `localhost,127.0.0.1,::1`，所以回环流量永远不会走代理。

### 附件上限

输入框中的文件附件由两个以整数 MB 为单位的值控制。两者都从下一个请求起生效，无需重启，因为校验逻辑和请求体上限在每次请求时都会读取它们。

- `attachmentMaxMb`（默认 100）是单个文件的大小上限，超过则返回 `413` `file_too_large`。
- `attachmentTotalMb`（默认 120）是单条消息解码后字节总数的上限，超过则返回 `413` `payload_too_large`。

PUT 按如下规则校验：

- 两者都必须是 1–200 之间的整数。
- 生效的总量（本次 PUT 传入的值；若本次未修改，则为已存储的值）不得低于生效的单文件上限。
- 其余情况返回 `400`，错误码为 `invalid_attachment_limit`，且这次 PUT 不会写入任何内容。

有两项限制不可更改：每条消息的文件数量上限（20）和内嵌图片上限（20MB，超限返回 `413` `image_too_large`）。内嵌图片会写入 Trace，之后每次分页加载历史、每次恢复会话都要重新读取，因此刻意不随附件上限一同调大。`GET /api/me` 会在 `uploadLimits` 中返回上述全部限制，客户端发送文件前可以先对照实际生效的限制检查文件。

### 公司模式开关

`companyMode` 是服务器的**启用公司模式**开关，默认关闭。修改无需重启即生效：开关关闭期间，所有组织路由都返回 `404` `company_mode_off`，组织的调度器也不会触发任何事件。

### 插件设置

设置分组是投给 `PluginConfigProvider.groups` 的 contribution，沙盒的排在最前。列表中的每个分组带有它的 schema（`configuration`）、合并到缺省值上的存储值（密钥掩码）、它被画在哪个分组的卡片里（`parent`），以及实时状态行（`notices`）。

字段类型有 `string`、`secret`、`boolean`、`number`、`enum`（带 `options`）和 `list`（每行一个值，可选 `maxItems`）。`number` 可声明 `minimum` 与 `maximum`；`string` 与 `list` 可声明每个值或每一行都须匹配的 `pattern`（配 `patternErrorMessage`）。

PUT 时，请求省略的字段保持原值，`null` 或 `""` 清除该字段，密钥按掩码原样送回即保持存储值。被拒的字段返回 `400` `plugin_config_invalid` 并点名该字段；没有分组叫这个名字时返回 `404` `plugin_config_unknown`。声明它的模块自己经 watch 或下次读取拿到改动，无需重启。

## 机器（仅管理员）

通过 ssh 在其他主机上安装本服务器的构建，并管理与这些主机的连接。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects/:projectId/machines` | 本机以及服务器自身 `~/.ssh/config` 中的主机别名，连同本 Project 的安装记录、最近状态和当前任务：`{machines: [{id, alias, machineId, installed, elsewhere?, local, connection, api, status}], imageVersion, job}` |
| POST | `/api/projects/:projectId/machines/probe` | 逐台询问本 Project 已安装机器正在做什么（每台一次 ssh 往返，最多 5 台并发），返回携带最新状态的列表 |
| POST | `/api/projects/:projectId/machines/:machineId/install` | 开始在这台主机上安装当前构建，并将这台主机分配给本 Project；任务运行期间返回 `202`，响应体相同 |
| POST | `/api/projects/:projectId/machines/:machineId/connect` | 启动那台机器的服务器，并维持那条唯一的连接；connect 任务运行期间返回 `202`，响应体相同 |
| POST | `/api/projects/:projectId/machines/:machineId/disconnect` | 断开连接，远端服务器继续运行 |
| POST | `/api/projects/:projectId/machines/:machineId/restart` | 停止那台机器的服务器，并在同一端口重新启动；返回 `202`，任务运行期间返回 `409` |
| GET | `/api/projects/:projectId/machines/:machineId/dirs?path=` | 那台机器上 `path` 的子目录，经由保持中的连接读取；Workspace 选择器浏览的就是这些目录 |
| POST | `/api/projects/:projectId/machines/:machineId/release` | 将那台机器移出本 Project；机器上的安装保持不变 |

无论个人服务器还是多用户服务器，这组路由都仅限管理员：安装会以服务器账号的密钥运行 ssh，并在另一台机器上写入程序目录——这是所有者才有的能力，不是访客该有的。服务器从不写入自己的 ssh 配置，也从不解析它。机器列表就是配置文件的原文，不管声明了多少台主机都只读取一次；每个别名都按原样传给 ssh，因此每次都由 ssh 套用自己的配置。

- `POST …/install` 可以携带请求体 `{replaceProgram: true}`，用来回应任务过程中提出的这个要求：即使版本已经一致，服务器也会重新安装程序并重启它。
- `POST …/connect` 维持一条 `ssh -T -D` 会话：空闲时永不超时，断开后自动重连，服务器重启或热推送后也会自动恢复。Windows 机器返回 `409` `connect_unsupported`，因为没有 shell 可以维持会话。
- `POST …/disconnect` 断开后远端服务器继续运行：它属于那台机器，其他人可能还在使用。
- `POST …/restart` 之所以是独立操作，是因为机器上的文件可以在运行期间更新，只有重启才能让进程与文件保持一致。
- `GET …/dirs` 与下文的 API 代理一样，用机器自身的 id 寻址。机器未连接时返回 `404`，因为读取操作绝不会自行建立 ssh 连接。

### 机器字段

- `elsewhere`：这台主机已由其他 Project 安装，可以直接接管，而不必重新安装。
- `imageVersion`：将要推送的版本；本服务器完全没有安装镜像时为 `null`。只有从未接收过热推送的开发检出属于这种情况，此时每次安装都会失败，返回 `409` `no_install_image`。这个版本就是当前运行安装自身的版本：热推送的服务器发送它正在运行的 bundle（`0.0.0-hmr.<cli>.<web>`），tarball 或打包安装则发送自己的目录树，所以两端天然一致。
- `installed`：本服务器最近一次在那台机器上执行的安装，格式为 `{version, at}`；从未安装过则为 `null`。它保存在数据根目录下，因此重启、热推送和其他机器上的安装都不会使它丢失。它记录的是实际执行过的操作，并不核对远端状态，所以手动清空过的机器仍会显示为已安装，直到下一次安装把它纠正过来。安装失败不会留下任何记录。
- `machineId`：机器自身的 id，由运行在那台机器上的服务器生成（记录在它的 `machine` 表中），共 16 个 base64url 字符。重命名、修改别名和重新安装都不会改变它，持久化引用应指向它。在那台机器上启动过服务器之前，它为 `null`，因为还没有任何东西生成过它。本服务器在与 `status` 同一次往返中获知它，并把它与安装记录存放在一起。同一主机的两个别名报告相同的 `machineId`。
- `local`：标记本服务器所在的机器。由于应答请求的正是它，这条记录始终在列表中，始终显示为已安装且正在运行；它也永远不会成为安装目标：对它调用 `POST …/install` 返回 `409` `self_install`。
- `status`：`{state, checkedAt, port?, detail?}`，其中 `state` 为 `running`、`stopped` 或 `unreachable`；从未探测过的机器为 `null`。没有单独的 ssh 状态。ssh 就是传输通道，连不上的机器即为 `unreachable`，`detail` 携带 OpenSSH 自己的报错信息。`GET` 从不主动探测，只报告最近一次的结果，因为每探测一台机器都要花费一次 ssh 往返，而列表本身只是配置文本。只有 `POST …/machines/probe` 会付出这些往返开销，而且只针对已安装的机器。

### 已连接机器的 API

已连接机器的 API 可以通过本服务器 origin 上的 `/server/<machineId>/api/…` 访问。请求经由本服务器与那台机器之间唯一的那条 ssh 会话传输，走的是会话内部经由它的 SOCKS 端口的一条通道，绝不另开第二条连接。

URL 使用机器自身的 id，而不是连接所用的 ssh 别名。别名只存在于某个配置文件里，若以别名为准，主机一改名，机器的 URL 就会跟着变。id 采用 base64url 编码，放进路径无需百分号转义。

该代理仅限管理员，且只使用单一身份：请求在对端以那台机器的管理员身份执行，所用会话由本服务器凭借自身的 ssh 访问能力签发（在那台机器上执行 `penguin auth token`）。浏览器的 Cookie 不会传到对端，机器上的 Cookie 也不会带回本地。只有 `/api` 会转发，前端仍在本地运行。

### 任务

安装是一个任务，而不是单次请求。它要探测对端，可能还要下载并校验 Node 运行时，再通过 scp 复制镜像，整个过程可能耗时数分钟。`POST` 启动任务后立即返回。客户端轮询 `GET` 获取 `job.log`，其中是对端自己的输出（ssh 的诊断信息和远端安装器的输出）。

连接（`POST …/connect`）和重启（`POST …/restart`）也是同样形式的任务，通过 `job.kind`（`install`、`connect` 或 `restart`）区分。任务运行期间 `job.result` 为 `null`，结束后为以下之一：

- 安装：`{ok: true, installed: "installed" | "already-installed", version}`
- 连接或重启：`{ok: true, connected: true}`
- 失败：`{ok: false, step, message, canReplaceProgram?}`

`canReplaceProgram` 表示这次失败的后续步骤可以是强行安装程序：调用 `POST …/install` 并附带 `{replaceProgram: true}`。服务器只提供这一步而不擅自执行，因为它会重启一台可能还有其他人在使用的服务器。

同一时刻只运行一个任务。任务只存于内存，热推送或重启后就会丢失。要恢复就重新执行一遍：每一步都是幂等的。

### 拒绝情形

这些拒绝在运行任何 ssh 命令之前就已判定，每个都有专属错误码：

- `409` `install_running`
- `404` `unknown_machine`
- `409` `no_install_image`
- `409` `self_install`：本服务器不会把自己的构建推送覆盖到自身正在运行的程序目录上。除了 `local` 这一行，指回本主机的别名（例如 `Host localhost` 或本主机的另一个名字）同样会拒绝，前提是某次探测已从它那里读到本服务器自己的 id。

## 版本与自更新

查看当前运行的构建，检查 GitHub 上是否有更新的 release，并执行自更新。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/version` | 当前构建的标识，以及这个数据根目录收到的 harness 推送 |
| GET | `/api/version/update-check` | 将 GitHub 上的最新 release 与当前运行版本对比 |
| GET | `/api/version/update` | 仅管理员。自更新任务的状态 |
| POST | `/api/version/update` | 仅管理员。启动自更新任务 |
| POST | `/api/version/restart` | 仅管理员。通过托管进程重启该进程 |

### GET /api/version

返回当前构建的标识以及这个数据根目录收到的 harness 推送：`{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}`。与 `penguin version --json` 打印的记录完全一致。

- `describe` 是一行式的版本标识：release 构建形如 `v0.2.3`，源码检出的构建形如 `v0.2.3-14-g9e8f7d6-dirty`。
- `channel` 为 `release` 或 `source`。
- `buildDate`（UTC yyyy-mm-dd）和 `commit` 在构建时写入，读取时无需联网。源码构建，以及早于这一写入机制的 release，这两项为 null。
- `branch` 和 `dirty` 记录源码构建的 git 位置，release 中为 null。
- `harness` 以 `{source, pushedAt, bundles}` 描述数据根目录的 HMR 存储，其中 `source` 是执行推送的检出的 `{repo, revision}`。这个数据根目录从未接收过推送时为 null。

### GET /api/version/update-check

将 GitHub 上的最新 release 与当前运行版本对比：`{currentVersion, latestVersion, updateAvailable, releaseUrl, publishedAt, checkedAt, disabled?, error?}`。手动**检查更新**发送的 `?force=1` 可绕过 TTL 缓存，结果仍按常规缓存。

这次查询失败时平稳降级：

- 查询失败仍返回 200，只是 `error` 会带值（`network`、`rate_limited` 或 `bad_response`），且 `latestVersion` 为 null。
- 结果缓存在内存中：成功后缓存 1 小时，失败后缓存 10 分钟。
- `PENGUIN_UPDATE_CHECK=off` 可彻底关闭查询：响应带 `disabled: true`，且不发起任何网络请求。

这个开关只关掉这一项检查。无论它取什么值，模型请求、已启用的远程控制连接、由所有者发起的供应商 Key 授权和代理测试都照常出站。

### GET /api/version/update

仅管理员。返回自更新任务的状态：`{state: idle | running | done, targetVersion, phase?, percent?, output, result?, startedAt?, finishedAt?}`。更新运行期间，更新对话框会轮询这个接口。

- 任务运行期间，`phase` 为 `resolving`、`downloading` 或 `installing`，`percent` 取自安装器的进度条。
- 任务完成后，`result` 为 `{status, reason?, output, needsRestart}`。

`result` 中的 `status` 为以下之一：

- `updated`：重启服务即可运行新版本。
- `failed`。
- `unsupported`：要么服务器不是通过 `penguin server` 或 `penguin web` 启动的（`reason: "not_launched_via_cli"`），要么 CLI 拒绝更新（源码检出、无法识别的安装布局，或 Windows）。

`output` 保存 CLI 自身输出的最后一段。

### POST /api/version/update

仅管理员。启动自更新任务，任务会在服务器主机后台运行 `penguin update --yes`。如果已有任务在运行，这个请求会并入其中。响应即任务状态，与 `GET /api/version/update` 的返回完全一致。已完成的任务可以重新启动，作为重试。

### POST /api/version/restart

仅管理员。让进程在优雅关闭后以托管进程的重启码退出，`penguin server` 或 `penguin web` 随即会在已安装的 release 上重新拉起它。返回 `{restarting: true}`；如果没有托管进程在管理这个进程，则返回 `{restarting: false, reason: "no_supervisor"}`。

## Project 与成员

Project、Project 成员，以及保存在 `.project_config.toml` 中的 Project 级设置。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects` | 当前用户可见的 Project |
| POST | `/api/projects` | 创建 Project：`{projectId, name?}` → 201 `{project}` |
| PATCH | `/api/projects/:projectId` | 重命名 Project：`{name}` → `{project}` |
| DELETE | `/api/projects/:projectId` | 删除 Project |
| GET | `/api/projects/:projectId/members` | 列出成员 |
| POST | `/api/projects/:projectId/members` | 添加成员：`{userId}` |
| DELETE | `/api/projects/:projectId/members/:userId` | 移除成员 |
| GET / PUT | `/api/projects/:projectId/chat-defaults` | 读取 / 替换新建对话的默认值 |
| GET / PUT | `/api/projects/:projectId/command-policy` | 读取 / 替换沙箱命令策略 |
| POST | `/api/projects/:projectId/suggest-id` | 为正在创建的对象的显示名提议一个语义化 id |

- `PATCH /api/projects/:projectId` 仅限所有者，且只能修改显示名称（1–100 个字符）。Project id 就是它的目录名，永不改变。
- `DELETE /api/projects/:projectId` 仅限所有者。`default_project` 与 CLI 共享，无法删除：返回 `409` `cannot_delete_default_project`。
- 成员的写操作仅限所有者。桌面模式下，成员相关路由同样返回 `403 desktop_single_user`；参见[用户管理（仅管理员）](#用户管理仅管理员)。
- `chat-defaults` 对应 `[default_chat]` 配置块：`{agentId?, workspace?, approvalMode?, thinkingLevel?}`。任何成员都可以读取，只有所有者可以替换。PUT 会替换整个块：省略的键清除对应默认值，空请求体则移除整个块。`agentId` 必须指向 Project 中已存在的 Agent（否则返回 `400` `unknown_agent`）。`workspace` 只是预填值，创建 Session 时才会校验；留空表示临时 Workspace。`thinkingLevel` 用作未在自身配置里设置思考等级的 Agent 的兜底值，不接受 `none`。默认模型不属于这个块，由模型相关路由管理。
- `command-policy` 对应 `[command_policy]` 配置块：`{enabled?, rules: [{name, pattern, description?, enabled?}]}`。任何成员都可以读取，只有所有者可以替换。PUT 必须携带完整的规则列表（空数组表示没有任何规则），规则最多 64 条。每条规则需要名称（最多 64 个字符）和 pattern（最多 512 个字符，且必须能编译为正则表达式），description 最多 300 个字符。pattern 编译失败返回 `400` `invalid_rule_pattern`，其他格式错误的规则返回 `400` `invalid_rules`，`enabled` 不是布尔值返回 `400` `invalid_enabled`。参见[命令策略](/configuration#命令策略)。

### 语义化 id 提议

`POST /api/projects/:projectId/suggest-id` 接收 `{name, kind, taken?}`，返回 `{id, source, reason?}`。`kind` 取 `project`、`agent`、`benchmark`、`org` 或 `channel`，`taken` 是提议必须避开的一批 id。id 输入框旁边的**用 AI 生成**按钮，背后都是这一条路由。

- 路径里这个 Project 的默认模型把名称翻译成一个符合该 kind 拼写风格的英文 id（`source: model`）；**新建 Project** 对话框借用的是打开它时所在的那个 Project。回答没有得出 id 时，会带着明确的格式要求再问模型一次。
- 没有配置模型，或两次回答都不可用时，改用名称生成的 ASCII slug（`source: fallback`）。
- 两条路径都生成不出 id 时，给出一个带日期的占位 id（`source: placeholder`），`reason` 为 `no_default_model`、`model_failed`、`unusable_answer` 或 `no_ascii`：`project_<yyyymmdd>`、`agent_<yyyymmdd>`、`benchmark-<yyyymmdd>`、`co_org_<yyyymmdd>` 或 `ch_channel_<yyyymmdd>`；非管理员的 Project id 前面还带用户名。
- 各个 kind 的差别只有三处：id 的形状、服务端自己要避开的 id，以及谁可以请求。`project` 对管理员是 snake_case，对其他人是 `<username>-<后缀>`，要避开服务器上的每一个 Project id；`agent` 是 snake_case，要避开这个 Project 的 Agent；`benchmark` 是 kebab-case，要避开这个 Project 的 Benchmark，且仅限所有者；`org` 和 `channel` 带 `co_`、`ch_` 前缀，回答里已有前缀时不会重复添加，公司模式关闭时返回 `404` `company_mode_off`。其余情况下调用者必须是这个 Project 的成员。
- 服务端自己要避开的，是该 kind 的创建路由会以「已占用」拒绝的那些名称，包括任何列表都不显示的残留目录。它们不会进入提示词；发生冲突时只会加上 `_2` / `-2` 后缀。核心词因为以数字开头或只有一个字符而被该 kind 的规则拒绝时，会放到这个 kind 的名词后面再试一次（`3D Viewer` → `agent_3d_viewer`）。
- 名称翻译不出来时路由也不会失败，因此请求 id 的对话框总能拿到结果。模型侧的每一次失败都会记录为 `id_suggest_failed` 错误，`org` 和 `channel` 记在 `organization` 来源下，其余记在 `id_suggest` 下。这次补全关闭思考运行，使用共享的元请求预算，不属于任何 Session，也不计量。

## 模型

管理 Project 的模型表，并探测模型端点。模型表对所有成员开放读取；本节其余路由仅限所有者。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects/:projectId/models` | 列出模型（`api_key` 做掩码处理）；正在促销的条目会带上促销折扣 `discount` |
| PUT | `/api/projects/:projectId/models` | 整表替换，以 `(provider, modelId)` 为键；条目的 `discount` 用来保存或清除它的促销 |
| PUT | `/api/projects/:projectId/models/default` | 设置默认模型：`{provider, modelId}` → `{defaultModel}` |
| POST | `/api/projects/:projectId/models/test` | 测试连通性：`{provider, modelId, …}` → `{ok, latencyMs?, message?}` |
| POST | `/api/projects/:projectId/models/detect` | 检测自定义 base URL 使用的协议 |
| POST | `/api/projects/:projectId/models/list` | 列出端点提供的模型 id，供添加分组时导入 |
| POST | `/api/projects/:projectId/models/detect-vision` | 探测模型是否接受图片 |

凡是指定模型的路由都要求完整的 `(provider, modelId)` 组合，不做任何推断：只带一半的请求一律返回 400，绝不会退化为一次查找。在模型引用本身可选的场景（创建 Session、定时任务）里，两个都不填则使用 Project 的默认模型。

条目的 `pricing` 记的始终是牌价。促销是一个大于 0、小于 1 的折扣率，从牌价中扣除，但从不写进 `.project_config.toml`：服务端按条目把它保存在 `web.db` 里，计算用量成本时再扣除。`PUT /models` 里，条目带的 `discount` 说了算——数字表示保存这个促销，`null` 表示清除，其他取值会在写入任何内容之前返回 `400`。条目不带 `discount` 时保留已存的促销，除非它改名（`renamedFrom` 指向另一对引用）或 `pricing` 与已存的不同，这两种情况下促销会被清除。新表里没有的条目，其促销随之删除。

- `PUT /models` 还会使 Project 缓存的 Session 运行时失效，生效值的语义与 vault 更新相同。已经开始的运行不会切换，但 Project 内任何 Session 的下一个 Task 都会重新加载运行时，读取新的 `api_key` / `base_url`。这条路由还会向 Project 已打开的 Session 通道发布 `credentials_updated` 事件（参见[流式传输（SSE）](#流式传输sse)）。模型响应带有 `updatedAt`，即配置文件的修改时间；Web App 拿它和最近一次认证失败的时间对比，决定那次失败导致禁用的输入框是否继续保持禁用。
- `PUT /models/default` 只修改默认模型，无需重发模型表或凭证。这对组合必须指向一条已配置的条目，否则返回 400。已有的 Session 沿用创建时的模型，因此这条路由既不会使运行时失效，也不会发布 `credentials_updated`。
- `POST /models/detect` 依次探测 `openai-responses`、`ant-messages`、`openai-chat`。先按输入原样尝试 URL（做归一化，去掉粘贴进来的端点路径），再尝试为同一 URL 加上或去掉 `/v1`，并报告第一个命中的协议及提供这个协议的 base URL：`{baseUrl, apiKey?, …}` → `{detected?, baseUrl?, probes}`。
- `POST /models/list` 返回端点在检测到的协议下提供的模型 id：`{baseUrl, clientType, apiKey?}` → `{ok, models?, unsupported?, message?}`。
- `POST /models/detect-vision` 用这个模型的凭证发送一张 1x1 图片，这是一次真实计费的补全请求：`{provider, modelId, apiKey?, baseUrl?, clientType?}` → `{outcome: supported|unsupported|failed, message?}`。

### 签发供应商 API key

内置模型目录中发布了授权流程的供应商分组，可以在浏览器里直接为用户签发新的 API key，用户不必再去控制台复制。这些路由仅限所有者使用，唯一的例外是重定向接收端 `GET /callback`：它无需会话即可响应，且只能把跳转带来的授权码交给对应流程（见下文）。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/projects/:projectId/model-oauth/start` | 发起流程：`{provider, mode?: callback\|manual}` → `{flowId, authorizeUrl}` |
| GET | `/api/projects/:projectId/model-oauth/callback` | 供应商跳转回来的地址（`?flow=&code=`）：把授权码存到流程上，并返回一个 HTML 页面。`HEAD` 返回 405 |
| GET | `/api/projects/:projectId/model-oauth/:flowId` | 轮询流程，兑换已存下的授权码并写入 key：`{status: pending\|done\|error, provider, error?}` |
| POST | `/api/projects/:projectId/model-oauth/:flowId/code` | 兑换用户粘贴的授权码：`{code}` → `{ok, applied?, error?}` |

PKCE verifier 由服务器生成，只在内存中保存 10 分钟，从不发送给客户端。签发出的 key 直接写入这个供应商分组的模型配置，从不返回、从不记录日志，也从不放进 URL。一个流程只属于一个 Project 中的一个用户，且只能使用一次：不接受第二次兑换，除这个用户外，任何人都无法调用 `/start`、`/:flowId` 和 `/:flowId/code`。

`GET /callback` 必须是例外。回环地址上的 OAuth 跳转，由供应商跳转到的那个浏览器接收，而它未必是发起流程的浏览器。比如桌面 shell 会在*系统*浏览器中打开授权页，而系统浏览器没有这个应用的源的 Cookie。因此只有这一条路径挂在会话校验之外，改用 flow id 鉴权：32 个随机字节，10 分钟内有效，且只允许存入一次。授权码只能存入发起这个流程的 Project，而且只有要求过回调的流程才接受：`manual` 流程一律拒绝，因为它从未拿到过回调 URL。

回调能做的事还有第二重限制：它只把授权码存到流程上，此外什么都不做。与供应商的兑换、写入 Project 模型，都发生在 `GET /:flowId`，也就是所有者自己的轮询里，仍在会话校验之后。除非所有者主动查询流程状态，否则任何 key 都进不了 Project；兑换失败也在那里以 `{status: error, error}` 报告，而不是显示在跳转页面上。回调周边的一切同样不在豁免之列：更长的路径、其他任何请求方法（这一路径本身的 `HEAD` 返回 405），以及另外三条同组路由，都仍然需要会话。

`mode: manual` 不发送回调 URL，授权页会显示一个一次性授权码，由用户手动粘贴回来，适用于跳转回不来的部署。无论由哪条路由兑换授权码，流程完成后都会使缓存的运行时失效并发布 `credentials_updated`，与 `PUT /models` 完全一致。

### Penguin Go Key 授权

Penguin Go 的 key 通过服务端轮询的设备授权交付，而不是浏览器跳转，因此它有自己的一组路由。这些路由都仅限所有者。浏览器只拿到本地的 flow id 和授权 URL，拿不到设备密钥、交付的 key，也拿不到平台返回的其他内容。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/projects/:projectId/platform-auth/start` | 开启一次性授权流程，平台给出的截止时间在本地最多按十分钟计：→ 201 `{flowId, authorizeUrl, expiresAt}` |
| POST | `/api/projects/:projectId/platform-auth/sync` | 用已存的 key 拉取平台模型目录，补齐 Project 缺少的模型并刷新平台维护的字段：→ 模型表，外加 `added` 与 `updated` 计数 |
| GET | `/api/projects/:projectId/platform-auth/:flowId/status` | 由服务端向 Penguin Go 轮询，随后把交付的 key 写入整个分组并补齐平台的模型：`{status: pending\|applying\|completed\|cancelled\|apply_failed\|error, error?, applied?}` |
| POST | `/api/projects/:projectId/platform-auth/:flowId/retry` | 本地写入失败后重试写入；不会再次索取这次一次性交付，流程处于其他状态时返回 `409 platform_auth_not_retryable` |
| POST | `/api/projects/:projectId/platform-auth/:flowId/cancel` | 取消本地流程；平台侧的待处理记录按自己的 TTL 过期 |

服务端先校验交付的 key、端点和模型目录，然后才写入任何内容。校验通过后，它把 key 写入 `penguin-go` 分组下已有的每个条目，创建平台提供而 Project 没有的模型，刷新已有模型的牌价与客户端协议，并用平台的促销替换这个分组已存的促销。端点和其他由 Project 自己维护的字段保持不变，任何模型都不会被删除；目录非空时，分组不存在也会被建出来。写入完成后会使缓存的运行时失效并发布 `credentials_updated`，与 `PUT /models` 完全一致。

flow id 指向的流程不存在时返回 `404 platform_auth_flow_not_found`。`sync` 在没有已存 key 或平台拒绝这把 key 时返回 `409 platform_reauthorization_required`，平台拒绝提供目录或返回的目录无法解析时返回 `502 platform_sync_failed`，平台不可达则是 `502 platform_unreachable`。交付的 key 未能写入本地时，流程停在 `apply_failed`，重试路由正是为此准备的。

## Agent

下面的路径省略了 `/api/projects/:projectId` 前缀，只有两个全局的 `/api/plugins` 路由是例外。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/agents` | 列出 Agent / 创建 Agent |
| DELETE | `/agents/:agentId` | 删除一个 Agent（仅所有者） |
| GET / PUT | `/agents/:agentId/config` | 读取 / 写入配置（`AGENTS.md` 和 `system_config.yaml`；PUT 保留 YAML 注释） |
| POST | `/agents/:agentId/config/mcp-test` | 测试一条 MCP 服务器配置：`{name, config}` → `{ok, tools?, error?, latencyMs?}` |
| POST | `/agents/:agentId/config/kernel-update` | 将配置合并升级到当前默认值：→ `{advanced, kept, kernelVersion}` |
| POST | `/agents/:agentId/config/reset` | 用当前默认值覆盖 `system_config.yaml`，并返回新生成的配置 |
| GET / PUT | `/agents/:agentId/vault` | Vault 环境变量（值做掩码处理；PUT 替换全部值，仅限所有者） |
| POST | `/agents/:agentId/vault/template-placeholder` | 在 Prompt 模板中插入 `{{VAULT}}` 占位符（仅所有者） |
| GET | `/agents/:agentId/memory` | 记忆概览 |
| POST | `/agents/:agentId/memory/template-placeholder` | 在 Prompt 模板中插入 `{{MEMORY}}` 占位符 |
| GET | `/agents/:agentId/memory/scopes/:key/files` | 列出一个作用域的主题文件 |
| GET / DELETE | `/agents/:agentId/memory/scopes/:key/files/:name` | 读取 / 删除一个主题文件 |
| GET | `/agents/:agentId/memory/scopes/:key/export` | 将一个作用域导出为单个 JSON 文档 |
| POST | `/agents/:agentId/memory/scopes/:key/import` | 将导出的作用域写回（仅所有者） |
| GET | `/agents/:agentId/export` | 导出 Agent State 快照（tar.gz 下载） |
| POST | `/agents/:agentId/import` | 导入快照：`{dataBase64, confirm?}`；不带 `confirm` 且版本冲突时返回 409 |
| GET | `/agents/:agentId/skills` | 已安装的 Skill（从插件库安装需通过 `/plugins`） |
| POST | `/agents/:agentId/skills/template-placeholder` | 在 Prompt 模板中插入 `{{SKILLS}}` 占位符 |
| POST | `/agents/:agentId/skills/archive` | 从 zip 安装 Skill：`{dataBase64, overwrite?}` → 返回 201 和 Skill 列表 |
| GET | `/agents/:agentId/skills/:name/archive` | 将已安装的 Skill 导出为 zip |
| DELETE | `/agents/:agentId/skills/:name` | 卸载一个 Skill |
| POST | `/agents/:agentId/plugins` | 按名称从插件库安装插件：`{names}` → 201 `{skills, hooks}` |
| GET | `/agents/:agentId/hooks` | 已安装的钩子包 |
| POST | `/agents/:agentId/hooks/archive` | 从 zip 安装钩子包：`{dataBase64, overwrite?}` |
| GET | `/agents/:agentId/hooks/:name/archive` | 将已安装的钩子包导出为 zip |
| DELETE | `/agents/:agentId/hooks/:name` | 卸载一个钩子包 |
| GET | `/api/plugins`（全局） | 按分类返回插件库（任何已登录用户） |
| GET | `/api/plugins/:plugin/files`（全局） | 单个插件库插件自带的所有文件，以路径为键返回文本（任何已登录用户） |

### Agent 路由

- `POST /agents` 接受 `{agentId, name?, description?, plugins?, skillsDirectory?, directorySkills?, dataBase64?}`，返回 201 和 `{agent}`。`plugins` 指定要预装的插件库插件；遇到未知名称会拒绝请求，且不会创建 Agent 目录。`skillsDirectory` 和 `directorySkills` 从用户选择的目录导入 Skill（参见 [Session 创建与目录浏览](#session-创建与目录浏览)中的 `GET /dir-skills`），两者必须一起发送。`dataBase64` 让 Agent 从导出的快照启动，而不是使用默认模板。
- `POST …/config/mcp-test` 从本机连接一条 MCP 服务器配置，列出它的工具后断开，不写入任何 Agent State。配置条目格式有误时返回 400。服务器连不上不算 HTTP 错误，照常返回 `{ok: false, error}`。
- `POST …/config/kernel-update` 是 `reset` 的无损版本。它把缺失或仍保持旧默认值的设置标签页升级到当前默认值（记入 `advanced`），完整保留已自定义的标签页（记入 `kept`），并写入新的默认值版本（`kernelVersion`）。
- `template-placeholder` 路由都是幂等的。Vault 和 Skills 两个路由会在 Prompt 模板中插入 `{{VAULT}}` 或 `{{SKILLS}}`；如果模板里是旧版硬编码的 `# Vault` 或 `# Skills` 小节，则替换成对应的占位符。记忆路由插入 `{{MEMORY}}`，在记忆功能推出之前创建的 Agent 就是通过它接入记忆的。
- `POST …/skills/archive` 接受最大 14MB 的 zip。不带 `overwrite` 时，同名 Skill 已安装会返回 409 `skill_exists`。`GET …/skills/:name/archive` 导出的文件名为 `<name>.zip`；如果 Skill 的 `SKILL.md` 声明了版本，则为 `<name>-v<version>.zip`。Skill 未安装时，导出和卸载路由都返回 404 `not_found`。

### 记忆

- `GET …/memory` 返回记忆开关、Prompt 模板是否带有 `{{MEMORY}}`，以及每个作用域的条目：用户作用域（`user`，`kind: "user"`）排在最前，随后是各个 Workspace。
- 在这些作用域路由中，`:key` 是某个 Workspace 的 key 或 `user`。
- `GET …/scopes/:key/files` 列出一个作用域的主题文件，包括各自的 frontmatter 和文件统计信息。
- `DELETE …/scopes/:key/files/:name` 删除一个主题文件，并从 `MEMORY.md` 索引中删掉对应的行。
- `GET …/scopes/:key/export` 把作用域的全部主题文件连同 `MEMORY.md` 合成一个 JSON 文档返回，以附件形式下载。
- `POST …/scopes/:key/import` 接受 `{payload, mode?, confirm?}`。`mode` 取 `skip`（默认值，只添加作用域缺少的文件）、`overwrite`（替换同名文件）或 `replace`（还会删除文档中没有包含的文件）。凡会覆盖或删除文件的模式都需要 `confirm`，否则路由返回 409 `memory_import_confirm_required`。

### 插件与钩子

- `POST …/plugins` 会安装每个指定插件的 Skill 和钩子包；再次安装即更新。名称不存在时返回 404 `unknown_plugin`，且不做任何写入。
- `GET …/hooks` 返回每个已安装钩子包的名称、描述、版本、钩子点和插件图标。
- `POST …/hooks/archive` 要求 `hooks.json` 及其脚本位于 zip 根目录或同一个顶层目录内，且列出的每条命令都必须指向包内的文件。不带 `overwrite` 时，同名钩子包已安装会返回 409 `hook_exists`。`GET …/hooks/:name/archive` 导出的 zip 可以再通过这个路由安装。
- `GET /api/plugins` 按分类返回插件库的全部插件，包括每个插件的 Skill 元数据和钩子点。
- `GET /api/plugins/:plugin/files` 返回单个插件库插件自带的全部文件，以路径为键返回文本：`skills/<name>/` 下是每个 Skill 可安装的 `SKILL.md` 和参考文件，`hooks/` 下是钩子脚本。插件详情页的文件浏览器用的就是这个路由。

## 插件注册表与 Project 插件

本节的插件是服务端的包：由服务器加载进自身模块树的模块，例如沙箱后端。它们不是安装在 Agent 上的插件库插件，后者见[插件与钩子](#插件与钩子)。注册表路由是全局的，任何已登录用户都可以访问；已安装插件路由属于单个 Project。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/plugins/registry` | 插件索引：`{plugins: PluginIndexEntry[]}` |
| GET | `/api/plugins/registry/readme?name=…` | 索引中一个条目的说明文档：`{name, readme}` |
| GET | `/api/projects/:projectId/plugins/installed` | 该 Project 要求的插件，连同进程的实际运行情况：`{plugins, shipped, file, restartPending}` |
| POST | `/api/projects/:projectId/plugins/installed` | 仅管理员。添加一个随构建发布的插件：`{specifier}` |
| PUT | `/api/projects/:projectId/plugins/installed` | 仅管理员。替换整个列表：`{plugins}` |
| DELETE | `/api/projects/:projectId/plugins/installed?specifier=…` | 仅管理员。从列表中移除一个插件 |

- 索引沿用 typst/packages 的 `index.json` 格式：扁平数组，每个元素是一个版本条目，包含 `name`、`version`、`description`、`authors` 和 `license`，可选 `repository`、`homepage`、`keywords`、`categories` 和 `updatedAt`。条目的 `name` 就是 Project 列表里使用的包名。目前索引只来自服务器内置的一个注册表，其中列出了四个沙箱后端。注册表只用于发现，从不导入插件代码。
- `GET …/readme` 返回包自带的 `README.md`，从本机上的副本读取；没有时 `readme` 为 `null`。索引未列出的名称返回 `404` `not_found`，缺少 `name` 的请求返回 `400` `bad_request`。
- `GET …/installed` 对该 Project 的任何成员开放。`plugins` 的每个元素是 `{specifier, active, builtin, modules, replaces, error?}`：`active` 表示进程已加载这个包，`builtin` 表示它随本次构建发布，`modules` 和 `replaces` 是其生成的 `ifaces.json` 声明的节点，`error` 说明它为什么没有运行，例如本机上没有这个包，或加载失败。`shipped` 列出构建发布的全部插件包，无论是否被要求。`file` 是保存列表的文件名。已列出的插件既没有运行、也没有加载失败时，`restartPending` 为 true，重启服务器即可解决。Project 的 `.project_config.toml` 无法读取时返回 `400` `invalid_plugins_file`。
- 写操作返回与 GET 相同的响应体。specifier 必须是包名，不能是路径、URL 或版本范围（`400` `bad_request`）。加入列表的名称必须是构建发布的包，否则路由返回 `400` `plugin_not_shipped`：不会下载任何东西。`PUT` 只发送名称，留在列表中的名称保留文件为它记录的要求。`DELETE` 只修改列表，不删除磁盘上的任何东西。
- 写操作无需重启即可生效：App 围绕新列表[自行重组](/server-boot#重组)，效果与热替换相同。所有 Project 中正在进行的 Agent 运行都会被中止，因为所有 Project 共用同一棵模块树。新 App 启动失败时，改动会被撤销，之前的 App 随之恢复。
- 列表就是 Project 的 `.project_config.toml` 中的 `[plugins]` 表（见 [Project 配置](/configuration#project-配置)）。进程加载所有 Project 表的并集，因此任何一个 Project 要求的插件，都会为所有 Project 加载。

## 定时任务

下面的路径省略了 `/api/projects/:projectId` 前缀。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/schedules` | Project 内所有 Agent 的定时任务合并为一个列表，每条都标注所属的 `agentId`（任何成员） |
| GET / POST | `/agents/:agentId/schedules` | 列出定时任务 / 创建定时任务（名称已存在时返回 409） |
| POST | `/agents/:agentId/schedules/template-placeholder` | 在 Prompt 模板中插入 `{{SCHEDULES}}` 占位符（幂等） |
| GET / PUT / DELETE | `/agents/:agentId/schedules/:name` | 读取 / 更新 / 删除单个任务 |

定时任务的写操作仅限所有者。新建 Session 模式的任务，`modelId` 和 `provider` 要么同时携带，要么都不带。保存任务时会对照 Project 的模型表校验这对值；调度器核对任务时还会再校验一次。

## Benchmark

Benchmark 属于 Project，不属于某个 Agent：一个 Benchmark 可以评估任意多个 Agent，每次评估都会记录它测试的 Agent（`agentId`；没有对应 Agent 的记录为 `null`）。汇总中的 `agentIds` 按这些 Agent 首次出现的顺序排列。下面的路径同样省略了 `/api/projects/:projectId` 前缀。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/benchmarks` | Benchmark 的分数数据 |
| POST | `/benchmarks` | 手动创建 Benchmark（仅所有者） |
| DELETE | `/benchmarks/:benchmarkId` | 删除 Benchmark 目录，包括其中的题目、配置和计分板（仅所有者；返回 204，不存在时返回 404） |
| GET | `/benchmarks/:benchmarkId/cases` | Benchmark 的题目：每道题的 id 和题干 README 的标题。评分标准永远不会返回 |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/files` | 浏览一道题的 `statement/` 目录 |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/files/content` | 读取题干中的一个文件（`?path=`、`?preview=1`、`?download=1`） |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/rubric/files` | 浏览一道题的 `rubric/` 目录 |
| GET | `/benchmarks/:benchmarkId/cases/:caseId/rubric/files/content` | 读取评分标准中的一个文件，参数与上一条相同 |

- `GET /benchmarks` 只列出含有 `benchmark_config.toml` 的目录；评估过程中删除 Benchmark 留下的目录没有这个文件，因此不会出现在列表里。每个条目都带 `status`：Skill 还在构建 Benchmark 时为 `draft`，校准未能完成时为 `failed`，其余情况为 `published`。
- `POST /benchmarks` 接受 `{id, title, description?, runs?, cases: [{id, title, statement, rubric}]}`，返回 201 和 `{benchmark}`。服务器会写入 `benchmark_config.toml`（其中 `status = "published"`）、一份 `evaluations: []` 的 `scoreboard.yaml`，以及每道题的 `statement/README.md`（以 title 为标题）和 `rubric/README.md`。id 的字符规则与 Agent id 相同，题目 id 以 `CASE-` 开头。如果目录已存在，路由返回 409 `benchmark_exists`。
- 这些读取文件内容的路由采用与 Workspace 文件相同的内联加固；参见 [Workspace 文件响应](#workspace-文件响应)。

## 组织（公司模式）

以下所有路径都位于 `/api/projects/:projectId/organizations` 之下。服务器的公司模式开关关闭时，每条路由都返回 `404` `company_mode_off`（参见[公司模式开关](#公司模式开关)）。任何 Project 成员都可以读写。没有任何路由会删除组织：`status`（`active` / `paused`）就是关闭开关，暂停的组织会保留自己的对话、员工、工位和工单。这些路由背后的文件见[公司模式](/company-mode)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/` | 列出组织 / 创建组织 |
| GET / PATCH | `/:orgId` | 组织概览 / 修改组织设置 |
| GET | `/:orgId/chart` | 员工树，含每名员工的实时状态、工位和本期花费 |
| POST | `/:orgId/employees` | 招聘员工：已有 Agent 或新建 Agent |
| PATCH / DELETE | `/:orgId/employees/:agentId` | 修改员工 / 将员工移出组织 |
| GET / POST | `/:orgId/employees/:agentId/desk` | 工位会话（缺失时自动打开）/ 续期后的工位会话 |
| GET / PUT | `/:orgId/handbook` | 手册索引（`handbook/README.md`） |
| GET | `/:orgId/handbook/files` | 知识库文件，索引排在最前 |
| GET / PUT / DELETE | `/:orgId/handbook/files/<path>` | 按相对路径访问单个文档；索引不可删除 |
| GET / POST | `/:orgId/calendar` | 全体员工的事件和运行状态 / 创建事件 |
| GET / PUT / DELETE | `/:orgId/calendar/:agentId/:name` | 单个事件 |
| GET / POST | `/:orgId/tickets` | 按列组织的看板，附无法解析的文件 / 创建工单 |
| GET / PUT | `/:orgId/tickets/:ticketId` | 工单详情 / 更新工单 |
| POST | `/:orgId/tickets/:ticketId/move` | `{status, reason?}`；移动到 `rejected` 时必须给出原因 |
| POST | `/:orgId/tickets/:ticketId/block` | `{reason, by?}`，`by` 是工单 id 或主体；工单仍留在原列 |
| POST | `/:orgId/tickets/:ticketId/unblock` | 解除阻塞 |
| POST | `/:orgId/tickets/:ticketId/progress` | `{text}`：向 `## Progress` 追加一句纯文本 |
| POST | `/:orgId/tickets/:ticketId/start` | `{agentId?, message?, workspace?}` → 202 `{sessionId}`：启动工单会话 |
| POST | `/:orgId/tickets/:ticketId/attach` | `{sessionId}`：把已有会话登记为贡献会话 |
| GET / POST | `/:orgId/channels` | 调用者可见的频道，`default_channel` 在最前 / 打开一个频道 |
| GET / PATCH | `/:orgId/channels/:channelId` | 频道和成员 / 重命名、修改 `purpose`、设置 `archived` |
| POST | `/:orgId/channels/:channelId/members` | `{principal}`：添加成员 |
| DELETE | `/:orgId/channels/:channelId/members/:principal` | 移除成员 |
| GET / POST | `/:orgId/channels/:channelId/messages` | 一天的消息，附调用者的未读数和提及数 / 发送消息 |
| POST | `/:orgId/channels/:channelId/read` | `{upTo}`：调用者在此频道的已读游标 |
| GET | `/:orgId/finance` | 每名员工的花费（自身及沿汇报线累计）和每个工单的花费（沿 `Parent` 逐级汇总）、每日趋势和告警；`?period=yyyy-mm` |
| GET | `/:orgId/sessions` | 组织的工位会话，以及按工单分组的工单会话。工位会话启用了消息绑定时，这一行也带上它的 `messagingChannel`，与会话自己的行一致 |

### 调用者身份

写操作的请求体可以携带 `agentId` 和 `sessionId`，分别对应发起调用的员工和会话；CLI 会从 `PENGUIN_AGENT_ID` 和 `PENGUIN_SESSION_ID` 自动填入这两个值。文件里因此记录的是员工，而不是 token 对应的用户：`agentId` 指向员工时以 `agentId` 为准，否则由会话决定。频道读取和成员 DELETE 没有请求体，所以改用查询参数 `?agentId=` / `?sessionId=` 传入同一对值。只有携带本地 API token 的请求，服务器才会认可这两个字段；员工就是这样以自己的身份、而不是以登录者的身份得到响应的。

### 组织

- `POST /` 接收 `{orgId, mission, name?, timezone?, workspace?, model?, ceoBudget?, language?}`，返回 201 和组织详情。创建组织的同时会创建 CEO Agent，并以一次初始化运行打开它的工位。id 或 CEO 的 Agent id 已被占用时，路由返回 409。CEO 的组织架构条目以 `workspace: ceo` 写入，也就是共享 Workspace 下的一个分区，其他员工也都是这样。
- `ceoBudget` 是 CEO 的月度预算，单位为美元，写入 CEO 在 `org_chart.yaml` 中条目的 `budget`。不能为负数，默认 100。预算沿累计线比较，所以这个值是全公司的上限。
- `language` 取 `zh` 或 `en`，是组织所有产出内容的工作语言。省略时根据使命判断。
- `GET /:orgId` 返回概览：设置、看板计数、今日日程、待办事项、全员频道的最近消息、`inbox` 和告警。设置里始终带有生效的 `language`；文件里没有记录时，从使命推断得出。
- `PATCH /:orgId` 修改名称、使命、`status`（`active` / `paused`；暂停会停止所有自动触发器）、`approvalMode`、`timezone`、`language` 和各项阈值。

组织和频道的 id 提议由 Project 级路由给出，即带 `kind: org` 或 `kind: channel` 的 `POST /api/projects/:projectId/suggest-id`，见[语义化 id 提议](#语义化-id-提议)。

### 员工

- `POST /:orgId/employees` 招聘已有 Agent 时传 `{agentId}`，新建 Agent 时传 `{newAgent: {agentId, name?, description?, plugins?}}`；另外还可以带 `title`、`reportsTo`、`workspace?`、`budget?`、`duties?` 和 `model?`。
- `workspace` 缺省为以员工 Agent id 命名的子目录，因为共享 Workspace 的根目录存放共享输入，不属于任何人的工位。相对路径 `workspace` 会先规范化（`./hr` → `hr`），再在共享 Workspace 下创建。绝对路径必须已经存在。包含 `..` 而逃出共享 Workspace 的路径返回 400 `invalid_workspace`。
- `PATCH /:orgId/employees/:agentId` 修改职位、上级、Workspace（创建与校验规则和招聘时相同）、预算（传 `null` 即清除）、职责和模型。
- `DELETE /:orgId/employees/:agentId` 将员工移出组织：下属上移，改归这名员工的上级管理。CEO 不能移出组织。

### 日程

`POST /:orgId/calendar` 接收 `{agentId, name, prompt, enabled, startAt, period?, endAt?, title?}`，返回保存后的事件，外加提示性的 `warnings`，每条警告一行：

- 另一名员工有周期事件的开始时间落在同一分钟
- 同一员工已有相同周期的第二个周期事件
- 周期事件从 `now` 时刻开始

警告不会阻止写入。`PUT /:orgId/calendar/:agentId/:name` 的响应与创建时一致，同样包含 `warnings`。

### 工单

- `POST /:orgId/tickets` 接收 `{title, goal?, acceptanceCriteria?, body?, owner?, parent?, notify?, priority?, due?, slug?}`。
- `owner` 是唯一的责任主体：员工（直接写 Agent id，或 `agent:<id>`）或 Project 成员（`user:<id>`）。缺省为调用者。不传 `notify` 时，负责人一人就是整份 `notify` 列表，但前提是负责人为员工，这样人不会因为自己名下的工单被 @。谁提交了工单，记录在 `history` 的 `created` 条目里。
- id 的 slug 优先取 `slug`，它必须是由连字符连接的小写英文单词（否则返回 400）。不传 `slug` 时从标题提取。标题凑不出两个单词时，交给 Project 的模型处理；模型也失败时，返回 400 `slug_required`，让调用者自己指定 slug。
- `GET /:orgId/tickets/:ticketId` 返回 frontmatter 字段、正文各节、纯文本形式的 `progress`、`history`、贡献会话、子工单和逐级汇总的成本。
- `PUT /:orgId/tickets/:ticketId` 接收 `{title?, owner?, parent?, notify?, priority?, due?, goal?, acceptanceCriteria?, result?}`。`owner` 不接受 `null`：工单始终有负责人，负责人可以更换，但不能取消。`parent` 和 `due` 接受 `null`，用于清空这两项。
- `POST …/progress` 会记录这句话是谁写的、何时写的，并在 `history` 末尾追加一条 `progress` 条目。

`POST /:orgId/tickets/:ticketId/start` 为一名员工启动工单会话，并记入工单的 `sessions` 和 `history`。这是唯一一条 `agentId` 不代表调用者身份的路由：它指定会话以哪名员工的身份运行。谁可以启动会话，取决于调用者：

- 人可以在任何工单上启动会话。`agentId` 指定员工，缺省为负责人。
- 以员工身份写入的调用者（用自己的 `sessionId` 发请求的工位会话或工单会话），只能为自己负责的工单启动会话。对别人的工单，或没有员工负责人的工单，会收到 403 `not_ticket_owner`。
- 负责人也可以传 `agentId`，把一位同事拉进自己负责的工单。

### 频道

- `GET /:orgId/channels` 列出调用者能看到的所有频道：人可以看到全部，员工只看到自己加入的。
- `POST /:orgId/channels` 接收 `{channelId, name?, purpose?}`，返回 201 和新建的频道，创建者是唯一成员；id 已被占用时返回 409。
- `PATCH /:orgId/channels/:channelId` 只有人可以设置 `archived`，`default_channel` 则任何人都不能归档。
- `POST …/members` 允许任何成员邀请 `agent:<id>` 员工或 `user:<id>` Project 成员。人可以添加自己，员工不行。添加的已是成员时不做任何改动，返回 201。
- `DELETE …/members/:principal` 允许任何人移除自己，人还可以移除任何人；员工只能移除自己。移除非成员时不做任何改动，返回 204。
- `GET …/messages` 接收 `?date=yyyy-mm-dd`，缺省为组织时区的今天。`POST …/messages` 发送 `{text, refs?}`；提及对象从文本中解析，且必须都是频道成员。

`system` 消息在英文 `text` 之外还带一个 `notice`：包含 `kind` 和字符串 `params`，客户端据此用读者的语言渲染这句话。在这个字段出现之前写入的消息没有 `notice`。`kind` 取 `employee_joined`、`employee_left`、`channel_created`、`channel_archived`、`channel_unarchived`、`channel_joined`、`channel_invited`、`channel_left`、`channel_removed`、`budget_warned`、`budget_paused` 之一，或遗留的 `ticket_blocked`、`ticket_done`、`ticket_rejected` 之一。现在已经没有任何代码会写入遗留 kind，保留它们只是为了让磁盘上已有的消息仍能正常渲染。

频道错误：

| 代码 | 状态码 | 含义 |
| --- | --- | --- |
| `channel_not_found` | 404 | 频道不存在；不可能属于任何频道的 id 也返回这个错误 |
| `channel_exists` | 409 | 频道 id 已被占用 |
| `channel_archived` | 409 | 频道已归档，取消归档前不接受写入 |
| `not_a_member` | 403 | 非成员却读取、发言或邀请，或员工尝试只有人才能执行的操作 |
| `all_hands_immutable` | 400 | 归档 `default_channel` 或修改它的成员 |
| `mention_not_member` | 400 | 消息提及的主体不是频道成员；不写入任何内容 |
| `invalid_principal` | 400 | 主体格式不正确 |

### 事件与触发

公司模式会在用户事件流 `GET /api/events` 上发布 `org_run`、`org_channel`、`org_ticket` 和 `org_budget`；参见[流式传输（SSE）](#流式传输sse)。

只有三件事会驱动工位会话：日程事件、频道里的 @ 提及，以及有人跟它说话。CEO 在创建时的初始化运行是唯一的例外。

写工单不会触发运行。`move`、`block`、`unblock` 以及通过 `PUT /:orgId/tickets/:ticketId` 变更负责人，都会记入工单文件，并以 `org_ticket` 事件发布，同时排入相关员工的队列。员工的下一次日程事件触发时，会在正文的 `## Since your last sweep` 之下逐行列出这些变更，一条变更占一行。组织或员工暂停时，队列依然保留，由最终触发的那次巡检送达。员工离开组织时，它尚未投递的行也随之删除。

## Session 创建与目录浏览

以下路径省略了 `/api/projects/:projectId` 前缀。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/agents/:agentId/sessions` | 列出 Agent 的 Session 及运行状态，不论由哪个客户端创建；`excludeOrg=1` 则只要用户自己的那些 |
| POST | `/agents/:agentId/sessions` | 创建 Session：`{modelId?, provider?, workspace?, approvalMode?, client?, source?}` → 201 `{session}` |
| GET | `/dirs?path=` | Workspace 选择器背后的服务器端目录浏览器 |
| GET | `/dir-skills?path=` | 目录所带的 Skill，用于导入到新 Agent |

- Session 列表接受可选查询参数。`limit` 和 `offset` 用于分页（`offset` 必须搭配 `limit`）。`category`（`active`、`subagent`、`schedule`、`benchmark` 或 `archived`）先过滤再分页；`workspaceGroup` 只保留一个 Workspace 的会话。`counts=1` 会在响应里附加 `counts`（整个列表按类别的总数）、`workspaceCounts`（按 Workspace 路径统计的同类总数）和 `workspaceLatest`（每个 Workspace 最新的 Session）。不带分页参数时，返回完整列表。
- `excludeOrg=1` 会把组织的工位会话、工单会话和子 Session 一并移出这一页以及 `counts=1` 的总数，这正是开发模式的列表所要的。取其他值返回 400。
- 创建时 `modelId` 和 `provider` 必须成对出现：要指定模型就传完整一对，两个都省略则使用 Project 的默认模型。只传一个返回 400。
- 显式传入的 `workspace` 必须是已存在的目录，永远不会自动创建。省略时自动创建一个临时 Workspace。审批模式默认 `allow-all`。
- `client` 是记录在数据行上的来源提示：CLI 发起的请求为 `"cli"`，默认 `"web"`。组织的工位会话和工单会话由服务器自己写入 `"org"`，客户端不能发送这个值。只有 `excludeOrg` 会把它当作过滤条件，而且只用来剔除这些行。
- `source` 只接受 `"benchmark"`，用于 Benchmark 评估或优化创建的 Session。`subagent` 和 `schedule` 由服务器自己设置。
- `GET /dirs` 省略 `path` 时从主目录开始；显式传入的 `path` 必须是绝对路径。响应为 `{path, parent, entries}`，只包含子目录；读不了的目录按空列表返回，用户仍然可以向上返回。
- `GET /dir-skills` 只读取绝对路径下的 `<path>/.agents/skills` 和 `<path>/.claude/skills`，响应为 `{path, skills}`。没有 Skill 的目录返回空列表。参见 [Agent](#agent) 一节中的 `POST /agents`。

## 用量与 Trace（Agent 级别）

以下路径省略了 `/api/projects/:projectId` 前缀。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/usage` | 用量统计 |
| GET | `/usage/model-totals` | 每个模型的历史累计 Token 总量；不接受任何过滤参数 |
| GET | `/usage/errors` | 错误详情表的一页，按时间倒序：→ `{items, total}` |
| DELETE | `/usage/errors` | 按当前过滤条件清空错误表：→ `{deleted}`（仅限 Project 所有者） |
| GET | `/agents/:agentId/traces` | Trace 文件，按日期 → Session 逐级下钻 |
| GET | `/agents/:agentId/traces/:sessionId/:index` | 读取 Trace 事件（`offset` / `limit` 分页） |
| GET | `/agents/:agentId/traces/:sessionId/:index/analysis` | Trace 性能分析 |
| GET | `/agents/:agentId/traces/:sessionId/:index/download` | 下载原始 Trace 文件（JSONL 附件） |
| POST | `/agents/:agentId/traces/import` | 导入 Trace 文件：`{dataBase64}` → `{sessionId, index, date}` |

`GET /usage` 接受以下查询参数：

| 参数 | 说明 |
| --- | --- |
| `from`、`to` | 日期范围，格式 `yyyy-mm-dd` |
| `fromTs`、`toTs` | 限定滑动窗口起止的 ISO 时间戳。必须成对传入；`minute` 粒度时必填 |
| `groupBy` | `date`、`agent`、`model` 或 `session`；默认 `date` |
| `granularity` | 时间序列精度：`minute`、`hour`、`day`、`week` 或 `month`；默认 `day`。范围与精度的组合过大时会拒绝请求 |
| `agentId`、`provider`、`modelId` | 过滤条件 |

- `GET /usage/errors` 接受 `offset`、`limit`、同样的 `from` / `to` / `fromTs` / `toTs` / `agentId` 过滤条件，以及可选的 `kind`（`unexpected` 或 `expected`）。
- `DELETE /usage/errors` 接受与读取相同的过滤条件（`from` / `to` / `fromTs` / `toTs` / `agentId`），但不接受 `kind`，因为面板上没有这个控件。这里 `from` 和 `to` 都必填（否则返回 400），因为少一个边界，清空的就是整段历史，而不是过滤后的一部分。清空的范围与调用者读取的范围完全一致：管理员清空时，也会删掉只有管理员读取才能看到的未归属行；成员清空时则永远不会。
- `GET /agents/:agentId/traces` 还接受 `limit` 和 `offset` 分页，以及 `category`（必须搭配 `limit`），用于只列出某一类别的 Session。
- 任何成员都可以下载 Trace。导入只有所有者能做，与 Agent State 快照导入一样，上限 14MB。导入的文件必须是有效的 Trace JSONL，首条记录必须是 `session_meta`，`session_id` 须可安全用作文件名。session id 与 Agent 已有的重复时拒绝导入（409 `trace_session_exists`），所以导入的文件总是成为新 Session 的 index 001，按首条记录的时间戳存入对应的本地日期目录。

## Session 级端点

下面这些路径省略了 `/api/sessions/:sessionId` 前缀。Session 和 Trace 背后的存储模型见 [Session 与 Trace](/sessions-and-traces)。

这里的每条路由都遵循两条约定。调用方无权访问的 Session 一律返回 `404` `session_not_found`，因此不会暴露它是否存在。一个 Session 同一时间只能运行一个 Task 或一次压缩：冲突的请求返回 409（`task_in_progress` / `compacting`）。

### Session 与历史

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | Session 信息 |
| PATCH | `/` | 更新 Session：`{approvalMode?, thinkingLevel?, archived?, title?}` |
| DELETE | `/` | 删除 Session，连同它的 Trace 和暂存文件 |
| GET | `/messages` | OmniMessage 历史，全量或按 Task 窗口 |
| POST | `/fork` | 在一条已完成的助手回复之后分叉空闲的 Session：`{position: {fileIndex, ordinal}}` → `{session}` |
| GET | `/stream` | SSE 事件流；见[流式传输（SSE）](#流式传输sse) |
| GET | `/context` | 当前模型上下文的组成，以及压缩将从哪里开始 |
| GET | `/goal` | 当前 Session 最近一次目标运行 |

- `GET /` 返回 Session 的信息。与列表行不同，单个 Session 的响应还带 `tracePath`，即最新 Trace 文件的绝对路径。`orgId` 标记公司模式缓存持有的会话（工位会话，或这个组织某个工单的贡献会话）；普通 Session 一律不带这个字段，列表路由同样会设置它。
- `PATCH /` 带 `thinkingLevel` 会把这个思考等级持久地固定到这个 Session，从下一次 LLM 请求开始生效。思考等级是软性限制：可以在上下文中途更改，代价是损失供应商已缓存的上下文，因此等级选择器会建议先压缩。固定后的等级以 `SessionInfo.thinkingLevel` 返回；没有这个字段说明从未固定等级，此时采用 Agent 配置。
- `GET /messages` 不带参数时返回完整的 OmniMessage 历史。`tailLimit=n` 改为读取最新的 n 个按 Task 对齐的单元，`before=<cursor>&limit=n` 读取某个游标之前的 n 个单元。两种形式互斥，`n` 在 1 到 1000 之间，`limit` 默认为 200。内置 Web App 打开一段对话时先显示最近 50 轮，滚动时再加载更早的内容。窗口式响应带 `page`，包含下一页的游标（`before`）、窗口之前的轮数（`earlierTurns`）和此前累计的统计（`prior`）。Task 运行期间，响应还会带 `live`；见 [GET /messages 上的 live 字段](#get-messages-上的-live-字段)。
- `GET /context` 返回当前模型上下文的各个组成部分，外加 `compactionThreshold`：上下文达到多大（以 Token 计）时，Session 的下一个请求会开始压缩。这个阈值就是 Agent 的 `compaction.max_context_length`，上限不超过模型上下文窗口的剩余空间。压缩未启用、读不到 Agent 配置，或阈值不低于窗口时，这个值是 `null`。这条路由每次调用都读取最新的 Trace 文件，所以数值是快照，不是实时计数器。
- `GET /goal` 返回 `{goal}`：Session 从未跑过目标时为 `null`，否则为 `{objective, status, budget, used, rounds}`。`status` 取值为 `active`、`complete`、`blocked`、`budget_limited` 或 `aborted`，`budget` 为 -1 表示不限制。目标只存活在它的运行期间，所以 Session 已停止运行、目标却仍是 active 时，会报告为 `aborted`。见[目标模式](/goal-mode)。

### GET /messages 上的 `live` 字段

Trace 只存储完整的消息，流式的 `partial_*` 消息从不落盘，所以光靠历史看不到一条仍在流式输出的消息。Session 运行或压缩期间，messages 响应会额外带上进行中的流尾部：

```ts
interface MessagesResponse {
  messages: (OmniMessage & { tracePosition?: { fileIndex: number; ordinal: number } })[];
  live?: {
    // The Session channel's most recently assigned SSE event id (`<epoch>-<seq>`):
    // every event published up to and including this id is already reflected in `fragments`.
    cursor: string;
    // One synthetic `partial_* start` OmniMessage per open streaming fragment, whose
    // payload carries the full accumulated content so far (text/thinking prefix,
    // tool-call name + accumulated arguments, tool-output prefix + images), with the
    // original `origin` chain preserved (subagent fragments included).
    fragments: OmniMessage[];
  };
}
```

`cursor` 和 `fragments` 在 Trace 读取开始之前一并原子捕获。先连接事件流的客户端（见[推荐的客户端模式](#推荐的客户端模式)）在历史之后应用它们：游标的 epoch 与已缓冲 SSE 事件的 epoch 一致时，丢弃所有 seq 不高于游标的缓冲 partial 事件，因为 `fragments` 已经包含那些内容。接着客户端把 `fragments` 送入正常的 reducer，再重放缓冲中剩下的部分。游标从不丢弃缓冲中的完整消息；那些交给常规的重叠去重处理。Session 空闲时不返回 `live`。

### 分叉

`tracePosition` 是历史响应的元数据，不属于持久化的 OmniMessage 信封。Web App 把这条回复最后一条助手记录的不可变位置发给 `/fork`，服务器检查这条记录确实结束了一个已完成的 Task。

分叉会克隆保留的 Trace 文件，并把源暂存区按新 Session id 拍快照，同时改写系统生成的本地附件标记，因此以后无论删除哪个 Session，分叉都能继续工作。从同一个源 Session 的任意回复创建的分叉，共用一套与界面语言无关的持久标题序号（`Source title (1)`、`Source title (2)`）；删除较早的分叉也不会释放它的序号。源 Session 正在运行或压缩时返回 409。

### Task 与插话

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/tasks` | 启动一个 Task：`{input: TaskInputPart[], queueIfBusy?, goal?}` → 202 |
| POST | `/steer` | 为正在运行的 Task 排入一条插话消息：`{text, images?}` → 202 |
| DELETE | `/steer/:steerId` | 撤回一条尚未投递的插话消息 |
| DELETE | `/follow-ups/:followUpId` | 撤回一个排队的后续 Task |
| POST | `/approvals/:toolCallId` | 审批决定：`{decision}`，`allow` 或 `deny` → 204 |
| POST | `/tool-calls/:toolCallId/background` | 把一个执行中的工具调用移入后台 → 204 |
| POST | `/subagents/:childSessionId/message` | 向一个子 Agent 会话发送消息：`{text}` → `{outcome}` |
| POST | `/subagents/:childSessionId/abort` | 停止一个子 Agent 会话的当前运行 |
| POST | `/abort` | 中断当前 Task：触发时返回 202，空闲时返回 204 |
| POST | `/retry-now` | 跳过重连倒计时：→ 200 `{skipped}` |
| POST | `/compact` | 开始上下文压缩：202 |

- `POST /tasks` 响应 `{sessionId, queued?}`。带 `queueIfBusy` 时，忙碌的 Session 会把输入存为后续 Task（`queued: true`），等 Session 空闲后作为普通的下一个 Task 启动；`task_state` 事件报告排队的数量。`file` 输入部分写入 Session 暂存区，并以 `[attached file: <path>]` 行的形式交给模型（见[请求体](#请求体)）。
- `POST /tasks` 带 `goal: {budget?}` 时改为启动目标循环。Agent 没有安装 `goal` 插件时返回 409 `goal_plugin_not_installed`。目标就是输入里的文本（去掉开头的标记块），所以输入必须带非空文本（否则返回 400）：只有图片说明不了目标。图片作为普通输入随第 1 轮发送，之后各轮只重新注入目标文本。`file` 部分一律以 400 拒绝，因为没有办法把文件带进每一轮都重新注入的目标。见[目标模式](/goal-mode)。
- `POST /steer` 在轮次之间把消息作为一条独立的 `[user_steering]` 用户消息投递，图片紧随其后。`text` 和 `images` 任一字段都能单独携带消息，但两者都缺时返回 400。没有 Task 在运行时返回 409 `not_running`。
- `DELETE /steer/:steerId` 接收 `task_state` 里 `pendingSteering` 的 id，把那条消息从队列撤回。响应 200，带原始内容 `{text, images, files}`，便于输入框恢复消息供编辑：文件以 data URL 的形式从暂存区读回，磁盘上的副本随之删除。消息已经投递给模型时返回 409 `not_pending`。
- `DELETE /follow-ups/:followUpId` 接收 `task_state` 里 `pendingFollowUps` 的 id，在后续 Task 启动前把它移除。响应 200，带原始内容 `{text, images, files}`；无论以哪种方式排队，每个排队的后续 Task 都带这些内容。后续 Task 已经启动、或 id 未知时返回 409 `follow_up_started`。
- `POST /tool-calls/:toolCallId/background` 把一个执行中的工具调用转成后台任务交回，当前轮次得以收尾，对话得以继续。调用以 `completed` 结束并附带 `process_id` 或 `subagent_id`，进程一律不终止，结果稍后通过常规的后台任务通知送达。没有这个 id 的调用在执行时返回 404 `tool_call_not_found`（id 未知、调用已结束、或运行时已不存在）；调用还在运行、但它的工具没有后台形态时返回 409 `tool_not_detachable`。只有 `exec_command` 和 `run_subagent` 有后台形态。
- `POST /subagents/:childSessionId/message` 无论子 Agent 处于什么状态，都把文本作为用户输入投递给它。子 Agent 正在运行、消息作为插话排队时，`outcome` 为 `steered`；空闲的子 Agent 启动一次后续运行时为 `started`；已释放的子 Agent 重新拉起并开始下一轮时为 `resumed`。子 Agent 以自己上下文的思考等级运行，可以用子 Session 上的 `PATCH` 固定它。空 `text` 返回 400；404 `subagent_gone` 表示子 Agent 的记录不存在或无法复活；409 `subagent_busy` 表示子 Agent 目前无法接收消息。
- `POST /subagents/:childSessionId/abort` 只停止子 Agent 当前的运行；子 Session 仍可用于插话和后续 Task。成功停止一次运行时返回 202；子 Agent 已空闲或未知时返回 204。
- `POST /retry-now` 对应重连倒计时上的**立即重试**按钮。它跳过当前的退避等待，立即发起下一次重试，不改动尝试计数。`skipped: false` 表示当时没有等待在进行，这不是错误。
- `POST /compact` 在没有可压缩内容时返回 409，原因写在错误码里：`compaction_not_configured`（Agent 没有配置压缩）、`nothing_to_compact`（上下文还没有完整的对话轮次）或 `already_compacted`（上次压缩之后没有新内容）。服务器重启后恢复的 Session 会从自己的 Trace 推导出这些状态，所以已有对话无需先跑一个 Task 也能压缩。

### 请求体

```ts
// POST /api/sessions/:sessionId/tasks — start a Task
interface TaskCreateRequest {
  input: TaskInputPart[];
  // The thinking level is not a task parameter: it belongs to the model context — pin it on
  // the Session with PATCH, and each context the Session opens runs at the pinned level
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string }    // pasted images arrive as data URLs, ≤20MB (413 image_too_large)
  // File attachment: base64 data: URL, by default ≤100MB each (413 file_too_large beyond that),
  // at most 20 per request and 120MB of decoded bytes in total (413 too_many_files /
  // payload_too_large; all three are checked before anything is written). The two sizes are
  // admin-settable (PUT /api/admin/settings) and reported by GET /api/me. The server writes it into the Session
  // scratchpad and appends an `[attached file: <path>]` line to the message text — the model
  // opens the file by path. `fileName` carries no path separators; on disk it keeps its own
  // words (`报告 2026.pdf` → `报告-2026.pdf`: non-ASCII survives, shell-hostile ASCII becomes
  // `-`), so a name is readable in the message and safe to paste into a command.
  | { type: "file"; fileName: string; dataUrl: string };

// POST /api/sessions/:sessionId/approvals/:toolCallId
interface ApprovalDecisionRequest {
  decision: "allow" | "deny";
}
```

Web App 的 `/model` 切换没有专用端点。和 `/agent` 交接一样，它把几条普通路由组合起来：

1. 创建 Session：为同一个 Agent 打开新 Session，沿用所选模型和源 Workspace。
2. `POST /tasks` 发送第一条消息，开头是 `[model_switch_from]` 来源块，写明源 session id、它的 `tracePath`、Workspace 以及之前的模型组合。
3. 需要更早的历史时，模型自己去读那个 Trace 文件。

### 后台进程

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/processes` | 对话启动的后台进程 |
| POST | `/processes/:processId/kill` | 停止一个后台进程 |
| DELETE | `/processes/:processId` | 把一个已退出的进程从列表移除 |

- `GET /processes` 列出超出让出窗口而转入后台的 `exec_command` 调用。列表只来自当前活跃的运行时，所以未加载、或从未正确加载的 Session 报告空列表。当服务器检测到进程对外服务的地址时，行会带 `serviceUrl`：它是输出打印的最后一个本地 URL；找不到时，是探测进程组发现的监听端口，每次请求都会刷新。
- `POST /processes/:processId/kill` 先向整个进程组发送 SIGTERM，宽限期后发送 SIGKILL，条目随即移出列表。进程已不存在时返回 404 `process_not_found`。
- `DELETE /processes/:processId` 在进程仍在运行时返回 409 `process_running`（应该改用停止接口），在条目已不存在时返回 404 `process_not_found`。条目连同已捕获的输出一起移出运行时注册表，之后再对那个 `process_id` 执行 `input_command` 会失败。

### Workspace 文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/files?path=` | 浏览一个 Workspace 目录 |
| GET | `/files/content?path=&download=&preview=` | 读取一个 Workspace 文件（见 [Workspace 文件响应](#workspace-文件响应)） |
| GET | `/files/preview-redirect?path=` | 在独立的预览源上打开 HTML 文件：签发签名 token 并以 302 重定向 |
| POST | `/files/stat` | 检查文件是否存在：`{paths}` |
| PUT | `/files/content?path=` | 上传文件：`{dataBase64}`，最大 14MB |
| POST | `/files/move` | 移动或重命名一个文件：`{from, to, ifVersion?}` → 204 |
| DELETE | `/files/content?path=&ifVersion=` | 删除一个文件 → 204 |
| POST | `/files/reveal?path=` | 在机器自带的文件管理器中显示文件 → 204 |
| GET | `/files/search?q=` | 按条目名搜索整个 Workspace |
| GET | `/scratchpad/:fileName` | 读取 Session 的一个暂存文件，例如输入图片或文件附件 |

- `GET /files/preview-redirect` 支撑**新页面打开**和**文件浏览**面板里的 HTML 渲染视图；见[独立源上的预览](#独立源上的预览)。
- `POST /files/move` 只对文件生效：目录没有单一的版本标记，保护移动的前置条件无法对目录表达，所以对目录返回 400。`to` 缺失的父目录会自动创建。`from` 不存在时返回 404 `path_not_found`；`ifVersion` 不再匹配时返回 409 `file_changed`（带着标记时源文件却已消失，也算作已变化）。`to` 位置已有内容时返回 409 `target_exists`——目标从未读取过，所以选择拒绝而不是覆盖；移动到文件自身路径返回 400。
- `DELETE /files/content` 同样只对文件生效（对目录返回 400）。文件已不存在时返回 404 `path_not_found`；`ifVersion` 不再匹配时返回 409 `file_changed`。这个标记是可选的，不带标记时删除是无条件的，但**文件浏览**面板总是发送它读取时拿到的标记。
- `POST /files/reveal` 在 macOS 和 Windows 上选中文件，在 Linux 桌面上打开文件所在目录。只有桌面 shell 自己的窗口可以调用它。服务器不是由桌面 shell 启动时返回 404 `not_found`；浏览器会话访问桌面模式服务器时返回 403 `desktop_shell_only`：这种会话无法与远程会话区分，而在服务器所在的机器上打开文件夹，对那头的用户毫无用处。路径的限制与读取相同（越界 400，不存在 404 `path_not_found`）；502 `reveal_failed` 表示文件管理器未能启动。
- `GET /files/search` 只匹配条目名（不区分大小写的子串；不匹配路径），响应为 `{hits: [{path, kind, sizeBytes, mtime}], truncated}`，每条命中都带有目录列表条目的全部字段。搜索从根目录开始广度优先遍历，所以浅层结果先出现；结果达到上限时，保留的是最相关的命中，而不是最先遍历到的那个目录里的内容。`truncated` 表示遍历因达到上限而停止：命中 200 条，或访问了 20000 个目录条目。`q` 为空或超过 100 个字符时返回 400。

### Workspace 文件响应

Workspace 文件可能由 Agent 生成，所以 `GET /files/content` 把它们当作不可信内容。每个响应都带 `X-Content-Type-Options: nosniff`，其余响应头取决于两个标志，`download=1` 优先于 `preview=1`：

| 查询参数 | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| 两者都不带 | `.html` / `.htm` / `.svg` 用 `text/plain; charset=utf-8`，其他用真实类型 | `inline` | — |
| `preview=1` | 真实类型（`text/html`、`image/svg+xml` 等） | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`，仅对 `.html` / `.htm` / `.svg` 发送 |
| `download=1` | 真实类型 | `attachment` | — |

文件名一律以 `filename*=UTF-8''` 的形式加百分号编码发送。

没有可用的独立预览源时，预览重定向就回退到 `preview=1`。文档保留真实类型，会正常渲染和执行，但沙盒有意省略 `allow-same-origin`。于是文档落在一个不透明源里，既拿不到本源的 cookie，也访问不到 API；`localStorage`、`document.cookie` 和第三方嵌入在那里都不起作用，原因也在于此。

`GET /scratchpad/:fileName` 提供同类不可信内容（上传的文件以及 Agent 写入的临时文件），以同样的方式加固，但不接受那两个标志：

- 始终发送 `X-Content-Type-Options: nosniff`。
- 固定白名单中的五种惰性图片类型（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`）以内联方式提供，供对话里的 `<img>` 标签使用。
- 其余内容一律以 `application/octet-stream` 加 `Content-Disposition: attachment` 提供，因此除这些图片外，任何东西都无法在应用的源上渲染成文档。

### 独立源上的预览

**文件浏览**面板里的 HTML 渲染视图（一个 iframe）和**新页面打开**都经过 `GET /files/preview-redirect?path=`。这条路由先验证调用方，再签发一个短时效的 HMAC token，然后以 302 重定向到一个**不同的源**：

```text
GET  /api/sessions/:sessionId/files/preview-redirect?path=index.html
302  Location: http://localhost:7364/preview/<token>/index.html
GET  /preview/<token>/<relative path>          (unauthenticated; the token is the credential)
```

- 为什么需要独立的源：页面要有真实的源，存储、cookie 和第三方嵌入才能工作；但这个源不能是应用的源，否则 Agent 写的 HTML 会带着会话 cookie 运行。本地运行时，应用地址规范化为 `localhost`，预览由 `127.0.0.1` 提供。cookie 按主机名隔离、忽略端口，所以这两个主机拥有各自独立的 cookie jar；换成第二个端口就做不到这一点。其他情况则使用 `PENGUIN_PREVIEW_ORIGIN`。两者都没有时（通配或非回环绑定，或变量未设置），重定向回退到前文所述的同源沙盒，同时 `GET /api/me` 上的 `previewIsolated` 报告 `false`，UI 得以提前告知用户。
- 应用内渲染用同一个 URL：**文件浏览**面板把重定向 URL 嵌入 iframe，沙盒标志为 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`。这里的 `allow-same-origin` 授予的是预览源的身份，不是应用的，所以这套配置仍然严格比新标签页收紧——新标签页没有沙盒。没有独立预览源时，面板回退到内联 `srcdoc` 渲染（只给 `allow-scripts`，外加一个内存版 storage 垫片），相对子资源无法加载。部分浏览器会对跨站 iframe 内的存储做分区或阻止，所以同一个页面在面板里的行为可能与顶层标签页略有差异。
- 预览主机只服务 `/preview/*`。它与应用是同一个进程，所以对 `/api` 返回 `401`，把其余所有路由以 `302` 重定向到规范的应用主机。因此，预览主机从不设置、也不接受会话 cookie，那里的 Agent HTML 无法从同一源访问 API。部署了 `PENGUIN_PREVIEW_ORIGIN` 时，反向代理必须执行同样的约束：只把 `/preview/*` 路由到这个源上的应用。
- token 放在路径里，而不是查询参数里，这样页面的相对子资源（`app.js`、`style.css`、图片）相对文档解析，并在同一个 token 下加载。
- token 绑定 Session、预览主机和过期时间。主机绑定很关键：同一个进程也在应用源上应答，所以 `/preview/...` 拒绝在那个源上服务，否则会构成同源 XSS。访问是只读的，限于这个 Session 的 Workspace；服务器会重新解析路径，对 `..` 和符号链接逃逸的拒绝方式与任何读取相同。
- 响应带 `Referrer-Policy: no-referrer`。否则 URL 连同其中的 token 会通过 `Referer` 泄露给页面嵌入的每一个第三方——正因为嵌入如今可以工作，这个风险才随之而来。
- 无效 token、过期 token、错误主机和越界路径一律返回裸 404：这个端点不经认证，绝不能确认任何路径是否存在。

### Trace

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/traces` | 列出当前 Session 的 Trace 文件 |
| GET | `/traces/:index` | 读取 Trace 事件（分页） |
| GET | `/traces/:index/analysis` | Trace 性能分析 |

## 消息渠道绑定（飞书、Telegram、QQ、微信）

Session 可以连接消息机器人。目前支持的渠道是飞书、Telegram、QQ 和微信，路由都在 `/messaging/<channel>` 下。与 Session 级别的表格一样，下面的路径省略了 `/api/sessions/:sessionId` 前缀。

- 每个 Session 对每个渠道最多保存一份配置，多个渠道的配置可以并存。同一时刻最多启用其中一个，启用的那个渠道持有活跃连接。
- 启用会把机器人账号绑定到 Session，停用则解除绑定。因此，同一个应用或机器人可以保存到任意多个 Session 上；只有启用是独占的。
- 保存和连接是两回事：PUT 只存储凭据，连接由 `state` 路由负责。新配置默认停用，服务器启动时只连接已启用的配置。
- 发到机器人的消息会变成普通用户输入，在 Session 上启动 Task，和在 Web App 输入框里打字完全一样：不添加任何标记，Session 忙碌时排入后续消息队列。回复完成后会转发回聊天，按块发送，每块最多 4000 字符，低于 Telegram 4096 字符的硬性上限。
- 飞书通过 SDK 的 WebSocket 长连接监听消息，Telegram 长轮询 `getUpdates`，QQ 以 `GROUP_AND_C2C_EVENT` intent 持有平台的 WebSocket 网关，微信长轮询 `ilink/bot/getupdates`。这些渠道都不需要公网回调 URL。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/messaging` | Session 已保存的全部渠道配置 |
| GET | `/messaging/feishu` | 飞书配置，格式为 `{binding, status}`（未保存时为 `null`） |
| PUT | `/messaging/feishu` | 保存飞书凭据：`{appId, appSecret?, baseDomain?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/feishu/state` | 打开或关闭连接：`{enabled}` |
| DELETE | `/messaging/feishu` | 完全删除飞书配置，包括 App Secret |
| POST | `/messaging/feishu/test` | 测试凭据：→ `{ok, latencyMs?, error?}` |
| POST | `/messaging/feishu/test-message` | 向最近已知的聊天发送一段简短的固定文本 |
| GET | `/messaging/telegram` | Telegram 配置，格式同上（`botId`、`botTokenMasked`） |
| PUT | `/messaging/telegram` | 保存 Telegram 凭据：`{botToken?, clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/telegram/state` | 打开或关闭连接：`{enabled}` |
| DELETE | `/messaging/telegram` | 完全删除 Telegram 配置，包括 Bot Token |
| POST | `/messaging/telegram/test` | 用 `getMe` 测试 Token：→ `{ok, latencyMs?, botUsername?, groupPrivacy?, error?}` |
| POST | `/messaging/telegram/test-message` | 向最近已知的聊天发送一段简短的固定文本 |
| GET | `/messaging/qq` | QQ 配置，格式同上（`appId`、`appSecretMasked`） |
| PUT | `/messaging/qq` | 保存 QQ 凭据对：`{appId, appSecret?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/qq/state` | 打开或关闭连接：`{enabled}` |
| DELETE | `/messaging/qq` | 完全删除 QQ 配置，包括 App Secret |
| POST | `/messaging/qq/test` | 通过换取 app-access-token 测试凭据：→ `{ok, latencyMs?, error?}` |
| POST | `/messaging/qq/scan` | 发起扫码绑定：→ `{taskId, qrUrl, pollMs}` |
| POST | `/messaging/qq/scan/poll` | 轮询扫码任务：`{taskId}` → `{status, appId?, binding?}` |
| POST | `/messaging/qq/scan/cancel` | 丢弃扫码任务：`{taskId}` |
| POST | `/messaging/qq/test-message` | 向最近已知的聊天发送一段简短的固定文本 |
| GET | `/messaging/wechat` | 微信配置，格式同上（`botId`、`botTokenMasked`） |
| PUT | `/messaging/wechat` | 只保存投递偏好：`{clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}` |
| POST | `/messaging/wechat/state` | 打开或关闭连接：`{enabled}` |
| DELETE | `/messaging/wechat` | 完全删除微信配置，包括 bot token |
| POST | `/messaging/wechat/test` | 用 `ilink/bot/getconfig` 测试已存储的绑定：→ `{ok, latencyMs?, error?}` |
| POST | `/messaging/wechat/scan` | 发起扫码绑定，这是绑定微信的唯一方式：→ `{taskId, qrUrl, pollMs}` |
| POST | `/messaging/wechat/scan/poll` | 轮询扫码任务：`{taskId}` → `{status, botId?, binding?}` |
| POST | `/messaging/wechat/scan/verify` | 记录手机上展示的配对码：`{taskId, verifyCode}` → 204 |
| POST | `/messaging/wechat/scan/cancel` | 丢弃扫码任务：`{taskId}` |
| POST | `/messaging/wechat/test-message` | 向最近已知的聊天发送一段简短的固定文本 |

### 配置与权限

- `GET /messaging` 是与渠道无关的读取接口，绑定编辑器加载的就是它。每行包含 `channel` 判别字段、掩码后的密钥、`enabled` 的期望值、`linePerMessage`、`finalReplyOnly`、`renderMarkdown`、运行时状态和 `lastChatKnown`。
- 没有存储密钥时（即已清除的配置），响应里省略掩码密钥；没有密钥的配置无法启用。密钥永远不会回传给客户端。
- 读取接口和两个测试路由对任何 Project 成员开放。PUT、`state` 开关和 DELETE 仅限所有者，语义与 vault 相同，因为这些写操作携带密钥或作用于密钥。所有扫码路由同样仅限所有者（见[扫码绑定](#扫码绑定)）。
- DELETE 会完全删除一个渠道的配置，不影响其他渠道。这个路由只是为了 API 完整性而保留；Web App 实际用清除标志来移除密钥。删除 Session 会删除它的全部配置。
- 跨 Session 只有唯一一条规则，按渠道内的机器人账号计算，而且只约束连接：一个账号只有一条事件流，因此最多只能有一个 Session 启用它。飞书按 `app_id` 识别账号，Telegram 按 Token 冒号前的数字 bot id（换发 Token 后依然不变），QQ 按 App ID，微信按扫码返回的 bot id。

### 保存与连接

- PUT 省略密钥或密钥为空白时，保留已存储的密钥。清除标志（`clearAppSecret` 或 `clearBotToken`）会删除已存储的密钥，但同一请求里输入的新密钥优先。渠道处于启用状态时执行清除，会返回 409 `messaging_disable_before_clear`。清除后的配置仍保留这条记录和非密钥字段，包括 Telegram 或微信机器人的身份标识。
- PUT 不影响连接，只有一个例外：绑定为启用状态时，连接器会用新凭据重启，因此已存储的配置和活跃连接永远不会出现偏差。也正因为如此，保存操作不会在 Session 之间产生冲突，除非它把一个已启用的绑定指向了另一个 Session 已启用的账号。这种情况返回 409 `account_enabled_elsewhere`——否则重启会让这个账号出现第二条活跃连接，等于绕过了启用检查。
- `POST …/state` 传入 `{enabled: true}` 时用已存储的凭据建立连接，传入 `{enabled: false}` 时断开。本 Session 的另一个渠道处于启用状态时，返回 409 `another_channel_enabled`；另一个 Session 已启用同一账号时，返回 409 `account_enabled_elsewhere`。两种情况的含义相同：先把那一个停用。第二种错误不会透露占用者是谁，对方可能位于调用者看不到的 Project 里。没有已存储的密钥时，开关操作返回 400 `feishu_secret_required`、`telegram_token_required`、`qq_secret_required` 或 `wechat_token_required`。
- 飞书、Telegram 和 QQ 的 test 路由用请求中的草稿值探测，缺少的值回退到已存储的配置；微信的 test 不接受请求体（见下文）。凭据未通过验证时返回 `ok: false`，而不是 HTTP 错误。
- test-message 路由在有人在对应应用里给机器人发过消息之前，返回 409 `feishu_no_chat`、`telegram_no_chat`、`qq_no_chat` 或 `wechat_no_chat`。

### 各渠道细节

- 飞书：`baseDomain` 默认为 `https://open.feishu.cn`。
- Telegram：凭据就是 @BotFather 签发的那一个 `<bot id>:<secret>` 格式的 Token。解析不出数字 id 的 Token 返回 400 `telegram_token_invalid`。测试成功时会给出 Token 登录的机器人名（`botUsername`），并在 @BotFather 的 Group Privacy 开启时报告 `groupPrivacy: true`，这个选项默认开启。Group Privacy 开启时，机器人收不到自己不担任管理员的群里的普通消息。
- QQ：凭据是 QQ 开放平台开发设置中的 App ID 和 App Secret。没有域名字段，因为 API v2 只有一个主机。测试不报告账号名，因为平台没有能识别机器人的调用。没有最近的 QQ 消息可回复时，test-message 还会返回 502 `qq_send_failed`；见 [QQ](#qq)。
- 微信：微信的 PUT 是唯一不含凭据的。微信 bot token 只存在于扫码写入的地方，也没有控制台可供复制，因此 PUT 要求已存在绑定，绑定存在之前返回 400 `wechat_token_required`。清除后的微信配置只有重新扫码才能再次连接。test 路由是唯一不接受请求体的：这个渠道没有任何手动输入的内容，已存储的绑定就是全部可探测的对象（没有绑定时返回 400 `wechat_token_required`）。测试既不给出机器人名，也不给出扫码者信息。

### QQ

QQ 是只能回复的渠道，这一点改变了投递的含义。平台没有本产品可用的推送：每条出站消息都是被动回复，必须携带一条入站消息的 `msg_id`，有效期只有几分钟，而且每条消息在单聊中最多回复 4 条（群聊 5 条）。这个 API 上能看到三个后果：

- 一次运行完成的助手消息超过回复额度时，消息会合并：前 `budget - 1` 条一完成就发出，其余的一起并入最后一条消息，不会丢掉任何一条。
- `linePerMessage` 受这个额度而不是通常每条回复 20 条上限的约束；平台拒绝 `renderMarkdown` 发送时，纯文本重试会占用第二条回复。`finalReplyOnly` 在这里有利有弊。它让一次运行只消耗最少的额度——一条回复；但被动回复的窗口只有几分钟。把回复留到运行结束才发，窗口就消耗在运行上：运行时间一旦超过窗口，什么都发不出去，而逐条转发至少能把窗口内完成的消息发出去。
- 没有可回复对象的发送不会推送出去，而是直接拒绝——比如在 Web App 里发起的一轮对话，或窗口关闭后的任何回复。这种情况在 test 端点上表现为 502 `qq_send_failed`，在转发的回复上表现为一条 `messaging_send_failed` 错误记录。

在 QQ 上，出站文件一律拒收，因为平台的富媒体路径要求文件有一个公网可达的 URL。

### 微信

微信只承载单聊，但它是四个渠道中媒体支持最多的一种。这个 bot 渠道完全没有群聊入站：群里发给机器人的消息永远到不了这个 API，所以在单聊中正常的绑定在群里保持沉默，这是设计使然，不是配置错误。

换来的是，它是这里唯一支持文本、图片、文件双向传输的渠道。回复中的图片和附件会上传到平台 CDN（AES-128-ECB 加密，每个文件一把密钥），以真正的图片和文件送达，而非遭到拒收。两类入站消息会经过转换：语音消息到达时是微信自己的转写文本，视频到达时是一个文件。平台无法转写的录音会在聊天中收到统一的「不支持」提示。

### 扫码绑定

扫码绑定从不把密钥暴露给浏览器。保证流程安全的一切都留在服务器上：解密 QQ App Secret 的 AES 密钥，以及收集微信 bot token 的平台轮询句柄。生成、保管、使用和销毁这些内容都是服务器的事，客户端只会拿到任务句柄、一个待渲染的 URL 和一个状态。

- `POST …/scan` 返回 `{taskId, qrUrl, pollMs}`。把 `qrUrl` 渲染成二维码：由 QQ 或微信 App 打开它，任何一方都不需要去请求这个 URL。对微信来说，`taskId` 是本服务器自己生成的一个句柄，代替平台的轮询句柄。渠道的连接处于启用状态时，scan 返回 409 `messaging_disable_before_scan`，因为扫码会整体替换活跃连接器使用的全部凭据。平台拒绝时，scan 返回 502 `qq_scan_failed` 或 `wechat_scan_failed`。
- QQ 的 `scan/poll` 状态为 `completed` 表示服务器已解密 App Secret 并保存了绑定；`expired` 表示重新发起一个任务。
- 微信的 `scan/poll` 状态是 `pending`、`scanned`、`need_verify_code`、`blocked`、`expired`、`already_bound`、`completed` 之一。`completed` 表示服务器已保存绑定。`already_bound` 不算失败：机器人已经绑定过，没有签发任何新东西。它不会说明绑定在哪里——扫码不会给出 Token 列表，因此无法区分绑定是在本服务器上还是在别处。
- 两个渠道都一样：保存绑定并不会启用它；启用仍是单独的一步。
- `scan/verify` 记录微信在手机上展示的配对码。平台把配对码当作状态调用的参数，因此配对码随下一次轮询捎带发送，而不是单独发一次请求。配对码错误时，下一次轮询会再次报告 `need_verify_code`。
- `scan/cancel` 丢弃用户中途放弃的扫码任务，对应的密钥或句柄立即从内存中丢弃，而不是等到下次清理。
- 扫码任务保存在内存中，属于发起它们的 Session。每个 Session 有自己的数量上限，一个调用者的扫码任务不会把另一个调用者的挤出去。拿到最终结果的那个轮询会认领任务，因此重放这个轮询会返回 404（`qq_scan_task_unknown` 或 `wechat_scan_task_unknown`；未知任务或其他 Session 的任务也返回同样的错误），而不是重复绑定。同一任务的第二个并发轮询在 QQ 上同样返回 404，在微信上则返回 `pending`，因为微信一侧的上游调用是长轮询，会跨越多个客户端轮询间隔。

所有扫码路由仅限所有者调用，因为无论调用者实际输入多少，整个流程最终都会落成一条存储的凭据。

### 投递设置

`linePerMessage`、`finalReplyOnly` 和 `renderMarkdown` 是三个与凭据无关的保存字段。PUT 时省略的字段保留已存储的值。这三个字段对通知和测试消息都不生效；特别是审批提醒，它不是回复，无论 `finalReplyOnly` 取什么值都会立即送达。

- `linePerMessage`（默认 false）把转发的助手回复里每个非空行单独发成一条消息。空行直接丢弃，每行超出大小上限时仍会拆分，超过每条回复 20 条消息的上限后，剩余的行合并成最后一条消息。消息之间间隔 1 秒发出。
- `finalReplyOnly`（默认 false）只在运行结束时转发这次运行最后一条完成的助手消息，而不是每完成一条就转发一条。运行在工具调用之间写下的工作笔记只保留在 Web App 中。此后跟随回复的文件也只从这条最终消息里读取，因为聊天收到的文本只有这一条。两个设置同时开启时，按行拆分的是最终回复。
- `renderMarkdown`（默认 true）用渠道自己的标记格式渲染转发回复中的 Markdown，而不是原样发送字符。分块遵循这个设置：在块边界切分，跨消息的代码块会重新打开，因此任何一条消息都不会开启自己不闭合的结构。渠道拒绝带格式的发送时，同一条消息会以纯文本再次发送，所以这个设置最多损失格式，绝不会损失回复。

每个渠道渲染自己支持的部分，其余刻意降级，而不是显示 Markdown 源码：

| 渠道 | 回复的渲染方式 |
| --- | --- |
| Telegram | `parse_mode: "HTML"`。没有标题、列表和表格：标题变成一行加粗文本，列表符号保留为字面文本，表格变成 `<pre>` 块 |
| 飞书 | 交互卡片，承载 JSON 2.0 富文本组件，能渲染全部内容。过长的表格转成代码块，不会悄悄丢掉任何一行 |
| QQ | `msg_type: 2` markdown。没有代码格式，也没有表格：围栏代码块变成逐行转义的普通文本，表格变成逐行文本 |
| 微信 | 微信自己解析 Markdown，所以渲染是做减法而不是转换：客户端不会显示的内容保留文字、去掉标记（层级深于四级的标题、CJK 文本两侧的强调标记，以及内联图片，后者变成链接） |

### 入站消息

入站消息可以携带文本、图片和文件。

- 图片会变成普通的 `image_url` 输入部分。每张图片受服务器内联图片上限的约束，每个绑定还有一个滚动的图片字节预算：每 10 分钟 40MB，即内联图片上限的两倍。设这个预算是因为内联图片会原样写入 Trace，而这条路径与输入框不同，前面没有身份验证把关。
- 文件采用输入框的另一种附件形态：先写入 Session scratchpad，再以 `[attached file: <path>]` 一行的形式交给模型，因此文件字节不会进入对话。它与经过身份验证的上传一样，受管理员可配置的单文件、单消息上限约束；渠道自身若有更严格的限制，则以更严者为准：Telegram 不向机器人提供超过 20MB 的文件。
- 飞书投递以 `file` 消息类型发送的文件；Telegram 投递 `document` 字段里的文件，也就是发送者选择以文件形式发送的内容——这也是唯一携带发送者原始文件名的 Telegram 媒体字段。
- 在飞书和 Telegram 上，视频、音频和语音刻意不投递：下游没有任何环节会解码或转写它们；发送者想让 Agent 拿到的内容，附成文件即可送达。微信是例外，只是因为平台自己做了这些处理（见[微信](#微信)）。
- 附件会投递的消息（照片或文档），说明文字就是这条消息的文本。其他类型媒体上的说明文字则不然：媒体根本不会到达，只凭说明文字运行模型，会让它谈论一个从未收到过的文件。
- 超过单图上限的图片、超出预算的图片和渠道拒收的图片，各有一条不同的双语提示；超过上限的文件、超过单消息总量的批次和渠道拒收的文件也是如此。任何一种情况都不会发出半条消息。如果拒绝是机器人自身权限导致的，提示会写明需要授予的权限范围，并附上渠道控制台的链接。在飞书上这是常见情况，因为接收消息和下载附件是两个不同的权限范围。
- 其余所有消息类型都会收到双语「不支持」回复。

### 出站文件

运行结束后，回复后面会跟着回复提到、且由运行产出的文件：回复中任意位置出现、形如路径的片段，只要解析后落在 Workspace 内、文件确实存在、且写入时间不早于运行开始，就会随回复发出。「提及」挑出哪个产物才是重点。写入时间条件防止回复变成读取文件的手段——聊天里的任何人都能引导回复，而一条拒绝粘贴文件的回复照样会提到文件名。

- 图片以图片形式发送，其余以附件形式发送；分类依据是实际读取的文件，而不是回复里写的名字。
- 一次运行最多发送 5 个文件：每张图片最多 10MB，每个文件最多 30MB（取各渠道自身限制中更严的一个）。
- 提及的文件未能送达时一律不在聊天中报告，而是作为异常记录挂在这个 Project 下，由成本中心的异常表展示：同一次回复里每个原因一条记录，写明它覆盖的每个文件、渠道和原因。
  - `messaging_file_too_large` 覆盖超过大小上限的文件，`messaging_files_skipped` 覆盖超过数量上限的那些。两者都属于 `expected`。
  - `messaging_file_send_failed` 覆盖渠道拒绝的上传，按原因分组：渠道根本承载不了的上传（QQ 上的任何文件）、缺少权限，以及其他任何拒绝。缺少权限的那条只列一次要授予的权限范围和控制台链接，取代每个文件各自的原因。渠道根本承载不了的上传属于 `expected`；缺少权限和其他任何拒绝属于 `unexpected`。
  - Workspace 中对不上文件的名字，以及运行没有写过的文件，静默跳过、只写服务端日志，因为回复提到自己读过或只是描述过的文件是常态。

### 连接状态

Telegram 连接时会先清空积压，跳过无连接期间发送的消息。这一点与飞书一致：飞书错过的事件就彻底丢失了。

除了状态本身，绑定的运行时状态还会报告活跃连接实际看到的情况：

- `lastInboundAt`：最后一条消息到达的时间；本次连接建立后还没有消息到达时，这个字段不存在。
- `lastDeliveryError`：`{at, stage, detail}`。`stage` 为 `inbound` 表示消息到达了但对应的 Task 从未启动，为 `send` 表示回复从未到达聊天。之后的成功不会清除这个字段。
- `lastConnectionError`：`{at, detail}`，记录最近一次连接失败，连接恢复后仍保留。相比之下，`lastError` 属于 `error` 状态，状态一离开它就消失。

这三个字段都保存在服务器进程中，每次连接或重连都会重置；重新启用渠道或保存凭据都会开启新连接。因此 `lastInboundAt` 缺失意味着「本次连接建立以来没有消息」，绝不是「从来没有过消息」。提供这些字段，是因为一个扣着消息不投递的渠道，照样显示 `connected`，而且没有任何报错。

## 终端

服务器主机上的交互式 shell。Web App 的终端使用这些路由，任何需要运行命令并读取屏幕的客户端也可以使用。每个终端属于打开它的用户，其余路由只能找到调用者自己的终端。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/terminals` | 列出调用者的终端：`{terminals}` |
| POST | `/api/terminals` | 打开一个终端：`{cwd?, name?, shell?, cols?, rows?}` → 201，返回终端信息 |
| GET | `/api/terminals/:id` | 单个终端的信息 |
| DELETE | `/api/terminals/:id` | 终止终端；204 |
| GET | `/api/terminals/:id/capture?start=&end=` | 以纯文本返回屏幕内容 |
| POST | `/api/terminals/:id/keys` | 发送输入：`{keys, literal?}` → `{ok: true}` |

- `cwd` 默认为用户主目录，`shell` 默认为用户的登录 shell。
- `keys` 是字面文本或按键名：`Enter`、`Tab`、`Escape`、`Backspace`、`Space`、`Up`、`Down`、`Left`、`Right`、`Home`、`End`、`PageUp`、`PageDown`、`Delete`，或 `C-c` 这样的组合键。设置 `literal: true` 时，文本按原样发送。shell 已退出的终端返回 `409` `terminal_exited`。
- 字节流不走这些路由：它是一个 WebSocket，地址为 `GET /api/terminals/:id/stream`（一个 Upgrade 请求）。
- 缺少有效会话或 token 的请求返回 `401` `unauthorized`。

## 桌面 shell、热更新与 Web 贡献

这组路由服务于桌面 shell、热更新和 Web App 自己的模块系统，而不是一般客户端。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/desktop/shutdown` | 应桌面 shell 的请求优雅关闭服务器；202 |
| GET | `/api/desktop/update` | 桌面应用更新器的状态：`{status}` |
| POST | `/api/desktop/update/check`、`/api/desktop/update/download`、`/api/desktop/update/install` | 把命令转发给桌面 shell；202 |
| GET / PUT | `/api/desktop/tray` | 读取系统托盘图标偏好：`{status}` / 转发更改：`{showTrayIcon?, locale?}` → 202 |
| POST | `/api/hmr/assets/probe` | 热更新：报告存储缺少哪些 blob |
| PUT | `/api/hmr/blobs/:sha` | 热更新：按 sha256 上传一个 blob |
| POST | `/api/hmr/upgrade` | 热更新：把 platform、CLI 和 web bundle 一并升到新版本 |
| GET | `/api/contributions` | 以数据形式返回服务器模块和插件贡献给 Web App 的页面和标签页 |

- 非桌面模式下，桌面路由返回 `404` `not_found`。
- `POST /api/desktop/shutdown` 不使用 cookie 会话。它用桌面 shell 专有的 Bearer token 认证（否则返回 `401` `unauthorized`），先应答，再立即开始优雅关闭。
- update 和 tray 路由只响应桌面 shell 自己的窗口：其他任何会话都会得到 `403` `desktop_shell_only`。shell 未监听时，返回 `503` `shell_unreachable`。`showTrayIcon` 不是布尔值时，`PUT /api/desktop/tray` 返回 `400` `invalid_show_tray_icon`；`locale` 不是 `zh` 或 `en` 时返回 `400` `invalid_locale`；两个字段都未提供时返回 `400` `empty_tray_patch`。PUT 只确认收到更改；请用 GET 读回实际结果。
- `/api/hmr` 路由仅限管理员（`403` `forbidden`）。绑定在非环回地址上时还要求 HTTPS，否则返回 `403` `hmr_disabled`。只有 `PENGUIN_TRUST_PROXY=1` 时 `X-Forwarded-Proto` 才生效。升级完成后，每个已连接的客户端都会收到 `web_updated` 并重新加载。

## 流式传输（SSE）

实时投递使用 Server-Sent Events 而不是 WebSocket，分为两类通道。通道所载内容的顺序语义见[消息流与顺序](/message-flow)。

| 通道 | 路径 | 内容 |
| --- | --- | --- |
| 每个 Session | `GET /api/sessions/:sessionId/stream` | Session 的消息流和运行事件，包括子 Agent Session 的 `session_created` 以及目标模式事件 |
| 每个用户 | `GET /api/events` | `hello` 握手和跨 Session 的通知：`session_created`、`session_state`、`session_background`、`session_title`、`schedule_fired`、`schedule_queued`、`web_updated` 以及公司模式的 `org_*` 事件 |

### 传输格式

默认（未命名）的 SSE 事件以单行 JSON 携带原始 OmniMessage 信封：SDK 产出、Trace 存储的就是这个协议（见 [OmniMessage 协议](/omni-message)）。名为 `server_event` 的事件携带 `ServerEvent` 联合类型：

```ts
export type ServerEvent =
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  | {
      type: "task_state";
      state: "idle" | "running" | "compacting";
      queued?: number;
      pendingSteering?: PendingSteeringInfo[];
      returnedSteering?: PendingSteeringInfo[];
      pendingFollowUps?: PendingFollowUpInfo[];
      subagents?: SubagentRuntimeInfo[];
    }
  | { type: "session_title"; sessionId: string; title: string }
  | { type: "session_state"; sessionId: string; state: "idle" | "running" | "compacting"; lastActiveAt: string; hasTrace: boolean }
  | { type: "session_background"; sessionId: string; processes: number; subagents: number }
  | { type: "resync_required" }
  | { type: "credentials_updated" }
  | { type: "hello" }
  | { type: "web_updated"; rev: string }
  | { type: "session_created"; projectId: string; agentId: string; sessionId: string; source?: SessionSource }
  | { type: "schedule_fired"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "schedule_queued"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "goal_started"; sessionId: string; objective: string; budget: number }
  | { type: "goal_round"; sessionId: string; round: number; used: number; budget: number }
  | { type: "goal_finished"; sessionId: string; outcome: "complete" | "blocked" | "budget_limited" | "aborted"; rounds: number; used: number }
  | { type: "org_run"; projectId: string; orgId: string; agentId: string; sessionId: string; kind: OrgTriggerKind }
  | { type: "org_channel"; projectId: string; orgId: string; channelId: string; message: OrgChannelMessage }
  | { type: "org_ticket"; projectId: string; orgId: string; ticketId: string; change: string }
  | { type: "org_budget"; projectId: string; orgId: string; agentId: string; state: "warned" | "paused" | "resumed"; ratio: number };
```

| 事件 | 触发时机 |
| --- | --- |
| `approval_request` | 工具调用需要人工审批 |
| `task_state` | Session 的运行状态变化（`idle` / `running` / `compacting`） |
| `session_title` | 第一轮对话后，模型生成的标题已保存 |
| `session_state` | Session 的运行状态变化；`task_state` 在用户通道上的对应事件 |
| `session_background` | Session 的后台任务计数变化 |
| `resync_required` | `Last-Event-ID` 已被挤出缓冲区；客户端必须重新拉取历史 |
| `credentials_updated` | Project 的模型凭据发生变化 |
| `hello` | 用户通道上的握手 |
| `web_updated` | 热更新替换了对外提供的 web 资源；客户端需重新加载 |
| `session_created` | 一个 Session 现在存在了：由 Web App、CLI、定时任务或 Agent 派生子 Session 创建 |
| `schedule_fired` | 定时任务已触发，Prompt 已投递 |
| `schedule_queued` | 目标 Session 正在运行，这次触发已排队 |
| `goal_started` | 目标运行开始，在第一轮之前 |
| `goal_round` | 一轮目标运行即将开始 |
| `goal_finished` | 目标达到终止状态 |
| `org_run` | 组织的工作运行（工位会话）或工单会话已启动 |
| `org_channel` | 频道里有新消息 |
| `org_ticket` | 工单的状态、负责人、阻塞状态或贡献会话发生变化 |
| `org_budget` | 员工的预算进入警告、暂停或恢复状态 |

- `approval_request` 覆盖 `always-ask` 模式下的每个调用，以及 `read-only` 模式下带 `rw` 或未知权限的调用。待处理的审批会在重连时重新发送。
- `task_state` 还携带排队的后续消息数量（`queued`）、仍在等待投递的插话消息（`pendingSteering`）、运行结束时没能投递的插话消息（`returnedSteering`）、排队的后续消息本身（`pendingFollowUps`）以及活跃的子 Agent（`subagents`）。字段缺失表示没有。
- `session_title` 发送到 Session 的通道，以及 Project 所有者和成员的用户通道。
- `session_state` 用 `sessionId` 指明是哪个 Session，因此 Session 列表的每一行都能保持实时，而不只是客户端当前打开的那个会话。事件携带重绘这一行所需的字段，无需重新拉取：刚写入的 `lastActiveAt`，以及 `hasTrace`。状态为 `running` 或 `compacting` 时 `hasTrace` 必为 true，因为正在运行的 Session 必然已经启动过 Task。它发送到 Project 所有者和成员的用户通道。
- 以下情况会触发 `session_background`：命令超过让出窗口转入后台，或以 `run_in_background` 启动；进程退出或停止；后台子 Agent 开始一轮、结束一轮或释放。事件携带 `SessionInfo.backgroundTasks` 的当前值（`processes` = 仍在运行的后台命令会话数，`subagents` = 已转入后台、正处于一轮中的子 Agent Session 数），归零时同样发送，列表无需重新拉取就能撤下标记。两个计数都为零时，列表行和单个 Session 的 GET 会省略这个字段。受众与 `session_state` 相同。
- `credentials_updated` 在 `PUT /models` 或签发 API key 的流程完成之后发送。缓存的运行时已失效，客户端应清除因认证失败而禁用的输入框状态。
- `web_updated` 以 `rev` 携带新的 web 修订号，发送到每个用户通道。
- `session_created` 在每次创建时发送到 Project 所有者和成员的用户通道；子 Agent Session 还会同时发送到父 Session 的通道。用户创建的 Session 没有 `source`，与行上一致。通过 `PATCH /api/sessions/:id` 设置的标题以同样方式作为 `session_title` 宣告。
- `schedule_fired` 的 `sessionId` 是接收 Prompt 的 Session，在新建 Session 模式下是一个新 Session。排队的触发会在 Session 空闲后发送。
- `goal_round` 携带 `used`，即目前累计的 Token 数。
- `org_*` 事件发送到 Project 成员的用户通道。`org_channel` 包含消息里的提及信息，客户端可据此判断消息是否指向自己。这些事件是尽力而为的；持久状态以组织路由为准。

### 投递保证

- 事件 id 在每个通道内单调递增，格式为 `<epoch>-<seq>`。
- 每个通道保留一个有界的重放缓冲区：最近 10,000 个事件或 8MB。
- 携带 `Last-Event-ID` 重连时，如果 id 仍在缓冲区内，服务器会重放缺失的事件；否则先发送 `resync_required`，客户端重新拉取 `/messages` 后再继续。
- 每 20 秒写入一行心跳注释。
- 事件顺序：携带 `Last-Event-ID` 重连时，先到达重放的缺失部分（或 `resync_required`），然后是初始事件（权威的 `task_state` 快照和所有仍待处理的 `approval_request`），最后是实时流。不带 `Last-Event-ID` 的新连接跳过重放，第一个事件就是 `task_state` 快照。

### 推荐的客户端模式

内置的 Web App 按以下顺序连接：

1. 先连接 `/stream`，把收到的事件缓存起来。
2. 用 GET 请求 `/messages` 获取历史。
3. 如果响应带有 `live`（有 Task 正在运行），丢弃缓存中游标已覆盖的 partial 事件，把 `live.fragments` 应用在历史之上。进行中的消息会重新出现，已流式输出的前缀原样保留。
4. 重放缓存的事件，去掉重叠部分。
5. 之后继续处理实时流。

## 类型导入

所有 DTO 类型都能以仅类型导入的方式，从服务器包的 `@prismshadow/penguin-server/api` 子路径引入：

```ts
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
```
