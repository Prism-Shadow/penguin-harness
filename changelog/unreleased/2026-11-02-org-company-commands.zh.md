# org 命令归入 server 包，经由公司模块贡献

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `cli`

[English](2026-11-02-org-company-commands.md)

`penguin org` 现在归 server 包所有。命令代码并入资源命令已在 server 共用的客户端层——
HTTP/SSE 客户端（含 server 未跑时的自动启动）、存储的登录会话、表格渲染、文案表——连同它
需要的那一个会话信息助手；CLI 对外重导出这一个助手，自己的调用方不受影响。命令本身走贡献
机制：server 里一个 `CompanyCommandsModule` 拥有 `commands` 槽位，`OrgCommand` 是它的一个
子组件，`contributes["CompanyCommandsModule.commands"]` 条目是数据半、`@Bind` 字段是代码半，
`bootCompanyCommands()` 对 server 自己生成的接口表 boot 该模块并取回收集到的命令。CLI 在
自己的命令之后 boot 这些命令，`penguin org` 行为不变；唯一可见的变化是 help 中 `org` 从
`schedule` 与 `browser` 之间移到内建命令之后。此后 server 增加公司命令不必等 CLI 先行发版，
其他包也可用同样的方式向同一槽位贡献自己的命令。
