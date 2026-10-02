/**
 * The release notes the App info dialog lists under "What's new", one entry per released version
 * (the shape and the rules for writing one are in `release-notes.ts`).
 *
 * Edited only at release preparation, in the commit that writes the release's `RELEASE.md`: add
 * one entry for the new version. Newest first by convention; the dialog sorts them either way.
 */
import type { ReleaseNote } from "./release-notes";

export const RELEASE_NOTES: readonly ReleaseNote[] = [
  {
    version: "0.2.13",
    date: "2026-09-15",
    zh: [
      "公司模式（Beta）：把一个 Project 的 Agent 组织成一家公司，有 CEO、汇报树、日程、工单板与频道。",
      "评估中心重建：Benchmark 升为 Project 级，一个 Benchmark 可评估多个 Agent。",
      "文件面板成为完整的文件管理器，支持右键菜单。",
      "桌面应用关闭窗口后常驻系统托盘，后台任务继续运行。",
      "运行中的工具调用可转入后台；Shell 命令可通过插件受限运行。",
    ],
    en: [
      "Company mode (Beta): organize a Project's agents into a company with a CEO, a reporting tree, a calendar, a ticket board and channels.",
      "The Evaluation Center is rebuilt: Benchmarks are Project-level and one can evaluate several agents.",
      "The Files panel is a full file manager with a context menu.",
      "The desktop app keeps running in the system tray when its window closes.",
      "Send a running tool call to the background; shell commands can be confined through plugins.",
    ],
  },
  {
    version: "0.2.11",
    date: "2026-09-10",
    zh: ["重新构建 0.2.10，恢复签名的 macOS 安装包。", "功能内容与 0.2.10 相同。"],
    en: [
      "Rebuilds 0.2.10 so signed macOS installers are available again.",
      "The same feature set as 0.2.10.",
    ],
  },
  {
    version: "0.2.10",
    date: "2026-09-10",
    zh: [
      "文件面板升级为双栏浏览器，支持就地编辑与拖放上传。",
      "上下文圆环按压缩阈值填充，阈值可直接拖动调整。",
      "快捷球展开工作台，定时任务进入 Dock。",
      "Hook 成为运行循环的能力，目标模式与持续学习改为插件；新增「用 AI 创建」。",
      "官方 Docker 镜像；新增 DeepSeek V4.1 Flash、Gemini 3.8 Flash、GPT-6 Astra 等模型。",
    ],
    en: [
      "The Files panel becomes a two-pane browser with in-place editing and drag-and-drop uploads.",
      "The context ring fills against the compaction threshold, and the threshold is draggable.",
      "A shortcuts ball fans out the workbench; scheduled tasks move into the dock.",
      "Hooks become a capability of the loop; goal mode and continual learning become plugins; Create with AI arrives.",
      "An official Docker image, and DeepSeek V4.1 Flash, Gemini 3.8 Flash, GPT-6 Astra and more in the catalog.",
    ],
  },
  {
    version: "0.2.9",
    date: "2026-08-28",
    zh: [
      "模型库显示实际计费价格与折扣；DeepSeek 高峰与空闲价按每次请求计费。",
      "新增微信渠道，扫码即可绑定。",
      "新增「机器」页：把当前版本安装到 SSH 配置中的其他主机。",
      "每个有待更新项的页面提供一键全部更新。",
      "新建 Project 的默认模型可直接读取截图。",
    ],
    en: [
      "The model library shows the billed price and discounts; DeepSeek peak and off-peak rates are billed per request.",
      "WeChat joins as a channel, bound by scanning a QR code.",
      "A Machines page installs this build onto another host from your SSH config.",
      "One update-all button on every page with updates waiting.",
      "A new Project's default model reads pasted screenshots.",
    ],
  },
  {
    version: "0.2.8",
    date: "2026-08-27",
    zh: [
      "飞书与 Telegram 渠道可双向收发图片与文件。",
      "回复按各渠道自己的格式渲染，不再显示 Markdown 源码。",
      "新增 QQ 渠道，扫码即可绑定。",
      "penguin auth 支持终端登录；首次登录改用链接，不再打印固定密码。",
      "所有 Markdown 界面支持 LaTeX 公式。",
    ],
    en: [
      "Pictures and files travel both ways on Feishu and Telegram.",
      "Replies render in each channel's own formatting instead of raw Markdown.",
      "QQ joins as a channel, bound by scanning a QR code.",
      "penguin auth signs in from a terminal; first login uses a link instead of a printed password.",
      "LaTeX on every Markdown surface.",
    ],
  },
  {
    version: "0.2.7",
    date: "2026-08-27",
    zh: [
      "修复桌面端的飞书绑定，以及 Telegram 轮询冲突后的恢复。",
      "被渠道重复投递的消息只执行一次。",
      "桌面端自动把 penguin 命令放上 PATH。",
      "Workspace 已被删除时，命令会给出明确提示。",
    ],
    en: [
      "Fixes Feishu binding from the desktop app and Telegram's recovery from a poller conflict.",
      "A redelivered chat message runs once, not twice.",
      "The desktop app puts the penguin command on PATH by itself.",
      "A command whose Workspace was deleted now says so plainly.",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-08-27",
    zh: [
      "新增 TokenDance 网关分组，一键授权密钥；新增 GLM-5.3 Flash 与 Qwen 3.8 Flash。",
      "子 Agent 运行中可插话、可停止，它的审批请求会交给你。",
      "Session 可绑定飞书应用或 Telegram 机器人，无需公网地址。",
      "点击上下文圆环查看上下文的构成。",
      "侧边栏分组与模型分组可拖动排序；penguin CLI 改为服务端的客户端。",
    ],
    en: [
      "A TokenDance gateway group with one-click key authorization; GLM-5.3 Flash and Qwen 3.8 Flash join the catalog.",
      "Talk to a running subagent, stop it, and approve its requests yourself.",
      "Bind a Session to a Feishu app or a Telegram bot, with no public URL.",
      "Click the context ring to see what the context is made of.",
      "Drag sidebar and provider groups into your own order; the penguin CLI becomes a client of the server.",
    ],
  },
  {
    version: "0.2.5",
    date: "2026-08-27",
    zh: ["本版本仅发布到 npm，没有安装包；内容与 0.2.6 相同。"],
    en: ["Published to npm only, with no installers; the same set as 0.2.6."],
  },
  {
    version: "0.2.4",
    date: "2026-08-21",
    zh: [
      "会读图的 DeepSeek 模型，并补上直连的 Claude Opus 5 预设。",
      "聊天页改为右侧与底部两个标签式 Dock，终端画面刷新后原样恢复。",
      "命令与子 Agent 可后台运行，完成后自动回报。",
      "Project 级命令策略：任何审批模式下都拒绝破坏性命令。",
      "系统设置合并为一个对话框；用量图表改为时间序列。",
    ],
    en: [
      "A DeepSeek model that reads images, plus a direct Claude Opus 5 preset.",
      "The chat page gets two tabbed docks; terminals survive a reload intact.",
      "Commands and subagents can run in the background and report back when done.",
      "A Project-level command policy blocks destructive shell commands under every approval mode.",
      "One Settings dialog; usage charts become time series.",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-08-19",
    zh: [
      "从任意已完成的回复分叉出新 Session。",
      "排队中的插话与追问可召回输入框重新编辑。",
      "侧边栏实时显示每个 Session 在做什么。",
      "压缩过程可见；切换思考等级前说明代价，新增 max 档位。",
      "自定义模型自动探测协议与视觉能力；附件支持拖放上传。",
    ],
    en: [
      "Fork a new Session from any completed reply.",
      "Recall a queued steering or follow-up message back into the composer.",
      "The sidebar shows what every Session is doing, live.",
      "Compaction is visible as it runs; switching the thinking level states its cost, and a max tier arrives.",
      "Custom models detect their protocol and vision support; attachments drag and drop.",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-08-11",
    zh: [
      "跨 Session 的长期 Memory，分用户与 Workspace 两个作用域。",
      "支持 MCP Server（stdio、Streamable HTTP、SSE），可在应用内管理。",
      "Skills、Vault 与 Schedules 的提示词可编辑、可开关。",
      "Agent 配置带日期的内核版本，更新时保留你的改动。",
    ],
    en: [
      "Long-term Memory across Sessions, with user and Workspace scopes.",
      "MCP Server support over stdio, Streamable HTTP and SSE, managed in the app.",
      "Editable, switchable prompts for Skills, Vault and Schedules.",
      "Dated kernel versions for agent configs, with an update that keeps your changes.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-08-04",
    zh: [
      "桌面应用：打开即登录，提供三平台安装包。",
      "官网新增下载页，自动选择更快的下载源。",
      "压缩失败可自动重试，压缩成本在成本中心可见。",
      "管理员密码随机生成并有登录节流；Skill 可在 Agent 设置中管理。",
    ],
    en: [
      "The desktop app: signed in on open, with installers for all three platforms.",
      "A download page on the website that picks the faster source.",
      "Compaction retries after a malformed summary, and its cost shows in the cost center.",
      "A random admin password with login throttling; skills are managed from agent settings.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-08-03",
    zh: [
      "安装包镜像到阿里云 OSS，自动回退到 GitHub。",
      "长对话导航：↑ 召回历史输入、粘性运行标题、带预览的缩略轨。",
      "被截断的工具输出可从 Session 草稿区恢复。",
      "插话消息在刷新后仍保留，并可携带文件附件。",
      "模型目录刷新，新建 Project 默认使用 deepseek-v4-flash。",
    ],
    en: [
      "Installers mirrored to Alibaba Cloud OSS with automatic fallback to GitHub.",
      "Navigate long conversations: ↑ recalls earlier inputs, run headers stick, a minimap rail previews on hover.",
      "Truncated tool output can be recovered from the Session scratchpad.",
      "Steering messages survive reloads and carry file attachments.",
      "A refreshed model catalog; new Projects default to deepseek-v4-flash.",
    ],
  },
  {
    version: "0.1.5",
    date: "2026-07-30",
    zh: [
      "全部五个平台提供自包含的离线安装包。",
      "输入区可附加任意类型的文件，图片可用于插话与目标陈述。",
      "除凭证被拒之外的 LLM 失败都能在运行内自动恢复。",
      "web-design Skill 新增纸质编辑风主题。",
    ],
    en: [
      "Self-contained offline installers for all five platforms.",
      "Attach files of any type in the composer; images reach steering and goal objectives.",
      "Every LLM failure short of a rejected credential now recovers inside the run.",
      "The web-design skill gains a paper-editorial theme.",
    ],
  },
  {
    version: "0.1.4",
    date: "2026-07-27",
    zh: ["将 0.1.3 的全部功能发布到 npm（0.1.3 自身未能完成发布）。", "博客图片改由社区仓库托管。"],
    en: [
      "Brings the whole 0.1.3 feature set to npm, which 0.1.3 itself never reached.",
      "Blog images are now hosted in the community repository.",
    ],
  },
  {
    version: "0.1.3",
    date: "2026-07-27",
    zh: [
      "支持 Windows：自动选择 shell，提供 install.ps1 安装脚本。",
      "目标模式：给出目标后持续运行 Task 直到完成。",
      "子 Agent 面板：实时调用图，点击节点查看子会话。",
      "LLM 出错自动重连并显示倒计时；应用内显示版本、检查更新，管理员可自更新。",
    ],
    en: [
      "Windows support: a real shell is picked automatically, with an install.ps1 installer.",
      "Goal mode keeps running Tasks until the objective is done.",
      "A subagents panel with a live call graph; click a node to watch that conversation.",
      "LLM errors reconnect with a visible countdown; the app shows its version, checks for updates and lets an admin self-update.",
    ],
  },
  {
    version: "0.1.2",
    date: "2026-07-26",
    zh: [
      "内置文件工具：读取、编辑与写入文件，编辑以 git 风格 diff 展示。",
      "运行中可随时插话，或排队为后续消息。",
      "/model 交接式切换模型；思考等级可按请求选择。",
      "预置三个免费的 OpenRouter 模型；Workspace 的 HTML 预览可正常渲染。",
    ],
    en: [
      "Built-in file tools: read, edit and write files, with edits shown as git-style diffs.",
      "Steer a running agent mid-task, or queue a follow-up for when it finishes.",
      "/model hands a conversation over to another model; the thinking level is chosen per request.",
      "Three free OpenRouter models in the catalog, and Workspace HTML previews that render properly.",
    ],
  },
  {
    version: "0.1.1",
    date: "2026-07-22",
    zh: [
      "模型目录新增 Gemini 3.6 Flash 与 3.5 Flash-Lite，条目增至 70 个。",
      "新增 vLLM、Ollama、LlamaFactory Skill：用自然语言部署并微调自己的模型。",
      "penguin update 原地升级现有安装，不触碰数据目录。",
      "侧边栏按 Workspace 或 Agent 分组，分组可置顶，长列表分页加载。",
    ],
    en: [
      "Gemini 3.6 Flash and 3.5 Flash-Lite join the model catalog, now 70 entries.",
      "New vLLM, Ollama and LlamaFactory skills: serve and fine-tune your own models by asking.",
      "penguin update upgrades an existing install in place, never touching your data.",
      "The sidebar groups conversations by Workspace or agent, pins groups and pages long lists.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-07-21",
    zh: [
      "首个功能版本：Web App、CLI、官网与文档站。",
      "一句话生成完整的 Agent 应用，内置可自我评估与改进的 Skill 库。",
      "通过一个网关接入 1000+ 模型，预置 DeepSeek、Anthropic、OpenAI、Google 等分组。",
      "多会话对话、工具审批、Workspace 文件浏览、Trace 视图与成本中心。",
    ],
    en: [
      "First feature release: the Web App, the CLI, the website and the docs.",
      "Build a complete agent application from one sentence, with a skill library that evaluates and improves itself.",
      "Bring any model: 1000+ through one gateway, with preset groups for DeepSeek, Anthropic, OpenAI, Google and more.",
      "Multi-session chat with tool approval, a Workspace file browser, the Trace view and a cost center.",
    ],
  },
];
