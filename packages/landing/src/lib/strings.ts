/**
 * Landing copy (bilingual): this file holds the Chinese dictionary `zh` and the runtime
 * active dictionary `S`; the English dictionary lives in strings-en.ts (constrained to
 * the same shape by the `Strings` type). Locale switching is handled by state/locale.tsx,
 * which calls `setActiveStrings` and remounts the tree keyed by locale — keep `S.x`
 * reads inside components. Keep domain terms in standard English casing — Agent,
 * Workspace, Token, Task, Skill, Trace, etc.
 */
export const zh = {
  siteName: "PenguinHarness",

  announcement: {
    label: "公告",
    prev: "上一条公告",
    next: "下一条公告",
    gemini: "Gemini 3.6 Flash 现已在 PenguinHarness 可用",
    models: "Kimi K3 与 Qwen 3.8 Max 模型现已在 PenguinHarness 可用",
    fireworks: "携手 AMD 开发者计划：$50 Fireworks API 额度免费领取中",
  },

  nav: {
    highlights: "特色",
    quickstart: "快速开始",
    cases: "案例",
    scenarios: "应用场景",
    benchmark: "评测",
    contract: "CONTRACT.md",
    features: "功能",
    blog: "博客",
    docs: "文档",
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
    badge: "让 Agent 为你构建 Agent",
    /**
     * Headline: {titlePrefix}<nowrap>{titleNoWrap}{word}{titleSuffix}</nowrap>, the word
     * rotating through titleWords (桌面/服务器 — where the builder lives; the README
     * states Desktop only). The nowrap span pins the wrap point in front of it, so a
     * break never splits "Agent Builder" / "Lives on Your Desktop" mid-phrase.
     */
    titlePrefix: "全自动 Agent 构建器，",
    titleNoWrap: "住在你的",
    titleWords: ["桌面", "服务器"],
    titleSuffix: "上",
    keywords: ["轻量", "高效", "开源"],
    ctaPrimary: "快速开始",
    ctaGithub: "GitHub",
    installHint: "一行命令安装（Linux / macOS，x64 / arm64，内嵌 Node 运行时，解压即用）",
    stats: [
      { value: "1000+", label: "支持模型数量" },
      { value: "1×CPU", label: "最低运行配置" },
      { value: "100%", label: "开源，可本地部署" },
      { value: "首个原生", label: "递归自我进化 Harness" },
    ],
  },

  copy: {
    copy: "复制",
    copied: "已复制",
  },

  pillars: {
    eyebrow: "三大特色",
    title: "为构建与进化 Agent 而生",
    subtitle: "PenguinHarness 率先把「Agent 构建 Agent」与「递归自我进化」带入开源 Harness。",
    root: "PenguinHarness",
    concepts: ["Penguin Message", "Penguin SDK", "Penguin Skills"],
    diagramLabel:
      "PenguinHarness 辐射出 Penguin Message、Penguin SDK 与 Penguin Skills，分别延展出三大特色",
    items: [
      {
        title: "Simplest Is the Best",
        tag: "",
        desc: "坚持最小化工具集与简洁的底层接口，以更少的工具调用与 Token 消耗，高效完成复杂任务。",
      },
      {
        title: "Harness for Building Agents",
        tag: "",
        desc: "通过 PenguinHarness SDK，让 Agent 从零自主完成 Agent 应用的构建。",
      },
      {
        title: "Harness for Recursive Self-Improvement",
        tag: "",
        desc: "通过 PenguinHarness Skills，Agent 以自我评估与自我优化实现递归式自我提升。",
      },
    ],
  },

  compare: {
    eyebrow: "对比 LangChain",
    title: "1× 与 100× 的差距",
    subtitle: [
      "使用 LangChain，以 1 倍速度人工构建 Agent；",
      "使用 PenguinHarness，以 100 倍速度用 Agent 构建 Agent。",
    ],
    langchain: {
      name: "LangChain",
      speed: "1×",
      mode: "人工构建 Agent",
      note: "逐行编写链路、工具与提示词，每个应用都从零开始。",
    },
    penguin: {
      name: "PenguinHarness",
      speed: "100×",
      mode: "Agent 构建 Agent",
      note: "一句话需求，Agent 端到端交付脚手架、代码与运行说明。",
    },
  },

  selfImprove: {
    eyebrow: "自我提升循环",
    title: "多 Agent 协作，进化自动发生",
    subtitle:
      "Optimizer 组织多个 Evaluator 为 Target Agent 并行打分，依据分数与运行轨迹定位失分原因，把 Agent 从版本 N 优化到版本 N+1——每一轮都有快照，随时可回退。",
    videoLabel: "自我进化演示视频",
    videoCaption: "自我进化演示：Agent 跑评测、定位失分点、发布下一版——完整一轮。",
    nodeOptimizer: "Optimizer",
    nodeEvaluator: "Evaluator × N",
    nodeTarget: "Target Agent",
    badgeOld: "vN",
    badgeNew: "vN+1",
    edgeSpawn: "启动并行评测",
    edgeBench: "运行 Benchmark",
    edgeFeedback: "分数与轨迹",
    edgeImprove: "更新提示词与 Skill",
    trends: [
      { label: "分数", hint: "不断上升" },
      { label: "成本", hint: "不断降低" },
      { label: "耗时", hint: "不断减少" },
    ],
    diagramLabel:
      "自我提升循环示意：Optimizer 组织多个 Evaluator 打分，依据分数与轨迹把 Target Agent 从 vN 优化到 vN+1",
  },

  quickstart: {
    eyebrow: "快速开始",
    title: "三步跑通第一个任务",
    subtitle:
      "一行命令安装，打开桌面级界面即可让 Agent 开始工作；数据全部保存在本地 ~/.penguin/data 目录。",
    step1: "安装",
    step1Desc:
      "Linux / macOS（x64 / arm64），产物内嵌 Node 运行时，解压即用；升级与重装不触碰数据。",
    tabWeb: "Web 界面",
    tabCli: "命令行",
    webStep2: "启动 Web 界面",
    webStep2Desc:
      "penguin web 启动本地服务并打开浏览器，用内置管理员 admin / penguin-2026 登录（登录后请尽快修改密码）。",
    webCmd: "penguin web   # 打开 http://127.0.0.1:7364",
    webStep3: "在界面里配置模型，开始对话",
    webStep3Desc:
      "进入「模型仓库」页，在 DeepSeek 或 OpenRouter 分组里粘贴 API key 并设为默认；回到对话页把第一个任务交给 Agent，例如「分析 data.csv，输出各季度销售额汇总」。",
    getKeyPrefix: "获取 API key：",
    getDeepseekKey: "DeepSeek 控制台",
    getOpenrouterKey: "OpenRouter 控制台",
    cliStep2: "配置模型",
    cliStep2Desc: "以 DeepSeek 官方 API 或 OpenRouter 网关为例，一条命令完成配置并设为默认。",
    tabDeepseek: "DeepSeek",
    tabOpenrouter: "OpenRouter",
    deepseekCmd: `penguin config model add \\
  --provider deepseek \\
  --model-id deepseek-v4-pro \\
  --api-key sk-your-deepseek-key \\
  --set-default`,
    deepseekNote:
      "模型引用始终是 (provider, model_id) 二元组，--provider 必填；省略 --api-key 时回退环境变量 DEEPSEEK_API_KEY。",
    openrouterCmd: `penguin config model add \\
  --provider openrouter \\
  --model-id deepseek/deepseek-v4-pro \\
  --api-key sk-or-your-key \\
  --set-default`,
    openrouterNote: "网关分组自动预填 OpenAI 兼容协议与 base URL，一个 key 即可访问上千种模型。",
    cliStep3: "运行",
    cliStep3Desc: "penguin run 直接执行单个任务；penguin chat 进入交互式 REPL。",
    runCmd: `penguin run --approve allow-all \\
  --message "分析 data.csv，输出各季度销售额汇总"`,
  },

  cases: {
    eyebrow: "案例",
    title: "从一句话到可运行的应用",
    subtitle: "把需求交给 Agent，端到端拿到可运行的结果；更多案例陆续加入。",
    tabs: [
      {
        label: "RAG 应用",
        prompt:
          "收集 https://github.com/ericbuess/claude-code-docs 的文档，做一个化身 Claude Code 配置专家、回答带来源引用的 RAG 问答应用。",
        caption: "生成的 RAG 应用成品：Claude Code 配置专家，回答带可点击的来源引用与示例问题",
        cost: "而生成整个 RAG 应用，仅消耗了 0.2 元（$0.02）的 token——使用 DeepSeek V4 Pro 模型。",
      },
      {
        label: "2D 企鹅雪橇小游戏",
        prompt: "做一个可爱的南极企鹅滑雪橇越野小游戏：空格起跳跃过石头，速度与难度随时间上升。",
        caption: "生成的小游戏成品：南极企鹅滑雪橇跳石头越野，实时计分，难度渐进",
        cost: "",
      },
    ],
  },

  scenarios: {
    eyebrow: "应用场景",
    title: "从体检中心到工厂车间",
    subtitle: "都是已经上线的真实部署，不是概念演示。",
    items: [
      {
        title: "体检报告质控",
        alt: "体检中心的 CT 检查室",
        body: "一家体检机构把报告质控交给了 Agent，跑在本地部署的 Qwen3 14B 上，数据不出机房。过去一轮人工复核要 30 分钟，现在一分钟自动过 30 份，核查结论与医学专家基本一致，审核产能提升数倍。",
      },
      {
        title: "产线设备巡检",
        alt: "自动化半导体生产线",
        body: "一家制造企业在各条流水线上部署巡检 Agent，全天候盯着设备状态，异常时先尝试自动恢复。停机时间减少 65%，产出提升约 2 倍。",
      },
    ],
  },

  contract: {
    eyebrow: "稳定进化的契约",
    title: "CONTRACT.md",
    subtitle: "PenguinHarness 以这份契约作为进化的边界和基石：能力可以生长，边界永不漂移。",
    intro: "进化需要边界。契约是 Harness 与 Agent 之间的约定：能力生长于内，边界固守于外。",
    items: [
      {
        term: "工作边界",
        text: "所有 Agent 都运行在同一个 Harness 之上：Agent 之下创建 Session，Session 之中执行 Task；自我进化只发生在 Workspace 与 Skill 之内，Harness 内核与安全机制始终不变。",
      },
      {
        term: "可编辑文件",
        text: "Agent 的提示词、技能与配置都是磁盘上可编辑的文件，而不是写死在代码里的常量。你能看到的，Agent 才能改进；你能修改的，Agent 也能学会。",
      },
      {
        term: "全量追踪",
        text: "每一次模型请求、每一次工具调用都完整写入 Trace：花了多少 Token、用了多长时间、为什么失败，事后都能逐条回放。",
      },
      {
        term: "权限审批",
        text: "每个工具调用都先经过审批再执行，每次审批决定都留有审计记录，Agent 做过什么一目了然。",
      },
      {
        term: "版本控制",
        text: "每次优化之前，先保存 Agent State 的版本快照。进化失败或效果回退，一步恢复到任何历史版本。",
      },
      {
        term: "按需加载",
        text: "面向模型的内容先给索引、再按需读取正文，不把整库资料一次性塞进上下文——上下文越干净，行为越稳定。",
      },
      {
        term: "错误处理",
        text: "错误分为可重试与不可重试：可重试的自动重试，不可重试的收敛为消息回给模型，任务不因一次失败而终止。",
      },
      {
        term: "密钥隔离",
        text: "API key 等 credential 存放在隐藏文件里、只经系统接口读写，永远不进入模型上下文，也不以明文出现在界面上。",
      },
      {
        term: "模型解耦",
        text: "模型与 Agent 互不绑定：随时换用更强或更便宜的模型，不需要改动 Agent 本身。",
      },
      {
        term: "执行轨迹可恢复",
        text: "任何 Session 都能从 Trace 完整恢复：进程重启、机器迁移，上下文都不会丢。",
      },
    ],
    outro: "契约不约束能力的上限，只约束进化的方式。",
  },

  benchmark: {
    eyebrow: "Benchmark",
    title: "以几十分之一的成本，跑出优异的效果",
    subtitle:
      "每个产品搭配它常用的模型，与 Claude Code、OpenAI Codex 在两套题库上正面对比：准确率同级，花的钱差出几十倍。",
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

  features: {
    eyebrow: "主要功能",
    title: "桌面级界面里的完整能力",
    subtitle: "与 Web 界面的菜单一一对应，装好即用。",
    more: "以及更多……",
    items: [
      {
        title: "多 Session 会话",
        desc: "每个 Agent 可开任意多个会话，流式输出、工具审批与图片粘贴开箱即用。",
      },
      {
        title: "智能体仓库",
        desc: "一键创建与管理多个 Agent，名称、描述与提示词随时可改。",
      },
      {
        title: "技能库",
        desc: "浏览、安装、快捷调用 Skill，Agent 也能编写并优化自己的技能。",
      },
      {
        title: "定时任务",
        desc: "计划调度让 Agent 到点自动执行，全程留痕，无人值守。",
      },
      {
        title: "子 Agent",
        desc: "任务可委派给 Subagent 并行协作，各自独立、互不干扰。",
      },
      {
        title: "成本中心",
        desc: "Token、请求与成本逐日趋势，各模型成功率与异常明细一目了然。",
      },
      {
        title: "轨迹观测",
        desc: "逐轮回放每次请求与工具调用，Token 细分与耗时全量可查。",
      },
      {
        title: "Agent 评估",
        desc: "内建 Benchmark 题库与记分板，分数随进化持续上升。",
      },
      {
        title: "多用户管理",
        desc: "管理员创建用户，各自拥有独立 Project，数据相互隔离。",
      },
    ],
  },

  skills: {
    eyebrow: "内置 Skill",
    title: "内置 Skill 库一览",
    subtitle: "四组 Skill 开箱即用，Agent 也能编写并优化自己的 Skill。",
    groups: [
      { title: "办公效率", skills: ["data-analysis", "firecrawl"] },
      { title: "软件开发", skills: ["web-design", "software-engineering"] },
      {
        title: "AI 应用开发",
        skills: ["penguin-sdk", "penguin-cli", "agenthub-models", "vllm", "ollama", "llamafactory"],
      },
      {
        title: "Agent 调优",
        skills: ["agent-creation", "benchmark-design", "agent-evaluation", "agent-optimization"],
      },
    ],
  },

  security: {
    eyebrow: "安全",
    title: "进化不越界，数据不出域",
    subtitle: "为企业级数据安全而设计的运行边界。",
    items: [
      {
        title: "开源，本地部署",
        desc: "内核完全开源可审计，数据保存在本地目录，不经过任何第三方服务。",
      },
      {
        title: "进化范围受限",
        desc: "自我进化严格限制在 Workspace 与 Skill 内，不修改 Harness 核心安全边界。",
      },
      {
        title: "权限审批与审计",
        desc: "工具调用先经用户批准，审批结果全部写入 Trace 审计事件。",
      },
      {
        title: "密钥隔离",
        desc: "credential 以 0600 隐藏文件落盘，系统 Prompt 禁读，界面全程掩码。",
      },
    ],
  },

  community: {
    eyebrow: "社区",
    title: "加入社区，一起共建",
    subtitle: "讨论、提问、贡献——你的第一个 Issue 就是最好的开始。",
    items: {
      discord: { name: "Discord", desc: "与我们和其他开发者实时交流。" },
      x: { name: "X（Twitter）", desc: "关注产品与团队的最新动态。" },
      wechat: { name: "微信群", desc: "中文社区讨论与互助。" },
      github: { name: "GitHub", desc: "Star、Issue 与 PR 都欢迎。" },
    },
  },

  cta: {
    title: "让复杂的 AI 开发越来越简单",
    subtitle:
      "通过不断进化，PenguinHarness 为你提供更高效、更可靠、更低幻觉、更低成本的 Agent 生产力引擎。",
    install: "立即安装",
    docs: "阅读文档",
  },

  footer: {
    tagline: "Efficient Self-Improving Harness for Everyone.",
    product: "产品",
    resources: "资源",
    quickstart: "快速开始",
    features: "功能",
    benchmark: "评测",
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
