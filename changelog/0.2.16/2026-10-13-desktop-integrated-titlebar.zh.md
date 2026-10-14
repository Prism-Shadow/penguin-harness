# 桌面端：窗口标题栏并入应用

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `desktop`, `web`, `ui`
- **PR:** [#1099](https://github.com/Prism-Shadow/penguin-harness/pull/1099)

[English](2026-10-13-desktop-integrated-titlebar.md)

桌面窗口不再显示系统标题栏，改由 Web App 顶部的一条带取代。带上是主题自己的颜色，窗口控件叠在带上：macOS 是红绿灯，Windows 与 Linux 是最小化、最大化、关闭三个按钮。

## 细节

- 这条带就是拖动窗口的地方。
- Windows 与 Linux 的控件没有自己的底色，透出的是带的颜色，打开对话框时透出的是遮罩。符号随应用的明暗模式与主题即时变浅或变深，依据是页面写进 `<meta name="theme-color">` 的画布色。
- 应用壳、登录页、整页工作流视图，以及会贴到窗口顶端的浮层（对话框、抽屉、底部面板、灯箱、命令面板、提示条、查找栏、Harness 历史）都从带下方开始。在浏览器里这条带高度为零，页面没有任何移动。
- 自己不布局这条带的页面，比如附着模式下连到的旧版 server 所带的 Web App，由壳补上一条：窗口照样能拖动，控件下面也不会压着内容。
- Windows 与 Linux 上原本按 Alt 唤出的菜单栏随系统边框一起没了，因为 Electron 不给没有系统边框的窗口画菜单栏。菜单的快捷键（重新载入、开发者工具、缩放）照常可用，「Check for Updates…」在账户菜单的应用信息里仍能找到，「Install 'penguin' Command…」在这两个平台上则不再有菜单入口。
- 预览窗口与分离出的终端窗口仍用系统标题栏。
