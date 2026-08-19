# 桌面应用：品牌图标、完成通知、单用户模式、自带 penguin CLI

- **Date:** 2026-08-06
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`
- **PR:** [#226](https://github.com/Prism-Shadow/penguin-harness/pull/226)

[English](2026-08-06-desktop-app.md)

## 应用图标

每个平台现在都显示企鹅品牌标识，而不是 Electron 的默认图标：electron-builder 把提交在仓库中的 1024px PNG（由 `scripts/render-icon.mjs` 从品牌 SVG 渲染而来，它复用了 landing 包的 Playwright chromium）转换为 macOS/Windows 所需的 icns/ico，Linux 提供一套预渲染的 freedesktop 图标集，而窗口本身在 Linux/Windows 上也带上该图标。没有引入托盘——所谓「默认图标」只是因为窗口/应用图标从未被配置过。

## 任务完成通知

当桌面窗口未聚焦或已隐藏时，一次 Agent 运行结束会触发一条带 Session 标题的系统通知；点击它会聚焦窗口并打开该 Session。实现在渲染进程侧，基于标准的 Web Notification API，作用于会话列表的状态转变之上（首次观测绝不触发；逐次运行去重，并带陈旧快照的冷却期）——没有 preload、没有私有 IPC，遵循桌面外壳「就是一个普通浏览器窗口」的设计。仅对桌面外壳的会话生效（`sessionVia === "desktop"`），因此浏览器绝不会被弹出权限请求；Windows 的 toast 从外壳取得其 AppUserModelID。

## 单用户桌面模式

桌面应用现在明确是单用户的：在桌面外壳下，服务端会拒绝用户管理（`/api/admin/users*`）与 Project 成员路由，返回 `403 desktop_single_user`；而 Web 应用在桌面模式下隐藏 Users 菜单项、管理员用户页与 Project 成员小节。已有的用户与数据不受触碰，正常的多用户服务端也不受影响。

## 自带 penguin CLI

安装后的桌面应用现在包含完整的 CLI，通过把应用自己的 Electron 运行时当作 Node 来运行的启动器（`ELECTRON_RUN_AS_NODE`），无需系统安装 Node 即可使用：

- Linux deb：`/usr/bin/penguin` 在安装时自动创建（postinst 扩展了 electron-builder 的默认模板；绝不覆盖非符号链接的文件，且只有当它指向本应用时才在卸载时移除）。
- macOS / Windows / AppImage：一个原生菜单项「安装 'penguin' 命令…」，外加一次性的首次启动询问——macOS 建立 `/usr/local/bin/penguin` 符号链接（必要时一次管理员提权），Windows 把应用的 `bin` 目录追加到用户 PATH（幂等，新开的终端即可识别），AppImage 则写入一个 `~/.local/bin/penguin` 包装脚本，把 AppImage 自身当作 Node 运行。
