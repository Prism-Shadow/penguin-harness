# 沙盒后端随 Docker 镜像到位，`PATH` 上没有 npm 时也能从 registry 现取

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `docker`, `docs`
- **PR:** [Myriad-Dreamin/penguin-harness#98](https://github.com/Myriad-Dreamin/penguin-harness/pull/98)

[English](2026-09-29-sandbox-on-every-channel.md)

此前内置插件经三条渠道到达服务器：CLI 安装包的 `lib/plugins`、桌面端的 `plugins/`、热推送。现在 Docker 镜像也带上它们。`@prismshadow/penguin-cli` 的 npm 全局安装不带：在那里，后端与其它插件一样在插件页上从 npm registry 现取进插件仓；`PATH` 上没有 npm 时，这次现取也能运行。随包下发的插件仍要等某个 Project 要求时才加载，沙盒模式默认仍是关闭。

## Docker 镜像

- 镜像用发布流程同一个 `build-plugins` 步骤构建内置插件前缀，放在 `/opt/penguin/lib/plugins`。它与 CLI 安装包里的是同一份，amd64 与 arm64 镜像共用。
- 服务器在入口的真实路径旁查找安装目录的前缀。镜像经由 `/usr/local/bin/penguin` 这个链接启动程序，服务器过去因此去 `/usr/local/plugins` 找。插件仓里的插件借用宿主的 `@prismshadow/penguin-core` 时，也按同样的方式解析。
- Docker 快速上手新增一节，讲在容器里运行沙盒：列出让 bubblewrap 能创建 user namespace 的参数（`seccomp`、`apparmor`、`systempaths` 设为 `unconfined`），并说明不放行时会怎样——沙盒卡片显示该后端未启用及原因，除关闭以外的每种模式都会拒绝 Agent 的每条命令。

## 从 registry 现取

- 在 Windows 上，现取经 shell 启动 `npm.cmd`（Node 启动 `.cmd` 文件必须经 shell），每个参数都按 cmd.exe 的规则加引号；会被 cmd.exe 展开或拆开的参数直接拒绝。
- 现取失败时报告 npm 的首条 `npm error` 行，跳过它之前的警告与之后的日志路径提示，并能处理 Windows 换行。
- 插件、Skill 与 Server API 三页不再说「不会下载任何东西」：构建未发布的包会从 registry 现取；`PUT` 加入本机没有的名称时返回 `plugin_not_installed`。
