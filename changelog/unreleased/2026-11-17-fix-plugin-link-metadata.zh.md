# 插件：损坏的链接保留链接标记与源路径，修复 `penguin plugin link` 多链接路径与纯库插件校验

- **Date:** 2026-11-17
- **Type:** fix
- **Scope:** `server`, `cli`
- **PR:** [#1600](https://github.com/Prism-Shadow/penguin-harness/pull/1600)

[English](2026-11-17-fix-plugin-link-metadata.md)

当已链接的作者目录在磁盘上无法读取时，已安装插件列表会丢弃 `linked` 和 `linkPath` 字段；`penguin plugin link` 则在打印路径时误取了第一个已链接条目，并在请求服务端之前拒绝了不含服务端模块的纯库插件。

## 细节

- `installedPluginRoutes`（`packages/server/src/http/routes/plugins-installed.ts`）中的已安装插件列表现在会在 `readPluginDeclaration` 失败的报错行中保留 `linked: true` 与 `linkPath`。
- `penguin plugin link` 现在按 `res.installed?.name` 在 `res.plugins` 中匹配对应条目，因此链接第二个本地插件时会输出它自身的路径，而不是第一个已链接插件的路径。
- `penguin plugin link` 现在与本地目录安装复用同一套包检查逻辑，与 `POST /api/projects/:projectId/plugins/installed/link` 一致地接受 Skills、钩子、MCP Server 与 workbench 插件包。
