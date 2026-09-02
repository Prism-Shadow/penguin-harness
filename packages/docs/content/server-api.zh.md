---
title: Server API
description: HTTP API 参考：认证机制、路由列表、SSE 流式协议与 DTO 类型导入。
---

PenguinHarness Server 提供一套同源 HTTP API，自带的 Web App 与其他 HTTP 客户端都通过它访问。本文是接口参考：认证机制、路由列表与 SSE 流式协议。服务启动方式见[快速开始](/quickstart)。

## 总览

- 技术栈：Hono + @hono/node-server，要求 Node >= 24；
- 存储：SQLite（内置 `node:sqlite`，WAL 模式）仅存放索引与聚合数据——用户、登录会话、Project 授权、Agent / Session 索引、用量、UI 偏好、错误记录与 Schedule 状态；Agent、Trace 与 Workspace 数据全部以文件形式存放在 `~/.penguin/data` 下，与 CLI / SDK 共享，见[配置参考](/configuration)；
- 监听：默认 `127.0.0.1:7364`，可用环境变量 `PORT` / `HOST` 调整；
- 请求体：写请求仅接受 JSON（Content-Type 校验，CSRF 防线之一），其上限**由附件预算推导**而非固定值——附件以 base64 `data:` URL 随请求送达（膨胀 4/3），故上限为 `base64(attachmentTotalMb) + 一张内嵌图片与 JSON 外壳的余量`，在默认 120MB 合计下约 190MB，管理员调低附件上限时随之回落。按读取到的字节数统计，未声明长度（分块传输）的请求同样受限；
- 错误响应统一为：

```text
{ "error": { "code": "<机器可读错误码>", "message": "<提示文案>" } }
```

## 目录结构

```text
packages/server/src
├── index.ts / config.ts / app.ts   # 启动入口 · 环境变量配置 · Hono 组装(createApp 不绑端口,便于测试)
├── api/types.ts                    # 对外 DTO 契约(经 "./api" 子路径供前端 type-only 引用)
├── auth/                           # scrypt 密码、admin 种子、cookie 会话、认证中间件
├── db/                             # node:sqlite 连接、建表 SQL、每表一个 repo
├── http/                           # 错误体、请求校验、SSE 适配、routes/ 全部路由
├── runtime/                        # session-manager(运行时驱动)· channel(SSE 环形缓冲)
│                                   # approvals · usage-recorder · scheduler · title-generator
└── services/                       # 授权规则、TOML/YAML 配置读写、Session/Trace/用量/快照服务
```

## 认证

- Cookie 会话：`penguin_session`（HttpOnly、SameSite=Lax），有效期 30 天，滑动续期；
- 密码以 scrypt 哈希存储；会话是 `auth_sessions` 表中的一行，以随机 Cookie 令牌的 sha256 为键（原始令牌从不落库）；它跨重启存活、原地续期，logout 删除该行；
- 不开放注册：启动时种子化内置管理员 `admin`，其初始密码随机生成、哈希后即丢弃，无人见过。在真正设置密码之前，每次启动都会打印一条首次登录链接用于认领账号（自动化场景可用 `PENGUIN_SEED_ADMIN_PASSWORD` 固定一个已知密码）。其余账号由管理员创建；
- 仅限同源访问，未启用 CORS 中间件。

```bash
# 密码用认领账号（首次登录链接）时设置的那个。
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"<你的密码>"}' \
  http://localhost:7364/api/auth/login
```

### 本机 API token（Bearer）

所有受保护路由同时接受携带**本机 API token** 的 `Authorization: Bearer <token>`——这是 CLI（以及经 CLI 驱动 harness 的 Agent）用来替代登录的本机凭据：

- 服务端每次启动铸造新 token 并写入 `<root>/api-token`（仅属主可读，`0600`）；新 token 铸造的那一刻，上一次启动的 token 即失效。
- 有效的 Bearer 即以内置 `admin` 身份通过认证。这个等价关系是授权模型本身，不是疏漏：对数据根目录的本机文件系统访问本就等于管理员权限——能读 `api-token` 的人也能读旁边的 `web.db`，与 `penguin server reset-admin-password` 是同一条规则。
- 服务端驱动的会话把当前 token 以 `PENGUIN_API_TOKEN` 注入每个工具子进程（连同 `PENGUIN_API_URL`、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID`、`PENGUIN_SESSION_ID`），Agent 自己的 `penguin` / API 调用由此获得连回运行它的服务器的授权。
- SSE 端点与其它路由一样接受该请求头（用 `fetch` 消费，不要用 `EventSource`——后者无法携带请求头）。
- 写请求的 JSON-only Content-Type 检查对 Bearer 请求同样生效。

```bash
curl -H "Authorization: Bearer $(cat ~/.penguin/data/api-token)" \
  http://127.0.0.1:7364/api/me
```

## 路由参考

### 认证与账户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/login | 登录：`{userId, password}` → `{user}` |
| POST | /api/auth/logout | 退出登录，返回 204 |
| GET | /api/auth/claim?token=… | 兑换登录链接（首次登录链接，或桌面 shell 的一次性 token）：种下 Cookie 并跳转到 `/` |
| GET | /api/install | 公开：`{installId}`——标识当前所服务数据根的不透明 id（`<root>/install-id`），在该根首次被使用时铸造。Web App 将其与自己存下的值比较，不一致时清除浏览器侧那些引用服务端实体的 UI 状态，因此更换数据根后不会再留下旧的 Workspace、草稿与置顶。`null` 表示服务端无法确定该 id，此时客户端不应改动任何内容。 |
| GET | /api/me | 当前用户信息 |
| PUT | /api/me/password | 修改密码：`{oldPassword, newPassword}`；桌面会话与首次登录会话可省略 `oldPassword`——其当前密码是随机生成且从未展示过的 |
| GET | /api/me/prefs | 读取 UI 偏好 |
| PUT | /api/me/prefs | 写入 UI 偏好（浅合并） |

### 用户管理（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/users | 用户列表 |
| POST | /api/admin/users | 创建用户：`{userId, password}` |
| POST | /api/admin/users/:userId/password | 重置密码（该用户全部登录会话失效） |
| DELETE | /api/admin/users/:userId | 删除用户 |

桌面模式下（server 由桌面应用拉起）整组路由返回 `403`、错误码 `desktop_single_user`：桌面应用是单用户形态，用户管理整体停用——数据根中已有的用户不受影响。

### 服务端设置（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/settings | 服务端全局设置：`{settings: {proxyForApp, proxyForAgent, proxyUrl, attachmentMaxMb, attachmentTotalMb}}` |
| PUT | /api/admin/settings | 更新设置（字段可省略，省略即保持现值），返回更新后的完整设置 |

代理设置为两个独立开关共享一个可选的显式地址；修改即时生效（对新发起的连接与新派生的子进程），无需重启：

- `proxyForApp`（「应用程序使用代理」，默认开）治理服务端自身出网（LLM 请求、更新检查、图片抓取）：开且填写了 `proxyUrl` → http 与 https 流量都走该地址，**优先于代理环境变量**——无需配置任何环境变量；开但未填地址 → 遵循 HTTP_PROXY / HTTPS_PROXY / NO_PROXY 环境变量（大小写并存）；关 → 一律直连。
- `proxyForAgent`（「Agent 环境使用代理」，默认开）治理 Agent 命令子进程环境：开且填写了 `proxyUrl` → 注入 `HTTP_PROXY` / `HTTPS_PROXY`（含小写拼写）为该地址并附合并后的 NO_PROXY，覆盖继承值（`socks5://` 地址原样注入——各工具对这些变量中的 SOCKS URL 支持程度不一）；开但未填地址 → 宿主环境原样透传；关 → 剥除代理变量（NO_PROXY 保留）。
- `proxyUrl`（默认 null = 跟随环境变量）即两者共享的显式地址。PUT 校验：先 trim；空串或 null 即清除地址；接受 undici dispatcher 认可的代理 URL——`http://`、`https://` 与（undici 实验性支持的）`socks5://`/`socks://` 地址，允许携带凭据——以及裸 `主机[:端口]`（规范化为 `http://主机[:端口]`）；只存储规范化后的值，响应回显存储形态。其余（无法解析，或 undici 拒绝的协议如 `socks4://`）一律 `400`，错误码 `invalid_proxy_url`，且被拒绝的 PUT 不写入任何字段。

