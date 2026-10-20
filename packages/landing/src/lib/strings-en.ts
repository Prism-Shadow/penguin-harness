/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through the shared SiteLocaleProvider (app.tsx). Marketing copy uses
 * lowercase `agent`; preserve the established casing of Workspace, Token, Task, Skill, Trace,
 * and other terms.
 */
import type { Strings } from "./strings";

export const en: Strings = {
  siteName: "PenguinHarness",

  announcement: {
    label: "Announcements",
    prev: "Previous announcement",
    next: "Next announcement",
    geminiArgon: "Gemini 4 Argon is now available — see the 0.2.16 release notes",
    tokenDanceChallenge: "TokenDance Agent Challenge: ¥15,000 in token credits, through October 23",
    penguinGo: "Penguin Go official Token packs are live: 50% off every Gemini model",
  },

  nav: {
    home: "Home",
    blog: "Blog",
    download: "Download",
    docs: "Docs",
    gallery: "Gallery",
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
    positioning: "Unified and Stable RSI Framework",
    badge: "for free",
    /** No-break spaces keep each "any …" pair on one line when a phone wraps the tagline. */
    automation:
      "Fully automatic optimization: any\u00a0model, any\u00a0algorithm, any\u00a0benchmark",
    downloadCta: "Download desktop",
    cliInstall: "Command-line install",
    stats: [
      { value: "Cross-platform", label: "Linux · Windows · macOS" },
      { value: "100% open source", label: "Apache 2.0 licensed" },
      {
        value: "First self-improving harness",
        label: "A native agent self-evolution engine",
      },
    ],
    supportedModelsCount: "1000+",
    supportedModelsLabel: "Supported Models",
    supportedModelsMore: "and more",
    algorithmsLabel: "RSI Algorithms",
    benchmarksLabel: "Benchmarks",
    benchmarkKinds: [
      "Data analysis",
      "Software engineering",
      "Business automation",
      "Scientific research",
      "Terminal tasks",
      "Agent self-evolution",
    ],
    externalLink: {
      title: "You're about to open an external link",
      body: "This link goes to a site outside PenguinHarness and opens in a new tab:",
      cancel: "Cancel",
      open: "Open link",
    },
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
    /**
     * First-launch FAQ. The macOS builds are Developer ID signed and notarized and the
     * Windows installers are Authenticode signed, so those two platforms have nothing to
     * unblock; the Linux AppImage's execute bit is the one item left, pre-expanded for a
     * Linux visitor.
     */
    faq: {
      title: "First-launch FAQ",
      intro:
        "The macOS builds are Developer ID signed and notarized, and the Windows installers are Authenticode signed, so neither platform needs a first-launch unblock. Linux is the one exception.",
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

  live: {
    open: "Open in the gallery",
    loading: "Loading the live demo…",
  },

  showcase: {
    start: "Start page (live demo)",
    evolve: {
      title: "Start agent self-evolution with one sentence",
      text: "Name the agent, the Benchmark and the target score. PenguinHarness edits the agent, evaluates it again, and keeps the version that scores higher.",
      link: "How self-evolution works",
      frame: "A self-evolution round in a conversation (live demo)",
    },
    evaluate: {
      title: "Every version gets a score",
      text: "Each evaluation on a Benchmark adds a point to its agent and model's line, so the better version is plain to see.",
      link: "About the Evaluation Center",
      frame: "A Benchmark in the Evaluation Center (live demo)",
    },
    toolkits: {
      title: "Self-evolution algorithms are added as plugins",
      text: (names: string) =>
        `Besides the default loop, ${names} each come as a toolkit that runs the algorithm the way its paper describes.`,
      link: "Browse the plugin library",
      frame: "The plugin market (live demo)",
    },
  },

  selfImprove: {
    title: "A multi-agent self-evolution framework",
    subtitle:
      "By default the General Agent runs the optimization Skill. Each round it makes one change to the tested agent. Evaluator subagents running the evaluation Skill score the changed agent on every case of the Benchmark.",
    nodeOptimizer: "Optimizer",
    nodeEvaluator: "Evaluator × N",
    nodeTarget: "Tested agent",
    edgeSpawn: "dispatch in parallel",
    edgeFeedback: "scores & Traces",
    edgeBench: "run & score each case",
    edgeImprove: "edit AGENTS.md, a Skill or config",
    noteOld: "snapshot before editing",
    noteNew: "kept only if the score is higher",
    trends: [
      { label: "Score", hint: "out of 100" },
      { label: "Cost", hint: "per run" },
      { label: "Duration", hint: "per run" },
    ],
    trendsNote:
      "The scoreboard records each version's score, cost and duration. The values here are illustrative.",
    demo: {
      caption:
        "Demo: a decision agent is evaluated, revises its working method once and is retested on the same model. Its score goes from 84 to 100.",
      cost: "Six test-agent runs cost $0.0373, not counting Benchmark creation, scoring or the optimizer.",
    },
    diagramLabel:
      "One round of self-evolution: the Optimizer runs agent-optimization and dispatches Evaluator subagents running agent-evaluation. They run the tested agent on each Benchmark case and score it. From the scores and Traces, the Optimizer edits version N into version N+1. Version N+1 is kept only if its score is higher. Version N is saved as a snapshot before it is edited.",
  },

  quickstart: {
    title: "Install PenguinHarness, then pick how to start it",
    subtitle:
      "The desktop app works as soon as it is installed. After a command-line install, open the Web UI or use it in the terminal.",
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
      title: "Desktop app: ready when it opens",
      desc: "The local server and full Web UI are built in, with no runtime setup and no terminal process to keep alive.",
      cta: "Choose your system and download",
      steps: [
        "Download the installer for your system",
        "Open PenguinHarness and follow the model setup",
        "Describe your first AI app in one sentence",
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
    title: "One sentence and $0.10 build a legal agent app",
    subtitle:
      "Describe what you need in one request. PenguinHarness builds a legal agent app that takes contract uploads, identifies risks and produces review reports to download.",
    prompt:
      "Build a legal review agent with a simple workspace where users upload contracts, track the review, and download a report with risky clauses, explanations, and suggested revisions.",
    caption:
      "The app it built: upload contracts, follow each file's review and download a report of risky clauses with suggested revisions",
    cost: "Five sample reviews cost $0.0423 in model calls.",
  },

  pillars: {
    title: "A minimal, file-centric agent architecture",
    subtitle: "When an agent improves, its files change and the model does not.",
    root: "PenguinHarness",
    diagramLabel:
      "PenguinHarness branches into OmniMessage, the Penguin SDK and Agent State, each leading to one card below",
    items: [
      {
        concept: "OmniMessage",
        title: "Simplest is the best",
        desc: "The engine streams OmniMessage, the Trace stores it and the Web App renders it, with no second format in between. Models are reached over MMSP. The Agent API streams each run as AMSP.",
        link: "The OmniMessage protocol",
      },
      {
        concept: "Penguin SDK",
        title: "Harness for building agents",
        desc: "Every Task in PenguinHarness runs on @prismshadow/penguin-core. You can install the same package from npm. With the penguin-sdk Skill, an agent builds a standalone app on it, such as a RAG app that cites its sources.",
        link: "SDK quick start",
      },
      {
        concept: "Agent State",
        title: "Harness for recursive self-improvement",
        desc: "Its prompt, Skills and settings are files in its Agent State. Self-evolution edits these files and snapshots each version before changing it.",
        link: "Configuration reference",
      },
    ],
  },

  compare: {
    title: "Build enterprise-grade agents fast",
    subtitle:
      "An agent library runs the loop that calls the model and its tools. Around that loop you still need an interface, a record of each run, a way to score the agent and an API to call it.",
    library: {
      name: "Agent library",
      mode: "You build each piece",
      note: "Write each part yourself, or wire in a separate product for it.",
    },
    penguin: {
      name: "PenguinHarness",
      mode: "Already built",
      note: "A Web App, Traces, the Evaluation Center with built-in Benchmarks, self-evolution toolkits, a sandbox and the Agent API.",
    },
  },

  scenarios: {
    title: "From screening centers to factory floors",
    subtitle:
      "Two companies had PenguinHarness build their agents. Both now run them in production.",
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

  benchmark: {
    title: "Accuracy on par with Claude Code and Codex, at a fraction of the cost",
    subtitle:
      "Each product runs on the model it is usually paired with, on two task suites. We compare accuracy, Tokens used and cost.",
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

  updates: {
    title: "Latest updates",
    all: "All posts",
  },

  community: {
    title: "Join the community",
    subtitle:
      "Ask questions on Discord or in the WeChat group, or open an Issue or a PR on GitHub.",
    items: {
      discord: { name: "Discord", desc: "Talk with the team and other developers." },
      x: { name: "X (Twitter)", desc: "Product updates and releases." },
      wechat: { name: "WeChat group", desc: "The Chinese-language group." },
      github: { name: "GitHub", desc: "Source code, Issues and PRs." },
    },
  },

  cta: {
    title: "Download PenguinHarness and run your first self-evolution round",
    subtitle: "Every version is scored and snapshotted, so a worse one rolls back in one step.",
    download: "Download the desktop app",
    quickstart: "Get started",
    docs: "Read the docs",
  },

  footer: {
    tagline: "Unified and Stable RSI Framework.",
    product: "Product",
    resources: "Resources",
    quickstart: "Quick start",
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
