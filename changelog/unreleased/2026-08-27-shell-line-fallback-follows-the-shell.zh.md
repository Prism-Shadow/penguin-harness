# Shell 行兜底改按解析出的 shell 判别，不再按平台

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`

[English](2026-08-27-shell-line-fallback-follows-the-shell.md)

组装期向 pre-`{{SHELL}}` 模板注入的 `- Shell: <name>` 行原先以「平台是否为 Windows」为判据。该判据改为「实际解析出的 shell 是什么」，`{{SHELL}}` 占位符之前创建的 Agent 在 macOS 与 Linux 上也能被告知自己跑在 `zsh`、`dash` 还是 `sh` 里。

## 细节

- 这条兜底之所以存在，是因为 `system_config.yaml` 在 Agent 创建时固化、不自动升级：`{{SHELL}}` 占位符出现之前写就的模板根本没有 shell 行，模型会一直书写 bash 语法——`[[ ]]`、数组、`${var,,}`、进程替换。原先只在 Windows 上注入，理由是 POSIX 上 bash 本就是隐含预期，而这条前提已被 [POSIX shell 回退链](../0.2.7/2026-08-27-posix-shell-fallback.zh.md)终结：没有 bash 的机器会解析出 `zsh`、`dash` 或 `sh`，恰恰是这批 pre-`{{SHELL}}` Agent 对此一无所知。
- 解析出 bash 时——任何平台上的绝大多数情形，包括装有 Git for Windows 的 Windows——组装结果逐字节不变，因为 bash 正是这批模板的隐含预期。逐字节不变这条保证自此以「解析出哪个 shell」而非「跑在哪个平台」陈述。
- 解析结果不是 bash 时，POSIX 走 Windows 早已在走的同一条注入路径：该行落在 `# Environment` 标题正下方，模板没有这一段时作为末行追加，已带 `- Shell:` 行的提示词保持原样。磁盘上的模板不被改写。
