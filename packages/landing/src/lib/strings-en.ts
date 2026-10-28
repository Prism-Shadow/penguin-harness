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
    release0217:
      "PenguinHarness 0.2.17: Agent API record streams, charts and forms — see release notes",
    penguinGo: "Penguin Go official Token packs are live: 50% off every Gemini model",
  },

  nav: {
    home: "Home",
    blog: "Blog",
    download: "Download",
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
    positioning: "Software that keeps growing. Evolution within reach.",
    subtitle: "Free and Stable RSI Framework",
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
      title: "Observable self-evolution",
      text: "Benchmarks covering six kinds of capability score every version of an agent, with cost and duration recorded beside the score; each agent and model gets its own line, making the better version plain to see.",
      link: "About the Evaluation Center",
      frame: "A Benchmark in the Evaluation Center (live demo)",
    },
    toolkits: {
      title: "State-of-the-art self-evolution algorithms for higher accuracy, lower cost",
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
    trendsNote: "The scoreboard records each version's score, cost and duration.",
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
};
