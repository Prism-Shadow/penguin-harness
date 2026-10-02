# Agent 可以驱动你自己的 Chrome

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `browser-extension`, `docs`

[English](2026-10-03-system-chrome-browser-backend.md)

Agent 浏览器新增了第二种后端：用户自己的 Chrome，经由新的 PenguinHarness Browser 扩展驱动，与桌面应用的内置浏览器并列。任何服务器上的 Web App 现在都能做浏览器自动化，桌面应用也可以切换到 Chrome。两种后端上 Agent 用的都是同一套 `penguin browser` 命令，Agent 从不在两者之间选择。

## 后端与链路

- 浏览器有两种后端：`builtin`（桌面 shell 承载的 `<webview>` guest）和 `chrome`（扩展）。两者在 `BrowserLink` 之上运行同一套驱动、页面脚本和操作。桌面 shell 的链路不变；扩展的链路是一条 WebSocket，传送同样的 `desktop-browser-command` / `-reply` / `-event` 信封。
- 扩展链路新增 `open-tab`、`close-tab`、`activate-tab` 和 `ping` 命令，以及 `tab-released` 事件。用户收回的标签页返回 `409` `tab_released`。
- 在 `chrome` 上，原始 CDP 拒绝 `Target`、`Browser`、`Storage`、`Fetch`、`Extensions`、`Tethering` 和 `Security` 域，读写 Cookie、清除缓存或拦截请求的 `Network` 方法，以及 `DOM.setFileInputFiles` 和 `Page.setDownloadBehavior`（`403` `cdp_refused`）。导入、历史记录和清除数据返回 `405` `not_supported`。
- 每个用户各有自己的 chrome 运行时和标签页登记，事件只发给该用户的通道。标签页登记在断线期间保留，重连后以 Chrome 上报的为准。

## 扩展

- 新增 `packages/browser-extension`：名为 PenguinHarness Browser 的 MV3 扩展，用 esbuild 构建。它申请 `debugger`、`tabs`、`tabGroups`、`storage`、`webNavigation` 和 `alarms` 权限，不注入内容脚本，也不向页面开放任何接口。manifest 钉住了 key，所以 Release 中的 zip 和日后 Chrome Web Store 上的版本，扩展 id 都是 `dodgfhpcbmkjfcbgnoidablfgjjhhmgp`。
- 它只驱动自己打开的标签页（每个窗口、每台服务器一个名为 Penguin 的蓝色标签组）、用户用工具栏图标添加的标签页，以及由它们打开的页面。把标签页拖出组、关闭它、弹窗里的「收回此标签页」和调试提示栏上的「取消」都会收回标签页。Chrome 自己的页面、Web Store 和本地文件一律拒绝。
- 调试器在标签页收到第一条命令时挂接，空闲 60 秒后分离，因此 Agent 停手后 Chrome 的调试提示栏会消失。弹窗里的「暂停」会拒绝所有命令，直到「继续」。
- 选项页用于与服务器配对（服务器地址和配对码）；弹窗显示连接状态，添加或收回当前标签页，以及暂停。界面文字有英文和中文。
- 发布工作流上传 `penguin-browser-extension-<version>.zip` 和不带版本号的 `penguin-browser-extension.zip`。桌面安装包不捆绑扩展。

## 配对与传输

- `POST /api/builtin-browser/extension/pairings` 为当前登录的用户生成一次性配对码：43 个字符，10 分钟内有效，只能用一次，输错五次即作废，只保存在内存中。新生成的配对码会取代该用户之前的那个。
- 扩展在 `POST /api/builtin-browser/extension/pair` 用配对码换取 token。这个路由位于 Cookie 关卡之外，只对扩展自己的来源应答 CORS 和私有网络访问预检。返回的 token 是 32 字节随机数；服务器只把它的 SHA-256 存进新的 `browser_extensions` 表。
- 扩展从自己的来源连接 `/api/builtin-browser/extension/ws`，token 放在 `Sec-WebSocket-Protocol` 里（`penguin-browser.1`、`token.<token>`）；服务器不读取 Cookie。服务器先发 `hello`，之后每 20 秒 ping 一次。关闭码：`4001` 被同一用户更新的连接替代，`4003` 已撤销，`4005` 协议不符，`4008` ping 超时，`4009` 管理员已关闭，重启时为 `1012`。
- `GET /api/builtin-browser/extension` 列出调用者已配对的 Chrome，`DELETE /api/builtin-browser/extension/:id` 撤销其中一个。
- `/api/admin/settings` 中的 `browserExtensionsEnabled`（缺省开启）是管理员的开关：关闭后以 `4009` 断开所有扩展，并拒绝新的连接和配对码。

## 选择后端

