# 对话框接住键盘焦点，关闭时再交还

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `web`
- **PR:** [#602](https://github.com/Prism-Shadow/penguin-harness/pull/602)

[English](2026-09-03-modal-focus-trap.md)

Web App 的 `Modal` 基础组件——应用里每一个对话框都建立在它之上——现在会在打开期间把键盘焦点
留在框内，关闭时再交还回去。

## 细节

- 打开对话框时，焦点移到框内第一个可聚焦控件；框内没有可聚焦控件时则落在对话框本身。内容自带
  `autoFocus` 的对话框保持它自己的选择。
- Tab 与 Shift+Tab 在框内循环、两端回绕，不再走出遮罩、落到背后的页面上。
- 关闭时焦点回到打开前持有它的元素，所有关闭路径一致：Escape、关闭按钮、点击遮罩、`open`
  变为 false，以及对话框直接卸载。
- `role="dialog"` 与 `aria-modal="true"` 现在出现在每一个对话框上。此前只设在无标题栏的变体
  （确认框与 `PagedDialog`）上，因此带标题的对话框在辅助技术里只是一个没有名字的普通容器。
- 带标题的对话框通过 `aria-labelledby` 由自己的标题命名，而不是再复制一份标题字符串。
- 从对话框内部打开的菜单或浮层仍然自己掌管焦点与 Escape，Escape 也仍然一次只关闭一层。
