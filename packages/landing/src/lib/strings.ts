/**
 * Landing copy (bilingual): this file holds the Chinese dictionary `zh` and the runtime
 * active dictionary `S`; the English dictionary lives in strings-en.ts (constrained to
 * the same shape by the `Strings` type). Locale switching is handled by the shared
 * SiteLocaleProvider (app.tsx), which calls `setActiveStrings`, and SiteLocaleScope remounts
 * the tree keyed by locale — keep `S.x` reads inside components. English marketing copy uses lowercase `agent`; preserve the
 * established casing of Workspace, Token, Task, Skill, Trace, and other product terms.
 */
export const zh = {
  siteName: "PenguinHarness",

  announcement: {
    label: "公告",
    prev: "上一条公告",
    next: "下一条公告",
    geminiArgon: "Gemini 4 Argon 已上线，查看 0.2.16 更新日志",
    tokenDanceChallenge: "TokenDance Agent 冲榜赛：15,000 元 Token 奖池，10 月 23 日截止",
    penguinGo: "Penguin Go 官方 Token 包上线，Gemini 全系列模型 5 折",
  },

  nav: {
    home: "主页",
    blog: "博客",
    download: "下载",
    amsp: "AMSP",
    docs: "文档",
    gallery: "画廊",
    github: "GitHub",
    openMenu: "打开菜单",
    closeMenu: "关闭菜单",
  },

  theme: {
    label: "主题",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
  },

  lang: {
    label: "语言",
    zh: "中文",
    en: "English",
    system: "跟随系统",
  },

  hero: {
    positioning: "统一、稳定的 Agent 自进化框架",
    /** The badge on the positioning line's top-right corner. */
    badge: "免费开源",
    /** A no-break space before each dot keeps it at the end of its line when a phone wraps. */
    automation: "全自动优化：任意模型\u00a0· 任意算法\u00a0· 任意 Benchmark",
    downloadCta: "下载桌面版",
    cliInstall: "命令行安装",
    stats: [
      { value: "跨平台部署", label: "Linux · Windows · macOS" },
      { value: "100% 开源", label: "Apache 2.0 协议" },
      { value: "首个自进化 Harness", label: "原生 Agent 自进化引擎" },
    ],
    /**
     * The three catalogue rows under the stat tiles, each led by its count; their entries live in
     * lib/rsi-stats.ts. The model count is a claim about the catalog and is spelled here; the
     * algorithm and Benchmark counts are those lists' lengths.
     */
    supportedModelsCount: "1000+",
    supportedModelsLabel: "支持模型",
    supportedModelsMore: "以及更多",
    algorithmsLabel: "自进化算法",
    benchmarksLabel: "评估集",
    /** One per BENCHMARKS entry, in its order (the benchmarks of Sec A to Sec E, then GDPevo): the kind of each. */
    benchmarkKinds: ["数据分析", "软件工程", "业务自动化", "科学研究", "终端任务", "Agent 自进化"],
    /** The confirmation an outside link in the catalogue rows asks before it opens. */
    externalLink: {
      title: "即将打开外部链接",
      body: "这个链接指向 PenguinHarness 之外的网站，会在新标签页中打开：",
      cancel: "取消",
      open: "继续打开",
    },
  },

  /** Install-method switcher (quick start step 1): OS tabs, online/offline methods. */
  install: {
    linux: "Linux",
    macos: "macOS",
    windows: "Windows",
    online: "在线安装",
    offline: "离线安装包",
    offlineNote:
      "每个 GitHub Release 每个目标只附带一个安装包（Linux / macOS 各 x64 与 arm64，Windows 为 x64），同一个文件同时服务在线与离线安装。包内封入程序负载、SHA256 校验文件与安装器：在有网机器下载这一个文件，拷贝到目标机器解压安装，全程无需联网。",
    offlineHints: {
      linux: "arm64 机器换用 penguin-linux-arm64.tar.gz。",
      macos: "Apple 芯片用 arm64 包，Intel 芯片换用 penguin-darwin-x64.tar.gz。",
      windows: "解压后也可直接双击 install.cmd 完成安装。",
    },
    offlineRelease: "前往 GitHub Releases 下载离线安装包",
    desktopNote: "已经装了桌面版？CLI 安装与桌面版共用同一份本地数据，两者可以随时并用。",
    desktopPage: "前往桌面端下载页",
  },

  download: {
    eyebrow: "下载",
    title: "下载桌面端",
    recommended: "当前系统",
    platforms: {
      mac: { name: "macOS", require: "macOS 11 及以上，dmg 安装镜像（按芯片选择）" },
      windows: { name: "Windows", require: "Windows 10 及以上（x64），NSIS 安装程序" },
      linux: { name: "Linux", require: "x64，AppImage 免安装运行，或 deb 交给包管理器" },
    },
    speed: {
      title: "智能选择最快下载源",
      subtitle: "页面会先确认连通性，再在后台测速；下载按钮无需等待完整测速即可使用。",
      github: "GitHub Releases",
      githubHint: "全球源",
      oss: "OSS 国内镜像",
      ossHint: "中国大陆优化",
      testing: "测速中",
      skipped: "未测速",
      unreachable: "暂不可达",
      belowFloor: "速度过低",
      selected: "当前下载线路",
      automatic: "自动选择",
      manual: "手动选择",
    },
    statusProbing: "正在为你确认可用的下载源……",
    statusRefining: "仍在比较两个源的速度，更快的一个会自动生效。",
    statusOss: (version: string) => `已连接 OSS 国内镜像（${version}），点击即从镜像高速下载。`,
    statusGithub: "下载指向 GitHub Releases 的最新版本。",
    altGithub: "改从 GitHub 下载",
    altOss: "改用 OSS 镜像下载",
    checksums: "校验和（SHA256SUMS.desktop）",
    allReleases: "打开 GitHub 发布页",
    /**
     * First-launch FAQ. The macOS builds are Developer ID signed and notarized and the
     * Windows installers are Authenticode signed, so those two platforms have nothing to
     * unblock; the Linux AppImage's execute bit is the one item left, pre-expanded for a
     * Linux visitor.
     */
    faq: {
      title: "首次启动常见问题",
      intro:
        "macOS 安装包已由 Developer ID 签名并公证，Windows 安装程序已 Authenticode 签名，两个平台首次启动都无需额外放行；只有 Linux 是例外。",
      linux: {
        question: "Linux 双击 AppImage 没有反应？",
        answer:
          "浏览器下载的 AppImage 默认没有执行权限，赋权一次后即可正常启动（deb 包经包管理器安装，无此问题）：",
      },
    },
    cliHint: "只需要命令行或浏览器里的 Web 界面？",
    cliHintLink: "参见快速开始",
  },

  copy: {
    copy: "复制",
    copied: "已复制",
  },

  /** A live frame's window bar and its stand-in (components/live-app-frame.tsx). */
  live: {
    /** The link to the same screen in the component gallery, full size. */
    open: "在画廊中打开",
    loading: "正在载入实时演示…",
  },

  /** The app live under the hero, and the three rows beside it (sections/showcase.tsx). */
  showcase: {
    /** Each `frame` names its frame for assistive technology. */
    start: "开始页（实时演示）",
    evolve: {
      title: "一句话启动 Agent 自进化",
      text: "说出要优化的智能体、评估集和目标分数，PenguinHarness 就会修改它、重新评测，分数更高才保留。",
      link: "自进化怎么运作",
      frame: "一轮自进化的对话（实时演示）",
    },
    evaluate: {
      title: "每个版本都有分数",
      text: "同一套 Benchmark 上的每次评测，按智能体和模型连成一条线，哪一版更好一眼可见。",
      link: "了解评估中心",
      frame: "评估中心里的一套 Benchmark（实时演示）",
    },
    toolkits: {
      title: "自进化算法通过插件接入",
      /** `names`: the paper toolkits, already listed (OPRO、APE、…). */
      text: (names: string) => `除了默认循环，${names} 各自是一个工具包，按原论文的流程运行。`,
      link: "浏览插件库",
      frame: "插件市场（实时演示）",
    },
  },

  /** The self-evolution loop and its three recorded numbers (sections/self-improve.tsx). */
  selfImprove: {
    title: "多智能体协同的自进化框架",
    subtitle:
      "默认由 General Agent 运行优化 Skill，每一轮只改被测 Agent 的一处；Evaluator 子 Agent 运行评估 Skill，在 Benchmark 的每个题目上给修改后的 Agent 打分。",
    nodeOptimizer: "Optimizer",
    nodeEvaluator: "Evaluator × N",
    nodeTarget: "被测 Agent",
    edgeSpawn: "并行派发",
    edgeFeedback: "分数与 Trace",
    edgeBench: "逐题运行并打分",
    edgeImprove: "修改 AGENTS.md、Skill 或配置",
    noteOld: "修改前先保存快照",
    noteNew: "只有分数更高才保留",
    /** Index-aligned with TRENDS in sections/self-improve.tsx. */
    trends: [
      { label: "分数", hint: "满分 100" },
      { label: "成本", hint: "每次运行" },
      { label: "耗时", hint: "每次运行" },
    ],
    trendsNote: "记分板会记录每个版本的分数、成本和耗时。这里的数值仅为示意。",
    demo: {
      caption: "演示：决策智能体经过评测、一次工作方法改进和同模型复测，分数从 84 提升到 100。",
      cost: "被测 Agent 的 6 次运行花费 $0.0373，不含出题、评分和优化的成本。",
    },
    diagramLabel:
      "一轮自进化：Optimizer 运行 agent-optimization，并派发运行 agent-evaluation 的 Evaluator 子 Agent。它们在每个 Benchmark 题目上运行被测 Agent 并打分。Optimizer 根据分数和 Trace 把版本 N 修改为版本 N+1。只有分数更高，版本 N+1 才会保留。版本 N 在修改前会先保存为快照。",
  },

  quickstart: {
    title: "装好 PenguinHarness，选一种方式启动",
    subtitle: "桌面版装好就能用；用命令行安装的，可以开 Web 界面，也可以直接在终端里用。",
    stepOne: "第一步",
    chooseInstall: "选择安装方式",
    stepTwo: "第二步",
    chooseLaunch: "选择启动方式",
    tabs: {
      desktop: "桌面端",
      install: "命令行安装",
      web: "启动 Web UI",
      cli: "启动 CLI",
    },
    desktop: {
      title: "桌面版：打开就能用",
      desc: "内置本地服务与完整 Web 界面，无需先配置运行环境，也无需在终端里保持进程。",
      cta: "选择系统并下载",
      steps: [
        "下载适合当前系统的安装包",
        "打开 PenguinHarness，按引导配置模型",
        "输入一句话，生成第一个 AI 应用",
      ],
    },
    install: {
      title: "一行命令安装 PenguinHarness",
      desc: "适合开发机、服务器和私有化环境。安装包自带运行时，不依赖系统里的 Node.js。",
      osLabel: "选择操作系统",
      onlineTitle: "在线安装",
      offlineTitle: "离线安装包",
      offlineDesc: "在有网机器下载目标系统的安装包，再拷贝到离线机器完成安装。",
      offlineCommand: "展开离线安装命令",
    },
    web: {
      title: "在浏览器里使用完整界面",
      desc: "命令会启动本地服务并自动打开 Web UI，适合服务器部署和远程访问。",
      command: "penguin web   # 打开 http://127.0.0.1:7364",
      steps: ["先完成命令行安装", "运行 penguin web", "按终端提示登录并配置模型"],
    },
    cli: {
      title: "直接从终端运行 Agent",
      desc: "进入交互式对话，或把单次任务接入脚本和自动化工作流。",
      command: `penguin chat

# 或执行单次任务
penguin run --message "分析 data.csv，输出季度销售额"`,
    },
    localNote: "桌面端、Web UI 与 CLI 共用 ~/.penguin/data；切换入口不会迁移或复制数据。",
  },

  cases: {
    title: "一句话 + 0.6 元构建法务应用",
    subtitle:
      "用一句话描述需求，PenguinHarness 就能构建法务智能体应用：上传合同、识别风险并生成审阅报告。",
    prompt:
      "新建一个法务智能体，负责审阅合同、协议等法律文件：找出风险条款、说明理由并给出修改建议。再在法务智能体上做一个 Agent Workbench 标签页，当作它的工作台：我上传文件后，由它在后台分析，完成后生成一份分析报告供我下载。页面上只要上传、文件列表（每个文件的处理状态）和报告下载，不显示任何对话过程；颜色一律取自主题变量，明暗两种主题下都要好看。",
    caption: "生成的应用：上传合同，查看每个文件的处理状态，下载列出风险条款和修改建议的审阅报告",
    cost: "5 次样件审阅的模型花费：$0.0423。",
  },

  /**
   * The radiating diagram and its cards (sections/pillars.tsx): each item's `concept` labels one
   * branch of the diagram and the card under it. Concept names are product names, the same in
   * both languages.
   */
  pillars: {
    title: "以文件为中心的极简 Agent 架构",
    subtitle: "Agent 变强时，改的是它的文件，模型保持不变。",
    root: "PenguinHarness",
    diagramLabel:
      "PenguinHarness 分出 OmniMessage、Penguin SDK 和 Agent State 三支，各指向下方一张卡片",
    items: [
      {
        concept: "OmniMessage",
        title: "Simplest Is the Best",
        desc: "引擎流式输出 OmniMessage，Trace 逐条存下，Web App 直接渲染，中间没有第二种格式。模型经 MMSP 接入，Agent API 把每次运行以 AMSP 事件流返回。",
        link: "OmniMessage 协议",
      },
      {
        concept: "Penguin SDK",
        title: "Harness for Building Agents",
        desc: "PenguinHarness 里的每个 Task 都跑在 @prismshadow/penguin-core 上，同一个包也能从 npm 安装。借助 penguin-sdk Skill，Agent 能在它之上做出独立运行的应用，比如回答时标注来源的 RAG 应用。",
        link: "SDK 快速上手",
      },
      {
        concept: "Agent State",
        title: "Harness for Recursive Self-Improvement",
        desc: "它的提示词、Skill 和设置都是 Agent State 里的文件。自进化改的就是这些文件，每个版本在改动前都会先存快照。",
        link: "配置参考",
      },
    ],
  },

  /** Building on an agent library against PenguinHarness (sections/compare.tsx). */
  compare: {
    title: "快速搭建企业级 Agent",
    subtitle:
      "Agent 开发库负责调用模型和工具的那个循环。在它之外，你还需要一个界面、每次运行的记录、给 Agent 打分的办法，以及供外部调用的 API。",
    library: {
      name: "Agent 开发库",
      mode: "每一块都自己搭",
      note: "每一块要么自己写，要么另接一个产品。",
    },
    penguin: {
      name: "PenguinHarness",
      mode: "已经搭好",
      note: "Web App、Trace、带内置 Benchmark 的评估中心、自进化工具包、沙箱和 Agent API。",
    },
  },

  scenarios: {
    title: "从体检中心到工厂车间",
    subtitle: "两家企业用 PenguinHarness 自动开发 Agent，已用于生产环境。",
    items: [
      {
        title: "体检报告质控",
        alt: "体检中心的 CT 检查室",
        body: "一家体检机构使用 PenguinHarness 自动开发了报告质控 Agent，并将它部署到院内生产环境，接入本地 Qwen3 14B，数据不出机房。过去一轮人工复核要 30 分钟，现在每分钟自动核查 30 份报告，结论与医学专家基本一致，审核产能提升数倍。",
      },
      {
        title: "产线设备巡检",
        alt: "自动化半导体生产线",
        body: "一家制造企业使用 PenguinHarness 自动开发了产线巡检 Agent，并将它部署到多条流水线的生产环境。Agent 全天候监测设备状态，发现异常后优先尝试自动恢复；上线后停机时间减少 65%，产出提升约 2 倍。",
      },
    ],
  },

  benchmark: {
    title: "与 Claude Code、Codex 准确率相当，成本低几十倍",
    subtitle: "三个产品各用常配的模型，在两套题上比准确率、Token 用量和花费。",
    higherBetter: "越高越好",
    lowerBetter: "越低越好",
    dimScore: "准确率",
    dimTokens: "Token 用量",
    dimCost: "成本",
    dataTitle: "复杂数据分析",
    dataDesc:
      "三者中准确率最高（66.67%，另两者均为 53.33%），成本只有 OpenAI Codex 的 1/35、Claude Code 的 1/70。",
    dataFootnote:
      "15 道复杂数据分析任务 · 单次运行 · Token 与成本为全套题目合计 · 按官方计价估算。",
    codeTitle: "代码任务",
    codeDesc:
      "准确率与 OpenAI Codex 持平（71.25%）、低于 Claude Code（86.25%），但成本只有前者的 1/58、后者的 1/39。",
    codeFootnote:
      "40 道代码任务 × 2 次运行（准确率取全部 80 次结果）· Token 与成本为全套题目合计 · 按官方计价估算。",
    colFramework: "实验框架",
    colModel: "模型名称",
    colAccuracy: "准确率（%）",
    colTokens: "Token 用量（M）",
    colCost: "成本（$）",
  },

  /** The latest posts on the home page (sections/updates.tsx). */
  updates: {
    title: "最新动态",
    all: "全部文章",
  },

  community: {
    title: "加入社区",
    subtitle: "在 Discord 和微信群里提问，或者在 GitHub 上提 Issue、发 PR。",
    items: {
      discord: { name: "Discord", desc: "和团队及其他开发者交流。" },
      x: { name: "X（Twitter）", desc: "产品更新与发布消息。" },
      wechat: { name: "微信群", desc: "中文交流群。" },
      github: { name: "GitHub", desc: "源码、Issue 和 PR。" },
    },
  },

  cta: {
    title: "下载 PenguinHarness，跑你的第一轮自进化",
    subtitle: "每一版都记下分数、存了快照，变差了可以一步退回。",
    download: "下载桌面版",
    quickstart: "快速开始",
    docs: "阅读文档",
  },

  footer: {
    tagline: "统一、稳定的 Agent 自进化框架",
    product: "产品",
    resources: "资源",
    quickstart: "快速开始",
    cases: "案例",
    blog: "博客",
    repo: "GitHub 仓库",
    docs: "文档",
    releases: "Releases",
    license: "Apache-2.0 License",
    copyright: "© 2026 Prism Shadow · 基于 Apache-2.0 协议开源",
  },

  blog: {
    title: "博客",
    subtitle: "产品动态、技术实践、观点与更新日志",
    all: "全部",
    news: "产品动态",
    practice: "技术实践",
    perspectives: "观点",
    changelog: "更新日志",
    pinned: "置顶",
    copyLink: "复制页面链接",
    linkCopied: "已复制",
    back: "返回博客",
    empty: "该分类下暂无文章",
    notFound: "文章不存在",
    backHome: "返回首页",
    toc: "目录",
    /** The heading over a post's numbered citations. */
    references: "参考资料",
    /** A citation's back-link, for screen readers: the k-th place in the text that cites source n. */
    backToRef: (n: number, k: number) =>
      k > 1 ? `返回正文中引用 ${n} 的第 ${k} 处` : `返回正文中的引用 ${n}`,
  },

  /**
   * The AMSP page (pages/amsp.tsx, sections/amsp/*): AMSP, the Session stream, on one page, with
   * scripted runs replayed. Protocol names (record kinds, fields, routes) stay as the protocol
   * spells them; the Web App's labels are quoted verbatim from its dictionary.
   */
  amsp: {
    /** The tab title and description while the page is open; the static shell carries the English pair (scripts/site-routes.mjs). */
    title: "AMSP — Agent Message Stream Protocol | PenguinHarness",
    description:
      "AMSP 是 PenguinHarness Agent 的 Session 流：模型的文本与思考、工具调用与结果、审批、用量和 Task 边界，经 SSE 实时送达，与 Trace 存下的记录一致。",
    /** No-break spaces keep 「所有 Agent 消息」 on one line: the headline breaks at its comma. */
    headline: "所有\u00a0Agent\u00a0消息，同一种协议",
    subline:
      "模型的文本和思考、每次工具调用及其结果、审批、Token 用量和 Task 边界，经 SSE 实时送达，用的就是 Trace 存下的那些记录。",
    /** The sentence after the "MMSP" link, which opens it. */
    lineage: " 传输一次模型调用；AMSP 传输 Agent 的一个 Session。",
    reference: "协议参考",
    copyPrompt: "复制给编码 Agent 的提示词",
    copied: "已复制",
    /** The Web App's API-tab prompt (apiAgentPrompt), with the per-Agent lines pointing at that tab. */
    agentPrompt: (docsUrl: string) =>
      `请先阅读 PenguinHarness Agent API 使用文档：${docsUrl}，然后帮我编写调用 Agent 的代码。\n\nBase URL 与 Agent ID：在 PenguinHarness 中该 Agent 的 API 标签页查看。\n\n使用 @prismshadow/amsp SDK：stream() 逐条读取记录，await run() 获取完整结果。需要密钥时，从 PENGUIN_AGENT_KEY 环境变量读取，不要硬编码。用 sessionId 继续已有会话。按文档处理审批请求和 HTTP 429；收到 429 时遵循 Retry-After。`,

    player: {
      label: "示例运行",
      scenarios: { first: "首次请求", continue: "继续对话", interrupt: "打断" },
      pause: "暂停",
      play: "播放",
      input: "同一个客户端",
      events: "流依次到达",
      /** The legend of the faint ground under the records the Trace stores. */
      stored: "写入 Trace",
      /** A request the caller sends beside the stream (the interrupt). */
      besideStream: "流之外的请求",
      assembled: "这次运行的全貌",
      request: (n: number) => `Request ${n}`,
      thinking: (level: string) => `思考等级 ${level}`,
      streaming: "传输中",
      running: "运行仍在进行。",
      result: "结果",
      /** What the result was read from; protocol words stay as the protocol spells them. */
      readFrom: (o: {
        closed: boolean;
        aborted: boolean;
        lastRequestEnd: string | null;
        finalText: string | null;
      }) =>
        `由记录读出：${o.closed ? "每个 task_begin 都已闭合" : "有 task_begin 未闭合"}，${o.aborted ? "有 abort" : "没有 abort"}，最后一个 request_end 为 ${o.lastRequestEnd ?? "无"}，最后一条回复为 ${o.finalText ?? "无"}。`,
      requests: (n: number) => `${n} 次 Request`,
      tokens: (n: string) => `${n} Token`,
    },

    /** A run's three levels as one bar chart (sections/amsp/structure.tsx). */
    structure: {
      title: "消息结构",
      subtitle:
        "一次运行嵌套三层，从长到短依次是：Task、每次向模型发出的 Request，以及每条消息从第一个片段到完整记录的过程。",
      figureLabel:
        "首次请求示例画在同一条时间轴上，按时长从长到短分三行。Task 从 task_begin 到 task_end。其下是两个 Request，各自从 request_begin 到 request_end。再下面是消息，每条从第一个 partial_* 片段到完整记录：第一个 Request 里的思考和工具调用，在第一个 request_end 之后才完整的工具输出，以及第二个 Request 里的回答。",
      /** The chart's row names, top to bottom. */
      levels: { task: "Task", request: "Request", message: "消息" },
      /** The figure in words: read out with it, and shown under it on a phone. */
      steps: [
        "task_begin 打开一个 Task，task_end 关闭它；[DONE] 时仍未闭合的 task_begin 说明运行没有走到终点。",
        "每个 Request 以带思考等级的 request_begin 开始，以 request_end 结束。",
        "消息先以 partial_* 片段流出（start、delta、stop），随后由完整记录取代。",
        "工具在 Request 仍打开时开始运行，它的 tool_call_output 可以在 request_end 之后才完整。",
      ],
      partial: "partial_* 片段，仅实时",
      complete: "完整记录，写入 Trace",
      caption: (ms: number) =>
        `图中是上面的首次请求示例：tool_call_output 在第一个 request_end 之后 ${ms} ms 才完整，早于下一个 request_begin。`,
    },

    /** The records and the control frames (sections/amsp/vocabulary.tsx), keyed by lib/amsp-vocabulary.ts. */
    vocabulary: {
      title: "全部记录与控制帧",
      subtitle:
        "记录就是 Trace 里的那一行，逐字节相同；Trace 只新增了 task_begin、task_end 和 request_begin 的 thinking_level。客户端忽略不认识的类型与事件名。",
      head: { envelope: "type", kinds: "payload.type", trace: "Trace", meaning: "含义" },
      stored: "写入",
      live: "仅实时",
      firstMessage: "仅随首条消息上流",
      meaning: {
        meta: "一个模型上下文开启：模型、系统提示词、Workspace 和来源。Session 的首条消息以它开启运行流，其中的 session_id 供之后的请求延续同一段上下文；之后的消息不再重复它。",
        complete: "完整消息，模型看到或说出的原样内容，附带提供方的 fidelity 数据。",
        partial: "流式传输中的同一批消息：start、delta、stop，随后由完整消息取代。",
        engine:
          "引擎的控制与计量记录：Task 与 Request 的边界、思考等级、Token 用量、压缩、审批决定、Hook 与 abort。",
      },
      frames: {
        title: "控制帧",
        head: { frame: "帧", data: "数据", meaning: "含义" },
        meaning: {
          resync_required: "续传用的 Last-Event-ID 已被挤出缓冲：重读历史后继续读这条流。",
          ping: "心跳，订阅后立即发送，此后每 20 秒一次。",
          done: "运行流的最后一行。",
        },
      },
    },

    /** Three steps to a first run (sections/amsp/quickstart.tsx); the code is lib/amsp-quickstart.ts. */
    quickstart: {
      title: "三步跑起第一次运行",
      enable: {
        title: "打开 Agent 的 API",
        /** The Web App's labels, verbatim from packages/web's zh dictionary. */
        text: "在 PenguinHarness 中打开「智能体」，选中一个 Agent，进入「API」标签页，打开「开启 API 访问」，再点「新建密钥」。",
        link: "Agent API 使用指南",
      },
      curl: {
        title: "用 curl 运行",
        response: "响应",
        note: "响应就是这次运行本身：每条记录一个带 id 的事件，Session 的首条消息以 session_meta 开头，最后是 data: [DONE]。",
        elided: "每条记录一个事件",
      },
      sdk: { title: "或者用 TypeScript" },
    },

    links: {
      title: "继续阅读",
      items: {
        reference: { name: "AMSP 协议参考", text: "逐条说明每种记录与控制帧" },
        records: { name: "AMSP 记录", text: "每种记录的 payload 字段" },
        guide: { name: "Agent API 使用指南", text: "密钥、审批模式、路由与错误" },
        npm: { name: "@prismshadow/amsp", text: "npm 上的 SDK，适用于 Node 24 与浏览器" },
        source: { name: "源码", text: "packages/amsp，Apache-2.0" },
      },
    },
  },
};

/** Dictionary shape (constrains the English dictionary so keys line up). */
export type Strings = typeof zh;

/**
 * Runtime active dictionary (live binding): the locale Provider calls setActiveStrings
 * to switch before render, and remounts the whole tree keyed by locale so every `S.x`
 * read reflects the current language.
 */
export let S: Strings = zh;

export function setActiveStrings(next: Strings): void {
  S = next;
}
