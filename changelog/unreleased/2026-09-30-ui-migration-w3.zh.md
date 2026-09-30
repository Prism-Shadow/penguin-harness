# 菜单、对话框、提示与 Toast 迁入共享 UI 包

- **Date:** 2026-09-30
- **Type:** refactor
- **Scope:** `ui`, `web`, `ui-gallery`

[English](2026-09-30-ui-migration-w3.md)

UI 包迁移的 W3 把 Web App 的浮层搬进 `@prismshadow/penguin-ui`：菜单与下拉框、提示、对话框与底部面板，以及 Toast。

## 迁入的内容

- **菜单**：`Dropdown`、`FormPicker`、`useRowContextMenu`，以及新增的 `Menu` 系列（`Menu`、`MenuItem`、`MenuRadioItem`、`MenuLabel`、`MenuSeparator`）；账户、项目、组织、列表设置、Dock、权限与文件菜单改用它，取代各自手写的行。
- **提示**：`Tooltip`、`TooltipLayer` 与 `TooltipPanel`，连同「文本已完整可见时不再显示提示」的规则。
- **对话框**：Esc 层栈（`pushEscLayer`、`useDialogLayer`、`useEscLayer`）、`Modal`、`ConfirmModal`、`PagedDialog`、`Drawer`、`Sheet` 与 `Lightbox`，以及驱动其动画的弹簧与面板物理。
- **Toast 与通知条**：`Toaster` 及其 store（`toastSuccess`、`toastInfo`、`toastAttention`、`toastError`）和 `NoticeStrip`。

## 细节

- `ConfirmModal` 的确认与取消文案改由每个调用方提供，包内不再给默认值。
- 包内无障碍兜底文案新增 Toast 栈的名称与关闭提示。
- 菜单行带上菜单角色（`menuitem`、`menuitemradio`），不再是普通按钮。
- 组件画廊的框架在底部面板或抽屉打开时保持高度，此前会无限增高。

## 默认主题（Primer）的可见变化

- **菜单**：所有菜单行统一内边距与悬停（`px-3 py-1.5`，悬停底色更浅）；当前项填充并打勾；行文字单行截断，不再换行；分组标签为 12 px；危险项的红色深一级。
- **项目与组织切换器**：当前项改为填充、中等字重并打勾，不再只是加粗；「+」与设置项配上图标；组织分组标签不再全大写。
- **Dock 添加菜单**：行去掉内缩的圆角悬停；文字更深，图标更小。
- **提示**：文字在浅色下深一级、深色下浅一级。
- **确认对话框（危险）**：警示标记的底圆由红色改为中性色。
- **分页对话框**：侧栏选中与悬停底色浅一级；分组标题改用 eyebrow 样式。
- **Lightbox**：遮罩变浅（共用对话框遮罩），关闭按钮改由 Token 绘制。
- **通知条与 Toast**：浅色下边框改为中性灰、文字浅一级；深色 Toast 底色饱和度降低。
- 对话框与菜单中若干 11 px 的说明文字改为 12 px。