任一开启状态下生效的 NO_PROXY 恒包含 `localhost,127.0.0.1,::1`（回环不代理）。

上传限制是两个整数 MB，约束输入框的文件附件；二者均在下一次请求即生效、无需重启（校验与请求体上限都按请求读取）：

- `attachmentMaxMb`（默认 100）为单个附件上限，超出返回 `413` `file_too_large`。
- `attachmentTotalMb`（默认 120）为单条消息解码后的合计上限，超出返回 `413` `payload_too_large`。
- PUT 校验：两者都必须是 1 到 200 之间的整数，且**生效后**的合计值（本次 PUT 给出的值，或本次不修改时的存量值）不得低于生效后的单个上限。其余一律 `400`，错误码 `invalid_attachment_limit`，且被拒绝的 PUT 不写入任何字段。
- 不可配置项：单条消息的附件数量（20）与内嵌图片上限（20MB，超出返回 `413` `image_too_large`）。内嵌图片会写入轨迹，并在每次翻阅历史与恢复会话时被重新读取，因此刻意不随附件上限放宽；`GET /api/me` 会在 `uploadLimits` 下报告以上全部数值，客户端据此按当前生效的上限预先校验。

### 机器（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/machines | **服务端自身** `~/.ssh/config` 中的主机别名、本服务端会安装的版本，以及正在运行或最近一次的安装任务：`{machines: [{id, alias, installed}], imageVersion, job}` |
| POST | /api/machines/:machineId/install | 在该主机上安装当前构建；返回 `202` 与同样的响应体，此时任务已在运行 |

无论个人服务端还是多用户服务端都仅限管理员：安装会以**服务端账户**的密钥派生 ssh，并在另一台机器上写入程序目录——这是所有者的能力，而非访客的。ssh 配置只读不写，`ssh -G` 仅在真正安装时才解析别名，因此哪怕配置声明了几百台主机，列表也只是一次文件读取。

`imageVersion` 是将被推送的版本；为 `null` 表示本服务端根本没有安装镜像（只有从未被热推过的源码检出会是这种形态），此时任何安装都会以 `409` `no_install_image` 拒绝。该版本取自当前运行的安装自身：热推过的服务端推送它正在运行的 bundle（`0.0.0-hmr.<cli>.<web>`），tarball 或打包安装则推送自己的程序树，因此两端的一致是构造性的。

`installed` 是**本服务端**最近一次在该机器上完成的安装——`{version, at}`，从未安装过则为 `null`。它持久化在数据根目录下，因此能跨重启、跨热推、跨「在别的机器上安装」而保留；它记录的是本端做过什么，而非对远端的实地探查，所以被手工清空的远端仍显示为已安装，直到下一次安装将其修正。安装失败不写入任何记录。

安装是任务而非请求：它要探测对端，可能下载并校验一份 Node 运行时，再经 scp 复制镜像——最坏情况以分钟计。`POST` 启动后立即返回，客户端轮询 `GET` 读取 `job.log`，其中是对端自己的原话（ssh 的诊断、远端安装器的输出）。运行期间 `job.result` 为 `null`，结束后为 `{ok: true, kind: "installed" | "already-installed", version}` 或 `{ok: false, step, message}`。同一时刻只允许一个任务；任务存于内存，热推与重启都不保留，重跑即是恢复手段——每一步都是幂等的。

在任何 ssh 运行之前就能判定的拒绝各有错误码：`409` `install_running`、`404` `unknown_machine`、`409` `no_install_image`、`502` `unresolvable_host`。

### 版本与在线更新

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/version | 当前运行构建的身份，外加该根目录被推送的 harness：`{version, describe, channel, buildDate, commit, branch, dirty, runtime, harness}`，与 `penguin version --json` 输出同一份记录。`harness` 描述该数据根目录的 HMR store（`{source, pushedAt, bundles}`，其中 `source` 为推送方 checkout 的 `{repo, revision}`），从未被推送过时为 null。`describe` 是单行身份（发布版为 `v0.2.3`，源码构建为 `v0.2.3-14-g9e8f7d6-dirty`）；`channel` 取 `release` 或 `source`；`buildDate`（UTC yyyy-mm-dd）与 `commit` 在构建时打入、无需联网，源码构建以及打入机制之前的发布版为 null；`branch` 与 `dirty` 记录源码构建的 git 位置，发布版为 null |
| GET | /api/version/update-check | 对比 GitHub 最新 Release 与当前版本：`{currentVersion, latestVersion, updateAvailable, releaseUrl, publishedAt, checkedAt, disabled?, error?}`；`?force=1`（手动「检查更新」）绕过 TTL 缓存，结果照常写入缓存 |
| GET | /api/version/update | **仅管理员。**在线更新任务的状态：`{state: idle \| running \| done, targetVersion, phase?, percent?, output, result?, startedAt?, finishedAt?}`——运行中带 `phase`（`resolving` / `downloading` / `installing`）与 `percent`（从安装器的进度条读出）；结束后带 `result`（`{status, reason?, output, needsRestart}`）。更新弹窗在任务运行期间轮询它 |
| POST | /api/version/update | **仅管理员。**启动在线更新任务——在服务器上后台运行 `penguin update --yes`——已有任务在跑则并入；应答与 GET 完全一致。已结束的任务可以再次启动（即重试） |
| POST | /api/version/restart | **仅管理员。**请求进程在优雅关闭后以托管进程约定的重启退出码退出，由 `penguin server \| penguin web` 在已安装的版本上重新拉起：`{restarting: true}`；没有托管进程时为 `{restarting: false, reason: "no_supervisor"}` |

`update-check` 是服务端唯一的对外网络请求，并且严格失败兜底：查询失败仍返回 200，只是设置 `error`（`network` / `rate_limited` / `bad_response`）且 `latestVersion` 为 null；结果在内存中缓存（成功 1 小时、失败 10 分钟）；设置 `PENGUIN_UPDATE_CHECK=off` 可完全关闭该查询（返回 `disabled: true`，不发起任何网络请求）。更新的 `status` 为 `updated`（需重启服务才能运行新版本）、`failed` 或 `unsupported` —— 后者包括服务不是通过 `penguin server|web` 启动（`reason: "not_launched_via_cli"`），以及 CLI 自身拒绝执行（源码运行、无法识别的安装方式、Windows）；`output` 携带 CLI 输出的末尾片段。

### Project 与成员

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/projects | 当前用户可见的 Project 列表 |
| POST | /api/projects | 创建 Project |
| DELETE | /api/projects/:projectId | 删除 Project |
| GET | /api/projects/:projectId/members | 成员列表 |
| POST | /api/projects/:projectId/members | 添加成员：`{userId}` |
| DELETE | /api/projects/:projectId/members/:userId | 移除成员 |

成员写操作仅限 Owner。成员路由在桌面模式下同样返回 `403 desktop_single_user`（见上文「用户管理」）。

### 模型

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/projects/:projectId/models | 模型列表（api_key 掩码显示） |
| PUT | /api/projects/:projectId/models | 全表替换，条目以 `(provider, modelId)` 为键 |
| POST | /api/projects/:projectId/models/test | 连通性测试：`{provider, modelId, …}` → `{ok, latencyMs?, message?}` |
| POST | /api/projects/:projectId/models/detect | 自定义 base URL 的协议自动检测：按 `openai-responses` → `ant-messages` → `openai-chat` 顺序探测并返回第一个被提供的协议：`{baseUrl, apiKey?, …}` → `{detected?, probes}` |
| POST | /api/projects/:projectId/models/list | 新增分组导入所用的端点模型列表：按检测出的协议列出端点服务的全部模型 id：`{baseUrl, clientType, apiKey?}` → `{ok, models?, unsupported?, message?}` |
| POST | /api/projects/:projectId/models/detect-vision | 视觉能力探测：用该模型的凭据发送一张 1x1 图片(一次真实计费的补全)：`{provider, modelId, apiKey?, baseUrl?, clientType?}` → `{outcome: supported\|unsupported\|failed, message?}` |

