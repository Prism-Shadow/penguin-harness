# API 密钥轮换、健康遥测与 Windows Git Bash Shell 解析器修复

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#696](https://github.com/Prism-Shadow/penguin-harness/pull/696)

[English](2026-09-11-key-rotation-and-shell-resolver.md)

新增了面向多 API 密钥的原生轮换调度机制，支持 HTTP 429 速率限制自动冷却与 HTTP 401 鉴权失败永久剔除；同时修复了 Windows 平台下误将命令调度至 WSL bash 导致驱动器路径执行失败的问题。

## 细节

- **核心轮换器（`ApiKeyRotator`）与子代理分配：**
  - 支持从数组或逗号、分号、换行分隔的多行文本中自动解析并去重多个 API 密钥。
  - 通过轮询（Round-Robin）或子代理并发分配策略（`auto`、`least_busy`、`round_robin`、`dedicated`、`inherit`）在可用健康密钥之间智能分配推理调用。
  - 实现子代理活跃并发租约追踪（`activeLeases`），防止子代理并发撞限，并在完成、中断或淘汰时自动释放租约。
  - 遇到 429 限制时自动将当前密钥挂起进入冷却倒计时，并无缝自动故障转移到其余备用密钥。
  - 遇到 401 无效凭据时永久标记剔除，避免重复浪费调用，直到用户重置或重新配置。
  - 提供成功/失败计数、最后使用时间、活跃租约以及冷却到期时间等细粒度指标。
- **子代理断点恢复（Resumability）：**
  - 在子代理中断、超时或执行失败时完整保留其会话状态与历史记录（`wasAbortedOrInterrupted`），不再粗暴丢弃上下文。
  - 为 `input_subagent` 工具扩展 `resume?: boolean` 参数，允许调用者从断点处继续执行。
  - 新增 `POST /api/projects/:projectId/sessions/:sessionId/subagents/:childSessionId/resume` 接口，并在前端智能体面板中提供直观的**恢复**（Resume）操作按钮。
- **服务端健康遥测与重置接口：**
  - 新增进程内服务 `ModelKeyHealthService`，维护每个模型的脱敏注册表（包含 `activeLeases`）；它与活跃 Session 轮换器分离，重启后不保留。
  - 开放 `GET /api/projects/:projectId/models/keys/health` 与 `POST /api/projects/:projectId/models/keys/reset` 路由。
  - 严格脱敏密钥，日志与接口仅暴露首尾安全掩码（`sk-...1234`），保障生产安全。
- **Web 端 API 跟踪器面板与多密钥管理：**
  - 新增侧边停靠面板 **API 跟踪器**（`apiTracker`），提供三个实时标签页：密钥健康（脱敏密钥、色调徽标、活跃租约、倒计时、成功率）、错误日志（实时流式状态码与错误详情）以及用量与费用统计。
  - 模型设置弹窗支持单密钥与多密钥切换，支持多行或逗号分隔批量粘贴，实时展示状态标签与重置按钮。
  - 智能体视图为中断或失败的子代理提供一键**恢复**功能。
  - 完整的中英文双语界面支持。
- **Windows Shell 解析器优化（`isWslExecutable`）：**
  - 增加了对 WSL bash（`System32\bash.exe`、`wsl.exe`）的主动识别与排除。
  - 枚举 `PATH` 上的 `bash`，再探测所发现 `git.exe` 的相邻目录；之后才回退到内置 shell 与 PowerShell，解析结果持续到进程重启。
- **完整文档更新：**
  - 更新了中英文 `README.md`，涵盖子代理密钥分配策略、429 自动退避重试、子代理断点续跑以及 API 跟踪器面板。
  - 更新了 `packages/docs/content/` 下的模型（`models`）、工具（`tools`）、Web 界面（`web-app`）与服务端接口（`server-api`）文档。
