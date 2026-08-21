# 在账户菜单里更新桌面客户端

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`, `server`, `desktop`
- **PR:** [#386](https://github.com/Prism-Shadow/penguin-harness/pull/386)

[English](2026-08-20-client-update-button.md)

在桌面 shell 自身窗口的侧边栏用户菜单中新增了客户端更新行——正是服务端自更新行在桌面模式下隐藏的那个位置。该行端到端驱动 shell 的 electron-updater:检查、带进度的后台下载、经确认的重启安装(与 shell 原生提示同样的「打断运行中任务」警告),并同排展示当前安装的客户端版本。

## 细节

- 该行只出现在 shell 自身窗口(`desktopMode` 与 `desktop` 来源会话两个条件同时成立,即修改密码规则的反向应用):通过浏览器登录同一桌面模式服务器的会话既读不到本机的更新状态,也无法重启他人的 GUI 应用。服务端在路由上强制执行同一对条件。
- 新增桌面模式 API `/api/desktop/update`(Cookie 鉴权,不同于 shell 的 Bearer token shutdown 路由):`GET` 返回 shell 的更新快照,`POST /check` 与 `POST /install` 把命令转发给 shell。没有 shell 在听时命令返回 503 `shell_unreachable`。
- shell 与内嵌服务器通过既有的 utilityProcess 消息端口交换这些帧;窗口本身仍是纯浏览器环境,没有 preload、没有渲染进程 IPC,一切能力照旧经服务器 HTTP API 流转。
- 已下载的版本安然等待安装:有版本待装时自动再检查会主动停下(重新下载会让安装按钮之下的磁盘安装包失效),而一闪而过的检查、检查的网络失败等瞬态事件也不再掩盖「重启安装」这一步。
- 由该行发起的检查以 toast 精确报告一次结果——发现新版本(自动开始下载)、已下载待装、已是最新、不支持自更新、或检查失败——与服务端更新行手动检查的约定一致。不支持自更新的形态(开发运行、非 AppImage 的 Linux 安装)渲染为禁用行,原因放在 tooltip 里。
- 原生菜单流程(Check for Updates…、其对话框、下载完成后的重启提示)保持不变。