所有涉及模型的接口都要求完整的 `(provider, modelId)` 二元组，不做任何推断：只带一半的请求一律 400，绝不会退化为一次查找。模型引用本身可省略的场景（创建 Session、定时任务）省略的是整对，两半都不给即选用 Project 默认模型。

`PUT /models` 同时会使该 Project 已缓存的 Session 运行时失效（与 vault 更新同一套生效语义）：进行中的运行不做热替换，但该 Project 下任何 Session 的下一个 Task 都会重新装载并读到新的 `api_key` / `base_url`。它还会向该 Project 已打开的 Session 通道发布 `credentials_updated` 事件（见下文「流式推送」），且模型响应携带 `updatedAt`（配置文件 mtime）——Web App 用它与最近一次鉴权失败的时间比较，决定鉴权失败的输入框是否继续禁用。

#### 授权新建 API key

仅限 Owner，但供应商跳回的 `GET /callback` 例外——它无需会话即可应答，且只能把跳回时带来的授权码存到流程上，详见下文。若某个供应商分组在内置目录中声明了授权流程，用户可以在浏览器里授权并**新建**一个 API key，不必再去控制台复制。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/projects/:projectId/model-oauth/start | 开启一次流程：`{provider, mode?: callback\|manual}` → `{flowId, authorizeUrl}` |
| GET | /api/projects/:projectId/model-oauth/callback | 供应商跳回的地址（`?flow=&code=`）：把授权码存到流程上，并返回一个 HTML 页面；`HEAD` 返回 405 |
| GET | /api/projects/:projectId/model-oauth/:flowId | 轮询流程状态，并顺带兑换已存下的授权码、写入 key：`{status: pending\|done\|error, provider, error?}` |
| POST | /api/projects/:projectId/model-oauth/:flowId/code | 兑换用户粘贴的授权码：`{code}` → `{ok, applied?, error?}` |

PKCE 的 verifier 在服务端生成、只在内存中保留十分钟，绝不下发到客户端；新建出的 key 直接写入该分组的模型，不回传、不记录日志、也不出现在 URL 中。一次流程只属于某个 Project 下的某个用户且只能用一次：第二次兑换会被拒绝，`/start`、`/:flowId`、`/:flowId/code` 也拒绝该 Owner 以外的任何人。

`GET /callback` 是唯一的例外，且只能如此。环回地址上的 OAuth 跳转由供应商所跳转的那个浏览器送达，而它未必就是发起流程的那一个——桌面端 shell 会把授权页交给**系统**浏览器打开，系统浏览器并不持有该应用来源的 Cookie。因此这一条路径挂载在会话校验之外，改以 flow id 作为凭据：32 字节随机数，十分钟有效，只能存入一次，只对开启该流程的那个 Project 生效，且只服务于确实要了跳回地址的流程（`manual` 流程会被拒绝，它压根没拿到过跳回地址）。

这条路由能做的事还有第二重边界：它只把授权码存到流程上，此外什么都不做。与供应商的兑换、以及写入该 Project 模型的动作，都发生在 `GET /:flowId`——Owner 自己的轮询，仍在会话校验之内。因此没有 Owner 主动查询流程状态，就不会有 key 落进任何 Project；兑换失败也在那里以 `{status: error, error}` 报出，而不是显示在跳回页面上。周边的一切同样不在豁免之内：更长的路径、其它任何请求方法（该字面路径上的 `HEAD` 返回 405），以及另外三条同级路由，仍然都需要会话。

`mode: manual` 不传回调地址，授权页改为显示一次性授权码供用户手动带回，适用于跳转回不来的部署。无论由哪条路由完成兑换，流程完成后同样会使缓存的运行时失效并发布 `credentials_updated`，与 `PUT /models` 一致。

### Agent

以下路径均省略前缀 `/api/projects/:projectId`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | /agents | Agent 列表 / 创建 |
| DELETE | /agents/:agentId | 删除 Agent |
| GET / PUT | /agents/:agentId/config | 读写配置（AGENTS.md + system_config.yaml，PUT 保留 YAML 注释） |
| GET / PUT | /agents/:agentId/vault | Vault 环境变量（值掩码显示；PUT 全表替换） |
| GET | /agents/:agentId/memory | 记忆总览：开关、模板是否含 `{{MEMORY}}`，以及各作用域条目——用户作用域（`user`，`kind: "user"`）在前，其后为各 Workspace |
| POST | /agents/:agentId/memory/template-placeholder | 向提示词模板插入 `{{MEMORY}}` 占位符（幂等；创建于记忆功能之前的 Agent 的显式采用路径） |
| GET | /agents/:agentId/memory/scopes/:key/files | 列出单个作用域的主题文件（frontmatter + 文件信息）；`:key` 为 workspace key 或 `user` |
| GET / DELETE | /agents/:agentId/memory/scopes/:key/files/:name | 读取单个主题文件 / 删除它（并同步清理其 `MEMORY.md` 索引行） |
| GET | /agents/:agentId/memory/scopes/:key/export | 把整个作用域导出为一份 JSON 文档：全部主题文件加它的 `MEMORY.md`，以附件形式下载 |
| POST | /agents/:agentId/memory/scopes/:key/import | 把这样一份文档写回（仅 owner）：`{payload, mode?, confirm?}`。`mode` 为 `skip`（缺省，只添加作用域尚未有的名字）、`overwrite`（覆盖同名文件）或 `replace`（并删除文档中没有的文件）；任何会覆盖或删除的操作都需要 `confirm`，否则返回 409 `memory_import_confirm_required` |
| GET | /agents/:agentId/export | 导出 Agent State 快照（tar.gz 下载） |
| POST | /agents/:agentId/import | 导入快照：`{dataBase64, confirm?}`；版本冲突且未确认时返回 409 |
| GET / POST | /agents/:agentId/skills | 已安装 Skill 列表 / 安装 |
| DELETE | /agents/:agentId/skills/:name | 卸载 Skill |
| GET | /agents/:agentId/benchmarks | Benchmark 评分数据（只读） |

### Schedule

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | /agents/:agentId/schedules | 定时任务列表 / 创建（重名返回 409） |
| GET / PUT / DELETE | /agents/:agentId/schedules/:name | 读取 / 更新 / 删除单个任务 |

Schedule 写操作仅限 Owner。新建 Session 模式的任务，`modelId` 与 `provider` 要么成对给出、要么都不给；该二元组会在任务保存时以及调度器对账时对照 Project 模型表校验。

### Session 创建与目录浏览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /agents/:agentId/sessions | Session 列表（含运行状态）；无论由哪个客户端创建，所有行都会列出 |
| POST | /agents/:agentId/sessions | 创建 Session：`{modelId?, provider?, workspace?, approvalMode?, client?}` → 201。`client` 是存入索引行的创建客户端标记（CLI 传 `"cli"`，缺省 `"web"`）——仅作来源信息，绝不参与列表过滤 |
| GET | /dirs?path= | 服务器端目录浏览（Workspace 选择器数据源） |

创建 Session 时，`modelId` 与 `provider` 要么成对给出、要么都不给：给出完整二元组即指定模型，两个都省略则取 Project 默认模型，只给一个返回 400。Workspace 默认自动创建临时工作区，审批模式默认 `allow-all`。

