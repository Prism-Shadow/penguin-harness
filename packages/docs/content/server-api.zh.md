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
- 不开放注册：启动时种子化内置管理员 `admin` / `admin123`，其余账号由管理员创建；
- 仅限同源访问，未启用 CORS 中间件。

```bash
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"userId":"admin","password":"admin123"}' \
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

Schedule 写操作仅限 Owner。

### Session 创建与目录浏览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /agents/:agentId/sessions | Session 列表（含运行状态） |
| POST | /agents/:agentId/sessions | 创建 Session：`{modelId?, provider?, workspace?, approvalMode?}` → 201 |
| GET | /dirs?path= | 服务器端目录浏览（Workspace 选择器数据源） |

创建 Session 时，模型默认取 Project 默认模型，Workspace 默认自动创建临时目录，审批模式默认 `allow-all`。

### 用量与 Trace（Agent 级）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /usage | 用量统计，查询参数 `from`、`to`、`groupBy`、`agentId`、`provider`、`modelId` |
| GET | /agents/:agentId/traces | Trace 文件的日期 → Session 下钻结构 |
| GET | /agents/:agentId/traces/:sessionId/:index | 读取 Trace 事件（`offset` / `limit` 分页） |
| GET | /agents/:agentId/traces/:sessionId/:index/analysis | Trace 性能分析结果 |

### Session 级接口

以下路径均省略前缀 `/api/sessions/:sessionId`。Trace 与 Session 的存储模型见 [Session 与 Trace](/sessions-and-traces)。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | / | Session 信息 |
| PATCH | / | 更新：`{approvalMode?, archived?, title?}` |
| DELETE | / | 删除 Session（连同 Trace 与暂存文件） |
| GET | /messages | 完整 OmniMessage 历史 |
| GET | /stream | SSE 事件流（见下节） |
| POST | /tasks | 发起 Task：`{input: TaskInputPart[]}` → 202 |
| POST | /approvals/:toolCallId | 审批决定：`{decision}` 取 `allow` 或 `deny` → 204 |
| POST | /abort | 中断当前 Task：已触发返回 202，无任务返回 204 |
| POST | /compact | 触发上下文压缩：202；无可压缩内容返回 409 `nothing_to_compact` |
| GET | /files?path= | 浏览 Workspace 目录 |
| GET | /files/content?path=&download= | 读取 Workspace 文件（`download=1` 时作为附件下载） |
| POST | /files/stat | 批量存在性检查：`{paths}` |
| PUT | /files/content?path= | 上传文件：`{dataBase64}`，上限 14MB |
| GET | /traces | 本 Session 的 Trace 文件列表 |
| GET | /traces/:index | 读取 Trace 事件（分页） |
| GET | /traces/:index/analysis | Trace 性能分析结果 |
| GET | /scratchpad/:fileName | 读取会话暂存文件（如输入图片） |

通用约定：无权访问的 Session 一律返回 404，不泄露其存在性；每个 Session 同时只允许一个 Task 或压缩在运行，冲突时返回 409（`task_in_progress` / `compacting`）。

关键请求体（明确键名）：

```ts
// POST /api/sessions/:sessionId/tasks —— 发起一个 Task
interface TaskCreateRequest {
  input: TaskInputPart[];
}
type TaskInputPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: string };   // 粘贴图片以 data URL 上送

// POST /api/sessions/:sessionId/approvals/:toolCallId
interface ApprovalDecisionRequest {
  decision: "allow" | "deny";
}
```

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
| hello | 用户通道连接握手 |
| session_created | 新 Session 注册（如子 Agent 会话） |
| schedule_fired | 定时任务已触发并发送 |
| schedule_queued | 目标 Session 正在运行，本次触发已排队 |

### 投递保证

- 事件 id 按通道单调递增，形如 `<epoch>-<seq>`；
- 每通道维护有界重放缓冲（最近 1000 条事件或 2MB）；
- 携带 `Last-Event-ID` 重连时，命中缓冲则补发缺口；未命中则先发 `resync_required`，客户端重新拉取 `/messages` 后继续消费；
- 每 20 秒写一条心跳注释行；
- 事件次序：带 `Last-Event-ID` 重连时，**补发的缺口(或 `resync_required`)最先送达**，随后才是初始事件——权威的 `task_state` 快照与未决的 approval_request，再进入实时流；全新连接(无 `Last-Event-ID`)不重放缓冲，首个事件即为 `task_state` 快照。

### 推荐客户端模式

自带 Web App 的接入顺序：

1. 先连接 `/stream` 并缓冲收到的事件；
2. 再 GET `/messages` 拉取完整历史；
3. 回放缓冲区并对重叠消息去重；
4. 转入实时消费。

## 类型导入

全部 DTO 类型可从服务端包的子路径 `@prismshadow/penguin-server/api` 以 type-only 方式导入：

```ts
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
```
