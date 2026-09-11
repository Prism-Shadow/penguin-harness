# API 密钥轮换、健康遥测与 Windows Git Bash Shell 解析器修复

- **Date:** 2026-09-11
- **Type:** feature
- **Scope:** `core`, `server`, `web`
- **PR:** [#696](https://github.com/Prism-Shadow/penguin-harness/pull/696)

[English](2026-09-11-key-rotation-and-shell-resolver.md)

新增了面向多 API 密钥的原生轮换调度机制，支持 HTTP 429 速率限制自动冷却与 HTTP 401 鉴权失败永久剔除；同时修复了 Windows 平台下误将命令调度至 WSL bash 导致驱动器路径执行失败的问题。

## 细节

- **核心轮换器（`ApiKeyRotator`）：**
  - 支持从数组或逗号、分号、换行分隔的多行文本中自动解析并去重多个 API 密钥。
  - 通过轮询（Round-Robin）在可用健康密钥之间均匀分配推理调用。
  - 遇到 429 限制时自动将当前密钥挂起进入冷却倒计时，并无缝自动故障转移到其余备用密钥。
  - 遇到 401 无效凭据时永久标记剔除，避免重复浪费调用，直到用户重置或重新配置。
  - 提供成功/失败计数、最后使用时间以及冷却到期时间等细粒度指标。
- **服务端健康遥测与重置接口：**
  - 新增进程内服务 `ModelKeyHealthService`，维护每个模型的脱敏注册表；它与活跃 Session 轮换器分离，重启后不保留。
  - 开放 `GET /api/projects/:projectId/models/keys/health` 与 `POST /api/projects/:projectId/models/keys/reset` 路由。
  - 严格脱敏密钥，日志与接口仅暴露首尾安全掩码（`sk-...1234`），保障生产安全。
- **Web 端多密钥录入与状态徽标：**
  - 模型设置弹窗支持单密钥与多密钥切换，支持多行或逗号分隔批量粘贴。
  - 采用语义化色调令牌（`tone.ts`）展示实时状态徽标：绿色（活跃健康）、黄色（冷却中及剩余倒计时）、红色（401 已剔除）。
  - 提供“重置密钥”操作，清除服务端注册表状态与计数；不会修改活跃 Session 的轮换器或已保存凭据。
- **Windows Shell 解析器优化（`isWslExecutable`）：**
  - 增加了对 WSL bash（`System32\bash.exe`、`wsl.exe`）的主动识别与排除。
  - 枚举 `PATH` 上的 `bash`，再探测所发现 `git.exe` 的相邻目录；之后才回退到内置 shell 与 PowerShell，解析结果持续到进程重启。
