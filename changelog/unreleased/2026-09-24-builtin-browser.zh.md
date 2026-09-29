# 你和 Agent 共用的内置浏览器

- **Date:** 2026-09-24
- **Type:** feature
- **Scope:** `desktop`, `server`, `web`, `cli`, `plugins`
- **PR:** [#848](https://github.com/Prism-Shadow/penguin-harness/pull/848)

[English](2026-09-24-builtin-browser.md)

桌面应用的侧边栏新增了一个网页浏览器。人可以像使用任何浏览器一样在其中浏览；Agent 则在自己的 shell 里用 `penguin browser` 驱动同一组标签页——新增的预装插件 `browser-automation` 教它怎么做——并以用户自己的账号登录，这些账号可以从本机已有的浏览器导入。自动化部分（把页面读成简化的 HTML、在页面中运行 JavaScript 并报告发生了什么变化）改编自 [GenericAgent](https://github.com/lsdefine/genericagent)（MIT 协议），在 README 和 `THIRD-PARTY-NOTICES.md` 中致谢。

## 浏览器面板

- 侧边栏新增**浏览器**面板，与终端并列。整个应用只有一组标签页，每个对话的侧栏显示的都是它。
- 标签栏（图标、标题、关闭、新建标签页）和工具栏：后退、前进、刷新或停止，以及地址栏——输入 URL 即打开，只写域名时以 `https://` 打开，其他内容用 Bing 搜索，并从浏览器历史记录中给出建议。工具栏的菜单里有**从浏览器导入…**、**清除浏览数据…**、**设置主页…**、**在系统浏览器中打开**和**开发者工具**。
- 主页：**设置主页…**按地址栏的规则解读输入的网址，也可以用**使用当前页面**取屏幕上的页面。设置之后，新建标签页打开主页而不是空白页，重新加载按钮旁出现**主页**按钮；**清除**可去掉主页。主页保存在 `<数据根目录>/builtin-browser/settings.json`，由 `GET` 和 `PUT /api/builtin-browser/settings` 读写，不依赖桌面外壳；不带地址的 `POST /api/builtin-browser/tabs` 同样打开主页。
- 对话中的链接：在对话里的网页链接上右键，或在链接获得焦点时按 Shift+F10 或菜单键，会弹出应用自己的菜单：**在内置浏览器中打开**（桌面应用中、浏览器可用时显示；新开一个标签页，并让该对话的侧栏切到浏览器面板）、**在系统浏览器中打开**（在浏览器中是**在新标签页中打开**）和**复制链接地址**。若同时选中了对话中的文字，分隔线下方接着是**复制**和**添加到对话**。指向 Workspace 文件的链接仍在文件面板中打开，其他位置的右键仍是原有的选中文字菜单。
- Agent 在某个标签页里工作时，页面四周有一圈脉动的光环，工具栏上也有图标提示。屏幕上的对话正是驱动浏览器的那个对话时，侧栏会自动切换到这个面板。
- 每个标签页都是一个 Electron `<webview>`，位于自己的持久化分区 `persist:penguin-browser` 中，因此内置浏览器的登录状态和网站数据与应用本身、与系统浏览器都相互隔离。页面看到的是普通 Chrome 的 user agent。屏幕上的标签页按侧栏的尺寸排版；不在屏幕上的标签页（侧栏关闭时即所有标签页）保持挂载，尺寸沿用最后一次显示时的大小（从未显示过则为 1280×800），Agent 可以继续在其中工作。
- 一个页面每五秒最多打开三个标签页（弹窗、`target=_blank`），超出的会被丢弃。内置浏览器最多保留 20 个标签页，超出时新建标签页会被拒绝，错误码为 `too_many_tabs`。
- 这个面板只存在于桌面应用中。`penguin web` 提供的 Web App、Docker 和远程服务器都没有它。

## 基于 DevTools Protocol 的自动化

- 桌面端外壳承载这些访客页面，并通过 `webContents.debugger` 转发原始的 Chrome DevTools Protocol 命令、命令所要求的 CDP 事件以及 Cookie 写入，仅此而已。只有位于浏览器分区、地址为 `http`、`https` 或 `about:blank`、不带 preload、不开 Node 集成、不允许弹窗的访客才会被接纳；页面打开新窗口的请求会变成新建标签页的请求。
- 服务器新增的 `builtin-browser` 模块承担全部产品逻辑，随服务器一起交付：标签页登记、驱动器，以及从 GenericAgent 的 `simphtml` 移植的页面脚本——DOM 简化（去掉隐藏、浮动和被遮挡的元素，精简属性，长列表只保留三项并附上 `[FAKE ELEMENT] N more items hidden, selector: "…"` 提示，文本按预算截断），以及 exec 背后的变化监视（变化的元素数、最显著的变化，以及弹出提示之类的瞬时文字）。
- 可信输入：点击是先把元素滚动到视野内，再在其中心依次发送 CDP 的鼠标移动、按下和松开；输入是通过 CDP 插入文字，再触发 `input` 和 `change` 事件。
- exec、click 或 type 期间页面弹出的对话框会被自动应答，页面不会因此卡住：提示框一律接受；确认框和离开页面对话框默认拒绝，除非调用要求接受（Electron 不支持 `prompt()`）；结果里逐一列出这些对话框。标签页的 Page 事件只在 Agent 操作期间打开，因此用户自己触发的对话框仍由浏览器照常显示。
- `/api/builtin-browser` 提供状态与标签页、打开、激活、导航与关闭、scan、exec、click、type、截图、原始 CDP、导入、设置、历史记录以及清除浏览数据，全部只对管理员开放。没有桌面应用时，它返回 `503 browser_unavailable` 并附上原因：`not_desktop`、`shell_unsupported` 或 `no_window`。
- 内置浏览器的历史记录保存在 `<数据根目录>/builtin-browser/history.json`，最多保留最近的 5,000 个页面。

## 负载与崩溃

- 只要有标签页打开，桌面外壳每 10 秒测量一次各标签页，关闭标签页后不久还会再测一次：每个标签页的内存（其页面各进程的私有内存，包括跨站框架的进程；不用工作集，因为工作集会在每个进程里重复计入共享内存）和 CPU，以 `metrics` 事件推送给服务器。
- 服务器对每次测量作出判断：标签页合计超过 1.5 GB 时为 `memory`（低于 1.35 GB 时解除），电脑可用内存不足 10% 时为 `low_system_memory`（高于 12% 时解除；macOS 除外，其空闲内存数不含系统随时可以收回的内存），超过 12 个标签页时为 `many_tabs`；内存警告存在期间还会指出占用内存最多的几个标签页。`GET /api/builtin-browser/status` 以 `metrics` 字段携带结果，每次结果也以 `builtin_browser_metrics` 事件发给各窗口。
- 警告存在期间，面板工具栏上显示一个琥珀色的警告图标，悬停提示给出标签页的内存和数量；每当警告出现，弹出一次提示；占用内存最多的标签页在标签栏里带一个小警告标记。`penguin browser status` 打印一行 `memory:`，警告时再加一行 `warning:`，说明该关闭什么。
- 没有人在看、也没有 Agent 在驱动的标签页，不在视野中时可能被限速。窗口告诉服务器它正在显示哪个标签页（`POST /api/builtin-browser/tabs/on-screen`），服务器再通过新的 `throttle` 命令告诉外壳哪些标签页可以限速；屏幕上的标签页、Agent 正在操作的标签页及其操作后的 30 秒、新标签页的头 30 秒都不在其列。外壳会让限速立即生效：把页面冻结一瞬间再恢复。否则 Electron 要等页面下一次可见性变化才会应用，而停放在视野外的页面永远等不到这次变化。
- 页面进程结束后，标签页仍然保留。外壳报告 `tab-crashed` 及 Electron 给出的原因，把标签页标记为 `crashed`，以 `tab_crashed` 拒绝发往它的 CDP 命令，并让页面已接收的命令立即失败。面板在页面的位置显示 **此页面已崩溃** 和 **重新加载**，Agent 对该标签页的操作返回 409 `tab_crashed`。
- 标签页列表发给窗口的频率最多每秒五次，内容没有变化时不发送。超过 4 KB 的 `data:` 图标、超过 2 KB 的图标地址会被丢弃。
- 外壳发来的帧或事件处理失败时，会被记录并丢弃，而不是从服务器的端口监听器中抛出；否则它会成为让服务器停止的未捕获异常。更新器和托盘的转发也加了同样的保护。

## penguin browser

- `status`、`tabs`、`open`、`switch`、`close`、`scan`、`exec`、`click`、`type`、`screenshot`、`cdp`、`import` 和 `history`，都支持 `--json` 与 `--server`，作用于页面的命令还支持 `--tab`。
- 输出是写给模型读的。`scan` 在页面内容之前打印一行标签页头、标签页列表和一条 `---` 分隔线。`exec`、`click` 和 `type` 打印带标签的行：`status:` 与 `tab:`、`return:`、`diff:`（下方缩进显示最显著的变化）、`transients:`、`new tabs:` 和 `note:`。超过 8,000 个字符的返回值会被截断，并提示改用 `--save`：它把完整返回值写入文件，只打印前 170 个字符和文件路径。
- exec 的脚本可以来自参数、`--file` 或 stdin（`-`，或不给参数时的 heredoc）。
- `exec`、`click` 和 `type` 的 `--accept-dialogs` 选项接受所有对话框，而不只是提示框。每个被应答的对话框打印一行，例如 `dialog: confirm "Delete this item?" → dismissed (rerun with --accept-dialogs to accept)`。
- 出错时打印一行 `error: <code>: <message>`，退出码为 1。这些命令从不自动启动服务器；没有服务器在运行时返回 `browser_unavailable`。在会话内部，作用于页面的调用会带上 `PENGUIN_SESSION_ID`。

## browser-automation 插件

一个预装的办公效率插件，只含一个 Skill `browser-automation`，以 GenericAgent 的浏览器操作笔记为基础：先查 `status`，再按「打开 → scan → exec → 查看 diff」循环推进；导航与操作分成两次调用；显式 `return`；从不猜测选择器；脚本事件被忽略时改用可信的 `click` 和 `type`；文件上传走 `DataTransfer` 或 `DOM.setFileInputFiles`。遇到登录墙时，它从不输入密码：它请用户在面板里登录，或提议用 `penguin browser import` 导入。未经用户确认，它从不下单、付款或修改账户。亚马逊订单是贯穿始终的示例（搜索、以 JSON 提取订单行、翻页、其他亚马逊站点），更多页面操作见它的参考文件。

## 从系统浏览器导入

- 在各个平台上发现 Chrome、Edge、Brave、Arc（macOS）、Vivaldi、Opera、Chromium 和 Firefox 的个人资料，名称取自 `Local State` 或 `profiles.ini`。
- Cookie 值按各平台的存储方式解密：macOS 用钥匙串中的「Safe Storage」密码（系统会请用户允许），Linux 用固定密码或经 `secret-tool` 从密钥环读取的密码，Windows 用经 DPAPI 包装的 AES-GCM 密钥，通过 PowerShell 解包，密钥经 stdin 传入。Windows 上 Chrome 的应用绑定（`v20`）Cookie 无法被其他程序读取，会被跳过并给出警告。存储版本 24 的 SHA-256 主机前缀会被校验并去掉。Firefox 的 Cookie 按原样读取，但容器专用的和按其他网站分区的 Cookie 除外。
- 导入可以只限于部分网站（`amazon.com` 包含 `.amazon.com` 和 `www.amazon.com`），并且只读：每个存储文件都连同预写日志一起复制到临时目录，在那里读取后删除。警告只给出数量，从不包含 Cookie 值。
- 导入的历史记录并入内置浏览器的历史记录，访问次数相加。

## 文档

文档新增「内置浏览器」页面，CLI 参考新增 `penguin browser` 一节，Skill 与插件页的插件库表格、两份 README 的插件表格加入了这个插件，README 新增致谢一节，`THIRD-PARTY-NOTICES.md` 新增 GenericAgent 条目及其 MIT 许可证全文。