- 后端由每个用户自己选择，存为 `ui_prefs.browserBackend`，只能经由 `GET` / `PUT /api/builtin-browser/backend` 读写。桌面上的管理员可以二选一，缺省使用内置浏览器；桌面上的普通成员以及其他服务器上的所有人只有 Chrome。`PUT /api/me/prefs` 拒绝这个键，`PUT /backend` 和配对码拒绝 API token（`403` `human_required`）。
- Agent 正在操作时切换返回 `409` `action_in_flight`。切换不会关闭任何标签页，调用也从不从一种后端回退到另一种。
- `GET /api/builtin-browser/status` 带上生效的 `backend`，以及向调用者提供的每一种后端（`backends`），其中包括用户的 Chrome。`builtin_browser_backend` 和 `builtin_browser_extension` 事件告诉用户的各个窗口：后端已切换，或 Chrome 已连接、已断开、被替代或被撤销；`builtin_browser_tabs` 也会注明它属于哪种后端。
- Agent 用管理员 API token 并带 `sessionId` 发起的调用，按正在驱动该会话的人行事：最近一次在该会话中发起运行的人、定时任务的创建者，再不然是 Project 的所有者。

## Web App

- 只要服务器提供 Chrome，侧边栏就提供浏览器面板，不论窗口是否支持 `<webview>`。Chrome 模式下，面板列出 Agent 在 Chrome 里的标签页（**+** 新开，**×** 关闭），保留地址栏，并在页面区显示**此标签页在你的 Chrome 中打开**和**在 Chrome 中显示**。还没有配对 Chrome 时，面板显示配对步骤；已配对但不在线时显示 **Chrome 未连接**和**重新连接帮助**；管理员关闭了连接时显示 **Chrome 连接已关闭**。
- 在桌面上，管理员的面板菜单顶部是**浏览器**选项（**内置**或**系统 Chrome**）；其下是一行连接状态，带**连接你的 Chrome…**或**管理…**。切换后有提示；Agent 正在操作时切换被拒绝，提示会说明原因。
- **连接你的 Chrome**对话框给出安装步骤和 zip 下载链接，再给出服务器地址和配对码，各带复制按钮。扩展连上后，底部的**正在等待 Chrome…**变为**已连接**，对话框随即关闭。
- **设置 › 浏览器**包含后端选择（桌面）、已配对的 Chrome 列表（名称、版本、最近连接、连接状态点）、需经危险确认的**撤销**，以及**连接另一个 Chrome**。**设置 › Chrome 扩展**包含管理员的**允许 Chrome 扩展连接**开关，关闭前会先确认。
- Chrome 模式下，链接菜单的那一项写作**在 Agent 的 Chrome 标签页中打开**。

## penguin browser 与 Skill

- `penguin browser status` 在状态行中注明后端（`status: available · backend: chrome (Chrome 130 on macOS, extension 0.2.13)`），并在 `note:` 中说明三种 Chrome 原因。`not_supported` 会说明该改做什么；不带原因的 `browser_unavailable` 打印服务器自己的说明。
- 每条命令都发送 `PENGUIN_SESSION_ID`，放在请求体里，`GET` 和 `DELETE` 则放在查询参数里，供服务器认定调用者。
- `browser-automation` 插件升级到 2026.10.03.1。它的 Skill 说明浏览器由用户选择；Chrome 未配对、未连接或已关闭时该告诉用户什么；`tab_released` 一律不重试；完成后关闭自己打开的标签页；`import` 只属于内置浏览器。
- 「内置浏览器」「CLI 参考」「Server API」和「技能与插件」文档补充了 Chrome 后端：安装扩展、配对、切换、Agent 能触及的范围、管理员开关以及各路由。

## 兼容性

没有加入任何兼容代码；以下变化按原样接受：

- 新增 `browser_extensions` 表（migration 13）。旧版服务器打开数据根目录时从不读取它，所以已配对的扩展只是连不上，直到新版服务器回来。
- 新增偏好键 `ui_prefs.browserBackend`，只经由 `PUT /api/builtin-browser/backend` 写入。旧版服务器会把它原样留在已保存的偏好里。
- `/api/builtin-browser` 从仅限管理员改为对所有已登录用户开放，普通成员因此可以配对并驱动自己的 Chrome。内置浏览器、导入、历史记录、清除数据和主页仍只对管理员开放；管理员的开关可以关闭 Chrome 这一侧。
- `BuiltinBrowserStatus.available` 现在描述生效的后端，而不再是桌面 shell；`builtin_browser_tabs` 带上了 `backend`。随服务器一同发布的 Web App 和 CLI 都会读取这两项。
- 之前已安装的 `browser-automation` Skill 副本保持旧文字，直到 Project 接受版本升级带来的更新。
