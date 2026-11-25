# auth 域并入 library 包

- **Date:** 2026-11-24
- **Type:** refactor
- **Scope:** `server`, `library/auth`, `library/agent-api`, `core`

[English](2026-11-24-library-auth.md)

auth 域的服务与词汇搬到它们之前的契约包旁边。`@prismshadow/penguin-library-auth` 收下 auth 服务（admin 播种、登录、登出、改密码、会话校验）、密码哈希词汇、auth 中间件及其 cookie 与 origin 检查、本地 API token 的文件规则、进程级 auth 运行时状态、live-stream 注册表、离线的 `reset-admin-password` 救援、首登提示的渲染，以及直接把会话行写进 `web.db` 的 CLI token 铸造。Agent API 的公开路径前缀并入 `@prismshadow/penguin-library-agent-api`，会话 cookie 的名字随中间件走。

服务端 import 这些包；library 里没有任何代码反向 import 服务端。服务保留它的服务端装配：Provider 把服务的端口（users 与 auth-sessions 仓库、进程级状态、config 与 clock 能力、密码哈希器、首 Project provisioner）绑到服务端自己的机制上。API 的导出面通过 re-export 保持完整——仍在使用的仓内转发让旧 import 路径继续可用，服务端包的导出子路径保持原拼写。

## Details

- `library/auth` 增：`service`（带 `AuthConfig`／`AuthClock` 端口与 `InitialProjectProvisioner` 契约）、`password`、`middleware`（会话 cookie 名与 `OwnOrigin` 类型随工厂落地）、`api-token`、`runtime-state`、`require-human`、`live-streams`、`auth-token`、`initial-password`、`reset-admin-password`。
- `library/agent-api` 增：公开组的路径前缀（`AMSP_PREFIX`）。
- 涉及的每个接口类都以 `@Interface` 装饰器声明成员。
