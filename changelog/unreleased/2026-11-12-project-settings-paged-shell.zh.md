# Project 设置滚动的是页面，不再带着子导航一起滚

- **Date:** 2026-11-12
- **Type:** fix
- **Scope:** `web`, `ui`, `ui-gallery`
- **PR:** [#1539](https://github.com/Prism-Shadow/penguin-harness/pull/1539)

[English](2026-11-12-project-settings-paged-shell.md)

Project 设置弹窗改用设置弹窗的外壳 `PagedDialog`。它的子导航原先位于弹窗正文唯一的滚动区内，长页面（安全策略的规则表）一滚动，子导航与标题就跟着滚走。现在每个子页都是子导航固定在内容区旁，只有内容区滚动，滚动条占满弹窗高度。

## 细节

- 弹窗采用外壳的样式：没有标题栏，内容区标题即当前子页名（连同其「?」），关闭按钮在标题旁。子导航、图标与带着未保存修改离开时的确认不变。
- `PagedDialogFoot`（`@prismshadow/penguin-ui`）是子页在内容滚动时贴住内容区底边的一行。安全策略页的分页器与「保存」改用它，不再按旧弹窗正文的内边距手工抵消。
- 画廊里的分页对话框打开在一个比弹窗长的页面上，底部一行放「保存」。
