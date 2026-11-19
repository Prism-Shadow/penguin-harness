# 每个新建的 Agent 都装有目标模式与计划模式

- **Date:** 2026-11-19
- **Type:** feat
- **Scope:** `core`, `server`, `cli`, `web`, `plugins`, `docs`

[English](2026-11-19-default-install-plugins.md)

插件卡片可以声明 `defaultInstall: true`，`goal` 与 `plan` 的卡片即如此：此后新建的每个 Agent 都装有目标模式与计划模式。不选该模式时，它们的钩子不做任何事。

## 细节

- **卡片字段。** `defaultInstall`（缺省 false）与 `preinstall` 并列，后者仍只决定 `default_agent` 的预装集合。管理员装进服务端的包，无论卡片怎么写，都不算默认安装。插件库列表以 `PluginItem.defaultInstall` 标出这些插件。
- **创建接口。** `POST /api/projects/:projectId/agents` 增加 `defaultPlugins`（缺省 true）。为 true 时把默认安装的插件并入 `plugins`，两处都点名的插件只装一次。组织招聘走同一条路径，同样装上。从包导入的 Agent 保留包里已有的插件。
- **CLI。** `penguin agent create --no-default-plugins` 不装它们，帮助文字点名这些插件。
- **创建对话框。** 「插件」字段初始即勾选目标模式与计划模式，可以取消。其余未改动时，对话框照旧直接关闭、不询问。创建时发送屏幕上的名单，同时发送 `defaultPlugins: false`。
- **已有的 Agent。** 不补装。输入区「+」菜单另列出插件库里该 Agent 未装的输入框模式插件，置灰并带「安装」；选中即安装到当前对话所用的 Agent（与目标模式的安装提示走同一路径），并开启该模式。
