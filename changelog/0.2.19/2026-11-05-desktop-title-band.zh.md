# 桌面端标题带并入应用，窗口按钮由页面自己绘制

- **Date:** 2026-11-05
- **Type:** feature
- **Scope:** `desktop`, `ui`, `web`
- **PR:** [#1501](https://github.com/Prism-Shadow/penguin-harness/pull/1501)

[English](2026-11-05-desktop-title-band.md)

桌面端窗口顶部的带在各平台上都改用侧栏的底色，成为应用的一部分：左端放侧栏开关和后退、前进，侧栏右侧的主面板改成内缩的圆角卡片。Windows 和 Linux 上不再显示系统标题栏，最小化、最大化和关闭按钮由页面自己绘制。

## 标题带与卡片

- 侧栏开关与侧栏里原有的折叠按钮是同一个动作。在桌面窗口里只保留带上这一个，侧栏和折叠后的窄栏不再各带一个。
- 后退和前进沿窗口的浏览历史移动，那个方向没有页面时置灰。
- 带上其余的地方用来拖动窗口，双击可以最大化或还原。
- 主面板是一张卡片，与带、窗口右缘和底缘之间都留有间隙。卡片的底色、边线和圆角取当前主题的令牌，带和卡片周围的间隙取侧栏的颜色。
- 在浏览器里，Web App 的样子和改动前一样：没有带，也没有卡片，折叠按钮仍在侧栏里。

## 各平台

- macOS 保留红绿灯，带上的控件排在红绿灯之后。
- Windows 和 Linux 的窗口改用 `titleBarStyle: "hidden"`，不再设置 `titleBarOverlay`。页面在带的右端绘制最小化、最大化（最大化后变为还原）和关闭按钮，图标取当前主题的图标集；每套图标集为此新增了 `square` 和 `squareStack` 两个图形。鼠标悬停时按钮铺上主题的浅色底，关闭按钮变为危险色调。
- Windows 11 悬停系统最大化按钮时弹出的贴靠布局随系统按钮一起去掉了，仍可用 Win+Z 打开。

## 桥与兜底

- 主窗口新增了一个 preload，开启上下文隔离并设置 `sandbox: true`。它通过 `window.penguinWindow` 暴露 `minimize`、`toggleMaximize`、`close`、`isMaximized`、`onMaximizedChange`、`platform` 和 `bandHeight`，此外什么都不暴露。主进程只接受来自主窗口自身页面的这些消息。预览窗口、分离出的终端窗口和内置浏览器的标签页都没有 preload。
- 页面从一个 CSS 变量 `--window-band-height` 读取带高：macOS 上取自 Window Controls Overlay，Windows 和 Linux 上取自桥，浏览器里为零。所有贴窗口顶端的浮层都读这个变量。
- 根元素不带 `data-window-controls` 的页面（附着模式下较旧 server 的 Web App，或其他页面）由壳注入一条兜底的带：页面主体下移一个带高，顶端加一条拖动窗口的区域，Windows 和 Linux 上再加三个样式朴素的窗口按钮。它取代了原先的兜底样式表。
- 原先把页面主题色传给 `setTitleBarOverlay`、用来决定系统按钮符号颜色的代码已删除。`theme-color` meta 标签仍然保留，供手机浏览器使用。
- 菜单栏、F10、菜单快捷键和命令面板都没有变化。
