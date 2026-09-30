# 文件、应用外壳与停靠面板迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w7.md)

UI 包迁移的 W7 把应用的框架拆分进 `@prismshadow/penguin-ui`：文件面板、带侧栏与图标栏的窗口，以及停靠面板。各容器的路径与行为保留在 Web App。

## 迁入的内容

- **文件**：`FileTree`、`FileBrowser`、文件菜单的行、原地编辑器，以及文件面板的 `TreePane`、`PreviewPane`、`DropOverlay`、`Breadcrumbs`。指针拖动随之迁入，并新增 `ResizeHandle` 与 `SplitPane`，现用于文件面板的分隔条与停靠面板的两个拖动条。
- **外壳**：`AppShell`、`Rail`、`MobileTopBar`、`SidebarFrame`、`SessionRow`；侧栏的页面链接改为 `NavRow`，对话的菜单行改为 `MenuItem`。
- **停靠面板**：`DockFrame`、`DockTabs`、`DockPicker`、`PanelsToolbar`，以及浮动启动器的 `LauncherBall` 与 `LauncherFan`。

## 细节

- 终端自身的明暗调色板留在 Web App：它按设计处在令牌体系之外。
- 启动器尺寸不变；说明文字保持 13 px，并随字号设置缩放。
- 停靠面板的标签改为标准的标签列表（`role="tab"`）。
- 导航列的悬停与选中底色改为文字色的淡填充，公司模式的频道行、工位行与「临时」分组的行同样采用。

## 通用主题下可见的变化

- **侧栏与图标栏**：
  - 侧栏的页面链接静止时浅一级（gray-600 → gray-500），过长时截断而不换行。
  - 各行间距收紧 1 px。
  - 对话的时间为 12 px。
- **文件面板**：
  - 分隔条取信息色调。
  - 浮动按钮组与对话区的拖放遮罩不再模糊。
  - 文件大小与截断提示为 12 px。
- **停靠面板**：
  - 拖动条同样取信息色调。
  - 选择面板的快捷键改为键帽样式。
  - 底部拖动条的光标为 `row-resize`。
  - 触屏上的最大化按钮改用图标注册表的四角括号，比原先向外多出 1 px。
- **深色模式**：导航列的底色改为次级表面（#1a1a1a → #202020）。
