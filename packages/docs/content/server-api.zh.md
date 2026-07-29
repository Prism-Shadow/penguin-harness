---
title: Server API
description: HTTP API 参考：认证机制、路由列表、SSE 流式协议与 DTO 类型导入。
---

PenguinHarness Server 提供一套同源 HTTP API，自带的 Web App 与其他 HTTP 客户端都通过它访问。本文是接口参考：认证机制、路由列表与 SSE 流式协议。服务启动方式见[快速开始](/quickstart)。

## 总览

- 技术栈：Hono + @hono/node-server，要求 Node >= 24；
- 存储：SQLite（内置 `node:sqlite`，WAL 模式）仅存放索引与聚合数据——用户、登录会话、Project 授权、Agent / Session 索引、用量、UI 偏好、错误记录与 Schedule 状态；Agent、Trace 与 Workspace 数据全部以文件形式存放在 `~/.penguin/data` 下，与 CLI / SDK 共享，见[配置参考](/configuration)；
- 监听：默认 `127.0.0.1:7364`，可用环境变量 `PORT` / `HOST` 调整；
- 请求体：写请求仅接受 JSON（Content-Type 校验，CSRF 防线之一），上限 20MB；
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

- Cookie 会话：`penguin_session`（HttpOnly、SameSite=Lax），有效期 7 天，滑动续期；
- 密码以 scrypt 哈希存储；服务端只保存会话 Token 的 sha256，不落明文；
- 不开放注册：启动时种子化内置管理员 `admin` / `penguin-2026`，其余账号由管理员创建；
- 仅限同源访问，未启用 CORS 中间件。

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"penguin-2026"}' \
  http://127.0.0.1:7364/api/auth/login
