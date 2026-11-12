# 插件市场的卡片、状态标记与详情行移入共享 UI 包

- **Date:** 2026-11-12
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`
- **PR:** [#1545](https://github.com/Prism-Shadow/penguin-harness/pull/1545)

[English](2026-11-12-ui-entity-card-and-sub-page-bar.md)

插件市场页原先手写的几个部件改为 `@prismshadow/penguin-ui` 的模块，页面改用它们重建，Agent 设置页因此可以用同一套部件展示插件。页面看起来与之前一致。

## 细节

- UI 包新增模块，只接收 props，各有画廊分组与行为测试：`EntityCard`、`EntityCardGrid` 与 `EntityCardAction`（网格中一项事物的卡片及其操作）、`MetaLine`（事实行）、`StatusMark`（带语气的图形加次要墨色文字的状态）、`GlyphAction`（无底框的图形链接或按钮）、`FactList` / `FactRow`（详情中一行一项的列表）与 `SubPageBar`（标签页下以分段选择切换的子页面，行尾是当前子页面的操作）。
- `ListRow` 新增 `titleTrail`：紧跟标题的标记与标签，行窄时折到标题下方；`SettingsList` 新增 `loading` 与 `empty`。
- 插件市场的卡片及其按钮、状态标记、详情弹窗的事实行、包链接与 MCP 服务器行，以及卡片网格，改由这些模块绘制。状态图形改用主题的语气 token，不再用应用自己的调色对；卡片网格（连同加载占位）在自身所在的栏放得下两张卡片时才每行两张，不再按窗口宽度判断，栏宽不足两张卡片时每行一张。
- 详情弹窗的「工作台」一节与「MCP 服务器」一节同样，每个工作台一行事实行，带工作台图形。
- 供 Agent 设置页共用的 web 模块：`PluginUpdateParts`（更新会改写每个 Agent 上的哪些部件）、`agent-plugin-writes.ts`（在单个 Agent 上安装、卸载，并写入共享的已装清单缓存）与 `agentInstallable`。详情弹窗的状态标记改由调用方传入，新增 `afterAbout` 一节与 `machineId`，README 与文件从该服务端读取；`getPluginFiles` 与 `getLibraryPluginReadme` 增加可选的 `machineId`。