### 用量与 Trace（Agent 级）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /usage | 用量统计，查询参数 `from`、`to`、`fromTs`/`toTs`（ISO 时间戳界定的滑动窗口，须成对给出；`minute` 精度必需）、`groupBy`、`granularity`（时间序列精度 `minute` / `hour` / `day` / `week` / `month`，默认 `day`；范围 × 精度过大的组合会被拒绝）、`agentId`、`provider`、`modelId` |
| GET | /usage/errors | 异常明细表分页（按时间倒序）：`offset`、`limit`，以及与看板一致的 `from` / `to` / `agentId` 过滤，另可选 `kind`（`unexpected` / `expected`）→ `{items, total}` |
| DELETE | /usage/errors | 清空当前筛选下的异常明细：`from` / `to` / `agentId`，与读取所用的同一组（不接受 `kind`，面板没有该控件）→ `{deleted}`。仅 Project owner；无 Project 归属的异常不在任何一次清空范围内，管理员亦然 |
| GET | /agents/:agentId/traces | Trace 文件的日期 → Session 下钻结构 |
| GET | /agents/:agentId/traces/:sessionId/:index | 读取 Trace 事件（`offset` / `limit` 分页） |
| GET | /agents/:agentId/traces/:sessionId/:index/analysis | Trace 性能分析结果 |
| GET | /agents/:agentId/traces/:sessionId/:index/download | 下载 Trace 原始文件（JSONL 附件） |
| POST | /agents/:agentId/traces/import | 导入 Trace 文件：`{dataBase64}` → `{sessionId, index, date}` |

Trace 下载对任意成员开放；导入仅限 owner（同 Agent 快照导入，上限 14MB）。导入文件必须是合法的 Trace JSONL，且首条记录为携带文件名安全 `session_id` 的 `session_meta`；若该 Agent 已存在同名 Session，导入将被拒绝（409 `trace_session_exists`），因此导入文件总是成为一个新 Session 的 001 号文件，并按首条记录时间戳的本地日期落入对应日期目录。

### Session 级接口

以下路径均省略前缀 `/api/sessions/:sessionId`。Trace 与 Session 的存储模型见 [Session 与 Trace](/sessions-and-traces)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | / | Session 信息（单会话 GET 额外携带 `tracePath`：最新 Trace 文件的绝对路径；列表行不含） |
| PATCH | / | 更新：`{approvalMode?, thinkingLevel?, archived?, title?}`。`thinkingLevel` 将思考等级钉在该 Session 上并持久化，自下一次 LLM 请求起生效——思考等级是软限制参数：允许中途更换，代价是提供商的缓存失效，因此选择器会建议先压缩；读取时由 `SessionInfo.thinkingLevel` 返回（缺省即从未钉住：按 Agent 配置生效） |
| DELETE | / | 删除 Session（连同 Trace 与暂存文件） |
| GET | /messages | 完整 OmniMessage 历史；Task 运行期间响应额外携带 `live`（进行中的流式尾部，见下） |
| POST | /fork | 从一条已完成的模型回复分叉空闲 Session：`{position:{fileIndex,ordinal}}` → `{session}` |
| GET | /stream | SSE 事件流（见下节） |
| POST | /tasks | 发起 Task：`{input: TaskInputPart[], queueIfBusy?}` → 202。带 `queueIfBusy` 时，运行中的 Session 会把输入暂存为跟进消息（`queued: true`），空闲后按序自动作为普通 Task 发出；`task_state` 事件携带排队数。`file` 类型的输入会写入 Session scratchpad，以 `[attached file: <路径>]` 行交给模型（见下方请求体）。带 `goal: {budget?}` 时该输入转为发起目标循环：必须含非空文字（一张图说明不了目标），随行的图片一律折叠成 scratchpad 路径行写入目标文本、与模型是否支持视觉无关，而 `file` 会被拒绝——没有东西能把它折进每轮重注入的目标里——见[目标模式](/goal-mode) |
| POST | /steer | 运行中插话：`{text, images?}` 为运行中的 Task 排队一条消息（作为独立的 `[user_steering]` 用户消息随下一轮送达，图片紧随其后）→ 202；两个字段任一非空即可成消息，都为空则 400；无 Task 运行返回 409 `not_running` |
| DELETE | /steer/:steerId | 撤回一条尚未送达的插话（id 随 `task_state` 的 `pendingSteering` 下发）：从队列中撤出 → 200，返回其原始内容 `{text, images, files}`（文件从 scratchpad 读回为 data URL，磁盘副本随之删除），供输入框恢复编辑；已送达模型则 409 `not_pending` |
| DELETE | /follow-ups/:followUpId | 撤回一条排队中的跟进消息（id 随 `task_state` 的 `pendingFollowUps` 下发）：在自动发出前移除 → 200，返回其原始内容 `{text, images, files}`——排队中的跟进消息一律带有该内容，与其入队路径无关；已自动发出则 409 `follow_up_started` |
| POST | /approvals/:toolCallId | 审批决定：`{decision}` 取 `allow` 或 `deny` → 204 |
| POST | /abort | 中断当前 Task：已触发返回 202，无任务返回 204 |
| POST | /retry-now | 重连倒计时上的「立即重试」：跳过进行中的退避等待、立刻发起下一次重试（重试计数不变）→ 200 `{skipped}`——`skipped:false` 表示当前没有等待可跳过（良性空操作，非错误） |
| POST | /compact | 触发上下文压缩：202；无可压缩内容返回 409，具体原因由 code 承载——`compaction_not_configured`（该 Agent 没有配置压缩）、`nothing_to_compact`（当前上下文尚未完成一轮对话）、`already_compacted`（上次压缩后还没有新的对话）。服务重启后恢复的 Session 依据 Trace 判断可压缩性，因此已有对话无需先跑一次 Task 即可压缩 |
| GET | /processes | 对话启动的后台进程（超过 yield 窗口转入后台的 `exec_command`）。仅来自活跃运行时——被回收或从未装载的会话如实返回空列表。检测到进程所服务地址时行内附 `serviceUrl`（取输出打印的最后一个本机 URL，否则按进程组做监听端口探测，每次拉取时刷新） |
| POST | /processes/:processId/kill | 停止一个后台进程（对整个进程组先 SIGTERM、宽限期后 SIGKILL），条目随之从列表消失；已不存在时 404 `process_not_found` |
| DELETE | /processes/:processId | 从列表移除一个**已退出**的进程条目：仍在运行时 409 `process_running`（应改用停止），已不存在时 404 `process_not_found`。条目连同该进程已捕获的输出一起离开运行时注册表，此后对该 `process_id` 调用 `input_command` 会失败 |
| GET | /files?path= | 浏览 Workspace 目录 |
| GET | /files/content?path=&download=&preview= | 读取 Workspace 文件（`download=1` 时作为附件下载，`preview=1` 以沙箱方式预览 —— 见下） |
| GET | /files/preview-redirect?path= | html 的“新页面打开”：签发令牌并 302 跳转到独立预览源 |
| POST | /files/stat | 批量存在性检查：`{paths}` |
| PUT | /files/content?path= | 上传文件：`{dataBase64}`，上限 14MB |
| GET | /traces | 本 Session 的 Trace 文件列表 |
| GET | /traces/:index | 读取 Trace 事件（分页） |
| GET | /traces/:index/analysis | Trace 性能分析结果 |
| GET | /scratchpad/:fileName | 读取会话暂存文件（如输入图片、文件附件） |

通用约定：无权访问的 Session 一律返回 404，不泄露其存在性；每个 Session 同时只允许一个 Task 或压缩在运行，冲突时返回 409（`task_in_progress` / `compacting`）。

#### GET /messages 的 `live` 字段

Trace 只存完整消息（流式 `partial_*` 永远不落盘），所以仅靠历史无法呈现一条正在流式输出的消息。因此当 Session 处于运行/压缩状态时，messages 响应额外携带进行中的流式尾部：

```ts
interface MessagesResponse {
  messages: (OmniMessage & { tracePosition?: { fileIndex: number; ordinal: number } })[];
  live?: {
    // Session 通道最近分配的 SSE 事件 id（`<epoch>-<seq>`）：
    // 截至该 id（含）发布的所有事件都已累积进 `fragments`。
    cursor: string;
    // 每个未闭合流式片段对应一条合成的 `partial_* start` OmniMessage，其 payload 携带
    // 迄今累积的全部内容（文本/思考前缀、工具调用名 + 已累积参数、工具输出前缀 + 图片），
    // 并保留原始 `origin` 链（子智能体片段同样覆盖）。
    fragments: OmniMessage[];
  };
}
```

