# CLI 重建为服务端瘦客户端，Agent 获得本机控制面

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `cli`, `server`, `core`, `web`, `docs`

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

## 「显示 CLI 会话」开关退役

经 API 创建的 Session 现在携带 `client` 标记（CLI 传 `"cli"`，缺省 `"web"`），存入既有列、
仅作来源信息——列表端点不再按客户端过滤，`cli=1` 查询参数、`showCliSessions` 偏好及其设置
开关一并移除。存量 CLI 直连留下的 Trace 由服务端每次启动的收编对账一次性并入；见
[向后兼容](2026-08-25-backward-compatibility.zh.md)。
