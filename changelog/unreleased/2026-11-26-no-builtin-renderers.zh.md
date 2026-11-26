# 贡献的界面一律以 iframe 绘制：删除 `builtin` 渲染器

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `server`, `web`, `library/workbench`, `plugins`, `ui-gallery`
- **Breaking:** yes — 写 `builtin` 渲染器的工作台标签页或服务端页面不再加载或显示，文件渲染规则与 `audio` 渲染器已删除

[English](2026-11-26-no-builtin-renderers.md)

所有插件应用只有一种工作台形式：处理器加 `ui/` 中以 iframe 绘制的页面。`builtin` 渲染器让贡献改为点名 Web App 自带的组件，现已删除，只为它存在的槽一并删除。

## 删除了什么

- **工作台标签页**：`WorkbenchTabRenderer`（`WebModule.sessionTabs`）只剩 `{ iframe: { src, pointerLock? } }`。清单中写别的渲染器的标签页让工作台加载失败，错误点名该条贡献，上一个实例继续服务。Web App 的原生工作台页面随之删除；较旧的机器列出的不带 iframe 的标签页不显示页面。
- **服务端页面与 Agent 设置标签页**：`RendererRef`（`WebModule.pages`、`WebModule.agentTabs`）只剩 `{ iframe: { src, namespace } }`。写 `builtin` 的贡献不再符合其槽：服务端在启动时丢弃它并在日志中点名，插件照常运行。Web App 的 `WebAppModule.pageRenderers` 槽已删除。
- **文件渲染规则**：`WebModule.fileRenderers`、`GET /api/contributions` 的 `fileRenderers` 字段（连同 `WebFileRendererData` 与 `WebFileRendererContribution`）、对话的 `ChatModule.fileRenderers` 槽，以及在回复段落下方播放所链接音频文件的 `audio` 渲染器均已删除。指向 Workspace 文件的链接仍是链接，点击在文件面板中打开；Task 下方的文件卡片照常列出回复提到的文件。
- `penguin-plugin` Skill（2026.11.26.2）与宿主写进工作台的 `.harness/README.md` 写明标签页的渲染器只有 `iframe`。

## 兼容性

- **写了 `builtin` 的插件或工作台**：改为贡献 iframe 页面——工作台标签页写 `{ "iframe": { "src": "ui/index.html" } }`，服务端页面或 Agent 设置标签页写 `{ "iframe": { "src": …, "namespace": … } }`，`src` 由模块自己的路由提供。Prism-Shadow 组织内没有插件写过它。仓内唯一的使用者是 `agent-evaluation` 的自进化工作台，下一次启动时由[向后兼容](2026-11-26-backward-compatibility.zh.md)中的迁移换装；改动过的副本在采用其插件卡片上的更新之前加载失败。
- **文件渲染规则**：`WebModule.fileRenderers` 贡献不对应任何槽，启动时被丢弃；`GET /api/contributions` 不再返回 `fileRenderers`。没有替代。