`cursor` 与 `fragments` 在 Trace 读取开始前原子采集。使用先连接模式（见下）的客户端在应用完历史后处理它们：当 cursor 的 epoch 与本连接已缓冲事件的 epoch 一致时，丢弃 seq ≤ cursor 的已缓冲 **partial** 事件（其内容已累积在 `fragments` 里），把 `fragments` 按正常归约路径喂入，再重放剩余缓冲。已缓冲的**完整**消息从不按 cursor 丢弃 —— 仍由常规重叠去重裁决。空闲时不携带 `live`。

`tracePosition` 只是历史响应元数据，不进入持久化 OmniMessage。Web App 将一轮最后一条模型文本的不可变坐标提交给 `/fork`，服务端再校验它确实闭合了一个完整 Task。分叉会克隆保留范围内的 Trace 分片，并把源 Session 的 scratchpad 快照到新 Session id 下；系统生成的本地附件路径同步改写，因此以后删除任一 Session 都不会破坏另一方。同一源 Session 在任意回复位置产生的分支共用持久编号，标题使用不依赖界面语言的后缀，依次为 `原标题 (1)`、`原标题 (2)`；删除旧分支不会复用编号。源 Session 正在运行或压缩时返回 409。

Workspace 文件可能由 Agent 生成，`GET /files/content` 一律按不可信内容处理：所有响应都带 `X-Content-Type-Options: nosniff`，其余响应头取决于两个开关（`download=1` 优先于 `preview=1`）：

| 查询参数 | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| 都不带 | `.html` / `.htm` / `.svg` 降级为 `text/plain; charset=utf-8`，其余为真实类型 | `inline` | 无 |
| `preview=1` | 真实类型（`text/html`、`image/svg+xml` 等） | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`，仅对 `.html` / `.htm` / `.svg` 下发 |
| `download=1` | 真实类型 | `attachment` | 无 |

`GET /scratchpad/:fileName` 提供的同样是不可信字节（用户上传与 Agent 写下的临时文件），防护口径一致，只是没有那两个开关：始终带 `nosniff`；仅五种可安全内联的图片类型（`.png` / `.jpg` / `.jpeg` / `.gif` / `.webp`）按真实类型内联，供对话里的 `<img>` 使用；其余一律 `application/octet-stream` 并带 `Content-Disposition: attachment` —— 非图片内容无法在 App 所在源上作为文档渲染。

文件名始终以 `filename*=UTF-8''` 形式携带（百分号编码）。`preview=1` 是预览跳转在没有独立预览源时的回退目标：文档保留真实类型，可以正常渲染并执行脚本，但沙箱刻意不含 `allow-same-origin`，因此它落在一个不透明源里，既拿不到本源的 Cookie，也调不动 API。这份隔离也正是那里 `localStorage`、`document.cookie` 与第三方 embed 全都不可用的原因。

### 消息绑定（飞书、Telegram、QQ、微信）

Session 可以接入消息软件机器人——目前的渠道是飞书、Telegram、QQ 与微信，各自挂在 `/messaging/<channel>` 之下。一个 Session **每个渠道至多保存一份配置**（多份可同时保存），其中**至多一个渠道处于启用状态**——启用的渠道持有在线连接。启用即把机器人账号绑定到该 Session，停用即解除绑定，因此同一个应用或机器人可以同时保存在任意多个 Session 上，只有启用是互斥的。发给机器人的消息以普通用户输入在该 Session 上发起 Task——与在网页输入框里输入完全一致（无标记块；忙碌时排入 follow-up 队列）——完成的回复再转发回对应会话，并按渠道文本上限分段（Telegram 硬上限 4096 字符）。飞书经 SDK 的 WebSocket 长连接接收事件，Telegram 用 `getUpdates` 长轮询，QQ 以 `GROUP_AND_C2C_EVENT` intent 保持平台的 WebSocket 网关连接，微信用 `ilink/bot/getupdates` 长轮询——四者都无需公网回调地址。保存与连接是两件事：PUT 只保存凭据，连接由独立的 state 接口开关。路径同上表，省略 `/api/sessions/:sessionId` 前缀。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /messaging | 渠道无关读取：该 Session **每一份**已保存的渠道配置（`channel` 判别字段、密钥掩码、逐行 `enabled` 意图 + `linePerMessage` + `finalReplyOnly` + `renderMarkdown` + 连接运行状态 + `lastChatKnown`）。渠道感知的绑定编辑器只加载这一个 |
| GET | /messaging/feishu | `{binding, status}` 形态下的飞书配置（未保存时为 null） |
| PUT | /messaging/feishu | 保存凭据：`{appId, appSecret?, baseDomain?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}`。`appSecret` 省略或留空则保持已存值；`clearAppSecret: true` 清除已存密钥（新输入的密钥优先于清除标记；启用中返回 409 `messaging_disable_before_clear`——清除后配置行与非密钥字段保留）；`baseDomain` 默认 `https://open.feishu.cn`。不带连接副作用——唯一例外：**已启用**绑定的连接器会用新凭据重启，保证存储配置与在线连接永不背离。保存不会与其他 Session 冲突，唯一例外正源于这次重启：把**已启用**的绑定改指到另一个 Session 已启用的账号上，返回 409 `account_enabled_elsewhere`，否则那次重启就会绕过启用闸门、把第二条在线连接接到同一账号上 |
| POST | /messaging/feishu/state | 连接开关：`{enabled}`——启用即用**已存凭据**建立连接，停用即断开。该 Session 另一渠道已启用时返回 409 `another_channel_enabled`，同一账号已在**其他 Session** 上启用时返回 409 `account_enabled_elsewhere`（两者都是「先停用那一个」——后者不透露持有方的任何信息，它可能位于调用方看不到的 Project）；已存配置没有密钥时返回 400 `feishu_secret_required`。新配置默认停用；服务端启动只连接已启用的配置 |
| DELETE | /messaging/feishu | 整体删除该渠道的配置（含 App Secret；另一渠道不受影响）。仅为 API 完整性保留——Web 界面的移除入口是清除标记 |
| POST | /messaging/feishu/test | 用请求携带的草稿值做凭据探测，缺省字段回落到已存配置 → `{ok, latencyMs?, error?}`（凭据被拒是 `ok: false`，不是 HTTP 错误） |
| POST | /messaging/feishu/test-message | 向最近一次收到消息的会话发送一条固定测试文本；在飞书里给机器人发过消息之前返回 409 `feishu_no_chat` |
| GET | /messaging/telegram | 同一形态下的 Telegram 配置（`botId`、`botTokenMasked`） |
| PUT | /messaging/telegram | 保存凭据：`{botToken?, clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}`——整份凭据就是 @BotFather 签发的一条 `<机器人 id>:<密钥>` Token（省略或留空则保持已存值；读不出数字 id 时返回 400 `telegram_token_invalid`；清除标记与飞书同口径，清除后配置保留其机器人身份）。保存与启用的分离一致；把已启用绑定的 Token 换成另一个 Session 已启用的机器人时，同样返回 409 `account_enabled_elsewhere`，其余情况不存在跨 Session 的保存冲突 |
| POST | /messaging/telegram/state | 与飞书开关同一契约（无已存 Token 时返回 400 `telegram_token_required`） |
| DELETE | /messaging/telegram | 整体删除该渠道的配置（含 Bot Token）。仅为 API 完整性保留 |
| POST | /messaging/telegram/test | 凭据探测（`getMe`），草稿 Token 缺省回落到已存值 → `{ok, latencyMs?, botUsername?, groupPrivacy?, error?}`——成功时报出 Token 登录到的机器人；当 @BotFather 的 Group Privacy 处于开启状态（默认如此，此时机器人在它不担任管理员的群里收不到任何普通消息）时报出 `groupPrivacy: true` |
| POST | /messaging/telegram/test-message | 向最近一次收到消息的会话发送一条固定测试文本；在 Telegram 里给机器人发过消息之前返回 409 `telegram_no_chat` |
| GET | /messaging/qq | 同一形态下的 QQ 配置（`appId`、`appSecretMasked`） |
| PUT | /messaging/qq | 保存凭据对：`{appId, appSecret?, clearAppSecret?, linePerMessage?, finalReplyOnly?, renderMarkdown?}`——QQ 开放平台「开发设置」页的 App ID 与 App Secret。留空保持、清除标记、保存与启用分离都与飞书 PUT 同口径；把一条已启用绑定的 App ID 换成另一个 Session 已启用的账号时，同样返回 409 `account_enabled_elsewhere`，此外保存不会跨 Session 冲突；没有域名字段，因为 API v2 只有一个接口域名 |
| POST | /messaging/qq/state | 与其他开关同一契约（无已存密钥时返回 400 `qq_secret_required`） |
| DELETE | /messaging/qq | 整体删除该渠道的配置（含 App Secret）。仅为 API 完整性保留 |
| POST | /messaging/qq/test | 凭据探测（换取 app access token）→ `{ok, latencyMs?, error?}`。不报出账号名：平台没有能识别机器人身份的接口 |
| POST | /messaging/qq/scan | 发起扫码连接：服务端用新生成、且不外传的 AES 密钥注册一个绑定任务 → `{taskId, qrUrl, pollMs}`。把 `qrUrl` 渲染成二维码；它由 QQ 客户端打开，浏览器不会请求它。该 Session 的 QQ 连接处于启用状态时返回 409 `messaging_disable_before_scan`——扫码会在在线连接器底下换掉整对凭据；平台拒绝时返回 502 `qq_scan_failed` |
| POST | /messaging/qq/scan/poll | `{taskId}` → `{status, appId?, binding?}`。`completed` 表示服务端已解密 App Secret 并**保存**了绑定（启用仍是独立动作）；`expired` 表示需重新建任务。未知、属于其他 Session 或已完成的任务返回 404 `qq_scan_task_unknown` |
| POST | /messaging/qq/scan/cancel | `{taskId}`——用户中途离开时丢弃该任务，立即忘记其密钥，而不是等待过期清扫 |
| POST | /messaging/qq/test-message | 向最近一次收到消息的会话发送一条固定测试文本；在 QQ 里给机器人发过消息之前返回 409 `qq_no_chat`；没有可回复的近期消息时返回 502 `qq_send_failed`（见下） |
| GET | /messaging/wechat | 同一形态下的微信配置（`botId`、`botTokenMasked`） |
| PUT | /messaging/wechat | **只**保存投递偏好：`{clearBotToken?, linePerMessage?, finalReplyOnly?, renderMarkdown?}`。这是本组唯一不携带凭据的 PUT——微信机器人的 Bot Token 只能由扫码产生，没有可供复制的后台——因此它以已有绑定为前提，绑定不存在时返回 400 `wechat_token_required`。清除开关与其他渠道一致（启用中返回 409 `messaging_disable_before_clear`；被清除的配置保留行与机器人身份，只有重新扫码才能再次连接） |
| POST | /messaging/wechat/state | 与其他开关同一契约（无已存 Token 时返回 400 `wechat_token_required`） |
| DELETE | /messaging/wechat | 整体删除该渠道的配置（含 Bot Token）。仅为 API 完整性保留 |
| POST | /messaging/wechat/test | 凭据探测（以扫码账号身份调用 `ilink/bot/getconfig`）→ `{ok, latencyMs?, error?}`。这是唯一**不接受请求体**的探测：本渠道没有可填写的字段，只能探测已存绑定（没有则返回 400 `wechat_token_required`）。不报出账号名——该探测既不识别机器人，也不识别人 |
| POST | /messaging/wechat/scan | 发起扫码连接——在本渠道这是**唯一**的绑定方式 → `{taskId, qrUrl, pollMs}`。把 `qrUrl` 渲染成二维码；它由微信打开，服务端从不请求它。平台自身的轮询句柄——也就是能换取 Bot Token 的那个——留在服务端，`taskId` 是服务端另行签发的替代句柄。连接启用中返回 409 `messaging_disable_before_scan`；平台拒绝时返回 502 `wechat_scan_failed` |
| POST | /messaging/wechat/scan/poll | `{taskId}` → `{status, botId?, binding?}`。`status` 取值为 `pending`、`scanned`、`need_verify_code`、`blocked`、`expired`、`already_bound`、`completed`。`completed` 表示服务端已**保存**绑定（启用仍是独立动作）；`already_bound` 不是失败——该机器人已被绑定，没有签发新凭据。它并不说明绑定在**哪里**：本流程不向平台提供任何已持有的 token 列表，因此无法区分「绑定在本服务」与「绑定在别处」。任务未知、属于其他 Session 或已结算时返回 404 `wechat_scan_task_unknown`。与 QQ 不同，**重叠的**轮询返回 `pending` 而非 404：上游是长轮询，一次调用会跨越客户端的多个轮询间隔 |
| POST | /messaging/wechat/scan/verify | `{taskId, verifyCode}` → 204。微信在手机上显示的配对码。平台把它作为状态查询的参数，因此它随**下一次**轮询携带而不单独发起请求，本接口只做记录——配对码错误会表现为下一次轮询再次返回 `need_verify_code` |
| POST | /messaging/wechat/scan/cancel | `{taskId}`——用户中途离开时丢弃该任务，立即忘记其句柄，而不是等待过期清扫 |
| POST | /messaging/wechat/test-message | 向最近一次收到消息的会话发送一条固定测试文本；在微信里给机器人发过消息之前返回 409 `wechat_no_chat` |

