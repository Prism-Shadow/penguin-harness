# 本批次的向后兼容

- **Date:** 2026-10-26
- **Type:** process
- **Scope:** `server`, `web`
- **PR:** [#1336](https://github.com/Prism-Shadow/penguin-harness/pull/1336), [#1339](https://github.com/Prism-Shadow/penguin-harness/pull/1339), [#1351](https://github.com/Prism-Shadow/penguin-harness/pull/1351)

[English](2026-10-26-backward-compatibility.md)

本批次的每项兼容决定都只在这里记录一次；各功能条目引用本文件，不再重复叙述。
## Penguin Remote 的一跳改写为 `http://` 的 `Origin`

[公共源](2026-10-26-oauth-callback-port.zh.md)之前发布的桌面端不信任任何代理，拿写请求的 `Origin` 与请求自身的来源比对，即连接的协议（明文 HTTP）加 `Host`。为了让这些桌面端经 Penguin Remote 也能接受写请求，中继的一跳（目前是用户机器上的 Penguin Remote 客户端）在浏览器的 `Origin` 指向隧道自己的主机时，把 `https://u<N>.go.penguin.ooo` 改写为 `http://u<N>.go.penguin.ooo`。有了公共源的桌面端期待的是 `https://`，所以同时接受请求自身的来源，在这条改写之后照常工作。

### 范围

写请求（`/api/*` 与 `/server/*`）、API socket 与终端 WebSocket 握手、Workbench 处理器上的来源检查，且只限桌面应用内嵌的服务端：它是 Penguin Remote 唯一会连到的服务端，以桌面模式（`PENGUIN_DESKTOP_TOKEN`）识别。在那里，无论转发头怎么写，请求自身的来源都放行。其他服务端，无论是否受信任代理，都只认公共源（[受信任代理的加固](2026-10-26-trust-proxy-hardening.zh.md)）；没有受信任的代理时，两个来源本来就相同。

### 你需要做什么

桌面端无需操作。只要还有本次改动之前的桌面端经中继连入，Penguin Remote 客户端就保留这条改写。

### 期限

0.3.0 之前，Penguin Remote 客户端不再改写 `Origin`，改为设置 `X-Forwarded-Proto: https` 与 `X-Forwarded-Host: <公网主机名>`，覆盖已有的值，并让 `Host` 保持为公网主机名。服务端维护者在 0.3.0 删除对请求自身来源的接受（`packages/server/src/http/public-origin.ts` 中的 `OriginRule.acceptOwnOrigin` 及 `acceptsOrigin` 里对它的使用，连同 `packages/server/src/terminal/ws.ts` 的 `acceptOwnOrigin` 选项），桌面端也只认公共源。

## 浏览器里已有的偏好与草稿

[设置与草稿随账号保存](2026-10-26-settings-follow-account.zh.md)把每个浏览器里已有的偏好与草稿移到了服务端，并在 `web.db` 里新增了两张表。需要拍板的只有浏览器这一侧；两张表也一并记在这里，这样「我的安装要不要做什么」只需看这一处。

此前，设置页的偏好与各类草稿只存在浏览器的 `localStorage` 里：`penguin.theme`、`penguin.themeId`、`penguin.accent`、`penguin.textSize`、`penguin.fontLatin`、`penguin.fontCjk`、`penguin.lang`、`penguin.currency`、`penguin.terminal.theme`、`penguin.toolAliases`、`penguin.notifications`、`penguin.dock.launcherHidden`、`penguin.steerMode`、`penguin.background.image` 与 `penguin.background.settings`，以及草稿的几族键 `penguin.chatDraft.*`、`penguin.chatDrafts.*`、`penguin.channelDraft.*`、`penguin.orgCreateDraft.*` 和 `penguin.a2uiDraft.*`。现在以服务端账号里的副本为准。如果不做处理，升级后第一次登录时，账号里空白的副本会盖掉它们：主题和语言全部回到缺省，尚未发送的草稿全部丢失。

采用的方案（产品负责人决定）：**一次性导入**。升级后某个浏览器第一次登录时：

- 如果账号里还没有任何一项上述偏好，且这个浏览器从未把偏好交给过任何账号，就把它缓存的偏好（含背景图片）上传到账号。浏览器用 `penguin.prefsImported` 记下这一点，因此第二个在同一浏览器登录的账号，不会收到第一个账号的偏好；
- 当前登录用户的草稿中，账号里没有的那些上传一次，按用户记在 `penguin.draftsImported.<用户>`。A2UI 表单尚未提交的作答不导入：它们的键里不带用户，两个账号共用的浏览器上，先登录的账号会拿到另一个账号的作答。这次登录时浏览器丢弃这些作答；此后填写的作答与其他草稿一样随账号保存。

此后以服务端为准。这些键留在原处，作为浏览器的缓存，浏览器里没有任何键被改名或改写。两个标记都按数据根限定：指向一个被清空的数据根时，浏览器会再导入一次，导进新数据根的账号。

影响范围：所有账号的所有浏览器，包括桌面应用的窗口。多个账号共用的浏览器，偏好交给最先登录的那个账号。

用户无需操作。若在几个浏览器里设的外观各不相同，升级后先在哪个浏览器登录，账号就沿用那里的外观，其余浏览器随后跟随账号。此后在任何一处修改设置，处处生效。

**移除时间：** 导入代码保留到 0.3.0，在该版本的发布准备中移除，包括两个标记、`packages/web/src/lib/account-sync/prefs.ts` 与 `drafts.ts` 里的 `importing` 分支、`sync.ts` 里对应的那段说明，以及相关的测试用例。届时两个标记键也从数据根限定表中删去；浏览器里残留的旧标记不再被读取，会在下一次更换数据根时被清扫。

## 新增的两张表

`user_drafts` 与 `user_background_images` 由迁移 `2026-10-26-user-drafts` 新增，属于增量迁移：两表的行都随所属用户删除，已有的 `web.db` 只是多出两张空表。这不需要拍板，迁移保留多久，它就保留多久。

降级不会察觉到变化：旧版本从不读取这两张表，它的 Web App 回到把偏好与草稿存在浏览器里的做法，而缓存里正是这个浏览器最新的值。升级后在其他浏览器做的修改，不会出现在这个浏览器里。迁移的 `down` 会删除两张表，连同服务端保存的全部草稿与背景图片；仍缓存着它们的浏览器保留自己的那份。

## 兼容性

升级与降级都无需任何操作。
