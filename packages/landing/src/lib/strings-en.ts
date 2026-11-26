/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through the shared SiteLocaleProvider (app.tsx). Marketing copy uses
 * lowercase `agent`; preserve the established casing of Workspace, Token, Task, Skill, Trace,
 * and other terms.
 */
import type { Strings } from "./strings";

export const en: Strings = {
  siteName: "PenguinHarness",
  backToTop: "Back to top",

  announcement: {
    label: "Announcements",
    prev: "Previous announcement",
    next: "Next announcement",
    release0217:
      "PenguinHarness 0.2.17: Agent API record streams, charts and forms — see release notes",
    penguinGo: "Penguin Go official Token packs are live: 50% off every Gemini model",
  },

  nav: {
    home: "Home",
    blog: "Blog",
    download: "Download",
    plugins: "Plugins",
    benchmarks: "Benchmarks",
    leaderboards: "Leaderboards",
    amsp: "AMSP",
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
    positioning: {
      growthLead: "Software that ",
      growth: "keeps growing",
      growthEnd: ".",
      separator: " ",
      reachLead: "Evolution ",
      reach: "within reach",
      reachEnd: ".",
    },
    subtitle: "Free and Stable RSI Framework",
    downloadCta: "Download desktop",
    cliInstall: "Command-line install",
    stats: [
      { value: "Cross-platform", label: "Linux, Windows, macOS" },
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
    benchmarkKinds: {
      dataAnalysis: "Data analysis",
      softwareEngineering: "Software engineering",
      businessAutomation: "Business automation",
      scientificResearch: "Scientific research",
      terminalTasks: "Terminal tasks",
      biomedicine: "Biomedicine",
      agentSelfEvolution: "Agent self-evolution",
    },
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
    evolutionFrame: "A self-evolution round in a conversation (live demo)",
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
    title: "A2APP: one sentence and $0.10 build a legal agent app",
    a2app:
      "A2APP is the agent's own small app, a tab beside the chat; the app calls the agent to do the work. One sentence in chat, and the agent changes it; it reloads at once and keeps earlier versions.",
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
      "PenguinHarness branches into AMSP, the Penguin SDK and Agent State, each leading to one card below",
    items: [
      {
        concept: "AMSP",
        title: "Simplest is the best",
        desc: "The engine streams AMSP records, the Trace stores them, the Web App renders them and the Agent API serves them to your programs, with no second format in between. Models are reached over MMSP.",
        link: "AMSP records",
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
      "15 complex data-analysis tasks, one run each. Tokens and cost are suite totals, estimated at official pricing.",
    codeTitle: "Coding tasks",
    codeDesc:
      "Ties OpenAI Codex on accuracy (71.25%) and trails Claude Code (86.25%) — at 1/58 and 1/39 of their cost.",
    codeFootnote:
      "40 coding tasks, two runs each, with accuracy over all 80 outcomes. Tokens and cost are suite totals, estimated at official pricing.",
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
    tagline: "Free and Stable RSI Framework.",
    product: "Product",
    resources: "Resources",
    quickstart: "Quick start",
    cases: "Cases",
    blog: "Blog",
    repo: "GitHub repository",
    docs: "Documentation",
    releases: "Releases",
    license: "Apache-2.0 License",
    copyright: "© 2026 Prism Shadow. Open source under Apache-2.0.",
  },

  hub: {
    source: "Source",
    searchPlaceholder: "Search by name, summary or author",
    clearSearch: "Clear search",
    all: "All",
    sortLabel: "Sort",
    sortLatest: "Recently updated",
    sortName: "Name",
    empty: "Nothing matches. Clear the search or the filters to see more.",
    clearFilters: "Clear filters",
    count: (n: number) => `${n}`,
    listSeparator: ", ",
    viewSource: "View on GitHub",
    details: "Details",
    pageTitle: (name: string) => `${name} | PenguinHarness`,
    notFound: "Nothing here. It may have been renamed or removed.",
    backToList: "Back to the list",
    meta: {
      author: "Author",
      version: "Version",
      license: "License",
      category: "Category",
      package: "npm package",
      preinstall: "Preinstalled on new agents",
      yes: "Yes",
      no: "No",
      status: "Status",
      updated: "Updated",
      tasks: "Tasks",
    },
    status: { published: "Published", draft: "Draft" } as Record<string, string>,
    references: "References",
    plugins: {
      title: "Plugins",
      description:
        "The PenguinHarness plugin library: self-evolution toolkits, Skills, Hooks and workbenches.",
      facetCategory: "Category",
      facetContents: "Contents",
      facetAuthor: "Author",
      categories: {
        rsi: "Agent Self-Evolution",
        "office-productivity": "Office Productivity",
        "software-development": "Software Development",
        "ai-app-development": "AI App Development",
        sandbox: "Agent Sandbox",
        other: "Other",
      } as Record<string, string>,
      contents: { skills: "Skills", hooks: "Hooks", workbenches: "Workbenches" },
      about: "About",
      quickStart: "Quick start",
      quickStartSkills: "Skills it selects",
      skills: "Skills",
      hooks: "Hooks",
      workbenches: "Workbenches",
      extensions: "Hooks and workbenches",
      skillCount: (n: number) => (n === 1 ? "1 Skill" : `${n} Skills`),
      preinstalled: "Preinstalled",
    },
    benchmarks: {
      title: "Benchmarks",
      description: "PenguinHarness benchmarks: the tasks and rubrics agents are measured on.",
      facetTimeout: "Time limit per task",
      timeout: {
        short: "Up to 15 minutes",
        hour: "Up to 1 hour",
        long: "Over 1 hour",
        none: "No limit",
      } as Record<string, string>,
      facetLeaderboard: "Leaderboards",
      onLeaderboard: "On a leaderboard",
      facetStatus: "Status",
      facetAuthor: "Author",
      taskCount: (n: number) => (n === 1 ? "1 task" : `${n} tasks`),
      about: "About",
      tasks: "Tasks",
      budget: { timeout: "Time", cpus: "CPU", ram: "Memory", disk: "Disk", gpus: "GPU" },
      minutes: (n: number) => `${n} min`,
      hours: (n: number) => (n === 1 ? "1 hour" : `${n} hours`),
      cores: (n: number) => (n === 1 ? "1 core" : `${n} cores`),
      gigabytes: (n: number) => `${n} GB`,
      cards: (n: number) => (n === 1 ? "1 card" : `${n} cards`),
      unlimited: "No limit",
      leaderboards: "Leaderboards that use it",
      taskParts: "Task contents",
      statement: "Statement",
      rubric: "Rubric",
      data: "Data",
      instruction: "Instruction given to the agent",
      files: (n: number) => (n === 1 ? "Files (1)" : `Files (${n})`),
      allFiles: (n: number) =>
        n === 1 ? "View the file on GitHub" : `View all ${n} files on GitHub`,
      dataFolder: "View the data folder on GitHub",
      showAll: "Show all",
      showLess: "Show less",
      fileCount: (n: number) => (n === 1 ? "1 file" : `${n} files`),
      upTo: (time: string) => `Up to ${time} a task`,
      withData: "Includes data",
    },
    leaderboards: {
      title: "Leaderboards",
      description:
        "PenguinHarness leaderboards: agents compared by score and cost on the benchmarks.",
      facetAuthor: "Author",
      entryCount: (n: number) => (n === 1 ? "1 entry" : `${n} entries`),
      benchmarkCount: (n: number) => (n === 1 ? "1 benchmark" : `${n} benchmarks`),
      charts: { table: "Ranking", pareto: "Score and cost", waffle: "Per task" },
      chartsLabel: "Views",
      results: "Results",
      entries: "Entries",
      baseline: "Baseline",
      rank: "Rank",
      model: "Model",
      score: "Score",
      modelThinking: (model: string, level: string) => `${model} (${level})`,
      columnNames: {
        harness: "Harness",
        algorithm: "Algorithm",
        released: "Released",
        cost: "Cost",
      } as Record<"harness" | "algorithm" | "released" | "cost", string>,
      columns: "Columns",
      filter: "Filter",
      sortBy: (name: string) => `Sort by ${name.toLowerCase()}`,
      filters: {
        model: "Model",
        harness: "Harness",
        algorithm: "Algorithm",
        thinking: "Thinking level",
      } as Record<"model" | "harness" | "algorithm" | "thinking", string>,
      filterLabel: (name: string) => `Filter by ${name.toLowerCase()}`,
      noMatch: "No entry matches these filters.",
      rawData: "Show the raw data",
      raw: {
        harness: "Harness",
        provider: "Model provider",
        thinking: "Thinking level",
        phase: "Phase",
        std: "Standard deviation",
        stdAttempts: (n: number) => `Across ${n} attempts`,
        stdExperiments: "From each experiment's score_std",
        experiments: "Experiments",
        benchmark: "Benchmark and experiment",
        value: "Score",
        attempts: "Attempts",
        tokens: "Tokens in / cache / out",
        finished: "Finished",
        harnessSetting: "Harness setting",
        notRecorded: "Not recorded",
      },
      cost: "Cost",
      duration: "Time",
      tokens: "Tokens",
      axisLabel: "Horizontal axis",
      frontier: "Pareto frontier",
      hoursShort: (value: string) => `${value} h`,
      minutesShort: (value: string) => `${value} min`,
      scale: "Score",
      noScore: "Not scored",
      task: "Task",
      attemptsPerCell: (n: number) =>
        n === 1 ? "One square per task" : `${n} squares per cell, one per attempt`,
      cellScores: (scores: string[]) => `Attempts: ${scores.join(", ")}`,
      methodOnModel: (method: string, model: string) => `${method} (${model})`,
      paretoPoint: (method: string, score: string, axis: string, value: string) =>
        `${method}: score ${score}, ${axis.toLowerCase()} ${value}`,
      paretoSummary: (axis: string, points: string[], frontier: string[]) =>
        `Horizontal axis: ${axis}. ${points.join("; ")}. Pareto frontier: ${frontier.join(", ")}.`,
      benchmarks: "Benchmarks",
      method: {
        title: "Method and sources",
        matrixLead: (metric: string, phase: string) =>
          `Each cell is one experiment's \`${metric}\` from its \`${phase}\` summary; the rows under the line are what each column comes to.`,
        listLead:
          "Each entry's expression, argument by argument: the experiment it reads, the phase and metric, and the value there.",
        stdAttempts: (n: number | null) =>
          `± is the sample standard deviation across ${n === null ? "the" : `the ${n}`} attempts, each attempt's task scores combined the same way as the score.`,
        stdExperiments:
          "± is composed from each experiment's own `score_std`, taken as independent.",
        stdExperimentsSome:
          "± is taken across attempts; where an entry's experiments ran different numbers of attempts, it is composed from each experiment's `score_std` instead.",
        benchmark: "Benchmark",
        experiment: "Experiment",
        phase: "Phase",
        metric: "Metric",
        value: "Value",
        opName: (op: string | null) => (op === null ? "the value" : op),
        opRow: (op: string | null) => (op === null ? "Score" : `Score (${op})`),
        stdRow: "± std",
        costRow: "Cost (one run, summed)",
        timeRow: "Time (one run, summed)",
        config: "Configuration",
        experiments: "Experiments",
      },
    },
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
    references: "References",
    backToRef: (n: number, k: number) =>
      k > 1 ? `Back to reference ${n}, citation ${k}` : `Back to reference ${n}`,
  },

  amsp: {
    title: "AMSP: Agent Message Stream Protocol",
    description:
      "Stream, parse and store agent messages with one protocol: AMSP, the Session stream of a PenguinHarness agent.",
    headline: "One protocol for agent communication",
    subline: "Stream, parse and store agent messages with one protocol",
    lineage: " streams one model call; AMSP streams an agent's Session.",
    reference: "Protocol reference",
    copyPrompt: "Copy prompt for a coding agent",
    copied: "Copied",
    agentPrompt: (docsUrl: string) =>
      `Read the PenguinHarness Agent API guide at ${docsUrl}, then help me write code to call an agent.\n\nBase URL and Agent ID: from the agent's API tab in PenguinHarness.\n\nUse the @prismshadow/amsp SDK: stream() for the records as they arrive and await run() for the complete result. When a key is required, read PENGUIN_AGENT_KEY from the environment; do not hardcode it. Continue existing conversations with sessionId. Follow the guide for approval requests and HTTP 429, respecting Retry-After on 429 responses.`,

    player: {
      label: "Example runs",
      scenarios: { first: "First request", continue: "Continue", interrupt: "Interrupt" },
      pause: "Pause",
      play: "Play",
      input: "Just one codebase",
      events: "Streamed events",
      stored: "Stored in the Trace",
      besideStream: "beside the stream",
      assembled: "Parsed message",
      request: (n: number) => `Request ${n}`,
      thinking: (level: string) => `thinking ${level}`,
      streaming: "streaming",
      result: "Result",
      requests: (n: number) => (n === 1 ? "1 Request" : `${n} Requests`),
      tokens: (n: string) => `${n} tokens`,
    },

    structure: {
      title: "Message structure",
      subtitle:
        "A run nests three spans, longest first: the Task, each Request to the model, and the messages that fill each Request, each one ending in its complete record.",
      figureLabel:
        "A run with two tool rounds on one time axis, in three rows from longest to shortest. The Task runs from task_begin to task_end. Under it, three Requests each run from request_begin to request_end. Under them, the messages fill each Request, each ending in its complete record: the thinking and a tool call in the first, a second tool call in the second, the answer in the third. Between two Requests a tool runs, and its tool_call_output completes where the next Request begins.",
      levels: { task: "Task", request: "Request", message: "Message" },
      steps: [
        "task_begin opens a Task and task_end closes it; a task_begin still open at [DONE] means the run did not reach its end.",
        "Each Request opens with request_begin, which carries the thinking level, and closes with request_end.",
        "A message streams as partial_* fragments (start, delta, stop), then its complete record follows, an interrupted message's included.",
        "A tool runs once its call is complete; its tool_call_output completes after request_end, and the next Request starts from it.",
      ],
      boundaries: "event_msg: a Task or a Request, from its begin record to its end record",
      /** What each colour is, in the terms of the Web App Trace view's legend. */
      kinds: {
        thinking: "thinking",
        text: "text, the reply",
        tool_call: "tool_call, the call being written",
        tool_call_output: "tool_call_output, the tool running",
      },
      complete:
        "model_msg: a message streams as partial_* fragments (live only) and ends in its complete record, stored in the Trace",
    },

    records: {
      title: "Every record, field by field",
      subtitle:
        "Each record is a line of the Trace, byte for byte; only the partial_* fragments are live only. Pick one to see an example and all of its fields. A client ignores a type or a field it does not know.",
      choose: "Choose a record",
      families: {
        envelope: "Envelope",
        session: "Session",
        complete: "Complete messages",
        partial: "Fragments",
        boundaries: "Task and Request",
        interventions: "Aborts, approvals, hooks",
        context: "Context and tools",
        control: "Control frames",
      },
      stored: "stored in the Trace",
      live: "live only",
      firstMessage: "sent with a Session's first message",
      frame: "control frame, not a record",
      example: "Example",
      wire: "On the wire",
      envelopeFields: "Envelope fields",
      payloadFields: "Payload fields",
      head: {
        field: "Field",
        type: "Type",
        required: "Required",
        meaning: "Meaning",
        example: "Example",
      },
      required: "required",
      optional: "optional",
      frameNote:
        "A control frame carries no id: it moves no resume position and is never replayed.",
      frames: {
        ping: "Sent as soon as a stream opens, so a run stream's first line, then every 20 seconds.",
        done: "A run stream's last line.",
      },
      common: {
        type: "Which payload this is.",
        role: "Who the message is from.",
        event_type: "The fragment's phase: start, delta or stop.",
        tool_call_id: "The id of the call it belongs to; pairs a call with its output.",
        fidelity: "Data the provider needs back on replay, kept as it came.",
        error_code:
          "The machine-readable cause, stable across versions; what a client localizes from.",
        error_message: "The raw failure text, shown as it came.",
      },
      items: {
        envelope: {
          summary: "Every record has the same envelope; only the payload varies.",
          fields: {
            timestamp: "When the record was made, ISO 8601 in UTC.",
            type: "session_meta, model_msg or event_msg.",
            payload: "The record itself, told apart by its own type.",
            origin:
              "The chain of child Sessions a subagent's record came through, outer to inner; absent on the main Session's own records.",
          },
        },
        session_meta: {
          summary:
            "A model context opened: the model, the system prompt, the paths and the source. It is the first record on a Session's first message, and the first line of every Trace file.",
          fields: {
            session_id: "The Session's id; a later request sends it to continue.",
            provider: "The provider group of the model.",
            model_id: "The model id sent to the provider.",
            model_context_window:
              'The model\'s context window in tokens, or "unknown" when none is set.',
            system_prompt: "The assembled system prompt this context runs with.",
            agent_state: "The Agent State's absolute path.",
            workspace: "The Workspace's absolute path.",
            source:
              "What opened the Session: user, api, schedule, subagent, cli, company or workbench.",
          },
        },
        text: {
          summary: "A complete text: the user's input or the model's reply.",
          fields: {
            text: "The text.",
            sender:
              "Who wrote a user-role text: the user, a parent agent, the harness or the server. Absent means the user.",
          },
        },
        thinking: {
          summary: "The model's complete thinking.",
          fields: { thinking: "The thinking text." },
        },
        tool_call: {
          summary:
            "A complete tool call the model made. One whose Request was cut short holds the raw arguments, which may not parse, and never runs.",
          fields: { name: "The tool's name.", arguments: "The arguments, as a JSON string." },
        },
        tool_call_output: {
          summary: "A tool's result, fed back to the model.",
          fields: {
            output: "What the tool returned, as text.",
            images: "Images the tool returned, as data URLs.",
            status:
              "What the result is: completed (the tool ran to its end), fatal (the call failed) or aborted (it never ran, denied by the user, the policy or a hook, or it was interrupted while running).",
          },
        },
        image_url: {
          summary: "An image the user sent by URL.",
          fields: { image_url: "A web URL or a base64 data URL." },
        },
        inline_data: {
          summary: "Inline bytes, such as an image or audio, from the user or the model.",
          fields: { data: "The bytes, base64-encoded.", mime_type: "The bytes' media type." },
        },
        inline_thinking: {
          summary: "Thinking as inline bytes, such as an image an image model thinks with.",
          fields: { data: "The bytes, base64-encoded.", mime_type: "The bytes' media type." },
        },
        partial_text: {
          summary: "A piece of a reply as it streams.",
          fields: { text: "The text this fragment adds." },
        },
        partial_thinking: {
          summary: "A piece of thinking as it streams.",
          fields: { thinking: "The thinking this fragment adds." },
        },
        partial_tool_call: {
          summary: "A piece of a tool call as it streams.",
          fields: {
            name: "The tool's name, on the start fragment.",
            arguments: "The piece of the arguments' JSON this fragment adds.",
          },
        },
        partial_tool_call_output: {
          summary: "A piece of a tool's output as it streams.",
          fields: {
            output: "The output this fragment adds.",
            images: "Images the tool returned, carried whole by one fragment.",
          },
        },
        task_begin: {
          summary: "Opens a Task, one input's whole run; every record of the Task comes after it.",
          fields: {},
        },
        task_end: {
          summary:
            "Closes the Task. A task_begin with no task_end means the run did not reach its end.",
          fields: {},
        },
        request_begin: {
          summary: "Opens one request to the model.",
          fields: {
            thinking_level:
              "The thinking level the request went out at; absent when none was sent.",
          },
        },
        request_end: {
          summary: "Closes the request and says how it ended.",
          fields: {
            status:
              "completed, aborted (the turn was not committed), retryable (retried while attempts remain; output cut at its cap reads error_code output_truncated) or fatal; the one record of why the request ended.",
            attempt: "The attempt's number among its retries; absent on a clean first try.",
            retry_in_ms:
              "The wait before the next attempt, present only when the engine will retry.",
          },
        },
        token_usage: {
          summary: "The tokens counted for the latest request and for the Session so far.",
          fields: {
            session: "The Session's running totals.",
            "session.cache_read": "Input tokens read from the provider's cache.",
            "session.cache_write": "Input tokens written to the cache.",
            "session.output": "Output tokens, thinking included.",
            "session.total": "Every token counted.",
            request: "This request's counts.",
            "request.cache_read": "Input tokens this request read from the cache.",
            "request.cache_write": "Input tokens this request wrote to the cache.",
            "request.output": "This request's output tokens, thinking included.",
            "request.total": "Every token this request counted.",
          },
        },
        abort: {
          summary:
            "The run was stopped: the caller interrupted it, or the Task reached its turn cap.",
          fields: {
            error_code: "user_abort for an interruption, max_turns for the turn cap.",
            error_message: "The detail, such as the cap that was reached.",
            reason: "The prose cause in older Traces; read only when there is no error_code.",
          },
        },
        approval_decision: {
          summary: "The answer to a tool call that needed approval.",
          fields: {
            decision: "allow, deny, or forbidden (the project's command policy refused it).",
          },
        },
        hook: {
          summary: "What a hook answered at a hook point.",
          fields: {
            hook: "The hook point: stop, pre_tool_use or user_prompt.",
            name: "The hook's registered name.",
            decision: "continue or stop at the stop point; allow or deny before a tool call.",
            reason: "One line from the hook, for people.",
            output: "The hook's own record, scalars only.",
          },
        },
        compaction_begin: {
          summary: "The context starts being compacted.",
          fields: {
            reason: "Why: context, turns or manual.",
            mode: "summarize or discard.",
            context: "The context's tokens when it began.",
            turns: "The Session's turn count when it began.",
          },
        },
        compaction_end: {
          summary: "The compaction ended.",
          fields: {
            reason: "Why: context, turns or manual.",
            mode: "summarize or discard.",
            status:
              "completed, or how it was given up: aborted, retryable or fatal; unless completed, the original context is kept.",
            attempt: "The last attempt's number.",
          },
        },
        tool_list_ready: {
          summary: "The Session's tools as sent to the model, once its MCP servers have connected.",
          fields: {
            tools: "Every tool definition.",
            "tools[].name": "The tool's name.",
            "tools[].description": "What the tool does.",
            "tools[].parameters": "Its arguments, as a JSON Schema.",
          },
        },
        mcp_connect_begin: {
          summary: "MCP servers start connecting.",
          fields: { servers: "The servers being contacted." },
        },
        mcp_connect_end: {
          summary: "The MCP servers have connected, or some failed.",
          fields: {
            status: "completed, fatal (a server failed and was skipped) or aborted.",
            results: "One result per server.",
            "results[].server": "The server's name.",
            "results[].transport": "stdio, http or sse.",
            "results[].status": "completed, fatal or aborted.",
            "results[].duration_ms": "How long its connect and tool discovery took.",
            "results[].tools": "The tools discovered, on completed.",
            "results[].error_code":
              "Why it failed: connect_failed, mcp_needs_setup or mcp_sign_in_required.",
            "results[].error_message": "The raw failure text.",
          },
        },
        subagent: {
          summary:
            "Points the parent Session's Trace at a child Session it started; written to the Trace, not streamed.",
          fields: { session_id: "The child Session's id." },
        },
      },
    },

    quickstart: {
      title: "From zero to the first run",
      enable: {
        title: "Turn the agent's API on",
        text: "In PenguinHarness, open Agents, pick an agent, go to its API tab, switch on Enable API access, then click New key.",
        link: "Agent API guide",
      },
      run: {
        title: "Run it",
        label: "How to run it",
        typescript: "TypeScript",
        curl: "curl",
      },
      curl: {
        response: "response",
        elided: "one event per record",
      },
    },

    links: {
      title: "Read on",
      items: {
        reference: {
          name: "AMSP reference",
          text: "Every record and control frame, field by field",
        },
        records: { name: "AMSP records", text: "The payload fields of every record kind" },
        guide: { name: "Agent API guide", text: "Keys, approval modes, routes and errors" },
        npm: { name: "@prismshadow/amsp", text: "The SDK on npm, for Node 24 and browsers" },
        source: { name: "Source", text: "packages/amsp, Apache-2.0" },
      },
    },
  },
  company: {
    title: "Company mode: one lead, and you only for the calls",
    description:
      "The spec for the next company mode, with a prototype to click through: you agree goals with one lead agent, an executor and an independent verifier move each ticket along a state machine, and only blockers and final calls reach your inbox.",
    name: "Company mode",
    draft: "Draft spec",
    headline: "One lead takes the work; only verified work reaches you",
    subline:
      "The next company mode is a light, self-running organization. You talk goals with one lead agent; an executor and an independent verifier move each ticket along a state machine, the process stays folded, and only blockers and final calls reach your inbox.",
    specNote:
      "This page specifies the next company mode; implementations follow it. For the shipped version, see the ",
    currentDocs: "company mode docs",
    specEnd: ".",

    frame: {
      title: "Company mode prototype",
      startsLabel: "Which part to try",
      starts: { fresh: "Setting up", week: "Day to day" },
      open: "Open on its own",
      note: "Real controls and sample data; no agent runs behind it. Let time pass in the bottom bar to move every ticket one step; the checklist beside it keeps track of what you have tried.",
      tryTitle: "Things to try",
      tries: {
        fresh: {
          title: "Setting up: an organization from one sentence",
          text: "A company that has not opened yet. The lead looks at your machines and models, then asks what you want done.",
          items: [
            "Pick a starter card, or write your goal in a sentence",
            "Answer the three opening questions in the A2UI form: the kinds of work, the budget per ticket, the send-back limit",
            "Change something in the plan: drop a kind of work, swap a member's model, regrade an outward action",
            "Confirm and land in the inbox, with the first tickets already assigned",
          ],
        },
        week: {
          title: "Day to day: the inbox a week in",
          text: "Floe Studio, a one-person company, a week in. The inbox is grouped into your call, in progress and settled.",
          items: [
            "Answer the evaluation ticket's decision card; the answer goes to the ticket and the handbook",
            "Review a diff, experiment curves or a commented long document in its workbench, then accept or send it back",
            "Handle a breaker: the reseller agreement hit its send-back limit, the invoice check its budget",
            "Approve a merge or a publish, or open a prefilled reply and send it yourself",
            "Let time pass: watch the verifier send work back and a GitHub issue file itself",
            "Ask the lead for something new, see its proposals on the review page, roll a Skill back in the handbook",
          ],
        },
      },
      startHere: "Start here",
    },

    architecture: {
      title: "A light, self-running organization",
      subtitle:
        "One lead as the way in, execution kept apart from verification, an inbox for exceptions, a workbench per domain, and learning kept in files on two loops.",
      flowLabel: "The delivery line: day-to-day process stays folded in the background",
      machineLabel: "Ticket record and state machine: the full Trace, folded",
      nodes: {
        person: { name: "You", text: "Set the goal and the constraints" },
        lead: {
          name: "One lead agent",
          text: "Clarifies the goal, builds the team, splits the tickets, with the fewest hands",
        },
        executor: {
          name: "Executor",
          text: "Works by role and machine, delivers a result and a bill",
        },
        verifier: {
          name: "Independent verifier",
          text: "Hard gates on the server, breakers on rounds and budget",
        },
        inbox: {
          name: "Exception inbox",
          text: "Only blockers and calls get through, answered on A2UI decision cards",
        },
        workbench: {
          name: "A2APP workbench",
          text: "Review by domain: code, research, contracts",
        },
      },
      sendBack: "Fails: sent back on its own",
      toInbox: "Passes, or blocks",
      evolveLabel:
        "Learning in files, on two loops: rules, lessons and Skills are local files you can audit and roll back",
      feedback: {
        rules: "Rules and Skills keep updating",
        lessons: "Send-back lessons and bills",
        calls: "Your calls and reviews",
      },
      inner: {
        name: "Inner loop: local, every day",
        text: "Your calls go into the handbook. Each send-back becomes a lesson that updates the member's own Skill, snapshotted first. The lead reviews first-pass rate, rework and cost per ticket on a schedule and proposes tickets to improve the process.",
      },
      outer: {
        name: "Outer loop: public benchmarks",
        text: "Organization templates, working rules and open-model line-ups scored side by side on the Shared RSI Community's public benchmarks and leaderboard.",
      },
      whyTitle: "What went wrong in the first version, and the answer here",
      head: { problem: "First version", answer: "This version" },
      why: [
        {
          problem:
            "Discussion was scattered across long, dense group threads. Step away for a coffee and there were 99+ unread, with no telling what was stuck or which call was yours.",
          answer:
            "No all-hands chat. Tickets move on a state machine; only blockers, breakers and calls reach the inbox.",
        },
        {
          problem:
            "Roles multiplied, rules lived only in prompts, and agents drifted into doing their own thing.",
          answer:
            "1 lead, 1 to 3 executors and 1 verifier by default. Nothing unverified is released, and the server enforces the send-back and budget limits.",
        },
        {
          problem: "Each kind of work was reviewed somewhere different.",
          answer:
            "A ticket carries the assignment, the status and the approvals; review happens in a workbench made for the domain.",
        },
        {
          problem:
            "Assignment and hand-offs waited for scheduled patrols, hand-edited files synced on a 30-second poll, and nothing outside could file a ticket.",
          answer:
            "A GitHub issue, an outside message or a callback files a ticket as it arrives, and a change to a ticket wakes whoever holds it.",
        },
      ],
    },

    borrow: {
      title: "What we borrow",
      subtitle:
        "T3 Code, Lody, Raft, Multica and Grok Bot, each run on real work. The mechanisms that ran best, taken apart and rebuilt on what PenguinHarness already has.",
      head: { from: "From", what: "What we take", how: "How it lands in PenguinHarness" },
      where: "In the prototype: ",
      items: [
        {
          from: "T3 Code",
          what: "Status grouping, highlighted drafts, approvals on the phone",
          how: "The inbox groups tickets into your call, in progress and settled, and highlights unsent drafts; push approvals reach phones in China directly, with no proxy.",
          where:
            "The inbox's three groups in the left column; start a send-back note on a ticket without sending it and its row is highlighted.",
        },
        {
          from: "Lody",
          what: "Roles bound to machines, guardrails, execution apart from verification",
          how: "With the existing SSH machines and plugin market, role + machine + permissions become an organization template pack you import and export in one click; the delegation depth limit and loop guard live on the server.",
          where:
            "Each member's machine, model and permissions on the Team page, with import and export at the top right.",
        },
        {
          from: "Raft",
          what: "Structured decision cards, comments on long documents, a guided start",
          how: "A2UI, read-only in channels today, becomes a decision card you click and submit, written straight back to the ticket; long deliverables such as plans and papers get versions and per-paragraph comments; a lead who knows the product walks you through the start.",
          where:
            "The three opening questions, and the decision card on a blocked ticket; the release post's workbench.",
        },
        {
          from: "Multica",
          what: "One lead, a state machine, results and bills up front, an inbox",
          how: "One lead builds the team and splits the work; nothing unverified is released and the round and budget breakers are hard gates on the server; the full Trace keeps the process log folded by default.",
          where:
            "The status bar, budget and send-back progress at the top of a ticket; the bill and folded log under Runs.",
        },
        {
          from: "Grok Bot",
          what: "Lean staffing, prefilled drafts for outward actions, event triggers",
          how: "The fewest hands by default; posts, emails, merges and large experiments all go through prefilled drafts and graded approval cards; tickets move on events, GitHub issues, outside messages and callbacks.",
          where:
            "Outward grades and trigger switches on the Rules page; the event tickets that appear as time passes.",
        },
      ],
    },

    scope: {
      title: "Where it stops",
      subtitle: "Two kinds of need, pulled apart first, then four things it will not do.",
      split: {
        title: "Two kinds of need, two forms",
        items: [
          {
            name: "A self-running delivery organization: this mode",
            text: "For one-person companies, software maintenance, research and vertical operations. You agree the goal with the lead; once it is a ticket, an executor and an independent verifier move it along the state machine, and it reaches your inbox only for a call or a review.",
          },
          {
            name: "A mirror of a real company: built separately",
            text: "Team members and their digital twins wired into Feishu, WeChat or Telegram to relay messages, answer questions and look things up in a shared handbook. It needs a chat window, so it becomes its own mode or an official plugin and stays out of this mode's tickets and context.",
          },
        ],
      },
      out: {
        title: "Not doing",
        items: [
          {
            name: "A shell around coding tools",
            text: "Branch isolation and PR diffs are optional abilities of a development plugin; they do not set the mode's shape, or research, contracts and finance would be left outside.",
          },
          {
            name: "An all-hands chat",
            text: "A chat room suits quick talk. Run cross-week delivery in one and to-dos slip, context swells, and the low cost of open models is burned for nothing. Channels step back; tickets and the inbox take the stage.",
          },
          {
            name: "A black box",
            text: "Models, skills, permissions and runs are local files you can read and change, which is what private audits and self-improvement build on.",
          },
          {
            name: "Unlimited send-backs, or a big-company org chart",
            text: "One run burning 47M tokens is lesson enough: round and budget limits are hard stops on the server. No CEO, HR, finance or VP by default either; a handsome org chart does not get the work done.",
          },
        ],
      },
      later: {
        title: "Where it could go",
        items: [
          {
            name: "Outside CLIs as an optional way to run",
            text: "Each lab's strongest model tends to do best in its own harness. Keep the native base, and let a role call Claude Code or Codex when it needs to. Today the plugin market has only use-claude-code, which drives Claude Code over SSH.",
          },
        ],
      },
    },

    problems: {
      title: "Two problems no product has solved",
      subtitle:
        "None of the five got these right, and they are the two places PenguinHarness's native base is best placed to fill.",
      workbench: {
        title: "General tickets or expert review",
        text: "Coding tools review diffs and merge PRs well and can do little else; general tickets hold anything and fall short when it comes to expert review. Here a ticket carries only the assignment, the status and the approvals; expert review happens in an A2APP workbench the organization builds per domain, one click from the ticket.",
        head: { kind: "Workbench", accept: "What you review in it" },
        workbenches: {
          code: "The diff and the checks, then merge the PR in one click",
          experiment:
            "Experiment curves, the metrics side by side, the reproduction with other seeds",
          document: "Versions and per-paragraph comments; a comment sends it back",
          ledger: "Contract clauses and reconciled invoices, with a prefilled email out",
          outreach: "Prefilled replies and emails that you open and send yourself",
        },
      },
      evolution: {
        title: "Getting steadier as it runs",
        text: "A file-based design splits naturally into two loops. Day to day nothing is scored: it learns from your calls, send-backs and answers. To compare with other organizations, take the template to the community's benchmarks.",
        loops: [
          {
            title: "Inner loop: local, every day",
            when: "Automatic, with a snapshot before every change",
            items: [
              "Every call on a decision card goes into the handbook, and the same question is not asked again.",
              "Every send-back becomes a lesson that updates the member's own Skill, which you can roll back.",
              "The lead reviews first-pass rate, rework and cost per ticket on a schedule and proposes tickets to improve the process; nothing changes until you accept.",
            ],
          },
          {
            title: "Outer loop: public benchmarks",
            when: "Optional; you decide whether to take part",
            items: [
              "Export the roles, machines, permissions and working rules as an organization template.",
              "Score it on the Shared RSI Community's public team-delivery scenarios, against other templates and model line-ups.",
              "Only public scenarios are used; your tickets and handbook are never uploaded.",
            ],
          },
        ],
        metrics: {
          title: "What a review reads",
          head: { metric: "Measure", trend: "Expected direction" },
          items: [
            { metric: "Share passing verification first time", trend: "Up" },
            { metric: "Send-backs", trend: "Down, with repeats of known lessons near 0" },
            { metric: "Tokens and cost per finished ticket", trend: "High early, then down" },
          ],
          note: "Every number comes from the ticket files. A review states counts, such as 2 of 10 sent back, not only percentages.",
        },
      },
    },

    invariants: {
      title: "Hard gates on the server",
      subtitle:
        "Skills and the handbook are guidance a member may not follow. These the server enforces, and an implementation is tested against them.",
      refusal: "Refused with ",
      shipped: "Shipped",
      added: "New",
      items: {
        files_are_truth:
          "Files are the only source of truth: tickets, the handbook and Skills are files in the Project, and the database holds only caches it can rebuild.",
        owner_moves:
          "Only a ticket's holder in its current status moves it: the executor delivers, the verifier passes or sends back, you make the call.",
        one_lead:
          "Only the lead files and assigns tickets; new work comes in through the lead, and there is no all-hands channel.",
        verified_first:
          "Work that has not passed an independent verifier never reaches your inbox and cannot be accepted.",
        verifier_apart:
          "The verifier is never the executor; it checks with a read-only token and cannot pass its own work.",
        rounds_capped:
          "At the send-back limit, no more send-backs: the server halts the ticket and asks you for one more round, your own call, or a stop.",
        budget_capped:
          "At the ticket's budget, the work stops: the server halts it and asks you whether to add budget or stop.",
        outward_approved:
          "Outward actions such as replies, merges, publishing, emails and large experiments come first as a prefilled draft or an approval card by grade, and the server runs them only once you approve.",
        delegation_bounded:
          "Delegation goes at most two levels deep (lead, executor, one helper) and never points back at a ticket above it.",
        exceptions_only:
          "Only blockers, breakers and calls reach the inbox; process logs and the Trace stay folded by default.",
        answer_written:
          "An answer on a decision card is written to the ticket before it goes back to the session that asked; a ticket has one open question at a time.",
        events_wake:
          "A GitHub issue, an outside message or a callback files a ticket as it arrives, and a change to a ticket wakes its holder without waiting for a poll.",
        snapshot_first:
          "A member's Skill or model is snapshotted before it changes, so it can be rolled back.",
      },
    },

    ticket: {
      title: "The ticket file, field by field",
      subtitle:
        "A ticket is one Markdown file in the Project; the state machine, the gates and the inbox all read it. The last column marks what the first version lacks.",
      example: "Example: an evaluation ticket stopped on a decision",
      exampleFile: `---
title: "Evaluate an open model for summaries"
status: working
owner: agent:adelie
verifier: agent:chinstrap
source: user
workbench: experiment
budget: {usd: 6, spent: 2.00}
rounds: {limit: 2, used: 0}
ask:
  question: The candidate is 3 points behind on long documents and the prompt is still being tuned. How should we confirm?
  options: [Long documents only, The full evaluation, Stop]
  recommended: 0
outward: {action: experiment, grade: review}
runs:
  - {by: agent:adelie, model: qwen3.8-max, tokens: 412000, cache: 0.71, usd: 1.40}
  - {by: agent:adelie, model: qwen3.8-max, tokens: 168000, cache: 0.83, usd: 0.60}
history:
  - {at: 2026-11-20T09:02:11+08:00, by: agent:lead, action: created}
  - {at: 2026-11-20T09:02:12+08:00, by: system, action: assigned, note: agent:adelie}
  - {at: 2026-11-20T11:40:05+08:00, by: agent:adelie, action: asked}
---

## Goal
Summaries cost $1.84 per 1,000 calls today. Find out whether DeepSeek V4 Flash can take over within 1 point of quality.

## Acceptance criteria
- Overall accuracy within 1 point of the model in use
- Long documents reported separately, reproduced by the verifier with other seeds

## Review

## Decisions

## Result
`,
      groups: {
        frontmatter: "Frontmatter",
        sections: "Sections",
      },
      head: {
        field: "Field",
        required: "Required",
        writers: "Written by",
        meaning: "Meaning",
        state: "New?",
      },
      required: "Required",
      optional: "Optional",
      shipped: "Shipped",
      added: "New",
      writers: { person: "Person", agent: "Agent", server: "Server" },
      join: ", ",
      waitTitle: "When it comes to you",
      waitText:
        "Waiting on you is not a status. It is read from the fields, taking the first rule below that holds. The inbox groups by it too: what waits on you under your call, the rest still open under in progress, finished or stopped under settled.",
      waits: { accept: "To accept", halt: "Halted", ask: "To answer", decide: "To review" },
      fields: {
        title: "One-line title, shown in the inbox.",
        status:
          "The state machine's current status; each status has one holder: you for proposed and your call, the executor while working, the verifier while verifying.",
        owner: "The executor, assigned by the lead from the ticket's workbench.",
        verifier: "The independent verifier, never the same as the executor.",
        source:
          "Where the ticket came from: you, the lead, an outside event, a patrol, or a review proposal.",
        workbench: "Where it is reviewed: code, experiment, document, ledger or outreach.",
        budget:
          "How many dollars the ticket may spend and has spent. The server counts spending from the Trace and halts at the cap.",
        rounds:
          "How many times the verifier may send it back and has; the server halts at the cap.",
        ask: "The open question, as an A2UI form: options, a recommendation and an optional note. Removed once answered.",
        halt: "Why the server halted it: budget or send-backs. Removed once you choose.",
        outward:
          "The outward action to run once accepted, its approval grade and its prefilled draft.",
        runs: "Each run's member, model, tokens, cache hits and cost; the bill adds them up.",
        history: "The log of actions in time order: who did what, when.",
        "## Goal": "What to achieve.",
        "## Acceptance criteria": "What the verifier checks against.",
        "## Review":
          "The verifier's notes and yours, round by round; send-back reasons become lessons.",
        "## Decisions": "Questions from decision cards and your answers.",
        "## Result": "What was delivered and where the outputs are.",
      },
    },
  },
};
