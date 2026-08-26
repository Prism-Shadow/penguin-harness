# 向后兼容

- **Date:** 2026-08-25
- **Type:** process
- **Scope:** `cli`, `server`, `web`, `desktop`
- **PR:** [#466](https://github.com/Prism-Shadow/penguin-harness/pull/466), [#477](https://github.com/Prism-Shadow/penguin-harness/pull/477)
- **Breaking:** yes — 旧 CLI 二进制直连 core、可离线运行；重建后的命令依赖服务端（本机自动拉起），按用户的「显示 CLI 会话」偏好随之移除；签名主体更换后，从 0.2.4 安装的 Windows 桌面端会拒绝本次更新

[English](2026-08-25-backward-compatibility.md)

本次发布触及四类存量状态——三类来自 CLI 直连服务端这一批改动，一类来自 Windows 签名主体更换。
不处理会发生什么、以及选定的方案：

## 磁盘上的存量 CLI 直连 Trace

旧的 core 直连 CLI 跑出的会话只存在于 Trace 文件里，服务端会话索引中没有对应行。若不处
理，在列表改为纯 SQLite 渲染后它们会从所有列表里悄然消失。选定方案：**启动收编对账**——
服务端每次启动遍历一次 Trace 树（复用既有的 mtime 门控 TraceIndexService 发现路径），把
每个无索引会话收编为 `client:'cli'` 索引行；此后列表永不扫描文件系统。对账幂等，保留期
与「磁盘上可能存在旧 CLI Trace」等长，即无限期保留（代价可忽略：每次启动一轮门控对账）；
移除它会让从旧备份还原的数据根丢失这些会话。

## 退役的 `showCliSessions` 偏好

按用户的偏好键与 `cli=1` 查询参数一并移除；所有会话恒被列出。`ui_prefs` 中已存的
`showCliSessions` 键由浅合并直接忽略——陈旧 JSON 键本就被设计为永久容忍，因此不跑迁移、
也无需清理。此前保持开关关闭的用户现在会在侧栏与轨迹树里看到自己的旧 CLI 会话；这是有意
的新行为，不是缺陷。仍发送 `cli=1` 的外部 API 调用方会看到参数被忽略（列表本就是他们所要
的超集）。

## 旧 CLI 二进制与新传输

旧的 `penguin run` / `penguin chat` 在进程内直连 core 执行任务，无需服务端，留下的 Trace
服务端不可见。重建后的命令走服务端：本机没有服务器时自动拉起一个（仅在入口无法重跑时报
明确错误，如 tsx 开发态运行）。接受并在此声明的不兼容：完全离线的 core 直连执行不再是
CLI 的一种模式——SDK 为嵌入方保留该能力。旧二进制在升级前仍按自己的 core 正常工作，磁盘
上没有任何东西会阻止它们。

## Windows 更新签名主体

v0.2.4 及此前的安装包由 `RushRush Network Technology Ltd` 签名，每个已安装的客户端都把这一个名字
作为 `publisherName` 记进了自己的 `app-update.yml`。本次发布起的构建改由
`NaisNet Technology Co., Ltd.` 签名。electron-updater 用**已安装客户端**自己持有的那份名单校验下载
到的更新，而这份文件在安装时写定，本仓库中的任何改动都够不到已经存在的客户端：从 0.2.4 及更早版本
安装的 Windows 桌面端会拒绝本次更新，需手动重装。这一不兼容被接受并在此声明。`~/.penguin/data` 下
的数据不受影响，CLI、Linux 包与经过公证的 macOS 构建都不涉及。

向后看，该字段是一个列表而非单个名字，其中同时保留当前主体与上一个主体——每个都按 electron-updater
比对时使用的完整 DN 与裸 CN 两种写法各列一条。因此由本次发布安装的客户端仍能接受下一张证书签名的构
建，下一次轮换不会重演此事。某个主体在「已无受支持的客户端由使用它签名的版本安装」之后从列表中移
除；在此之前，它会被并非由它签名的构建所信任，这是该方案的代价。

## 兼容性

磁盘上没有任何东西需要迁移；在 macOS、Linux 与 CLI 上也不需要做任何事就能让现有安装继续工作。

Windows 桌面端请手动重装一次，从 [penguin.ooo/download](https://penguin.ooo/download) 下载。从
0.2.4 及更早版本安装的客户端无法自动更新到新的签名主体，因为它在安装时记下的签名主体列表里只有旧
的那一个；从这次重装起自动更新恢复正常，且两个主体都接受。参见
[签名条目](2026-08-27-windows-signing-publisher.zh.md)。

CLI 请与服务端一同升级：从本版本起 `penguin run` 与 `penguin chat` 都走服务端，旧二进制在被替换
之前仍按自己的 core 执行。若 CLI 无法拉起服务端（入口不可重跑的 `tsx` 开发态运行），先自行启动一
个，或用 `--server` 加 `PENGUIN_API_TOKEN` 指向已在运行的安装。此前依赖「CLI 完全不需要服务端就能
跑 Task」的流程改用 SDK，core 直连执行在那里保留。已存的 `showCliSessions` 偏好无需清理，留在原处
即被忽略。
