/**
 * English gallery chrome copy, constrained by `GalleryStrings` to the shape of the Chinese
 * dictionary in strings.ts. The Foundations module's titles come from the module file and
 * catalog.ts themselves; the surfaces are named here, as in the Chinese dictionary.
 */
import type { GalleryStrings } from "./strings";

export const en: GalleryStrings = {
  brand: {
    title: "Penguin UI",
  },
  site: {
    home: "Home",
    surfaces: "Surfaces",
    foundations: "Foundations",
    fonts: "Fonts",
    pages: "Pages",
    search: "Search surfaces",
    searchShortcut: "Ctrl K",
    noMatches: "No surface matches.",
    nav: "Surfaces",
    onThisPage: "On this page",
    settings: "View settings",
    menu: "Open the menu",
    closeMenu: "Close the menu",
    notFound: (id) => `There is no page named “${id}”.`,
    allSurfaces: "All surfaces",
    feedbackTitle: "Feedback",
    feedbackBody:
      "Quote the breadcrumb at the end of a frame's toolbar, or copy the page's address with the link button.",
    feedbackExample: "Frost › Chat · dark",
  },
  surfaceGroups: {
    conversation: "Conversation",
    workbench: "Workbench",
    resources: "Resources",
    measure: "Measure",
    system: "System",
  },
  surfaces: {
    chat: {
      title: "Chat",
      description:
        "A finished Task: thinking, three tool calls, a diff, and a Markdown answer with a table and code.",
      how: "Sidebar › any row of the session list.",
    },
    "chat-running": {
      title: "Chat · tool running",
      description:
        "A Task mid-run: a command is executing, and the tool row shows the running state and its timer.",
      how: "Sidebar › a session row with the running mark.",
    },
    "chat-thinking": {
      title: "Chat · thinking",
      description:
        "A Task mid-run: the model is thinking; the thinking row shows the running state and the text keeps growing.",
      how: "Sidebar › a session row with the running mark.",
    },
    "chat-approval": {
      title: "Chat · awaiting approval",
      description:
        "A Task waiting on a human: a command needs approval; allow or deny it and the Task carries on and ends.",
      how: "Sidebar › a session row with the approval mark.",
    },
    "chat-new": {
      title: "New chat",
      description:
        "The draft page: pick the Agent, Workspace, approval mode and model, then type and send the first message.",
      how: "Sidebar › New chat.",
    },
    agents: {
      title: "Agents",
      description:
        "The Agent list: each Agent's activity curve and its session, tool, Skill and schedule counts.",
      how: "Sidebar › Agents.",
    },
    "agent-settings": {
      title: "Agent settings",
      description:
        "One Agent's settings page: overview, prompt, memory, runtime, tools, Skills, hooks, Vault and schedule tabs.",
      how: "Agents › any Agent.",
    },
    schedules: {
      title: "Schedules",
      description:
        "The Agent settings' schedule tab: periods, next fire time, the bound Session and model.",
      how: "Agents › Agent settings › the Schedules tab.",
    },
    plugins: {
      title: "Plugins",
      description:
        "The plugin library by category, with search and filters; installed Skills and hooks per Agent.",
      how: "Sidebar › Plugins.",
    },
    "plugin-detail": {
      title: "Plugin detail",
      description:
        "One plugin's page: its description, the Skills it brings, its file browser and the install action.",
      how: "Plugins › any plugin.",
    },
    models: {
      title: "Models",
      description:
        "The model table by provider: the default model, credentials, prices, context windows and usage.",
      how: "Sidebar › Models.",
    },
    machines: {
      title: "Machines",
      description:
        "This machine and remote ones: install state, connections, probe results, and adding an ssh host.",
      how: "Sidebar › Machines (admins only).",
    },
    usage: {
      title: "Cost center",
      description:
        "Thirty days of usage: Tokens, cost, requests and success rate, grouped by date, Agent, model or Session, with the error panel.",
      how: "Sidebar › Cost center.",
    },
    benchmark: {
      title: "Evaluation center",
      description:
        "The Benchmark list: published and draft status, case counts, and the score trend across evaluations.",
      how: "Sidebar › Evaluation center.",
    },
    "benchmark-detail": {
      title: "Benchmark detail",
      description:
        "One Benchmark: the score curve, each evaluation's case scores, and the cases' statement and rubric files.",
      how: "Evaluation center › any Benchmark.",
    },
    settings: {
      title: "Settings",
      description:
        "The settings dialog: profile, general, appearance (theme, mode, accent, text size, fonts), account, and the server settings.",
      how: "The account menu at the bottom of the sidebar › Settings.",
    },
    "settings-appearance": {
      title: "Appearance settings",
      description:
        "The settings dialog on its Appearance page: theme, mode, accent, the five text sizes and the font pairing — where theme switching lives.",
      how: "The account menu at the bottom of the sidebar › Settings › Appearance.",
    },
    login: {
      title: "Login",
      description:
        "The sign-in page: the login card over the decorative canvas. Any password signs the demo account in.",
      how: "Any address while signed out.",
    },
  },
  home: {
    eyebrow: "Surface gallery",
    title: "Penguin UI",
    lead: "The real Web App, running in three themes, two modes, five text sizes, the font pairings and two languages — on an in-browser demo API, fully clickable.",
    app: "The app",
    appLead:
      "This is the app itself: the sidebar, every center, the chat and the settings all open. The theme and size controls drive the app in the frame; sending a message streams a scripted reply.",
    index: "Surface index",
    indexLead: "One page per surface: the app opened on it, comparable across the three themes.",
    foundations: "Foundations and fonts",
    foundationsLead:
      "The boards of the token vocabulary, and the bundled faces, specimens and licences.",
  },
  rail: {
    theme: "Theme",
    themeNames: { github: "Primer", modern: "Frost", geek: "Console" },
    mode: "Mode",
    accent: "Accent",
    accentTheme: "Theme's own",
    size: "Size",
    sizeNames: { xs: "XS", s: "S", m: "M", l: "L", xl: "XL" },
    sizeTitle: (name, px) => `${name} · ${px}px root`,
    fontLatin: "Latin font",
    fontCjk: "CJK font",
    fontTheme: "Theme default",
    fontSystem: "System",
    language: "Language",
    viewport: "Viewport",
    viewports: { desktop: "Desktop", phone: "Phone" },
    langNames: { en: "EN", zh: "中文" },
    modes: { light: "Light", dark: "Dark", system: "System" },
    compare: "Compare themes",
  },
  readout: {
    label: "Fonts in use",
    latin: "Latin",
    cjk: "CJK",
    mono: "Mono",
    pending: "Reading…",
  },
  crumb: {
    modes: { light: "light", dark: "dark" },
    phone: "phone",
  },
  intro: {
    resolving: "Resolving tokens…",
    problems: "Module and demo problems",
  },
  frame: {
    open: "Open standalone",
    reload: "Reload",
    compare: "Compare themes",
    compareOn: "Leave compare",
    frameOf: (theme) => `The app in ${theme}`,
    how: "Where it is in the app",
    route: "Route",
    signedOut: "signed out",
  },
  section: {
    copyLink: "Copy link",
    copied: "Copied",
    copyBreadcrumb: "Copy breadcrumb",
    parts: "Parts",
    tokens: "Tokens",
    source: "Source",
    variants: "Variants",
    tokensIn: (where, count) => `${count} tokens read, resolved in ${where}`,
    noTokens: "This board reads no tokens.",
    unset: "unset",
    loadingCode: "Loading source…",
    partsOf: (count) => `${count} ${count === 1 ? "part" : "parts"}`,
    noParts: "This module lists no parts.",
    replaces: (what) => `replaces ${what}`,
  },
  foundations: {
    surfaces: "Surfaces",
    inks: "Inks",
    lines: "Lines",
    inkWords: ["Text", "Muted", "Subtle"],
    accent: "Accent",
    presetsHint:
      "The theme's own accent and the five presets this theme lists; another theme's presets paint nothing here",
    themeAccent: "theme",
    sampleSend: "Send",
    selectedRow: "Selected",
    sampleLink: "Open the docs",
    linkHover: "hover",
    tones: "Tones",
    toneWords: {
      success: "Running",
      attention: "Waiting",
      danger: "Failed",
      done: "Done",
      neutral: "Idle",
      info: "Syncing",
    },
    charts: "Chart series",
    tokenSeries: "Token mix",
    code: "Code and diff",
    codeLines: {
      before: "const hits = rank(q).slice(0, ",
      removed: "3",
      added: "6",
      after: ");",
      selected: "return cite(hits);",
    },
    typeNote:
      "Each row is set in its own role's tokens; the Chinese column shows how the theme's faces set Chinese with Latin runs in it.",
    scene: {
      pageTier: "page",
      cardTitle: "Docs Expert",
      cardMeta: "3 sessions · $0.0231",
      nested: "Inner radius = outer radius − padding",
      primary: "Save",
      secondary: "Cancel",
      input: "Search sessions",
      badge: "Running",
      menuTier: "z-[60] menu",
      menuItems: ["Pin", "Rename", "Move to…"],
      backdropTier: "z-50 dialog",
      dialogTitle: "Delete this session?",
      dialogBody: "Its transcript and Trace files are deleted with it.",
      cancel: "Cancel",
      confirm: "Delete",
      toastTier: "z-[100] toast",
      toast: "Exported Trace #001",
    },
    radius: "Radius",
    shadows: "Shadow levels",
    spacingPage: {
      title: "Settings",
      appearance: "Appearance",
      theme: "Theme",
      themeOptions: ["Light", "Dark", "System"],
      fontSize: "Text size",
      sizeOptions: ["XS", "S", "M", "L", "XL"],
      general: "General",
      language: "Language",
      languageOptions: ["中文", "English"],
      notifications: "Notify when done",
    },
    stack0Note: "stack-0: the narrow bars between a glyph and its label",
    controlHeights: "Control heights, measured",
    iconSizes: "Icon sizes",
    iconRegistry: (icons, files) => `${icons} icons from ${files} files`,
    duplicateNames: "One path, several names",
    durations: "Durations × easings",
    reducedNote: "Reduced motion: every change shows its end state at once.",
    liveSignal: "Live signals",
    loading: "Loading",
    focusRing: "Focus ring",
    inputFocus: "Input focus",
    selection: "Selection",
    scrollbar: "Scrollbar",
    spaceUnit: "Space unit",
    spaceUnitNote: "Every spacing and size utility is a multiple of it: h-8 is eight units.",
    shell: "Shell",
    shellNote:
      "The app window through .ui-shell: the field, the navigation column and the main column, related as each theme decides.",
    presence: "Presence",
    presenceNote:
      "A menu from the top, a dialog from the centre, a toast from the bottom — each on the active theme's enter and exit tokens.",
    reveal: "Reveal",
    revealNote:
      "Streamed text arrives chunk by chunk; each chunk moves once, on the reveal tokens, as it appears.",
    layout: "Layout",
    layoutNote: "The sidebar's width between expanded and rail, on the layout tokens.",
    replay: "Replay",
    replayAll: "Replay all",
    motionSpecimens: {
      menu: "Menu",
      dialog: "Dialog",
      toast: "Toast",
      trigger: "More",
      sidebarRows: ["New chat", "Agents", "Models"],
    },
    hookJobs: {
      "ui-glass": "a transient layer over content",
      "ui-eyebrow": "a group label naming the items below it",
      "ui-display": "the one display title of a page or hero",
      "ui-live": "motion for something running right now",
      "ui-frame": "a ruled box with a head, a body, a foot and panes",
      "ui-underline-nav": "the selected-tab marker of a tab bar",
      "ui-shell": "the app window: a navigation column beside a main column",
      "ui-icon-decor": "an icon its label already says: a theme may tint it or drop it",
      "ui-tree":
        "a list whose rows nest: a file tree, a work group's tool rows, the subagent graph",
      "ui-field": "a labelled control row: a form field or a settings row",
      "ui-activity": "a thinking or tool row at work: running, done or in error",
    },
    hookSamples: {
      menu: ["Pin", "Rename", "Delete"],
      group: "Workspaces",
      rows: ["claude-code-expert", "docs-sync", "release-notes"],
      copy: "Copy",
      tabs: ["Overview", "Traces", "Files"],
      streaming: "Writing the answer",
      tree: {
        root: "claude-code-expert",
        dir: "src",
        files: ["rag.ts", "embed.ts"],
        last: "README.md",
      },
      field: {
        name: "Name",
        value: "Docs Expert",
        hint: "Shown in the sidebar and in messages.",
        notify: "Notify when done",
        notifyHint: "A system notification when a Task ends.",
      },
    },
  },
  fonts: {
    title: "Fonts & licences",
    specimens: "Specimens",
    specimensHint:
      "Each theme's families, one en and one zh paragraph at the five text sizes (14 / 15 / 16 / 18 / 20 px).",
    declared: "Declared faces",
    declaredHint:
      "The @font-face rules in the page's stylesheets, merged by family, weight and style; a browser downloads a slice only when text uses it.",
    noFaces: "No faces declared.",
    family: "Family",
    weight: "Weight",
    slicesColumn: "Slices",
    loadStatus: "Loaded",
    licences: "Licence texts",
    noLicences: "No licence texts yet.",
    status: { loaded: "loaded", unloaded: "unused", loading: "loading", error: "failed" },
  },
  catalog: {
    modules: {},
    sections: {},
  },
};
