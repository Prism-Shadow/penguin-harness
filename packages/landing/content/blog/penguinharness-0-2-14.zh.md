---
title: "PenguinHarness 0.2.14：最全面的自进化框架、浏览器自动化、A2UI、API 集成和机器管理"
date: 2026-10-13
category: news
excerpt: "五种 RSI 算法以插件形式发布，可在七个内置 Benchmark 上运行。Agent 还有了浏览器、回复中的交互式 UI 和自己的热定制工作台，能运行在其他机器上，并能通过同一套 API 接入任意外部应用。"
---

从 0.2.14 起，PenguinHarness 成为一个 Agent 自进化框架。五种自进化（RSI）算法以插件形式发布，每个新建 Project 都自带七个内置 Benchmark 供它们运行。Agent 还多了五项能力：浏览器、回复中的交互式 UI、自己的工作台、在其他机器上运行，以及接入任意外部应用的统一 API。

![起始页：Agent、RSI 算法和 Benchmark 的数量，以及示例](/blog-assets/penguinharness-0-2-14-start-page-zh.png)

## 自进化

### 五种 RSI 算法，以插件形式发布

插件市场新增**Agent 自进化**分类，里面有五个工具包：`default-rsi-toolkit`（试跑、反思、提升），以及 OPRO、APE、ACE、AWM 各一个。运行方式与各自论文的描述一致。

- 在评估中心的**使用** › **优化**标签页里，从**方法**中选择一个。
- 工具包测量的每个候选版本都会成为新的 Agent State 版本，变更前先保存快照，任何一轮都能回滚。
- 新建 Project 中的 General Agent 已预装全部五个。

![Agent 自进化分类和五个 RSI 工具包](/blog-assets/penguinharness-0-2-14-rsi-plugins-zh.png)

### 七个内置 Benchmark

新建 Project 自带 PenguinHarness Benchmark Sec A 到 Sec E，题目取自 rag-bench-essential、DeepSWE、AutomationBench、Terminal-Bench-Science 和 Terminal-Bench，另有 GDPevo Train 和 GDPevo Test：在 Train 上优化，再到 Test 上检验。

- 每道题目都是 Harbor task，在 Docker 里运行。
- Benchmark 现在是软件包：**导入评估集**接受 zip 或仓库文件夹，已发布的 Benchmark 带有**导出**。

![GDPevo Train：三个 Agent 各用一个模型，分数跨版本不断爬升](/blog-assets/penguinharness-0-2-14-benchmark-detail-zh.png)

教程：[选一个算法，让 Agent 在 Benchmark 上自己进化](/blog/self-evolve-agents-with-rsi-toolkits)。

## 会浏览网页、展示 UI、给自己搭工作台的 Agent

### 浏览器自动化

Agent 能打开网页并在里面操作，用桌面端的内置浏览器或你自己的 Chrome 都行；Agent 的标签页都能在对话旁边的**浏览器**面板里跟进。

