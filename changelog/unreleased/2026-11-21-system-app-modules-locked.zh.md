# 系统应用背后的服务端模块不可停用

- **Date:** 2026-11-21
- **Type:** feature
- **Scope:** `server`, `web`, `core`, `docs`
- **PR:** [#1678](https://github.com/Prism-Shadow/penguin-harness/pull/1678)

[English](2026-11-21-system-app-modules-locked.md)

卡片写明 `preinstall: true`、且服务端模块在新的数据槽 `SystemAppModule.apps` 中声明了系统应用的内置插件，不能再停用，也不能从 Project 中移除（[PRFC-0036](https://github.com/Prism-Shadow/penguin-harness-design/pull/503)）。该数据槽的数据为 `{ app }`，即模块为该应用贡献的页面键。本版本自带的插件都没有这样声明。

## 细节

- 服务端从包的 `ifaces.json` 读出声明，不导入任何代码。`SystemAppModule` 加入平台模块树，模块向该数据槽的贡献因此在启动时被接受。`@prismshadow/penguin-server/plugin` 导出 `SystemAppData`、`SystemApps` 与 `SystemAppsSlots`；core 导出 `slotEntries`，从包的表里读出某个数据槽的条目。
- 管理员的停用，即以 `decline` 调用 `POST /api/admin/plugin-modules/decide`，返回 `409` `system_app_module_locked`。
- 会让本服务端不再为某个 Project 运行这种模块的插件表写入，返回同一个 `409`，不写入任何内容。这包括对 `/api/projects/:projectId/plugins/installed` 的 `PUT` 与 `DELETE`，无论改的是共享表还是本服务端自己的表。只改其他机器自己的表的写入，交由那台机器判定。
- 每一代启动时，在读取插件闭包之前，把这种模块重新列入配置里缺了它的每个 Project 的本服务端 `[plugins.<machineId>]` 表。与其他预装模块不同，手工移除不会保留。模块提供系统应用之前被管理员拒绝的请求行，由系统以 `builtin` 重新启用。
- `GET /api/admin/plugin-modules` 把这样的行标为 `systemApp: true`。在设置 › 插件的服务端模块请求中，它的一行显示为「系统应用，内置」，不提供停用。预装模块的行属于每个 Project，不再显示为 Project 已删除。
- 文档在描述移除服务端插件与 `[plugins]` 表的地方写明了这条规则。
