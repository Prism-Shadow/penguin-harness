---
title: "浏览器扩展：Agent 低成本地丝滑操作 Chrome"
date: 2026-10-13
category: practice
excerpt: "配好 PenguinHarness Browser 扩展，Agent 就能在你自己的 Chrome 里工作：只动你交给它的标签页，登录状态和你一致，读页面用文本而不是截图。桌面端的内置浏览器用法相同。"
---

有些任务只能在网页上完成，比如读取登录后才能看到的订单记录。有了 PenguinHarness Browser 扩展，Agent 就能在你自己的 Chrome 里做这些事：在你的标签页旁边开一个 Penguin 标签组，登录状态和你一致；桌面端和任何服务器上的 Web App 都能用。Agent 工作时你照常用 Chrome，并在对话旁边的**浏览器**面板里查看它的标签页。

Agent 在自己的 shell 里用 `penguin browser` 操作页面，而且开销很低：先用 `scan` 把页面读成文本，再用一小段 `exec` 脚本完成操作，只花几十个 Token；只有布局要紧时才截图。这套先 scan 再 exec 的设计来自 [GenericAgent](https://github.com/lsdefine/genericagent)，它的 `web_scan` 和 `web_execute_js` 也是这样在已登录的真实浏览器里工作的。感谢 GenericAgent 的作者。

桌面端还有一个内置浏览器，登录状态独立保存。两种任选其一配好，然后跳到「给 Agent 派个任务」。

## 开始之前

- PenguinHarness 0.2.15 或更高版本，并已在**模型库**页面配置好模型。
- 用你自己的 Chrome 需要 Chrome 116 或更高版本。
- 内置浏览器需要 macOS、Windows 或 Linux 上的桌面端。`penguin web`、Docker 或远程服务器提供的 Web App 没有内置浏览器。
- Agent 要装 `browser-automation` 插件。PenguinHarness 创建 `default_agent` 时就会给它装上。其他 Agent，以及 0.2.15 之前创建的 `default_agent`，请到**插件市场**页面安装。

## 方式 A：你自己的 Chrome（通过扩展）

1. 在 PenguinHarness 里，点击侧边栏底部你的名字，再点**设置**。在**浏览器**页面选择**连接你的 Chrome**。
2. 点击**打开 Chrome 应用商店**，把 PenguinHarness Browser 添加到 Chrome，并固定到工具栏。如果商店打不开，对话框会提供一个 zip 包，可以在开发者模式下加载。

   ![连接你的 Chrome 对话框：安装步骤、服务器地址和一次性配对码，正在等待 Chrome 接入](/blog-assets/browser-connect-chrome-zh.png)

3. 在 Chrome 里点击扩展图标，再点**设置**。在配对页面粘贴对话框里的**服务器地址**和**配对码**，然后点击**连接**。配对码只能用一次，10 分钟内有效。对话框随后变为**已连接**并关闭。

   ![配对完成后的扩展配对页面：服务器显示为已连接](/blog-assets/browser-extension-pair-zh.png)

4. 桌面端里，由管理员在**Agent 使用的浏览器**下选择**系统 Chrome**。普通成员，以及其他服务器上的所有人，都只有 Chrome 这一个后端，没什么可选的。

   ![设置 › 浏览器：Agent 使用系统 Chrome，配对的 Chrome 已连接](/blog-assets/browser-settings-zh.png)

## 方式 B：内置浏览器

1. 打开一个对话，点击右上角的**右侧栏**，再选择**浏览器**（右侧栏里已有面板时，用**+**添加）。新标签页是常用网站的起始页，点一个站点，或直接输入网址。

   ![浏览器面板的新标签页：地址栏已聚焦，下方是 Google、Bing、Baidu、GitHub、Stack Overflow 和 Wikipedia 的磁贴](/blog-assets/browser-start-page-zh.png)

2. 直接在面板里登录 Agent 会用到的网站。内置浏览器会自己保存这些登录状态，重启后依然有效，与系统浏览器相互独立。
3. 也可以把现有的登录状态搬过来：打开工具栏菜单，选择**从浏览器导入…**。选一个浏览器的用户配置（profile），保持**Cookie 与登录状态**勾选，再在**仅限这些网站**下面列出网站，比如 `amazon.com`，这样只会复制 Agent 需要的部分。最后点击**导入**。

   ![浏览器面板的工具栏菜单：从浏览器导入…、清除浏览数据…、设置主页…、在系统浏览器中打开和开发者工具](/blog-assets/browser-menu-zh.png)

导入支持 Chrome、Edge、Brave、Arc（仅 macOS）、Vivaldi、Opera、Chromium 和 Firefox 的用户配置，并且只读不写。

## 给 Agent 派个任务

1. 在新对话里提一个需要网页的请求，比如：“打开 PenguinHarness 博客，列出最新的三篇文章和各自的日期。”
2. Agent 会先用 `penguin browser status` 检查浏览器，再用 `open` 打开页面，用 `scan` 读取内容，最后用 `exec` 跑一小段脚本，提取需要的信息。如果屏幕上显示的对话正在用浏览器，右侧栏会自动切换到**浏览器**面板。在内置浏览器里，Agent 操作某个页面时，页面四周会出现一圈不断脉动的光环。

   ![对话里 Agent 的操作步骤，浏览器面板里开着博客](/blog-assets/browser-panel-zh.png)

3. 每一步都是一条命令，展开就能看到具体执行了什么、返回了什么。Agent 完成后页面仍然开着，你可以从它停下的地方继续。

用你自己的 Chrome 时，同样的命令会在名为 Penguin 的蓝色标签组里打开页面。Chrome 会显示一条提示栏，说明扩展正在调试浏览器。面板会列出 Agent 的标签页，并提供**在 Chrome 中显示**。

![Chrome 中 Agent 的标签页在 Penguin 标签组里，上方是扩展的调试提示栏](/blog-assets/browser-chrome-window-zh.png)

![Chrome 模式下的对话与浏览器面板：提示「此标签页在你的 Chrome 中打开」，并提供「在 Chrome 中显示」](/blog-assets/browser-chrome-panel-zh.png)

## 限制与安全

- Agent 永远不会输入你的密码。遇到登录页它会停下来请你自己登录：内置浏览器里在面板中登录，它也可以提议导入登录状态；Chrome 里则在 Penguin 标签组的那个标签页里登录。没有你的确认，它不会下单、付款或修改账户。
- 在 Chrome 里，Agent 只能访问自己那个 Penguin 标签组里的标签页：包括它自己打开的、你用扩展的**添加此标签页**移交的，以及这些标签页打开的页面。它无法操作 Chrome 自身的页面、Chrome 应用商店和本地文件。想收回某个标签页，可以把它拖出标签组、直接关掉，或者选择**收回此标签页**。扩展弹窗里的**暂停**会停掉所有命令。
- Agent 正在操作某个页面时，别在里面点击，因为你的点击会改变它眼中的页面。
- 导入、历史记录和清除浏览数据属于内置浏览器，是给管理员用的。每种后端最多容纳 20 个标签页。
- Agent 永远不会自己挑后端。如果你选的那个不可用，`penguin browser status` 会说明原因，Agent 也会告诉你，而不会退回到另一个后端。
