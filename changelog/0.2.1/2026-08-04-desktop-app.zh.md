# 桌面应用：内嵌服务端之上的 Electron 外壳

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`, `cli`
- **PR:** [#173](https://github.com/Prism-Shadow/penguin-harness/pull/173), [#177](https://github.com/Prism-Shadow/penguin-harness/pull/177), [#180](https://github.com/Prism-Shadow/penguin-harness/pull/180), [#189](https://github.com/Prism-Shadow/penguin-harness/pull/189), [#199](https://github.com/Prism-Shadow/penguin-harness/pull/199), [#206](https://github.com/Prism-Shadow/penguin-harness/pull/206)

[English](2026-08-04-desktop-app.md)

新增 `packages/desktop`：Web App 的桌面分发形态，它原封不动地运行既有的服务端与前端——一个 Electron 外壳把 `@prismshadow/penguin-server` 作为 utilityProcess 在共享数据根目录上 fork 出来，并把窗口指向 `http://localhost:<port>`，保持朴素的同源 HTTP/SSE 契约（没有私有 IPC、没有 preload、窗口中没有 node 集成）。

## 外壳

这个单实例外壳以 `PORT=0` 启动服务端，从一次 `PENGUIN_PORT_FILE` 通告中获知实际端口，并加载一次性的 `GET /api/auth/desktop-login?token=…`——这个逐次启动的令牌（经 `PENGUIN_DESKTOP_TOKEN` 传入）让窗口以 admin 身份登录，无需登录页。外部链接与 Workspace 预览在系统浏览器中打开。崩溃的服务端以 1 秒/2 秒/4 秒退避重启；退出时经 `POST /api/desktop/shutdown` 停止它（Bearer 令牌——这在 Windows 上是唯一的优雅路径，因为在那里杀死子进程属于硬终止），失败则回退到 kill。

## 服务端的桌面模式

桌面模式仅限环回，并新增：那个一次性登录端点、可复用的关停端点、一列 `auth_sessions.via`（"password" | "desktop"，幂等 ALTER），以及 `GET /api/me` 上的 `desktopMode` 与 `sessionVia`。由桌面创建的数据根目录，其预置 admin 会获得一个完全随机、且从不打印的密码——登录经外壳的令牌完成；而由桌面建立的会话可以在不提供旧密码的情况下修改密码（针对同一服务端的浏览器会话仍然必须提供）。在 `PORT=0` 下，`::1` 的预览监听器现在复用实际绑定的端口，而不是再抓一个随机端口。

## 每个数据根目录一个实例

`web.db` 是单写者，而定时任务调度器不得运行两份，因此新增的 `<root>/server.lock`（pid + 端口存活性；陈旧的锁会被覆盖，关停时释放）保证每个数据根目录只有一个服务端，并以无副作用的方式导出为 `@prismshadow/penguin-server/lock`。`penguin server` 现在会拒绝一个繁忙的根目录并打印既有实例的 URL；`penguin web` 则打开既有实例而不是失败；桌面外壳会把它的窗口挂到那个实例上（走正常登录页——一次性令牌只对由外壳自己派生的服务端有效）。这也顺带消除了此前那个隐患：两个 `penguin web` 进程重复运行同一批定时任务。

## 桌面模式下的 Web App

窗口会隐藏那些被外壳变得没有意义的东西：登出入口（窗口本身就是会话）、初始密码横幅（预置密码是随机的且从不展示），以及自更新入口（更新属于桌面应用；Web 端的自更新会重新运行 CLI 入口，而它在外壳下并不存在）。对桌面会话，修改密码对话框去掉旧密码字段。

## 打包（三平台）

electron-builder 从一棵 `pnpm deploy --prod` 暂存树产出 macOS 的 dmg + zip（arm64/x64）、Windows 的 NSIS，以及 Linux 的 AppImage + deb——那是一棵可移植的 node_modules，其中工作区包已实体化，Web 构建产物放在 server 包的 npm 布局位置；asar 刻意关闭（外壳要 fork 服务端、Skill 库要从磁盘读它的文件、Agent 命令要派生真实的 shell）。Windows 携带与 CLI zip 相同的、被固定版本的 MinGit，并以 `PENGUIN_BUNDLED_SHELL` 公布。一个可复用的 `desktop-build.yml` 三操作系统矩阵（带 `workflow_dispatch` 空跑）在 `release.yml` 内部、于 Release 创建**之前**运行——产物在发布后即不可变——并附加这些安装包与 `SHA256SUMS.desktop`。M3 的产物未签名；签名、公证、图标与 electron-updater 是下一个里程碑。开发体验方面：根级 `pnpm desktop` 会构建一切并在开发数据根目录上启动外壳，而一个预检把「陈旧注入副本」导致的 `ERR_MODULE_NOT_FOUND` 变成一条可操作的提示。

## 修复

两个 Workspace HTML 预览入口在桌面应用中此前都是死的，现在都可用了。预览重定向解析出的端口是 `0`——预览 URL 是按服务端自身的绑定端口构建的（这是刻意的，因为开发时 SPA 跑在另一个端口上），而外壳以 `PORT=0` 启动服务端——于是产生了 `http://127.0.0.1:0/…` 这样一个被浏览器判为不安全端口而拒绝的地址；实际绑定的端口现在会在监听之后回写，而未知端口则降级为沙箱化的同源预览，而不是给出一个加载不了的 URL。「在新标签页打开」此前静默无事发生，因为该链接属于应用源，而外壳拒绝一切弹窗、只把外部 URL 转发给系统浏览器——而在那里，受 Cookie 门控的重定向本来也会 401；应用源的弹窗现在会打开一个不含 Node 的子窗口，它跟随该重定向并可在本实例的环回界面内导航，其余一切仍然向外走。另外，桌面外壳的进程凭证（`PENGUIN_DESKTOP_TOKEN`、`PENGUIN_PORT_FILE`）与被固定的预置密码，不再泄漏进 Agent 的命令环境。

该应用也不再在两次启动之间遗忘界面偏好（语言、主题）：渲染器把它们持久化在 `localStorage` 中，而浏览器按窗口的源来隔离它，可每次启动都用 `PORT=0` 就让这个源每次都变。外壳现在会记住服务端实际绑定过的端口（`userData/preferred-port`），并在它于两个环回协议栈上都仍空闲时再次请求该端口，一旦被占用则回退到 `PORT=0`——端口号的唯一来源仍然是操作系统分配器，而丢掉一个端口的代价恰好是一次偏好重置。