```

## 路由参考

### 认证与账户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/auth/login | 登录：`{userId, password}` → `{user}` |
| POST | /api/auth/logout | 退出登录，返回 204 |
| GET | /api/me | 当前用户信息 |
| PUT | /api/me/password | 修改密码：`{oldPassword, newPassword}` |
| GET | /api/me/prefs | 读取 UI 偏好 |
| PUT | /api/me/prefs | 写入 UI 偏好（浅合并） |

### 用户管理（仅管理员）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/admin/users | 用户列表 |
| POST | /api/admin/users | 创建用户：`{userId, password}` |
| POST | /api/admin/users/:userId/password | 重置密码（该用户全部登录会话失效） |
| DELETE | /api/admin/users/:userId | 删除用户 |

### 版本与在线更新

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/version | 当前运行版本：`{version, buildDate}`（`buildDate` 是当前运行版本的发布日期，构建时打入、无需联网；开发/源码构建以及打入机制之前的发布版为 null） |
| GET | /api/version/update-check | 对比 GitHub 最新 Release 与当前版本：`{currentVersion, latestVersion, updateAvailable, releaseUrl, publishedAt, checkedAt, disabled?, error?}`；`?force=1`（手动「检查更新」）绕过 TTL 缓存，结果照常写入缓存 |
| POST | /api/version/update | **仅管理员。**在服务器上执行 CLI 在线更新（`penguin update --yes`）：`{status, output, needsRestart}` |

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

成员写操作仅限 Owner。

### 模型

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/projects/:projectId/models | 模型列表（api_key 掩码显示） |
| PUT | /api/projects/:projectId/models | 全表替换，条目以 `(provider, modelId)` 为键 |
| POST | /api/projects/:projectId/models/test | 连通性测试：`{provider, modelId, …}` → `{ok, latencyMs?, message?}` |

所有涉及模型的接口都要求完整的 `(provider, modelId)` 二元组，不做任何推断：只带一半的请求一律 400，绝不会退化为一次查找。模型引用本身可省略的场景（创建 Session、定时任务）省略的是整对，两半都不给即选用 Project 默认模型。

`PUT /models` 同时会使该 Project 已缓存的 Session 运行时失效（与 vault 更新同一套生效语义）：进行中的运行不做热替换，但该 Project 下任何 Session 的下一个 Task 都会重新装载并读到新的 `api_key` / `base_url`。它还会向该 Project 已打开的 Session 通道发布 `credentials_updated` 事件（见下文「流式推送」），且模型响应携带 `updatedAt`（配置文件 mtime）——Web App 用它与最近一次鉴权失败的时间比较，决定鉴权失败的输入框是否继续禁用。

### Agent

以下路径均省略前缀 `/api/projects/:projectId`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | /agents | Agent 列表 / 创建 |
| DELETE | /agents/:agentId | 删除 Agent |
| GET / PUT | /agents/:agentId/config | 读写配置（AGENTS.md + system_config.yaml，PUT 保留 YAML 注释） |
| GET / PUT | /agents/:agentId/vault | Vault 环境变量（值掩码显示；PUT 全表替换） |
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
| GET | /agents/:agentId/sessions | Session 列表（含运行状态） |
| POST | /agents/:agentId/sessions | 创建 Session：`{modelId?, provider?, workspace?, approvalMode?}` → 201 |
| GET | /dirs?path= | 服务器端目录浏览（Workspace 选择器数据源） |

创建 Session 时，`modelId` 与 `provider` 要么成对给出、要么都不给：给出完整二元组即指定模型，两个都省略则取 Project 默认模型，只给一个返回 400。Workspace 默认自动创建临时目录，审批模式默认 `allow-all`。

### 用量与 Trace（Agent 级）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /usage | 用量统计，查询参数 `from`、`to`、`groupBy`、`agentId`、`provider`、`modelId` |
| GET | /usage/errors | 异常明细表分页（按时间倒序）：`offset`、`limit`，以及与看板一致的 `from` / `to` / `agentId` 过滤 → `{items, total}` |
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
| PATCH | / | 更新：`{approvalMode?, archived?, title?}` |
| DELETE | / | 删除 Session（连同 Trace 与暂存文件） |
| GET | /messages | 完整 OmniMessage 历史；Task 运行期间响应额外携带 `live`（进行中的流式尾部，见下） |
| GET | /stream | SSE 事件流（见下节） |
| POST | /tasks | 发起 Task：`{input: TaskInputPart[], thinkingLevel?, queueIfBusy?}` → 202。带 `queueIfBusy` 时，运行中的 Session 会把输入暂存为跟进消息（`queued: true`），空闲后按序自动作为普通 Task 发出；`task_state` 事件携带排队数 |
| POST | /steer | 运行中插话：`{text}` 为运行中的 Task 排队一条消息（作为独立的 `[user_steering]` 用户消息随下一轮送达）→ 202；无 Task 运行返回 409 `not_running` |
| POST | /approvals/:toolCallId | 审批决定：`{decision}` 取 `allow` 或 `deny` → 204 |
| POST | /abort | 中断当前 Task：已触发返回 202，无任务返回 204 |
| POST | /retry-now | 重连倒计时上的「立即重试」：跳过进行中的退避等待、立刻发起下一次重试（重试计数不变）→ 200 `{skipped}`——`skipped:false` 表示当前没有等待可跳过（良性空操作，非错误） |
| POST | /compact | 触发上下文压缩：202；无可压缩内容返回 409 `nothing_to_compact` |
| GET | /files?path= | 浏览 Workspace 目录 |
| GET | /files/content?path=&download=&preview= | 读取 Workspace 文件（`download=1` 时作为附件下载，`preview=1` 以沙箱方式预览 —— 见下） |
| GET | /files/preview-redirect?path= | html 的“新页面打开”：签发令牌并 302 跳转到独立预览源 |
| POST | /files/stat | 批量存在性检查：`{paths}` |
| PUT | /files/content?path= | 上传文件：`{dataBase64}`，上限 14MB |
| GET | /traces | 本 Session 的 Trace 文件列表 |
| GET | /traces/:index | 读取 Trace 事件（分页） |
| GET | /traces/:index/analysis | Trace 性能分析结果 |
| GET | /scratchpad/:fileName | 读取会话暂存文件（如输入图片） |

通用约定：无权访问的 Session 一律返回 404，不泄露其存在性；每个 Session 同时只允许一个 Task 或压缩在运行，冲突时返回 409（`task_in_progress` / `compacting`）。

#### GET /messages 的 `live` 字段

Trace 只存完整消息（流式 `partial_*` 永远不落盘），所以仅靠历史无法呈现一条正在流式输出的消息。因此当 Session 处于运行/压缩状态时，messages 响应额外携带进行中的流式尾部：

```ts
interface MessagesResponse {
  messages: OmniMessage[];
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

Workspace 文件可能由 Agent 生成，`GET /files/content` 一律按不可信内容处理：所有响应都带 `X-Content-Type-Options: nosniff`，其余响应头取决于两个开关（`download=1` 优先于 `preview=1`）：

| 查询参数 | Content-Type | Content-Disposition | Content-Security-Policy |
| --- | --- | --- | --- |
| 都不带 | `.html` / `.htm` / `.svg` 降级为 `text/plain; charset=utf-8`，其余为真实类型 | `inline` | 无 |
| `preview=1` | 真实类型（`text/html`、`image/svg+xml` 等） | `inline` | `sandbox allow-scripts allow-popups allow-modals allow-forms`，仅对 `.html` / `.htm` / `.svg` 下发 |
| `download=1` | 真实类型 | `attachment` | 无 |

文件名始终以 `filename*=UTF-8''` 形式携带（百分号编码）。`preview=1` 是预览跳转在没有独立预览源时的回退目标：文档保留真实类型，可以正常渲染并执行脚本，但沙箱刻意不含 `allow-same-origin`，因此它落在一个不透明源里，既拿不到本源的 Cookie，也调不动 API。这份隔离也正是那里 `localStorage`、`document.cookie` 与第三方 embed 全都不可用的原因。

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
  // 本次 Task 的思考等级（逐轮参数，五档之一；非法值 400）；缺省 = 回退到 Agent 配置的档位
  thinkingLevel?: "none" | "low" | "medium" | "high" | "xhigh";
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string };   // 粘贴图片以 data URL 上送

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
| 用户级 | GET /api/events | `hello` 握手与跨 Session 通知（schedule_fired / schedule_queued / session_created） |

### 传输格式

默认（未命名）SSE 事件承载原始 OmniMessage 信封（单行 JSON）——与 SDK 产出、Trace 落盘是同一套协议，见 [OmniMessage 协议](/omni-message)；命名为 `server_event` 的事件承载 ServerEvent 联合类型：

```ts
export type ServerEvent =
  | { type: "approval_request"; toolCall: OmniMessage<ToolCallPayload>; origin?: string[] }
  | { type: "task_state"; state: "idle" | "running" | "compacting" }
  | { type: "session_title"; sessionId: string; title: string }
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
| resync_required | Last-Event-ID 已被缓冲区淘汰，客户端须重新拉取历史 |
| credentials_updated | Project 模型凭据已变更（`PUT /models`）：缓存运行时已失效，客户端应清除鉴权失败的输入框禁用态 |
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
