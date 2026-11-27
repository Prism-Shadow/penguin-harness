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
  backToTop: "回到顶部",

  announcement: {
    label: "公告",
    prev: "上一条公告",
    next: "下一条公告",
    release0220: "PenguinHarness 0.2.20 已发布：Harness OS、语音输入输出、插件市场，查看更新日志",
    penguinGo: "Penguin Go 官方 Token 包上线，Gemini 全系列模型 5 折",
  },

  nav: {
    home: "主页",
    blog: "博客",
    download: "下载",
    plugins: "插件",
    benchmarks: "评估集",
    leaderboards: "榜单",
    rfcs: "RFCs",
    amsp: "AMSP",
    docs: "文档",
    gallery: "主题包",
    more: "更多",
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
    /** Two clauses keep the emphasized phrases and punctuation in each locale's reading order. */
    positioning: {
      growthLead: "从 ",
      growth: "许愿式编程",
      separator: " ",
      reachLead: "到 ",
      reach: "许愿式调优",
    },
    subtitle: "千万个 AI 应用的统一自进化底座",
    downloadCta: "下载桌面版",
    productHuntBadge: "PenguinHarness Product Hunt 徽章",
    watcha: "观猹",
    watchaBadge: "PenguinHarness 观猹徽章",
    cliInstall: "命令行安装",
    stats: [
      { value: "跨平台部署", label: "Linux、Windows、macOS" },
      { value: "100% 开源", label: "Apache 2.0 协议" },
      { value: "首个自进化 Harness", label: "原生 Agent 自进化引擎" },
    ],
    supportedModelsLabel: "支持模型",
    supportedModelsMore: "以及更多",
    algorithmsLabel: "自进化算法",
    benchmarksLabel: "评估集",
    /** The kind each BENCHMARKS entry is shown by, keyed by its `kind`. */
    benchmarkKinds: {
      dataAnalysis: "数据分析",
      softwareEngineering: "软件工程",
      businessAutomation: "业务自动化",
      scientificResearch: "科学研究",
      terminalTasks: "终端任务",
      biomedicine: "生物医学",
      agentSelfEvolution: "Agent 自进化",
    },
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
    /** The link to the same screen in the component gallery (Theme Packs), full size. */
    open: "在主题包中打开",
    loading: "正在载入实时演示…",
    playDemo: "播放演示",
    stopDemo: "停止演示",
    evolutionFrame: "一轮自进化的对话（实时演示）",
  },

  /** The self-evolution loop and its three recorded numbers (sections/self-improve.tsx). */
  selfImprove: {
    workbench: {
      title: "自进化工作台",
      agents: "Agent",
      stages: ["评估", "改进", "复测", "下一轮"],
      activeStages: ["评估中", "改进中", "复测中", "下一轮"],
      tasks: [
        { name: "医保审核", task: "对照医保条款与申报材料" },
        { name: "服务工单处理", task: "核实并处理待办工单" },
        { name: "财务管控", task: "核对账目与结账数据" },
        { name: "法院书记员业务", task: "核对立案材料，整理归档信息" },
      ],
    },
    toolkit:
      "RSI 工具包改的是 Agent 的 Harness，也就是它的提示词和 Skill，模型保持不动，每一处改动都在 Benchmark 上度量效果。",
    evaluate: "评估",
    optimize: "优化",
    title: "任意 Agent 的自进化",
    subtitle: "一句话启动循环，Teacher Agent 自动评估并调优其他 Agent 的提示词与 Skill。",
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
    sampleTrends: "进化趋势",
    trends: [
      { label: "准确率", hint: "满分 100" },
      { label: "成本", hint: "每次运行" },
      { label: "耗时", hint: "每次运行" },
    ],
    diagramLabel:
      "一轮自进化：Optimizer 运行 agent-optimization，并派发运行 agent-evaluation 的 Evaluator 子 Agent。它们在每个 Benchmark 题目上运行被测 Agent 并打分。Optimizer 根据分数和 Trace 把版本 N 修改为版本 N+1。只有分数更高，版本 N+1 才会保留。版本 N 在修改前会先保存为快照。",
  },

  quickstart: {
    title: "安装 PenguinHarness",
    subtitle: "桌面版装好即用；命令行版装好后打开 Web 界面或在终端使用。",
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
    os: "搭建自进化的 Harness OS",
    subtitle: "一句话把想法变成持续迭代的应用，还能通过应用市场分享。",
    workspace: {
      title: "应用中心",
      project: "Harness OS",
      builderLabel: "A2APP 一句话生成",
      generating: "生成应用中…",
      installing: "已装入 Harness OS",
      newFolder: "新建分组",
      createWithAi: "用 AI 创建",
      prompts: {
        competitor: "创建竞品监测应用：每天抓取对手官网的更新并汇总成简报",
        inventory: "做一个库存管理应用：扫码出入库，低于安全库存时提醒",
        weekly: "生成周报应用：读取本周的提交与工单，写成一页周报",
        monitor: "创建舆情监控应用：跟踪品牌关键词，出现负面内容立刻提醒",
        quotes: "做一个报价单应用：选择产品和数量，生成报价单 PDF",
        audit: "构建安全巡检应用：定期扫描依赖漏洞并生成修复清单",
        alerts: "生成运维告警应用：聚合监控告警，并给出可能的原因",
        tutor: "创建错题本应用：根据错题出同类练习，并讲解解题思路",
        contracts: "做一个合同台账应用：登记每份合同的金额与到期日，到期前提醒续签",
      },
      apps: {
        docs: "文档问答",
        investment: "投资分析",
        legal: "法务助手",
        slides: "AI PPT",
        images: "图像工作室",
        support: "客服工作台",
        expenses: "报销登记",
        terminal: "命令行终端",
        browser: "浏览器",
        meetings: "会议纪要",
        data: "数据分析",
        board: "项目看板",
        review: "代码审查",
        mail: "邮件助手",
        sales: "销售看板",
        hiring: "简历筛选",
        translate: "文档翻译",
        planner: "日程规划",
        competitor: "竞品监测",
        inventory: "库存管理",
        weekly: "周报生成",
        monitor: "舆情监控",
        quotes: "报价单",
        audit: "安全巡检",
        alerts: "运维告警",
        tutor: "错题本",
        models: "模型库",
        plugins: "插件市场",
        machines: "机器管理",
        usage: "成本中心",
        contracts: "合同台账",
      },
    },
  },

  /**
   * The radiating diagram and its cards (sections/pillars.tsx): each item's `concept` labels one
   * branch of the diagram and the card under it. Concept names are product names, the same in
   * both languages.
   */
  pillars: {
    title: "精简 Agent 架构",
    subtitle: "Agent 的进步靠改文件，模型不变。",
    root: "PenguinHarness",
    diagramLabel: "PenguinHarness 分出 AMSP、Penguin SDK 和 Agent State 三支，各指向下方一张卡片",
    items: [
      {
        concept: "AMSP",
        title: "Simplest Is the Best",
        desc: "引擎流式推送 AMSP 记录，Trace 负责存储，Web App 负责渲染，Agent API 对外提供服务。只有一种格式。",
        link: "AMSP 记录",
      },
      {
        concept: "Penguin SDK",
        title: "Harness for Building Agents",
        desc: "Task 运行在 @prismshadow/penguin-core 上，npm 上也能直接安装。有了 penguin-sdk Skill，Agent 就能构建独立应用，例如 RAG 应用。",
        link: "SDK 快速上手",
      },
      {
        concept: "Agent State",
        title: "Harness for Recursive Self-Improvement",
        desc: "提示词、Skill 和设置都是 Agent State 里的文件。自进化会修改这些文件，每个版本都先保存快照。",
        link: "配置参考",
      },
    ],
  },

  /** Building on an agent library against PenguinHarness (sections/compare.tsx). */
  compare: {
    title: "组件一应俱全",
    subtitle: "Agent 开发库只负责运行调用模型和工具的循环。",
    library: {
      name: "Agent 开发库",
      mode: "每一块都自己搭",
      note: "界面、运行记录、评分和 API 都要自己搭建。",
    },
    penguin: {
      name: "PenguinHarness",
      mode: "已经搭好",
      note: "Web App、Trace、内置 Benchmark 的评估中心、自进化工具包、Agent API、沙箱。",
    },
  },

  scenarios: {
    title: "两个已上线的 Agent",
    subtitle: "两家企业用 PenguinHarness 构建 Agent，已在生产中运行。",
    items: [
      {
        title: "体检报告质控",
        alt: "体检中心的 CT 检查室",
        body: "一家体检机构的报告质控 Agent 跑在本地 Qwen3 14B 上，数据不出机房。人工审核一轮要 30 分钟，现在每分钟能过 30 份报告。",
      },
      {
        title: "产线设备巡检",
        alt: "自动化半导体生产线",
        body: "一家制造商的产线巡检 Agent 同时跑在多条产线上，全天候盯着设备。出了问题先尝试自动恢复。停机时间下降 65%，产出提升约 2 倍。",
      },
    ],
  },

  benchmark: {
    title: "准确率比肩 Claude Code 与 OpenAI Codex，成本只要零头",
    subtitle: "每个产品都跑在自己常用的模型上，我们对比准确率、Token 用量和成本。",
    higherBetter: "越高越好",
    lowerBetter: "越低越好",
    dimScore: "准确率",
    dimTokens: "Token 用量",
    dimCost: "成本",
    dataTitle: "复杂数据分析",
    dataDesc:
      "PenguinHarness 准确率三者最高，达 66.67%，两款竞品均为 53.33%，成本是 OpenAI Codex 的 1/35、Claude Code 的 1/70。",
    dataFootnote: "15 道复杂数据分析任务，单次运行；Token 与成本为全套题目合计，按官方计价估算。",
    codeTitle: "代码任务",
    codeDesc:
      "准确率与 OpenAI Codex 持平（71.25%），低于 Claude Code（86.25%），成本分别是 OpenAI Codex 的 1/58、Claude Code 的 1/39。",
    codeFootnote:
      "40 道代码任务，每道运行 2 次，准确率取全部 80 次结果；Token 与成本为全套题目合计，按官方计价估算。",
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
    subtitle: "有问题欢迎提问，或提交 Issue 与 PR。",
    items: {
      discord: { name: "Discord", desc: "和团队及其他开发者交流。" },
      x: { name: "X（Twitter）", desc: "产品更新与发布消息。" },
      wechat: { name: "微信群", desc: "中文交流群。" },
      github: { name: "GitHub", desc: "源码、Issue 和 PR。" },
    },
  },

  cta: {
    title: "跑通第一轮自进化",
    subtitle: "每个版本都有评分和快照；变差的版本一步回滚。",
    download: "下载桌面版",
    quickstart: "快速开始",
    docs: "阅读文档",
  },

  footer: {
    tagline: "开箱即用的 Agent 自进化框架",
    product: "产品",
    resources: "资源",
    quickstart: "快速开始",
    cases: "案例",
    blog: "博客",
    repo: "GitHub 仓库",
    docs: "文档",
    releases: "Releases",
    license: "Apache-2.0 License",
    copyright: "© 2026 Prism Shadow，基于 Apache-2.0 协议开源",
  },

  hub: {
    source: "来源",
    searchPlaceholder: "按名称、简介或作者搜索",
    clearSearch: "清空搜索",
    all: "全部",
    sortLabel: "排序",
    sortLatest: "最近更新",
    sortName: "名称",
    empty: "没有符合条件的条目。清空搜索或取消筛选后再看。",
    clearFilters: "清除筛选",
    count: (n: number) => `${n} 个`,
    listSeparator: "、",
    viewSource: "在 GitHub 查看",
    details: "详情",
    pageTitle: (name: string) => `${name} | PenguinHarness`,
    notFound: "找不到这个条目，它可能已改名或移除。",
    backToList: "回到列表",
    /** The detail page's back control, for assistive technology: its visible text is the list's name. */
    backTo: (list: string) => `返回${list}`,
    meta: {
      author: "作者",
      version: "版本",
      license: "许可证",
      category: "分类",
      package: "npm 包",
      preinstall: "新建 Agent 时预装",
      yes: "是",
      no: "否",
      status: "状态",
      updated: "更新时间",
      tasks: "题目数",
    },
    status: { published: "已发布", draft: "草稿" } as Record<string, string>,
    references: "参考文献",
    plugins: {
      title: "插件",
      description: "PenguinHarness 的插件库：自进化工具包、Skills、Hooks 与工作台。",
      directoryUnavailable: "插件目录未能载入。",
      retryDirectory: "重试",
      facetCategory: "分类",
      facetContents: "内容",
      facetAuthor: "作者",
      categories: {
        rsi: "Agent 自进化",
        "office-productivity": "办公效率",
        "software-development": "软件开发",
        "ai-app-development": "AI 应用开发",
        "learning-life": "学习与生活",
        utilities: "实用工具",
        entertainment: "娱乐",
        sandbox: "Agent 运行沙箱",
        other: "其他",
      } as Record<string, string>,
      contents: { skills: "Skills", hooks: "Hooks", workbenches: "工作台" },
      about: "简介",
      quickStart: "快速开始",
      quickStartSkills: "选用的 Skills",
      skills: "Skills",
      hooks: "Hooks",
      workbenches: "工作台",
      extensions: "Hooks 与工作台",
      skillCount: (n: number) => `${n} 个 Skill`,
      preinstalled: "默认预装",
      /** The market's curation: the carousel's eyebrow and a card's tag. */
      selected: "精选",
      /** The selected carousel's accessible name. */
      selectedPlugins: "精选插件",
      viewDetails: "查看详情",
      layoutLabel: "插件布局",
      cardsLayout: "卡片视图",
      listLayout: "列表视图",
      sortSelected: "精选优先",
      screenshots: "截图",
      whatItInstalls: "包含内容",
      downloadPlugin: "下载插件",
      getPenguin: "获取 PenguinHarness",
      source: "源码",
      carousel: {
        previous: "上一个",
        next: "下一个",
        pause: "暂停轮播",
        play: "继续轮播",
        position: (index: number, count: number) => `第 ${index} 个，共 ${count} 个`,
      },
      /** The leaderboards whose entries ran a plugin (an RSI toolkit's algorithm). */
      measuredBy: "测评过它的榜单",
      /** A part's kind on a plugin's page, under "What it installs". */
      partKinds: { skill: "Skill", hook: "Hook", workbench: "工作台" },
    },
    benchmarks: {
      title: "评估集",
      description: "PenguinHarness 评估集：用来测 Agent 的题目与评分标准。",
      facetTimeout: "单题时限",
      timeout: {
        short: "15 分钟以内",
        hour: "1 小时以内",
        long: "1 小时以上",
        none: "不限时",
      } as Record<string, string>,
      facetLeaderboard: "榜单",
      onLeaderboard: "已收录",
      facetStatus: "状态",
      facetAuthor: "作者",
      taskCount: (n: number) => `${n} 道题`,
      about: "简介",
      tasks: "题目",
      budget: { timeout: "时限", cpus: "CPU", ram: "内存", disk: "磁盘", gpus: "GPU" },
      minutes: (n: number) => `${n} 分钟`,
      hours: (n: number) => `${n} 小时`,
      cores: (n: number) => `${n} 核`,
      gigabytes: (n: number) => `${n} GB`,
      cards: (n: number) => `${n} 卡`,
      unlimited: "不限",
      leaderboards: "收录它的榜单",
      taskParts: "题目内容",
      statement: "题干",
      rubric: "评分标准",
      data: "数据",
      instruction: "Agent 收到的指令",
      files: (n: number) => `文件（共 ${n} 个）`,
      allFiles: (n: number) => `在 GitHub 查看全部 ${n} 个文件`,
      dataFolder: "在 GitHub 查看数据目录",
      showAll: "展开全部",
      showLess: "收起",
      fileCount: (n: number) => `${n} 个文件`,
      upTo: (time: string) => `单题最长 ${time}`,
      withData: "附带数据",
    },
    leaderboards: {
      title: "榜单",
      description: "PenguinHarness 榜单：在评估集上比较 Agent 的得分与开销。",
      facetAuthor: "作者",
      entryCount: (n: number) => `${n} 个条目`,
      benchmarkCount: (n: number) => `${n} 个评估集`,
      charts: { table: "表格", pareto: "帕累托", waffle: "华夫饼" },
      chartsLabel: "视图",
      results: "结果",
      entries: "条目",
      baseline: "基线",
      rank: "排名",
      model: "模型",
      score: "得分",
      modelThinking: (model: string, level: string) => `${model}（${level}）`,
      columnNames: {
        harness: "Harness",
        algorithm: "算法",
        released: "发布时间",
        cost: "成本",
      } as Record<"harness" | "algorithm" | "released" | "cost", string>,
      columns: "列",
      /** The columns button's hint in the views that have no table. */
      columnsTableOnly: "列只用于表格",
      /** Under the table: what the ± and the score bar's whiskers are. */
      tableNote: "± 与误差棒均为 1 个标准差。",
      /** A thinking level after the model's name, in the muted ink. */
      thinkingNote: (level: string) => `（${level}）`,
      filter: "筛选",
      sortBy: (name: string) => `按${name}排序`,
      filters: {
        model: "模型",
        harness: "Harness",
        algorithm: "算法",
        thinking: "思考等级",
      } as Record<"model" | "harness" | "algorithm" | "thinking", string>,
      filterLabel: (name: string) => `按${name}筛选`,
      noMatch: "没有符合筛选条件的条目。",
      rawData: "查看原始数据",
      raw: {
        harness: "Harness",
        provider: "模型提供商",
        thinking: "思考等级",
        phase: "阶段",
        std: "标准差",
        stdAttempts: (n: number) => `跨 ${n} 次尝试`,
        stdExperiments: "由各实验的 score_std 合成",
        experiments: "实验",
        benchmark: "评估集与实验",
        value: "得分",
        attempts: "尝试次数",
        tokens: "Token 输入／缓存／输出",
        finished: "完成时间",
        harnessSetting: "Harness 配置",
        notRecorded: "未记录",
      },
      cost: "成本",
      duration: "耗时",
      tokens: "Token",
      axisLabel: "横轴",
      frontier: "帕累托前沿",
      hoursShort: (value: string) => `${value} 小时`,
      minutesShort: (value: string) => `${value} 分钟`,
      scale: "得分",
      noScore: "未评分",
      task: "题目",
      attemptsPerCell: (n: number) => (n === 1 ? "每格一个方块" : `每格 ${n} 个方块，每次尝试一个`),
      cellScores: (scores: string[]) => `各次得分：${scores.join("、")}`,
      methodOnModel: (method: string, model: string) => `${method}（${model}）`,
      paretoPoint: (method: string, score: string, axis: string, value: string) =>
        `${method}：得分 ${score}，${axis} ${value}`,
      paretoSummary: (axis: string, points: string[], frontier: string[]) =>
        `横轴：${axis}。${points.join("；")}。帕累托前沿：${frontier.join("、")}。`,
      benchmarks: "评估集",
      method: {
        title: "计算方式与来源",
        matrixLead: (metric: string, phase: string) =>
          `每一格是一个实验在 \`${phase}\` 阶段 summary 中的 \`${metric}\`；横线下方各行是每一列合成后的结果。`,
        listLead: "逐个条目列出表达式的各个参数：所读的实验、阶段与指标，以及取到的值。",
        stdAttempts: (n: number | null) =>
          `± 为跨${n === null ? "" : ` ${n} 次`}尝试的样本标准差，每次尝试的各题得分按与总分相同的方式合成。`,
        stdExperiments: "± 由各实验自身的 `score_std` 按相互独立合成。",
        stdExperimentsSome:
          "± 取跨尝试的样本标准差；若某条目的各实验尝试次数不一致，改由各实验的 `score_std` 合成。",
        benchmark: "评估集",
        experiment: "实验",
        phase: "阶段",
        metric: "指标",
        value: "值",
        opName: (op: string | null) => (op === null ? "取值" : op),
        opRow: (op: string | null) => (op === null ? "得分" : `得分（${op}）`),
        stdRow: "± 标准差",
        costRow: "成本（单次运行之和）",
        timeRow: "耗时（单次运行之和）",
        config: "配置",
        experiments: "实验数据",
      },
    },
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
   * The RFC pages (pages/rfcs.tsx, pages/rfc-doc.tsx): the repository's design RFCs (PRFCs) as a
   * docs-style section, following the MMSP RFC site's layout and information structure.
   */
  rfcs: {
    /** The tab title and description while the index page is open. */
    title: "RFC 索引",
    sidebarTitle: "RFCs",
    description: "PenguinHarness 的每个设计决定都记录为一篇 RFC：这里是索引，以及本面的约定。",
    indexLabel: "RFC 索引",
    notFound: "找不到这篇 RFC。",
    backToIndex: "返回 RFC 索引",
    editOnGithub: "在 GitHub 上编辑本页",
    copyMarkdown: "复制 Markdown",
    copied: "已复制",
    toc: "本页目录",
    prev: "上一页",
    next: "下一页",
    sectionAll: "全部 RFC",
    colRfc: "RFC",
    colTitle: "标题",
    colStatus: "Pull Request",
    statusMerged: "Merged",
    statusOpen: "Open",
    statusDraft: "Draft",
    statusClosed: "Closed",
    /** The row's link to the open design PR carrying a revision newer than the merged version. */
    openRevision: "未合并修订",
    expandAll: "全部展开",
    collapseAll: "全部折叠",
    expandNode: (name: string) => `展开 ${name}`,
    collapseNode: (name: string) => `折叠 ${name}`,
    notes: [
      "**Pull Request**：每篇 RFC 后附承载它的 `request-for-comments` PR（图标对应 GitHub PR 的 `Merged`、`Open`、`Draft` 状态，后接 `#PR-number`）；已合入主仓 `rfcs/` 的文档点击标题进入站内正文。",
      "**唯一索引**：上方树图由 `rfcs/` 目录与 `request-for-comments` PR 状态在构建期自动生成。",
    ],
    colFile: "文件",
    colContent: "内容",
    files: [
      {
        file: "rfcs/",
        path: "tree/main/rfcs",
        content: "一个文件记录一个决定（`PRFC-NNNN-<slug>.md`）及其中文对照 `.zh.md`",
      },
      {
        file: "TEMPLATE.md",
        path: "blob/main/rfcs/TEMPLATE.md",
        content: "新 RFC 的英文模板起点",
      },
    ],
    bilingualNote:
      "**双语对齐**：除 `TEMPLATE.md` 外，每个文件都有逐节对应的 `<name>.zh.md`，由网站直接渲染于 `/rfcs/`。",
    search: {
      open: "搜索",
      label: "搜索 RFC",
      placeholder: "搜索 RFC 标题、章节和正文",
      start: "输入关键词搜索当前语言的全部 RFC",
      noResults: "没有找到匹配的 RFC",
      noResultsHint: "请尝试更短或不同的关键词",
      results: "搜索结果",
      close: "关闭搜索",
      keyboardHint: "使用上下方向键选择，按回车打开",
    },
  },

  /**
   * The AMSP page (pages/amsp.tsx, sections/amsp/*): AMSP, the Session stream, on one page, with
   * scripted runs replayed. Protocol names (record kinds, fields, routes) stay as the protocol
   * spells them; the Web App's labels are quoted verbatim from its dictionary.
   */
  amsp: {
    /** The tab title and description while the page is open; the static shell carries the English pair (scripts/site-routes.mjs). */
    title: "AMSP：Agent Message Stream Protocol",
    description:
      "用同一种协议流式传输、解析和存储 Agent 消息：AMSP，PenguinHarness Agent 的 Session 流。",
    /** A no-break space keeps 「Agent 通信」 together where the headline wraps. */
    headline: "Agent\u00a0通信统一协议",
    /** No full stop, like MMSP's subtitle. */
    subline: "用同一种协议流式传输、解析和存储 Agent 消息",
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
      input: "只需要一份代码",
      events: "流式事件传输",
      /** The legend of the faint ground under the records the Trace stores. */
      stored: "写入 Trace",
      /** A request the caller sends beside the stream (the interrupt). */
      besideStream: "流之外的请求",
      assembled: "消息解析结果",
      request: (n: number) => `Request ${n}`,
      thinking: (level: string) => `思考等级 ${level}`,
      streaming: "传输中",
      result: "结果",
      requests: (n: number) => `${n} 次 Request`,
      tokens: (n: string) => `${n} Token`,
    },

    /** A run's three levels as one bar chart (sections/amsp/structure.tsx). */
    structure: {
      title: "消息结构",
      subtitle:
        "一次运行嵌套三层，从长到短依次是：Task、每次向模型发出的 Request，以及填满每个 Request 的各条消息，每条止于它的完整记录。",
      figureLabel:
        "一次包含两轮工具调用的运行画在同一条时间轴上，按时长从长到短分三行。Task 从 task_begin 到 task_end。其下是三个 Request，各自从 request_begin 到 request_end。再下面是填满各个 Request 的消息，每条止于它的完整记录：第一个 Request 里是思考和一次工具调用，第二个里是第二次工具调用，第三个里是回答。相邻两个 Request 之间工具在运行，它的 tool_call_output 在下一个 Request 开始处完成。",
      /** The chart's row names, top to bottom. */
      levels: { task: "Task", request: "Request", message: "消息" },
      /** The figure in words: read out with it, and shown under it on a phone. */
      steps: [
        "task_begin 打开一个 Task，task_end 关闭它；[DONE] 时仍未闭合的 task_begin 说明运行没有走到终点。",
        "每个 Request 以带思考等级的 request_begin 开始，以 request_end 结束。",
        "消息先以 partial_* 片段流出（start、delta、stop），随后是它的完整记录，被打断的消息也一样。",
        "工具在调用完整后开始运行；它的 tool_call_output 在 request_end 之后才完成，下一个 Request 从它开始。",
      ],
      boundaries: "event_msg：Task 或 Request，从开始记录到结束记录",
      /** The Web App Trace view's names for the same colours, verbatim from packages/web's zh dictionary. */
      kinds: {
        thinking: "thinking：思考",
        text: "text：模型回复",
        tool_call: "tool_call：工具调用生成",
        tool_call_output: "tool_call_output：工具调用执行",
      },
      complete: "model_msg：消息先以 partial_* 片段流出（仅实时），止于它的完整记录，写入 Trace",
    },

    /** Every record field by field (sections/amsp/records.tsx), keyed by lib/amsp-vocabulary.ts and lib/amsp-records.ts. */
    records: {
      title: "每种记录，逐个字段",
      subtitle:
        "每条记录都是 Trace 里的一行，逐字节相同；只有 partial_* 片段只在实时流中出现。选一种记录，查看示例和它的全部字段。客户端忽略不认识的类型与字段。",
      choose: "选择一种记录",
      families: {
        envelope: "外壳",
        session: "Session",
        complete: "完整消息",
        partial: "片段",
        boundaries: "Task 与 Request",
        interventions: "中止、审批与 Hook",
        context: "上下文与工具",
        control: "控制帧",
      },
      stored: "写入 Trace",
      live: "仅实时",
      firstMessage: "随 Session 的首条消息送出",
      frame: "控制帧，不是记录",
      example: "示例",
      wire: "线上的样子",
      envelopeFields: "外壳字段",
      payloadFields: "payload 字段",
      head: { field: "字段", type: "类型", required: "必填", meaning: "含义", example: "示例值" },
      required: "必填",
      optional: "可选",
      frameNote: "控制帧不带 id：它不推进续传位置，也不会被重放。",
      frames: {
        ping: "流一打开即发送，因此是运行流的第一行；此后每 20 秒一次。",
        done: "运行流的最后一行。",
      },
      /** What a field means wherever it appears, unless the record has its own words for it. */
      common: {
        type: "payload 的种类。",
        role: "消息出自谁。",
        event_type: "片段所处的阶段：start、delta 或 stop。",
        tool_call_id: "所属工具调用的 id，用来把调用和它的输出配对。",
        fidelity: "提供方在回放时需要原样拿回的数据，按原样保存。",
        error_code: "机器可读的失败原因，跨版本稳定，客户端据此本地化。",
        error_message: "失败的原始文字，按原样展示。",
      },
      items: {
        envelope: {
          summary: "每条记录都套着同一个外壳，变化的只有 payload。",
          fields: {
            timestamp: "记录产生的时间，ISO 8601，UTC。",
            type: "session_meta、model_msg 或 event_msg。",
            payload: "记录本身，以它自己的 type 区分。",
            origin:
              "Subagent 的记录经过的子 Session 链，由外到内；主 Session 自己的记录没有这个字段。",
          },
        },
        session_meta: {
          summary:
            "一个模型上下文开启：模型、系统提示词、路径和来源。它是 Session 首条消息的流中第一条记录，也是每个 Trace 文件的第一行。",
          fields: {
            session_id: "Session 的 id；之后的请求带上它即可延续。",
            provider: "模型所属的提供方分组。",
            model_id: "发给提供方的模型 id。",
            model_context_window: '模型的上下文窗口，单位 Token；未配置时为 "unknown"。',
            system_prompt: "这个上下文使用的完整系统提示词。",
            agent_state: "Agent State 的绝对路径。",
            workspace: "Workspace 的绝对路径。",
            source:
              "谁开启了这个 Session：user、api、schedule、subagent、cli、company 或 workbench。",
          },
        },
        session_update: {
          summary:
            "Session 的一项设置发生变更，记下变更后的取值。目前只有一项：下一个上下文所用的模型，在会话内切换模型完成时写下，位于被离开的 Trace 文件末尾。",
          fields: {
            provider: "下一个上下文所用模型的提供方分组；与 model_id 成对出现。",
            model_id: "下一个上下文发给提供方的模型 id；与 provider 成对出现。",
          },
        },
        text: {
          summary: "一段完整文本：用户的输入，或模型的回复。",
          fields: {
            text: "文本内容。",
            sender: "用户侧文本的来源：用户、父 Agent、Harness 或服务器；缺省即用户。",
          },
        },
        thinking: {
          summary: "模型完整的一段思考。",
          fields: { thinking: "思考的文本。" },
        },
        tool_call: {
          summary:
            "模型发出的一次完整工具调用。若它所在的 Request 被提前截断，记录里是原样的参数，可能无法解析，这次调用也不会执行。",
          fields: { name: "工具名。", arguments: "参数，JSON 字符串。" },
        },
        tool_call_output: {
          summary: "工具的结果，会回传给模型。",
          fields: {
            output: "工具返回的文本。",
            images: "工具返回的图片，data URL 形式。",
            status:
              "结果的性质：completed（工具执行完毕）、fatal（调用失败）或 aborted（没有执行：被用户、策略或 Hook 拒绝；或在运行中被打断）。",
          },
        },
        image_url: {
          summary: "用户以 URL 发送的一张图片。",
          fields: { image_url: "网址，或 base64 的 data URL。" },
        },
        inline_data: {
          summary: "内联的字节，例如用户或模型给出的图片、音频。",
          fields: { data: "base64 编码的字节。", mime_type: "字节的媒体类型。" },
        },
        inline_thinking: {
          summary: "以内联字节表示的思考，例如图像模型用来思考的图片。",
          fields: { data: "base64 编码的字节。", mime_type: "字节的媒体类型。" },
        },
        partial_text: {
          summary: "回复在流式传输中的一段。",
          fields: { text: "这个片段新增的文本。" },
        },
        partial_thinking: {
          summary: "思考在流式传输中的一段。",
          fields: { thinking: "这个片段新增的思考。" },
        },
        partial_tool_call: {
          summary: "工具调用在流式传输中的一段。",
          fields: {
            name: "工具名，在 start 片段上出现。",
            arguments: "这个片段新增的那段参数 JSON。",
          },
        },
        partial_tool_call_output: {
          summary: "工具输出在流式传输中的一段。",
          fields: {
            output: "这个片段新增的输出。",
            images: "工具返回的图片，由一个片段整体带上。",
          },
        },
        task_begin: {
          summary: "开启一个 Task，即一次输入的整个运行；Task 的每条记录都在它之后。",
          fields: {},
        },
        task_end: {
          summary: "关闭这个 Task。只有 task_begin 没有 task_end，说明运行没有走到终点。",
          fields: {},
        },
        request_begin: {
          summary: "开启对模型的一次请求。",
          fields: { thinking_level: "这次请求实际使用的思考等级；没有传思考等级时缺省。" },
        },
        request_end: {
          summary: "关闭这次请求，并说明它如何结束。",
          fields: {
            status:
              "completed、aborted（这一轮没有提交）、retryable（在重试次数内会重试；输出达到上限被截断时 error_code 为 output_truncated）或 fatal；这是请求结束原因的唯一记录。",
            attempt: "这次尝试在重试中的序号；一次就成功时缺省。",
            retry_in_ms: "距下一次尝试的等待时间，只在引擎会重试时出现。",
          },
        },
        token_usage: {
          summary: "最近一次请求和整个 Session 到目前为止计入的 Token。",
          fields: {
            session: "Session 的累计数。",
            "session.cache_read": "从提供方缓存读取的输入 Token。",
            "session.cache_write": "写入缓存的输入 Token。",
            "session.output": "输出 Token，含思考。",
            "session.total": "计入的全部 Token。",
            request: "这次请求的计数。",
            "request.cache_read": "这次请求从缓存读取的输入 Token。",
            "request.cache_write": "这次请求写入缓存的输入 Token。",
            "request.output": "这次请求的输出 Token，含思考。",
            "request.total": "这次请求计入的全部 Token。",
          },
        },
        abort: {
          summary: "运行被中止：调用方打断，或 Task 到达轮数上限。",
          fields: {
            error_code: "user_abort 表示被打断，max_turns 表示到达轮数上限。",
            error_message: "细节，例如到达的上限。",
            reason: "旧 Trace 里的文字原因；没有 error_code 时才读它。",
          },
        },
        approval_decision: {
          summary: "对一次需要审批的工具调用的答复。",
          fields: { decision: "allow、deny，或 forbidden（被项目的命令策略拒绝）。" },
        },
        hook: {
          summary: "Hook 在某个挂载点给出的答复。",
          fields: {
            hook: "挂载点：stop、pre_tool_use 或 user_prompt。",
            name: "Hook 注册的名字。",
            decision: "stop 点上为 continue 或 stop，工具调用前为 allow 或 deny。",
            reason: "Hook 写给人看的一行说明。",
            output: "Hook 自己的记录，只含标量。",
          },
        },
        compaction_begin: {
          summary: "上下文开始压缩。",
          fields: {
            reason: "原因：context、turns 或 manual。",
            mode: "summarize 或 discard。",
            context: "开始时上下文的 Token 数。",
            turns: "开始时 Session 累计的轮数。",
          },
        },
        compaction_end: {
          summary: "压缩结束。",
          fields: {
            reason: "原因：context、turns 或 manual。",
            mode: "summarize 或 discard。",
            status: "completed，或放弃的方式：aborted、retryable、fatal；未完成时保留原上下文。",
            attempt: "最后一次尝试的序号。",
          },
        },
        tool_list_ready: {
          summary: "Session 的工具定义，与发给模型的一致；在 MCP 服务器连接完成后送出。",
          fields: {
            tools: "全部工具定义。",
            "tools[].name": "工具名。",
            "tools[].description": "工具的用途。",
            "tools[].parameters": "参数，JSON Schema 形式。",
          },
        },
        mcp_connect_begin: {
          summary: "开始连接 MCP 服务器。",
          fields: { servers: "正在连接的服务器。" },
        },
        mcp_connect_end: {
          summary: "MCP 服务器连接结束，可能有部分失败。",
          fields: {
            status: "completed、fatal（有服务器失败并被跳过）或 aborted。",
            results: "每个服务器一条结果。",
            "results[].server": "服务器名。",
            "results[].transport": "stdio、http 或 sse。",
            "results[].status": "completed、fatal 或 aborted。",
            "results[].duration_ms": "连接与发现工具所用的时间。",
            "results[].tools": "发现的工具数，在 completed 时出现。",
            "results[].error_code":
              "失败原因：connect_failed、mcp_needs_setup 或 mcp_sign_in_required。",
            "results[].error_message": "失败的原始文字。",
          },
        },
        subagent: {
          summary: "在父 Session 的 Trace 里指向它启动的子 Session；只写入 Trace，不在流中发送。",
          fields: { session_id: "子 Session 的 id。" },
        },
      },
    },

    /** Two steps to a first run (sections/amsp/quickstart.tsx); the code is lib/amsp-quickstart.ts. */
    quickstart: {
      title: "从零到第一次运行",
      enable: {
        title: "打开 Agent 的 API",
        /** The Web App's labels, verbatim from packages/web's zh dictionary. */
        text: "在 PenguinHarness 中打开「智能体」，选中一个 Agent，进入「API」标签页，打开「开启 API 访问」，再点「新建密钥」。",
        link: "Agent API 使用指南",
      },
      run: {
        title: "运行它",
        label: "运行方式",
        typescript: "TypeScript",
        curl: "curl",
      },
      curl: {
        response: "响应",
        elided: "每条记录一个事件",
      },
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
  company: {
    title: "公司模式：下一版设计草案",
    description:
      "公司模式的下一版设计草案：作为应用中心里的一个插件应用，一个会话就是一件活，等你的、进行中的、做完的分开列出。",
    status: "设计草案",
    headline: "公司模式，装进应用中心",
    subline:
      "公司不再是侧栏里的一种模式，而是 agent-company 插件提供的一个应用。交给组织的每件事都是一个普通会话，成员委派出去的子会话挂在它下面；等你的排在最上面，点开就是那个会话。",
    note: "上面跑的是真实的 Web App，数据是演示用的；公司应用本身还是草案，没有发布。",
    frame: "公司应用的设计草案（实时演示）",
    questions: {
      title: "四个问题，四个回答",
      subtitle: "多 Agent 产品之间拉开差距的，是界面怎么回答这四个问题。",
      items: [
        {
          question: "活怎么派出去？",
          answer: "开一个会话",
          body: "新任务就是一个新会话，通常交给主理。主理把能分出去的部分委派给成员，每份各是一个子会话。定时任务开的会话也排在同一张列表里。",
        },
        {
          question: "进度去哪看？",
          answer: "看会话列表",
          body: "列表分三组：等你、进行中、已完成，子会话缩进在它的任务下面。状态就是会话自己的运行状态，不另造工单和看板。",
        },
        {
          question: "AI 之间怎么交接？",
          answer: "靠子会话",
          body: "委派出去的活是一个子会话，过程和 Trace 都在里面，做完把结果交回父会话。点开任何一层，看到的都是同一个对话页。",
        },
        {
          question: "人什么时候出场？",
          answer: "会话等你的时候",
          body: "有操作要你批准，或者 Agent 用选择题问你，这个会话连同它的任务就排进「等你」。处理就在会话里，点开回答。",
        },
      ],
    },
    plugin: {
      title: "用现有的插件机制接进来",
      subtitle: "公司的运行时保持不变。应用要用的平台能力今天都有，插件只需再贡献一个页面。",
      now: "平台今天有",
      use: "公司应用怎么用",
      rows: [
        {
          name: "应用中心",
          now: "插件页面声明为应用，就是应用中心里的一个图块，在窗口里打开，也能全屏。",
          use: "公司改由 agent-company 插件以应用的形式贡献；插件不在，图块也不在。",
        },
        {
          name: "会话",
          now: "组织运行时已经给每个成员的工位、每张工单各开一个会话，并标明它属于组织。",
          use: "应用把这些会话按父子关系列出来。工单留在运行时里，界面上不再单独出现。",
        },
        {
          name: "对话页",
          now: "插件页面可以请 Web App 打开一个对话。",
          use: "点开一件活就是打开那个会话；应用里不再另做一套聊天。",
        },
        {
          name: "A2UI",
          now: "开发模式的对话里，选择题和表单已经可以点选提交。",
          use: "Agent 用选择题问你时，会话排进「等你」，你在会话里点选回答。",
        },
        {
          name: "Skill",
          now: "agent-company 插件已经带着 CEO、员工、财务、HR、科研、镜像和建组的 Skill。",
          use: "HR 和财务不再占默认编制里的岗位，变成主理按需调用的 Skill。",
        },
      ],
    },
    tradeoffs: {
      title: "取舍",
      subtitle: "保留什么、改什么、以后再做、不做什么，都按 PenguinHarness 现在的架构来定。",
      groups: [
        {
          name: "沿用",
          items: [
            "组织、成员和预算",
            "运行时里的工单，一张工单仍对应一个会话",
            "Trace 全链路记录",
            "每个成员仍是本 Project 的一个 Agent，有自己的模型和机器",
          ],
        },
        {
          name: "改变",
          items: [
            "入口：侧栏的「开发 | 公司」切换和 /org 页面，换成应用中心里的一个应用",
            "首页：总览换成按状态分组的会话列表",
            "界面上不再有工单、看板和收件箱，一件活就是一个会话",
            "全员群聊默认不开，频道降为可选页面",
          ],
        },
        {
          name: "以后再做",
          items: [
            "「新任务」直接开给主理并标明属于组织；草案里借用的是普通的新建对话",
            "GitHub Issue、外部消息这类事件触发；现在是定时调度，加上 API 写入时立即处理",
            "把 Claude Code、Codex 这类外部 CLI 接成执行通道",
            "在 Shared RSI Community 上给组织模板跑分",
          ],
        },
        {
          name: "不做",
          items: [
            "只服务写代码的工具壳",
            "默认塞满 CEO、HR、财务的大公司编制",
            "把模型、权限和过程藏起来的黑盒托管",
          ],
        },
      ],
      mirror:
        "现实公司镜像，也就是数字分身在飞书、微信里传话答疑，依赖聊天入口，交给消息插件，不进公司应用的主流程。",
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
