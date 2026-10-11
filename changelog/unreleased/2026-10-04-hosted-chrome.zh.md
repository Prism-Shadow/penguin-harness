# 服务器为 Agent 运行一个自己的 Chrome

- **Date:** 2026-10-04
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `skills`, `docs`

[English](2026-10-04-hosted-chrome.md)

Agent 浏览器新增了第三种后端 `hosted`：由服务器在自己所在的机器上启动并驱动的无头 Chrome。远程机器上的 Session 从此在 Workspace 所在的机器上有了浏览器——在那里执行 `penguin browser`，网页就从那台机器打开，包括它的回环地址——服务器还提供每个标签页的画面并接收观看者的输入，人可以看到同一个页面并在其中操作。

## hosted 后端

- `BrowserBackend` 增加了 `hosted`，它是 `BrowserLink` 的第三种实现，与桌面 shell 的和扩展的并列。驱动、页面脚本、操作和标签页登记沿用其他后端的那一套。
- Chrome 以 `--remote-debugging-pipe`、`--headless=new` 启动，启动时不开窗口，使用自己的 profile：`<数据根>/builtin-browser/hosted-profile`。CDP 走管道，不开任何调试端口。从不传 `--no-sandbox`。在 Linux 上还带 `--password-store=basic`：服务器上没有桌面钥匙串可以应答，Chrome 等它时每次导航都会卡住。
- 服务器先看管理员设置的路径，再在 `PATH` 上找 `google-chrome`、`google-chrome-stable`、`chromium`、`chromium-browser` 和 `chrome`，最后找 macOS、Windows 和 Linux 的标准安装位置。它不下载 Chrome。
- Chrome 在第一条需要它的命令到来时启动；`GET /status` 和 `GET /tabs` 不会启动它。没有标签页满十分钟后它被停止，服务器停止时也一并结束。它自行退出时，在途的命令失败，标签页列表清空，下一条命令重新启动它。
- `BuiltinBrowserUnavailableReason` 增加了两种原因：`hosted_no_chrome`（没有找到）和 `hosted_launch_failed`（找到的那个没有启动成功）。后者带上 Chrome 自己的报错行 `detail`，出现在 `GET /status` 中，也出现在 `503` `browser_unavailable` 的 `reason` 旁。
- 每个标签页开在自己的窗口里，弹窗成为标签页。在 Agent 的操作之外，页面的 alert 和离开页面的提示被接受，confirm 和 prompt 被取消，因为没有人能应答它们。
- 导入、历史记录和清除数据返回 `405` `not_supported`，与 `chrome` 相同。原始 CDP 只拒绝 `Target` 域和导航到非网页地址的 `Page.navigate`，与 `builtin` 相同。

## 谁能用

- `hosted` 只对管理员提供，出现在 `GET /backend` 的 `choices` 和 `GET /status` 的 `backends` 中；普通成员选择它时返回 `403` `admin_required`。
- 没有保存过选择的管理员，按以下顺序取缺省：桌面应用里的内置浏览器、自己配对过的 Chrome、机器上有 Chrome 时的 `hosted`，最后是 `chrome`。保存过的选择保持不变，调用也从不从一种后端回退到另一种。
- `GET /status` 的 `hosted` 条目带有 `chrome`：找到的路径、启动过之后的版本，以及是否正在运行。
- `GET` / `PUT /api/builtin-browser/settings` 增加了 `chromePath`：要启动的 Chrome 的绝对路径，`null` 表示自动查找。`PUT` 现在可以只带其中一个字段，没带的那个保持原值。

## 标签页的画面与输入

