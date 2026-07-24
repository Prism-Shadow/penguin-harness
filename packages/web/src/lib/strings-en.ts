/**
 * English dictionary (constrained by the `Strings` type to the same shape as zh):
 * locale switching goes through state/locale.tsx.
 * Keep domain term capitalization consistent with zh — Agent, Workspace, Token, Task, etc.
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
    usage: "Costs",
    traces: "Trajectory",
    benchmark: "Evaluation Center",
    // Collapsed-rail tooltips (product-specified wording; new chat reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "Last conversation",
    // Deliberately equal to nav.agents: the key exists for the zh-only wording difference (智能体 vs 智能体仓库).
    railAgents: "Agents",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    collapseGroup: "Collapse",
    expandGroup: "Expand",
    pinGroup: "Pin group",
    unpinGroup: "Unpin group",
  },

  settings: {
    language: "Language",
    theme: "Theme",
    themeLight: "Light",
    themeDark: "Dark",
    followSystem: "System",
    langZh: "中文",
    langEn: "English",
    fontSize: "Font size",
    fontSmall: "S",
    fontMedium: "M",
    fontLarge: "L",
    accent: "Accent",
    accentNames: {
      neutral: "Neutral",
      blue: "Blue",
      green: "Green",
      violet: "Violet",
      rose: "Rose",
      amber: "Amber",
    } as Record<string, string>,
  },

  common: {
    save: "Save",
    cancel: "Cancel",
    create: "Create",
    delete: "Delete",
    edit: "Edit",
    settings: "Settings",
    confirm: "Confirm",
    close: "Close",
    loading: "Loading…",
    loadMore: "Load more",
    saved: "Saved",
    saving: "Saving…",
    none: "(none)",
    retry: "Retry",
    unknownError: "Request failed, please try again later",
    requiredField: "This field is required",
    copied: "Copied",
    ownerOnly: "Only the owner can modify this",
  },

  auth: {
    loginTitle: "Sign in to PenguinHarness",
    username: "Username",
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
      "First run: sign in as the built-in admin (admin / penguin-2026), then change the password soon",
  },

  account: {
    changePassword: "Change password",
    oldPassword: "Current password",
    oldPasswordHint: "The built-in admin's default initial password is penguin-2026",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordMismatch: "New passwords do not match",
    initialPasswordBanner: "This account is using its initial password. Please change it soon.",
    changeNow: "Change now",
  },

  admin: {
    users: "Users",
    userId: "Username",
    role: "Role",
    roleAdmin: "Admin",
    roleUser: "User",
    createdAt: "Created",
    actions: "Actions",
    createUser: "Add user",
    initialPassword: "Initial password",
    initialPasswordFlag: "initial password",
    defaultProjectNote: (id: string): string => `A default Project will be created: ${id}`,
    resetPassword: "Reset password",
    resetPasswordTitle: (u: string): string => `Reset password for ${u}`,
    resetPasswordNote:
      "All sign-in sessions of this user will be revoked; they must sign in with the new password",
    deleteUser: "Delete",
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
    name: "Display name (optional, defaults to the Project id)",
    settings: "Project settings",
    settingsTitle: "Project settings",
    members: "Members",
    addMember: "Add member",
    memberUsername: "Username",
    memberRole: "Role",
    memberActions: "Actions",
    removeMember: "Remove",
    owner: "owner",
    member: "member",
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
    create: "Create Agent",
    createTitle: "Create Agent",
    id: "Agent id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    name: "Name",
    nameHint: "Leave empty to use the Agent id as the name",
    description: "Description",
    activeSessions: "Active Sessions",
    sessionCount: (n: number): string => `${n} session${n === 1 ? "" : "s"}`,
    toolCount: (n: number): string => `${n} tool${n === 1 ? "" : "s"}`,
    vaultKeyCount: (n: number): string => `${n} vault key${n === 1 ? "" : "s"}`,
    scheduleCount: (n: number): string => `${n} scheduled task${n === 1 ? "" : "s"}`,
    updatedAt: "Last modified",
    activity: (days: number): string => `${days}-day session activity`,
    settings: "Agent settings",
    backToList: "Back to Agents",
    tabOverview: "Overview",
    tabPrompt: "Prompt",
    tabRuntime: "Runtime",
    tabTools: "Tools",
    tabVault: "Vault",
    tabSchedules: "Schedules",
    stateDir: "State path",
    agentsMd: "AGENTS.md",
    systemPrompt: "system_prompt template",
    placeholdersTitle: "Available placeholders (click to insert)",
    insertPlaceholder: "Insert at the system_prompt cursor",
    /** Order must match the default system prompt (core default-config.ts DEFAULT_SYSTEM_PROMPT). */
    placeholders: [
      ["{{AGENTS_MD}}", "Injects the AGENTS.md content"],
      ["{{VAULT_KEYS}}", "Injects the vault key-name section (empty when no keys)"],
      ["{{PLATFORM}}", "Runtime platform"],
      ["{{OS_VERSION}}", "Operating system version"],
      ["{{DATE}}", "Current date"],
      ["{{CWD}}", "Absolute Workspace path"],
      ["{{AGENT_ID}}", "Current Agent id"],
      ["{{PROJECT_DIR}}", "Absolute Project directory (Agent State/scratchpad derive from it)"],
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
        "Enables the highest tier of extended reasoning; identical to high on some models.",
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
    builtinTools: "Built-in tools",
    toolName: "Name",
    toolPermission: "permission",
    permissionReadLabel: "Read-only",
    permissionReadDescription: "Only reads. Auto-approved when the approval mode is read-only.",
    permissionReadWriteLabel: "Read & write",
    permissionReadWriteDescription:
      "Can modify things. Needs manual confirmation when the approval mode is read-only.",
    toolTimeout: "timeoutMs",
    toolMaxOutput: "maxOutputLength",
    mcpServers: "MCP Servers (read-only)",
    defaultValue: "(default)",
    resetToDefault: "Reset to default",
    deleteAgent: "Delete Agent",
    builtinUndeletable: "Built-in Agents cannot be deleted",
    deleteConfirm: (name: string): string =>
      `Delete Agent "${name}"? Its directory (including all Traces) will be removed recursively and cannot be recovered.`,
    stateVersion: "Agent State version",
    transferTitle: "Export / import",
    transferDesc:
      "Export the current Agent State snapshot (tar.gz); importing overwrites the whole directory and adopts the version inside the package.",
    exportSnapshot: "Export snapshot",
    importSnapshot: "Import snapshot",
    importing: "Importing…",
    importDone: (v: number): string => `Import finished, Agent State version v${v}`,
    importConflictTitle: "Version conflict",
    importConflictBody:
      "The snapshot's version is not newer than the current one; importing will overwrite the existing Agent State. Continue?",
  },

  models: {
    title: "Models",
    addCustom: "Add custom model",
    addToGroup: "Add model",
    editTitle: "Model settings",
    addTitle: "Add model (OpenAI protocol)",
    addTitleVendor: "Add model (auto-routed by id)",
    addProtocolHint:
      "New models always use the OpenAI Chat Completions protocol (no auto-routing by model id); set the base URL to a compatible endpoint",
    addAutoRouteHint:
      "New models in this group are auto-routed by their upstream id to the vendor's official client: leave the base URL empty for the official endpoint, and an empty API key falls back to the resolved client's environment variable",
    autoRouteNone:
      "AgentHub cannot auto-route this id: double-check it, or add the model under Custom / a user-defined group with the OpenAI protocol",
    addGroup: "Add group",
    addGroupTitle: "Add group",
    addGroupDesc:
      "User-defined groups share Custom semantics: models use the OpenAI Chat Completions protocol (base URL required; an empty API key reads OPENAI_API_KEY). Groups live on model entries — the group appears once its first model is saved.",
    groupNameLabel: "Group name",
    groupNameHint: "Starts with a lowercase letter / digit; may contain - and _",
    groupNameInvalid:
      "Group names may only use lowercase letters, digits, - and _ (starting with a letter or digit), up to 32 characters",
    groupNameExists: "This name is taken by a built-in group or an existing entry",
    groupEmptyHint: "No models in this group yet; use “Add model” to create one",
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
    vision: "Vision support",
    visionOffProxyHint: "Images are read via the vision proxy model",
    visionBadge: "Vision",
    visionModelBadge: "Proxy vision",
    setVisionModel: "Set as proxy vision model",
    visionModelHint: "Describes images via describe_image for models without vision",
    priceUnitShort: "/M tok",
    testConnection: "Test connection",
    testing: "Testing…",
    testOk: (ms: number): string => `Connected (${ms} ms)`,
    testFailed: (msg: string): string => `Failed: ${msg}`,
    modelIdRenameHint: "Renaming migrates the existing config and API key",
    priceCacheRead: "Cache read price",
    priceCacheWrite: "Cache write price",
    priceOutput: "Output price",
    priceUnit: "per 1M tokens",
    currency: "Currency",
    currencyUsd: "USD $",
    currencyCny: "CNY ¥",
    currencyHint: "Prices convert at 1 USD ≈ 7 CNY; always stored in USD",
    firstModelDefault: "Set as the default model",
    credential: "Credential",
    apiKey: "API key",
    apiKeyKeepHint: "Leave empty to keep the current key",
    apiKeyEnvHint: (envKey: string): string => `Leave empty to use the ${envKey} env var`,
    useEnvVar: (envKey: string): string => `env ${envKey}`,
    keyConfigured: "Key configured",
    clearApiKey: "Clear stored API key",
    baseUrl: "Custom base URL",
    baseUrlHint: "Leave empty to use the provider default",
    baseUrlRequired: "A base URL is required",
    contextWindowDefaultHint: (n: number): string => `Defaults to ${n} if empty`,
    confirmDeleteTitle: "Delete model",
    confirmDelete: (name: string): string =>
      `Delete "${name}"? Its configuration and API key will be removed.`,
    groupApiKey: "Set API key for group",
    groupApiKeyTitle: (label: string): string => `Set the API key for ${label}`,
    groupApiKeyHint: (n: number): string =>
      `Applies to all ${n} models in this group; leave empty to keep them unchanged.`,
    getApiKey: "Get API key",
    getModelIds: "Get model IDs",
    groupKeyApplied: (n: number): string => `API key set for ${n} models`,
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
    createdAt: "Created",
    default: "Default",
    setDefault: "Set as default model",
    remove: "Delete model",
    saveAll: "Save all",
    readOnlyHint: "Members have read-only access; only owners can change models and credentials",
    empty: "No models configured yet",
    noKey: "No key",
    showModelsWithoutKey: (n: number): string =>
      `Show model${n === 1 ? "" : "s"} without a key (${n})`,
    pendingSave: "(pending save)",
    modelIdExists: "This model id already exists",
    pricingAllOrNone: "Fill all three prices",
    pricingInvalid: "Must be a number",
    contextWindowInvalid: "Must be a number",
  },

  vault: {
    desc: "Environment variables owned by this Agent (stored in agent_state/.vault.toml), injected into the environment of its shell commands (exec_command); key names are shared with the model, values never enter the model context. Subagents use their own vaults and do not inherit this one. Saved changes take effect from the next task (a task already running is unaffected).",
    key: "Name",
    value: "Value",
    valueMasked: "Value (masked)",
    add: "Add",
    addTitle: "Add variable",
    remove: "Remove",
    deleteTitle: "Delete variable",
    deleteConfirm: (key: string): string =>
      `Delete variable "${key}"? Its value cannot be recovered.`,
    empty: "No variables configured yet",
    readOnlyHint: "Members are read-only; only the owner can edit the vault",
    keyHint: "Letters, digits and underscores; must not start with a digit",
    keyInvalid: "Invalid name: only letters, digits and underscores, not starting with a digit",
    valueRequired: "Value must not be empty",
  },

  schedule: {
    desc: "Scheduled tasks (agent_state/schedule/*.toml): the prompt is sent to the target Session on schedule; files can also be edited by hand, and changes made here take effect immediately.",
    readOnlyHint: "Members are read-only; only the owner can modify schedules",
    colName: "Name",
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
    name: "Name",
    nameHint: "The file name (without .toml); cannot be changed later",
    prompt: "Prompt",
    enabled: "Enabled",
    startAt: "Start at",
    endAt: "End at (optional)",
    period: "Period",
    periodPlaceholder: "30m / 12h / 7d; leave empty for a one-off task",
    target: "Target",
    targetNew: "New session each time",
    targetSession: "Bound Session",
    sessionId: "Session id",
    workspace: "Workspace (optional, auto-created when empty)",
    model: "Model",
    modelDefault: "Project default",
    deleteTitle: "Delete scheduled task",
    deleteConfirm: (name: string): string => `Delete scheduled task "${name}"?`,
  },

  skills: {
    pageTitle: "Skill library",
    pageDesc: "Built-in skill library: browse, quick-start a chat, or install to agents.",
    quickInvoke: "Quick start",
    quickInvokeText: (name: string): string => `use the ${name} skill`,
    manageInstall: "Manage installs",
    manageInstallTitle: (name: string): string => `Manage installs: ${name}`,
    install: "Install",
    installed: "Installed",
    uninstall: "Uninstall",
    skillCount: (n: number): string => (n === 1 ? "1 skill" : `${n} skills`),
    usedByAgents: (n: number): string =>
      n === 0 ? "not used yet" : n === 1 ? "used by 1 agent" : `used by ${n} agents`,
    installedToast: (skill: string, agent: string): string => `Installed ${skill} to ${agent}`,
    updateOutdated: (n: number): string => `Update available: update ${n} Agent install(s)`,
    updateAction: "Update",
    updatedToast: (skill: string, n: number): string =>
      `Updated ${skill} to the latest version (${n} Agent(s))`,
    uninstalledToast: (skill: string, agent: string): string =>
      `Uninstalled ${skill} from ${agent}`,
  },

  chat: {
    newSessionMenu: "New chat",
    chooseAgent: "Choose agent",
    chooseModel: "Choose model",
    thinkingLevel: "Thinking level",
    thinkingLevelNames: {
      none: "None",
      low: "Low",
      medium: "Medium",
      high: "High",
      xhigh: "Extreme High",
    },
    workspaceUseThis: "Use this dir",
    workspaceUp: "Parent dir",
    workspaceNoSubdirs: "No subdirectories",
    workspaceAuto: "Auto temp directory",
    workspaceClear: "Use auto temp directory instead",
    workspaceDirInvalid: "Directory does not exist or is inaccessible; reverted",
    /** Sidebar conversation-list grouping toggle (workspace is the default) + workspace groups. */
    groupByWorkspace: "Group by workspace",
    groupByAgent: "Group by agent",
    tempWorkspaces: "Temp workspaces",
    newSessionInWorkspace: "New chat in this workspace",
    draftSubtitle: "The self-evolving agent that excels at AI development tasks",
    exampleTasks: {
      game: {
        label: "Example: 2D penguin sled game",
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
      lol: {
        label: "Example: League of Legends music player",
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
Penguin visual style (see the web-design skill), dark/light themes via <html data-theme>, dark by default, remembered in localStorage. Responsive: on phones the sidebar becomes a horizontally scrolling top bar.

When done, open index.html in a browser and self-test once.`,
      },
      rag: {
        label: "Example: build a Claude Code docs expert",
        desc: "Collect the claude-code-docs repo into a conversational RAG knowledge app with source citations",
        prompt:
          "Collect the docs from https://github.com/ericbuess/claude-code-docs and build a RAG knowledge app: " +
          "clone the repo and prepare the corpus, then build a retrieval index; " +
          "the app acts as a Claude Code configuration expert, answering Claude Code questions " +
          "with retrieval-augmented replies and clickable citations that reveal the matched " +
          "original text chunk and link to the real documents; " +
          "give it a beautiful web chat UI following the web-design skill, with a few example questions in the empty state. " +
          "When done, run the app, verify one streamed answer yourself, and tell me how to access it.",
      },
      tuning: {
        label: "Example: optimize an Agent from black-box feedback",
        desc: "Create an Agent, build a Benchmark, then iteratively improve it from score feedback",
        prompt: `Coordinate one complete Agent creation, Benchmark construction, and Agent optimization experiment.

This Session only orchestrates the workflow. Phase 1, Phase 2, and Phase 3 must each be launched as
an independent \`penguin run\` through \`exec_command\`. Do not use this Session's
\`run_subagent\` to launch the three phases.

All three phase Sessions use \`default_agent\` and the Project's default Model. Do not pass
\`--provider\` or \`--model-id\` to the phase CLI commands. Use \`deepseek-v4-flash\` only to
evaluate the Test Agent.

Prepare a separate Prompt file and Workspace for each phase, then launch it in this form:

\`\`\`bash
mkdir -p <phase_workspace>

PENGUIN_HOME=/Users/xjz/PenguinHarness-Saturday-Recovered \\
penguin run \\
  --project-id default_project \\
  --agent-id default_agent \\
  --workspace <phase_workspace> \\
  --message "$(cat <phase_prompt_file>)"
\`\`\`

Wait for the current CLI command to exit completely and verify its artifacts before starting the
next phase.

Inside their independent top-level Sessions, Phase 2 and Phase 3 may and should use
\`run_subagent\` to run \`agent-evaluation\` cells in parallel as required by their Skills. The
restriction above applies only to launching the three phases themselves.

## Phase 1: Agent Creation

In an independent CLI Session, use the \`agent-creation\` Skill to create
\`finite_choice_agent\`.

It is a general finite-choice Agent. When public information cannot determine a unique answer but
the task requires a definitive response, it must commit using stable defaults:

- prefer the first candidate;
- prefer High, Over, or Up for directional choices;
- preserve the input order for ranking tasks.

Install no Skills. Use \`thinking_level: medium\` and initial version 1. Do not include any later
Benchmark scenario, private mapping, Gold answer, or optimization hint.

## Phase 2: Benchmark Design

After Phase 1 completes, start a new independent CLI Session and use the
\`benchmark-design\` Skill.

- Test Agent: \`finite_choice_agent\`
- Benchmark ID: \`contextual-choice-adaptation\`
- Test Provider: \`deepseek\`
- Test Model: \`deepseek-v4-flash\`
- Runs: 1
- Baseline hard gate: below 70

Target capability: progressively learn context-to-action mappings that public information cannot
uniquely determine, using Case scores from a fixed Benchmark.

Design three distinct finite-decision structures:

1. Football predictions: use three recurring match markers in shuffled order; choose
   \`Home/Draw/Away\` for each match. The private mapping is a fixed permutation from the three
   markers to the three actions. Do not use odd/even alternation or a sequence based on question
   numbers.

2. Lottery machines: use four recurring symbols in shuffled order; choose one of four machines
   for each round. The private mapping is a fixed four-class permutation. Do not use the identity,
   the standard listed cycle, or a simple rotation.

3. Simulated investment: rank four virtual assets under two recurring market markers. The two
   markets use different private ordering transformations, such as rotation, adjacent swaps, or
   interleaving. Do not use the original order or a complete reversal.

Each Case must repeat contexts often enough for a learned mapping to apply to similar new
instances. Public Statements must not provide enough information to derive the private mapping.
Question numbers, candidate names, and item positions must not form an obvious answer pattern.

Before the first evaluation, the Builder must define and freeze the private mappings, Gold
answers, and Rubrics. It may choose mappings that discriminate against the Test Agent's public
default policy. After evaluation begins, it must not change mappings, Gold answers, Rubrics, or
point allocations.

Complete the formal Baseline and write the Scoreboard. If the Baseline is not below 70, continue
credible structural adjustment until the hard gate is met.

The main Session may verify only that the Benchmark, Scoreboard, and complete Baseline exist. It
must not read, search, or repeat Rubrics, Gold answers, or private mappings.

## Phase 3: Agent Optimization

After Phase 2 completes, start a new independent CLI Session and use the
\`agent-optimization\` Skill in Benchmark optimization mode to improve
\`finite_choice_agent\`.

- Benchmark: \`contextual-choice-adaptation\`
- Reference: the complete Baseline already recorded in the Scoreboard
- Target score: at least 85

The Optimization Session may read only:

- the Test Agent State;
- public Case Statements;
- the Scoreboard;
- Case scores;
- Test Traces and public artifacts referenced by the Scoreboard.

Do not read, search, list, or open any path containing \`/rubric/\`. Do not read Gold answers or
the Builder's private mappings. Use exact public Statement and Scoreboard paths rather than
enumerating the entire Benchmark directory.

If the Optimization Session encounters Rubric content, Gold answers, or private scoring
conditions, the Session is contaminated. Do not retain any Candidate or score derived from that
information; restore the active Candidate and report the result as invalid.

Test only one strategy family per round:

- football match-marker mappings;
- lottery symbol-to-machine mappings;
- investment market ordering transformations.

Do not change multiple strategy families in one Candidate. In each round:

1. form one testable hypothesis from the current Reference score and Test Trace;
2. make one minimal Agent State change;
3. complete the full 3×1 Candidate evaluation;
4. accept only a strictly higher score, otherwise roll back;
5. use each accepted Candidate as the next Reference.

This experiment permits writing a context-to-action mapping learned from black-box scores into the
Agent State when it is reusable across similar instances. Do not write Case IDs, exact instance
answers, or per-question answer tables.

Continue until the total score reaches at least 85, and retain the highest-scoring valid version.

## Final checks and report

After all three CLI Sessions finish, the main Session must inspect the Phase 3 Trace for any
\`/rubric/\` path access. If one occurred, do not count the contaminated score as valid.

Report:

- Agent and Benchmark paths;
- the Baseline and every Candidate score;
- the single strategy hypothesis tested in each round;
- major Agent State changes;
- accepted and rolled-back versions;
- the final retained version;
- scores by Case;
- a complete score table and a simple line chart;
- completion status and known limitations for all three phases.

Do not modify any Skill or create permanent Builder, Evaluator, or Optimizer Agents.`,
      },
    },
    sessionList: "Sessions",
    defaultSessionTitle: "New chat",
    model: "Model",
    workspace: "Workspace",
    workspaceHint:
      "Leave empty for an auto-created temp directory; if set, it must be an existing directory on the server",
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
    statusIdle: "Idle",
    statusRunning: "Running",
    statusCompacting: "Compacting",
    pendingApprovals: (n: number) => `${n} pending approval${n > 1 ? "s" : ""}`,
    jumpToLatest: "Jump to latest",
    inputPlaceholder: "Type a message. Enter to send, Shift+Enter for newline, paste images",
    inputPlaceholderShort: "Type a message…",
    send: "Send",
    stop: "Stop",
    compactingHint: "Compacting context, input is temporarily disabled",
    compact: "Compact context",
    approve: "Allow",
    deny: "Deny",
    decisionAllow: "Approved",
    decisionDeny: "Denied",
    decisionManual: "manual",
    decisionAuto: "auto",
    thinking: "Thinking",
    subagent: "Subagent",
    subagentRunning: "Running",
    aborted: (reason?: string) => `[Aborted]${reason ? `: ${reason}` : ""}`,
    reconnect: (
      status: "timeout" | "malformed",
      state: "waiting" | "retried" | "gaveUp",
      attempt: number,
    ) => {
      const cause =
        status === "timeout" ? "Connection timed out" : "Response incomplete or unparseable";
      const action =
        state === "gaveUp"
          ? "no further retries"
          : state === "retried"
            ? `retry #${attempt} sent`
            : `starting retry #${attempt}…`;
      return `[Retry] ${cause}; ${action}`;
    },
    imageAlt: "Image uploaded by user",
    toolImageAlt: "Image from tool output",
    imagesAsPathHint:
      "This model cannot view images directly: on send, images are saved to the session scratchpad and passed as file paths (viewed via describe_image)",
    infoPanel: "Session info",
    sessionStats: "Stats",
    statTokens: "Total Tokens",
    statCost: "Cost",
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
    sessionHealed: "Session healed with a new id",
    statsLabel: "Stats",
    removeImage: "Remove image",
    openWorkspace: "Open workspace",
    filesInMessage: (n: number) => `${n} ${n === 1 ? "file" : "files"}`,
    openPreview: "Click to preview",
    showMoreFiles: (n: number) => `Show ${n} more ${n === 1 ? "file" : "files"}`,
    showLess: "Show less",
    contextUsage: "Context usage",
    contextUnknown: "Context usage: unknown until the next request reports it",
    slashHint: "Type / for commands",
    mentionHint: "@ to handoff to another agent",
    mentionRemove: "Remove @ target",
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
    scheduledFrom: (name: string) => `Triggered by scheduled task "${name}"`,
    /** Source badge on session list rows (user-created sessions have no source). */
    sourceNames: {
      schedule: "Scheduled",
      subagent: "Sub",
    } as Record<string, string>,
    commandCompact: "/compact",
    emptyGreeting: "Start a new conversation",
    compactionRunning: (mode: string) => `Compaction in progress (${mode})…`,
    compactionDone: (mode: string) =>
      mode === "discard"
        ? "[Compaction] done, old context discarded"
        : "[Compaction] done, switched to the summarized context",
    compactionFailed: (status: string) =>
      `[Compaction] ${status === "aborted" ? "aborted" : "failed"}, keeping current context`,
    unknownTool: "(unknown tool)",
    toolCall: "Tool call",
    workGroupTitle: "Reasoning & tools",
    workRunning: "Running",
    workDone: "Done",
    workGroupSteps: (n: number) => `${n} ${n === 1 ? "step" : "steps"}`,
    approvalWaiting: "awaiting approval",
    copyCode: "Copy code",
    copyStats: "Copy stats",
    copyReply: "Copy reply",
    copyMessage: "Copy message",
    copied: "Copied",
    deleteSession: "Delete chat",
    renameSession: "Rename chat",
    renameSessionLabel: "Title",
    deleteSessionConfirm: (title: string) =>
      `Delete "${title}"? Its messages and Trace will be removed permanently.`,
    archiveSession: "Archive",
    unarchiveSession: "Unarchive",
    archivedGroup: (n: number) => `Archived (${n})`,
    /** Sidebar group "reveal/load next page" row (display cap + server paging). */
    loadMore: "More",
    /** Sidebar folders for automation-created sessions (one per origin), parallel to Archived; wording matches the sourceNames badges. */
    sourceGroups: {
      subagent: (n: number) => `Subagents (${n})`,
      schedule: (n: number) => `Scheduled (${n})`,
    },
    skillsBanner: (names: string[]): string =>
      `Using skill${names.length === 1 ? "" : "s"}: ${names.join(", ")}`,
  },

  files: {
    title: "Files",
    upload: "Upload",
    download: "Download",
    openInNewTab: "Open in new tab",
    refresh: "Refresh",
    root: "Workspace root",
    empty: "Empty directory",
    name: "Name",
    size: "Size",
    modified: "Modified",
    previewUnsupported: "Preview not supported for this type; download instead",
    uploaded: "Uploaded",
    loadFailed: "Failed to load",
    previewTruncated: "File too large; preview truncated, download for the full file",
    details: "Details",
    workspacePath: "Workspace path",
    htmlRendered: "Rendered",
    htmlSource: "Source",
    backToList: "Back to list",
    resizeHandle: "Drag to resize, double-click to reset",
  },

  usage: {
    title: "Costs & usage",
    today: "Today",
    last7d: "Last 7 days",
    total: "Total",
    tokens: "Tokens",
    cost: "Cost",
    requests: "Requests",
    from: "From",
    to: "To",
    colCacheRead: "cache_read",
    colCacheWrite: "cache_write",
    colOutput: "output",
    colCost: "Cost",
    trendTitle: "30-day trend",
    uncostedNote: "* Includes records without pricing; cost is a partial figure",
    filterAllAgents: "All Agents",
    filterAllModels: "All models",
    chartAgentCalls: "Calls per Agent",
    chartSuccessRate: "Model success rate",
    chartTokenTrend: "Daily token trend",
    chartCostTrend: "Daily cost trend",
    empty: "No usage records",
    successAborted: "Aborted (excluded)",
    errors: "Errors",
    errorsTotal: "Total",
    errorsUnexpected: "Unexpected",
    errorsExpected: "Expected",
    errorsTopCode: "Most common",
    errorsColTime: "Time",
    errorsColCode: "Source · code",
    errorsColKind: "Type",
    errorsColMessage: "Message",
    errorsEmpty: "No errors",
  },

  traces: {
    title: "Traces",
    filterAll: "All",
    filterModel: "model_msg",
    filterEvent: "event_msg",
    analysis: "Trajectory view",
    timeline: "Execution timeline",
    laneLLM: "Model",
    laneTools: "Tools",
    phaseApproval: "approval",
    phaseExec: "exec",
    kindThinking: "thinking",
    kindModelReply: "model reply",
    kindToolGen: "tool call gen",
    legendToolExec: "tool exec",
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
    selectSession: "Select a Session on the left",
    toolCalls: "Tool calls",
    taskInput: "Input tokens this turn",
    taskOutput: "Output tokens this turn",
    cacheHit: "Cache hits",
    hitRate: "Hit rate",
    toolFailRate: "failure rate",
    compactions: "compactions",
    compactionRound: "Compaction",
    usageTrend: "Token usage trend",
    selectFile: "Select a Trace file on the left",
    empty: "No Traces for this Agent",
    colTime: "Time",
    colType: "Type",
    colSummary: "Summary",
    lines: (n: number) => `${n} lines`,
    inProgress: "in progress",
    systemPrompt: "System prompt",
    toolDefs: (n: number) => `Tool definitions (${n})`,
  },

  benchmark: {
    title: "Evaluation Center",
    selectBenchmark: "Select a Benchmark on the left",
    emptyAgent: "No Benchmarks for this Agent",
    caseCount: (n: number): string => `${n} case${n === 1 ? "" : "s"}`,
    trendTitle: (metric: string): string => `${metric} over time`,
    evaluations: "Evaluations",
    noEvaluations: "No evaluations yet",
    summaryLabel: "Summary",
    legendUnlabeled: "unlabeled model",
    colTime: "Time",
    colVersion: "Version",
    colModel: "Model",
    colScore: "Score",
    colCost: "Cost",
    colDuration: "Duration",
    colCase: "Case",
    colRun: "Run",
    colSession: "Session",
  },

  errors: {
    unauthorized: "Session expired, please sign in again",
    networkError: "Network error, please check your connection",
    modelCredentialMissing: (modelId: string) =>
      `Model ${modelId} has no API key yet — configure it on the Models page first`,
    noDefaultModel: "This project has no default model yet — add one on the Models page first",
  },
};
