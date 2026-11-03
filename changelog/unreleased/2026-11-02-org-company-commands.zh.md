# org 命令归入 server 包，与其他 server 命令同路贡献

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `cli`

[English](2026-11-02-org-company-commands.md)

`penguin org` 现在归 server 包所有。这条命令与其赖以构建的客户端层——HTTP/SSE 客户端（含
server 未跑时的自动启动）、存储的登录会话、表格渲染与相对时间格式化、被搬代码读取的文案表——
从 CLI 包整体迁入 server 的 `src/cli`，以 `@prismshadow/penguin-server/cli` 子路径随包导出。
命令本身走贡献机制：server 里一个 `CompanyCommandsModule` 拥有 `commands` 槽位，`OrgCommand`
是它的一个子组件，`contributes["CompanyCommandsModule.commands"]` 条目是数据半、`@Bind`
字段是代码半，`bootCompanyCommands()` 对 server 自己生成的接口表 boot 该模块并取回收集到的
命令。CLI 在自己的命令之后 boot 这些命令，`penguin org` 行为不变；唯一可见的变化是 help
中 `org` 从 `schedule` 与 `browser` 之间移到内建命令之后。已从 CLI 包引入这些客户端助手的
使用方改走 server 的子路径；此后 server 增加公司命令不必等 CLI 先行发版。