没有已存密钥的配置（被清除过的）不返回掩码字段，也无法启用。`linePerMessage`、`finalReplyOnly` 与 `renderMarkdown` 是仅有的三个不属于凭据的已存字段。开启 `linePerMessage` 后，转发的助手回复中每个非空行各自作为一条消息发出（空行忽略，单行仍按长度上限分段，超出每条回复的消息条数上限的部分合并为最后一条）。开启 `finalReplyOnly` 后，一次运行只转发它**最后**完成的那条助手消息，并在运行结束时发送，而不是每完成一条就转发一条——运行过程中在工具调用之间写下的记录留在网页端；随回复发送的文件也只从这条最终消息中读取提及，因为聊天只收到了它。两者可叠加：同时开启时，被按行拆分的就是这条最终回复。两者默认均为 false，PUT 省略则保持已存值，且都不作用于通知与测试消息——审批提醒尤其不属于回复，无论 `finalReplyOnly` 如何都会立即到达。开启 `renderMarkdown` 后，转发回复中的 Markdown 按各渠道自身的标记语言渲染，而不是把字符原样发出；它**默认为 true**，PUT 省略同样保持已存值，同样不作用于通知与测试消息。各渠道各自渲染力所能及的部分，其余按既定方式降级而非泄漏源码：Telegram 使用 `parse_mode: "HTML"`，没有标题、列表和表格（标题渲染为一行粗体，列表符号作为文本保留，表格改用 `<pre>` 块）；飞书发送携带 JSON 2.0 富文本组件的交互卡片，全部构件均可渲染，超长表格改为代码块以免整行被静默丢弃；QQ 使用 `msg_type: 2` 自定义 markdown，没有代码格式也没有表格（代码块按转义后的普通文本行发出，表格按其行发出）；微信自己就读 Markdown，因此渲染是**做减法**而不是翻译——客户端不会呈现的部分保留文字、去掉标记（四级以上的标题、CJK 两侧的强调，以及内联图片，后者改为链接）。分段随该设置改变：在块边界切分，跨消息的代码块会重新加围栏，因此任何一条消息都不会打开一个它没有闭合的构件。**渠道拒绝的格式化发送会退回为同一条消息的纯文本发送**，因此该设置只可能损失排版，绝不会损失回复。唯一的跨 Session 规则按渠道内机器人账号计，且只作用于连接：一个账号只有一条事件流，因此至多一个 Session 能将其启用。飞书的账号身份是 `app_id`，Telegram 是 Token 冒号前的数字机器人 id（换发 Token 也不会改变），微信则是扫码返回的机器人 id。读取与两个测试接口对任意 Project 成员开放；PUT、state 开关与 DELETE 仅限所有者（与 Vault 同口径——绑定写操作携带或作用于密钥）。密钥永不回传。删除 Session 会连带删除其全部渠道配置。入站处理文本、图片与文件：图片按普通 `image_url` 输入部分送入，单张受服务端的内联图片上限约束，总量再受每个绑定一个滚动窗口的字节预算约束——内联图片会原样写入 Trace，而这条路径不像网页输入框，前面没有任何鉴权。文件按输入框的另一种附件形态送入——写进该 Session 的 Scratchpad，并以 `[attached file: <path>]` 行交给模型，其字节不进入对话——上限沿用管理员可设的单个文件与单条消息附件上限（与经过鉴权的上传同一组数值），并再取渠道自身更紧的那个上限（Telegram 不向机器人提供超过 20MB 的文件）。飞书取 `file` 消息类型，Telegram 取 `document` 字段：发送者主动**以文件形式**发出的那一个，也是 Telegram 各媒体字段中唯一携带发送者原始文件名的。在这两个渠道上，视频、音频与语音有意不予送达——下游没有任何环节能解码或转写它们，而发送者真正想交给智能体的东西，只要按文件发送就会到达。微信是例外，且仅仅因为解码由平台自己完成：语音消息随附它自己的转写文本，视频则作为普通文件到达。附件**确实会被送达**的消息（图片、文件），其说明文字即该消息的文本；其他媒体类型的说明文字则不是——其字节并不会送达，仅凭说明文字运行只会让模型对一个它从未收到的文件侃侃而谈。图片超过单张上限、超出窗口预算与渠道拒绝下载分别回复三种不同的双语提示；文件超过单个上限、一条消息的文件总量超限与渠道拒绝下载同样各有其提示。它们都不会把半条消息交给模型；因机器人自身权限被拒时，提示会点名所需权限并带上渠道给出的授权链接——飞书通常正是此种情况（接收消息与下载其中的附件是两项独立权限）。其余类型仍收到双语的“暂不支持”回复。出站方向，一次运行结束后会在回复文本之后发送该回复**提及且由本次运行产出**的文件——回复中形如路径、能解析到 Workspace 之内、确实存在、且修改时间不早于本次运行开始的片段，出现在回复的任何位置皆可（「提及」挑出这次真正要交付的那个产物；「修改时间」则确保一条可被会话中任何人引导的回复不会变成读取原语——拒绝粘贴某个文件的回复同样会点到它的名字）——图片按图片发送、其余按文件发送，且按**读取时实际拿到的文件名**分类，而非回复中写下的那个名字；每次运行最多 5 个，单个图片上限 10MB、单个文件上限 30MB（取两个渠道各自限制中更紧的一个）。被提及的文件凡是没送到，都会在会话中说明原因——超过上限、超出数量上限、Workspace 内没有该文件、渠道拒绝上传——唯独「本次运行没有写过」是静默跳过的，因为回复中提到自己读过的配置文件属于常态。Telegram 建立连接时先清空积压：无连接期间发来的消息会被跳过，与飞书“错过的事件即消失”同口径。绑定的运行时状态另外报出该连接**实际见到**的情况——`lastInboundAt`（最近一条消息到达的时间；自本次连接建立以来还没有收到过时该字段缺席）、`lastDeliveryError`（`{at, stage, detail}`，`stage` 为 `inbound` 表示消息已到达但其 Task 没能开始，为 `send` 表示回复没能送达聊天；后续的成功不会把它清掉），以及 `lastConnectionError`（`{at, detail}`，最近一次连接失败，并在连接恢复之后依然保留——不同于属于 `error` 状态、状态一离开就被抹掉的 `lastError`）。三者都只存在于进程内，且每次（重新）建立连接都会清空——重新启用连接或再保存一次凭证，都会开启一条新连接——所以 `lastInboundAt` 缺席只意味着「本次连接以来没有收到过」，而不是「从来没有收到过」。它们的存在是因为一个扣着消息不投递的渠道，表现出来正是 `connected` 且毫无报错。
**QQ 是只能被动回复的渠道，这改变了「送达」的含义。** 平台不提供本产品可用的主动推送：每一条外发消息都是携带入站 `msg_id` 的*被动回复*，有效期只有几分钟，且单聊对同一条消息最多 4 条回复（群聊 5 条）。由此有三点在 API 上可见。一次运行完成的助手消息超过该额度时会被**合并**——前 `budget - 1` 条随完成即时发出，其余合并为最后一条送达，内容不丢。`linePerMessage` 的拆分上限**收敛到该额度**，而不是渠道无关的 20；被平台拒绝的 `renderMarkdown` 发送，其纯文本重试会再占用一次额度。`finalReplyOnly` 在这里有利有弊：它把一次运行的额度消耗压到最低——只发一条；但被动回复的有效期只有几分钟，把回复扣到运行结束才发，等于把这个窗口花在了运行本身上，运行时长超过窗口时将什么都送不出去，而逐条转发至少能把窗口之内完成的部分发出去。而没有可回复对象的发送——在网页端发起的对话，或窗口关闭之后的回复——会被**拒绝而非主动推送**：测试接口上表现为 502 `qq_send_failed`，转发回复则记为一条 `messaging_send_failed` 错误记录。QQ 的账号身份是 App ID。该渠道拒绝外发文件：平台的富媒体接口要求为文件提供公网可达地址。
**微信只承载单聊，但媒体能力是四个渠道里最全的。** 该机器人渠道完全不接收群消息：在群里 @机器人的消息根本不会到达本 API，因此单聊正常、群聊沉默是渠道形态而非配置错误。作为交换，它是这里唯一能**双向**传输文字、图片与文件的渠道——回复中的图片与附件会上传到平台 CDN（每个文件一把 AES-128-ECB 密钥），以真正的图片和文件到达，而不是被拒绝。两类入站消息被折叠处理：语音消息按微信自带的语音转文字结果进入对话，视频按文件到达；微信没能转写的语音则以共用的「不支持」提示回到聊天。

