# 握手把机器的进程带到本服务端的构建上

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1343](https://github.com/Prism-Shadow/penguin-harness/pull/1343)

[English](2026-10-26-machine-handshake-on-upgrade.md)

远端机器的进程与本服务端跑的不是同一份构建时，现在机器的 server 面会应答 `GET /api/handshake`：这份进程启动时装载的那份构建的版本与 platform 摘要。身份与本服务端要服务的构建不一致，或机器不认识这个入口时，本服务端把机器带到那份构建上，再问一次握手。仍不一致的一对记为 `incompatible`，这台机器的每条流都答一条指名该状态的错误。

## 细节

- `GET /api/handshake` 与版本询问走同一道门，只答一个 `identity`：服务进程启动时装载的那份构建，热更换不掉。应答里没有协议号，也没有能力清单。
- 身份一致时什么也不做。不一致，或早于这个入口的机器答 404 时，走本服务端既有的安装（`installOnRemote` 的 `forceInstaller`）把那份构建装上去、在原端口把 server 拉起来；起来仍不一致，再用既有的停止与拉起（`stopRemoteServer`、`startRemoteServer`）兜一次。每一档都有超时。
- 连接、开机巡检与 API socket 拨号被拒进同一个动作，同一台机器同时只跑一次；动作进行中的流答这台机器正在升级。
- 第二次握手仍不一致之后，同一个服务进程不再重跑这台机器，直到它的版本变化或人按下重试。这一终态只存内存，记着两侧身份与最后一档读数。
