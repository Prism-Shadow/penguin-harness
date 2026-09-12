# 桌面应用的系统托盘图标

- **Date:** 2026-09-12
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`
- **PR:** [#707](https://github.com/Prism-Shadow/penguin-harness/pull/707)
- **Issue:** [#569](https://github.com/Prism-Shadow/penguin-harness/issues/569)

[English](2026-09-12-desktop-tray.md)

桌面应用运行期间在系统托盘（Windows 通知区、macOS 菜单栏、Linux 托盘）常驻一个图标，关闭主窗口默认改为收进托盘：内嵌 server 与后台任务继续运行，一次点击即可回到窗口。

## 细节

- 图标由 `scripts/render-icon.mjs` 从应用自身的品牌图形渲染，并入库到 `build/tray/`：Windows 与 Linux 用 32px 彩色图（另有 64px `@2x`），macOS 用 16px 单色 Template 图（另有 32px `@2x`），由菜单栏随明暗自动反色。`scripts/build-assets.mjs` 将整套复制进 `dist/tray/`，壳按应用目录的相对路径查找，源码运行与打包应用读同一套布局。提示文字为应用名，含开发实例的 dev 后缀。
- 左键点击图标把主窗口带到前台：隐藏则显示、最小化则还原、已关闭则重建。右键（macOS 亦可 Ctrl + 点击）弹出菜单：**Open PenguinHarness**；**New Session** 与 **Models**，在主窗口内导航到 `/chat` 与 `/models`；**Keep running in the tray when the window closes** 复选项；以及 **Quit**，走既有的优雅停止 server 的退出路径。
- 两种点击各按平台的支持程度落地：Linux 上菜单直接挂在图标上，由桌面环境决定哪一种点击打开它；macOS 与 Windows 上则是左键显示窗口、右键弹出菜单。
- **Keep running in the tray when the window closes** 默认开启，三平台关窗都只隐藏窗口。关掉它则恢复原有行为：macOS 关窗后应用保留在 Dock，Windows 与 Linux 关窗即退出。关掉托盘图标同理——托盘里没有图标可以把隐藏的窗口唤回来，关窗就直接放行，不再隐藏。
- **设置 › 外观** 新增 **托盘图标** 开关，默认开启，无需重启即时生效：关掉图标立刻从托盘消失，打开同样立刻回来。该行只在桌面应用自己的窗口里出现，浏览器登录同一个 server 时没有。开关经由客户端更新已有的消息通道抵达壳（`GET` / `PUT /api/desktop/tray`），窗口仍是纯浏览器，不引入自己的 IPC 通道。
- 两个偏好都存于 `userData/tray.json`；文件缺失或格式不对时各自按开启处理，写入失败只记日志，不做别的。
- 二次启动应用、以及 macOS 上点击 Dock 图标，现在都会把收进托盘的窗口重新显示出来，而不只是聚焦或重建窗口。
- 无法承载托盘图标的环境（没有托盘的 Linux 桌面、无头运行）会记录失败并继续运行，此时关窗仍保持各平台原有行为。
- 本批刻意不做：最近会话子菜单与图标上的「有任务在跑」指示。两者都需要壳向 server 查询状态，而目前二者之间的通道只往来 shutdown token、更新状态与这一个偏好。
