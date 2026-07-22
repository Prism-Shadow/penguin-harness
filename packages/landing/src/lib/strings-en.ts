/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through state/locale.tsx. Keep domain term capitalization
 * consistent with zh — Agent, Workspace, Token, Task, Skill, Trace, etc.
 */
import type { Strings } from "./strings";

export const en: Strings = {
  siteName: "PenguinHarness",

  announcement: {
    label: "Announcements",
    prev: "Previous announcement",
    next: "Next announcement",
    gemini: "Gemini 3.6 Flash is now available in PenguinHarness",
    models: "Kimi K3 and Qwen 3.8 Max are now available in PenguinHarness",
    fireworks: "Claim $50 in Fireworks API credits with the AMD Developer Program",
  },

  nav: {
    highlights: "Highlights",
    quickstart: "Quick start",
    benchmark: "Benchmark",
    contract: "CONTRACT.md",
    features: "Features",
    blog: "Blog",
    docs: "Docs",
    github: "GitHub",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },

  theme: {
    label: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
  },

  lang: {
    label: "Language",
    zh: "中文",
    en: "English",
    system: "System",
  },

  hero: {
    badge: "Build AI agents, with an Agent",
    titlePrefix: "Efficient Self-Improving Harness for ",
    titleWords: ["Developers", "Enterprises"],
    titleSuffix: "",
    titleSuffixNoWrap: "",
    keywords: ["Lightweight", "Efficient", "Open Source"],
    ctaPrimary: "Get started",
    ctaGithub: "GitHub",
    installHint:
      "One-line install (Linux / macOS, x64 / arm64, bundled Node runtime — unpack and run)",
    stats: [
      { value: "1000+", label: "supported models" },
      { value: "1×CPU", label: "minimum footprint" },
      { value: "100%", label: "open source, local deploy" },
      { value: "First native", label: "recursively self-improving harness" },
    ],
  },

  copy: {
    copy: "Copy",
    copied: "Copied",
  },

  pillars: {
    eyebrow: "Three pillars",
    title: "Built for building — and evolving — agents",
    subtitle:
      "PenguinHarness is the first open-source harness to ship “agents building agents” and recursive self-improvement.",
    root: "PenguinHarness",
    concepts: ["Penguin Message", "Penguin SDK", "Penguin Skills"],
    diagramLabel:
      "PenguinHarness radiates into Penguin Message, Penguin SDK and Penguin Skills, each extending into one pillar",
    items: [
      {
        title: "Simplest Is the Best",
        tag: "",
        desc: "A deliberately minimal toolset over clean low-level interfaces: fewer tool calls, fewer Tokens, complex tasks done efficiently.",
      },
      {
        title: "Harness for Building Agents",
        tag: "",
        desc: "With the PenguinHarness SDK, an Agent builds complete Agent applications for you — autonomously, from scratch.",
      },
      {
        title: "Harness for Recursive Self-Improvement",
        tag: "",
        desc: "With PenguinHarness Skills, an Agent evaluates and optimizes itself, improving recursively over time.",
      },
    ],
  },

  compare: {
    eyebrow: "vs. LangChain",
    title: "The gap between 1× and 100×",
    subtitle:
      "With LangChain, you build agents by hand — at 1× speed. With PenguinHarness, agents build agents — at 100×.",
    langchain: {
      name: "LangChain",
      speed: "1×",
      mode: "Agents built by hand",
      note: "Chains, tools and prompts written line by line — every app starts from zero.",
    },
    penguin: {
      name: "PenguinHarness",
      speed: "100×",
      mode: "Agents built by agents",
      note: "One sentence in — an Agent delivers scaffold, code and run instructions end to end.",
    },
  },

  selfImprove: {
    eyebrow: "The self-improvement loop",
    title: "Multi-agent collaboration makes evolution automatic",
    subtitle:
      "The Optimizer orchestrates multiple Evaluators to score the Target Agent in parallel, uses the scores and run traces to find where points were lost, and upgrades the Agent from version N to N+1 — with a snapshot before every round.",
    videoLabel: "Self-improvement demo video",
    videoCaption:
      "The self-improvement loop end to end: run the benchmark, find the lost points, ship the next version.",
    nodeOptimizer: "Optimizer",
    nodeEvaluator: "Evaluator × N",
    nodeTarget: "Target Agent",
    badgeOld: "vN",
    badgeNew: "vN+1",
    edgeSpawn: "spawn parallel evaluations",
    edgeBench: "run Benchmarks",
    edgeFeedback: "scores & traces",
    edgeImprove: "update prompts & Skills",
    trends: [
      { label: "Score", hint: "keeps rising" },
      { label: "Cost", hint: "keeps falling" },
      { label: "Time", hint: "keeps shrinking" },
    ],
    diagramLabel:
      "Self-improvement loop: the Optimizer orchestrates Evaluators to score, then upgrades the Target Agent from vN to vN+1 via scores and traces",
  },

  quickstart: {
    eyebrow: "Quick start",
    title: "Your first task in three steps",
    subtitle:
      "Install with one command and let the Agent work from a desktop-grade interface — all data stays in your local ~/.penguin/data directory.",
    step1: "Install",
    step1Desc:
      "Linux / macOS (x64 / arm64) with a bundled Node runtime — unpack and run; upgrades never touch your data.",
    tabWeb: "Web UI",
    tabCli: "CLI",
    webStep2: "Open the web interface",
    webStep2Desc:
      "penguin web starts the local service and opens your browser; sign in with the built-in admin account admin / penguin-2026 (change the password right after).",
    webCmd: "penguin web   # opens http://127.0.0.1:7364",
    webStep3: "Configure a model in the UI and start chatting",
    webStep3Desc:
      "Open the Models page, paste an API key under the DeepSeek or OpenRouter group and set it as default; then head back to Chat and hand the Agent its first task — e.g. “Analyze data.csv and summarize quarterly sales”.",
    getKeyPrefix: "Get an API key: ",
    getDeepseekKey: "DeepSeek console",
    getOpenrouterKey: "OpenRouter console",
    cliStep2: "Configure a model",
    cliStep2Desc:
      "Using the DeepSeek official API or the OpenRouter gateway as examples — one command configures it and sets the default.",
    tabDeepseek: "DeepSeek",
    tabOpenrouter: "OpenRouter",
    deepseekCmd: `penguin config model add \\
  --provider deepseek \\
  --model-id deepseek-v4-pro \\
  --api-key sk-your-deepseek-key \\
  --set-default`,
    deepseekNote:
      "A model is always referenced by the (provider, model_id) pair, so --provider is required; omit --api-key to fall back to the DEEPSEEK_API_KEY environment variable.",
    openrouterCmd: `penguin config model add \\
  --provider openrouter \\
  --model-id deepseek/deepseek-v4-pro \\
  --api-key sk-or-your-key \\
  --set-default`,
    openrouterNote:
      "Gateway groups pre-fill the OpenAI-compatible protocol and base URL — one key unlocks a thousand models.",
    cliStep3: "Run",
    cliStep3Desc:
      "penguin run executes a single task; penguin chat drops you into an interactive REPL.",
    runCmd: `penguin run --approve allow-all \\
  --message "Analyze data.csv and summarize quarterly sales"`,
  },

  cases: {
    eyebrow: "Cases",
    title: "From one sentence to a running app",
    subtitle:
      "Hand the requirement to an Agent and get a runnable result end to end — more cases are on the way.",
    tabs: [
      {
        label: "RAG app",
        prompt:
          "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.",
        caption:
          "The generated RAG app: a Claude Code docs expert answering with cited, clickable sources and example questions",
        cost: "And generating this entire RAG app burned just $0.02 (¥0.2) of tokens — on DeepSeek V4 Pro.",
      },
      {
        label: "2D penguin sled game",
        prompt:
          "Build a cute Antarctic penguin sledding game: Space to jump the rocks, with speed and difficulty ramping up over time.",
        caption:
          "The generated mini game: an Antarctic penguin sleds and jumps rocks, with live scoring and rising difficulty",
        cost: "",
      },
    ],
  },

  contract: {
    eyebrow: "A contract for stable evolution",
    title: "CONTRACT.md",
    subtitle:
      "PenguinHarness treats this contract as the boundary and bedrock of evolution: capability may grow, the boundary never drifts.",
    intro:
      "Evolution needs boundaries. The contract is the covenant between harness and Agent: capability grows within; the boundary holds without.",
    items: [
      {
        term: "Working boundary",
        text: "Every Agent runs on the same harness: Sessions are created under an Agent, Tasks run inside a Session; self-improvement happens only inside Workspace and Skills, while the harness kernel and its safety mechanisms never change.",
      },
      {
        term: "Editable files",
        text: "An Agent's prompts, Skills and configuration live as editable files on disk, never as constants baked into code. What you can see, the Agent can improve; what you can edit, it can learn.",
      },
      {
        term: "Full tracing",
        text: "Every model request and every tool call is written to the Trace in full: how many Tokens it spent, how long it took, why it failed — all replayable line by line afterwards.",
      },
      {
        term: "Approvals & audit",
        text: "Every tool call passes approval before it runs, and every decision leaves an audit record — what the Agent did is never a mystery.",
      },
      {
        term: "Version control",
        text: "Before each optimization, the Agent State is snapshotted. If a round fails or regresses, restore any historical version in one step.",
      },
      {
        term: "Progressive loading",
        text: "Content for the model is indexed first and read on demand — never dumped wholesale into context. The cleaner the context, the steadier the behavior.",
      },
      {
        term: "Error handling",
        text: "Errors split into retryable and fatal: retryable ones retry automatically, fatal ones converge into messages the model can see and react to. No task dies of a single failure.",
      },
      {
        term: "Credential isolation",
        text: "API keys and other credentials live in hidden files and move only through system interfaces — never entering model context, never shown in plain text.",
      },
      {
        term: "Model decoupling",
        text: "Models are not bound to Agents: switch to a stronger or cheaper model at any time without rewriting the Agent.",
      },
      {
        term: "Recoverable trajectories",
        text: "Any Session can be fully restored from its Trace: restart the process or move machines without losing context.",
      },
    ],
    outro: "The contract does not cap what an Agent can become — only how it gets there.",
  },

  benchmark: {
    eyebrow: "Benchmark",
    title: "Each with its flagship model — comparable quality, 1-2 orders of magnitude cheaper",
    subtitle:
      "Every product runs the model it is normally paired with, head-to-head against Claude Code and OpenAI Codex on two suites: comparable accuracy, tens of times the difference in spend.",
    higherBetter: "higher is better",
    lowerBetter: "lower is better",
    dimScore: "Accuracy",
    dimTokens: "Tokens",
    dimCost: "Cost",
    dataTitle: "Complex data analysis",
    dataDesc:
      "Best accuracy of the three (66.67%, against 53.33% for both rivals), at 1/35 of OpenAI Codex's cost and 1/70 of Claude Code's.",
    dataFootnote:
      "15 complex data-analysis tasks · single run · Tokens and cost are suite totals · estimated at official pricing.",
    codeTitle: "Coding tasks",
    codeDesc:
      "Ties OpenAI Codex on accuracy (71.25%) and trails Claude Code (86.25%) — at 1/58 and 1/39 of their cost.",
    codeFootnote:
      "40 coding tasks × 2 runs (accuracy over all 80 outcomes) · Tokens and cost are suite totals · estimated at official pricing.",
    colFramework: "Framework",
    colModel: "Model",
    colAccuracy: "Accuracy (%)",
    colTokens: "Tokens (M)",
    colCost: "Cost ($)",
  },

  features: {
    eyebrow: "Features",
    title: "The full capability set, one desktop-grade UI",
    subtitle: "One-to-one with the web interface's menu — installed means ready.",
    more: "and more…",
    items: [
      {
        title: "Multi-session chat",
        desc: "Any number of sessions per Agent — streaming output, tool approvals and image paste out of the box.",
      },
      {
        title: "Agent hub",
        desc: "Create and manage Agents in one click; names, descriptions and prompts stay editable.",
      },
      {
        title: "Skill library",
        desc: "Browse, install and quick-invoke Skills — Agents can write and optimize their own.",
      },
      {
        title: "Scheduled tasks",
        desc: "Cron-style schedules run Agents on time, fully traced, unattended.",
      },
      {
        title: "Subagents",
        desc: "Delegate work to parallel Subagents — independent and isolated from each other.",
      },
      {
        title: "Cost center",
        desc: "Daily trends for Tokens, requests and cost, with per-model success rates and anomalies.",
      },
      {
        title: "Trace view",
        desc: "Replay every request and tool call round by round, with Token breakdown and timing.",
      },
      {
        title: "Agent evaluation",
        desc: "Built-in Benchmark suites and scoreboards — scores keep climbing as Agents evolve.",
      },
      {
        title: "Multi-user management",
        desc: "Admins provision users; each gets an independent Project with isolated data.",
      },
    ],
  },

  skills: {
    eyebrow: "Built-in Skills",
    title: "The built-in Skill library at a glance",
    subtitle: "Four Skill groups out of the box — Agents can write and optimize their own, too.",
    groups: [
      { title: "Office Productivity", skills: ["data-analysis", "firecrawl"] },
      { title: "Software Development", skills: ["web-design", "software-engineering"] },
      {
        title: "AI App Development",
        skills: ["penguin-sdk", "penguin-cli", "agenthub-models", "vllm", "ollama", "llamafactory"],
      },
      {
        title: "Agent Tuning",
        skills: ["agent-creation", "benchmark-design", "agent-evaluation", "agent-optimization"],
      },
    ],
  },

  security: {
    eyebrow: "Security",
    title: "Evolution within bounds, data within walls",
    subtitle: "A runtime boundary designed for enterprise data security.",
    items: [
      {
        title: "Open source, local deployment",
        desc: "A fully auditable open-source kernel; data lives in local directories and never passes through third-party services.",
      },
      {
        title: "Bounded evolution",
        desc: "Self-improvement is strictly confined to Workspace and Skills — the harness core security boundary is never modified.",
      },
      {
        title: "Approvals & audit",
        desc: "Tool calls require user approval first, and every decision is written to the Trace as an audit event.",
      },
      {
        title: "Credential isolation",
        desc: "Credentials land as hidden 0600 files, are barred from the system prompt, and stay masked throughout the UI.",
      },
    ],
  },

  community: {
    eyebrow: "Community",
    title: "Join the community and build with us",
    subtitle: "Discuss, ask, contribute — your first Issue is the best way to start.",
    items: {
      discord: { name: "Discord", desc: "Chat with us and other developers in real time." },
      x: { name: "X (Twitter)", desc: "Follow the latest product and team updates." },
      wechat: { name: "WeChat group", desc: "Chinese community discussions and support." },
      github: { name: "GitHub", desc: "Stars, Issues, and PRs all welcome." },
    },
  },

  cta: {
    title: "Complex AI development, made ever simpler",
    subtitle:
      "Through continuous evolution, PenguinHarness gives you a more efficient, more reliable, lower-hallucination and lower-cost Agent productivity engine.",
    install: "Install now",
    docs: "Read the docs",
  },

  footer: {
    tagline: "Efficient Self-Improving Harness for Everyone.",
    product: "Product",
    resources: "Resources",
    quickstart: "Quick start",
    features: "Features",
    benchmark: "Benchmark",
    blog: "Blog",
    repo: "GitHub repository",
    docs: "Documentation",
    releases: "Releases",
    license: "Apache-2.0 License",
    copyright: "© 2026 Prism Shadow · Open source under Apache-2.0",
  },

  blog: {
    title: "Blog",
    subtitle: "Product news, tech practices and release notes",
    all: "All",
    news: "Product news",
    practice: "Tech practice",
    changelog: "Release notes",
    pinned: "Pinned",
    copyLink: "Copy page link",
    linkCopied: "Copied",
    back: "Back to blog",
    empty: "No posts in this category yet",
    notFound: "Post not found",
    backHome: "Back to home",
    toc: "On this page",
  },
};