- Agent 在 shell 里用 `penguin browser` 驱动：`open`、`scan`、`click`、`type`、`exec`。预装的 `browser-automation` 插件会教它们这套循环。
- 省 Token：Agent 用 `scan` 把页面读成文本，再用一小段 `exec` 脚本操作，只有布局要紧时才截图。这套设计来自 [GenericAgent](https://github.com/lsdefine/genericagent)，感谢它的作者。
- 内置浏览器有自己独立的登录状态。**从浏览器导入…**可以复制 Chrome、Edge、Firefox 等浏览器的 cookie 和历史记录。
- 想用自己的 Chrome，从 Chrome Web Store 安装 PenguinHarness Browser，再到**设置** › **浏览器**里配对。Agent 只会操作 Penguin 标签组里的标签页。

![Agent 在浏览器面板里阅读 PenguinHarness 博客，并列出最新文章](/blog-assets/penguinharness-0-2-14-browser-zh.png)

教程：[浏览器扩展：Agent 低成本地丝滑操作 Chrome](/blog/let-agents-use-the-browser)。

### A2UI：回复里自带 UI

回复现在可以包含组件（选项、表单、步骤、提示框、Mermaid 图表，以及天气、时钟、倒计时和指标小组件），由应用自带的组件和主题渲染。

- 选中一个选项或填完表单，输入框里会出现纯文本。在你按下发送之前，什么都不会发出去。
- 预装的 `a2ui` 插件会教模型什么时候该用块，还附带一个校验器，会拒绝无法渲染的块。CLI 和聊天渠道里，块一律显示为纯 Markdown。

![一条带 Mermaid 流程图、步骤块和选项的回复](/blog-assets/penguinharness-0-2-14-a2ui-blocks-zh.png)

![一条带天气、时钟、倒计时和指标小组件的回复](/blog-assets/penguinharness-0-2-14-a2ui-widgets-zh.png)

### 给每个 Agent 一个热定制工作台

每个 Agent 都可以有自己的工作台：开口要一个，Agent 就会写出一个 workflow（工作流），也就是带服务端代码的页面，作为标签页显示在对话旁边。法务 Agent 的合同工作台和数据 Agent 的仪表盘各归各的 Agent，应用的其他部分不受影响。

- 服务端对每次改动做类型检查，并原地重新加载标签页。改动加载失败时，上一个版本继续运行。
- 加载成功的版本会保留下来，最多 20 个。**历史**列出这些版本，**恢复**可以找回任意一个。

![法务 Agent 的合同工作台，一句话生成，说一声就能改](/blog-assets/penguinharness-0-2-14-workflow-zh.png)

教程：[给每个 Agent 一个热定制工作台](/blog/build-agent-apps-with-workflows)。

## 随处运行，随处调用

### 远程机器

管理员添加一台服务器能通过 ssh 访问的机器，PenguinHarness 会自动装上去。Workspace 在那台机器上的对话，就在那台机器上运行，而你还留在同一个窗口。

- **机器管理**页面上的**添加机器**会完成安装和连接，并把 Project 的模型和设置一并交接过去。
- 新对话里，**Workspace**选择器会列出你各台机器上的文件夹。侧边栏会标注分组，例如 `etl [SSH: devbox]`。
- 即使任何一侧断开连接或重启，机器也能保持连接。

![在机器 devbox 上运行的对话](/blog-assets/penguinharness-0-2-14-machines-zh.png)

教程：[一个窗口，让 Agent 跑在你的每一台机器上](/blog/run-agents-on-remote-machines)。

### Agent API

每个 Agent 都可以有 HTTP API：你的程序发送输入，然后以 AMSP 事件流的形式读取这次运行。

- 在 Agent 的**API**标签页里开启，再用**新建密钥**创建密钥。**试一试**会运行 Agent，并展示程序会收到的流。
- `@prismshadow/amsp` 是零依赖的 TypeScript 客户端，支持 Node 24 和浏览器。在终端里，`penguin agent api` 管理同样的设置。

![运行一次后的「试一试」：工具调用、回答和本次运行的总计](/blog-assets/penguinharness-0-2-14-agent-api-zh.png)

教程：[通过统一 API 将 Agent 接入任意外部应用](/blog/call-agents-with-the-agent-api)。

## 本版其他更新

![同一段对话在 Frost、Console 和 Primer 下的样子，自上而下](/blog-assets/penguinharness-0-2-14-themes-zh.png)

- **三种主题。**Frost 是新的默认主题；Console 和 Primer 在**设置** › **外观** › **主题**里，各有自己的字体、图标和流式输出效果。
- **统一的插件市场。**每个插件都是一张卡片，按分类分组。**导入插件**接受 npm 包名、链接或 zip，**导出**会把插件打包成 zip。
- **每次安装都自带沙箱**：Linux 上是 bubblewrap 加 Landlock 兜底，macOS 上是 Seatbelt，Windows 上是 WSL。沙箱默认关闭，管理员在**Agent 运行沙箱**卡片上启用后才会生效。
- **查找栏。**Mod+F 可搜索当前对话、会话列表或文件浏览面板。
- **快捷键**跟随平台，可在**设置** › **快捷键**里重新绑定，还带有命令面板（Mod+Alt+P）。
- **在对话中切换模型。**上下文会先在旧模型上压缩，同一个会话接着在新模型上继续。
- **已归档对话移入设置。**侧边栏只列出活跃对话。
- **模型目录：**预置 Claude Fable 5.1、Claude 5.5 和 GPT-6.1 Sol，另有 Penguin Go、OpenCode Go、ModelScope 和 Atlas Cloud 分组。模型访问现在运行在 MMSP 0.5.2 上。
- **热更新不再打断 Task。**Harness 热更新，以及安装或移除插件，都不再中止正在运行的 Task，也不再拒绝待审批的请求。只有更新改变了 Agent State 接口时，被打断的 Task 才会从 Trace 重新开始。
- **失败请求恢复得更好。**重试时会告诉模型上次失败的原因，失败的运行带**重试**按钮，服务商拒绝的图片也不再打断对话的其余部分。

## 升级须知

- **应用打开时就是 Frost。**想找回 0.2.13 的外观，在**设置** › **外观** › **主题**里选 Primer，并在**字号**里选 L（默认值已从 18px 降到 16px）。
- **`agent-tuning` 已移除。**拆成了 `default-rsi-toolkit`、`agent-evaluation` 和 `agent-development`。现有 Agent 保留自己的 Skill；先从**插件市场**安装 OPRO、APE、ACE 或 AWM 工具包，再把它选为方法。
- **插件的清单就是它的 `package.json`。**`plugin.json` 不再读取：把 PenguinHarness 自己的字段移进 `penguin` 块，npm 的字段仍留在顶层。
- **应用不再读取数据根目录的 `plugins.json`。**请改为在**设置** › **插件**的**Agent 运行沙箱**卡片上打开沙箱。
- **在模型库页面点击「同步新增模型」**（原「同步预置」），把新预置加入现有 Project。
- **网关分组和自定义模型行需要自己的密钥。**它们不再借用环境里的 `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` 或 `GEMINI_API_KEY`；请在**分组设置…**里设置。
- **将 `AGENTHUB_DEBUG` 和 `AGENTHUB_CACHE_DIR` 重命名**为 `MMSP_DEBUG` 和 `MMSP_CACHE_DIR`。
- **更新每个 Agent 的内核**：在**智能体**页面点**现在升级**，再按**插件市场**页面上的提示更新 `goal`、`agent-development` 和 `agent-company`。
- **给现有 Agent 安装新插件。**`browser-automation`、`a2ui` 和各 RSI 工具包只预装在 0.2.14 新建 Project 的 General Agent 上；其他 Agent 请到**插件市场**页面安装。
- **CLI 命令有变动：**`penguin ls`、`penguin logs` 和 `penguin input` 现在是 `penguin session ls`、`penguin session log` 和 `penguin session input`；`penguin config provider` 已移除，改用不带 `--model-id` 的 `penguin config model add --provider <group>`。
- **程序发起的对话会被归档。**Agent API、定时任务或 `penguin run` 发起的会话（包括升级前的）不再出现在侧边栏，可以在**设置** › **已归档对话**里找到。
- **`.project_config.toml` 会在首次读取时重写一次**，数据库打开时会运行 9 到 16 号迁移。0.2.14 之前的版本读不了重写后的文件，所以如果之后可能回滚，请先复制一份。

完整列表（包括 HTTP API 和 SDK 变更）见 [`changelog/0.2.14/`](https://github.com/Prism-Shadow/penguin-harness/tree/main/changelog/0.2.14)。

## 安装

桌面端安装包在 [penguin.ooo/download](https://penguin.ooo/download)。

Linux 和 macOS 上，用以下命令安装 CLI 和服务器：

```sh
curl -fsSL https://penguin.ooo/install.sh | sh
penguin web
```

Windows 上用 PowerShell：

```powershell
irm https://penguin.ooo/install.ps1 | iex
penguin web
```

用 Docker 运行服务器：

```sh
docker run -d --name penguin -p 127.0.0.1:7364:7364 -v penguin-data:/data hiyouga/penguinharness:latest
```
