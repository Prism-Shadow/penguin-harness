# 桌面端：应用窗口有了右键编辑菜单

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `desktop`
- **PR:** [#1567](https://github.com/Prism-Shadow/penguin-harness/pull/1567)
- **Issue:** [#1522](https://github.com/Prism-Shadow/penguin-harness/issues/1522)

[English](2026-11-16-desktop-edit-context-menu.md)

桌面端的主窗口及其打开的每个窗口有了原生右键菜单：在输入框中为「剪切」「复制」「粘贴」「全选」（只列该输入框可用的项），在其他位置的选中文字上为「复制」，其余位置不弹菜单。此前 Electron 什么也不显示。菜单文案随 Web App 语言。

## 细节

- 页面自己处理的右键（对话选区菜单、文件面板、终端）仍只打开页面自己的菜单。
- 「粘贴」走输入框自己的粘贴处理，因此往输入框粘贴图片或长文本与快捷键粘贴的效果一致。
- 内置浏览器的右键菜单从同一处取编辑项，表现不变。
