# 桌面版：按 Alt 不再唤出菜单栏

- **Date:** 2026-09-05
- **Type:** fix
- **Scope:** `desktop`, `server`, `web`
- **PR:** [#625](https://github.com/Prism-Shadow/penguin-harness/pull/625)

[English](2026-09-05-desktop-menu-bar.md)

Windows 和 Linux 上，桌面版的菜单栏原本是"自动隐藏"：单按一次 Alt 就会把它唤出来并抢走键盘焦点，页面和终端里所有带 Alt 的组合键（Alt+B、Alt+.、Alt+Enter）都被吃掉。现在菜单栏彻底隐藏：单按 Alt 没有任何反应，应用菜单的快捷键照旧可用，偶尔需要菜单时按 F10 显示。macOS 的菜单在系统栏，不受影响。

## 细节

- 菜单里原有的两个动作——**安装 penguin 命令…** 和 **检查桌面版更新…**——通过命令面板（Ctrl+P）提供给管理员，任何登录到桌面版服务端的窗口都可以。**在 GitHub 上查看项目** 在任何环境的面板里都有。
- 面板通过服务端到达 shell，走的是更新中继已有的那条通道：`GET /api/command` 列出这台主机提供的命令（普通服务端为空），`POST /api/command/:command` 执行一条。仅管理员可用；不再限制为 shell 自己的窗口，因为命令作用的是主机，不是窗口。
- 从应用里打开的预览窗口同样隐藏菜单栏。
