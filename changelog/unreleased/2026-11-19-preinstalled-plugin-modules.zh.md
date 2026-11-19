# 预装的内置插件模块写入 Project 配置

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `server`, `db`, `docs`

[English](2026-11-19-preinstalled-plugin-modules.md)

卡片写明 `preinstall: true` 的内置插件，其服务端模块现在列入每个 Project（[PRFC-0030](https://github.com/Prism-Shadow/penguin-harness-design/pull/491)）。新建的 Project 把它们列入自己的 `[plugins.<machineId>]` 表。服务端第一次启动带有这样一个插件的构建时，把它一次性列入已有的每个 Project，并按插件记下。此后插件表归管理员：移除了，之后的启动不会写回。本版本之前建出的 Project 由一次性迁移处理，见[向后兼容](2026-11-19-backward-compatibility.zh.md)。

## 细节

- 预装模块须是内置的（包解析自运行中构建自带的前缀，且只新增 Module），带服务端模块，且卡片显式把 `preinstall` 写为 `true`。不写 `preinstall` 仍会预装插件的 Agent 内容，但对服务端模块不再算数。本版本自带的插件都没有这样声明，所以暂时不会列入任何东西。沙箱后端写的是 `false`，永远不会被列入。
- Project 创建的最后一步列入预装模块，覆盖以下途径：
  - `POST /api/projects`；
  - 新用户自己的 Project；
  - 首个管理员的 `default_project`，包括 CLI 事先建好的那个；
  - hub 经配置同步在机器上创建的 Project。

  该 Project 的表只为全部预装模块写一次。只有当其中某个还没有任何 Project 列入时才重新装配 App，且只一次。管理员已停用的模块跳过。失败只记日志，不让创建失败。
- 一次性列入在每一代启动时运行，位于数据库迁移之后、读取插件闭包之前。这一代因此启动时就加载了该模块，不另外重新装配。它只写本服务端自己的表，跳过已列入该包的 Project，每改一个 Project 记一行日志，管理员已停用的模块跳过。
- web.db 新表 `plugin_module_preinstalls`（迁移 `2026-11-19-plugin-module-preinstalls`，可在热推送时应用）为这样列入过的包各记一行。
- 一次性列入同时为该包补写 `plugin_module_requests` 中的一行：已启用、方式 `builtin`、没有请求人、不属于任何 Project。管理员因此能在服务端模块请求中看到它并停用。停用照旧：从每个 Project 的本机表移除，新建的 Project 与之后的启动都不再列入。重新启用一个已停用的预装模块，会以一次改动把它重新列入每个 Project 的本机表。
- 每台服务端只按自己的构建判断、只写自己的表。hub 从不写机器的表，配置同步也不动机器自己的表。
