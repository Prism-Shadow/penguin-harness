# Agent 的命令带的是它所在会话自己的凭据，磁盘上不再留管理员 token

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `server`, `cli`, `docs`, `scripts`
- **PR:** [Myriad-Dreamin/penguin-harness#121](https://github.com/Myriad-Dreamin/penguin-harness/pull/121)
- **Breaking:** yes — `<root>/api-token` 不再存在；会话之外的命令行改为登录

[English](2026-09-30-session-credential.md)

服务器驱动的会话，其工具子进程拿到的 `PENGUIN_API_TOKEN` 不再是管理员权限，而是这个会话自己的凭据：由服务器保存在内存里的密钥签名，下次重启即失效。

- 这个凭据只够得到 Agent 自己的命令要调用的路由，其余一律 `403 session_scope`：
  - 本 Agent 自己的会话，以及它用 `penguin run` 创建的会话；会话列表只保留这些；
  - 本 Project 的组织（desk 或工单会话只到自己的组织），请求声明的 `sessionId` / `agentId` 必须是凭据自己的，不带任何声明的写请求被拒绝——`penguin org` 的每一条写都带上调用方，包括 `handbook write` / `rm`、`calendar add` / `update` / `rm`、`hire`、`employee set`、`leave` 与 `desk renew`；
  - 本 Project 的 Agent 列表与创建 Agent、自己的定时任务、本 Project 的用量；
  - 遥测，须用 `session=` 指名自己的一个会话。
- 管理员路由、热更新（`/api/hmr`）、机器代理（`/server/…`）、其他 Project 以及其余所有路由都被拒绝。
- 服务器不再写 `<root>/api-token`，并删除旧版本留下的这个文件。启动 token 只用来签发会话凭据，本身不再是凭据。
- 人的登录 token（`penguin auth login`、`penguin auth token`）现在可以作为 `Authorization: Bearer` 使用。会话之外，CLI 发送存在数据根目录里的登录；会话之内，它只发送环境变量里的凭据，不从磁盘读任何凭据。
- `scripts/deploy.mjs` 改为写明 `PENGUIN_API_TOKEN=$(penguin auth token)`。
- 文档：CLI 参考（服务器连接）、服务器 API（Bearer 凭据、会话凭据）、安全，以及 `penguin-orchestration` 技能。

## 兼容性

- 依赖 `api-token` 文件的命令行——会话之外的 CLI、执行 `$(cat <root>/api-token)` 的脚本——升级后得到 `401`。用 `penguin auth login` 登录一次；在拥有数据根目录的机器上也可以用 `penguin auth token`（不需要密码），或设置 `PENGUIN_API_TOKEN=$(penguin auth token)`。
- 热推送后新规则立即生效：旧运行时在启动时写下的文件不再能通过认证；文件本身在下次重启时删除。
- 任务需要读其他 Agent 会话的 Agent（在整个 Project 上跑 `penguin ls` / `penguin logs`），现在只看得到本 Agent 的会话。