- `GET /api/builtin-browser/tabs/:id/view` 是一条事件流：每个 `frame` 事件是一帧 base64 JPEG 及其宽高，来自 CDP 的 screencast。查询参数 `width` 和 `height` 让页面按观看者的面板大小排版。
- 只有有人观看时才运行 screencast。画面每秒最多送出 15 帧；每个观看者最多积压一帧，新帧替换还没发出的旧帧；新来的观看者立即拿到最新一帧。标签页关闭或 Chrome 退出时，事件流结束。
- `POST /api/builtin-browser/tabs/:id/input` 接收一批鼠标、滚轮、按键和文字事件，以及工具栏的后退、前进、刷新和停止，用 CDP 的 `Input` 域执行。指针坐标以画面的像素给出，换算成页面的 CSS 像素。
- 两条路由只对管理员开放，只在 `hosted` 上可用；在其他后端上返回 `405` `not_supported`。

## 浏览器面板

- 面板有了归属：它显示的是当前对话的 Workspace 所在那台服务器的浏览器（本服务器或某台机器），取法与文件面板取机器的方式相同。Web App 按服务器分别保存浏览器状态，面板的请求发往该服务器，机器发来的 `builtin_browser_*` 事件进入该机器的状态；此前这些事件被丢弃。对话中的链接也在同一个浏览器里打开。
- `hosted` 标签页的页面区是它的画面，按面板大小缩放绘制，观看者的鼠标、滚轮和键盘会送回页面。输入法提交的文字和粘贴的内容以插入文字的方式送达。拖动时指针移出面板仍然有效；面板失去键盘焦点时，仍按着的键和按钮会被松开。鼠标移动会被合并，一次请求只带一个位置。
- 页面按面板的尺寸排版，面板尺寸变化稳定后重新排版。只有面板在屏幕上且窗口可见时才观看画面。标签页仍然打开而画面流结束时，会在逐次加长的等待后重新连接；最后一次等待之后，页面区提供**重试**。
- 标签栏、地址栏、Agent 工作时的标记和光环沿用内置浏览器的组件。后退、前进、刷新和停止作为输入送到页面。没有标签页时，页面区说明页面会出现在哪里；不会仅因为面板被打开就新建标签页。
- 菜单的**浏览器**分组作用于面板所属的服务器，在该服务器提供时列出**这台机器上的 Chrome**。机器的面板不列出**系统 Chrome**，也没有 Chrome 状态行。
- 机器上没有 Chrome 或 Chrome 没有启动时，页面区会说明原因，显示 Chrome 输出的那一行，说明该做什么，并提供**重新检查**或**重试**。面板出现在屏幕上时读取浏览器状态，浏览器不可用期间持续重读。
- `hosted` 标签页不提供导入、清除数据、主页、**在系统浏览器中打开**和**开发者工具**。

## penguin browser 与 Skill

- `penguin browser status` 输出 `backend: hosted`，Chrome 启动过之后还带上版本（`backend: hosted (Chrome 140.0.7339.16)`），并在 `note:` 中说明两种新原因，启动失败时带上 Chrome 的报错行。
- `browser-automation` 插件升到 2026.10.04.1。Skill 补充说明：在 `hosted` 上，浏览器位于 Workspace 所在的机器；用户在浏览器面板里能看到每个标签页并随时接手；遇到登录墙时请用户在面板里登录；`import` 不属于这个后端。
- 「内置浏览器」文档增加了这个后端：它需要什么、何时成为缺省、观看并操作它的标签页，以及它的限制。

## 兼容性

没有新增兼容代码；以下变化按现状接受：

- `ui_prefs.browserBackend` 多了第三个取值 `hosted`。早于这次改动的服务器把它当作未知值，使用自己的缺省。
- 不在桌面应用里、所在机器装有 Chrome 的服务器上，没有配对过 Chrome 的管理员现在缺省使用 `hosted`，而不再看到 `chrome` 的配对步骤。该管理员选择一次**系统 Chrome**即可恢复原来的行为。
- `GET /backend` 的 `choices` 和 `GET /status` 的 `backends` 会向管理员列出 `hosted`，`builtin_browser_tabs` 的 `backend` 也可能是它。
- 此前已安装的 `browser-automation` Skill 副本保持旧文本，直到 Project 接受版本号提升带来的更新。
