# 把插件安装到 Agent 时一并启用它的服务端模块

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `core`, `db`
- **PR:** [#1636](https://github.com/Prism-Shadow/penguin-harness/pull/1636)

[English](2026-11-19-plugin-module-on-agent-install.md)

同时带服务端模块的插件库插件，安装到 Agent 时会一并处理它的服务端模块（[PRFC-0031](https://github.com/Prism-Shadow/penguin-harness-design/pull/479)）。Agent 部分照旧写入，模块则在该 Agent 所在的服务端上按同一条规则处理：内置模块（运行中的构建自带该包，且只新增 Module）列入该 Project 自己的 `[plugins.<machineId>]` 表并立即加载；非内置的包若模块已在运行，无需任何操作；模块未运行时，管理员安装即列入，成员安装则记为一条等管理员处理的请求。

## 细节

- `POST /api/projects/:p/agents/:a/plugins` 的最后一步处理服务端模块，答复带 `moduleActions`（已启用、已请求、被停用或启动失败）；它与该 Agent 的 `GET` 都带 `modules`：每个带服务端模块的插件库插件在本服务端的状态、本 Project 是否列入，以及待处理的请求。带 `skipModules: true` 时只写 Agent 部分。
- `GET /api/projects/:p/plugins/installed` 同样带 `modules`；`GET /api/plugins` 以 `modules: true` 标出同时带服务端模块的插件。
- `POST /api/projects/:p/plugins/modules { plugin }`（任意成员）以按钮的方式应用同一规则；`GET /api/admin/plugin-modules` 列出请求与决定及各模块的状态，`POST /api/admin/plugin-modules/decide { package, decision }` 启用或拒绝其中一个；两个管理员接口都不要求是该 Project 的成员。拒绝一个已启用的模块即停用它：它从每个 Project 的本机表中移除，此后的安装不再启用它，直到管理员重新启用。
- web.db 新增 `plugin_module_requests` 表，每个包一行：谁、为哪个 Project 与 Agent 请求，以及模块以何种方式启用（`builtin`、`admin` 或 `approval`）或已被拒绝；每次变化另写一行写明操作者的日志。`plugin_modules_changed` 事件通知管理员与该 Project 的用户重新读取。
- 列入后立即重新装配 App，与管理员的插件改动走同一个队列；运行中的 Task、待审批的调用与排队的后续输入原样延续。导致启动失败的模块被撤销，安装照常答复。卸载插件不停用它的模块。
- 创建 Agent 时选装的插件同样处理其模块；公司模式在招募或创建组织完成之后处理，对账只启用内置模块。
- 已装插件路由的文件头不再声称插件改动会停下运行中的 Task；其插件表编辑原样移入 `services/plugin-tables.ts`，与新服务共用。
