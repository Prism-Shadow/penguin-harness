# Shell 行兜底改按解析出的 shell 判别，不再按平台

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `core`
- **PR:** [#487](https://github.com/Prism-Shadow/penguin-harness/pull/487)

[English](2026-08-27-shell-line-fallback-follows-the-shell.md)

组装期向 pre-`{{SHELL}}` 模板注入的 `- Shell: <name>` 行原先以「平台是否为 Windows」为判据。该判据改为「实际解析出的 shell 是什么」，macOS 与 Linux 上的 pre-`{{SHELL}}` Agent 同样会被告知自己跑在 `zsh`、`dash` 还是 `sh` 里。

## 细节

- 该行原先只在 Windows 上注入，因为别处的 shell 被当作必然是 bash。`system_config.yaml` 在 Agent 创建时固化、不自动升级，`{{SHELL}}` 占位符出现之前写就的模板根本没有 shell 行，模型便一直书写 bash 语法——`[[ ]]`、数组、`${var,,}`、进程替换。[POSIX shell 回退链](../0.2.7/2026-08-27-posix-shell-fallback.zh.md)终结了这条判据所依赖的前提：没有 bash 的机器会解析出 `zsh`、`dash` 或 `sh`，而恰恰是这批 pre-`{{SHELL}}` Agent 对此一无所知。
- 解析出 bash 时——任何平台上的绝大多数情形，包括装有 Git for Windows 的 Windows——组装结果逐字节不变，因为 bash 正是这批模板的隐含预期。这条逐字节不变的保证随之改以「解析出哪个 shell」而非「跑在哪个平台」陈述。
- 解析结果不是 bash 时，POSIX 走 Windows 早已在走的同一条注入路径：该行落在 `# Environment` 标题正下方，模板没有这一段时作为末行追加，已带 `- Shell:` 行的提示词保持原样。磁盘上的模板不被改写。
- 设计规格已同步改写（[penguin-harness-design #69](https://github.com/Prism-Shadow/penguin-harness-design/pull/69)）。
