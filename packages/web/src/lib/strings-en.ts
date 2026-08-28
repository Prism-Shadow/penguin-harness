/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through state/locale.tsx.
 * Keep domain terms capitalized — Workspace, Token, Task, Session, Project, Trace.
 * "agent" is a common noun: lowercase mid-sentence, capitalized only at the start
 * of a label/sentence or in a proper name (Agent State, AgentHub).
 */
import type { Strings } from "./strings";

export const en: Strings = {
  appName: "PenguinHarness",

  nav: {
    chat: "Chat",
    newChat: "New chat",
    agents: "Agents",
    skills: "Skills",
    models: "Models",
    machines: "Machines",
    usage: "Cost Center",
    traces: "Trajectories",
    benchmark: "Evaluation Center",
    // Collapsed-rail tooltip (product-specified wording; new chat reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "Last conversation",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    collapseGroup: "Collapse",
    expandGroup: "Expand",
    pinGroup: "Pin group",
    unpinGroup: "Unpin group",
  },

  /** Machines page: the server's own ssh hosts, and installing this build on one. */
  machines: {
    pageTitle: "Machines",
    pageDesc:
      "The hosts declared in this server's own ~/.ssh/config. Pick one to install this build of PenguinHarness on it: the machine is probed, a matching Node runtime rides along only if it needs one, and the image is copied over and installed there. The config is read, never written, and the install uses the server account's own ssh keys.",
    /** Version line under the title; `version` is what would be pushed. */
    imageVersion: (version: string) => `Installs version ${version}`,
    noImage:
      "This server has no install image to push. A packaged or tarball install carries one; a source checkout gets one from its first hot push.",
    empty: "No hosts in ~/.ssh/config.",
    /** The picker: an ssh config can declare hundreds of hosts, so the panel is a fuzzy search over aliases. */
    pick: "Choose a machine\u2026",
    search: "Search hosts\u2026",
    noMatch: "No host matches that.",
    /** How many matches the visible rows leave out — a silent truncation would read as "not in my config". */
    more: (count: number) => `${count} more \u2014 keep typing to narrow it down.`,
    /** Heading of the entry for the machine this server itself runs on. */
    localTitle: "This machine",
    /** A machine's server state as of the last probe; `statusUnknown` = not probed yet. */
    statusRunning: "Running",
    statusRunningOn: (port: number) => `Running on port ${port}`,
    statusStopped: "Not running",
    statusUnreachable: "Unreachable",
    statusUnknown: "Not checked",
    /** A machine carrying a different build from the one this server would install. */
    update: "Update",
    behind: "Out of sync",
    upToDate: "Up to date",
    /** Bringing a machine's server up and holding a tunnel to it. */
    connect: "Connect",
    connecting: "Connecting\u2026",
    disconnect: "Disconnect",
    /** Each machine is a separate server with its own accounts; this browser signs in per machine. */
    signIn: "Sign in",
    signOut: "Sign out",
    replaceProgram: "Replace the program there and restart",
    replaceProgramWhy:
      "Its runtime is older than this build, and a push never replaces a runtime. This installs the program over there and restarts its server, which interrupts anyone using it.",
    signingIn: "Signing in\u2026",
    signedIn: "signed in",
    signInTo: (alias: string) => `Sign in to ${alias}`,
    /** A connected machine: its filesystem and API can be reached from here. */
    reachable: "Reachable",
    /** Manual re-probe, for when you already know something changed. */
    refresh: "Refresh",
    checking: "Checking\u2026",
    /** Heading of the standing list of machines this server has installed on. */
    installedTitle: (count: number) => `Installed machines (${count})`,
    /** What the selected machine already carries, remembered on the server across restarts. */
    installedAt: (version: string, when: string) => `${version} installed here on ${when}.`,
    install: "Install",
    installing: "Installing\u2026",
    reinstall: "Reinstall",
    /** This server already installed there for another project: taking it costs no transfer. */
    adopt: "Add to this project",
    installedElsewhere: (version: string) =>
      `${version} is already installed there, for another project \u2014 adding it here sends nothing.`,
    /** Terminal states of a finished job. */
    installed: (version: string) => `Installed ${version}.`,
    alreadyInstalled: (version: string) => `Already on ${version} \u2014 nothing to install.`,
    failedAt: (step: string) => `The install failed while trying to ${step}.`,
    /** The progress log's own heading, so the block is not an unlabelled wall of text. */
    output: "Install output",
    adminOnly: "Only an admin can install on a machine.",
  },

  /** Server-side terminal (the in-app dock and the standalone /terminal page). */
  terminal: {
    title: "Terminal",
    newShell: "New shell",
    /** Tab strip ×: kills the shell itself (server-side), unlike closing the dock. */
    killShell: "Kill this terminal",
    /** Boundary drag handle between the dock and the main content (double-click resets). */
    /** Hover menu when the user has no live terminal yet. */
    /** Pane body when creating/attaching a shell failed (the server message follows). */
    createFailed: "Could not start a terminal",
    /** A create that 404s: the server predates the terminal API (or the shell attached to an older one). */
    noTerminalApi:
      "this server has no terminal API: the running runtime predates it. A hot push replaces the platform and Web App, but the terminal endpoints are runtime-owned — the runtime itself has to be updated (restarting will not help)",
    /** Codex-style handoff: opens /terminal?id=… in a new window, the dock lets go. */
    detach: "Open in new window",
    status: {
      connecting: "connecting",
      ready: "ready",
      exited: "exited",
      error: "error",
    },
    /** Suffix shown after `status.exited`; `code` is the shell's numeric exit code. */
    exitedWithCode: (code: string): string => `exit code ${code}`,
  },

  dock: {
    addTab: "Add panel",
    closeTab: "Close panel",
    hideDock: "Hide sidebar",
    moveToRight: "Move to the right",
    moveToBottom: "Move to the bottom",
    resize: "Resize panel",
    rightDock: "Right sidebar",
    bottomDock: "Bottom panel",
    draftEmpty: "Available once the conversation starts",
    killConfirmTitle: "Close this terminal?",
    killConfirmBody: (name: string): string =>
      `This ends the shell "${name}" — it cannot be restored.`,
  },

  tracePanel: {
    empty: "No traces yet",
    emptyHint: "This session has not produced a Trace file yet",
    loadFailed: "Failed to load traces",
  },

  settings: {
    language: "Language",
    languageInfo: "Interface language; can follow the browser.",
    /** Sidebar user-menu row opening the System settings dialog. */
    systemSettings: "System settings",
    /** Rail headings: the viewer's own preferences vs. the whole server's. */
    groupPersonal: "Personal",
    groupServer: "Server",
    /** Personal pages of the settings dialog. */
    generalTitle: "General",
    appearanceTitle: "Appearance",
    accountTitle: "Account",
    /** Trace import: the two pickers' accessible names, the pick-a-file action, and its outcomes. */
    importTrace: "Import Trace",
    importTraceInfo:
      "Upload a .jsonl Trace exported from another install and it becomes a conversation of the chosen Agent. Both halves of the destination are picked here: the endpoint is per-Agent — a Trace file's own session_meta cannot name a local Agent, since its agent_state path belongs to the machine that exported it — and the Project is asked for because this dialog does not show which one is open, which also means a Trace can go to a Project other than the open one. Exporting happens in a conversation's Trace panel.",
    importTraceProject: "Import into project",
    importTraceAgent: "Import into agent",
    importTracePick: "Choose file",
    importTraceRunning: "Importing…",
    importTraceDone: (target: string) => `Trace imported into ${target}`,
    importTraceTooLarge: "The file exceeds the 14MB limit.",
    /** Admin-only sub-page (server-global); its explanation is disclosed at the pane heading. */
    proxyTitle: "Proxy options",
    proxyInfo:
      "Server-global, and in force the moment it is saved — nothing to restart. Loopback addresses always go direct.",
    /** The two switches: the server's own outbound traffic / agent command subprocess environments. */
    proxyForApp: "Application uses the proxy",
    proxyForAgent: "Agent environment uses the proxy",
    /** The shared explicit proxy address (empty = follow the proxy environment variables). */
    proxyAddress: "Proxy address",
    proxyAddressPlaceholder: "Empty = follow system proxy",
    /** Admin-only sub-page (server-global). */
    uploadLimitsTitle: "Upload limits",
    /** Its two number fields, both in whole MB. */
    attachmentMaxMb: "Max attachment size (MB)",
    attachmentTotalMb: "Max total per message (MB)",
    /** Accepted range for each field: read while typing, so it stays under the field. */
    attachmentMaxMbHint: (min: number, max: number): string => `${min}–${max} MB`,
    attachmentTotalMbHint: (min: number, max: number): string =>
      `${min}–${max} MB, and not below the per-file limit`,
    /** What these two numbers do NOT govern — disclosed at the pane heading. */
    uploadLimitsInfo: (count: number, imageMb: number): string =>
      `A message may carry at most ${count} attachments. Images placed inline in the ` +
      `conversation keep a separate ${imageMb}MB limit that this setting does not raise — an ` +
      `inline image enters the conversation and the Trace, where its size is paid again on ` +
      `every history page and resume.`,
    theme: "Theme",
    themeInfo: "Light or dark look of the app.",
    themeLight: "Light",
    themeDark: "Dark",
    followSystem: "System",
    terminalTheme: "Terminal theme",
    terminalThemeInfo: "Colors of the terminal panel; follows the app theme by default.",
    followAppTheme: "App",
    langZh: "中文",
    langEn: "English",
    fontSize: "Font size",
    fontSizeInfo: "Overall interface font size.",
    fontSmall: "S",
    fontMedium: "M",
    fontLarge: "L",
    accent: "Accent",
    accentInfo: "Interface accent color.",
    currencyInfo: "Display currency for prices; storage is always USD.",
    changePasswordInfo: "Change this account's sign-in password.",
    accentNames: {
      neutral: "Neutral",
      blue: "Blue",
      green: "Green",
      violet: "Violet",
      rose: "Rose",
      amber: "Amber",
    } as Record<string, string>,
  },

  /** Version footer, update reminder, and admin self-update in the sidebar user menu. */
  update: {
    /** Version-line date label; `date` is formatMonthDay output, e.g. "Last updated Jul 26". */
    lastUpdated: (date: string) => `Last updated ${date}`,
    /** Superscript badge on the version lines when the update check found a newer release. */
    newVersionBadge: "New version available",
    newVersion: (v: string) => `New version v${v} available`,
    updatesAvailable: "Updates available",
    /**
     * The sidebar user menu's SINGLE update row: it reads "Check for updates" until a newer
     * release is known and runs the manual check; once one is known it reads newVersion() and
     * opens the update dialog instead (which carries the release-notes link and, for admins,
     * the self-update action).
     */
    checkNow: "Check for updates",
    checking: "Checking…",
    /** Success toast when the manual check finds a newer release; the row itself turns into the update entry. */
    foundNew: (v: string) => `New version v${v} found — use the update entry to install`,
    upToDate: "You're on the latest version",
    checkFailed: "Update check failed — try again later",
    checkDisabled: "Update checks are disabled (PENGUIN_UPDATE_CHECK=off)",
    releaseNotes: "Release notes",
    updateNow: "Update now",
    updating: "Updating…",
    updated: "Update complete — restart the service to apply",
    restartHint: "Restart by re-running penguin web (or penguin server) in a terminal",
    failed: "Update failed",
    unsupported: "This install cannot be updated from the web UI",
    confirmBody:
      "Downloads the latest release and installs it into the install directory on the server (the data directory is not touched). Restart the service afterwards for the update to take effect.",
    /** Shown in place of confirmBody to non-admins, who can read the release notes but cannot run the update. */
    adminOnly: "Only an administrator can run the update from here.",
    /**
     * Desktop client-update row in the sidebar user menu (shell window only): check →
     * download progress → restart-to-install, driven by the shell's updater snapshot.
     * It stands in for the server update surface, which desktop mode hides entirely.
     * Null version/percent = the shell didn't name one.
     */
    clientCheckNow: "Check for updates",
    /** Success toast when a row-initiated check finds a release (the download starts by itself). */
    clientFoundNew: (v: string | null) =>
      v !== null
        ? `Version v${v} found — downloading in the background…`
        : "New version found — downloading in the background…",
    clientDownloading: (v: string | null, percent: number | null) =>
      `Downloading${v !== null ? ` v${v}` : ""}…${percent !== null ? ` ${percent}%` : ""}`,
    clientRestartToInstall: (v: string | null) =>
      v !== null ? `Restart to install v${v}` : "Restart to install the update",
    /** Success toast when a row-initiated check lands on a build already downloaded and waiting. */
    clientDownloadReady: (v: string | null) =>
      v !== null
        ? `Version v${v} is ready — restart to install`
        : "The update is ready — restart to install",
    /** Error toast carrying the shell's own updater failure text — a failed download or signature check, not only a failed lookup. */
    clientUpdateFailed: (detail: string) => `Client update failed: ${detail}`,
    /** Install POST failed before the shell could act; `detail` is apiErrorText output. */
    clientInstallFailed: (detail: string) => `Could not start the install: ${detail}`,
    clientInstallConfirmTitle: "Restart and install the update",
    /** Mirrors the shell's native restart prompt: the interruption warning must not disappear on the web path. */
    clientInstallConfirmBody:
      "PenguinHarness will restart to finish updating. Running tasks will be interrupted.",
    clientInstallConfirmAction: "Restart now",
    /** Tooltip on the disabled row in a dev (unpackaged) run. */
    clientUnsupportedDev: "A dev run does not update itself",
    /** Tooltip on the disabled row for a Linux install that is not an AppImage (a .deb, or an unpacked tree). */
    clientUnsupportedNonAppImage:
      "Only the AppImage build updates itself on Linux — update a package install through your package manager",
  },

  /**
   * The three DISMISSIBLE badge trails (Skill library / model library / cost center) and the
   * controls that clear them. One sentence per trail, carried unchanged from the dot's tooltip
   * down to the notice on the page it leads to — the same discipline the kernel trail keeps.
   */
  todo: {
    skillUpdates: (n: number) => (n === 1 ? "1 skill update" : `${n} skill updates`),
    presetUpdates: (n: number) =>
      n === 1 ? "1 preset model to sync" : `${n} preset models to sync`,
    unexpectedErrors: (n: number) => (n === 1 ? "1 unexpected error" : `${n} unexpected errors`),
    /** Combined anchor whose trails are not all updates — an unexpected error is not one. */
    pending: "Something needs attention",
    /** Clears an update the user has decided not to take now (a later one raises the badge again). */
    dismiss: "Mark as handled",
    /** The cost center's wording: nothing is being updated there, the errors are simply read. */
    markRead: "Mark as read",
  },

  /** Desktop task-completion notifications (window unfocused; desktop-shell sessions only). */
  notify: {
    taskCompleteTitle: "Task completed",
    /** `session` is the Session title (defaultSessionTitle when unnamed). */
    taskCompleteBody: (session: string): string => `"${session}" has finished — click to view`,
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    settings: "Settings",
    confirm: "Confirm",
    loading: "Loading…",
    saved: "Saved",
    saving: "Saving…",
    /** Clicking save with nothing changed: an info toast instead of a silent no-op. */
    noChangesToSave: "No changes to save",
    /** Confirm-before-save dialog shared by the settings forms (writes go to server-side config files). */
    confirmSaveTitle: "Save changes",
    confirmSaveBody:
      "Save these changes? They will be written to the configuration files on the server.",
    none: "(none)",
    retry: "Retry",
    unknownError: "Request failed, please try again later",
    requiredField: "This field is required",
    copied: "Copied",
    /** Accessible name of the circled "?" that discloses a section or field explanation. */
    moreInfo: "More info",
    /** The same, named for what it explains — so the trigger never repeats the heading it sits in. */
    moreInfoAbout: (subject: string) => `More info: ${subject}`,
    name: "Name",
    username: "Username",
    role: "Role",
    actions: "Actions",
    created: "Created",
    cost: "Cost",
    time: "Time",
  },

  auth: {
    usernameHint:
      "2–32 chars: starts with a lowercase letter; lowercase letters, digits and underscores only",
    password: "Password",
    passwordHint: "At least 8 characters",
    showPassword: "Show password",
    hidePassword: "Hide password",
    login: "Sign in",
    logout: "Sign out",
    admin: "Admin",
    defaultAdminNote:
      "First run: the server prints a first-login link in its startup output — open it to claim the built-in admin “admin” and set a password. No initial password exists to type here",
    /** Login footer line 2: the offline rescue for a forgotten admin password (other users ask the admin instead). */
    forgotAdminNote:
      "Forgot the admin password? Stop the server and run penguin server reset-admin-password to issue a fresh initial one",
  },

  account: {
    changePassword: "Change password",
    oldPassword: "Current password",
    oldPasswordHint:
      "The password this account currently signs in with — checked before the new one takes effect",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordMismatch: "New passwords do not match",
    initialPasswordBanner: "This account is using its initial password. Please change it soon.",
    changeNow: "Change now",
  },

  admin: {
    users: "Users",
    roleAdmin: "Admin",
    roleUser: "User",
    createUser: "Add user",
    initialPassword: "Initial password",
    initialPasswordFlag: "initial password",
    defaultProjectNote: (id: string): string => `A default Project will be created: ${id}`,
    resetPassword: "Reset password",
    resetPasswordTitle: (u: string): string => `Reset password for ${u}`,
    resetPasswordNote:
      "All sign-in sessions of this user will be revoked; they must sign in with the new password",
    deleteUserTitle: (u: string): string => `Delete user ${u}`,
    deleteUserConfirm: (u: string): string =>
      `This deletes user ${u} and every Project they own (including data directories). This cannot be undone.`,
  },

  project: {
    switcher: "Project",
    create: "New Project",
    createTitle: "New Project",
    id: "Project id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    idPrefixHint:
      "The id is prefixed with your username and a hyphen; append lowercase letters, digits or underscores. Cannot be changed later.",
    displayName: "Display name",
    /** Create dialog only: leaving the name empty falls back to the id. In Project settings the saved name cannot be blanked. */
    displayNameHint: "Leave empty to use the Project id as the name",
    settings: "Project settings",
    settingsTitle: "Project settings",
    members: "Members",
    addMember: "Add member",
    removeMember: "Remove",
    /** New-chat defaults section (Project settings): prefill for every new chat. */
    chatDefaultsTitle: "New chat defaults",
    chatDefaultsHint:
      "Prefilled defaults for every new chat: agent, working directory, approval mode, thinking level and default model.",
    chatDefaultsAgent: "Agent",
    chatDefaultsNotSet: "Not set",
    chatDefaultsApprovalNotSet: "Not set (defaults to allow all)",
    chatDefaultsThinkingNotSet: "Not set (follow the agent's config)",
    /** The model default is single-sourced with the Models page (the same default_model); this is just another entry point. */
    chatDefaultsModelHint: "Same default model as the Models page",
    /** Settings dialog tab rail. */
    settingsTabGeneral: "General",
    settingsTabMembers: "Members",
    settingsTabDefaults: "Defaults",
    settingsTabSecurity: "Security policy",
    projectIdLabel: "Project ID",
    deleteProjectDesc: "The project directory is removed recursively and cannot be recovered.",
    /** Security-policy page (Project settings): disclosed by the "?" beside the tab heading. */
    commandPolicyInfo:
      "The command text is normalized for whitespace and quoting, then matched against each enabled rule's regular expression; a hit is refused outright whatever the approval mode allows. It is an accident guardrail: a command assembled at run time is not covered.",
    commandPolicyEnable: "Enable policy",
    commandPolicyEnableDesc: "When off, no rule blocks anything.",
    commandPolicyRules: "Rules",
    commandPolicyRestore: "Restore defaults",
    commandPolicyAddRule: "Add rule",
    commandPolicyEditRule: "Edit",
    commandPolicyApplyRule: "Apply",
    commandPolicyEmpty: "No rules.",
    commandPolicyOn: "Enabled",
    commandPolicyOff: "Disabled",
    commandPolicyRuleName: "Name",
    commandPolicyRulePattern: "Regular expression",
    commandPolicyRuleDesc: "Description",
    commandPolicyInvalidPattern: "Invalid regular expression",
    deleteProject: "Delete Project",
    deleteConfirm:
      "Delete this Project? Its directory will be removed recursively and cannot be recovered.",
    deleteLastForbidden:
      "This is the last Project on this account; create another Project before deleting it",
    deleteDefaultForbidden:
      "default_project is shared with the CLI and cannot be deleted from the web",
    noCredentialTitle: "No model credential configured",
    noCredentialBody:
      "The default model of this Project has no API key yet. Configure it on the Models page before chatting.",
    goToModels: "Go to Models",
    later: "Later",
  },

  agent: {
    listTitle: "Agents",
    create: "Create agent",
    createTitle: "Create agent",
    id: "Agent id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    nameHint: "Leave empty to use the agent id as the name",
    description: "Description",
    createSkills: "Skills",
    createSkillsPlaceholder: "No skills selected",
    createSkillsPicked: (n: number): string => `${n} skill${n === 1 ? "" : "s"} selected`,
    createSkillsHint:
      "Installed into the agent at creation; add or remove them later in its Skills tab.",
    createSkillsEmpty: "The skill library has nothing to install.",
    createDirSkills: "Import Skills from a project directory",
    createDirSkillsPick: "No directory selected",
    createDirSkillsHint:
      "Pick a project directory to read the Skills under its .agents/skills and .claude/skills",
    createDirSkillsEmpty: "This directory carries no installable Skills",
    createDirSkillsFound: (n: number): string =>
      `${n} skill${n === 1 ? "" : "s"} found in this directory`,
    createDirSkillsClear: "Clear the selected directory",
    createSnapshot: "Initialize from a snapshot",
    createSnapshotPick: "Choose a snapshot package",
    createSnapshotHint:
      "Pick an exported Agent State snapshot package (.tar.gz) to start the new agent from its state; name and description left empty keep the package's values.",
    createSnapshotSkillsOff:
      "The snapshot package carries its own skills, so skill seeding is unavailable.",
    createSnapshotClear: "Remove the selected package",
    sessionCount: (n: number): string => `${n} session${n === 1 ? "" : "s"}`,
    toolCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    vaultKeyCount: (n: number): string => `${n} vault key${n === 1 ? "" : "s"}`,
    scheduleCount: (n: number): string => `${n} scheduled task${n === 1 ? "" : "s"}`,
    memoryCount: (n: number): string => (n === 1 ? "1 memory" : `${n} memories`),
    updatedAt: "Last modified",
    activity: (days: number): string => `${days}-day session activity`,
    settings: "Agent settings",
    backToList: "Back to Agents",
    tabOverview: "Overview",
    tabPrompt: "System Prompt",
    tabMemory: "Memory",
    tabRuntime: "Runtime",
    tabTools: "Tools",
    tabSkills: "Skills",
    tabVault: "Vault",
    tabSchedules: "Schedules",
    stateDir: "State path",
    copyStateDir: "Copy State path",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt template",
    placeholdersTitle: "Available placeholders (click to insert)",
    insertPlaceholder: "Insert at the system_prompt cursor",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). Inner tokens ({{VAULT_KEYS}} etc.) live in each feature tab's promptPlaceholders instead. */
    placeholders: [
      ["{{AGENTS_MD}}", "Injects the AGENTS.md content"],
      [
        "{{VAULT}}",
        "Injects the vault block (vault.prompt with the key-name list); empty when its toggle is off",
      ],
      [
        "{{SKILLS}}",
        "Injects the skills block (skills.prompt with installed-skill metadata); empty when its toggle is off",
      ],
      [
        "{{MEMORY}}",
        "Injects the memory block: memory.prompt plus memory.workspace_prompt (persistent workspaces only); empty when memory is off",
      ],
      [
        "{{SCHEDULES}}",
        "Injects the scheduled-tasks block (schedules.prompt with the task-name roster); empty when its toggle is off",
      ],
      ["{{PLATFORM}}", "Runtime platform"],
      ["{{OS_VERSION}}", "Operating system version"],
      ["{{SHELL}}", "Shell used to run commands"],
      ["{{DATE}}", "Current date"],
      [
        "{{PROJECT_DIR}}",
        "PenguinHarness app data root — all agents' data and project-level data; not the task working directory",
      ],
      ["{{AGENT_ID}}", "Current agent id"],
      ["{{CWD}}", "Absolute Workspace path"],
      ["{{PROVIDER}}", "Model provider group"],
      ["{{MODEL_ID}}", "Upstream model id"],
      ["{{SESSION_ID}}", "Current Session id"],
    ] as ReadonlyArray<readonly [string, string]>,
    maxTurns: "max_turns (max turns per Task, -1 = unlimited)",
    maxTokens: "model.max_tokens",
    thinkingLevel: "model.thinking_level",
    thinkingLevelOptions: [
      ["", "Send no override — keep whatever is currently configured."],
      ["low", "Enables a lower tier of extended reasoning."],
      [
        "medium",
        "Enables a medium tier of extended reasoning (the default tier for a newly created agent).",
      ],
      ["high", "Enables a higher tier of extended reasoning; slower responses."],
      [
        "xhigh",
        "Enables an extended tier of reasoning beyond high; identical to high on some models.",
      ],
      [
        "max",
        "Enables the deepest tier of extended reasoning; slowest and identical to xhigh on some models.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    thinkingLevelNoneKept:
      "Stored legacy tier: new selections no longer offer the off tier (many models cannot disable thinking).",
    timeoutMs: "model.timeoutMs",
    timeoutMsHint: "Per-request timeout, ms",
    compaction: "Context compaction",
    maxContextLength: "max_context_length",
    maxContextLengthHint: "Context threshold that triggers compaction",
    maxSessionTurns: "max_session_turns",
    maxSessionTurnsHint: "Turn threshold that triggers compaction",
    compactionMode: "mode (compaction strategy)",
    compactionModeOptions: [
      ["", "Send no override — keep whatever is currently configured."],
      [
        "summarize",
        "Summarizes the old context with the model, then continues from that summary in a fresh window (default).",
      ],
      [
        "discard",
        "Drops the old context without summarizing; the next turn starts fresh in a new window.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    compactionPrompt: "prompt (summarization prompt)",
    maxTurnsInvalid: "max_turns must be > 0 or -1",
    timeoutInvalid: "timeoutMs must be > 0 or -1",
    toolFieldInvalid: (name: string, field: string) =>
      `${name}: ${field} must be a positive integer or -1`,
    toolPermission: "permission",
    permissionReadLabel: "Read-only",
    permissionReadDescription: "Only reads. Auto-approved when the approval mode is read-only.",
    permissionReadWriteLabel: "Read & write",
    permissionReadWriteDescription:
      "Can modify things. Needs manual confirmation when the approval mode is read-only.",
    toolTimeout: "timeoutMs",
    toolMaxOutput: "maxOutputLength",
    toolCallDescription: "call_description",
    callDescriptionHint:
      "call_description: when on (the default), the tool's schema keeps the optional description argument — a model-written sentence about each call, shown to the user while it runs; when off, the argument is filtered out of the schema at assembly. Only tools whose parameters declare a description property can be toggled.",
    mcpServers: "MCP Servers",
    mcpDesc:
      "Connect external MCP Servers: their tools join this agent's toolset as mcp__<name>__<tool>. Changes in this block save immediately.",
    mcpEmpty: "No MCP Servers configured yet",
    mcpAdd: "Add MCP Server",
    mcpEditTitle: "Edit MCP Server",
    mcpRemove: "Remove",
    mcpName: "name",
    mcpNameHint: "Tool-name prefix: mcp__<name>__<tool>; letters, digits, _ and - only",
    mcpTransport: "transport",
    mcpTransportStdio: "Local process: spawns command and talks over stdin/stdout",
    mcpTransportHttp: "Streamable HTTP: the current spec's remote transport",
    mcpTransportSse: "Legacy HTTP+SSE: kept for servers that have not migrated",
    mcpTarget: "command / url",
    mcpCommand: "command",
    mcpArgs: "args",
    mcpArgsHint: "One argument per line",
    mcpEnv: "env",
    mcpEnvHint: "One KEY=value per line; the Agent vault is not injected into MCP Server processes",
    mcpCwd: "cwd",
    mcpCwdHint: "Leave empty to use the Session's Workspace",
    mcpUrl: "url",
    mcpHeaders: "headers",
    mcpHeadersHint: "One Header-Name: value per line (auth headers such as Authorization)",
    mcpPermission: "permission",
    mcpPermissionAuto: "auto",
    mcpPermissionAutoLabel: "Auto (readOnlyHint)",
    mcpPermissionAutoDescription:
      "Each tool gets the level its own readOnlyHint annotation implies: read-only when it declares one, read & write otherwise.",
    mcpPermissionReadDescription:
      "Treat every tool of this server as read-only, whatever it declares. Auto-approved when the approval mode is read-only.",
    mcpPermissionReadWriteDescription:
      "Treat every tool of this server as read & write, whatever it declares. Needs manual confirmation when the approval mode is read-only.",
    mcpPermissionHint:
      "Only the read-only approval mode reads this level; allow-all, deny-all and always-ask ignore it. It never restricts what the server itself can do — marking a server read-only that is not one only drops the confirmation read-only mode would have asked for.",
    mcpConnectTimeout: "connectTimeoutMs",
    mcpBudgetsHint:
      "Leave empty for defaults: connectTimeoutMs is the connect + tool-discovery budget (default 10000); timeoutMs / maxOutputLength bound every tool of this Server.",
    mcpNameInvalid: "Letters, digits, _ and - only, starting with a letter or digit",
    mcpUrlInvalid: "Must be a valid http(s) URL",
    mcpLineInvalid: (line: number): string => `Line ${line} is not valid`,
    mcpNumberInvalid: "Must be an integer > 0",
    mcpDuplicateName: "A server with this name already exists",
    mcpTest: "Test connection",
    mcpTesting: "Testing…",
    mcpTestOk: (toolCount: number, latencyMs?: number): string => {
      const timing = latencyMs !== undefined ? ` (${(latencyMs / 1000).toFixed(1)}s)` : "";
      return toolCount === 0
        ? `Connected, but the server exposes no tools${timing}`
        : `Connected — ${toolCount} tool${toolCount === 1 ? "" : "s"}${timing}`;
    },
    mcpTestFail: (detail: string): string => `Connection failed: ${detail}`,
    mcpTestAllConfirm: (n: number): string =>
      `Connects to ${n === 1 ? "the configured MCP server" : `each of the ${n} configured MCP servers`} in turn and runs tool discovery (real connections, nothing is saved); results land on each row.`,
    mcpTestAllStart: "Start test",
    mcpTestPending: "Testing…",
    mcpTestBadge: (toolCount: number, latencyMs?: number): string =>
      `${toolCount} tool${toolCount === 1 ? "" : "s"}${latencyMs !== undefined ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""}`,
    mcpTestBadgeFail: "Connection failed",
    mcpDeleteTitle: "Delete MCP Server",
    mcpDeleteConfirm: (name: string): string =>
      `Delete MCP Server "${name}"? Its tools stop being available from the next Session on.`,
    defaultValue: "(default)",
    deleteAgent: "Delete agent",
    builtinUndeletable: "Built-in agents cannot be deleted",
    deleteConfirm: (name: string): string =>
      `Delete agent "${name}"? Its directory (including all Traces) will be removed recursively and cannot be recovered.`,
    stateTitle: "Agent State",
    stateVersion: "Agent State version",
    transferDesc:
      "Export the current Agent State snapshot (tar.gz); importing overwrites the whole directory and adopts the version inside the package.",
    exportSnapshot: "Export snapshot",
    importSnapshot: "Import snapshot",
    importing: "Importing…",
    importDone: (v: number): string => `Import finished, Agent State version v${v}`,
    importConflictTitle: "Version conflict",
    importConflictBody:
      "The snapshot's version is not newer than the current one; importing will overwrite the existing Agent State. Continue?",
    resetConfigTitle: "Restore default configuration",
    resetConfigAction: "Restore default configuration",
    resetConfigConfirmBody:
      "This overwrites the agent's existing configuration with the current defaults: the custom system prompt, tool list, model/compaction settings and MCP servers are all replaced, keeping only name and description. Like a skill update this cannot be undone. Continue?",
    resetConfigDone: "Configuration restored to the current defaults",
    kernelTitle: "Kernel",
    kernelLegacy: "predates kernel versioning",
    kernelOutdatedHint: "Kernel update available",
    kernelUpdateNeeded: "Kernel update needed",
    kernelUpToDate: "Up to date",
    kernelUpdateTitle: "Update kernel",
    kernelCurrent: "current",
    kernelLatest: "latest",
    kernelUpdateAction: "Update kernel",
    kernelUpdateConfirmBody:
      "Settings tabs you have not customized will be updated to the current built-in defaults; a tab you have edited stays unchanged in full and is listed in the result. Name, description, the State version and MCP servers are unaffected. Continue?",
    kernelUpdateDone: (version: string, advanced: number): string =>
      advanced > 0
        ? `Kernel updated to ${version}; ${advanced} tab(s) now follow the new defaults`
        : `Kernel updated to ${version}; every tab was already current or kept as customized`,
    kernelUpdateKeptIntro: "Kept whole because customized:",
    kernelListSeparator: ", ",
  },

  models: {
    title: "Models",
    addCustom: "Add custom model",
    addToGroup: "Add model",
    editTitle: "Model settings",
    addTitle: "Add model (OpenAI protocol)",
    addTitleVendor: "Add model",
    addProtocolHint:
      "New models use the OpenAI Chat Completions protocol; set the base URL to a compatible endpoint",
    vendorProtocolHint: (vendor: string): string =>
      `Only ${vendor}'s official API protocol is supported; use a custom model group for OpenAI-compatible endpoints.`,
    autoRouteNone:
      "This model ID cannot be routed with the current provider protocol. If it uses an OpenAI-compatible endpoint, move it to Custom.",
    useCustomGroup: "Move to Custom",
    addGroup: "Add group",
    addGroupTitle: "Add group",
    addGroupDesc:
      'User-defined groups share Custom semantics. "Import models" detects (or lets you pick) the endpoint\'s protocol, then imports every model it serves in one go; "Create only" adds models one by one after the group. Groups live on model entries — the group appears once its first model is saved.',
    groupModeCreate: "Create only",
    groupModeImport: "Import models",
    groupImportAll: "Import all models",
    groupImportNeedUrl: "Fill in a valid base URL first (http/https)",
    groupImportKeyHint: "Leave empty to read the protocol's OPENAI_* / ANTHROPIC_* env vars",
    groupImportListing: "Fetching model list…",
    groupImportSaving: (n: number): string => `Importing ${n} models…`,
    groupImportUnsupported: "This protocol cannot list models — add them manually",
    groupImportFailed: "Fetching the model list failed",
    groupImportEmpty: "No models to import from this endpoint",
    groupImported: (added: number, skipped: number): string =>
      skipped > 0
        ? `Imported ${added} models, skipped ${skipped} entries`
        : `Imported ${added} models`,
    groupNameLabel: "Group name",
    groupNameHint: "Starts with a lowercase letter / digit; may contain - and _",
    groupNameInvalid:
      "Group names may only use lowercase letters, digits, - and _ (starting with a letter or digit), up to 32 characters",
    groupNameExists: "This name is taken by a built-in group or an existing entry",
    groupEmptyHint: "No models in this group yet; use “Add model” to create one",
    deleteGroup: "Delete group",
    deleteGroupTitle: "Delete group",
    deleteGroupConfirm: (label: string, n: number): string =>
      `Delete the group “${label}”? Its ${n} models and their API key configuration will be removed.`,
    groupDeleted: (n: number): string => `Group deleted (${n} models)`,
    searchPlaceholder: "Search models: id / name / provider",
    noSearchResults: "No matching models",
    syncCatalog: "Sync presets",
    syncCatalogHint:
      "Update preset models from the built-in catalog: add missing entries and reset differing ones to the catalog's fields; locally added models and API keys are left untouched",
    syncDone: (added: number, updated: number) =>
      `Presets synced: ${added} added, ${updated} updated`,
    syncUpToDate: "Presets are already up to date",
    homepage: "Model page",
    speedTest: "Speed test",
    speedTestTitle: "Speed test",
    speedTestConfirm: (n: number): string =>
      `This sends one real request to each of the ${n} models in this group, one at a time, to measure time-to-first-token (TTFT) and output rate (TPS). It consumes a small amount of API quota. Continue?`,
    speedTestStart: "Start",
    speedPending: "Testing…",
    speedFailed: "Test failed",
    ttftTitle: "Time to first token (TTFT)",
    tpsTitle: "Output rate (TPS)",
    modelCount: (n: number): string => `${n} model${n === 1 ? "" : "s"}`,
    modelId: "Model ID",
    modelIdHint: "The upstream API model id, e.g. gpt-5.5",
    displayName: "Display name",
    displayNameHint: "Defaults to the model ID",
    providerGroup: "Group",
    contextWindow: "Context window",
    tokenUnit: "Token",
    contextWindowHint: "Leave empty if unknown",
    maxTokens: "Max output tokens",
    maxTokensHint: "Empty = inherit agent setting",
    maxTokensTitle:
      "Caps output tokens per request; leave empty to inherit the agent setting — lower it for small-context models",
    maxTokensInvalid: "Must be a positive integer",
    clientTypeLocked: (t: string): string => `Protocol: ${t} (kept as configured; not editable)`,
    protocol: "Protocol",
    protocolNames: {
      "openai-responses": "OpenAI Responses",
      "ant-messages": "Anthropic Messages",
      "openai-chat": "OpenAI Chat Completions",
    } as Record<string, string | undefined>,
    protocolTriggerTitle: (name: string): string => `Protocol: ${name}. Click to change it.`,
    /** Suffix placeholder while no protocol is selected — never a protocol name, so nothing looks pre-chosen. */
    protocolUnset: "Select protocol",
    detectProtocol: "Detect",
    detectProtocolHint: "Probe the base URL and apply the protocol it serves",
    detecting: "Detecting…",
    /** Success toast; the protocol itself then shows in the base URL field's suffix. */
    detectedProtocol: (name: string): string => `Detected ${name}; applied`,
    /** The ONE failure toast: every mode collapses to it, naming only what the user can act on. */
    detectFailedBody: "Could not detect the protocol. Please check the API key and the base URL.",
    /** Save-time detection came back empty: the save proceeds on the compatible client. */
    detectFellBack: "Protocol not detected; saved as OpenAI Chat Completions",
    addProtocolHintDetect:
      "Pick the protocol from the base URL field's suffix (OpenAI Responses / Anthropic Messages / OpenAI Chat Completions), or press Detect to probe the endpoint — saving without one detects it first",
    addTitleCustom: "Add model",
    vision: "Vision support",
    /** Detect action beside the vision switch. */
    detectVision: "Detect",
    detectingVision: "Testing…",
    detectVisionHint:
      "Send one tiny test image to see whether this model accepts images (uses your API key)",
    detectVisionNeedsId: "Fill in the model id first, then detect.",
    detectVisionOk: "This model accepts images; vision turned on",
    detectVisionNo: "This model does not accept images; vision left off",
    visionOffProxyHint: "Images are read via the vision proxy model",
    fastMode: "Fast mode",
    fastModeHint:
      "Faster output, billed at the provider's premium tier; the Cost center still counts it at the entry's standard prices",
    fastModeUnsupported:
      "This model does not support fast mode — turn it off, or its requests will fail",
    fastModeConfirmTitle: "Enable fast mode",
    fastModeConfirmBody:
      "Fast mode is billed at the provider's premium price list (MiniMax charges 1.5x standard; OpenAI and Anthropic publish separate premium rates). The entry's recorded per-token prices are not adjusted, so the Cost center will under-report this usage.",
    fastModeConfirmPreview:
      "Anthropic's fast mode is a limited research preview: until your organization is granted access, requests return a 429 rate-limit error.",
    fastModeBadge: "Fast",
    visionBadge: "Vision",
    freeBadge: "Free",
    visionModelBadge: "Proxy vision",
    setVisionModel: "Set as proxy vision model",
    visionModelHint: "Describes images via describe_image for models without vision",
    priceUnitShort: "/M tok",
    testConnection: "Test connection",
    testing: "Testing…",
    testOk: (ms: number): string => `Connected (${ms} ms)`,
    testFailed: (msg: string): string => `Failed: ${msg}`,
    priceCacheRead: "Cache read price",
    priceCacheWrite: "Cache write price",
    priceOutput: "Output price",
    currency: "Currency",
    currencyUsd: "USD $",
    currencyCny: "CNY ¥",
    apiKey: "API key",
    apiKeyKeepHint: "Leave empty to keep the current key",
    apiKeyEnvHint: (envKey: string): string => `Leave empty to use the ${envKey} env var`,
    keyConfigured: "Key configured",
    clearApiKey: "Clear stored API key",
    baseUrl: "Custom base URL",
    baseUrlHint: "Leave empty to use the provider default",
    baseUrlSuffixTitle:
      "The client appends the protocol path shown at the field's right edge to the base URL",
    baseUrlRequired: "A base URL is required",
    contextWindowDefaultHint: (n: number): string => `Defaults to ${n} if empty`,
    confirmDeleteTitle: "Delete model",
    confirmDelete: (name: string): string =>
      `Delete "${name}"? Its configuration and API key will be removed.`,
    groupApiKey: "Set key",
    groupApiKeyTitle: (label: string): string => `Set the API key for ${label}`,
    groupApiKeyHint: (n: number): string =>
      `Applies to all ${n} models in this group; leave empty to keep them unchanged.`,
    getApiKey: "Manage keys",
    getModelIds: "Get model IDs",
    groupKeyApplied: (n: number): string => `API key set for ${n} models`,
    oauthKey: "Authorize key",
    oauthTitle: (label: string): string => `Authorize a new ${label} API key`,
    oauthIntro: (label: string, n: number): string =>
      `A new API key will be created on your ${label} account and written to all ${n} models in this group, replacing the key they use now.`,
    oauthAuthorize: "Open authorization page",
    oauthWaiting: "Waiting for the authorization to finish in the other tab…",
    oauthApplied: (n: number): string => `New API key set for ${n} models`,
    oauthManualSwitch: "Page can't redirect back? Enter the code by hand",
    oauthCallbackSwitch: "Go back to the automatic redirect",
    oauthManualHint: "Open the authorization page, then paste the one-time code it shows you here.",
    oauthCodeLabel: "Authorization code",
    oauthSubmitCode: "Submit code",
    oauthTimedOut: "The authorization never came back. Enter the code by hand, or start again.",
    oauthRetry: "Start again",
    oauthErrors: {
      invalid_request: "The authorization request was rejected. Start again.",
      code_rejected:
        "That authorization is no longer valid: it expired or was already used. Start again.",
      upstream_failed: "The provider returned no usable key. Start again.",
      unreachable: "The provider could not be reached. Check the network and start again.",
      apply_failed:
        "A key was created but could not be saved. Authorize again, then delete the unused key in the provider's console.",
    },
    providerEnvNotes: {
      zhipu:
        "Defaults to the Z.AI global endpoint (api.z.ai); keys from bigmodel.cn need base URL https://open.bigmodel.cn/api/paas/v4",
      moonshot:
        "Defaults to the China endpoint (api.moonshot.cn); keys from platform.kimi.com need base URL https://api.moonshot.ai/v1",
    },
    confirmVisionModelTitle: "Set as proxy vision model",
    confirmVisionModel: (name: string): string =>
      `Make "${name}" the proxy vision model? Models without vision will read images through it via describe_image.`,
    confirmSaveTitle: "Save model settings",
    confirmSave: (name: string): string => `Save the changes to "${name}"?`,
    confirmDefaultTitle: "Set as default model",
    confirmDefault: (name: string): string =>
      `Make "${name}" the default model? New sessions will use it by default.`,
    default: "Default",
    setDefault: "Set as default model",
    remove: "Delete model",
    readOnlyHint: "Members have read-only access; only owners can change models and credentials",
    empty: "No models configured yet",
    noKey: "No key",
    readFromEnv: "Read from environment variable",
    showModelsWithoutKey: (n: number): string =>
      `Show model${n === 1 ? "" : "s"} without a key (${n})`,
    modelIdExists: "This model id already exists",
    pricingAllOrNone: "Fill all three prices",
    pricingInvalid: "Must be a number",
    contextWindowInvalid: "Must be a number",
  },

  memory: {
    desc: "Long-term memory across Sessions (stored in agent_state/memory/): the agent saves what is worth keeping as it works, and you can also just ask it to remember something. User memory applies to all of this agent's sessions; workspace memory is kept per workspace. Memory edits are made by the agent in chat. Turning the switch off only stops memory from being used and deletes nothing.",
    enable: "Enable memory",
    userScope: "User memory",
    templateMissing:
      "The prompt template has no {{MEMORY}} placeholder, so memory never enters the context.",
    insertPlaceholder: "Insert the {{MEMORY}} placeholder",
    insertPlaceholderDone: "Inserted",
    promptSection: "Memory prompt",
    promptSectionHint:
      "What the template's {{MEMORY}} placeholder expands to. The main prompt is injected into every session; the workspace addendum only in sessions with a persistent workspace.",
    promptLabel: "Main prompt",
    workspacePromptLabel: "Workspace addendum",
    /**
     * Memory-prompt placeholder reference; a chip inserts into whichever field was focused
     * last. The two indexes plus the workspace directory — the user directory stays a literal
     * pattern in the prompt, resolvable from the Environment section.
     */
    promptPlaceholders: [
      [
        "{{USER_MEMORY_INDEX}}",
        "Content of the user MEMORY.md index (at most 200 lines and 25,000 characters total)",
      ],
      [
        "{{WORKSPACE_MEMORY_INDEX}}",
        "Content of the workspace MEMORY.md index (at most 200 lines and 25,000 characters total); effective only in the workspace addendum",
      ],
      [
        "{{WORKSPACE_MEMORY_DIR}}",
        "Absolute path of the current workspace's memory directory; effective only in the workspace addendum",
      ],
    ],
    insertToken: "Insert at the cursor",
    itemCount: (n: number): string => (n === 1 ? "1 item" : `${n} items`),
    emptyScope:
      "No memories for this Workspace yet — the agent saves what is worth keeping as it works",
    emptyUserScope: 'No user memories yet — say "remember …" in a chat and the agent will save it',
    add: "Add",
    addScopeLabel: (scope: string): string => `Add to ${scope}`,
    addTitle: "Add memory",
    addWhy:
      "The agent organizes and saves memories in a chat: fill in the content, open a new conversation, and the agent does the rest.",
    addContentLabel: "Content or source to remember",
    addContentPlaceholder: "Paste the content to remember, or a file path / URL",
    /** Prefilled draft for the add-via-chat flow, per scope kind; the required content follows on the next line. */
    addPromptLead: {
      user: "Please turn the following into memories in user memory:",
      workspace: "Please turn the following into memories in this workspace's memory:",
    },
    view: "View",
    edit: "Edit",
    editTitle: "Edit memory",
    editWhy:
      "Content edits are made by the agent in a chat: confirm the prompt to open a new conversation, and the agent updates the memory file and its MEMORY.md index together.",
    editRequirementLabel: "What to change",
    editRequirementPlaceholder: "Describe the change — you can finish it in the chat",
    editPromptLabel: "Prompt preview",
    editCopyPrompt: "Copy prompt",
    editOpenChat: "Open a new chat",
    delete: "Delete",
    deleteTitle: "Delete this memory?",
    deleteConfirm: (name: string): string =>
      `This deletes "${name}" and removes its index line from MEMORY.md. This cannot be undone.`,
    deleteDone: "Deleted",
    /** Prefilled draft for the edit-via-chat flow; the user completes the trailing requirement line before sending. */
    editPromptLead: (title: string): string => `Please update a memory: ${title}`,
    editPromptTail: "What to change: ",
    exportScope: "Export",
    exportScopeHint: "Download every memory in this group as one JSON document",
    exportScopeLabel: (scope: string): string => `Export ${scope}`,
    importScope: "Import",
    importScopeHint: "Restore memories into this group from an exported JSON document",
    importScopeLabel: (scope: string): string => `Import into ${scope}`,
    importTitle: "Import memories",
    importWhy:
      "Reads a memory group exported from this or another agent: a JSON file holding the memories and the group's MEMORY.md index.",
    importFile: (name: string, count: number): string => `${name} — ${count} memories`,
    importModeLabel: "When this group already has a memory of the same name",
    importModeSkip: "Keep the one that is here",
    importModeSkipHint: "Adds only what this group does not have. Nothing here is lost.",
    importModeOverwrite: "Take the file's version",
    importModeOverwriteHint: "Memories the file does not carry are left alone.",
    importModeReplace: "Replace the whole group",
    importModeReplaceHint: "Every memory the file does not carry is deleted.",
    importAction: "Import",
    importInvalidFile: "This file is not a memory export.",
    importEmptyFile: "This file carries no memories.",
    importConfirmTitle: "Confirm the import",
    importWillOverwrite: (names: string[]): string =>
      `${names.length} memories will be overwritten: ${names.join(", ")}`,
    importWillRemove: (names: string[]): string =>
      `${names.length} memories will be deleted: ${names.join(", ")}`,
    importWillReplaceIndex: "The group's MEMORY.md index will be replaced.",
    importIrreversible: "This cannot be undone.",
    importDone: (added: number, overwritten: number, removed: number): string =>
      `Imported: ${added} added, ${overwritten} replaced, ${removed} deleted`,
    importNothingNew: "Nothing to import — this group already has every memory in the file",
  },

  vault: {
    desc: "Environment variables owned by this agent (stored in agent_state/.vault.toml), injected into the environment of its shell commands (exec_command); key names are shared with the model, values never enter the model context. Subagents use their own vaults and do not inherit this one. Saved changes take effect from the next task (a task already running is unaffected).",
    key: "Name",
    value: "Value",
    valueMasked: "Value (masked)",
    add: "Add",
    addTitle: "Add variable",
    remove: "Remove",
    deleteTitle: "Delete variable",
    deleteConfirm: (key: string): string =>
      `Delete variable "${key}"? Its value cannot be recovered.`,
    overwriteTitle: "Overwrite existing variable",
    overwriteConfirm: (key: string): string =>
      `"${key}" already exists — saving will overwrite its value, which cannot be recovered.`,
    empty: "No variables configured yet",
    readOnlyHint: "Members are read-only; only the owner can edit the vault",
    keyHint: "Letters, digits and underscores; must not start with a digit",
    keyInvalid: "Invalid name: only letters, digits and underscores, not starting with a digit",
    valueRequired: "Value must not be empty",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable vault",
      templateMissing:
        "The prompt template has no {{VAULT}} placeholder, so the vault section never enters the context.",
      legacyTemplate:
        "The template still carries the legacy hardcoded # Vault section: one-click migration replaces it in place with the {{VAULT}} placeholder, wording unchanged, after which it is editable below.",
      insertPlaceholder: "Insert the {{VAULT}} placeholder",
      migrate: "Migrate to the {{VAULT}} placeholder",
      promptSection: "Vault prompt",
      promptSectionHint:
        "What the template's {{VAULT}} placeholder expands to; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{VAULT_KEYS}}",
          'Vault key-name list (one "- KEY" line per key, names only — values are never injected; empty when no keys)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  schedule: {
    desc: "Scheduled tasks (agent_state/schedule/*.toml): the prompt is sent to the target Session on schedule; files can also be edited by hand, and changes made here take effect immediately.",
    readOnlyHint: "Members are read-only; only the owner can modify schedules",
    colStatus: "Status",
    colPeriod: "Period",
    colTarget: "Target",
    colFireTimes: "Next / last fired",
    colQueued: "Queue",
    statusNames: {
      active: "Active",
      disabled: "Disabled",
      expired: "Expired",
      done: "Done",
      missed: "Missed",
      invalid: "Invalid",
    } as Record<string, string>,
    queued: "Queued",
    once: "One-off",
    newSession: "New session",
    invalidFiles: "Files that failed to parse (skipped by the scheduler)",
    empty: "No scheduled tasks yet",
    enable: "Enable",
    disable: "Disable",
    addTitle: "New scheduled task",
    editTitle: (name: string): string => `Edit scheduled task "${name}"`,
    nameHint: "The file name (without .toml); cannot be changed later",
    prompt: "Prompt",
    enabled: "Enabled",
    startAt: "Start at",
    endAt: "End at",
    period: "Period",
    periodPlaceholder: "30m / 12h / 7d; leave empty for a one-off task",
    target: "Target",
    targetNew: "New session each time",
    targetSession: "Bound Session",
    sessionId: "Session",
    /** Bind-Session picker (searchable dropdown): trigger placeholder, search box, and empty states. */
    chooseSession: "Choose a Session to bind",
    sessionSearch: "Search title or Session id…",
    sessionNoMatch: "No matching Session",
    sessionEmpty: "This agent has no Sessions yet",
    workspace: "Workspace",
    model: "Model",
    modelDefault: "Project default",
    deleteTitle: "Delete scheduled task",
    deleteConfirm: (name: string): string => `Delete scheduled task "${name}"?`,
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable schedules",
      templateMissing:
        "The prompt template has no {{SCHEDULES}} placeholder, so the scheduled-tasks section never enters the context.",
      insertPlaceholder: "Insert the {{SCHEDULES}} placeholder",
      promptSection: "Schedules prompt",
      promptSectionHint:
        "What the template's {{SCHEDULES}} placeholder expands to — teaches the model to manage scheduled tasks with its file tools; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{SCHEDULE_LIST}}",
          'Current task-name list (one "- name" line per task; an empty-roster note when none exist)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  skills: {
    pageTitle: "Skill library",
    pageDesc: "Built-in skill library: browse, quick-start a chat, or install to agents.",
    quickInvoke: "Quick start",
    quickInvokeText: (name: string): string => `use the ${name} skill`,
    /** Title on a disabled quick-start button: quick start opens a draft on the currently selected agent, so a skill it hasn't installed (e.g. a preinstall:false skill like remote-claude-code) can't be quick-started until it's installed on that agent. */
    quickInvokeNeedsInstall: "Install this skill on the current agent first to quick-start",
    selectAll: "Select all",
    selectNone: "Select none",
    selectedCount: (n: number): string => `${n} selected`,
    manageInstall: "Manage installs",
    manageInstallTitle: (name: string): string => `Manage installs: ${name}`,
    install: "Install",
    installed: "Installed",
    uninstall: "Uninstall",
    skillCount: (n: number): string => (n === 1 ? "1 skill" : `${n} skills`),
    usedByAgents: (n: number): string =>
      n === 0 ? "not used yet" : n === 1 ? "used by 1 agent" : `used by ${n} agents`,
    installedToast: (skill: string, agent: string): string => `Installed ${skill} to ${agent}`,
    updateOutdated: (n: number): string => `Update available: update ${n} agent install(s)`,
    updateAction: "Update",
    updateConfirmTitle: (name: string): string => `Update ${name}`,
    updateConfirmWarning: (name: string): string =>
      `Updating ${name} reinstalls the library copy over each agent's installed files — any local edits to the installed skill are lost. Export a backup first if you need them.`,
    updatedToast: (skill: string, n: number): string =>
      `Updated ${skill} to the latest version (${n} agent(s))`,
    uninstalledToast: (skill: string, agent: string): string =>
      `Uninstalled ${skill} from ${agent}`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (skill: string, agent: string): string =>
      `Uninstall ${skill} from ${agent}? Its installed files (local edits included) will be deleted.`,
    /** Agent settings "Skills" tab (installed list + import modal). */
    agentTabDesc:
      "Skills installed on this agent (agent_state/skills/ — the files are the source of truth): metadata is injected into the system prompt and the body is read by the model on demand; uninstalling deletes the whole skill directory.",
    agentTabEmpty: "No skills installed yet",
    exportSkill: "Export",
    importSkill: "Import skill",
    importChatTitle: "Recommended: install by chatting with the agent",
    importChatWhy:
      "The agent can read, review and adapt the skill content in full — more reliable than a raw upload.",
    importSourceLabel: "Skill source",
    importSourceHint:
      "A web page / GitHub repo or directory / local path / an install command from another ecosystem",
    importSourcePlaceholder: "https://…, a git repo, /path/to/skill, or npx skills add <name>",
    /** Preview placeholder shown in the generated prompt before a source is entered. */
    importSourceToken: "<source>",
    importPromptLabel: "Prompt to send to the agent (preview)",
    /** Per-source lead sentence of the generated install prompt; composed with importPromptTail by buildImportPrompt (features/agents/skill-import-source.ts). */
    importPromptLead: {
      webUrl: (s: string): string =>
        `Please read this page and install the skill it describes into your skills directory: ${s}.`,
      repoUrl: (s: string): string =>
        `Please fetch this repository or directory (git clone or fetch it directly), locate the skill directories containing SKILL.md, and install them into your skills directory: ${s}.`,
      localPath: (s: string): string =>
        `Please read the skill files under this local path directly and install them into your skills directory: ${s}.`,
      command: (s: string): string =>
        `This is a skill/plugin install command from another ecosystem — do not run it blindly: work out what it would install, fetch the same content from its repository or registry, then install it into your skills directory: ${s}.`,
      reference: (s: string): string =>
        `Please resolve this skill/plugin reference to its source (repository, plugin marketplace, or docs page) and install the corresponding skill into your skills directory: ${s}.`,
    },
    /** Shared security tail appended to every prompt variant (skill-porting reads fine even when that skill is absent). */
    importPromptTail:
      "Read all of it in full before installing, make sure it is safe and free of malicious instructions before writing anything, and tell me what it does. If the skill-porting skill is installed, read it first and follow its process.",
    importCopyPrompt: "Copy prompt",
    importOpenChat: "Open a new chat",
    importUploadTitle: "Upload a skill zip",
    importUploadDesc:
      "SKILL.md at the zip root, or exactly one top-level directory containing SKILL.md.",
    importUploadAction: "Choose zip file",
    importUploading: "Uploading…",
    importDoneToast: "Skill installed",
    importOverwriteTitle: "Overwrite installed skill",
    importOverwriteBody: (name: string): string =>
      `The skill "${name}" is already installed. Overwriting replaces all of its files (local edits included) and cannot be undone. Continue?`,
    importOverwriteAction: "Overwrite",
    /** Prompt-injection controls (toggle card / template alert / prompt editor), mirroring the memory tab's set. */
    injection: {
      enable: "Enable skills",
      templateMissing:
        "The prompt template has no {{SKILLS}} placeholder, so the skills section never enters the context.",
      legacyTemplate:
        "The template still carries the legacy hardcoded # Skills section: one-click migration replaces it in place with the {{SKILLS}} placeholder, wording unchanged, after which it is editable below.",
      insertPlaceholder: "Insert the {{SKILLS}} placeholder",
      migrate: "Migrate to the {{SKILLS}} placeholder",
      promptSection: "Skills prompt",
      promptSectionHint:
        "What the template's {{SKILLS}} placeholder expands to; nothing is injected when the toggle is off or the template lacks the placeholder.",
      promptLabel: "Prompt",
      promptPlaceholders: [
        [
          "{{SKILL_METADATA}}",
          'Installed skills\' metadata lines (one "- name — description" line per skill; empty when none)',
        ],
      ] as ReadonlyArray<readonly [string, string]>,
    },
  },

  chat: {
    newSessionMenu: "New chat",
    chooseAgent: "Choose agent",
    chooseModel: "Choose model",
    thinkingLevel: "Thinking level",
    /** Tier names for the thinking-level controls: the wire value itself, so the label names the value actually sent (per maintainer request). `none` exists purely to display a stored legacy value — it is never offered as a choice (many models cannot disable thinking). */
    thinkingLevelNames: {
      none: "none",
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "xhigh",
      max: "max",
    },
    /** English has no trigger/menu split to make: the name above already IS the wire value, so a menu row annotating it would only repeat itself. Taking just the name (the second parameter is dropped) is how this locale says "same text on every surface". */
    thinkingLevelMenuName: (name: string): string => name,
    thinkingSwitchTitle: "Switch thinking level",
    thinkingSwitchBody: (to: string): string =>
      `Switch the thinking level to "${to}"? Switching mid-conversation lowers the prompt-cache hit rate and raises cost; compacting the context first is cheaper.`,
    thinkingSwitchBusyHint: "This conversation is still working — compaction has to wait for it.",
    thinkingSwitchCompactFirst: "Compact, then switch",
    thinkingSwitchConfirm: "Switch anyway",
    thinkingSwitchCompacting: "Compacting the context — the thinking level switches when it ends.",
    thinkingSwitchApplied: (to: string): string =>
      `Context compacted; thinking level switched to "${to}".`,
    thinkingSwitchCompactFailed:
      "The compaction did not finish; the thinking level was switched anyway.",
    /** The machine a workspace lives on; the row only shows when more than one is reachable. */
    workspaceMachine: "Machine",
    workspaceHere: "here",
    /** Why a listed machine cannot be picked — shown ON its row, where the question is asked. */
    workspaceMachineWhy: {
      "no-identity": "not identified",
    },
    workspaceUseThis: "Use this dir",
    workspaceUp: "Parent dir",
    workspaceNoSubdirs: "No subdirectories",
    workspaceAuto: "Temporary workspace",
    workspaceClear: "Use a temporary workspace instead",
    workspaceDirInvalid: "Directory does not exist or is inaccessible; reverted",
    /** Sidebar conversation-list grouping toggle (workspace is the default) + workspace groups. */
    groupByWorkspace: "Group by workspace",
    groupByAgent: "Group by agent",
    groupByTime: "Group by time",
    /** Time-mode bucket names (last day / last month / older), by last activity. */
    timeGroups: {
      day: "Past day",
      month: "Past month",
      earlier: "Earlier",
    },
    /** Session-list section header controls: search / list settings / mode-dependent create (the created object follows the grouping mode). */
    searchSessions: "Search chats",
    searchSessionsPlaceholder: "Search chats…",
    searchClear: "Clear search",
    /** Zero hits: the filter only sees already-loaded conversations, so the copy says so rather than claiming none exist. */
    searchNoMatches: "No matches among loaded chats",
    listSettings: "List options",
    groupModeSection: "Group by",
    sortModeSection: "Sort by",
    sortManual: "Manual order",
    sortRecent: "Most recent",
    newWorkspaceEntity: "New workspace",
    /** Registry-backed workspace group's overflow (… right of the header "+"): alias rename + sidebar-only removal. */
    workspaceMenu: "Workspace options",
    renameWorkspace: "Rename workspace",
    renameWorkspaceLabel: "Name",
    renameWorkspaceHint: "Leave empty to use the folder name",
    deleteWorkspace: "Remove workspace",
    deleteWorkspaceConfirm: (name: string) =>
      `Remove "${name}"? This only removes the workspace group from the sidebar — the directory on disk and existing chats are untouched, and it can be re-added anytime.`,
    tempWorkspaces: "Temporary workspaces",
    newSessionInWorkspace: "New chat in this workspace",
    draftSubtitle: "The self-evolving agent that excels at AI development tasks",
    /** Folder names for the draft page's collapsible examples (bookmark-style: exactly one open at a time). */
    exampleFolders: {
      webapps: "Build web apps",
      agents: "Build and optimize agents",
      schedules: "Create scheduled tasks",
    },
    /** Second tooltip line on an example row: the click fills the composer, it does not send. */
    exampleFillHint: "Click to fill the composer — edit it if you like, then send",
    shortcuts: {
      folder: "My shortcuts",
      new: "New shortcut",
      newFromComposer: "Starts from whatever is in the composer",
      createTitle: "New shortcut",
      editTitle: "Edit shortcut",
      titleLabel: "Name",
      titleHint: (max: number) => `At most ${max} characters`,
      promptLabel: "Prompt",
      promptHint: (max: number) => `At most ${max} characters`,
      promptInfo:
        "Clicking this shortcut puts the text into the composer verbatim and sends nothing; Skills stay a separate pick in the composer.",
      titleTooLong: (max: number) => `The name may be at most ${max} characters`,
      promptTooLong: (max: number) => `The prompt may be at most ${max} characters`,
      deleteTitle: "Delete shortcut",
      deleteConfirm: (title: string) =>
        `Delete "${title}"? The shortcut disappears from every device you use.`,
    },
    exampleTasks: {
      game: {
        label: "2D penguin sled game",
        desc: "A cute Antarctic penguin sleds over rocks, easy start with a gentle difficulty ramp — a 2D pure-frontend mini game",
        prompt:
          "Build a cute Antarctic penguin sledding 2D game: press Space to jump over the rocks " +
          "coming up on the ice; start easy and forgiving, with sled speed and obstacle density " +
          "ramping up smoothly and gradually over time (no sudden spikes), live scoring, and " +
          "hitting a rock ending the run with one-click restart. " +
          "A 2D side-scroller with a cute cartoon look, pure frontend (a single HTML file is " +
          "fine), styled per the web-design skill. " +
          "When done, test it in a browser once, confirm the first few seconds are easy to " +
          "clear, and tell me how to open it and how to play.",
      },
      gamecenter: {
        label: "A mini-game center built by multiple agents",
        desc: "Ten pure-frontend games with no repeated mechanics, built in parallel behind one index page",
        prompt: `Build a web mini-game center with multiple agents working in parallel: 10 pure-frontend games with no two sharing the same mechanic, plus an index page.

## How to split the work
- First plan the 10 games (say snake, 2048, tetris, breakout, minesweeper, memory match, sokoban, space shooter, platform jumper, rhythm tap), confirm no two mechanics repeat, and fix a shared directory layout, palette and interaction spec.
- Then hand the 10 games to several subagents to implement in parallel — each subagent owns exactly one game, follows the agreed spec, and never edits another's files.

## Each game
- Its own \`games/<slug>/index.html\`: pure frontend, a single file that runs straight from file://, with no backend and no CDN assets.
- Start / restart, live score or timer, a lose-or-clear summary, both keyboard and touch controls, and the rules written on the page.
- A way back to the index page.

## Index page
- \`index.html\` at the root: a card grid listing all 10 games (name + one-line mechanic + controls), each card opening its game.
- One design language shared with every game, following the web-design skill.

## Wrap-up
- Review as a whole: the 10 mechanics really are distinct, the styling is consistent, and every index link resolves.
- Self-test each game in a browser — it starts, it ends, it restarts — then tell me how to open it.`,
      },
      lol: {
        label: "League of Legends music player",
        desc: "Worlds anthems on the SoundCloud Widget API — a single file that opens from file://",
        prompt: `Build a League of Legends Worlds anthem player with the SoundCloud Widget API (see https://developers.soundcloud.com/docs/api/html5-widget): a single index.html that works when opened from file://.

## Technical constraints
- Use the SC.Widget JS API (widget.load / widget.toggle / widget.setVolume / widget.seekTo), loading https://w.soundcloud.com/player/api.js
- The iframe must stay visible (180px tall), with visual=true color=f0b90b single_active=true
- Include ONLY these 8 tracks confirmed playable (oEmbed-verified); do not add tracks that are not oEmbed-verified:
  - Warriors (S4) — soundcloud.com/leagueoflegends/warriors
  - Worlds Collide (S5) — soundcloud.com/leagueoflegends/worlds-collide
  - Legends Never Die (S7) — soundcloud.com/leagueoflegends/legends-never-die
  - Phoenix (S9) — soundcloud.com/leagueoflegends/phoenix
  - Burn It All Down (S11) — soundcloud.com/leagueoflegends/burn-it-all-down
  - GODS (S13) — soundcloud.com/leagueoflegends/gods
  - Heavy Is The Crown (S14) — soundcloud.com/linkinpark/heavy-is-the-crown
  - Sacrifice (S15) — soundcloud.com/leagueoflegends/sacrifice

## Layout
- Left 260px sticky sidebar: the track list (S4/S5/… badge + emoji + title + year); clicking highlights with a gold border and switches tracks via SC.Widget.load() with auto_play
- Right main area: hero title + a desktop clock (80px monospace gold HH:MM:SS, refreshed every second, blinking colons) + a mood tag
- Player card: the SoundCloud iframe + a custom control bar (⏮ ▶/⏸ ⏭ + track info + a volume slider; clicking the speaker icon toggles mute)
- Mood-wave section: 15 gold animated bars, re-randomized on every track switch
- Keyboard shortcuts: Space play/pause, ← → previous/next, ↑ ↓ volume

## Design
Penguin visual style (see the web-design skill), dark by default. On phones the sidebar becomes a horizontally scrolling top bar.

When done, open index.html in a browser and self-test once.`,
      },
      rhythmRunner: {
        label: "Rhythm runner mini game",
        desc: "A Muse Dash-style rhythm runner: a penguin lead, notes locked to the beat, graded Perfect / Great / Miss",
        prompt:
          "Build a Muse Dash-style rhythm runner: a penguin runs forward on its own, and notes — " +
          "drawn as music-note icons — fly in locked to the beat for me to hit. Show Perfect / " +
          "Great / Miss for each hit, score combos, and let the difficulty climb as the track goes " +
          "on. Pure front end, one file, playable straight from file://.",
      },
      investmentCopilot: {
        label: "Conversational investment analyst",
        desc: "A conversational market Copilot on the Penguin SDK: the home page lists what is trending, with the market factors behind every call",
        prompt:
          "Build a conversational stock-market Copilot on the Penguin SDK, along the lines of " +
          "perplexity.ai/finance: from startup it pulls live market data every 5 minutes, and the " +
          "home page lists the stocks trending strongest lately alongside how the sectors compare. " +
          "Every call has to name the market factors behind it — policy, sector news, fund flows, " +
          "earnings, macro data — rather than technical indicators. Analysis of public data, not " +
          "investment advice. Its stock-lookup tool has to handle questions like \"look up Zhipu's " +
          'stock for me": resolve a company name to its ticker itself, and when there is no match ' +
          "or the company is not listed, say so rather than inventing a quote.",
      },
      rag: {
        label: "Build a Claude Code docs RAG agent",
        desc: "Collect the claude-code-docs repo into a conversational RAG knowledge app with source citations",
        prompt:
          "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG knowledge app: " +
          "clone the repo and prepare the corpus, then build a retrieval index; " +
          "the app acts as a Claude Code configuration expert, answering Claude Code questions " +
          "with retrieval-augmented replies and clickable citations that reveal the matched " +
          "original text chunk and link to the real documents; " +
          "give it a beautiful web chat UI following the web-design skill. " +
          "When done, run the app and self-test one Chinese question and one English question, confirming both retrieve " +
          "the right English documents and stream their answers, then tell me how to access it.",
      },
      agentBenchmarkBuild: {
        label: "Build a general-purpose decision agent and its benchmark",
        desc: "Create a general decision Agent and test it on football, after-sales, and investment tasks",
        prompt: `Use \`agent-initialization\` followed by \`benchmark-design\` to create a decision Agent and produce a frozen Benchmark with a Formal Baseline.

Agent:
- id: \`finite_choice_agent\`
- capability: make stable, explainable finite choices when public information is incomplete or conflicting
- installed_skills: \`[]\`

Benchmark:
- id: \`contextual-choice-adaptation\`
- capability: form and transfer a stable finite-choice decision process from public rules, historical examples, and current facts
- desired_baseline_score: \`<75\`
- pilot_iteration_limit: \`5\`

Scenarios:
1. Make football betting decisions from historical matches and current information.
2. Choose after-sales actions from policy and ticket facts.
3. Choose investment actions from a strategy, historical markets, and current indicators.`,
      },
      agentOptimization: {
        label: "Improve the general-purpose decision agent's accuracy",
        desc: "Improve an Agent from existing evaluation results and verify that the new version is better",
        prompt: `Use \`agent-optimization\` to optimize a decision Agent against its frozen Benchmark.

- test_agent_id: \`finite_choice_agent\`
- benchmark_id: \`contextual-choice-adaptation\`
- capability_direction: improve stability under incomplete information, conflicting rules, and finite choices
- runs: \`3\`
- desired_score: \`>=95\`
- candidate_round_limit: \`5\``,
      },
      dailyPlan: {
        label: "A 9am daily planning check-in",
        desc: "09:00 every day: talk through the day's plan in this same chat, and review yesterday's progress",
        prompt:
          "Set up a scheduled task: every day at 9am, in this same conversation, plan today's work " +
          "with me. Read back over the conversation first and say what yesterday's plan got done and " +
          "where it stuck, then offer an ordered shortlist for today with a line of reasoning each, " +
          "and write up what I confirm as a checklist.",
      },
      githubDigest: {
        label: "Daily GitHub project digest",
        desc: "A daily pass over one repo's issues, PRs and CI, ending in prioritized recommendations",
        prompt:
          "Set up a scheduled task: every morning, use gh to digest one GitHub repo's issues, PRs " +
          "and CI — surface what has stalled, what is waiting on review and what is failing — and " +
          "end with recommendations ranked by priority, each saying why it sits where it does.",
      },
      memoryReview: {
        label: "Friday memory review",
        desc: "Friday evening: go through what is worth remembering from the week and write it into Memory",
        prompt:
          "Set up a scheduled task: every Friday evening, in this same conversation, go through " +
          "what is worth remembering from the week with me. Check the existing memory index first so " +
          "nothing is duplicated, then take it item by item — what to record, what to revise — and " +
          "write what I confirm into Memory.",
      },
    },
    sessionList: "Sessions",
    defaultSessionTitle: "New chat",
    agent: "Agent",
    model: "Model",
    workspace: "Workspace",
    workspaceHint:
      "Leave empty for an auto-created temporary workspace; if set, it must be an existing directory on the server",
    /** The same rule as `workspaceHint`, short enough to sit under a form field. */
    workspaceHintShort: "Leave empty for a temporary workspace",
    approvalMode: "Approval mode",
    approvalModeNames: {
      "allow-all": "Approve everything",
      "deny-all": "Deny everything",
      "read-only": "Approve read-only",
      "always-ask": "Ask every time",
    } as Record<string, string>,
    approvalModes: {
      "allow-all": "Approve everything (allow-all)",
      "deny-all": "Deny everything (deny-all)",
      "read-only": "Approve read-only (read-only)",
      "always-ask": "Ask every time (always-ask)",
    } as Record<string, string>,
    statusRunning: "Running",
    statusCompacting: "Compacting",
    /** Settled Session that finished since the user last opened it (the unread dot; a Session already read shows no glyph, so it needs no label). */
    statusCompletedUnread: "Done, unread",
    pendingApprovals: (n: number) => `${n} pending approval${n > 1 ? "s" : ""}`,
    jumpToLatest: "Jump to latest",
    /** Top-of-stream affordance while the previous history window is being fetched (scroll-up backfill). */
    loadingEarlier: "Loading earlier messages…",
    /** Top-of-stream affordance after a backfill failure: click to retry fetching the previous window. */
    loadEarlierRetry: "Failed to load earlier messages — click to retry",
    /** Top-of-stream marker once the loaded history reaches the very beginning (shown only after a backfill happened). */
    historyBeginning: "Beginning of conversation",
    /** Conversation minimap (tick rail over the stream's left gutter): rail aria-label. */
    outlineTitle: "Outline",
    /** Tick accessible name: turn number + the question (or the no-text placeholder). */
    outlineTickLabel: (n: number, question: string) => `Turn ${n}: ${question}`,
    /** Entry label when the prompt had no text body (image / attachment-only message). */
    outlineNoText: "(image or attachment)",
    /** Answer-preview placeholder while the latest turn is still running with no reply text yet. */
    outlineAnswering: "Answering…",
    inputPlaceholder: "Type a message. Enter to send, Shift+Enter for newline, paste images",
    inputPlaceholderShort: "Type a message…",
    /** Placeholder while a Task is running (mid-run steering): the message is delivered between turns with the next request. */
    steerPlaceholder: "Message the running agent — delivered with the next turn",
    steerPlaceholderShort: "Message the running agent…",
    steerSend: "Send to the running agent",
    /** Queued hint shown after a successful steer, until the steering message appears in the stream. */
    steerQueuedIndicator: "Steering queued — delivered with the next turn",
    /** Same hint, with the queued message's content (from the server's undelivered-steering mirror; survives reloads). */
    steerQueuedItem: (content: string) =>
      `Steering queued — delivered with the next turn: ${content}`,
    /** Label of the [user_steering] chip (a mid-run user message delivered between turns). */
    userSteering: "User steering",
    /** Mid-run send-mode setting: steer (delivered mid-run) vs follow-up (queued until the run ends). */
    steerModeLabel: "Mid-run send mode",
    steerModeSteer: "Steer",
    steerModeSteerHint: "Steer now: delivered to the running agent with the next turn",
    steerModeFollowUp: "Queue",
    steerModeFollowUpHint:
      "Queue a follow-up: sent automatically as a new message when this run finishes",
    followUpPlaceholder: "Queue as the next message — sent automatically when this run finishes",
    followUpPlaceholderShort: "Queue as the next message…",
    followUpSend: "Queue as the next message",
    /** Server-side queued follow-up count (auto-sent once the current run finishes). */
    followUpQueuedChip: (n: number) =>
      `${n} follow-up ${n === 1 ? "message" : "messages"} queued — sent when this run finishes`,
    /** One queued follow-up's hint line, with its content (per-entry variant of followUpQueuedChip). */
    followUpQueuedItem: (content: string) =>
      `Follow-up queued — sent when this run finishes: ${content}`,
    /** Accessible name of the recall control on a queued steering / follow-up line — it is icon-only (a curved-back arrow), so this is what names it for screen readers (#287). */
    recallQueued: "Recall",
    /** Its tooltip: what the icon does, spelled out. */
    recallQueuedTitle: "Recall to the input box to edit and resend",
    send: "Send",
    stop: "Stop",
    compact: "Compact context",
    approve: "Allow",
    deny: "Deny",
    decisionAllow: "Approved",
    decisionDeny: "Denied",
    decisionManual: "manual",
    decisionAuto: "auto",
    decisionPolicy: "policy",
    thinking: "Thinking",
    subagent: "Subagent",
    subagentRunning: "Running",
    /**
     * Abort banner (user interruptions only). The cause localizes from `errorCode`;
     * `errorMessage` (raw, untranslatable) rides verbatim. A legacy Trace without a code
     * renders its English `reason` prose as-is.
     */
    aborted: (item?: { errorCode?: string; errorMessage?: string; reason?: string }) => {
      const cause =
        item?.errorCode === "user_abort"
          ? "aborted by user"
          : item?.errorCode === "backoff_interrupted"
            ? "aborted during reconnect backoff"
            : item?.errorCode === "compaction_interrupted"
              ? "aborted during compaction"
              : (item?.errorCode ?? item?.reason ?? "");
      const text = cause ? `${cause}${item?.errorMessage ? `: ${item.errorMessage}` : ""}` : "";
      return `[Aborted]${text ? `: ${text}` : ""}`;
    },
    /**
     * Reconnect hint line; `secondsLeft` (waiting state only) switches to the live-countdown
     * wording. `retryable` is the live status; the finer spellings only appear when
     * replaying Traces written before the stop-reason convergence.
     */
    reconnect: (
      status: "retryable" | "failed" | "timeout" | "malformed",
      state: "waiting" | "retried" | "gaveUp",
      attempt: number,
      secondsLeft?: number,
      errorMessage?: string,
      errorCode?: string,
    ) => {
      // The live protocol carries the classified cause on error_code; the legacy status
      // spellings (failed/timeout/malformed) say the same thing for pre-convergence Traces.
      const kind = errorCode ?? status;
      const cause =
        kind === "timeout"
          ? "Connection timed out"
          : kind === "malformed"
            ? "Response incomplete or unparseable"
            : kind === "network"
              ? "Network or service temporarily unavailable"
              : kind === "failed"
                ? "The model provider returned an error"
                : "The request failed";
      const action =
        state === "gaveUp"
          ? `giving up after attempt ${attempt}${errorMessage ? `: ${errorMessage}` : ""}`
          : state === "retried"
            ? `retry #${attempt} sent`
            : secondsLeft !== undefined
              ? `retry #${attempt} in ${secondsLeft}s…`
              : `starting retry #${attempt}…`;
      return `[Retry] ${cause}; ${action}`;
    },
    /** Run-ending LLM failure banner (request_end status fatal); the provider's error text rides verbatim. */
    llmError: (errorMessage?: string) =>
      `[Error]: llm request error${errorMessage ? `: ${errorMessage}` : ""}`,
    /** "Retry now" on the reconnect countdown (skips the remaining backoff wait). */
    reconnectRetryNow: "Retry now",
    /** "Give up" on the reconnect countdown (the ordinary session abort). */
    reconnectGiveUp: "Give up",
    imageAlt: "Image uploaded by user",
    toolImageAlt: "Image from tool output",
    imagesAsPathHint:
      "This model cannot view images directly: on send, images are saved to the session scratchpad and passed as file paths (viewed via describe_image)",
    infoPanel: "Session info",
    sessionStats: "Stats",
    /** Info-dropdown Session id row: the id itself is a click-to-copy button. */
    sessionIdLabel: "Session id",
    copySessionId: "Copy Session id",
    /** Info-dropdown list of background processes the conversation started, and its per-row actions (Stop on running rows, Remove on exited ones). */
    processList: "Processes",
    processStop: "Stop",
    processExited: "exited",
    processRemove: "Remove",
    /** Remove button tooltip: removal also drops the output captured from that process. */
    processRemoveHint: "Remove this entry — the output captured from it is discarded too",
    /** Header chip title: count of the conversation's still-running background processes. */
    runningServices: (n: number) => (n === 1 ? "1 running service" : `${n} running services`),
    statTokens: "Total Tokens",
    /** Info-dropdown stats list: the tokens bullet's label and its cache-hit-rate parenthetical (rate = cacheRead ÷ all input, e.g. "68%"). */
    statTotalTokens: "Total Tokens",
    statCacheHit: (pct: string) => `cache hit rate ${pct}`,
    statElapsed: "Elapsed",
    statInput: "Input tokens",
    statCached: "cached",
    statOutput: "Output tokens",
    statTps: "Output TPS",
    /** Copied-stats-line parenthesis wrappers around the cached amount (ASCII with a leading space for en). */
    statParenOpen: " (",
    statParenClose: ")",
    noSessions: "No Sessions yet",
    emptyStream: "Send a message to start the conversation",
    historyLoadFailed: "Failed to load history",
    statsLabel: "Stats",
    removeImage: "Remove image",
    openAgents: "Agents panel",
    /** Panel switcher (chat toolbar top-right): the "create" dropdown and its pin toggles. */
    workspacePanel: "Workspace",
    filesInMessage: (n: number) => `${n} ${n === 1 ? "file" : "files"}`,
    imagesInMessage: (n: number) => `${n} ${n === 1 ? "image" : "images"}`,
    openPreview: "Click to preview",
    showMoreFiles: (n: number) => `Show ${n} more ${n === 1 ? "file" : "files"}`,
    showLess: "Show less",
    memoryChangesTitle: (n: number) => `${n} memory ${n === 1 ? "update" : "updates"}`,
    memoryScopeWorkspace: (key: string) => `Workspace memory (${key})`,
    memoryOpWrite: "Wrote",
    memoryOpEdit: "Edited",
    memoryViewTitle: "Memory",
    memoryChangedMark: "Changed in this conversation",
    memoryContentUnavailable: "Content unavailable (the file may have been moved or deleted)",
    memoryRowOpen: "View content",
    memoryBack: "Back to the list",
    memoryEmptyAll: "No memory yet — say “remember …” in a chat to have the agent save one",
    /** Visible label on the Memory panel's header link (not a tooltip-only glyph): says what the click does and where it lands. */
    openAgentMemory: "Manage in agent settings",
    memoryShowMore: (n: number) => `Show ${n} more`,
    /** Sidebar group pagination (#139): the pager's step buttons and the "2/5" readout's accessible name. */
    prevGroupPage: "Previous groups",
    nextGroupPage: "Next groups",
    groupPagePosition: (page: number, total: number) => `Page ${page} of ${total}`,
    contextUsage: "Context usage",
    contextUnknown: "Context usage: unknown until the next request reports it",
    contextComposition: "Context composition",
    contextPartSystemPrompt: "System prompt",
    contextPartToolDefs: "Tool definitions",
    contextPartUserMessages: "User messages",
    contextPartAssistantMessages: "Model messages",
    contextPartToolRequests: "Tool requests",
    contextPartToolResults: "Tool results",
    contextTopTools: "Top 5 tools",
    contextCompactAt: (n: string): string => `Compaction threshold ${n}`,
    contextTopToolsHint:
      "Ranked by the context each tool's calls and results occupy (definitions count under “Tool definitions”)",
    contextUnknownHint:
      "Just compacted — the next request reports the usage, and the composition with it",
    contextBreakdownEmpty: "Nothing in the current context to break down yet",
    contextBreakdownFailed: "Could not read the context composition",
    slashHint: "Type / for commands",
    switchAgent: "Hand off to another agent — opens a new session on send",
    switchAgentTitle: "Choose agent",
    agentSearchPlaceholder: "Search agents: id / name",
    agentsNoMatch: "No matching agents",
    handoffTargetTitle: (agent: string) => `Sending hands this conversation to ${agent}`,
    handoffRemove: "Remove handoff target",
    skillsSelect: "Skills",
    skillRemove: "Remove skill",
    skillsSearchPlaceholder: "Search skills",
    skillsNoMatch: "No matching skills",
    skillsEmptyHint: "No skills installed yet — add some from the skill library",
    skillsAutoMessage: (names: string[]): string =>
      names.length === 1 ? `use the ${names[0]} skill` : `use the ${names.join(", ")} skills`,
    handoffFrom: (agent: string) => `Handed off from ${agent}'s conversation`,
    handoffBack: (title?: string) =>
      title ? `Back to the original conversation: ${title}` : "Back to the original conversation",
    switchModel: "Switch model — on send, continues this conversation in a new session",
    switchModelTitle: "Switch model",
    modelSwitchTargetTitle: (model: string) => `Sending continues this conversation on ${model}`,
    modelSwitchRemove: "Remove model switch",
    modelSwitchBusyHint:
      "The model switch waits for this turn to finish: the new session continues from this session's record",
    modelSwitchFrom: (prevModel?: string) =>
      prevModel
        ? `Switched model (was ${prevModel}) — continued from the earlier conversation`
        : "Switched model — continued from the earlier conversation",
    modelSwitchAutoMessage: "Continue this conversation on the new model",
    /** Toast when the session-state (locked) model display is clicked: points at the `/model` command. */
    modelLockedHint: "Type /model to switch models",
    scheduledFrom: (name: string) => `Triggered by scheduled task "${name}"`,
    /** One-line notice of a `[background_task_done]` harness message (run_in_background completion): the collapsed row's whole label. */
    backgroundDone: (kind: "command" | "subagent", status: "completed" | "failed" | "stopped") => {
      const what = kind === "command" ? "Background command" : "Background task";
      if (status === "stopped") return `${what} stopped`;
      return status === "completed" ? `${what} finished` : `${what} failed`;
    },
    emptyGreeting: "Start a new conversation",
    /** Unified step-row titles (same header idiom as workRunning/workDone). */
    mcpConnectTitle: "MCP connect",
    mcpServerList: (servers: string[]): string => servers.join(", "),
    /** One-line result detail: tool count, plus the NAMES of failed servers (reasons live in the expanded server groups). */
    mcpConnectResult: (toolCount: number, failed: string[]): string => {
      const parts: string[] = [];
      if (toolCount > 0 || failed.length === 0) {
        parts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"} discovered`);
      }
      if (failed.length > 0) parts.push(`unavailable: ${failed.join(", ")}`);
      return parts.join("; ");
    },
    /** Per-server group row meta inside the expanded connect row. */
    mcpToolsCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    mcpServerFailed: "connection failed",
    mcpConnectAborted: "interrupted — reconnects on the next send",
    compactionTitle: (mode: string): string => (mode === "discard" ? "Clear" : "Compaction"),
    compactionFailed: (status: string, errorMessage?: string): string => {
      if (status === "aborted") return "aborted, keeping current context";
      const detail = errorMessage !== undefined ? ` (${errorMessage})` : "";
      // retryable = abandoned this time, the standing trigger retries it; fatal = a config
      // or credential change has to come first. Legacy Traces spell both "failed".
      if (status === "retryable") {
        return `failed${detail}, keeping current context; retries at the next trigger`;
      }
      if (status === "fatal") {
        return `failed${detail}, keeping current context; fix the model configuration to retry`;
      }
      return `failed${detail}, keeping current context`;
    },
    unknownTool: "(unknown tool)",
    workRunning: "Running",
    workDone: "Done",
    workGroupSteps: (n: number) => `${n} ${n === 1 ? "step" : "steps"}`,
    approvalWaiting: "awaiting approval",
    copyCode: "Copy code",
    copyReply: "Copy reply",
    forkSession: "Fork chat from here",
    forkSessionConfirmBody:
      "This copies the conversation up to this reply into a new chat. The original chat stays unchanged.",
    forkSessionConfirmAction: "Fork",
    forkSessionFailed: "This reply could not be located. Refresh and try again.",
    copyMessage: "Copy message",
    deleteSession: "Delete chat",
    renameSession: "Rename chat",
    renameSessionLabel: "Title",
    deleteSessionConfirm: (title: string) =>
      `Delete "${title}"? Its messages and Trace will be removed permanently.`,
    /** Parked draft conversations (unsent new chats living in the sidebar list — see draft-sessions.ts). */
    draftGroup: "Drafts",
    draftUntitled: "(untitled draft)",
    deleteDraft: "Delete draft",
    deleteDraftConfirm: (title: string) =>
      `Delete draft "${title}"? Unsent content will be discarded.`,
    archiveSession: "Archive",
    unarchiveSession: "Unarchive",
    /** Per-row ellipsis overflow menu (pin / rename / archive / delete live inside it) and the row-level pin. */
    pinSession: "Pin",
    unpinSession: "Unpin",
    pinnedSession: "Pinned",
    /** The hover ellipsis button that opens the row's full context menu. */
    moreActions: "More",
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "More",
    /** Per-group reveal row: n = conversations THIS group still hides (one click reveals/loads one page more). */
    expandRestSessions: (n: number) => `Show ${n} more ${n === 1 ? "chat" : "chats"}`,
    /** Time mode's whole-list paging row: its buckets span every Agent, so one row below them fetches the next page rather than each bucket claiming to. */
    loadMoreSessions: "Load more chats",
    /** Collapsed sidebar folders inside a group (lazy-loaded); the count is the group's exact server share. */
    folderGroups: {
      subagent: (n: number) => `Subagents (${n})`,
      schedule: (n: number) => `Scheduled (${n})`,
      archived: (n: number) => `Archived (${n})`,
    },
    skillsBanner: (names: string[]): string =>
      `Using skill${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    attachedFilesBanner: (names: string[]): string =>
      `Attached file${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
    /** Composer "+" extension menu (image upload, file attachment, goal mode) and the goal chip. */
    plusMenu: "More input options",
    uploadImage: "Upload image",
    uploadImageDesc: "Attach images to this message",
    uploadFile: "Upload file",
    uploadFileDesc: "Saved to the session scratchpad; the model reads them by path",
    removeFile: "Remove file",
    attachmentTooLarge: (name: string, limitMb: number): string =>
      `${name} exceeds the ${limitMb}MB limit and was not attached.`,
    /** Overlay covering the chat area while files are dragged over it (drag-and-drop upload). */
    dropFilesTitle: "Drop files to attach",
    dropFilesDesc: "Images and files are added to the message draft",
    /** Toast when non-image files are dropped in goal mode (the objective carries images only). */
    dropFilesGoalHint: "Goal mode takes images only; the files were not attached.",
    goalMode: "Goal mode",
    goalModeDesc: "Loop until the goal completes",
    goalBudgetLabel: "Token budget",
    goalBudgetUnlimited: "Budget unlimited",
    goalBudgetValue: (value: string): string => `Budget ${value}`,
    goalBudgetPlaceholder: "e.g. 500k",
    goalBudgetHint: "Use a k/m suffix; leave blank for no budget limit",
    goalBudgetInvalid:
      "Invalid budget: use a positive number with an optional k/m suffix (500k, 2m)",
    goalBudgetSave: "Save budget",
    goalRemove: "Exit goal mode",
    goalRoundBanner: (round: number): string => `Goal · round ${round}`,
    /** Later rounds collapse the objective's images into this chip (round 1 shows them in full). */
    goalRoundImages: (count: number): string =>
      count === 1 ? "1 attached image" : `${count} attached images`,
    goalProgress: (rounds: number, tokens: string): string => `round ${rounds} · tokens ${tokens}`,
    goalStatus: {
      active: "running",
      complete: "complete",
      blocked: "blocked",
      budget_limited: "budget exhausted",
      aborted: "interrupted",
    } as Record<string, string>,
  },

  /** Feishu-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  feishu: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the Feishu bot flow into this conversation, and the AI's replies are sent back to Feishu as plain text. You need a self-built Feishu app with the bot capability and the message-receive event subscribed in long-connection mode.",
    appId: "App ID",
    appSecret: "App Secret",
    /** Shown while a saved secret exists: submitting an empty field keeps it. */
    appSecretKeepHint: "Leave empty to keep the saved App Secret",
    /** The stored-secret row's clear checkbox (the models-page clear idiom). */
    clearSecret: "Clear stored App Secret",
    baseDomain: "API domain",
    baseDomainHint: "https://open.feishu.cn for Feishu, https://open.larksuite.com for Lark",
    invalidDomain: "The domain must be an http(s) URL",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat: "Message the bot once in Feishu first, so it knows which chat to send to",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Create a self-built app in the Feishu developer console",
      "Enable the bot capability for the app",
      "Subscribe to the message-receive event, with the subscription mode set to long connection",
      "Copy the App ID and App Secret from the credentials page into the form above",
      "Publish an app version, get it approved, then message the bot once in Feishu",
    ],
  },

  /** Telegram-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  telegram: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the Telegram bot flow into this conversation, and the AI's replies are sent back to Telegram as plain text. Create a bot with @BotFather and paste its Bot Token — no public URL is needed.",
    botToken: "Bot Token",
    /** Shown while a saved token exists: submitting an empty field keeps it. */
    botTokenKeepHint: "Leave empty to keep the saved Bot Token",
    /** The stored-token row's clear checkbox (the models-page clear idiom). */
    clearToken: "Clear stored Bot Token",
    /**
     * The Bot Token field's corner link. Telegram has no developer console — the token is
     * issued by @BotFather inside the app — so this channel names the destination instead
     * of borrowing the shared "open developer console" label.
     */
    openBotFather: "Open @BotFather",
    invalidToken: "The Bot Token looks like <digits>:<secret>, as issued by @BotFather",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat: "Message the bot once in Telegram first, so it knows which chat to send to",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Open @BotFather in Telegram and send /newbot to create a bot",
      "Name it as prompted, then copy the Bot Token @BotFather returns into the form above",
      "Find the bot in Telegram and send it one message",
    ],
  },

  /** QQ-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  qq: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the bot in QQ flow into this conversation, and the AI's replies are sent back to QQ. Create a bot on the QQ open platform and set its event subscription to WebSocket — no public URL is needed.",
    appId: "App ID",
    appSecret: "App Secret",
    /** Shown while a saved secret exists: submitting an empty field keeps it. */
    appSecretKeepHint: "Leave empty to keep the saved App Secret",
    /** The stored-secret row's clear checkbox (the models-page clear idiom). */
    clearSecret: "Clear stored App Secret",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat: "Message the bot once in QQ first, so it knows which chat to send to",
    /**
     * The rule that shapes this whole channel, stated where it is first needed rather than
     * left for the user to infer from a reply that never arrives.
     */
    repliesOnly:
      "QQ only lets a bot reply to a message you just sent it — it cannot start one. So a turn you begin in the web app is not mirrored to QQ, and once a few minutes have passed since your last QQ message, replies can no longer be delivered either. Send the bot another message in QQ to continue.",
    /** The passive-reply budget, in the terms a user experiences it. */
    replyBudget:
      "One QQ message can receive at most 4 replies (5 in a group). When a run produces more than that, the last one carries the rest combined — nothing is lost, it just arrives as a single message.",
    /** Scan-to-connect: the button, and the states it moves through. */
    scanStart: "Connect by QR",
    scanStarting: "Generating code…",
    /** In the setup fold: what scanning saves the user, in one line. */
    scanHint:
      "Or connect by QR: authorize in QQ by scanning, with no App ID or App Secret to copy by hand.",
    scanQrLabel: "QQ bot authorization QR code",
    scanWaiting: "Waiting to be scanned in QQ…",
    scanSteps:
      "Scan the code with QQ on your phone, then pick the bot to authorize on the page it opens and confirm.",
    /** Shown only after a code has actually lapsed and been replaced. */
    scanRefreshed: "The previous code expired; this is a new one.",
    /** Why the secret is safe to obtain this way — the question a careful user will ask. */
    scanPrivacy:
      "The credentials are received and stored by the server; the decryption key never reaches this browser.",
    scanDone: (appId: string): string =>
      `Saved the credentials for bot ${appId} — the connection can be enabled now`,
    scanFailed: (reason: string): string => `Scan-to-connect failed: ${reason}`,
    /** Shown when replacing lapsed codes stopped being worth another round trip. */
    scanExpiredRepeatedly:
      "The code kept expiring before it could be scanned. Try starting a new scan in a moment.",
    /** Why the scan button is gated while this channel holds the connection. */
    scanDisableFirst: "Disable the connection before rebinding by scan",
    /** Separates the scan path from the manual one; the fields below are the fallback, not the default. */
    scanOrManual: "Or enter them by hand",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Register as a developer on the QQ open platform and create a bot",
      "Copy the App ID and App Secret from the development settings page into the form above",
      "Set the event subscription mode to WebSocket — leave the callback URL empty",
      "Add your own QQ account or a test group to the sandbox allowlist",
      "Find the bot in QQ and send it one message",
    ],
  },

  /**
   * Session ↔ messaging-bot binding: the dock panel, the row action + dialog, and the
   * channel-neutral editor strings (per-channel fields live under `feishu` / `telegram` /
   * `qq`).
   */
  messaging: {
    panelTitle: "Messaging",
    /** Session-row context-menu action (the trailing ellipsis marks that a dialog follows). */
    bindAction: "Messaging binding…",
    dialogTitle: "Messaging binding",
    /** The channel selector (always live: each channel's config is saved independently). */
    channelLabel: "Channel",
    channelName: {
      feishu: "Feishu",
      telegram: "Telegram",
      qq: "QQ",
    },
    /**
     * Shared link labels: the tutorial (in the setup FAQ fold) and, at the credential field's
     * corner, the developer console — the latter only for the channels that have one. A
     * channel whose credential is issued elsewhere names that destination itself (Telegram's
     * `telegram.openBotFather`).
     */
    tutorial: "Open tutorial",
    console: "Open developer console",
    /** The connection toggle (flips immediately, using the stored credentials). */
    enabled: "Enable connection",
    /** The toggle's own tooltip: the switch IS the bind/unbind control, which a label reading "enable" does not say. */
    bindByEnableHint:
      "Enabling binds this bot to this conversation; turning it off releases it. The credentials stay saved either way.",
    /** Why the toggle is gated while the form has unsaved edits. */
    saveBeforeEnable: "Save the credentials first, then enable the connection",
    test: "Test connection",
    testing: "Testing…",
    testOk: (ms: number): string => `Connected (${ms}ms)`,
    /** Success feedback naming the account the credentials sign in as (Telegram: the bot's @username). */
    testOkAs: (account: string, ms: number): string => `Connected as ${account} (${ms}ms)`,
    testFail: (reason: string): string => `Connection failed: ${reason}`,
    /** Second line on a successful Telegram test whose bot still has Group Privacy on; the remedies live in the troubleshooting fold, which outlasts a toast. */
    testPrivacyOn:
      "Group Privacy is on for this bot: it receives no ordinary messages in any group where it is not an administrator. See Troubleshooting below.",
    sendTestMessage: "Send test message",
    sendingTestMessage: "Sending…",
    testMessageSent: "Test message sent",
    statusLabel: "Connection status",
    status: {
      disconnected: "Not connected",
      connecting: "Connecting",
      connected: "Connected",
      error: "Connection error",
    },
    /** Why the enable switch is gated while the OTHER channel holds the connection. */
    otherEnabledHint: (other: string): string =>
      `Only one channel can be enabled per conversation: turn off the ${other} connection first`,
    /** Why the enable switch is gated while the selected channel has no stored credential. */
    credentialMissingHint: "Enter and save the credential first, then enable the connection",
    /** Why the clear checkbox is gated while the channel's connection is enabled. */
    disableBeforeClearHint: "Disable the connection before clearing the credential",
    /** The saved delivery option: one message per non-blank line of a reply. */
    linePerMessage: "One message per line",
    /** Its disclosure, beside the label: what the option does to a reply, and its two edges. */
    linePerMessageHelp:
      "Each non-blank line of a reply is sent as its own message and blank lines are dropped, so an answer written as several spoken lines arrives as several messages. Past a per-reply limit the remaining lines are combined into one last message rather than dropped, and a line longer than the channel allows is still split. The messages go out about a second apart, the pace a chat platform allows.",
    /** The saved delivery option: hold a run's working notes, send its last reply only. */
    finalReplyOnly: "Final reply only",
    /** Its disclosure, beside the label: what the option changes, and what it costs. */
    finalReplyOnlyHelp:
      "Only the last thing the assistant says in a run is sent, when the run ends. The notes it writes between tool calls stay in the web app instead of arriving as their own messages, so the chat receives the answer rather than the work — at the cost of hearing nothing while a long run is under way. The approval reminder is not a reply and still arrives immediately. With one message per line also on, that final reply is the one that is split.",
    /**
     * QQ only, and said twice there: appended to the option's explanation for the reader
     * deciding, and stood under the row as a warning strip while the switch is on. Not a
     * nuance of the same trade but a different outcome: QQ can only send a passive reply
     * anchored to an inbound message, and that anchor expires. On the other two channels the
     * cost of holding the reply is silence; here a run that outlasts the window delivers
     * nothing at all — too much to rest on a "?" the user need never open, which would leave
     * them to discover it from an empty chat.
     */
    finalReplyOnlyQQWarning:
      "On QQ this needs a second thought: QQ only accepts a passive reply anchored to an inbound message, and that anchor expires after about five minutes. Holding the reply until the run ends means a run that outlasts the window delivers nothing at all — with this off, at least whatever finished inside the window arrives.",
    /** Enabled-row indicator's tooltip / sr text (the small per-channel glyph on the session row). */
    enabledIndicator: {
      feishu: "Feishu connection enabled",
      telegram: "Telegram connection enabled",
      qq: "QQ connection enabled",
    },
    /**
     * Delivery observability under the toggle: has anything arrived, and did the last one get
     * through. Both readings belong to the LIVE CONNECTION and start over on a re-enable or a
     * credential save, so the empty case names that scope instead of reading as "never".
     * Each failure line carries its own time: nothing clears it on a later success, and a
     * title= is unreachable on touch.
     */
    inboundLastAt: (when: string) => `Last message received: ${when}`,
    inboundNone: "No message has arrived since this connection opened",
    deliveryFailedInbound: (when: string, detail: string) =>
      `A message arrived at ${when} but its task never started: ${detail}`,
    deliveryFailedSend: (when: string, detail: string) =>
      `The task ran but its reply failed to go out at ${when}: ${detail}`,
    /** A connection failure the connection has since recovered from (lastError is gone by then). */
    lastConnectionError: (when: string, detail: string) =>
      `The connection dropped at ${when}: ${detail}`,
    /** The collapsed FAQ folds below the save area. */
    faqSetupTitle: "Set up the bot",
    faqWhatTitle: "What binding does",
    /** The channel-neutral half of that fold: how the same bot moves between conversations. */
    faqWhatBinding:
      "The same bot can stay saved in several conversations, but only one of them may have its connection enabled at a time. To move it, turn the connection off where it is on and enable it here — no credential has to be deleted.",
    faqTroubleTitle: "Troubleshooting",
    /** Troubleshooting entries (bot must be messaged once; connection errors point at credentials; one poller per Telegram token; Telegram Group Privacy withholds group messages from a non-admin bot; QQ answers only a message just sent). */
    troubleNoChat:
      "“Send test message” disabled? The bot must have received one message first, so it knows which chat to send to.",
    troubleConnError:
      "Connection status shows an error? Check the credentials; for Feishu also confirm the API domain and the long-connection event subscription.",
    troubleOnePoller:
      "Telegram reports that another program is polling? A Bot Token serves exactly one program at a time — close the other PenguinHarness server or bot script using it, or give this conversation a bot of its own. A getUpdates you run by hand (a curl to see what Telegram has queued) is that other program too: disable the connection here before running one. Inspecting them by hand can also discard them — any call you pass an offset to confirms everything before it, and the app's own next connect drops the backlog — so retest with a freshly sent message rather than the ones you just looked at.",
    troubleGroupPrivacy:
      "The bot ignores everything you say in a Telegram group? Telegram's Group Privacy is on by default, and under it a bot that is not an administrator of the group receives only commands addressed to it (such as /start@your_bot) and replies to its own messages — ordinary group messages are never delivered at all, and the connection itself looks perfectly healthy. Making the bot an administrator of that group fixes it on its own, since administrators always receive every message. Otherwise turn Group Privacy off with /setprivacy in @BotFather, then remove the bot from the group and add it back — a group it is already in does not pick up the change.",
    /** The QQ-only failure a user will otherwise read as "the bot is broken". */
    troubleQQPassive:
      "No replies arriving in QQ? QQ only lets a bot answer a message you just sent: a turn started in the web app is not mirrored there, and replies stop being deliverable a few minutes after your last QQ message. Send another message in QQ to continue.",
    troubleNoGroupInbound:
      "Sending in a group but the panel still says no message has arrived? Read that line as evidence only about a message sent after it: it covers the current connection alone, and disabling and re-enabling the connection — or saving the credential again — opens a new one and starts it over. So send a fresh one now. If the line still reports nothing, Telegram is not delivering it and nothing on this machine can change that: confirm the bot is still in that group; if you have just turned Group Privacy off in @BotFather, remove the bot from the group and add it back, because an existing group does not pick up the change; and confirm nothing else is polling the same token — including a getUpdates you ran yourself (see above). Telegram channel posts are not supported either — this connection handles groups and direct chats only.",
  },

  /** Subagents side panel: call-graph of the latest Task + the selected child conversation. */
  subagentPanel: {
    topologyLabel: "Call graph",
    mainSessionNote: "The main conversation stays in the chat area",
    empty: "No subagents in the current task yet",
    nodeRunning: "running",
    nodeDone: "done",
    openAsSession: "Jump to this session",
    subagentGone: "This subagent session no longer exists and could not be revived",
  },

  files: {
    title: "Files",
    upload: "Upload",
    download: "Download",
    openInNewTab: "Open in new tab",
    previewNotIsolatedHint:
      "This address has no separate preview origin, so the page opens sandboxed: localStorage, cookies and third-party embeds will not work. Reach the app over 127.0.0.1 or localhost, or set PENGUIN_PREVIEW_ORIGIN.",
    refresh: "Refresh",
    root: "Workspace root",
    empty: "Empty directory",
    previewUnsupported: "Preview not supported for this type; download instead",
    uploaded: "Uploaded",
    /** Upload-overwrite confirmation: same-name files in the current directory will be replaced. */
    overwriteTitle: "Overwrite existing files",
    overwriteConfirm: (n: number): string =>
      `The current directory already has ${n} file(s) with these names — uploading will overwrite:`,
    loadFailed: "Failed to load",
    previewTruncated: "File too large; preview truncated, download for the full file",
    details: "Details",
    workspacePath: "Workspace path",
    htmlRendered: "Rendered",
    htmlSource: "Source",
    backToList: "Back to list",
  },

  usage: {
    title: "Costs & usage",
    today: "Today",
    last7d: "Last 7 days",
    total: "Total",
    tokens: "Tokens",
    requests: "Requests",
    from: "From",
    to: "To",
    colCacheRead: "cache_read",
    colCacheWrite: "cache_write",
    colOutput: "output",
    uncostedNote: "* Only models with configured pricing count toward cost",
    filterAllAgents: "All agents",
    filterAllModels: "All models",
    rangeLabel: "Date range",
    rangeHour: "Last hour",
    rangeDay: "Last 24 hours",
    range7d: "Last 7 days",
    range30d: "Last 30 days",
    range90d: "Last 90 days",
    rangeCustom: "Custom",
    chartRequestsByAgent: "Requests & success rate by agent",
    chartRequestsByModel: "Requests & success rate by model",
    legendSuccessRate: "Success rate",
    chartTokenTrend: "Token trend",
    chartCostTrend: "Cost trend",
    legendOther: (n: number): string => `Other (${n})`,
    bucketTotal: "Total",
    legendHitRate: "Cache hit rate",
    empty: "No usage records",
    errors: "Errors",
    errorsTotal: "Total",
    errorsUnexpected: "Unexpected",
    errorsExpected: "Expected",
    errorsTopCode: "Most common",
    errorsColCode: "Source · code",
    errorsColKind: "Type",
    errorsColMessage: "Message",
    errorsEmpty: "No errors",
    /** Detail-table pager: newer/older step back through pages of the same filtered set. */
    errorsNewer: "Newer",
    errorsOlder: "Older",
    errorsPageOf: (page: number, pages: number, total: number) =>
      `Page ${page} / ${pages} · ${total} total`,
  },

  /** The Trace panel's own view of a Trace file (trace-file-view / timeline-chart); the standalone browsing page these once also served is gone. */
  traces: {
    timeline: "Execution timeline",
    laneLLM: "Model",
    kindThinking: "thinking",
    kindModelReply: "model reply",
    kindToolGen: "tool call gen",
    legendToolExec: "tool exec",
    legendOther: "Other",
    toolParams: "Parameter schema",
    /** Spoken form of the red "*" in the schema table, where no control carries `aria-required`. */
    requiredParam: "required",
    legendApprovalWait: "approval wait",
    task: (n: number) => `Turn ${n}`,
    globalSummary: "Overall",
    tasksLabel: "Turns",
    messages: "Messages",
    truncatedNote: (shown: number, total: number) => `Showing first ${shown} / ${total} messages`,
    zoom: "Zoom",
    zoomReset: "Double-click to reset zoom",
    zoomOut: "Zoom out",
    zoomIn: "Zoom in",
    linkHint:
      "Hover a timeline segment or event row to cross-highlight, click a segment to jump to its message; legend highlights its kind; drag the bar below to pan/zoom",
    filesTitle: "Trace files",
    toolCalls: "Tool calls",
    taskInput: "Input tokens this turn",
    taskOutput: "Output tokens this turn",
    cacheHit: "Cache hits",
    hitRate: "Hit rate",
    compactions: "compactions",
    inProgress: "in progress",
    systemPrompt: "System prompt",
    toolDefs: (n: number) => `Tool definitions (${n})`,
    exportFile: "Export",
  },

  benchmark: {
    title: "Evaluation Center",
    selectBenchmark: "Select a Benchmark on the left",
    emptyAgent: "No Benchmarks for this agent",
    caseCount: (n: number): string => `${n} case${n === 1 ? "" : "s"}`,
    trendTitle: (metric: string): string => `${metric} over time`,
    cases: "Cases",
    viewCase: "View details",
    taskMaterials: "Task materials",
    rubric: "Scoring rubric",
    agentHidden: "Hidden from Target Agent",
    caseFileUnavailable: "Case files are unavailable",
    evaluations: "Evaluations",
    noEvaluations: "No evaluations yet",
    summaryLabel: "Summary",
    legendUnlabeled: "unlabeled model",
    colVersion: "Version",
    colModel: "Model ID",
    colThinkingLevel: "Thinking level",
    colScore: "Score",
    colDuration: "Duration",
    colCase: "Case",
    colRun: "Run",
    colSession: "Session",
  },

  errors: {
    networkError: "Network error, please check your connection",
    modelCredentialMissing: (modelId: string) =>
      `Model ${modelId} has no API key yet — configure it on the Models page first`,
    noDefaultModel: "This project has no default model yet — add one on the Models page first",
    /** Localized text for the common server error codes (server error messages are English-only); looked up by ApiError.code in apiErrorText, falling back to the raw message for unmapped codes. */
    byCode: {
      invalid_credentials: "Incorrect username or password.",
      too_many_attempts: "Too many failed sign-in attempts. Try again shortly.",
      password_mismatch: "The current password is incorrect.",
      invalid_password: "Password must be at least 8 characters.",
      admin_required: "Only an admin can perform this operation.",
      desktop_single_user: "The desktop app is single-user; user management is unavailable.",
      not_found: "This resource does not exist, or you do not have access.",
      internal: "The server hit an internal error. Please try again shortly.",
      agent_not_found: "This agent no longer exists.",
      unknown_agent: "That agent does not exist in this Project.",
      agent_exists: "This agent id is already taken.",
      agent_deleting: "This agent is being deleted.",
      project_exists: "This Project id is already taken.",
      project_not_found: "This Project no longer exists, or you do not have access.",
      cannot_delete_last_project: "This is the last Project and cannot be deleted.",
      user_exists: "This username is already taken.",
      user_not_found: "This user no longer exists.",
      cannot_delete_admin: "The built-in admin cannot be deleted.",
      member_not_found: "This user is not a member of the Project.",
      already_member: "This user is already a member of the Project.",
      already_owner: "This user is already an owner of the Project.",
      memory_import_confirm_required:
        "This import would overwrite or delete memories. Confirm it to continue.",
      schedule_exists: "A scheduled task with this name already exists.",
      schedule_not_found: "This scheduled task no longer exists.",
      unknown_skill: "This skill is not in the library.",
      skill_too_large: "This skill directory exceeds the import limits.",
      file_not_found: "This file no longer exists.",
      not_pending: "This steering message already reached the model and can no longer be recalled.",
      follow_up_started: "This follow-up already started and can no longer be recalled.",
      file_too_large: "The file is too large.",
      too_many_files: "Too many files attached to one message.",
      payload_too_large: "The request is too large.",
      image_too_large: "The image is too large to send inline.",
      dir_not_absolute: "The directory must be an absolute path.",
      dir_not_found: "That directory does not exist or is inaccessible.",
      not_a_dir: "That path is not a directory.",
      path_not_found: "That path does not exist.",
      workspace_missing: "This Session's Workspace no longer exists.",
      workspace_not_found: "That Workspace does not exist, or is not a directory.",
      session_not_found: "This Session no longer exists, or you do not have access.",
      session_deleting: "This Session is being deleted.",
      approval_not_found: "This approval request was already answered, or is no longer valid.",
      process_not_found: "This background process already exited, or was removed.",
      process_running: "This background process is still running — stop it before removing it.",
      memory_file_not_found: "This memory file no longer exists.",
      memory_scope_not_found: "This memory scope no longer exists.",
      task_in_progress: "This Session already has a task running.",
      compacting: "This Session is compacting its context and is not accepting new input.",
      shutting_down: "The server is shutting down. Please try again shortly.",
      // The three "cannot compact" reasons each have their own server code, so each keeps its
      // own explanation here — collapsing them into one sentence would tell a user who just
      // compacted that they have never spoken.
      compaction_not_configured: "This agent does not have context compaction configured.",
      nothing_to_compact:
        "There is nothing to compact in the current context yet (no completed conversation turn).",
      already_compacted:
        "The context was just compacted and nothing has been said since — no need to compact again.",
      version_conflict: "The snapshot's version is not newer than the current one.",
      invalid_title: "The title is invalid.",
      invalid_proxy_url:
        "Invalid proxy address — use an http(s):// or socks5:// proxy URL, or host[:port].",
      invalid_attachment_limit:
        "Invalid upload limit — use a whole number of MB inside the allowed range, with the total no lower than the per-file limit.",
      invalid_trace: "This file is not a valid Trace file.",
      trace_not_found: "This Trace file no longer exists.",
      trace_session_exists:
        "This agent already has a Session with that id; a duplicate Trace cannot be imported.",
      feishu_secret_required: "App Secret is required.",
      feishu_not_bound: "This Session has no Feishu binding yet.",
      feishu_no_chat: "No Feishu message received yet — message the bot once in Feishu first.",
      feishu_send_failed: "Sending the Feishu message failed.",
      telegram_token_required: "Bot Token is required.",
      telegram_token_invalid: "The Bot Token is malformed: it looks like <digits>:<secret>.",
      telegram_not_bound: "This Session has no Telegram binding yet.",
      telegram_no_chat:
        "No Telegram message received yet — message the bot once in Telegram first.",
      telegram_send_failed: "Sending the Telegram message failed.",
      another_channel_enabled:
        "Another channel's connection is enabled on this conversation: disable it first.",
      // Deliberately names nothing about the other conversation: it may live in a Project
      // this user cannot see, and the remedy does not depend on knowing which one it is.
      account_enabled_elsewhere:
        "This bot's connection is enabled on another conversation: turn it off there first.",
      messaging_disable_before_clear:
        "Disable this channel's connection before clearing its credential.",
      messaging_disable_before_scan:
        "Disable this channel's connection before rebinding it by scan.",
    },
  },
};
