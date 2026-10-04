# 插件页面挂在已有页面之下，文档由插件自带

- **Date:** 2026-10-03
- **Type:** feat
- **Scope:** `web`, `server`, `plugins`

[English](2026-10-03-web-page-parent.md)

页面可以挂在另一个页面之下，插件也可以自带其页面框入的文档。

- 页面数据增加 `parent`（页面 key），Web 的 `WebAppModule.pages` 与服务器的 `WebModule.pages` 一致。服务器槽位同时声明 `title`、`titleZh`、`icon`，贡献页面的导航行因此有中英文名称与图标。`ContributionsResponse.pages` 的类型为 `WebPageContribution`。
- 侧边栏把子页面画成父页面下方的缩进行，随父页面所在的分区；子页面没有自己的置顶按钮，也不能拖动。折叠的 rail 不为它画行，打开它时父页面高亮。父页面不存在的页面既不在导航里也不被路由；页面只嵌套一层：父页面自身带 parent 的页面被丢弃。
- `GET /api/plugins/<包名>/ui/*` 提供已加载插件 `ui/` 目录下的文件，仅限登录用户。其他包一律 404，离开 `ui/` 的路径（含符号链接）同样 404。workflow 的 `ui/*` 路由改用同一份 MIME 表与响应头（`http/static-files.ts`）。
- `plugins/example-hello-page`：示例插件，在评估中心下添加 “Hello World” 页面，页面上的按钮点击后显示 “Hello World”。它是 private 包，不会发布；`scripts/build-plugins.mjs` 现在跳过 `plugins/example-*` 目录，因此也不会随构建内置。Web e2e 在运行时启用它。
