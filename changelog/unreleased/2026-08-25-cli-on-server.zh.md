# CLI 重建为服务端瘦客户端，Agent 获得本机控制面

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `cli`, `server`, `core`, `web`, `docs`
- **PR:** [#466](https://github.com/Prism-Shadow/penguin-harness/pull/466)

[English](2026-08-25-cli-on-server.md)

`penguin run` 与 `penguin chat` 重建在服务端 API 之上——CLI 只负责解析参数、发 HTTP/SSE
请求并渲染流式 OmniMessage，Task 本身在服务端执行。CLI 创建的一切都出现在 Web App 里
（反之亦然）；新增的一组命令让 PenguinHarness 内部的 Agent 也能经 CLI 驱动 harness：列出
会话、向会话发消息、跟随日志、创建 Agent、查询成本与定时任务。连接本机服务器的 CLI 无需
登录。

## 命令面

```
penguin run -m <msg> [--project-id] [--agent-id] [--workspace] [--model-id --provider]
            [--approve] [--thinking] [--session <id>] [--background] [--goal [budget]]
            [--json] [--server <url>]
penguin chat [--project-id] [--agent-id] [--workspace] [--model-id --provider] [--approve]
             [--thinking] [--resume [id]] [--verbose] [--server]
penguin ls [--project-id] [--agent-id] [-a|--all] [--json] [--server]
penguin input <session_id> -m <text> [--no-wait] [--json] [--server]
penguin logs <session_id> [--tail <n>] [-f|--follow] [--json] [--server]
penguin agent ls|create ...
penguin project ls
penguin cost [--days <n>] [--from --to] [--by date|agent|model|session] ...
penguin schedule ls ...
```

- `run` 创建 Session（或以 `--session` 复用——接受完整 id 或任意唯一片段，如 `penguin ls`
  打印的末尾 8 位十六进制），提交任务并渲染流式输出直至统计行，完成退出 0（goal 运行仅
  `complete` 退出 0）。`--background` 立即返回 session id；`--json` 输出最终的
  `{sessionId, status, text}`。
- `input` 对运行中的会话是插话，对空闲会话发起新任务；`logs -f` 只读跟随实时流。
- `--project-id` / `--agent-id` 缺省依次取 `PENGUIN_PROJECT_ID` / `PENGUIN_AGENT_ID`，再退到
  `default_project` / `default_agent`。

## 连接与鉴权

- 解析顺序：`--server` > `PENGUIN_API_URL` > 数据根目录下存活的 `server.lock` > 自动拉起
  （分离子进程 `node <cli> server`、`PORT=0`，日志写 `<root>/logs/server-auto-<date>.log`；
  并发拉起竞争的输家自行退出，双方都附着到赢家的锁）。
- 服务端每次启动铸造本机 API token 并写入 `<root>/api-token`（0600）。`authMiddleware`
  接受 `Authorization: Bearer`（恒定时比较），认证为内置 admin——SSE 端点亦然。CLI 依次取
  `PENGUIN_API_TOKEN`、token 文件（仅回环目标；401 时重读一次）；远端 `--server` 无
  `PENGUIN_API_TOKEN` 时明确拒绝并给出设置指引。
- 授权模型是有意为之：对数据根目录的本机文件系统访问本就等于管理员权限——与
  `penguin server reset-admin-password` 同一条规则。早先的磁盘 token 正是因这一性质被移除；
  该反对被有意反转，因为 Agent 经 CLI 驱动自己的服务器正是要交付的功能。

## 控制环境注入

服务端驱动的会话向每个工具子进程注入：`PENGUIN_API_URL`（服务端自身规范地址）、
`PENGUIN_API_TOKEN`（本次启动的 token）、`PENGUIN_PROJECT_ID`、`PENGUIN_AGENT_ID`、
`PENGUIN_SESSION_ID`。接缝是 `CreateAgentOptions.controlEnv`——与 `proxyEnv` 同构的策略
getter：core 按各 Session 自身坐标绑定、逐次 spawn 重新求值；注入条目覆盖 vault 同名条目；
子会话以自己的 id 求值；SDK / CLI 直连嵌入不提供该选项时不注入任何内容。

## Agent 侧易用性

- **调用方上下文缺省值**：在 harness Agent 内部（存在 `PENGUIN_SESSION_ID`）时，`run` /
  `chat` 新建会话的每个未指定字段都缺省取调用方会话的实时值（`GET
  /api/sessions/$PENGUIN_SESSION_ID`）——Workspace、模型对、审批模式与思考等级——与
  `run_subagent` 派生子会话的继承同一条约定。逐字段优先级：显式选项 > 调用方值 > 普通缺省；
  查询失败打印暗色警告并回落；不在 Agent 内时一切不变。
- **`--timeout <duration>` 软让出**（`run` 非 background、`input`、`logs -f`）：最多等待该
  预算（`30s` / `5m` / `2h` 或纯数字秒数），到期干净脱开——退出 0，打印一行暗色「仍在运行」
  （含 session id；`--json` 下 `status: "running"`）——任务继续在服务端运行，与命令工具的
  yield 窗口语义互为镜像。不带该选项即无限等待。
- **不带 `-m` 的 `penguin input <session>` 即轮询**：打印该会话最近一条完整助手文本（幂等的
  「最新答案」快照；跳过思考与工具输出），与 `input_subagent` 的空 prompt 语义互为镜像——不
  排队、不插话。运行中的会话先静默等待（给出 `--timeout` 时以其为限）；到期仍在运行则打印当
  前最新文本并附仍在运行提示。
- **`--timeout 0` 取代 `input --no-wait`**（该表面尚未发布）：一个 timeout 旋钮同时覆盖「不
  等待」——送达后立即返回并附仍在运行提示（`--json` 下为 `{sessionId, status: "running"}`）；
  `run --timeout 0` 对称同义，而 `run --background` 保留为新建任务的惯用「发完即走」（为脚本
  打印裸 session id）。
- **`penguin ls --days <n>`**：只列最近 n 个自然日内活跃过的会话（今天算第 1 天，与
  `cost --days` 同口径）；可与 `-a`、`--json` 组合。
- **`penguin schedule add|update|rm <name>`**：映射既有 schedules API 的带校验写入器——由 API
  写 TOML 文件，文件仍为唯一真相源（与模型配置 / vault 同一模式），API 错误原样透出、校验同
  步呈现。目标为 `--session-id` 与新建会话形式二选一（XOR）；`--start-at now` 即当前时刻。一
  处有意分歧：`add` 缺省启用（`--disabled` 关闭；原始文件的 enabled=false 缺省留给手编）；
  `update` 为读改写；`rm` 直接删除、不做确认。

## 「显示 CLI 会话」开关退役

经 API 创建的 Session 现在携带 `client` 标记（CLI 传 `"cli"`，缺省 `"web"`），存入既有列、
仅作来源信息——列表端点不再按客户端过滤，`cli=1` 查询参数、`showCliSessions` 偏好及其设置
开关一并移除。存量 CLI 直连留下的 Trace 由服务端每次启动的收编对账一次性并入；见
[向后兼容](2026-08-25-backward-compatibility.zh.md)。
