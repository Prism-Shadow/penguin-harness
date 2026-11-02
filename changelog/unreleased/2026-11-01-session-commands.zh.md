# 资源命令移入 server 包

- **Date:** 2026-11-01
- **Type:** refactor
- **Scope:** `server`, `cli`

[English](2026-11-01-session-commands.md)

CLI 的五条资源命令——`agent`、`project`、`schedule`、`cost` 与 `config`——以及它们运行所依赖的共用件（连接客户端与其连接解析、登录会话、approval 询问、root 选项、语言表与列举助手）从 CLI 包移入 server 的 `src/cli/`，每条命令保持其贡献形状：同样的 `@Component` 条目、`cli.<key>` 的 id 与 `@Bind` 绑定的 register。CLI 经 `@prismshadow/penguin-server/cli` 引入它们；CLI 自有的命令，包括 serve 组与 `session`，留在原处。

`config` 命令拆为命令树、model 子命令、组连接辅助与列表格式化，让每个搬动或拆开的文件都小到一遍读完。message 表（`i18n.ts`）是特殊文件：整体搬进 server、单文件不拆——interface 与中英两张表内联一处。行为不变：每条命令的回答与数据路径都与从前一致。