**扫码连接不会把机密交给浏览器。** 让这套流程安全的东西都留在服务端——解密 QQ App Secret 的 AES 密钥，以及换取微信 Bot Token 的轮询句柄——在服务端生成、持有、使用并丢弃；客户端只拿到任务句柄、待绘制的 URL 与状态。任务只存在于内存，归属发起它的 Session，按 Session 单独限量（一个调用方的扫码任务挤不掉另一个调用方的），并被「解决它的那一次轮询」认领掉，因此重放得到的是 404 而不是第二次绑定。对同一任务的并发轮询在 QQ 上同样是 404；在微信上返回 `pending`，因为上游是一次跨越客户端多个轮询间隔的长轮询。所有扫码路由都仅限 Project 所有者——无论调用方实际输入了多少内容，这个流程的终点都是一份存下来的凭据。

### 独立源预览

Files 面板内的 HTML 渲染视图（iframe）与“新页面打开”都走 `GET /files/preview-redirect?path=`：先鉴权，再签发一枚短时效 HMAC 令牌，然后 302 跳转到**另一个源**：

```text
GET  /api/sessions/:sessionId/files/preview-redirect?path=index.html
302  Location: http://localhost:7364/preview/<token>/index.html
GET  /preview/<token>/<相对路径>              （不鉴权，令牌即凭证）
```

