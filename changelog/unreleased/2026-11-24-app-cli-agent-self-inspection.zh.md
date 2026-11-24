# 打通 Agent 应用自查：每会话隔离凭证、纯只读 `app info` 与编排 Skill

- **Date:** 2026-11-24
- **Type:** fix
- **Scope:** `server`, `cli`, `plugins/agent-development`

[English](2026-11-24-app-cli-agent-self-inspection.md)

任意用户 Project（包括内置 `admin` 无权访问的非 admin Project）中的 Agent 现在都可以在正常
Session 内通过 `penguin` CLI 自查应用列表、当前应用运行状态以及跨 Agent 应用会话，同时不触发
编译加载、不越权跨 Project：

- **每会话单 Project 凭证**：`controlEnv` 改为注入基于服务端启动密钥 HMAC 签发的每会话 token
  （`psess_<sessionId>.<mac>`），不再暴露原始管理员 API token。服务端校验后仅授予该会话所属
  Project 的 `member` 级访问权，严格拒绝跨 Project 访问（`404`）、owner 专属写操作
  （`403 owner_required`）、管理端路由、远程浏览器会话换取及用户表写接口。
- **纯只读 `app info` 与明确的状态拆分**：新增
  `GET /api/projects/:p/agents/:a/workbenches/:id/status`（`Workbenches.inspect`），不触发编译、
  加载或版本提交，分别报告应用自身开关（`enabled`）、Agent 总开关（`agentEnabled`）、当前是否
  有实例在服务（`serving` / `servingRevision`）、最近构建状态（`not_loaded` / `building` /
  `ready` / `failed`）与失败原因（`error`）。`penguin app info` 改走此只读接口；`penguin app history`
  携带 `?requireExists=1` 区分应用不存在（`404`）与尚无版本；`penguin app enable` 在开关已打开
  但加载失败时如实报告两项结果并以非零码退出。
- **损坏 `package.json` 诊断**：`package.json` 内容为 `null` 或非对象时，`readFolder` 与
  `readManifests` 不再抛 `TypeError`，`app-center?all=1` 与 `status` 保留该坏条目并报告
  `build: "failed"` 及可读错误说明。
- **子会话重启后继承 `PENGUIN_APP_ID` 与 `--app` 完整键筛选**：`registerChildSession` 将根会话的
  `appId` 持久化到子会话的数据库行，服务端重启后直接续跑子会话仍可注入 `PENGUIN_APP_ID`。
  `penguin session ls --app` 改为强制要求完整 `<agentId>/<workbenchId>`，`--agent-id` 仅承担执行
  Agent 的筛选语义，不再漏掉跨 Agent 会话。
- **Skill 与 CLI 依赖清理**：更新 `penguin-orchestration`（`@penguinharness/agent-development`
  `0.2.19`）补充应用自查命令、`PENGUIN_AGENT_ID` 与 `PENGUIN_APP_ID` 区别及状态字段含义；移除
  `app-id.ts` 对 `isomorphic-git` 的静态导入链。
