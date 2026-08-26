/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through state/locale.tsx. Marketing copy uses lowercase `agent`;
 * preserve the established casing of Workspace, Token, Task, Skill, Trace, and other terms.
 */
import type { Strings } from "./strings";

export const en: Strings = {
  siteName: "PenguinHarness",

  announcement: {
    label: "Announcements",
    prev: "Previous announcement",
    next: "Next announcement",
    k3AndFree: "Kimi K3 and free models like Ling 3.0 Flash are now available in PenguinHarness",
    fireworks: "Claim $50 in Fireworks API credits with the AMD Developer Program",
  },

  nav: {
    highlights: "Highlights",
    selfImprove: "Self-evolution",
    quickstart: "Quick start",
    cases: "Cases",
    scenarios: "Scenarios",
    benchmark: "Benchmark",
    contract: "CONTRACT.md",
    features: "Features",
    blog: "Blog",
    download: "Download",
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
    platformLead: "Open-source, local-first multi-agent app ",
    platformAccent: "development",
    platformTail: " platform",
    automationLead: "Fully automated ",
    automationActions: ["creation", "optimization", "deployment"],
    automationTail: "of AI apps",
    downloadCta: "Download desktop",
    cliInstall: "Command-line install",
    stats: [
      { value: "1000+ Models", label: "Support for Major Providers" },
      { value: "Local on Every Platform", label: "Linux · Windows · macOS" },
      { value: "100% Open Source", label: "Apache 2.0 Licensed" },
      { value: "First Self-Evolving Harness", label: "Native Agent Self-Evolution Engine" },
    ],
    supportedModelsLabel: "Supported models",
    supportedModels: [
      "OpenAI",
      "Anthropic",
      "Gemini",
      "DeepSeek",
      "Zai",
      "MoonShot",
      "Qwen",
      "Openrouter",
    ],
    supportedModelsMore: "+992 more",
  },

  install: {
    linux: "Linux",
    macos: "macOS",
    windows: "Windows",
    online: "Online install",
    offline: "Offline package",
    offlineNote:
      "Every GitHub Release attaches one package per target (Linux / macOS in x64 and arm64, Windows in x64) and the same file serves online and offline installation. Each package seals the program payload, its SHA256 checksum and the installer: download that one file on a networked machine, copy it to the target, extract once and install with no network at all.",
    offlineHints: {
      linux: "On arm64 machines, use penguin-linux-arm64.tar.gz.",
      macos: "Apple silicon uses the arm64 package; on Intel, use penguin-darwin-x64.tar.gz.",
      windows: "After unzipping you can also just double-click install.cmd.",
    },
    offlineRelease: "Download offline packages from GitHub Releases",
    desktopNote:
      "Already on the desktop app? A CLI install shares the same local data with it, and the two can be used side by side.",
    desktopPage: "Go to the desktop download page",
  },

  download: {
    eyebrow: "Download",
    title: "Download the desktop app",
    recommended: "Your system",
    platforms: {
      mac: { name: "macOS", require: "macOS 11 or later, dmg disk image (pick your chip)" },
      windows: { name: "Windows", require: "Windows 10 or later (x64), NSIS installer" },
      linux: {
        name: "Linux",
        require: "x64 — AppImage runs in place, deb goes to your package manager",
      },
    },
    speed: {
      title: "Automatically pick the fastest source",
      subtitle:
        "The page checks reachability first, then measures speed in the background. Download buttons do not wait for the full test.",
      github: "GitHub Releases",
      githubHint: "Global source",
      oss: "OSS mirror",
      ossHint: "Optimized for mainland China",
      testing: "Testing",
      skipped: "Not tested",
      unreachable: "Unavailable",
      belowFloor: "Too slow to measure",
      selected: "Current download route",
      automatic: "Automatic",
      manual: "Manual",
    },
    statusProbing: "Finding a download source that answers …",
    statusRefining: "Still comparing the two sources — the faster one takes over on its own.",
    statusOss: (version: string) =>
      `Connected to the OSS mirror (${version}) — downloads are served from the mirror.`,
    statusGithub: "Downloads point at the latest GitHub Release.",
    altGithub: "Download from GitHub instead",
    altOss: "Use the OSS mirror instead",
    checksums: "Checksums (SHA256SUMS.desktop)",
    allReleases: "Open GitHub Releases",
    /** First-launch FAQ: one collapsible item per platform, the visitor's own pre-expanded. */
    faq: {
      title: "First-launch FAQ",
      intro:
        "Current builds are not signed yet, so the system may block the very first launch — the fix for your platform below is needed only once.",
      mac: {
        question: "macOS says “PenguinHarness” is damaged and can’t be opened?",
        why: "macOS quarantines files downloaded from the internet, and the missing signature makes that flag surface as a false “damaged” alert. Deleting the flag clears it:",
        stepDrag: "Open the downloaded dmg and drag PenguinHarness into the Applications folder.",
        stepTerminal: "Open Terminal (Launchpad → Other → Terminal).",
        stepPaste:
          "Paste this command into Terminal and press Enter, then type your login password (nothing shows while you type; press Enter when done):",
        stepOpen: "Once it finishes, double-click the app — it now opens normally.",
      },
      windows: {
        question: "Windows SmartScreen says “Windows protected your PC”?",
        answer:
          "The installer is not signed yet, so SmartScreen holds the first run: click “More info”, then “Run anyway” to continue installing — first run only.",
      },
      linux: {
        question: "Nothing happens when double-clicking the AppImage on Linux?",
        answer:
          "Browsers download AppImages without the execute permission. Grant it once and the app starts normally from then on (the deb package installs through the package manager and is not affected):",
      },
    },
    cliHint: "Just need the CLI, or the Web UI in a browser?",
    cliHintLink: "See the quick start",
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
        title: "Harness for building agents",
        tag: "",
        desc: "With the PenguinHarness SDK, an agent builds complete agent applications for you — autonomously, from scratch.",
      },
      {
        title: "Harness for Recursive Self-Improvement",
        tag: "",
        desc: "With PenguinHarness Skills, an agent evaluates and optimizes itself, improving recursively over time.",
      },
    ],
  },

  compare: {
    eyebrow: "vs. LangChain",
    title: "Building agents with agents",
    subtitle: [
      "With LangChain, you build agents by hand — at 1× speed.",
      "With PenguinHarness, agents build agents — at 100×.",
    ],
    langchain: {
      name: "LangChain",
      speed: "1×",
      mode: "agents built by hand",
      note: "Chains, tools and prompts written line by line — every app starts from zero.",
    },
    penguin: {
      name: "PenguinHarness",
      speed: "100×",
      mode: "agents built by agents",
      note: "One sentence in — an agent delivers scaffold, code and run instructions end to end.",
    },
  },

  selfImprove: {
    eyebrow: "The self-improvement loop",
    title: "Multi-agent collaboration makes evolution automatic",
    subtitle:
      "The Optimizer orchestrates multiple Evaluators to score the target agent in parallel, uses the scores and run traces to find where points were lost, and upgrades the agent from version N to N+1 — with a snapshot before every round.",
    videoLabel: "Self-improvement demo video",
    videoCaption:
      "The self-improvement loop end to end: run the benchmark, find the lost points, ship the next version.",
    nodeOptimizer: "Optimizer",
    nodeEvaluator: "Evaluator × N",
    nodeTarget: "target agent",
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
      "Self-improvement loop: the Optimizer orchestrates Evaluators to score, then upgrades the target agent from vN to vN+1 via scores and traces",
  },

  quickstart: {
    eyebrow: "Quick start",
    title: "Get started with PenguinHarness in two steps",
    subtitle: "Choose how to install first. With a CLI install, then choose Web UI or CLI.",
    stepOne: "Step one",
    chooseInstall: "Choose an installation method",
    stepTwo: "Step two",
    chooseLaunch: "Choose how to start",
    tabs: {
      desktop: "Desktop app",
      install: "CLI install",
      web: "Start Web UI",
      cli: "Start CLI",
    },
    desktop: {
      title: "Desktop first, ready when it opens",
      desc: "The local server and full Web UI are built in, with no runtime setup and no terminal process to keep alive.",
      cta: "Choose your system and download",
      steps: [
        "Download the installer for your system",
        "Open PenguinHarness and follow the model setup",
        "Describe your first agent app in one sentence",
      ],
    },
    install: {
      title: "Install PenguinHarness with one command",
      desc: "Made for developer machines, servers, and private environments. The bundle includes its runtime and does not depend on system Node.js.",
      osLabel: "Choose an operating system",
      onlineTitle: "Online install",
      offlineTitle: "Offline packages",
      offlineDesc:
        "Download the package for the target system on a connected machine, then copy it to the offline machine to install.",
      offlineCommand: "Show offline install commands",
    },
    web: {
      title: "Use the full interface in your browser",
      desc: "This starts the local service and opens the Web UI, a good fit for servers and remote access.",
      command: "penguin web   # opens http://127.0.0.1:7364",
      steps: [
        "Complete the command-line install",
        "Run penguin web",
        "Follow the terminal prompt to sign in and configure a model",
      ],
    },
    cli: {
      title: "Run an agent directly from the terminal",
      desc: "Start an interactive conversation or connect a one-off task to scripts and automated workflows.",
      command: `penguin chat

# Or run one task
penguin run --message "Analyze data.csv and summarize quarterly sales"`,
    },
    localNote:
      "Desktop, Web UI, and CLI share ~/.penguin/data; switching entry points never moves or copies your data.",
  },

  cases: {
    eyebrow: "Cases",
    title: "Generate a runnable agent app in one sentence",
    subtitle:
      "Hand the requirement to an agent and get a runnable result end to end — more cases are on the way.",
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

  scenarios: {
    eyebrow: "Scenarios",
    title: "From screening centers to factory floors",
    subtitle:
      "Production stories of teams using PenguinHarness to build agents automatically and deploy them to production.",
    items: [
      {
        title: "Screening-report QC",
        alt: "A CT scanner room at a health screening center",
        body: "A health-screening group used PenguinHarness to automatically build a report-QC agent and deploy it into its production environment on a local Qwen3 14B, so data never leaves the facility. A review round that took 30 minutes by hand now clears 30 reports a minute, with findings in line with medical experts and several times the review capacity.",
      },
      {
        title: "Production-line inspection",
        alt: "An automated semiconductor production line",
        body: "A manufacturer used PenguinHarness to automatically build a production-line inspection agent and deploy it across multiple live lines. The agent watches equipment around the clock and tries automated recovery first when something goes wrong; after deployment, downtime fell 65% and output roughly doubled.",
      },
    ],
  },

  contract: {
    eyebrow: "A contract for stable evolution",
    title: "CONTRACT.md",
    subtitle:
      "PenguinHarness treats this contract as the boundary and bedrock of evolution: capability may grow, the boundary never drifts.",
    intro:
      "Evolution needs boundaries. The contract is the covenant between harness and agent: capability grows within; the boundary holds without.",
    items: [
      {
        term: "Working boundary",
        text: "Every agent runs on the same harness: Sessions are created under an agent, Tasks run inside a Session; self-improvement happens only inside Workspace and Skills, while the harness kernel and its safety mechanisms never change.",
      },
      {
        term: "Editable files",
        text: "An agent's prompts, Skills and configuration live as editable files on disk, never as constants baked into code. What you can see, the agent can improve; what you can edit, it can learn.",
      },
      {
        term: "Full tracing",
        text: "Every model request and every tool call is written to the Trace in full: how many Tokens it spent, how long it took, why it failed — all replayable line by line afterwards.",
      },
      {
        term: "Approvals & audit",
        text: "Every tool call passes approval before it runs, and every decision leaves an audit record — what the agent did is never a mystery.",
      },
      {
        term: "Version control",
        text: "Before each optimization, the agent state is snapshotted. If a round fails or regresses, restore any historical version in one step.",
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
        text: "Models are not bound to agents: switch to a stronger or cheaper model at any time without rewriting the agent.",
      },
      {
        term: "Recoverable trajectories",
        text: "Any Session can be fully restored from its Trace: restart the process or move machines without losing context.",
      },
    ],
    outro: "The contract does not cap what an agent can become — only how it gets there.",
  },

  benchmark: {
    eyebrow: "Benchmark",
    title: "Outstanding results at tens of times less cost",
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
        desc: "Any number of sessions per agent — streaming output, tool approvals and image paste out of the box.",
      },
      {
        title: "agent hub",
        desc: "Create and manage agents in one click; names, descriptions and prompts stay editable.",
      },
      {
        title: "Skill library",
        desc: "Browse, install and quick-invoke Skills — agents can write and optimize their own.",
      },
      {
        title: "Scheduled tasks",
        desc: "Cron-style schedules run agents on time, fully traced, unattended.",
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
        title: "agent evaluation",
        desc: "Built-in Benchmark suites and scoreboards — scores keep climbing as agents evolve.",
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
    subtitle: "Four Skill groups out of the box — agents can write and optimize their own, too.",
    groups: [
      { title: "Office Productivity", skills: ["data-analysis", "firecrawl"] },
      { title: "Software Development", skills: ["web-design", "software-engineering"] },
      {
        title: "AI App Development",
        skills: ["penguin-sdk", "penguin-cli", "agenthub-models", "vllm", "ollama", "llamafactory"],
      },
      {
        title: "agent tuning",
        skills: [
          "agent-initialization",
          "benchmark-design",
          "agent-evaluation",
          "agent-optimization",
        ],
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
      "Through continuous evolution, PenguinHarness gives you a more efficient, more reliable, lower-hallucination and lower-cost agent productivity engine.",
    download: "Download the desktop app",
    quickstart: "Get started",
    docs: "Read the docs",
  },

  footer: {
    tagline: "Efficient Self-Improving Harness for Everyone.",
    product: "Product",
    resources: "Resources",
    quickstart: "Quick start",
    features: "Features",
    selfImprove: "Self-evolution engine",
    cases: "Cases",
    blog: "Blog",
    repo: "GitHub repository",
    docs: "Documentation",
    releases: "Releases",
    license: "Apache-2.0 License",
    copyright: "© 2026 Prism Shadow · Open source under Apache-2.0",
  },

  blog: {
    title: "Blog",
    subtitle: "Product news, tech practices, perspectives and release notes",
    all: "All",
    news: "Product news",
    practice: "Tech practice",
    perspectives: "Perspectives",
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
