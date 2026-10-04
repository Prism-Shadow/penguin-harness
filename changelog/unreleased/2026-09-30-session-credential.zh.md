# Agent 的命令带的是它所在会话自己的凭据

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`, `scripts`
- **PR:** [Myriad-Dreamin/penguin-harness#121](https://github.com/Myriad-Dreamin/penguin-harness/pull/121)
- **Breaking:** yes — Agent 的命令只够得到它自己的会话和它要调用的路由

[English](2026-09-30-session-credential.md)

服务器驱动的会话，其工具子进程拿到的 `PENGUIN_API_TOKEN` 不再是管理员权限，而是这个会话自己的凭据：由启动 token 派生的密钥签名，下次重启即失效。

- 这个凭据只够得到 Agent 自己的命令要调用的路由，其余一律 `403 session_scope`：
  - 本 Agent 自己的会话，以及它用 `penguin run` 创建的会话；会话列表只保留这些；
  - 本 Project 的组织（desk 或工单会话只到自己的组织），请求声明的 `sessionId` / `agentId` 必须是凭据自己的，不带任何声明的写请求被拒绝——`penguin org` 的每一条写都带上调用方，包括 `handbook write` / `rm`、`calendar add` / `update` / `rm`、`hire`、`employee set`、`leave` 与 `desk renew`；`ticket attach` 的 `sessionId` 是被挂接的会话，调用方自己的会话改放 `callerSessionId`，因此 Agent 可以挂接同事的会话；
  - 本 Project 的 Agent 列表与创建 Agent、自己的定时任务、本 Project 的用量；
  - 遥测，须用 `session=` 指名自己的一个会话。
- 管理员路由、热更新（`/api/hmr`）、机器代理（`/server/…`）、其他 Project 以及其余所有路由都被拒绝。
- 服务器照旧把启动 token 写入 `<root>/api-token`（0600），它仍可作管理员的 Bearer。现在每个 App 启动时都会写这个文件，热推送因此能补回缺失的文件（本改动较早的构建曾删除它）。启动 token 不再交给任何会话。
- 人的登录 token（`penguin auth login`、`penguin auth token`）现在可以作为 `Authorization: Bearer` 使用。CLI 取凭据的次序：`PENGUIN_API_TOKEN`；会话之外、对本机的服务器，先用存在数据根目录里的登录，没有再读 `api-token` 文件；会话之内只用环境变量里的凭据，不从磁盘读任何凭据。
- `scripts/deploy.mjs` 在 `$(cat <root>/api-token)` 之外写明 `PENGUIN_API_TOKEN=$(penguin auth token)`。
- 文档：CLI 参考（服务器连接）、服务器 API（Bearer 凭据、会话凭据）、安全，以及 `penguin-orchestration` 技能。

## 兼容性

- 依赖 `api-token` 文件的命令行——会话之外的 CLI、执行 `$(cat <root>/api-token)` 的脚本——照旧可用，不需要任何动作；也可以改用 `penguin auth login`。
- 这个文件仍是管理员凭据：读得到数据根目录的人就是管理员。本改动只把它从工具子进程里拿走。会话凭据的签名密钥由启动 token 派生，热推送不换启动 token，只有重启才会替换。
- 后续：这个文件将由一项单独的改动删除，条件是读它的自动化（Agent 会话、roadmap 脚本、部署脚本）都已改用登录或会话凭据、`penguin auth token` 在每台机器上可用，且服务器日志中会话之外出示该文件的调用连续两周为零。
- 任务需要读其他 Agent 会话的 Agent（在整个 Project 上跑 `penguin ls` / `penguin logs`），现在只看得到本 Agent 的会话。