- **为什么要独立源。** 页面需要一个真实的源，才能有可用的 storage、Cookie 与第三方 embed；但它不能是应用自己的源，否则 Agent 写出来的 HTML 就带着会话 Cookie 在跑。本地把 App 固定在规范主机 `localhost`，预览用 `127.0.0.1`——Cookie 按主机划分且不区分端口，所以这两者天然是两个 Cookie jar，而只换端口做不到。其余情况用 `PENGUIN_PREVIEW_ORIGIN`；两者都没有时（通配或非回环绑定，或变量未设）回退到上面的同源沙箱，并由 `GET /api/me` 的 `previewIsolated` 返回 `false`，界面据此提前说明。
- **面板内渲染共用同一 URL。** Files 面板把该跳转 URL 嵌入 iframe，沙箱为 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`——`allow-same-origin` 赋予的是预览源而非应用源的身份，因此仍严格紧于不带沙箱的新标签页。没有独立预览源时，面板回退为内联 `srcdoc` 渲染（仅 `allow-scripts`，附内存版 storage 垫片），相对子资源在那里无法加载。另注意部分浏览器会对跨站 iframe 内的 storage 做分区或屏蔽，页面在面板内的行为可能与顶层标签页略有差异。
- **预览主机只服务 `/preview/*`。** 它与 App 是同一个进程，故其 `/api` 一律 401，其余路径一律 302 回规范 App 主机——会话 Cookie 因此永远不会落在预览主机上，也不被其接受，那里的 Agent HTML 无法同源调用 API。（部署 `PENGUIN_PREVIEW_ORIGIN` 时，反向代理须做等价保证：该源上只把 `/preview/*` 路由到 App。）
- **路径式而非查询参数**，页面里的相对子资源（`app.js`、`style.css`、图片）才能相对文档解析，并在同一个令牌下加载。
- **令牌绑定 Session、预览主机与过期时间。** 其中主机绑定是承重的：同一个进程也在应用源上应答，因此 `/preview/...` 在应用源上一律拒绝服务——否则那就是一个同源 XSS。权限只读、限定该 Session 的 Workspace，路径仍在服务端重新解析，`..` 与符号链接逃逸照旧拒绝。
- **响应带 `Referrer-Policy: no-referrer`**，否则带令牌的 URL 会经 `Referer` 泄漏给页面内嵌的每一个第三方——而这个风险恰恰是因为 embed 现在能用了才出现的。
- 令牌无效、过期、主机不符与路径越界一律返回裸 404：该端点不鉴权，不能确认任何东西是否存在。

关键请求体（明确键名）：

```ts
// POST /api/sessions/:sessionId/tasks —— 发起一个 Task
interface TaskCreateRequest {
  input: TaskInputPart[];
  // 思考等级不是 Task 参数：它属于模型上下文——用 PATCH 钉在 Session 上，此后开启的每个上下文都以钉住的等级运行
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string }    // 粘贴图片以 data URL 上送，≤20MB（超出返回 413 image_too_large）
  // 文件附件：base64 data: URL，默认单个 ≤100MB（超出返回 413 file_too_large），单次请求最多 20 个、
  // 解码后合计 ≤120MB（超出返回 413 too_many_files / payload_too_large；三项校验都在落盘前完成）。
  // 两个尺寸均可由管理员调整（PUT /api/admin/settings），并由 GET /api/me 下发。
  // 服务端将其写入该 Session 的 scratchpad，并在消息文本末尾追加一行
  // `[attached file: <path>]`——模型按路径读取该文件。`fileName` 不得含路径分隔符；落盘时保留
  // 原有词形（`报告 2026.pdf` → `报告-2026.pdf`：非 ASCII 字符原样保留，对 shell 不友好的
  // ASCII 字符替换为 `-`），既便于在消息中辨认，也可安全地拼进命令。
  | { type: "file"; fileName: string; dataUrl: string };

// POST /api/sessions/:sessionId/approvals/:toolCallId
interface ApprovalDecisionRequest {
  decision: "allow" | "deny";
}
```

Web 的 `/model` 模型切换没有专用接口：它按 `/agent` 交接的方式复用上面的普通接口——先用会话创建接口在同一 Agent 下新建 Session（选定新模型并沿用源 Workspace），再 POST /tasks 发送以 `[model_switch_from]` 源块开头的首条消息（源会话 id、其 `tracePath`、Workspace 与原模型二元组），模型需要早前历史时自行读取该 Trace 文件。

## 流式接口（SSE）

实时通道采用 Server-Sent Events 而非 WebSocket，共两条(通道内承载的消息顺序语义见[消息流转与时序](/message-flow)):

| 通道 | 路径 | 内容 |
| --- | --- | --- |
| Session 级 | GET /api/sessions/:sessionId/stream | 该 Session 的消息流与运行事件 |
| 用户级 | GET /api/events | `hello` 握手与跨 Session 通知（session_state / schedule_fired / schedule_queued / session_created） |

### 传输格式

默认（未命名）SSE 事件承载原始 OmniMessage 信封（单行 JSON）——与 SDK 产出、Trace 落盘是同一套协议，见 [OmniMessage 协议](/omni-message)；命名为 `server_event` 的事件承载 ServerEvent 联合类型：

```ts
export type ServerEvent =
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  | { type: "task_state"; state: "idle" | "running" | "compacting" }
  | { type: "session_title"; sessionId: string; title: string }
  | { type: "session_state"; sessionId: string; state: "idle" | "running" | "compacting"; lastActiveAt: string; hasTrace: boolean }
  | { type: "resync_required" }
  | { type: "credentials_updated" }
  | { type: "hello" }
  | { type: "session_created"; projectId: string; agentId: string; sessionId: string; source: SessionSource }
  | { type: "schedule_fired"; projectId: string; agentId: string; name: string; sessionId: string }
  | { type: "schedule_queued"; projectId: string; agentId: string; name: string; sessionId: string };
```

| 事件 | 触发时机 |
| --- | --- |
| approval_request | 工具调用升级为人工审批时发出：always-ask 下的所有调用，以及 read-only 下 rw / 未知权限的调用；重连时未决审批会重发 |
| task_state | Session 运行状态翻转（idle / running / compacting） |
| session_title | 首轮后模型生成的标题已持久化 |
| session_state | `task_state` 在用户通道上的对应事件：同一次运行状态翻转，带上 `sessionId`，因此会话列表的每一行都能保持实时，而不只是客户端当前打开的那个会话。事件还携带重绘该行所需的行字段，无需重新拉取列表 —— 刚刚写入的 `lastActiveAt`，以及 `hasTrace`（状态为 running 或 compacting 时必为 true，因为正在运行的会话必然已经启动过 Task）。仅发往该 Project 拥有者与成员的用户通道 |
| resync_required | Last-Event-ID 已被缓冲区淘汰，客户端须重新拉取历史 |
| credentials_updated | Project 模型凭据已变更（`PUT /models`，或一次完成的授权新建 key 流程）：缓存运行时已失效，客户端应清除鉴权失败的输入框禁用态 |
| hello | 用户通道连接握手 |
| session_created | 新 Session 注册（如子 Agent 会话） |
| schedule_fired | 定时任务已触发并发送 |
| schedule_queued | 目标 Session 正在运行，本次触发已排队 |

### 投递保证

- 事件 id 按通道单调递增，形如 `<epoch>-<seq>`；
- 每通道维护有界重放缓冲（最近 10,000 条事件或 8MB）；
- 携带 `Last-Event-ID` 重连时，命中缓冲则补发缺口；未命中则先发 `resync_required`，客户端重新拉取 `/messages` 后继续消费；
- 每 20 秒写一条心跳注释行；
- 事件次序：带 `Last-Event-ID` 重连时，**补发的缺口(或 `resync_required`)最先送达**，随后才是初始事件——权威的 `task_state` 快照与未决的 approval_request，再进入实时流；全新连接(无 `Last-Event-ID`)不重放缓冲，首个事件即为 `task_state` 快照。

### 推荐客户端模式

自带 Web App 的接入顺序：

1. 先连接 `/stream` 并缓冲收到的事件；
2. 再 GET `/messages` 拉取完整历史；
3. 若响应携带 `live`（有 Task 在运行），丢弃 cursor 已覆盖的缓冲 partial 事件，并把 `live.fragments` 播种到历史之上 —— 进行中的消息连同已流式输出的前缀一起回到画面；
4. 回放缓冲区并对重叠消息去重；
5. 转入实时消费。

## 类型导入

全部 DTO 类型可从服务端包的子路径 `@prismshadow/penguin-server/api` 以 type-only 方式导入：

```ts
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
```
