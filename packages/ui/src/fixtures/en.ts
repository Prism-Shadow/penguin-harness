/**
 * The English dataset. Chrome copy follows the web app's `strings-en.ts` so a mock-up reads
 * like the product; the session prose follows the landing page's capture script.
 *
 * The type specimens mix in a short CJK run on purpose: they exist to show where a Latin face
 * hands over to the CJK fallback, and an all-Latin English specimen would hide that seam.
 */
import { buildFixtures } from "./dataset";
import type { Fixtures } from "./types";

export const en: Fixtures = buildFixtures("en", {
  copy: {
    appName: "PenguinHarness",
    nav: {
      newChat: "New chat",
      agents: "Agents",
      plugins: "Plugin library",
      models: "Models",
      usage: "Cost Center",
      benchmark: "Evaluation Center",
      traces: "Trajectories",
      files: "Files",
      sessions: "Sessions",
      collapseSidebar: "Collapse sidebar",
      search: "Search chats",
      filterSessions: "Filter and sort",
      newFolder: "New folder",
    },
    chat: {
      runStates: {
        running: "Running",
        waiting: "Needs approval",
        done: "Done",
        failed: "Failed",
        stopped: "Stopped",
      },
      running: "Running",
      done: "Done",
      attach: "Attach files",
      steps: (n) => `${n} ${n === 1 ? "step" : "steps"}`,
      thinking: "Thinking",
      approvalWaiting: "awaiting approval",
      decisionAllow: "Approved",
      decisionAuto: "auto",
      sendToBackground: "Send to background",
      subagent: "Subagent",
      toolAliases: {
        read_file: "read",
        write_file: "write",
        edit_file: "edit",
        exec_command: "exec",
        input_command: "follow",
        run_subagent: "subagent",
        input_subagent: "communicate",
      },
      backgroundCall: "[Background]",
      inputPlaceholder: "Type a message. Enter to send, Shift+Enter for newline, paste images",
      slashHint: "Type / for commands",
      approvalModes: {
        "allow-all": "Approve everything",
        "read-only": "Approve read-only",
        "deny-all": "Deny everything",
        "always-ask": "Ask every time",
      },
      thinkingLevels: { low: "low", medium: "medium", high: "high" },
      skills: "Skills",
      stop: "Stop",
      copy: "Copy message",
      fork: "Fork chat from here",
      approve: "Allow",
      deny: "Deny",
    },
    dock: {
      subagents: (n) => `Subagents (${n})`,
      topology: "Call graph",
      nodeRunning: "running",
      nodeDone: "done",
      openAsSession: "Jump to this session",
      newPanel: "Add panel",
      movePanel: "Move panel to the other edge",
      bottomDock: "Bottom panels",
      rightDock: "Right panels",
      close: "Close",
    },
    traces: {
      filesTitle: "Trace files",
      export: "Export",
      overall: "Overall",
      turns: "Turns",
      toolCalls: "Tool calls",
      compactions: "Compactions",
      inputTokens: "Input tokens",
      cacheHits: "Cache hits",
      outputTokens: "Output tokens",
      cost: "Cost",
      elapsed: "Elapsed",
      outputTps: "Output TPS",
      turn: (n) => `Turn ${n}`,
      timeline: "Execution timeline",
      modelLane: "Model",
      legend: {
        thinking: "thinking",
        text: "model reply",
        toolgen: "tool call gen",
        approvalWait: "approval wait",
        exec: "tool exec",
        other: "Other",
      },
      zoom: "Zoom",
      messages: "Messages",
      fromSubagent: "Subagent",
    },
    settings: {
      title: "Settings",
      groupPersonal: "Personal",
      groupServer: "Server",
      pages: {
        profile: "Profile",
        general: "General",
        appearance: "Appearance",
        account: "Account",
        proxy: "Proxy options",
        uploads: "Upload limits",
        company: "Company mode",
        users: "Users",
      },
      theme: "Theme",
      themeInfo: "Light or dark look of the app.",
      light: "Light",
      dark: "Dark",
      system: "System",
      terminalTheme: "Terminal theme",
      terminalThemeInfo: "Colors of the terminal panel; follows the app theme by default.",
      followApp: "App",
      fontSize: "Font size",
      fontSizeInfo: "Overall interface font size.",
      fontSizes: { sm: "S", md: "M", lg: "L" },
      accent: "Accent",
      accentInfo: "Interface accent color.",
      launcher: "Shortcuts launcher",
      launcherInfo:
        "The round button floating on the conversation's right edge that fans out shortcuts to the workbench's panels and the terminal.",
      toolAliases: "Tool short names",
      toolAliasesInfo:
        'Tool cards in a conversation name the built-in tools by a short alias: read_file reads as "read".',
      moreInfo: "More info",
      close: "Close",
    },
    auth: {
      username: "Username",
      password: "Password",
      signIn: "Sign in",
      showPassword: "Show password",
      defaultAdminNote:
        "First run: the server prints a first-login link in its startup output — open it to claim the built-in admin “admin” and set a password. No initial password exists to type here",
      forgotAdminNote:
        "Forgot the admin password? Stop the server and run penguin server reset-admin-password to issue a fresh initial one",
      language: "Language",
      langZh: "中文",
      langEn: "English",
    },
  },
  userName: "alex",
  agents: {
    default: {
      name: "Penguin",
      description: "The general-purpose Agent every Project starts with",
    },
    reviewer: {
      name: "Docs Reviewer",
      description: "Reads rendered docs and reports dead links and wrong citations",
    },
  },
  session: {
    title: "Build Claude Code docs expert",
    turn1: {
      prompt:
        "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG app that answers Claude Code questions as a configuration expert, citing its sources.",
      thinking1:
        "One sentence is enough — the **penguin-sdk** skill has the full recipe: collect the corpus, build a BM25 index, answer through a Session with `[n]` citations linking to the originals.",
      text1: "Collecting the docs into the corpus first:",
      collectDescription: "Clone the docs and keep only the Markdown",
      thinking2:
        "Corpus in place. Now the app: local BM25 retrieval (no embedding credential), cited answers, and a Penguin-style chat UI with citations linking to `/corpus` originals.",
      text2: "Corpus ready — now the retrieval and cited-answer entry:",
      appDescription: "Write the BM25 retrieval app",
      answer: `The Claude Code docs expert is ready:

{tree}

| Part | What it does |
| --- | --- |
| Retrieval | A local BM25 index over every doc chunk, Chinese questions included |
| Answers | Each question streams through a Session, with [1][2] citations linking to the \`corpus/\` originals |
| UI | A Penguin-style chat page with example questions in the empty state |

Run \`{run}\`, then open {url}.`,
    },
    turn2: {
      prompt:
        "Make sure every [n] citation opens a real file under corpus/, add a test for it, and run the suite.",
      thinking:
        "Hits come straight from the index, so a file deleted after indexing would still be cited. Filter the hits **before** they reach the prompt, then add a `node:test` file with two questions: one that matches, one that cannot.",
      editDescription: "Drop hits whose source file no longer exists",
      writeDescription: "Add the citation test",
      text: "Citations are filtered now. Running the suite, and asking the reviewer to check the renderer in parallel:",
      thinking2:
        "The tests hit the API and the review only reads HTML — independent, so both can run at once.",
      reviewDescription: "Check how citations render in index.html",
      reviewPrompt:
        "Read claude-code-expert/public/index.html and check that every [n] marker in a streamed answer becomes a link to its source under /corpus. Report anything that would render a dead link.",
      testDescription: "Start the app and run the citation tests",
      reviewThinking:
        "The markers are rewritten client-side, so the whole question is what `linkify()` does with `sources` — and when `sources` arrives.",
      reviewReadDescription: "Read the chat page",
      reviewReply:
        "`linkify()` links a marker only when `sources[n - 1]` exists, so a marker past the last source stays plain text — good. One gap: `sources` arrives after the last delta, so while the answer streams every `[n]` is plain text, and the links appear only once the",
    },
    draft: "Also add a test that asks in Chinese",
  },
  sidebar: {
    groupWorkspace: "claude-code-expert",
    groupEarlier: "Previous 7 days",
    now: "now",
    rows: {
      tokenizer: { title: "Fix flaky BM25 tokenizer test", time: "2h" },
      hooks: { title: "Review hooks.md citations", time: "5h" },
      trace: { title: "Why did turn 3 miss the cache?", time: "Yesterday" },
      weekly: { title: "Weekly docs sync", time: "Sep 12" },
      deploy: { title: "Package the app as a Docker image", time: "Sep 10" },
    },
  },
  modelNotes: {
    "deepseek-v4-pro": "Project default · off-peak discount",
    "claude-opus-5": "Vision · 1M context",
    "gpt-5.6-luna": "Lowest price with vision",
  },
  notesFileName: "NOTES.md",
  company: {
    orgName: "Docs Expert Co.",
    mission: "Keep the Claude Code docs expert accurate, cited and fast for every question.",
    employees: {
      ceo: { name: "Ada", title: "CEO" },
      eng: { name: "Rui", title: "RAG engineer" },
      docs: { name: "Mina", title: "Docs curator" },
      qa: { name: "Theo", title: "QA lead" },
      ops: { name: "Sol", title: "Release ops" },
    },
    tickets: {
      citations: { title: "Every [n] citation must open a real corpus file" },
      tokenizer: { title: "Fix the flaky BM25 tokenizer test" },
      zhQueries: { title: "Answer questions asked in Chinese" },
      deploy: {
        title: "Package the app as a Docker image",
        blocked: "Waiting for the citation fix to land",
      },
      evalSet: { title: "Build a 50-question evaluation set" },
      cache: { title: "Keep the system prompt cache-stable" },
      pdf: { title: "Ingest the PDF release notes" },
      readme: { title: "Quick-start section in the README" },
    },
    events: {
      standup: {
        title: "Daily stand-up",
        prompt: "Read yesterday's ticket changes and post a three-line summary to the group chat.",
      },
      triage: {
        title: "Ticket triage",
        prompt: "Sort new tickets by priority and give each one an owner.",
      },
      review: {
        title: "Code review",
        prompt: "Review every ticket in the Review column and move it on or send it back.",
      },
      evalRun: {
        title: "Evaluation run",
        prompt: "Run the 50-question evaluation set and attach the score to its ticket.",
      },
      retro: {
        title: "Weekly retro",
        prompt: "Write what went well, what did not, and one change to try next week.",
      },
      report: {
        title: "Spend report",
        prompt: "Post this week's spend per employee against their budget.",
      },
    },
  },
  notices: {
    byTone: {
      success: { title: "Trace exported", body: "48.2 KB written to trace-001.jsonl." },
      attention: {
        title: "A command needs approval",
        body: "exec · Start the app and run the citation tests.",
        action: "Review",
      },
      danger: {
        title: "Couldn't reach the model provider",
        body: "DeepSeek returned 503 twice; the turn stopped after the second try.",
        action: "Retry",
      },
      done: { title: "Turn 1 finished", body: "7 tool calls, 43.8k tokens, $0.0231." },
      neutral: {
        title: "Tool short names are on",
        body: "Tool cards print read, write and exec; the Trace keeps the full names.",
      },
      info: {
        title: "A newer release is available",
        body: "0.2.14 adds the Cost Center's per-model breakdown.",
        action: "See what changed",
      },
    },
    toasts: [
      { tone: "success", title: "Model added", body: "DeepSeek V4 Flash is ready to use." },
      {
        tone: "danger",
        title: "Couldn't save the key",
        body: "The provider rejected it: 401.",
        action: "Retry",
      },
    ],
  },
  forms: {
    title: "Add a model provider",
    description: "Models from this provider join the catalog for every Project.",
    fields: [
      {
        name: "provider",
        label: "Provider",
        kind: "select",
        value: "OpenRouter",
        options: ["OpenRouter", "DeepSeek", "Anthropic", "OpenAI"],
      },
      {
        name: "baseUrl",
        label: "Base URL",
        kind: "text",
        value: "openrouter.ai api/v1",
        error: "Enter a host and a path, like openrouter.ai/api/v1.",
      },
      {
        name: "apiKey",
        label: "API key",
        kind: "password",
        value: "••••••••••••••••••••",
        hint: "Stored encrypted on the server; never shown again.",
      },
      {
        name: "notes",
        label: "Notes",
        kind: "textarea",
        value: "Team key for the docs expert. Rotate every 90 days.",
      },
      {
        name: "proxy",
        label: "Proxy",
        kind: "text",
        value: "http://127.0.0.1:7890",
        hint: "Set by the server's proxy policy.",
        disabled: true,
      },
    ],
    errorSummary: "Fix the field above to continue.",
    submit: "Add provider",
    cancel: "Cancel",
    swatchLabels: ["Theme default", "Blue", "Green", "Violet", "Rose", "Amber"],
  },
  menus: {
    copy: "Copy message",
    fork: "Fork chat from here",
    export: "Export as Markdown",
    delete: "Delete message",
  },
  vault: {
    deepseek: { kind: "API key", updated: "Sep 14" },
    openrouter: { kind: "API key", updated: "Sep 12" },
    github: { kind: "Token", updated: "Sep 9" },
    slack: { kind: "Webhook", updated: "Aug 30" },
    proxy: { kind: "Password", updated: "Aug 21" },
    s3: { kind: "Secret", updated: "Aug 3" },
  },
  plugins: {
    sdk: { description: "Build apps on the PenguinHarness SDK" },
    docsReview: { description: "Check rendered docs for dead links and citations" },
    github: { description: "Issues, pull requests and reviews over MCP" },
    slackNotify: { description: "Post a message when a Task finishes" },
  },
  palette: {
    groups: { commands: "Commands", sessions: "Recent chats" },
    commands: {
      newChat: "New chat",
      switchModel: "Switch model",
      settings: "Open settings",
      search: "Search chats",
    },
    hints: {
      newChat: "Start a Session with the Project's Agent",
      switchModel: "Compact this context and continue on another model",
      settings: "Appearance, account and server options",
      search: "Titles and message text",
    },
    sessions: [
      { title: "Build Claude Code docs expert", hint: "now" },
      { title: "Review hooks.md citations", hint: "5h" },
    ],
  },
  usage: {
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    buckets: { cacheRead: "Cache read", cacheWrite: "Cache write", output: "Output" },
  },
  specimens: {
    display: "Agents that cite their sources",
    heading: "Prompt cache hit 81% across 2 turns",
    paragraph:
      "PenguinHarness ran the claude-code-expert Session for 1m12s on DeepSeek V4 Pro: 43.8k tokens, $0.0231 and 7 tool calls. The BM25 index covers 214 Markdown files, so even a question asked as “如何配置 hooks？” still cites corpus/claude-code-docs/hooks.md [1].",
    ui: "Running · 6 steps · 34s — read_file …/src/rag.ts (421ms) · edit_file +3 −1 · $0.0110",
    caption: "Last synced 2026-09-14 14:02 (UTC+8) · 48.2 KB · Trace #001",
    code: `// A citation must open a real file (引用必须指向真实文件)
const hits = rank(question).slice(0, 6).filter((c) => fs.existsSync(c.source));
console.log(\`\${hits.length} hits in \${(performance.now() - t0).toFixed(1)}ms\`); // 6 hits in 12.4ms`,
    numerals: "0123456789 · 1,048,576 tokens · $0.0231 · 71.8s · 99.95% · 3 × 4 = 12 · v0.2.13",
  },
});
