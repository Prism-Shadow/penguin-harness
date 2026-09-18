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
    models: "Models",
    machines: "Machines",
    plugins: "Plugins",
    usage: "Cost Center",
    traces: "Trajectories",
    benchmark: "Evaluation Center",
    // Collapsed-rail tooltips (product-specified wording; new chat reuses chat.newSessionMenu, the other pages reuse the page names above).
    lastConversation: "Last conversation",
    // The rail avatar's tooltip says what the control does; who is signed in stays in its accessible name.
    userSettings: "User settings",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    collapseGroup: "Collapse",
    expandGroup: "Expand",
    pinGroup: "Pin group",
    unpinGroup: "Unpin group",
    /** Company mode's page entries (S.nav.org.<key>, the COMPANY_NAV_KEYS manifest), and the mode switch's option names. */
    org: {
      overview: "Overview",
      chart: "Org Chart",
      calendar: "Calendar",
      tickets: "Tickets",
      finance: "Finance",
      handbook: "Handbook",
    },
  },

  /** Machines page: the server's own ssh hosts, and installing this build on one. */
  machines: {
    pageTitle: "Machines",
    imageVersion: (version: string) => `This server: ${version}`,
    noImage:
      "This server has no install image to push. A packaged or tarball install carries one; a source checkout gets one from its first hot push.",
    empty: "No host in ~/.ssh/config left to add.",
    search: "Search hosts…",
    noMatch: "No host matches.",
    localTitle: "this server",
    noneInUse: "No machine in use yet.",
    sshHint:
      "A machine can be added when this server's account can ssh into it by key (`ssh <alias>` works in a terminal here). Whoever set up ssh can put it in ~/.ssh/config.",
    now: "now",
    allHosts: (count: number) => `${count} more in ~/.ssh/config`,
    expand: "Expand",
    fewer: "Collapse",
    host: {
      addTitle: "New ssh host",
      newVerb: "New",
      configureVerb: "Configure",
      add: "Write to ssh config",
      alias: "Alias (Host)",
      aliasHint: "One word; `ssh <alias>` and this page will call the machine by it.",
      hostName: "Address (HostName)",
      hostNameHint: "An IP or a domain name.",
      user: "User",
      userHint: "Empty means this server account's own user name.",
      port: "Port",
      portHint: "Empty means 22.",
      identityFile: "Key file (IdentityFile)",
      identityFileHint: "Empty means ssh's default key.",
      oneWord: "Must be one word: no space, no #.",
      portRange: "A whole number from 1 to 65535.",
      exists: "The ssh config already has this alias.",
      added: (alias: string) => `Wrote ${alias}. Enable it from Add machines….`,
      configure: "Configure ssh host",
      editTitle: "Configure ssh host",
      saved: (alias: string) => `Updated ${alias} in the ssh config.`,
      foreign:
        "This block was not written by PenguinHarness and may carry options this form does not know; edit it in ~/.ssh/config.",
    },
    add: "Add machines…",
    addSelected: (count: number) => `Enable these ${count}`,
    use: "Enable",
    stopUsing: "Disable",
    updateAll: (count: number) => `Update all (${count})`,
    selectedCount: (count: number) => `${count} selected`,
    pickAll: "all",
    pickNone: "none",
    state: {
      serving: "Serving",
      queued: "Queued",
      working: "Working",
      ready: "Connected",
      failed: "Failed",
      installedOnly: "Installed",
      behind: "Behind",
      notConnected: "Offline",
      unreachable: "Unreachable",
      stopped: "Stopped",
      linkedStopped: "Connected, not serving",
      unknown: "Unchecked",
    },
    phase: {
      check: "Checking the machine…",
      install: "Installing the program…",
      handover: "Handing over the build…",
      restart: "Restarting its server…",
      connect: "Connecting…",
      sync: "Handing over the Model config…",
    },
    stepOf: (step: number, total: number) => `step ${step} of ${total}`,
    queued: "Waiting its turn behind the machines before it.",
    working: "Working…",
    failedAt: (step: string) => `Failed at "${step}".`,
    replaceProgram: "Force install",
    replaceProgramWhy:
      "Whatever is on that machine now, put this build's program there and restart its server — anyone using it will be interrupted.",
    refusedSelf: (alias: string) => `${alias} is the machine this server runs on; nothing to add.`,
    refusedUnknown: (alias: string) => `${alias} is not in this server's ssh config.`,
    details: "Details",
    detailInstalled: "Installed",
    detailSince: "Since",
    detailVersion: "Version",
    detailStarted: "Started",
    detailServer: "Server",
    detailChecked: "Checked",
    detailMachineId: "Machine id",
    detailRoot: "Server root",
    serverUpOn: (port: number) => `up on port ${port}`,
    output: "Output",
    agentsUnreachable: "That machine is not connected — use it from the Machines page",
    adminOnly: "Only an admin can manage machines.",
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
    touchKeys: {
      label: "Terminal keys",
      esc: "Escape",
      tab: "Tab",
      ctrl: "Ctrl (tap, then the next character)",
      alt: "Alt (tap, then the next character)",
      up: "Arrow up",
      down: "Arrow down",
      left: "Arrow left",
      right: "Arrow right",
      interrupt: "Interrupt (Ctrl+C)",
      paste: "Paste",
      hideKeyboard: "Dismiss the keyboard",
      showKeyboard: "Show the keyboard",
    },
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
    launcher: "Shortcuts",
    launcherCaption: "Shortcuts",
    launcherOpen: "Open",
    launcherClose: "Close",
    launcherPending: "a subagent awaits approval",
    launcherPanels: "Shortcuts",
    launcherHide: "Hide launcher",
    launcherHiddenToast: "Launcher hidden — turn it back on in Settings › Appearance",
    maximize: "Fill the screen",
    restore: "Restore the height",
  },

  tracePanel: {
    empty: "No traces yet",
    emptyHint: "This session has not produced a Trace file yet",
    loadFailed: "Failed to load traces",
  },

  dashboard: {
    title: "Dashboard",
    /** The two counts, read beside their numbers: "3 running", "1 to review". */
    running: "running",
    pendingReview: "to review",
    /** The merged row of auto-created temporary Workspaces, as the sidebar groups them. */
    temporaryWorkspaces: "Temporary workspaces",
    empty: "Nothing is running",
    /** The empty state while a machine did not answer: this server has nothing, the rest is unknown. */
    emptyHere: "Nothing is running on this server",
    emptyHint:
      "Workspaces with a Session running, or finished since you last opened it, appear here.",
    loadFailed: "Failed to load",
    silentMachines: (n: number) =>
      `${n} machine${n > 1 ? "s" : ""} did not answer — Sessions there are not counted. Connect to it on the Machines page.`,
  },

  settings: {
    language: "Language",
    languageInfo: "Interface language; can follow the browser.",
    /** Sidebar user-menu row opening the Settings dialog, and that dialog's title. */
    title: "Settings",
    /** Sidebar user-menu row, under the settings row, opening the dashboard page. */
    dashboard: "Dashboard",
    /** Rail headings: the viewer's own preferences vs. the whole server's. */
    groupPersonal: "Personal",
    groupServer: "Server",
    /** Personal pages of the settings dialog. */
    profile: "Profile",
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
      "Server-global, and in force the moment it is saved — nothing to restart. Loopback " +
      "addresses always go direct. The reachability test sends one credential-free GET to each " +
      "address listed below and measures this server's own outbound hop: any HTTP answer counts " +
      "as reachable, 401 and 403 included — a refused credential still proves DNS, TCP and TLS " +
      "all completed — while unreachable means the transport itself failed. It measures the " +
      "saved settings, since only a save rebuilds the outbound dispatcher; that is why the test " +
      "sits below Save, and why an edited address has to be saved before testing. Results " +
      "appear one by one, each as soon as its own answer arrives.",
    /** The two switches: the server's own outbound traffic / agent command subprocess environments. */
    proxyForApp: "Application uses the proxy",
    proxyForAgent: "Agent environment uses the proxy",
    /** The shared explicit proxy address (empty = follow the proxy environment variables). */
    proxyAddress: "Proxy address",
    proxyAddressPlaceholder: "Empty = follow system proxy",
    /** Reachability test: the block's heading, and its button at rest and while probing. */
    proxyProbe: "Reachability test",
    proxyProbeRun: "Test",
    proxyProbeRunning: "Testing…",
    /** A provider answered: the latency IS the result, so this is the only visible text. */
    proxyProbeLatency: (ms: number): string => `${ms} ms`,
    /** The same verdict in words, read out beside the number — a bare figure does not say "reachable". */
    proxyProbeReachableState: "Reachable",
    /** Listed but not yet measured: an absence, not a verdict. */
    proxyProbeIdle: "Not tested",
    /** A provider did not answer: the transport fault, each naming the state in words. */
    proxyProbeFailure: {
      timeout: "Timed out",
      dns: "DNS lookup failed",
      refused: "Connection refused",
      tls: "TLS handshake failed",
      network: "Unreachable",
    },
    /** Admin-only sub-page (server-global): the options loaded plugins declare. */
    pluginsTitle: "Plugins",
    /** An enum option this machine cannot honour, listed greyed out. */
    pluginOptionUnavailable: (title: string, reason: string) =>
      `${title} (not supported: ${reason})`,
    pluginsInfo:
      "The options each loaded plugin declares in its package, drawn from the plugin's own schema. Server-global, like the plugins themselves; a save reaches the plugin at once, nothing to restart. A plugin that declares no options has no form here.",
    /** A secret field with a stored value: submitting it empty keeps the stored one. */
    pluginSecretKeepHint: "Leave empty to keep the saved value",
    pluginSecretClear: "Clear stored value",
    /** The Plugins settings page's machine picker: each server keeps its own plugin settings. */
    pluginConfigMachine: "Machine",
    /** Under a number field whose box does not parse; the save is not sent. */
    pluginFieldNotNumber: "Must be a number",
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
    launcher: "Shortcuts launcher",
    launcherInfo:
      "The round button floating on the conversation's right edge that fans out shortcuts to the workbench's panels and the terminal. Turning it off here removes it; the fan's \"Hide launcher\" entry does the same.",
    toolAliases: "Tool short names",
    toolAliasesInfo:
      'Tool cards in a conversation name the built-in tools by a short alias: read_file reads as "read". Every other tool (MCP tools included) and the Trace viewer keep the tool\'s own name, and hovering a short name shows it.',
    notifications: "Task completion notifications",
    notificationsInfo:
      "Shows a system notification when a Task finishes while the window is hidden or unfocused; clicking it opens that Session. Turning this on asks the system for permission on the spot — the system asks once, never again after a refusal, and the only way back is its own notification settings.",
    notificationsDenied:
      "The system has denied notifications for this app. Allow them in your system notification settings, then turn this on again.",
    notificationsDismissed:
      "The permission prompt was closed without an answer, so notifications stay off. Turn this on again to ask once more.",
    notificationsUnsupported: "This browser does not support system notifications.",
    trayIcon: "Tray icon",
    trayIconInfo:
      "The desktop app keeps an icon in the system tray — the Windows notification area, the macOS menu bar, the Linux tray — for as long as it runs: click it to come back to the window, right-click it to start a session or quit. On by default; turning it off removes the icon at once, no restart, and closing the window then no longer hides it, so the app stays in the Dock on macOS and quits on Windows and Linux.",
    currencyInfo: "Display currency for prices; storage is always USD.",
    changePasswordInfo: "Change this account's sign-in password.",
    /** Personal company-mode switch (general page) and the admin master switch (its own server page). */
    companyModeTitle: "Company mode",
    companyModePersonal: "Company mode",
    companyModePersonalInfo:
      "Off only hides your own mode switch; organizations keep running. The admin master switch sits under Server.",
    companyModeServer: "Enable company mode",
    companyModeServerInfo:
      "The server-wide master switch, off until an admin turns it on here. Off stops the organization scheduler and every organization route and hides the mode switch for everyone. Organizations on disk are untouched, and turning it back on backfills no missed trigger. Beta: it may be unstable; please report what you hit.",
    accentNames: {
      neutral: "Neutral",
      blue: "Blue",
      green: "Green",
      violet: "Violet",
      rose: "Rose",
      amber: "Amber",
    } as Record<string, string>,
  },

  commandPalette: {
    title: "Command Palette",
    placeholder: "Type to filter commands…",
    noResults: "No matching commands",
    hint: "Ctrl+P / Ctrl+Shift+P (⌘P) to toggle · ↑↓ to select · Enter to run",
    harnessHistory: "Harness history",
    installCli: "Install 'penguin' command…",
    checkUpdates: "Check for desktop updates…",
    checkingUpdates: "Checking for updates…",
    openDevTools: "Open DevTools",
    projectOnGitHub: "Project on GitHub",
  },
  workflows: {
    tabsLabel: "Chat and workflows",
    chatTab: "Chat",
    brokenMark: "The current files failed to load",
    reload: "Reload",
    reloading: "Reloading…",
    history: "History",
    loadError: "Load error",
    loadingHistory: "Loading history…",
    noHistory: "No versions recorded yet.",
    current: "current",
    restore: "Restore",
    remove: "Remove",
    fillApp: "Fill the app",
    fillAppHint:
      "Show this page as the whole app; Ctrl+P / Ctrl+Shift+P opens the command palette to leave",
    exitFullPage: "Exit full page (back to chat)",
    exitHint: "Press Ctrl+P or Ctrl+Shift+P for the command palette to get back to the chat.",
    noSuchPage: "This workflow does not exist or has no page.",
    removeConfirm: "Delete this workflow and all its recorded versions?",
    removeYes: "Remove",
    removing: "Removing…",
    removeNo: "Keep",
    fileCount: (n: number) => `${n} files`,
  },
  harnessHistory: {
    title: "Harness history",
    pageDesc:
      "Every harness version this server committed through a hot update, newest first, and what each push changed in the module tree and its interfaces.",
    loading: "Loading…",
    empty: "No harness has been pushed to this server yet.",
    current: "current",
    noProvenance: "(no provenance recorded)",
    pushedAt: "Committed",
    bundles: "Bundles",
    table: "Interface table",
    tableCounts: (nodes: number, interfaces: number, types: number) =>
      `${nodes} nodes · ${interfaces} interfaces · ${types} types`,
    noTable: "This push carried no interface table.",
    noTableShort: "no table",
    changesSince: (previous: string) => `Changes since ${previous}`,
    changesFirst: "Changes (first recorded table)",
    noChanges: "No interface or tree changes.",
    nodes: (n: number) => `Nodes (${n})`,
    interfaces: (n: number) => `Interfaces (${n})`,
    typesSummary: (added: number, removed: number, changed: number) =>
      `Data types: ${added} added, ${removed} removed, ${changed} changed`,
    change: { added: "added", removed: "removed", changed: "changed" },
    rollback: "Roll back to this version",
    rollbackConfirm: "Push this version back and swap now?",
    rollbackYes: "Roll back",
    rollbackPushing: "Pushing… the server swaps when it lands.",
    rollbackTimeout: "The server did not report the swap in time; check the history.",
    notKept: "Artifacts of this version were not kept; it cannot be pushed back.",
    viewChanges: "Changes",
    viewTree: "Module tree",
    kind: { group: "group", module: "module", component: "component" },
    expand: "Expand",
    collapse: "Collapse",
    extensionSlot: "+ extension modules",
    ownProvision: "own",
    pickNode: "Pick a node to see what it requires and provides.",
    requires: "requires",
    provides: "provides",
    contributes: "contributes",
    children: "children",
    exports: "exports",
    methods: "methods",
    fields: "fields",
    slots: "slots",
  },
  /**
   * The software-update flow (lib/update-flow.ts): the one modal for both the server release
   * and the desktop client, the account-menu row, the version-line badge, and the toasts for
   * outcomes that land while the modal is closed. Null version = the backend named none.
   */
  update: {
    /** Version-line date label; `date` is formatMonthDay output, e.g. "Last updated Jul 26". */
    lastUpdated: (date: string) => `Last updated ${date}`,
    /** The version line's superscript, a button into the modal; the other two follow the flow. */
    newVersionBadge: "New version available",
    badgeDownloading: "Downloading update",
    badgeReady: "Restart to update",
    /** A release offered: the row's label and the avatar badges' sentence. */
    newVersion: (v: string) => `New version v${v} available`,
    /** A release downloaded / installed and waiting for the restart: the row's label and the badges' sentence. */
    restartToUpdate: (v: string | null) =>
      v !== null ? `Restart to update to v${v}` : "Restart to finish updating",
    /** The combined wording for an anchor covering several update trails at once. */
    updatesAvailable: "Updates available",
    // —— the account-menu row ——
    checkNow: "Check for updates",
    checking: "Checking…",
    rowDownloading: (v: string | null, percent: number | null) =>
      `Downloading${v !== null ? ` v${v}` : " update"}${percent !== null ? ` ${percent}%` : "…"}`,
    rowRestarting: "Restarting…",
    rowUnsupported: "Cannot update from here",
    // —— the modal ——
    title: "Software Update",
    currentVersion: (v: string) => `Current version v${v}`,
    checkingBody: "Checking for updates…",
    upToDate: "You're on the latest version",
    checkFailed: "Update check failed — try again later",
    checkDisabled: "Update checks are disabled (PENGUIN_UPDATE_CHECK=off)",
    releaseNotes: "Release notes",
    openReleases: "Open the Releases page",
    /** What "download and update" does, per backend. */
    availableBodyRelease:
      "Downloads the latest release and installs it into the install directory on the server (the data directory is not touched). You can close this window while it downloads; restart the service afterwards to run it.",
    availableBodyClient:
      "Downloads the new version. You can close this window and keep working while it downloads; restart the app once it is ready to finish updating.",
    /** Shown to non-admins in place of the body above (they can read the notes but cannot run the update). */
    adminOnly: "Only an administrator can run the update from here.",
    downloadAndInstall: "Download and update",
    later: "Later",
    background: "Continue in background",
    downloading: (v: string | null) =>
      v !== null ? `Downloading v${v}…` : "Downloading the update…",
    /** The progress bar's accessible name. */
    downloadProgress: "Download progress",
    /** The server job's stages, shown under the bar while it carries no percentage. */
    phaseResolving: "Resolving the release…",
    phaseDownloading: "Downloading the package…",
    phaseInstalling: "Verifying and installing…",
    ready: (v: string | null) => (v !== null ? `v${v} is ready` : "The update is ready"),
    readyBodyRelease:
      "Restart the service to run the new version. Running tasks will be interrupted; this page reloads once the service is back.",
    /** Mirrors the shell's native restart prompt: the interruption warning must not disappear on the web path. */
    readyBodyClient:
      "PenguinHarness will restart to finish updating. Running tasks will be interrupted.",
    /** Nothing supervises the server process (not started through penguin web / penguin server), so the restart is the user's. */
    readyBodyManual:
      "The new version is installed. This service is not supervised by penguin web or penguin server, so it cannot be restarted from here: re-run penguin web (or penguin server) in a terminal.",
    restartNow: "Restart and update",
    restarting: "Restarting…",
    restartingBodyRelease: "This page reloads once the service is back.",
    restartingBodyClient: "The app is about to restart.",
    failed: "Update failed",
    retry: "Retry",
    /** Why this install cannot update itself. */
    unsupportedDev: "A dev run does not update itself",
    unsupportedNonAppImage:
      "Only the AppImage build updates itself on Linux — update a package install through your package manager",
    unsupportedNotViaCli:
      "This service was not started through penguin web or penguin server, so it cannot be updated from here",
    unsupportedCli: "This install cannot be updated from the web UI",
    // —— toasts: outcomes that land while the modal is closed ——
    foundNew: (v: string) => `New version v${v} found — open the update entry to download it`,
    foundNewUnnamed: "New version found — open the update entry to download it",
    readyToast: (v: string | null) =>
      v !== null ? `v${v} is ready — restart to update` : "The update is ready — restart to update",
    failedToast: "Update failed — open the update entry for details",
    unsupportedToast: "This install cannot be updated from the web UI",
    /** The shell's own updater failure text — a failed download or signature check, not only a failed lookup. */
    clientUpdateFailed: (detail: string) => `Client update failed: ${detail}`,
    /** A download / restart request failed before the backend could act; `detail` is apiErrorText output. */
    requestFailed: (detail: string) => `Could not run the update action: ${detail}`,
    restartTimedOut:
      "The service has not come back — check penguin web's output in the terminal, then reload this page",
  },

  /**
   * The four DISMISSIBLE badge trails (Agents / Skill library / model library / cost center),
   * the controls that clear them and the control that acts on all of one at once. The tooltip
   * sentences below are what each dot says; the page notice restates the same count in its own
   * `changes*` wording, since a block that can act needs to say what it would act on.
   */
  todo: {
    pluginUpdates: (n: number) => (n === 1 ? "1 plugin update" : `${n} plugin updates`),
    presetUpdates: (n: number) =>
      n === 1 ? "1 preset model to sync" : `${n} preset models to sync`,
    unexpectedErrors: (n: number) => (n === 1 ? "1 unexpected error" : `${n} unexpected errors`),
    /** Combined anchor whose trails are not all updates — an unexpected error is not one. */
    pending: "Something needs attention",
    /** Clears an update the user has decided not to take now (a later one raises the badge again). */
    dismiss: "Dismiss",
    /** The cost center's wording: nothing is being updated there, the errors are simply read. */
    markRead: "Mark as read",

    // —— The page notice's own line and its bulk action (components/ui/todo-notice.tsx) ——

    /** The notice line where the trail can separate genuinely new things from upgradable ones (Models only). */
    changesWithAdded: (added: number, updated: number): string =>
      `Changes detected: ${added} new, ${updated} to upgrade`,
    /** The same line where the trail has only one honest count — no padded zero (Agents, Plugins). */
    changesUpgradable: (updated: number): string => `Changes detected: ${updated} to upgrade`,
    /** Updates every object the notice counts, behind the page's own confirmation. */
    updateNow: "Update now",
    /** Heading of the confirmation's list of exactly what the batch would write to. */
    willTouch: "This will touch:",
    /** Bulk kernel update confirmation; the body reuses agent.kernelUpdateConfirmBody verbatim. */
    agentsConfirmTitle: (n: number): string => `Update the kernel of ${n} agent(s)`,
    /** Bulk plugin update confirmation. Same warning as the per-plugin confirm, with no single subject. */
    pluginsConfirmTitle: (n: number): string => `Update ${n} plugin(s)`,
    pluginsConfirmBody:
      "Updating reinstalls the library copy over each agent's installed skill and hook files — any local edits are lost. Export a backup first if you need them.",
    /** Bulk preset sync confirmation; the body reuses models.syncCatalogHint verbatim. */
    modelsConfirmTitle: (n: number): string => `Sync ${n} preset model(s)`,
    /** Every target of the batch was written. Counted in agents: both pages that use this
     * send one request per agent, and the partial-failure line below names agents too. */
    bulkDone: (ok: number): string => `${ok} agent${ok === 1 ? "" : "s"} updated`,
    /** Some targets were written and some were not — the failed ones are named, never just counted. */
    bulkPartial: (ok: number, failed: string): string =>
      `${ok} agent${ok === 1 ? "" : "s"} updated; these did not: ${failed}`,
    /** Separator between named targets in the two strings above. */
    listSeparator: ", ",
  },

  /** Task-completion notifications (window unfocused; opt-in, see lib/notification-pref). */
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
    /** Sole button of a dialog that only informs: it has nothing to confirm or cancel, so the label acknowledges rather than agrees (and does not repeat the header X's "close"). */
    gotIt: "Got it",
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
    /** The sign-out confirmation: dialog name and body. */
    logoutConfirmTitle: "Sign out?",
    logoutConfirmBody:
      "This ends your session here and returns to the login page. Running conversations keep going on the server.",
    admin: "Admin",
    defaultAdminNote:
      "First run: the server prints a first-login link in its startup output — open it to claim the built-in admin “admin” and set a password. No initial password exists to type here",
    /** Login footer line 2: the offline rescue for a forgotten admin password (other users ask the admin instead). */
    forgotAdminNote:
      "Forgot the admin password? Stop the server and run penguin server reset-admin-password to issue a fresh initial one",
    /** Dialog raised over the login form when the server refused a sign-in link (spent, expired, or never valid). */
    claimFailedTitle: "Sign-in link no longer works",
    /** Desktop deployment: the shell mints a fresh link every time it starts, so restarting it is the way back in. */
    claimFailedDesktop:
      "This one-time sign-in link has already been used or has expired. Restart the PenguinHarness desktop app to get a fresh link and be signed in automatically, or sign in with your username and password below.",
    /** Everywhere else: nobody at this browser can mint a link, so the way in is the form below or whoever runs the server. */
    claimFailedServer:
      "The first-login link stops working once the server has a password, and a restart replaces it with a new one. Sign in with your username and password below, or ask your administrator for a new sign-in link.",
  },

  /**
   * The Profile page of Settings, and the avatar/nickname it writes. Visible in every
   * session, the desktop shell's own window included: a profile needs no password to change.
   */
  profile: {
    /** Avatar row: its label, and the two actions beside the preview. */
    avatar: "Avatar",
    /** Disclosed by the "?" beside that label: when a picked image takes effect. */
    avatarInfo:
      "A picture takes effect as soon as you choose it — there is no separate Save for it. The nickname beside it is typed text, so it keeps a Save of its own.",
    changeAvatar: "Change avatar",
    /**
     * Shared label of the two buttons that put a field back to what an account with nothing set
     * shows: the letter tile for the avatar, the username for the nickname. Neither deletes
     * anything the app cannot draw again, which is why it does not say "remove".
     */
    restoreDefault: "Restore default",
    /** The same, named for what it restores: two of these sit on one page. */
    restoreDefaultOf: (subject: string) => `Restore default: ${subject}`,
    /** The picked image could not be brought under the size limit even as JPEG. */
    avatarTooLarge: "That image is too large. Please pick a smaller one.",
    /** The picked file could not be decoded as an image at all. */
    avatarUnreadable: "That image could not be read. Please pick another file.",
    /** Nickname row: the field, and the shape rule that stays on screen while typing. */
    displayName: "Nickname",
    displayNameHint: "1–32 characters; leave blank to clear",
    displayNamePlaceholder: "Blank shows the username",
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

  /** The "Create with AI" kit (features/ai-create): the pair of create buttons, the prompt panel and the bridge into a new conversation with the Project's default agent. */
  aiCreate: {
    withAi: "Create with AI",
    manual: "Create manually",
    editInChat: "Edit in a new conversation",
    copyPrompt: "Copy prompt",
    examplesTitle: "Try an example",
    fullPrompt: "Full prompt",
    /** Who does the work, and where: the panel's lead line. */
    byAgent: (name: string): string => `Done by ${name} in a new conversation`,
    chooseAgent: "Agent that does the work",
    placeholder: "Describe what you want — the more specific, the better",
    /** Accessible name of the prompt box (it has no visible label). */
    promptLabel: "Prompt",
    noAgent: "This Project has no agent yet",
  },

  agent: {
    savedTakesEffect:
      "Saved. New conversations pick it up right away; running ones after their next compaction.",
    savedTakesEffectNow: "Saved. It takes effect immediately, including running conversations.",
    takesEffectSuffix:
      " — new conversations pick it up right away, running ones after their next compaction",
    listTitle: "Agents",
    searchPlaceholder: "Search agents: id / name / description",
    searchEmpty: "No agent matches that.",
    create: "Create agent",
    createTitle: "Create agent",
    id: "Agent id",
    idHint:
      "2–64 chars: starts with a lowercase letter; lowercase letters, digits and underscores only. Cannot be changed later.",
    nameHint: "Leave empty to use the agent id as the name",
    description: "Description",
    createPlugins: "Plugins",
    createPluginsPlaceholder: "No plugins selected",
    createPluginsPicked: (n: number): string => `${n} plugin${n === 1 ? "" : "s"} selected`,
    createPluginsHint:
      "Installed into the agent at creation (skills and hook packages); add or remove them later in its Skills and Hooks tabs.",
    createPluginsEmpty: "The plugin library has nothing to install.",
    /** The directory-skills picker's trigger (the field's own label is createDirSkills). */
    createSkillsPlaceholder: "No skills selected",
    createSkillsPicked: (n: number): string => `${n} skill${n === 1 ? "" : "s"} selected`,
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
      "The snapshot package carries its own skills and hooks, so plugin seeding is unavailable.",
    createSnapshotClear: "Remove the selected package",
    aiCreateTitle: "Create an agent with AI",
    aiCreateIntro:
      "Describe what the agent does, for whom, and what it produces; the agent doing the work uses the agent-initialization skill to create it in the current Project.",
    aiCreatePlaceholder: "e.g. Create an agent that turns my meeting recordings into to-do lists…",
    aiExamples: [
      {
        key: "jotting",
        label: "Jotting agent",
        description: "Fragments of thought filed into a Markdown file system",
        prompt:
          "Create a jotting agent: I will keep sending it fragments of thoughts and half-sentences, and it organizes them into a Markdown file system in the Workspace (one file per topic, an index file it maintains, duplicates merged, a timeline kept), replying after each message with where it filed the content.",
      },
      {
        key: "finance",
        label: "Financial Copilot",
        description: "Fundamentals and valuation from filings, quotes and news",
        prompt:
          "Create a financial Copilot agent: it reads the filings, market data and news links I give it, does fundamental and valuation analysis, presents conclusions as tables and bullet points, flags uncertainty and cites data sources, and never gives direct buy or sell advice.",
      },
      {
        key: "rag",
        label: "Document RAG agent",
        description: "Indexes docs/ first, then answers with citations",
        prompt:
          "Create a document Q&A agent: I will put material into the Workspace's docs/ directory; it first builds an index (a summary per file and section), cites the specific file and passage in every answer, and says plainly that it does not know when the material gives no basis for an answer.",
      },
      {
        key: "research",
        label: "Deep research report agent",
        description: "Outline, multi-round search, cross-checked, a cited report",
        prompt:
          "Create a deep research report agent: given a topic, it first drafts a research outline, then searches and reads sources over several rounds and cross-checks the facts, and finally writes a Markdown report in the Workspace with a table of contents, citations and appendices.",
      },
      {
        key: "report-writer",
        label: "Report-writing agent",
        description: "Structured reports from loose material; id report-writer",
        prompt:
          "Create a report-writing agent with the agent id report-writer: it turns loose material into structured business or technical reports (summary, background, analysis, conclusions and recommendations), produces Markdown files, and attaches a writing checklist.",
      },
    ],
    aiCreateTail: [
      "Use the agent-initialization skill to create a new agent in the current Project from the description above:",
      "- Use the agent id given above if there is one; otherwise pick a short semantic id (starting with a lowercase letter; letters, digits, underscores or hyphens). If the target directory already exists, stop and tell me instead of overwriting it.",
      "- Start from default_agent's system_config.yaml, set its name, description and version, and write the role and rules into its agent_state/AGENTS.md.",
      "- Copy only the skills it really needs from the plugin library (the skill directories default_agent carries); do not over-equip it.",
      "- Do not touch any other agent; run the skill's validation when done.",
      "Finish by telling me the new agent's id, the skills you installed, and how to start a conversation with it (the New chat button on its card on the Agents page).",
    ].join("\n"),
    firstAgentTitle: "No agent of your own yet",
    firstAgentDesc: "Describe the agent you want and let AI create it — or set one up manually.",
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
    tabHooks: "Hooks",
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
    timeoutMsHint: "Idle budget between upstream events, ms — not a cap on the whole request",
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
    livesOnMachine: (machine: string) => `This Agent lives on ${machine}; manage it there`,
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
    addProtocolHintPinned: (protocol: string): string =>
      `Models in this group always use the ${protocol} protocol; set the base URL to your own server`,
    addProtocolHintPinnedGateway: (protocol: string): string =>
      `Models in this group always use the ${protocol} protocol; the base URL is preset to the gateway's endpoint`,
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
    aiAddTitle: "Add a model group with AI",
    aiAddIntro:
      "Hand the agent a model listing page or a description of the service, and it adds the models as one group with penguin config commands. For an OpenAI-compatible endpoint that lists its own models, Add group → Import models is faster.",
    aiAddPlaceholder:
      "Paste the URL of a model listing page, or describe the service to connect (gateway URL, authentication, model ids)…",
    aiAddExamples: [
      {
        key: "openrouter",
        label: "OpenRouter's popular models",
        description: "Reads the listing page, adds one group",
        prompt:
          "Add the popular models on https://openrouter.ai/models as an OpenRouter group (ask me for the API key first).",
      },
      {
        key: "vllm",
        label: "A self-hosted vLLM server",
        description: "OpenAI-compatible endpoint plus a model id",
        prompt:
          "Connect my self-hosted vLLM server at http://10.0.0.5:8000/v1, model id qwen3-32b, as a vllm group.",
      },
      {
        key: "ollama",
        label: "Local Ollama",
        description: "Adds the models already pulled locally",
        prompt:
          "Add the models already available on my local Ollama (http://localhost:11434) as an ollama group.",
      },
      {
        key: "deepseek",
        label: "DeepSeek's official model",
        description: "Into the deepseek group, set as the default",
        prompt:
          "Add DeepSeek's official deepseek-v4-pro to the deepseek group and make it the default model.",
      },
    ],
    aiAddTail: (projectId: string): string =>
      [
        "Use the penguin-config skill for the configuration above:",
        "- Every command below carries `--root <data root>`, the parent directory of the App Data Dir in your Environment section. Your command environment does not name that root, so a command without `--root` configures a different one and nothing reaches this Project.",
        `- Run \`penguin config model add --provider <group> --model-id <upstream id> --project-id ${projectId} --root <data root> [--base-url <endpoint>] [--client-type openai] [--api-key <key>] [--context-window <n>] [--price-cache-read <n> --price-cache-write <n> --price-output <n>]\` once per model: \`--provider\` is mandatory, \`--model-id\` takes the gateway's own model id, and an OpenAI-compatible endpoint gets \`--client-type openai --base-url <endpoint>\`.`,
        "- When the source is a web page, fetch it first: add the models I named, or the most popular ones when I named none, about 10 at most.",
        "- When an API key is needed and I did not give one, ask me once; if I do not provide it, leave the key empty and tell me to fill it in on the Models page.",
        "- Never read or edit .project_config.toml; configuration goes through penguin commands only.",
        `- Finish with \`penguin config model list --project-id ${projectId} --root <data root>\` and show me the result.`,
      ].join("\n"),
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
    /** Success toast when the probe answered on a tidied-up base URL, which the field now holds. */
    detectedProtocolAndUrl: (protocol: string, url: string): string =>
      `Detected ${protocol}; base URL normalized to ${url}`,
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
    /**
     * Rides the group's own collapse bar, which on this group carries five actions — the most
     * crowded row on the page. One word, because the vendor name beside it is what a reader
     * needs first and is the element that truncates.
     */
    recommendedGroup: "Recommended",
    discountBadge: (pct: number): string => `${pct}% off`,
    discountTitle: (pct: number): string => `Promotion: ${pct}% off the list price`,
    offPeakTitle: (pct: number): string =>
      `Off-peak rate: ${pct}% off list. Peak hours bill at list price — 09:00–12:00 and 14:00–18:00 Beijing time, Monday to Friday`,
    visionModelBadge: "Proxy vision",
    usedTokens: (v: string) => `${v} toks`,
    usedTokensTitle: "Tokens this model has used, all time",
    setVisionModel: "Set as proxy vision model",
    visionModelHint: "Describes images for models without vision when they read one with read_file",
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
    /**
     * The dialog's own report once the key has landed. It names the provider as well as the
     * count, because the user is reading it after a trip to another tab and may not remember
     * which authorization they just finished.
     */
    oauthAppliedBody: (provider: string, n: number): string =>
      `Authorized. ${provider}'s API key is set on ${n} model${n === 1 ? "" : "s"} and ready to use.`,
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
      `Make "${name}" the proxy vision model? Models without vision will read images through it when they call read_file.`,
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
    aiAddTitle: "Add secrets with AI",
    aiAddIntro:
      "A secret value typed here is sent to the model provider, recorded in the conversation's Trace, and shown again in the command the agent runs. The safer way is to let AI create only the key names and tell you what each is for, then fill in the values in the vault by hand.",
    aiAddPlaceholder: "Ask which API keys this agent needs, or name the keys to create…",
    aiAddExamples: [
      {
        key: "audit",
        label: "Find the keys this agent needs",
        description: "Key names now, values filled in by hand",
        prompt:
          "Check which API keys this agent's installed skills need, create the key names now, and tell me what each one is for and where to apply for it — I will fill in the values in the vault myself.",
      },
      {
        key: "rotate",
        label: "Reset an expired token",
        description: "Clears the value; you paste the new one",
        prompt:
          "GH_TOKEN has expired. Reset it to a placeholder value and tell me where to issue a new one — I will paste the new token in the vault myself.",
      },
      {
        key: "endpoint",
        label: "Connect an internal service",
        description: "Address set now, token left for you",
        prompt:
          "This agent will call our internal Gitea at https://git.example.com. Set GITEA_BASE_URL to that address, create GITEA_TOKEN with a placeholder value, and tell me where to issue the token.",
      },
    ],
    aiAddTail: (agentId: string, projectId: string): string =>
      [
        `Use the penguin-config skill to write the secrets above into the vault of agent ${agentId} (Project ${projectId}):`,
        "- Every command below carries `--root <data root>`, the parent directory of the App Data Dir in your Environment section. Your command environment does not name that root, so a command without `--root` writes into a different one and this agent's vault stays empty.",
        `- Run \`penguin config vault set --key <NAME> --value <value> --agent-id ${agentId} --project-id ${projectId} --root <data root>\` once per secret; when only the key name is wanted, store the placeholder value TODO and tell me what the key is for and where to apply for it.`,
        "- Never repeat a value back in your reply, and never read .vault.toml.",
        `- Finish with \`penguin config vault list --agent-id ${agentId} --project-id ${projectId} --root <data root>\` to list the key names.`,
      ].join("\n"),
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
    /** Toasts after a write. A schedule fires on its own clock, so none of them mentions when a conversation picks the change up: there is nothing to pick up. */
    toastSaved: "Scheduled task saved",
    toastEnabled: "Scheduled task enabled",
    toastDisabled: "Scheduled task disabled",
    /** The form's target line when it is pinned to one Session (the chat dock panel). */
    targetThisSession: "This conversation",
    /** The chat dock's scheduled-tasks panel (features/schedules/schedule-panel.tsx): the current Session's tasks. */
    panelTitle: "Scheduled tasks",
    panelSubtitle:
      "Ask the agent to run tasks, send reminders or monitor for updates on a schedule",
    panelSearchPlaceholder: "Search scheduled tasks",
    filterAll: "All",
    filterActive: "Active",
    filterPaused: "Paused",
    filterCompleted: "Completed",
    panelEmpty: "No scheduled tasks in this conversation yet",
    panelNoMatch: "No matching scheduled tasks",
    /** The panel's body on the draft page, where no Session exists yet. */
    panelDraftEmpty: "Send the first message, then schedule tasks for this conversation",
    /** Accessible name of a row's overflow menu (edit / delete). */
    rowActions: "More actions",
    /** The human schedule line under a task's name (schedule-describe.ts). */
    human: {
      everyDay: (time: string): string => `Every day at ${time}`,
      /** `weekday` is the locale's short weekday name (周一 / Monday). */
      everyWeek: (weekday: string, time: string): string => `Every ${weekday} at ${time}`,
      everyDays: (n: number, time: string): string => `Every ${n} days at ${time}`,
      everyHours: (n: number): string => (n === 1 ? "Every hour" : `Every ${n} hours`),
      everyMinutes: (n: number): string => `Every ${n} minutes`,
      /** A one-off task and when it fires. */
      once: (when: string): string => `One-off · ${when}`,
      next: (when: string): string => `Next: ${when}`,
      today: (time: string): string => `today ${time}`,
      tomorrow: (time: string): string => `tomorrow ${time}`,
      /** `monthDay` is formatMonthDay's output (9月3日 / Sep 3). */
      onDate: (monthDay: string, time: string): string => `${monthDay}, ${time}`,
      onDateWithYear: (year: number, monthDay: string, time: string): string =>
        `${monthDay}, ${year}, ${time}`,
    },
    /** The "Create with AI" surfaces: the dock panel prefills this conversation's composer, the settings tab a new conversation's. */
    aiCreateTitle: "Create a scheduled task with AI",
    aiCreateInSessionDesc:
      "Describe what to schedule; the agent creates it in this conversation and confirms the time it set.",
    aiCreateDesc:
      "Describe what to schedule; the agent creates it for this agent in a new conversation and confirms the time it set.",
    /** The in-Session dialog's lead line (replaces the kit's "in a new conversation" wording). */
    byAgentInSession: (name: string): string => `Done by "${name}" in this conversation`,
    /** The in-Session dialog's one exit (the kit's aiCreate.editInChat opens a NEW conversation; this one fills the composer already on screen). */
    editInSession: "Edit in this conversation",
    /** Instruction tail appended to the in-Session dialog's draft (composeAiPrompt); the model binds the task to this Session. */
    aiCreateInSessionTail:
      "Create the request above as a scheduled task bound to this Session: write a TOML file under agent_state/schedule/ with `session_id` set to this Session's id (see the Environment section), a semantic file name and `start_at`; add `period` when it repeats and `end_at` when the request has a natural end. Then confirm the schedule you set in one line.",
    /**
     * Instruction tail of the settings tab's dialog: the task is created for one agent, in a
     * new Session unless the user names one. The CLI form spells every flag, `--agent-id`
     * above all: the prompt runs in a conversation with the Project's default agent, so the
     * server injects THAT agent into PENGUIN_AGENT_ID, and an `add` without the flag writes
     * the task into the wrong agent's schedule directory. The TOML keys are named only in
     * the file branch, so they are never read as flags of the command beside them.
     */
    aiCreateTail: (agentId: string): string =>
      `Create this scheduled task for agent \`${agentId}\`. Either run \`penguin schedule add <name> --agent-id ${agentId} --prompt "<the request>" --start-at <ISO 8601 or now>\`, adding \`--period <30m | 12h | 7d>\` when it repeats and \`--end-at <ISO 8601>\` when the request has a natural end — without \`--agent-id\` the task lands on whichever agent is running this conversation rather than on that one; or write the TOML file under that agent's agent_state/schedule/ yourself, with a semantic file name and the \`start_at\`, \`period\` and \`end_at\` keys. Use the new-Session mode unless the user names a Session. Then confirm the schedule you set in one line.`,
    /** The suggestion rows (name / schedule hint / one-line description) and the prompt each prefills — one phrased for this conversation, one for an agent as a whole. */
    suggestionsTitle: "Suggestions",
    suggestions: {
      dailyBrief: {
        name: "Daily brief",
        hint: "Weekdays at 08:00",
        description: "Yesterday's progress and today's to-dos, summarized",
        prompt:
          "Every weekday at 8:00 AM, give me a brief: yesterday's progress in this conversation and today's to-dos",
        agentPrompt:
          "Every weekday at 8:00 AM, produce a brief: yesterday's progress and today's to-dos",
      },
      weeklyReview: {
        name: "Weekly review",
        hint: "Fridays at 16:00",
        description: "Turn the week's work into a status update",
        prompt: "Every Friday at 16:00, turn this week's work into a status update",
        agentPrompt: "Every Friday at 16:00, turn this week's work into a status update",
      },
      followUp: {
        name: "Follow-up reminder",
        hint: "One-off",
        description: "A reminder to follow up on something, at the time you name",
        prompt: "Tomorrow at 10:00, remind me to follow up on X",
        agentPrompt: "Tomorrow at 10:00, remind me to follow up on X",
      },
      monitor: {
        name: "Monitor for updates",
        hint: "Every 6 hours",
        description: "Check a page or data source for changes on a schedule",
        prompt: "Every 6 hours, check <url> for updates and tell me what changed",
        agentPrompt: "Every 6 hours, check <url> for updates and report what changed",
      },
    },
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

  /** Plugin library page (features/plugins/plugins-page.tsx): one card per library plugin, installed on agents as a whole. */
  plugins: {
    installedTitle: "Installed plugins",
    installedDesc:
      "What this Project asks for, and which of those this process is running. A change applies without a restart where the server can re-assemble itself; re-assembling stops the agent runs in progress in every Project.",
    installedEmpty: "No plugins installed yet.",
    stateActive: "running",
    builtin: "built in",
    builtinHint:
      "Ships with this build: installing it downloads nothing, and it loads only once you install it.",
    installedRestart: "restart to load",
    stateFailed: "failed to load",
    replacesLabel: "replaces",
    restartPending:
      "A listed plugin is not running and this server could not apply it without a restart: restart the server to load it.",
    uninstall: "Remove",
    install: "Install",
    installing: "Installing…",
    /** The Project-level install: the plugin is listed, and running unless the row says otherwise. */
    deploymentInstalledToast: (name: string) => `Installed ${name}`,
    /** Listed, but the process could not load it: the reason, not a success. */
    deploymentFailedToast: (name: string, reason: string) => `${name} failed to load: ${reason}`,
    applyConfirmInstall: (name: string) => `Install ${name}?`,
    applyConfirmRemove: (name: string) => `Remove ${name}?`,
    applyConfirmBody: "Agent runs in progress in every Project will be stopped.",
    pageTitle: "Plugins",
    /** The header's machine picker: which machine's plugins the page shows and edits. */
    viewMachine: "Machine",
    allMachines: "All machines",
    thisServer: "This server",
    /** A row listed for some machines only, by alias. */
    onlyOn: (names: string) => `only on ${names}`,
    /** An all-machines row listed only for other machines. */
    notHere: "not on this server",
    /** A row the Project lists for a machine that has not reported it running yet. */
    notSynced: "not on that machine yet",
    /** Remove is unavailable in a machine's view for a plugin the shared table lists. */
    sharedCannotRemove: "Enabled on all machines: remove it in the All machines view.",
    machineUnreadable: (name: string, reason: string) =>
      `Could not read what ${name} runs: ${reason}`,
    /** Header icon button opening the Settings dialog on its Plugins page (admin only). */
    openSettings: "Plugin settings",
    pageDesc:
      "Every plugin in one list. The library's plugins ship with this build (skills and/or a hook package — quick-start a chat, or install to agents); the module plugins this Project asks for run in the server, and the rest of the registry can be installed for it.",
    /** The list's header: how many plugins are installed — the library's (shipped, every Agent may use them) plus the module plugins this Project lists. */
    installedSection: (n: number): string => `Installed plugins (${n})`,
    /** The second list: registry entries this Project does not ask for yet. */
    availableSection: (n: number): string => `Available (${n})`,
    notInstalled: "not installed",
    /** The filter column beside the lists, and the empty result. */
    filterCategories: "Categories",
    filterKind: "Contains",
    filterState: "Status",
    filterClear: "Clear filters",
    kindLabel: { skills: "Skills", hooks: "Hooks", modules: "Modules" },
    stateLabel: {
      installed: "Installed",
      available: "Available",
      running: "Running",
      restart: "Restart to load",
      failed: "Failed to load",
    },
    noMatch: "No plugin matches that.",
    /** The description of a shipped package the registry has no entry for. */
    shippedNoEntry: "Ships with this build; the registry has no entry for it yet.",
    /** The "built in" tag on a library plugin: it ships with the build and needs no download. */
    libraryBuiltinHint: "Ships with this build; install it to an agent to use it there.",
    pluginCount: (n: number): string => (n === 1 ? "1 plugin" : `${n} plugins`),
    searchPlaceholder: "Search plugins",
    /** Section labels of the plugin detail Modal. */
    detailSkills: "Skills",
    detailHooks: "Hooks",
    usedByAgents: (n: number): string =>
      n === 0 ? "not used yet" : n === 1 ? "used by 1 agent" : `used by ${n} agents`,
    /** Title on a disabled quick-start button: it pre-selects one of the plugin's skills on the currently selected agent, so the plugin has to be installed there first. */
    quickInvokeNeedsInstall: "Install this plugin on the current agent first to quick-start",
    installedToast: (plugin: string, agent: string): string => `Installed ${plugin} to ${agent}`,
    uninstalledToast: (plugin: string, agent: string): string =>
      `Uninstalled ${plugin} from ${agent}`,
    updateOutdated: (n: number): string => `Update available: update ${n} agent install(s)`,
    updateConfirmTitle: (name: string): string => `Update ${name}`,
    updateConfirmWarning: (name: string): string =>
      `Updating ${name} reinstalls the library copy over each agent's installed skill and hook files — any local edits are lost. Export a backup first if you need them.`,
    updatedToast: (plugin: string, n: number): string =>
      `Updated ${plugin} to the latest version (${n} agent(s))`,
    /** Uninstall confirmation: removing the installed copy deletes its files (local edits included). */
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (plugin: string, agent: string): string =>
      `Uninstall ${plugin} from ${agent}? Its installed skill and hook files (local edits included) will be deleted.`,
  },

  /** Agent settings "Hooks" tab (features/agents/hooks-tab.tsx): the hook packages installed on one agent — the list with its enable switch, the import modal (chat import / zip upload) and the export. The hook-point chips carry the bare point name (`stop`, `user_prompt`) and need no string. */
  hooks: {
    agentTabDesc:
      "Hook packages installed on this agent (agent_state/hooks/) — scripts the harness runs at the loop's hook points, e.g. after every Task. Uninstalling deletes the whole package directory.",
    agentTabEmpty: "No hook packages installed yet",
    /** Members see the switch state but cannot flip it (appended to the tab description). */
    readOnlyHint: "Only the Project owner can switch hooks on or off.",
    /** The agents page's hook-count stat (hover title / accessible name). */
    hookCount: (n: number): string => (n === 1 ? "1 hook package" : `${n} hook packages`),
    exportHook: "Export",
    importHook: "Import hook",
    importChatTitle: "Recommended: import it by chatting with the agent",
    importChatWhy:
      "The agent reads the source in full, reviews every script and installs the package on this agent — more reliable than a bare upload.",
    importSourceLabel: "Hook source",
    importSourceHint:
      "A URL, a GitHub repository, a local path, a description, or another tool's hook config (such as the hooks block of a Claude Code settings.json)",
    importSourcePlaceholder:
      'https://…, /path/to/hooks, or "write a stop hook that runs after every task…"',
    /** Preview placeholder shown in the generated prompt before a source is entered. */
    importSourceToken: "<source>",
    importPromptLabel: "Prompt to send to the agent (preview)",
    /** Lead sentence for a URL / repo / path source; free text (a description, a pasted hooks config) is used verbatim as the lead instead. Composed with importPromptTail by buildHookImportPrompt (features/agents/hook-import.ts). */
    importPromptLead: (s: string): string => `Import ${s} as a hook package.`,
    importCopyPrompt: "Copy prompt",
    importOpenChat: "Open a new chat",
    importUploadTitle: "Upload a hook package zip",
    importUploadDesc:
      "hooks.json and the scripts at the zip root, or exactly one top-level directory containing them. An import takes effect at once: while this agent has hooks on, its scripts run on this machine at every hook point, so import only what you trust.",
    importUploadAction: "Choose zip file",
    importUploading: "Uploading…",
    importDoneToast: "Hook package installed",
    importOverwriteTitle: "Overwrite installed hook package",
    importOverwriteBody: (name: string): string =>
      `The hook package "${name}" is already installed. Overwriting replaces all of its files (local edits included) and cannot be undone. Continue?`,
    importOverwriteAction: "Overwrite",
    /** The fixed tail joined after the lead (features/agents/hook-import.ts): the review step, the package format, the script contract and the install target, named by Project and Agent id. */
    importPromptTail: (projectId: string, agentId: string): string =>
      [
        "Read the source in full first and review every script for malicious behavior (exfiltrating data, touching files outside its source, running unknown commands); continue only once it is safe.",
        'Then produce a PenguinHarness hook package: a hooks.json (name, description, description_zh, version in the YYYY.MM.DD.N format, and one command list per hook point — stop / pre_tool_use / user_prompt — each entry { "command": "<script path relative to the package>", "timeout": <seconds> }) plus plain Node .mjs scripts using builtin modules only.',
        'Script contract: stdin carries one JSON object — at the stop point { "hook": "stop", "session_id", "trace_path" } (trace_path is the Trace file the Session is writing, absent without a Trace); the pre_tool_use point adds tool_name, tool_call_id and arguments (the raw argument JSON string); the user_prompt point carries scratchpad_dir and prompt instead. Empty stdout means no opinion; otherwise stdout is one JSON answer — stop: { "decision": "continue" | "stop", "input", "reason", "output", "subagent"? }, pre_tool_use: { "decision": "allow" | "deny", "reason", "output" }, user_prompt: { "context" }. A non-zero exit, non-JSON stdout or a timeout is recorded as a failure and ignored.',
        `Install it into agent_state/hooks/<name>/ of agent "${agentId}" in Project "${projectId}" (the directory name is the package name and must match ^[A-Za-z0-9_-]+$), then tell me what it does and at which hook point it fires.`,
      ].join("\n"),
    uninstallConfirmTitle: (name: string): string => `Uninstall ${name}`,
    uninstallConfirmBody: (name: string, agent: string): string =>
      `Uninstall the ${name} hook package from ${agent}? All of its scripts (local edits included) will be deleted.`,
    uninstalledToast: (name: string, agent: string): string =>
      `Uninstalled the ${name} hook package from ${agent}`,
    /** The Agent-level switch card at the top of the tab (usePromptInjection); hooks have no prompt half. */
    injection: {
      enable: "Enable hooks",
      enableHint:
        "With it on, every Session this agent starts runs all installed hook packages at the loop's hook points. With it off, a new Session runs no hooks at all and the installed packages stay on disk. A Task already running keeps the setting it started with.",
      savedToast: "Saved — takes effect from the next turn",
    },
  },

  pluginRegistry: {
    pageTitle: "Plugins",
    empty: "No plugins yet",
    specifierHint: "Package name, as a Project's plugin list names it",
    back: "Back to Plugins",
    readme: "Documentation",
    noReadme: "This plugin has no documentation yet.",
    notFound: "No such plugin.",
    repository: "Repository",
    homepage: "Homepage",
    authors: "Authors",
    license: "License",
    copySpecifier: "Copy specifier",
    installHint:
      "Install from the Plugins page: the row's Install button asks the current Project for it.",
  },

  skills: {
    quickInvoke: "Quick start",
    quickInvokeText: (name: string): string => `use the ${name} skill`,
    selectAll: "Select all",
    selectNone: "Select none",
    selectedCount: (n: number): string => `${n} selected`,
    manageInstall: "Manage installs",
    manageInstallTitle: (name: string): string => `Manage installs: ${name}`,
    install: "Install",
    installed: "Installed",
    uninstall: "Uninstall",
    skillCount: (n: number): string => (n === 1 ? "1 skill" : `${n} skills`),
    /** The plugin library's per-agent update button, and the confirm buttons of every update dialog. */
    updateAction: "Update",
    /** Settings Skills tab: toast after uninstalling one skill. */
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
    thinkingLevelChangeNote:
      "Applies right away. Changing it invalidates the model's cached context — compacting first is recommended.",
    surface: {
      conversation: "Conversation",
      chooseKind: "Choose what to open",
      open: "Open",
      opening: "Opening…",
      promptPlaceholder: "First prompt",
      exited: "The program has exited.",
      restart: "Open again",
      close: "Close",
      unavailable: "The plugin that renders this conversation is not loaded.",
      noRenderer: "This build has no renderer for it.",
      noTerminal: "The surface offered no terminal.",
    },
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
    onMachine: (name: string, machine: string) => `${name} [SSH: ${machine}]`,
    machineTag: (machine: string) => `[SSH: ${machine}]`,
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
    /** The composer's permission button: one colored shield for the level, a menu of Fs / Network / More. */
    permission: {
      label: "Permissions",
      levels: {
        all: "Full access",
        partial: "Partial",
        "read-only": "Read only",
        off: "Off",
      } as Record<string, string>,
      fs: "Filesystem",
      fsModes: {
        "read-only": "Read only",
        "workspace-write": "Workspace write",
        "danger-full-access": "Full access",
      } as Record<string, string>,
      network: "Network",
      networkModes: {
        open: "Full access",
        local: "Local network (localhost only)",
        none: "No network",
      } as Record<string, string>,
      unsupported: "Not supported",
      localUnsupported: "No sandbox backend on this machine can limit the network to localhost",
      more: "More…",
      approval: "Approval",
    },
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
    /** The background-task mark on a session row and the chat header's count: background processes plus background subagents still running. */
    backgroundTasks: (n: number) => (n === 1 ? "1 background task" : `${n} background tasks`),
    /** The session row's alarm clock: at least one enabled scheduled task is bound to this conversation (a paused one draws no mark). */
    sessionScheduled: "Has a scheduled task still to fire",
    /** The tool row's marker for the ONE call whose work went to the background — launched with `run_in_background`, or moved there by the user — rather than for a count. Bracketed, like the row's other outcome markers. */
    backgroundCall: "[Background]",
    /** The tool row's inline text action, shown while the call is executing (also its accessible name). */
    sendToBackground: "Send to background",
    /** Its tooltip: what the click does to the call and to the conversation. */
    sendToBackgroundHint:
      "Send this call to the background; the conversation carries on, and its completion arrives as a background notice.",
    pendingApprovals: (n: number) => `${n} pending approval${n > 1 ? "s" : ""}`,
    jumpToLatest: "Jump to latest",
    /** Top-of-stream affordance while the previous history window is being fetched (scroll-up backfill). */
    loadingEarlier: "Loading earlier messages…",
    /** Top-of-stream affordance after a backfill failure: click to retry fetching the previous window. */
    loadEarlierRetry: "Failed to load earlier messages — click to retry",
    /** Top-of-stream marker once the loaded history reaches the very beginning (shown only after a backfill happened). */
    historyBeginning: "Beginning of conversation",
    loadingLater: "Loading later messages…",
    loadLaterRetry: "Failed to load later messages — click to retry",
    outlineOpenFailed: "Could not open that turn",
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
      "This model cannot view images directly: on send, images are saved to the session scratchpad and passed as file paths (viewed via read_file)",
    infoPanel: "Session info",
    sessionStats: "Stats",
    /** Info-dropdown Session id row: the id itself is a click-to-copy button. */
    sessionIdLabel: "Session id",
    copySessionId: "Copy Session ID",
    /** Info-dropdown list of background processes the conversation started, and its per-row actions (Stop on running rows, Remove on exited ones). */
    processList: "Processes",
    processStop: "Stop",
    processExited: "exited",
    processRemove: "Remove",
    /** Remove button tooltip: removal also drops the output captured from that process. */
    processRemoveHint: "Remove this entry — the output captured from it is discarded too",
    statTokens: "Total Tokens",
    /** Info-dropdown stats list: the tokens bullet's label and its cache-hit-rate parenthetical (rate = cacheRead ÷ all input, e.g. "68%"). */
    statTotalTokens: "Total Tokens",
    statCacheHit: (pct: string) => `cache hit rate ${pct}`,
    statElapsed: "Elapsed",
    statElapsedSplit: (apiMs: string, toolMs: string): string => `API ${apiMs}, tools ${toolMs}`,
    statInput: "Input tokens",
    statCached: "cached",
    statOutput: "Output tokens",
    statTps: "Output TPS",
    /** Copied-stats-line parenthesis wrappers around the cached amount (ASCII with a leading space for en). */
    statParenOpen: " (",
    statParenClose: ")",
    noSessions: "No Sessions yet",
    /** The routed conversation is on a machine with no connection held: not gone, just out of reach from here. */
    sessionOnOfflineMachine: (machine: string) =>
      `This conversation is on ${machine}, which is not connected right now.`,
    sessionOnOfflineMachineUnknown:
      "This conversation is on a machine that is not connected right now.",
    sessionOfflineHint: "It will open as soon as the connection is back.",
    emptyStream: "Send a message to start the conversation",
    historyLoadFailed: "Failed to load history",
    statsLabel: "Stats",
    removeImage: "Remove image",
    openAgents: "Agents panel",
    /** Panel switcher (chat toolbar top-right): the "create" dropdown and its pin toggles. */
    workspacePanel: "Files",
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
    contextWindowIs: (n: string): string => `Max context ${n}`,
    contextTopToolsHint:
      "Ranked by the context each tool's calls and results occupy (definitions count under “Tool definitions”)",
    contextTopFiles: "Top 5 files",
    contextTopFilesHint:
      "Ranked by the context each file's read_file / edit_file / write_file calls and results occupy; hover a row for the full path",
    contextRankLabel: "Ranking",
    contextRankTools: "Tools",
    contextRankFiles: "Files",
    contextNoFileTraffic: "No file traffic in this context",
    contextUnknownHint:
      "Just compacted — the next request reports the usage, and the composition with it",
    contextBreakdownEmpty: "Nothing in the current context to break down yet",
    contextBreakdownFailed: "Could not read the context composition",
    contextThresholdCutter: "Compaction threshold",
    contextThresholdHover: (n: string): string => `Compaction threshold ${n} (drag to adjust)`,
    /** Tooltip of the hatched stretch of the bar past the cutter: room the model has, unusable before compaction fires. */
    contextBeyondThreshold:
      "Room past the compaction threshold: compaction fires first, so this part is not usable yet",
    contextThresholdTitle: "Change the compaction threshold",
    contextThresholdBody: (agentName: string, old: string): string =>
      `Change ${agentName}'s compaction threshold from ${old} to the value below? It takes effect immediately, including the running conversation.`,
    contextThresholdField: "Compaction threshold (tokens)",
    contextThresholdInvalid: "Must be a whole number above 0",
    contextThresholdCapped: (n: string): string =>
      `Above the model window — the threshold in force will be ${n}`,
    contextThresholdSaved: (n: string): string =>
      `Compaction threshold changed to ${n}; it applies immediately`,
    contextWindowUnderThreshold: (n: string, m: string): string =>
      `This model's context window ${n} is smaller than this agent's compaction threshold ${m}, so compaction actually fires at the edge of the window. Drag the dashed mark in the context panel, or set the threshold below the window in the agent settings — it applies immediately.`,
    contextWindowUnderThresholdAction: "Open agent settings",
    contextWindowUnderThresholdDismiss: "Dismiss",
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
    /** `[org_trigger]` banner: what the organization scheduler sent this desk or ticket session, folded into one line. */
    orgTriggerFrom: (org: string): string => `Triggered by organization "${org}"`,
    orgTriggerKinds: {
      init: "Initialization",
      event: "Calendar event",
      mention: "Channel mention",
      ticket_notice: "Ticket notice",
      ticket_work: "Ticket work",
    } as Record<string, string>,
    orgTriggerBudget: (budget: string): string => `budget ${budget}`,
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
    compactionRunning: (mode: string): string => (mode === "discard" ? "Clearing" : "Compacting"),
    compactionDone: (mode: string): string => (mode === "discard" ? "Cleared" : "Compacted"),
    compactionResult: "Result",
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
    /**
     * Short display names for the built-in tools, keyed by the name the model calls them
     * by. The tool-call card shows these while the Appearance switch is on; a tool absent
     * from this table (MCP tools, names only older Traces carry) renders as itself.
     */
    toolAliases: {
      read_file: "read",
      write_file: "write",
      edit_file: "edit",
      exec_command: "exec",
      input_command: "follow",
      run_subagent: "subagent",
      input_subagent: "communicate",
    } as Record<string, string>,
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
      benchmark: (n: number) => `Evaluations (${n})`,
      archived: (n: number) => `Archived (${n})`,
    },
    /** Tooltip of a folder-only group's header (nothing active of its own): what its folders hold, plus the Workspace path where the header has one. */
    folderOnlyGroup: (n: number, path?: string) =>
      `Folded tasks only: ${n} conversation${n === 1 ? "" : "s"}${path ? ` (${path})` : ""}`,
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
    /** Label of the collapsed card a harness-injected user message renders as (a stop hook's continue, a goal round's protocol, a user_prompt hook's expansion). */
    harnessInjected: "Injected by the harness",
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

  /** WeChat-channel strings of the messaging binding editor (channel-neutral ones live under `messaging`). */
  wechat: {
    /** The what-binding-does FAQ fold's body (this channel's flavor). */
    intro:
      "Once bound, messages sent to the bot in WeChat arrive in this conversation and the AI's replies go back to WeChat. Binding is a QR code scanned in WeChat — no public address, and no credential to apply for in any console.",
    /** The stored-token row's clear checkbox (the models-page clear idiom). */
    clearToken: "Clear stored Bot Token",
    /** Why this channel's form has no credential fields at all. */
    scanOnly:
      "A WeChat bot's credential comes only from scanning: there is no App ID or secret to fill in by hand.",
    /** Why "send test message" is disabled before the bot has ever been messaged. */
    testMessageNoChat:
      "Send the bot a message in WeChat first, so it knows which conversation to reply to",
    /**
     * The channel's shape, stated below its controls rather than left in a collapsed fold:
     * a user who binds it and then writes in a group sees nothing arrive.
     */
    directOnly:
      "This channel carries direct chats with the bot only; group messages never reach it.",
    /** What travels, and the one inbound kind that does not. */
    media:
      "Text, images and files travel in both directions. A voice message arrives as WeChat's own transcription of it; a recording WeChat could not transcribe cannot be read.",
    /** Scan-to-connect: the button, and the states it moves through. */
    scanStart: "Connect by scanning",
    /** The same control once a binding exists: scanning again replaces the stored credential. */
    scanRescan: "Scan again",
    scanStarting: "Generating the code…",
    scanQrLabel: "WeChat bot authorization QR code",
    scanWaiting: "Waiting for the code to be scanned in WeChat…",
    scanSteps: "Scan the code with WeChat on your phone, then confirm the authorization there.",
    /** Scanned but not yet confirmed: the phone is waiting, not this panel. */
    scanScanned: "Scanned — confirm the authorization on your phone.",
    /** Shown only after a code has actually lapsed and been replaced. */
    scanRefreshed: "The previous code lapsed; this one is new.",
    /** Why the credential is safe to obtain this way — the question a careful user will ask. */
    scanPrivacy:
      "The credential is received and stored by the server; it never reaches the browser.",
    scanDone: (botId: string): string =>
      `Saved the credential for bot ${botId} — the connection can be enabled now`,
    scanFailed: (reason: string): string => `Connecting by scan failed: ${reason}`,
    /** Shown when replacing lapsed codes stopped being worth another round trip. */
    scanExpiredRepeatedly:
      "The code lapsed before it was scanned several times over. Try again later.",
    /** The platform stopped accepting pairing codes for this scan. */
    scanBlocked:
      "Too many wrong pairing codes, so this scan is spent. Start a new one in a little while.",
    /** Not a failure: the bot is already bound here, so no new credential was issued. */
    scanAlreadyBound:
      "This bot is already bound, here or somewhere else, so no new token was issued. If this conversation is the one that should have it, unbind the bot where it is in use and scan again.",
    /** Why the scan button is gated while this channel holds the connection. */
    scanDisableFirst: "Disable the connection before rebinding it by scan",
    /** The pairing-code step: WeChat shows digits on the phone that must be typed here. */
    verifyPrompt: "Your phone is showing a number. Enter it to continue:",
    verifyLabel: "Pairing code",
    verifySubmit: "Confirm",
    verifySubmitting: "Submitting…",
    /** The setup FAQ fold's steps. */
    setupSteps: [
      "Press “Connect by scanning” above to generate the code",
      "Scan it with WeChat on your phone",
      "If your phone shows a number, type it into the panel",
      "Confirm the authorization on your phone; the credential is saved automatically",
      "Find the bot in WeChat and send it one message",
    ],
  },

  /**
   * Session ↔ messaging-bot binding: the dock panel, the row action + dialog, and the
   * channel-neutral editor strings (per-channel fields live under `feishu` / `telegram` /
   * `qq`).
   */
  messaging: {
    panelTitle: "Remote control",
    /** Session-row context-menu action. */
    bindAction: "Remote control",
    dialogTitle: "Remote control",
    /** The channel selector (always live: each channel's config is saved independently). */
    channelLabel: "Channel",
    channelName: {
      feishu: "Feishu",
      telegram: "Telegram",
      qq: "QQ",
      wechat: "WeChat",
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
    /** The saved delivery option: render a reply's Markdown in the channel's own markup. */
    renderMarkdown: "Render Markdown",
    /**
     * Its disclosure, beside the label. One per channel, because what a channel can show is
     * the whole of what the reader needs to know here — a shared sentence would have to say
     * "depending on the channel", which answers nothing.
     */
    renderMarkdownHelpFeishu:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. Feishu renders it as a card: headings, bold, italic, strikethrough, code and fenced code blocks, lists, quotes, rules, links and tables. A table longer than five rows arrives as a code block so no row is hidden. If Feishu refuses the card, the reply is sent as plain text rather than lost.",
    renderMarkdownHelpTelegram:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. Telegram shows bold, italic, strikethrough, links, inline code and code blocks; it has no headings, lists or tables, so a heading becomes a bold line, list markers become part of the text, and a table arrives as a code block. If Telegram refuses the formatting, the reply is sent as plain text rather than lost.",
    renderMarkdownHelpQQ:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. QQ shows headings, bold, italic, strikethrough, lists, quotes, rules and links; it has no code formatting and no tables, so a code block arrives as plain lines and a table as its rows. If QQ refuses the formatting, the reply is sent as plain text — which costs one more of the few replies QQ allows per message.",
    renderMarkdownHelpWeChat:
      "A reply's Markdown arrives as formatting instead of as `**characters**`. WeChat reads Markdown itself and shows the most of the four channels: headings, bold, strikethrough, lists, quotes, rules, links, inline code, code blocks and tables all render. What it cannot show keeps its words and loses its markers — headings past the fourth level, italics around Chinese text, and inline images, which become links.",
    /** The saved delivery option: one message per non-blank line of a reply. */
    linePerMessage: "One message per line",
    /** Its disclosure, beside the label: what the option does to a reply, and its two edges. */
    linePerMessageHelp:
      "Each non-blank line of a reply is sent as its own message, so an answer written as several spoken lines arrives as several messages. Past a per-reply limit the remaining lines are combined into one last message rather than dropped.",
    /** The saved delivery option: hold a run's working notes, send its last reply only. */
    finalReplyOnly: "Final reply only",
    /** Its disclosure, beside the label: what the option changes, and what it costs. */
    finalReplyOnlyHelp:
      "Sends only the last thing the assistant says in a run, when the run ends; the notes it writes between tool calls stay in the web app. The cost is hearing nothing while a long run is under way. The approval reminder is not a reply and still arrives immediately.",
    /**
     * Appended to the option's explanation on QQ only. Not a nuance of the same trade but a
     * different outcome — silence on the other two channels, lost output here — which the
     * channel-neutral sentence above would leave the user to discover from an empty chat.
     */
    finalReplyOnlyQQWarning:
      "QQ can only answer an inbound message, and that anchor expires after about five minutes: with this on, a run taking longer delivers nothing at all.",
    /** Enabled-row indicator's tooltip / sr text (the small per-channel glyph on the session row). */
    enabledIndicator: {
      feishu: "Feishu connection enabled",
      telegram: "Telegram connection enabled",
      qq: "QQ connection enabled",
      wechat: "WeChat connection enabled",
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
    /** WeChat has no group inbound at all — the answer to "I @-ed it in a group and nothing happened". */
    troubleWeChatDirect:
      "The WeChat channel receives direct chats only: @-mentioning the bot in a group does nothing at all. Message it directly instead.",
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
    /** Desktop shell's own window only: opens the previewed file's directory in the OS file manager. */
    revealInFolder: "Show in folder",
    /** Row / preview context menu: the two entries both kinds carry, then the kind-specific one. */
    copyPath: "Copy relative path",
    addToChat: "Add to conversation",
    addSelectionToChat: "Add selection to conversation",
    uploadHere: "Upload here",
    openInNewTab: "Open in new tab",
    previewNotIsolatedHint:
      "This address has no separate preview origin, so the page opens sandboxed: localStorage, cookies and third-party embeds will not work. Reach the app over 127.0.0.1 or localhost, or set PENGUIN_PREVIEW_ORIGIN.",
    refresh: "Refresh",
    /** The Workspace root, as the breadcrumbs and the drop overlay name it. "." is what a
     *  shell calls the working directory, so it needs no translation. */
    root: ".",
    empty: "Empty directory",
    previewUnsupported: "Preview not supported for this type; download instead",
    uploadedCount: (n: number): string => (n === 1 ? "1 file uploaded" : `${n} files uploaded`),
    uploading: (done: number, total: number): string => `Uploading ${done}/${total}…`,
    /** Oversize picks are named and skipped before anything is read. */
    uploadTooLarge: (names: string, mb: number): string =>
      `Over the ${mb}MB upload limit, skipped: ${names}`,
    /** A dropped folder is not a file the upload endpoint can take; it is named and skipped. */
    folderDropSkipped: (names: string): string => `Folders cannot be uploaded, skipped: ${names}`,
    /** Upload-overwrite confirmation: same-name files in the target directory will be replaced. */
    overwriteTitle: "Overwrite existing files",
    overwriteConfirm: (n: number): string =>
      `The target directory already has ${n} file(s) with these names — uploading will overwrite:`,
    loadFailed: "Failed to load",
    previewTruncated: "File too large; preview truncated, download for the full file",
    htmlRendered: "Preview",
    htmlSource: "Source",
    backToList: "Back to list",
    /** The tree pane: its accessible name and the toolbar toggle's two states. */
    treeLabel: "File tree",
    showTree: "Show file tree",
    hideTree: "Hide file tree",
    /** The divider between the tree and the preview: drag, or nudge with the arrow keys. */
    treeWidth: "Resize the file tree",
    /** The search box above the tree; it reaches only as far as the lazy tree has been loaded. */
    searchPlaceholder: "Search files",
    searchClear: "Clear search",
    searchNoMatch: "No matches in the Workspace",
    /** The walk is server-side and covers the whole Workspace, so it is not instant on a large one. */
    searching: "Searching…",
    /** The server stopped at its cap: what is listed is the shallowest matches, not all of them. */
    searchTruncated: (n: number): string => `Too many matches — showing the first ${n}`,
    selectFile: "Select a file to preview",
    /** Drop overlay label; `dir` is the directory the files will land in (the root's display name for the root). */
    dropToUpload: (dir: string): string => `Drop to upload into ${dir}`,
    /** In-place text editing. */
    editorLabel: (name: string): string => `Editing ${name}`,
    /** Soft-wrap toggle, shared by the source view and the editor: off means long lines scroll sideways. */
    wrapLines: "Wrap",
    unsaved: "Unsaved changes",
    saveTitle: "Save (Ctrl+S / ⌘S)",
    saveConfirmTitle: "Save file",
    saveConfirm: (name: string): string =>
      `Save changes to ${name}? The file in the Workspace will be overwritten.`,
    editTooLarge: (kb: number): string =>
      `The file is larger than ${kb}KB and cannot be edited here — download it instead`,
    saveTooLarge: (mb: number): string =>
      `The content exceeds the ${mb}MB write limit and was not saved`,
    discardTitle: "Discard unsaved changes",
    discardBody: (name: string): string => `${name} has unsaved changes. Discard them?`,
    discard: "Discard",
    unsavedRestored: (name: string): string => `Restored unsaved changes to ${name}`,
    /** The file was rewritten (by the Agent, most likely) while the editor was open on it. */
    changedOnDisk: "Changed on disk",
    changedOnDiskHint:
      "This file has been rewritten since you opened it — saving replaces that version with yours.",
    /** Rename and move are one action: both write the file to a new Workspace-relative path. */
    /** The composer chip's remove button, for whatever the Files panel staged there. */
    removeReference: "Remove reference",
    renameTitle: "Rename or move",
    renameLabel: "New path",
    renameHint:
      "Relative to the Workspace root; a directory in the path that does not exist is created",
    renameConfirm: "Move",
    renameTargetExists: (path: string): string => `${path} already exists, so nothing was changed.`,
    renamed: (name: string): string => `Moved to ${name}`,
    deleteTitle: "Delete file",
    deleteBody: (name: string): string => `Delete ${name}? It does not go to a trash folder.`,
    deleted: (name: string): string => `Deleted ${name}`,
    /** Both actions read the file's current version first; until it lands there is nothing to refuse an overwrite with. */
    actionVersionReading: "Reading this file's current version…",
    actionVersionFailed:
      "This file's current version could not be read, so the action is not offered.",
    /** The version precondition refused it: the Agent wrote the file while the question was on screen. */
    changedBeforeAction: (name: string): string =>
      `${name} was rewritten while you were deciding, most likely by the Agent during its turn, so nothing was changed. Refresh and try again.`,
    conflictTitle: "File changed on disk",
    conflictBody: (name: string): string =>
      `${name} was rewritten after you opened it, most likely by the Agent during its turn, so nothing was saved. Overwrite it with your version, or keep editing and copy what you need out first — either way your text is kept.`,
    overwriteAnyway: "Overwrite",
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
    /** Clearing the table: the action, and the confirm that must name exactly what goes. */
    errorsClear: "Clear",
    errorsClearTitle: "Clear error records",
    errorsClearRangePreset: (preset: "1h" | "1d" | "7d" | "30d" | "90d"): string =>
      ({
        "1h": "in the last hour",
        "1d": "in the last 24 hours",
        "7d": "in the last 7 days",
        "30d": "in the last 30 days",
        "90d": "in the last 90 days",
      })[preset],
    errorsClearRangeCustom: (from: string, to: string): string => `between ${from} and ${to}`,
    errorsClearScope: (count: number, range: string): string =>
      `Deletes this Project's ${count} error record${count === 1 ? "" : "s"} ${range}. Records outside that range are kept.`,
    errorsClearScopeAgent: (count: number, range: string, agentId: string): string =>
      `Deletes this Project's ${count} error record${count === 1 ? "" : "s"} for agent ${agentId} ${range}. Other agents and records outside that range are kept.`,
    errorsClearIrreversible: "This cannot be undone.",
    errorsClearDone: (count: number): string =>
      `Deleted ${count} error record${count === 1 ? "" : "s"}`,
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
    /** Shown while the file's remaining pages are still being fetched; gone once every message is on screen. */
    loadingNote: (shown: number, total: number) => `Loaded ${shown} / ${total} messages…`,
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
    avgToolCalls: "Avg tools / turn",
    inProgress: "in progress",
    systemPrompt: "System prompt",
    toolDefs: (n: number) => `Tool definitions (${n})`,
    exportFile: "Export",
  },

  benchmark: {
    title: "Evaluation Center",
    guideFlow: [
      {
        title: "Create",
        text: "Press Create with AI at the top right to have AI write a set of cases for an agent and take its baseline score, or Create manually to write the cases yourself.",
      },
      {
        title: "Evaluate",
        text: "Pick a Benchmark, press Use → Evaluate, choose the agent under test and send the prefilled conversation to get one labelled score.",
      },
      {
        title: "Optimize",
        text: "Pick a Benchmark, press Use → Optimize, set a target score and send; a new version is kept only when the score strictly improves.",
      },
    ],
    searchPlaceholder: "Search titles, descriptions or tested agents",
    noMatches: "No Benchmark matches",
    filterByAgent: (agentId: string): string => `Benchmarks that evaluated ${agentId}`,
    clearFilter: "Show all",
    emptyTitle: "No Benchmarks yet",
    emptyDescription:
      "Start by letting AI write cases for an agent and take a baseline. Score curves and per-case detail appear here afterwards, with optimization one click away.",
    caseCount: (n: number): string => `${n} case${n === 1 ? "" : "s"}`,
    runsPerCase: (n: number): string => `${n} run${n === 1 ? "" : "s"} per case`,
    notEvaluated: "Not evaluated yet",
    /** A draft Benchmark: the agent is still writing its cases, so card and page are masked. */
    building: "Being built",
    buildingHint:
      "The agent is still writing the cases and calibrating their difficulty; the Benchmark opens once that is done",
    buildingDetail:
      "Once it is built, the cases, the score chart and the evaluation table appear here.",
    /** A Benchmark whose calibration never finished: unusable, so the card and page are masked. */
    creationFailed: "Creation failed",
    creationFailedHint:
      "The cases' difficulty could not be calibrated; delete this Benchmark and create it again",
    creationFailedDetail:
      "Calibration of this Benchmark never completed, so it cannot be evaluated or optimized; delete it and create it again.",
    testedAgents: "Tested agents",
    lastEvaluated: (when: string): string => `last evaluated ${when}`,
    sparklineLabel: (n: number): string => `Score trend over ${n} evaluation${n === 1 ? "" : "s"}`,
    latestScoreLabel: "Latest score",
    firstEvaluation: "first evaluation",
    use: "Use",
    evaluate: "Evaluate",
    optimize: "Optimize",
    view: "View",
    copyPath: "Copy directory path",
    deleteBenchmark: "Delete Benchmark",
    deleteConfirm: (title: string): string =>
      `Delete "${title}"? All of its cases and evaluation records will be removed; this cannot be undone.`,
    deleted: "Benchmark deleted",
    backToList: "Back to list",
    /** The Benchmark's own page when the id in the address resolves to nothing. */
    notFound: "This Benchmark was not found",
    notFoundHint: "It may have been deleted, or the link carries an id that no longer exists.",
    trendTitle: (metric: string): string => `${metric} over time`,
    cases: "Cases",
    viewCase: "View details",
    taskMaterials: "Task materials",
    rubric: "Scoring rubric",
    agentHidden: "Hidden from Target Agent",
    caseFileUnavailable: "Case files are unavailable",
    evaluations: "Evaluations",
    noEvaluations: "No evaluations yet",
    noEvaluationsHint:
      "The score curve and evaluation detail appear here once a baseline is taken.",
    summaryLabel: "Summary",
    unlabeled: "Unlabeled",
    agentColumn: "Tested agent",
    colVersion: "Version",
    colModel: "Model ID",
    colThinkingLevel: "Thinking level",
    colScore: "Score",
    colDuration: "Duration",
    colCase: "Case",
    colRun: "Run",
    colSession: "Session",
    askAi: "Ask AI",
    evaluationDetailTitle: (time: string): string => `Evaluation · ${time}`,
    askEvaluationTitle: "Ask AI about this evaluation",
    askEvaluationDescription:
      "The total score, the per-case results and every run's Session id go along with your question; the agent reads the scoreboard and the matching Traces before answering. The prompt stays editable.",
    askEvaluationDefault: "Explain this evaluation's result.",
    /** The default question leads the examples (it is what the box opens with), so a reader who tried another can bring it back. Keep `explain.prompt` equal to askEvaluationDefault. */
    askEvaluationExamples: {
      explain: {
        label: "Explain this evaluation's result",
        prompt: "Explain this evaluation's result.",
      },
      whyLow: {
        label: "Why is the score low?",
        prompt:
          "Why did this evaluation score so low? Use the per-case scores and the runs to say where the points were actually lost.",
      },
      weakest: {
        label: "Which cases are weakest, and what should change?",
        prompt:
          "Which cases scored worst? For each, what caused it, and what single change to the tested agent has a chance of lifting it?",
      },
      againstPrevious: {
        label: "What changed against the previous evaluation?",
        prompt:
          "Compared with this series' previous evaluation, which cases went up and which went down? What most likely caused those changes?",
      },
    },
    askEvaluationTail: (p: {
      benchmarkId: string;
      time: string;
      label: string;
      version: number;
      provider: string;
      modelId: string;
      thinkingLevel: string;
      score: string;
      cost: string;
      duration: string;
      summaryTitle: string;
      summary: string;
      cases: { id: string; score: string; cost: string; duration: string; sessionIds: string[] }[];
    }): string =>
      "Explain the result of the Benchmark evaluation below. Read and analyze only: change neither this Benchmark nor the tested agent.\n\n" +
      `- benchmark_id: \`${p.benchmarkId}\` (the Project's \`benchmarks/${p.benchmarkId}/\`; the scoreboard is \`benchmarks/${p.benchmarkId}/scoreboard.yaml\`)\n` +
      `- Evaluated at: ${p.time}\n` +
      `- Series label: ${p.label}\n` +
      `- Tested version: v${p.version}\n` +
      `- Evaluation runtime: provider \`${p.provider}\` / model_id \`${p.modelId}\` / thinking_level \`${p.thinkingLevel}\`\n` +
      `- Total score ${p.score}; cost ${p.cost}; duration ${p.duration}\n` +
      (p.summaryTitle !== "" ? `- Summary title: ${p.summaryTitle}\n` : "") +
      (p.summary !== "" ? `- Summary: ${p.summary}\n` : "") +
      "- Per-case scores (score, cost, duration, and the Session id of every run):\n" +
      p.cases
        .map(
          (c) =>
            `  - \`${c.id}\`: ${c.score}; ${c.cost}; ${c.duration}; Session ` +
            (c.sessionIds.length > 0
              ? c.sessionIds.map((id) => `\`${id}\``).join(", ")
              : "not recorded"),
        )
        .join("\n") +
      "\n\nRead this record in scoreboard.yaml, and the Traces of the Sessions listed above as far as you need them. Then say how these scores came about, " +
      "which cases are weakest and exactly why, and what to do next (which part of the tested agent to change, or which evidence to gather first).",
    askCaseTitle: "Ask AI about this case",
    askCaseDescription:
      "The paths to the statement and the rubric go along with your question, so the agent can say what this case tests and what answering it well takes. The case is frozen: it reads, it does not edit.",
    askCaseDefault: "Explain what this case tests and what a strong answer looks like.",
    /** As for the evaluation dialog: the default question leads, equal to askCaseDefault. */
    askCaseExamples: {
      explain: {
        label: "Explain what this case tests and what a strong answer looks like",
        prompt: "Explain what this case tests and what a strong answer looks like.",
      },
      rubricRewards: {
        label: "What does the rubric reward?",
        prompt:
          "Where does this case's rubric put its points? Which items do the most to separate excellent work from merely passing work?",
      },
      whyRunLow: {
        label: "Why did a run score low here?",
        prompt:
          "The latest evaluation did not score well on this case. Which step is the tested agent most likely losing it at?",
      },
      clearerStatement: {
        label: "How could the statement be clearer?",
        prompt:
          "Is anything in this statement ambiguous or easy to misread? The case is frozen and cannot be edited, so say how to write it more clearly in the next Benchmark instead.",
      },
    },
    askCaseTail: (p: {
      benchmarkId: string;
      caseId: string;
      latest: { time: string; score: string; runs: { score: string; sessionId: string }[] } | null;
    }): string =>
      "Explain what the Benchmark case below tests and what a strong answer looks like. A case is frozen once it exists: read and analyze only, and do not change this Benchmark.\n\n" +
      `- benchmark_id: \`${p.benchmarkId}\` (the Project's \`benchmarks/${p.benchmarkId}/\`)\n` +
      `- case_id: \`${p.caseId}\`\n` +
      `- Statement: \`benchmarks/${p.benchmarkId}/${p.caseId}/statement/README.md\`\n` +
      `- Rubric: \`benchmarks/${p.benchmarkId}/${p.caseId}/rubric/README.md\`\n` +
      (p.latest === null
        ? "- This Benchmark has no evaluations yet.\n"
        : `- The latest evaluation (${p.latest.time}) averaged ${p.latest.score} on this case\n` +
          p.latest.runs
            .map((r, i) => `  - Run #${i + 1}: ${r.score}; Session \`${r.sessionId}\`\n`)
            .join("")) +
      "\nRead both READMEs above (and the Traces of the Sessions listed, if there are any). Then say what capability this case actually tests, " +
      "what a strong answer looks like (the decisions and the artifact it takes), and which rubric items separate excellent work from merely passing work.",
    aiCreateTitle: "Create a Benchmark with AI",
    aiCreateDescription:
      "Describe the capability and the scenarios to test. AI writes the cases for the Test Agent, trial-runs each one to calibrate difficulty, and takes a baseline score.",
    targetAgent: "Test Agent",
    targetAgentHint:
      "The agent the cases are written for and scored under; the writing itself is done by the agent named below, in a new conversation",
    aiCreateExamples: {
      decisionAgent: {
        label: "Decisions: finite choices in football, after-sales and investing",
        description: "Public rules, past cases and current facts that conflict or fall short",
        prompt:
          "Write cases for a general decision agent: three scenarios — football betting, an after-sales action, an investment move — each with a fixed set of options, where the public rules, the historical cases and the current facts are either incomplete or contradict one another. Does it make a stable, explainable choice instead of following the latest fact it saw?",
      },
      reportWriter: {
        label: "Report writing: contradicting sources",
        description: "Conflicting material, unstated conventions, strict length and citations",
        prompt:
          "Write cases for the report-writing agent: the sources contradict each other, key conventions such as currency and time zone are deliberately left incomplete, and the length cap and citation format are strict — does it name the gap and make a conservative assumption first?",
      },
      customerService: {
        label: "Support: a hidden policy condition",
        description:
          "Incomplete users, policy conditions buried in an appendix, an over-promise trap",
        prompt:
          "Write multi-turn cases for the customer-support agent: the user's description is vague and the key facts come out only when asked, the policy's exceptions sit in an appendix, and an emotional message invites a promise the agent cannot make — does it verify before answering and hold the policy line?",
      },
      codeReview: {
        label: "Code review: defects hidden in the contracts",
        description: "Unstated calling and concurrency assumptions, misleading comments and tests",
        prompt:
          "Write cases for the code-review agent: each a small multi-file repository whose defects hide in an unstated call order, a time-zone or encoding assumption and a concurrency precondition, with a stale comment or two and a test that passes without covering them — score recall, false positives and the verification steps.",
      },
    },
    aiCreateTail: (targetAgentId: string): string =>
      "Use the `benchmark-design` Skill: as the Builder, design and calibrate a Benchmark for the Test Agent below without changing that agent itself.\n\n" +
      `- test_agent_id: \`${targetAgentId}\`\n` +
      "- benchmark_id: keep the one named above if any; otherwise derive a short semantic id (letters, digits, `_` and `-` only)\n" +
      "- case count: about 3 — few and hard, each with at least one decision that separates following the motions from actually doing the work (the draft above wins when it names one)\n" +
      "- techniques: hidden preconditions, vague or incomplete input, sources that contradict each other, strict deliverables; no difficulty from piling on rows or rules\n" +
      "- desired_baseline_score: `<50` (the draft above wins when it names one)\n" +
      "- pilot_iteration_limit: `4` (the draft above wins when it names one)\n\n" +
      "A Benchmark sits beside agents, not under one: create `benchmarks/<benchmark_id>/` under the Project (never inside the tested agent's directory) with " +
      "`benchmark_config.toml` (title, description, runs = 1; it records no agent), " +
      "one `CASE-NNN-<slug>/` per case (`statement/README.md` is the statement, `rubric/README.md` the scoring rubric, 100 points per case, nothing from the rubric leaking into the statement) " +
      "and `scoreboard.yaml` (initially `evaluations: []`; every evaluation records the tested `agent_id`, its `version`, the paired `provider` / `model_id` and the `thinking_level`). " +
      "Every trial evaluation goes through `run_subagent`, and the subagent's prompt must say to use the `agent-evaluation` Skill — never score a run yourself and never bypass that Skill; " +
      "calibrate difficulty case by case, " +
      "freeze the final revision, append the Formal Baseline to scoreboard.yaml, and finish by reporting the Benchmark id, the baseline score and the per-case scores.",
    manualCreateTitle: "Create a Benchmark manually",
    manualCreateIntro:
      "Fill in the title, the statements and the rubrics; the directory layout the Skills expect is written under the Project's benchmarks/. A Benchmark sits beside agents, so it can then evaluate any of them.",
    idField: "Benchmark id",
    idHint:
      "The directory name is the identifier: letters, digits, _ and - only, e.g. report-writing-v1",
    idExists: "A Benchmark with this id already exists; pick another",
    titleField: "Title",
    descriptionField: "Description",
    descriptionHint: "One line on what capability is tested and what makes the cases hard",
    runsField: "Runs per case",
    runsHint:
      "An integer from 1 to 1000; optimization runs every case this many times and averages",
    runsInfo:
      "Repeated runs separate a stable capability gap from chance, at a cost that scales with the count. AI calibration always uses one run per case; this value is for the optimization that follows.",
    casesTitle: "Cases",
    casesInfo:
      "Every case has two halves: the statement goes to the Test Agent; the rubric is seen only by the evaluator and never enters the Test Agent's Workspace.",
    rubricInfo:
      "A discriminating rubric has observable items totalling 100 points, and puts most of the points on decisions or artifacts where doing it right and merely looking right diverge — never a high floor for format compliance.",
    caseHeading: (n: number): string => `Case ${n}`,
    caseSlugField: "Directory suffix",
    caseSlugHint: (id: string): string => `Directory ${id}: letters, digits, _ and - only`,
    caseTitleField: "Case title",
    caseStatementField: "Statement",
    caseStatementHint:
      "Markdown; state the objective, the given materials, the required artifact and its format — never hint at the solution or the scoring",
    caseRubricField: "Scoring rubric",
    caseRubricHint:
      'Markdown; one item per line with its points, totalling 100, e.g. "- 40 pts: …"',
    addCase: "Add case",
    removeCase: "Remove this case",
    createSubmit: "Create Benchmark",
    created: "Benchmark created",
    invalidId: "Letters, digits, _ and - only",
    invalidRuns: "Must be an integer from 1 to 1000",
    invalidScore: "Must be an integer from 1 to 100",
    useTitle: (title: string): string => `Use: ${title}`,
    testedAgent: "Tested agent",
    evaluateDescription:
      "AI puts the tested agent on this Benchmark for the full Case × runs matrix and appends the result to the scoreboard as one labelled evaluation.",
    evaluateTestedAgentHint:
      "Evaluated as its Agent State stands right now; the score is recorded under it, labelled with its version, model and thinking level",
    evaluatorAgent: "Evaluator agent",
    evaluatorAgentHint:
      "The one that spawns the evaluation subagents, scores against the rubric and writes the scoreboard; needs the agent-evaluation Skill",
    evaluatorMissingSkill:
      "This agent does not have the agent-evaluation Skill installed and will most likely not complete the evaluation — switch to the default agent, or install the agent-tuning plugin on it first.",
    evaluateSessionModel: "Model of the evaluation conversation",
    evaluateSessionModelHint:
      "The model that dispatches and totals the runs, the Project's default model unless changed; the tested agent uses the model it is configured with, which is not changed here",
    evaluateRunsHint:
      "How many times every case runs, averaged; defaults to the Benchmark's configured count",
    evaluateNoteField: "Note",
    evaluateNotePlaceholder:
      "e.g. This round checks what the last optimization actually changed; watch the two citation cases",
    evaluateTail: (p: { targetAgentId: string; benchmarkId: string; runs: number }): string =>
      "Use the `agent-evaluation` Skill to evaluate the Test Agent on this frozen Benchmark.\n\n" +
      `- test_agent_id: \`${p.targetAgentId}\`\n` +
      `- benchmark_id: \`${p.benchmarkId}\` (the Project's \`benchmarks/${p.benchmarkId}/\`, beside the agents)\n` +
      `- runs: \`${p.runs}\`\n\n` +
      "Evaluate the full Case × runs matrix through `run_subagent`, one self-spawned subagent per matrix cell (omit `agent_id`), and say in every subagent's prompt to use the `agent-evaluation` Skill — never score a run yourself and never bypass that Skill; " +
      "the evaluation runtime is the model and thinking level that tested agent is configured with right now. Require every returned result to agree on " +
      "`agent_id`, `provider`, `model_id` and `thinking_level`, and stop rather than merge two labels into one record. Average the runs per case and the cases " +
      "per evaluation as the scoreboard contract specifies, then append exactly ONE evaluation to `scoreboard.yaml`, labelled with `agent_id`, `version`, " +
      "`provider` / `model_id` and `thinking_level`. Change neither the tested agent nor the Benchmark. " +
      "Finish by reporting the total score, the per-case scores and the label the evaluation was recorded under.",
    optimizeDescription:
      "AI changes the Test Agent under a falsifiable hypothesis and re-evaluates; a new version is kept only when the score strictly improves.",
    optimizerAgent: "Optimizer agent",
    optimizerAgentHint:
      "The one that reads the scores and Traces and edits the Test Agent; needs the agent-optimization Skill",
    optimizerMissingSkill:
      "This agent does not have the agent-optimization Skill installed and will most likely not complete the optimization — switch to the default agent, or install the agent-tuning plugin on it first.",
    testedAgentHint:
      "The agent whose Agent State is edited; its scores are recorded under it and compared only against its own same-label history",
    sessionModel: "Model of the optimizer's conversation",
    sessionModelHint:
      "The model that analyzes and edits, the Project's default model unless changed; evaluations of the Test Agent keep the model the baseline recorded, which is not changed here",
    optimizeRunsHint: "How many times every case runs per candidate version, averaged",
    roundLimitField: "Round limit",
    roundLimitHint: "One change per round; a round counts once its evaluation is complete",
    targetScoreField: "Target score",
    targetScoreHint: "Reaching it ends the loop early; defaults to ten points above the baseline",
    focusField: "Focus",
    focusPlaceholder:
      "e.g. Focus on citation rules and format compliance; leave the writing style alone",
    noBaseline:
      "The selected tested agent has no baseline score in this Benchmark yet. Optimization needs one complete baseline evaluation to compare against — take it on the Evaluate tab first.",
    baselineLine: (score: string, target: number): string =>
      `Current baseline ${score} · target ${target}`,
    optimizeTail: (p: {
      targetAgentId: string;
      benchmarkId: string;
      runs: number;
      roundLimit: number;
      targetScore: number;
    }): string =>
      "Use the `agent-optimization` Skill to improve the Test Agent against its frozen Benchmark.\n\n" +
      `- test_agent_id: \`${p.targetAgentId}\`\n` +
      `- benchmark_id: \`${p.benchmarkId}\` (the Project's \`benchmarks/${p.benchmarkId}/\`, beside the agents)\n` +
      `- runs: \`${p.runs}\`\n` +
      `- desired_score: \`>=${p.targetScore}\`\n` +
      `- candidate_round_limit: \`${p.roundLimit}\`\n\n` +
      "Each round, state one falsifiable hypothesis from the current Reference and make one bounded change; evaluate the full Case × runs matrix through `run_subagent`, saying in every subagent's prompt to use the `agent-evaluation` Skill — never score a run yourself and never bypass that Skill; " +
      "keeping the provider / model_id / thinking_level that tested agent's baseline recorded; keep the version and append an evaluation carrying `agent_id`, `version`, `provider` / `model_id` and `thinking_level` " +
      "to scoreboard.yaml only when the total score is strictly higher than the Reference, otherwise roll back. " +
      "Finish by reporting the scores before and after, the retained version, and each round's change and decision.",
  },

  /** Company mode: the organization switcher and dialogs, and the six organization pages. */
  company: {
    /** The mode switch (top-left of the sidebar, above the Project switcher) and its two options. */
    workMode: "Work mode",
    modeDev: "Development",
    modeCompany: "Company",
    switchToCompany: "Switch to company mode",
    switchToDev: "Switch to development mode",
    /**
     * Company mode is a beta, said in three shapes: the mini tag at the top-right of 「公司」 in
     * the work-mode switch (and the suffix the collapsed rail's tooltip carries in its place),
     * the tag's own tooltip, and the one sentence shown both under the admin's master switch
     * and as the notice a person gets the first time they enter the mode.
     */
    beta: "Beta",
    betaTitle: "Company mode is in beta and may be unstable.",
    betaNotice: "Beta: it may be unstable; please report what you hit.",
    /** The organization switcher that replaces the Project switcher in company mode. */
    switcher: "Organization",
    noOrganizations: "No organizations yet",
    createOrg: "New organization",
    orgSettings: "Organization settings",
    orgInvalid: "Invalid configuration",
    orgPaused: "Paused",
    /** The switcher's check mark beside the open organization (sr text). */
    switcherCurrent: "Current organization",
    /** `<project> / <org>` in the switcher: the Project half of the label. */
    inProject: (project: string, org: string): string => `${project} / ${org}`,
    /** The empty landing of `/org` when the user has no organization anywhere. */
    landingTitle: "Company mode",
    landingBody:
      "An organization is a group of employee Agents working along a reporting line: a CEO, the employees it hires, a shared board and its channels, and the calendar that drives them. Create one and start by talking to the CEO about its mission.",
    /** The page a stale deep link lands on: the organization it names is gone. */
    orgGoneTitle: "Organization not found",
    orgGoneBody:
      "It may have been deleted, or you may no longer have access to the Project it belongs to.",
    backToOrgs: "Back to organizations",
    /** Create dialog. */
    createTitle: "New organization",
    orgId: "Organization id",
    orgIdHint:
      "2–64 characters: a lowercase letter, then lowercase letters, digits or underscores; also the directory name, fixed once created",
    /**
     * The id field's generate button — its label says who proposes the id, its tooltip says
     * what the proposal is derived from — and the clause the hint appends for it. The clause
     * carries its own leading separator: what joins two clauses is punctuation, and
     * punctuation belongs to the language.
     */
    generateIdLabel: "Generate with AI",
    generateId: "Generate an id from the name",
    idGenerateHint: "; you can also generate one from the display name",
    /** What the field says about the id a proposal just filled in (see id-suggest-notice.ts). */
    idSuggest: {
      /** Under an id transliterated from the name: quiet, because nothing went wrong. */
      fromName: "Transliterated from the name",
      /** Under a placeholder id: it names nothing, so it says why and asks for a real name. */
      placeholder: (reason: string): string =>
        `The model gave no usable id (${reason}); a placeholder was filled in — please change it to something meaningful`,
      /** Why the proposal fell through, keyed by the server's reason code. */
      reasons: {
        no_default_model: "no default model configured",
        model_failed: "the model request failed",
        unusable_answer: "the model's answer was unusable",
        no_ascii: "the name carries no ASCII to transliterate",
      },
      /** A reason a newer server named and this build does not know. */
      reasonUnknown: "reason unknown",
    },
    displayName: "Display name",
    displayNameHint: "Leave empty to use the organization id",
    mission: "Mission",
    missionHint:
      "One sentence on why this organization exists; the CEO's first session starts from it",
    missionPlaceholder:
      "e.g. Maintain the PenguinHarness docs site and publish a weekly update digest",
    /** The three examples under the mission field (org-examples.ts holds their order). */
    missionExampleHint: "Click to fill the mission",
    missionExamples: {
      research: {
        name: "Research Paper Lab",
        mission:
          "Set up a company that does research for me: keeps drafting and reviewing papers and produces work that can be submitted to top-tier conferences.",
      },
      agentTuning: {
        name: "Agent Tuning Studio",
        mission:
          "Set up a company that optimizes my product Agent: raise its accuracy in real business use and improve the product experience.",
      },
      cloudReseller: {
        name: "Cloud Service Reseller",
        mission:
          "Set up a company that runs a cloud-service-style website for me: collect every low-priced service on the market, bundle and resell them at a markup to make money, and grow the site's SEO and visibility.",
      },
      mirror: {
        name: "Digital-twin company",
        mission:
          "Set up a company that mirrors our real company: I will give the CEO our real org chart and the CEO creates one digital twin per real employee; each twin's desk session is bound to that colleague's Feishu bot. A twin only receives its own colleague's messages by default, answers what it can on its own and relays the rest to the relevant colleague's twin, who passes it on to the real person. The CEO hires nobody on its own, schedules nothing and files no tickets; the company only relays and solves what it can.",
      },
    },
    createdOpeningCeo: "Organization created — opening the CEO's desk session",
    /** Create and settings dialogs: the model and the shared workspace, both optional. */
    modelField: "Model",
    modelInfo:
      "The model desk and ticket sessions run on by default; an employee given its own model in the org chart uses that instead. Takes effect from the next work round.",
    modelHint: "Leave empty to use the Project's default model",
    modelClear: "Back to the Project default",
    modelStale: "This model is no longer in the Project's model list",
    modelProjectDefault: "Project default",
    modelProjectDefaultNamed: (name: string): string => `Project default (${name})`,
    modelsLoadFailed:
      "The model list could not be read; you can still create with the Project default",
    workspaceField: "Company workspace",
    workspaceInfo:
      "The directory the employees work in together: each employee's workspace is one of its sub-directories (or all of it), and desk and ticket sessions run inside it.",
    workspaceHint:
      "Leave empty for the organization's own workspace/ directory; a path must be an existing directory on the server",
    workspaceEmpty: "The organization's own workspace/ directory",
    workspaceMenuHint: "Pick an existing directory as the company workspace",
    workspaceClear: "Back to the organization's own directory",
    /** CEO budget field (create dialog): the CEO's ceiling is the company's, since everyone reports to it. */
    ceoBudget: "CEO budget",
    ceoBudgetHint: "A monthly cap; the CEO's budget is the whole company's",
    /** The create dialog's draft (org-draft.ts): restored on reopen, dropped on create or on demand. */
    draftRestored: "Restored the draft you had not submitted",
    clearDraft: "Clear draft",
    creating: "Creating…",
    /** Settings dialog (the switcher's entry). */
    settingsTitle: "Organization settings",
    timezone: "Timezone",
    timezoneHint:
      "An IANA timezone such as Asia/Shanghai; budget periods (calendar months) and channel day files follow it",
    language: "Working language",
    languageInfo:
      "The language the organization works in: its handbook, the employee briefs, the CEO's initialization session and every desk's output are written in it; it is detected from the mission when the organization is created.",
    languages: {
      zh: "中文",
      en: "English",
    },
    approvalMode: "Approval mode",
    approvalModeInfo:
      "How tool calls in desk and ticket sessions are approved. Unattended runs never stop to ask a person, so there is no always-ask here.",
    approvalModes: {
      "allow-all": "Allow all",
      "read-only": "Read only",
      "deny-all": "Deny all",
    } as Record<string, string>,
    status: "Status",
    statusActive: "Active",
    statusPaused: "Paused",
    pause: "Pause organization",
    resume: "Resume organization",
    pauseInfo:
      "Paused stops every automatic trigger — calendar events no longer fire and @-mentions are not delivered to employees; you can still open any desk session and talk directly. An organization is paused, never deleted: its conversations, employees and tickets stay reachable.",
    settingsLoadFailed: "The organization's settings could not be read",
    /** Employee state dot, and the CEO mark. */
    employeeStates: {
      running: "Running",
      idle: "On desk",
      paused: "Budget paused",
    } as Record<string, string>,
    ceo: "CEO",
    reportsTo: (name: string): string => `Reports to ${name}`,
    openDesk: "Open desk session",
    openingDesk: "Opening the desk session…",
    /** Principals as the chat and tickets name them. */
    principalSystem: "System",
    principalAll: "Everyone",
    /** Spend against a budget, and the unbounded case. */
    spendOfBudget: (spend: string, budget: string): string => `${spend} / ${budget}`,
    noBudget: "Unbounded",
    budgetUnit: (symbol: string): string => `${symbol} / month`,
    budgetStoredAs: (amount: string): string => `Stored as ${amount} / month`,
    /** The 工位 group under the company sidebar's channel list: one row per employee. */
    sessionList: {
      desks: (n: number): string => `Desks (${n})`,
      deskOf: (name: string): string => `${name}'s desk`,
      running: "Running",
      noEmployees: "This organization has no employees yet",
      untitledSession: "Untitled session",
      loadFailed: "The employee list could not be loaded",
    },
    overview: {
      title: "Overview",
      info: "The organization on one page: employees, the board, today's calendar and this period's budget, plus what needs your decision. A corner button on each block opens its page.",
      employees: "Employees",
      onDesk: "On desk",
      running: "Running",
      paused: "Budget paused",
      board: "Board",
      blocked: "Blocked",
      today: "Today's calendar",
      todayEmpty: "Nothing scheduled today",
      spend: "This period's spend",
      reviewTickets: "Tickets in review",
      alerts: "Alerts",
      alertsEmpty: "No budget alerts this period",
      /** A fresh organization: point the user at the CEO. */
      firstStep:
        "The organization is brand new: open the CEO's desk session to confirm the mission, hire employees and set up the calendar.",
      /** The hero: who made it, how big it is, which period the spend counts. */
      createdBy: (user: string): string => `Created by ${user}`,
      employeesCount: (n: number): string => `${n} employee${n === 1 ? "" : "s"}`,
      period: (period: string): string => `Period ${period}`,
      openCeoDesk: "Open the CEO's desk",
      refreshFailed: "The refresh failed; this is the last data read",
      /** The hero's mission, clamped to one line until the toggle opens it. */
      mission: "Mission",
      expand: "Expand",
      collapse: "Collapse",
      /** The KPI strip. */
      openTickets: "Open tickets",
      boardTotal: (n: number): string => `${n} in total`,
      todayCount: (n: number): string => `${n} event${n === 1 ? "" : "s"}`,
      upcoming: "Upcoming",
      failed: "Not on time",
      budgetLeft: (amount: string): string => `${amount} left`,
      overBudget: (amount: string): string => `${amount} over`,
      /** The corner button of a KPI cell and of the hero's spend block: where it jumps to. */
      openChart: "Open the org chart",
      openBoard: "Open the ticket board",
      openCalendar: "Open the calendar",
      openFinance: "Open finance",
      /** The tooltip of an inbox row's title: the row is inert, its title is what goes there. */
      openTicket: "Open the ticket",
      openChannel: "Open the channel",
      /** The counts under the board bar: each opens the board filtered to the column it counts. */
      openColumn: (column: string): string => `Open the "${column}" tickets`,
      /** The three first steps of a new organization (replaces the empty sections). */
      firstStepsTitle: "First steps",
      firstStepsInfo:
        "The guide for a brand-new organization: talk to the CEO about the mission, hire, schedule. Once the first employee is hired or the first ticket filed, the dashboard takes its place.",
      stepCeoTitle: "Talk to the CEO",
      stepCeoBody:
        "Open the CEO's desk session, confirm the mission and let it propose the structure and the first tickets.",
      stepHireTitle: "Hire employees",
      stepHireBody:
        "On the org chart, hire subordinates for the CEO: an existing Agent or a new one, with a title and a budget.",
      stepScheduleTitle: "Schedule the work",
      stepScheduleBody:
        "On the calendar, give employees their rounds: when one is due, its prompt goes to the employee's desk session.",
      stepDone: "Done",
      goToChart: "Open the org chart",
      goToCalendar: "Open the calendar",
      /** The inbox: what names the reader, what is stuck and what has landed, newest first. */
      inbox: "Inbox",
      inboxInfo:
        "The three things the organization has to tell you, newest first: messages naming you (or everyone) in the all-hands channel, blocked tickets, and the tickets closed as done this period. For anything else, read the channel and the board themselves.",
      inboxEmpty: "Nothing in the inbox.",
      /** The filter chips over the rows, each with its own count. */
      inboxFilters: { all: "All", mention: "@me", blocked: "Blocked", done: "Done" },
      /** The chip that leads a row, naming what the row is. */
      inboxCategories: { mention: "@me", blocked: "Blocked", done: "Done" },
      /** Today's timeline. */
      timelineMore: (n: number): string => `${n} more — open the calendar`,
    },
    calendarOutcomes: {
      fired: "Fired",
      queued: "Queued",
      paused: "Paused",
      missed: "Missed",
      error: "Error",
    } as Record<string, string>,
    chart: {
      title: "Org Chart",
      info: "The employee tree is the reporting line: the CEO at the root, every node an employee Agent. The menu in a node's top-right corner opens its desk session and holds the personnel actions, each of which rewrites the chart file. The canvas zooms with the wheel and pans by dragging; click the percentage to fit the whole chart in the window again.",
      empty: "The chart is empty",
      nodeMenu: "Employee actions",
      hire: "Hire a subordinate",
      setBudget: "Set budget",
      changeReportsTo: "Change reporting line",
      renewDesk: "New desk session",
      leave: "Leave the organization",
      ceoCannotLeave: "The CEO cannot leave",
      invalidEntry: "This entry is invalid",
      workspaceTail: "Workspace",
      /** Hire dialog. */
      hireTitle: (manager: string): string => `Hire a subordinate for ${manager}`,
      hireSource: "Source",
      hireExisting: "Pick an existing Agent",
      hireNew: "Create a new Agent",
      agent: "Agent",
      pickAgent: "Pick an Agent…",
      noAgentsLeft: "No Agent in this Project is left to hire",
      agentId: "Agent id",
      agentIdHint:
        "2–64 characters: a lowercase letter, then lowercase letters, digits or underscores",
      agentName: "Name",
      agentNameHint: "Leave empty to use the Agent id",
      agentDescription: "Description",
      plugins: "Plugins",
      pluginsHint:
        "agent-company (the organization procedures) and agent-development (development skills) are installed by default",
      pluginsPlaceholder: "No plugins picked",
      pluginsPicked: (n: number): string => `${n} plugin${n === 1 ? "" : "s"} picked`,
      pluginsEmpty: "The plugin library has nothing to install",
      employeeTitle: "Title",
      employeeTitlePlaceholder: "e.g. Docs engineer",
      duties: "Duties",
      dutiesHint: "Written into the chart; the employee reads it at every work run",
      workspace: "Workspace",
      workspaceHint:
        "A sub-directory of the shared workspace (`.` for all of it), or an absolute path that already exists",
      /** Hiring: the same spec, with the default the server fills in when the field is left empty. */
      hireWorkspaceHint:
        "A sub-directory of the shared workspace, or an absolute path that already exists; left empty, a sub-directory named after the employee's Agent id",
      budget: "Monthly budget",
      budgetHint:
        "A monthly cap, leave empty for unbounded; counts the employee plus every subordinate",
      hireConfirm: (name: string, manager: string): string =>
        `Add ${name} to the organization, reporting to ${manager}? This rewrites the chart file.`,
      hired: (name: string): string => `Hired ${name}`,
      /** Budget / reporting line / desk renewal / leave dialogs. */
      budgetTitle: (name: string): string => `Set the budget of ${name}`,
      budgetConfirm: (name: string, budget: string): string =>
        `Set the monthly budget of ${name} to ${budget}? Past 80% warns; at 100% its automatic triggers pause.`,
      reportsToTitle: (name: string): string => `Change who ${name} reports to`,
      reportsToConfirm: (name: string, manager: string): string =>
        `Have ${name} report to ${manager}? Its subordinates move along with it.`,
      reportsToCycle: "Cannot report to itself or to one of its own subordinates",
      renewDeskTitle: (name: string): string => `A new desk session for ${name}`,
      renewDeskExplain:
        "A new desk session opens with a fresh context; a changed workspace is written to the org chart.",
      workspaceInvalid:
        "Invalid workspace: it must be a sub-directory of the shared workspace, or an absolute path that already exists.",
      renewed: "Moved to a new desk session",
      leaveConfirm: (name: string): string =>
        `Have ${name} leave? It is removed from the chart and its subordinates report to its manager instead; the Agent and every session are kept.`,
      left: (name: string): string => `${name} has left`,
      saved: "Chart updated",
      /** The page: the canvas and its zoom control, the legend, counts, a failed refresh, the detached row. */
      canvas: "Org chart canvas",
      zoom: "Zoom",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      zoomFit: "Fit to window",
      legend: "State legend",
      employeeCount: (n: number): string => `${n} employee${n === 1 ? "" : "s"}`,
      spend: "This period's spend",
      refreshFailed: (error: string): string => `Refresh failed: ${error}`,
      detached: "Manager not in the chart",
      detachedNotice: (n: number): string =>
        `${n} employee${n === 1 ? "" : "s"} cannot reach the CEO along the reporting line: the manager left the organization, or the line loops. Use "Change reporting line" to reattach them.`,
      /** Hire and edit dialogs: the two sections, the current value, and the field hints. */
      hireAgentSection: "Agent",
      hirePositionSection: "Position",
      agentHint: "Only Agents of this Project not yet in the organization",
      budgetPlaceholder: "e.g. 30",
      clearBudget: "Set unbounded",
      currentValue: (value: string): string => `Current: ${value}`,
      manager: "Manager",
      reportsToHint: "Only employees outside its own subtree are listed",
    },
    calendar: {
      title: "Calendar",
      info: "Every employee's calendar events in a month / week / day view. Each event belongs to one employee and sends its prompt to that employee's desk session when due; colours tell employees apart, and past instances show what the trigger did. Calendar events drive employees' desk sessions to check the board and push tickets on time; use New event, top right, to schedule one for an employee.",
      month: "Month",
      week: "Week",
      day: "Day",
      today: "Today",
      prev: "Previous",
      next: "Next",
      allEmployees: "All employees",
      filterEmployee: "Filter by employee",
      create: "New event",
      createTitle: "New calendar event",
      editTitle: (name: string): string => `Edit event "${name}"`,
      employee: "Employee",
      name: "Name",
      nameHint: "The file name (without .toml); fixed once created",
      prompt: "Prompt",
      enabled: "Enabled",
      startAt: "Start",
      endAt: "End",
      period: "Period",
      periodHint: "30m / 12h / 7d, empty for a one-off; 5m at the shortest",
      delete: "Delete event",
      deleteConfirm: (name: string): string => `Delete event "${name}"?`,
      saveConfirm: (name: string): string =>
        `Save event "${name}"? This rewrites its calendar file.`,
      outcome: "Outcome",
      lastFired: "Last fired",
      nextFire: "Next fire",
      past: "Past",
      pausedNote: "Paused: due slots are skipped, not fired",
      disabledNote: "Disabled",
      invalidFiles: "Calendar files that failed to parse",
      empty: "No events yet",
      emptyHint:
        "Calendar events drive employees' desk sessions to check the board and push tickets on time; use New event, top right, to schedule one for an employee.",
      moreEvents: (n: number): string => `${n} more`,
      /** The month cell's "+N more" is a button: its accessible name, and the day panel it opens. */
      moreEventsExpand: (n: number): string => `${n} more, expand`,
      openDay: "Open the day",
      weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as readonly string[],
      allDay: "All day",
      promptHint:
        "What the employee should sweep at this moment, e.g. check the board, push its tickets, report in a channel",
      monthTitle: (year: number, month: number): string =>
        `${
          [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ][month - 1] ?? month
        } ${year}`,
      /** How an event recurs, for the legend: the period read as a cadence with the time of day. */
      cadence: {
        once: "One-off",
        minutes: (n: number): string => `Every ${n} min`,
        hours: (n: number): string => `Every ${n} h`,
        daily: (time: string): string => `Daily ${time}`,
        days: (n: number, time: string): string => `Every ${n} days ${time}`,
        weekly: (time: string): string => `Weekly ${time}`,
        weeks: (n: number, time: string): string => `Every ${n} weeks ${time}`,
        invalid: "Invalid period",
      },
      legendEmpty: "No events yet",
      legendFilter: (name: string): string => `Show only ${name}'s events`,
      createAt: (label: string): string => `New event at ${label}`,
      loadFailed: (error: string): string => `Could not load the calendar: ${error}`,
      /** The "×" that puts the empty-calendar note away for good (the same sentence stays in the page's "?"). */
      dismissHint: "Got it",
      /** Under the start time: why two employees should not share one minute. */
      staggerHint:
        "Stagger the rota: give every employee its own minute; desks that fire together compete for the same budget and tickets.",
      /** Heads the advisory lines a calendar write answers with (the lines themselves come from the server, in English). */
      warningsPrefix: "Rota notice",
    },
    tickets: {
      title: "Tickets",
      info: "Five columns are a ticket's life: proposed → in progress → review → done / rejected. Drag a card to move it between columns, click a card's title to open its detail in place; a blocked ticket stays in its column with a badge. A ticket is the organization's unit of work: use New ticket, top right, to create one and name an owner, and the owner's desk session starts a ticket session for it.",
      columns: {
        proposed: "Proposed",
        in_progress: "In progress",
        review: "Review",
        done: "Done",
        rejected: "Rejected",
      } as Record<string, string>,
      blockedOnly: "Blocked only",
      create: "New ticket",
      createTitle: "New ticket",
      empty: "No tickets yet",
      emptyHint:
        "A ticket is the organization's unit of work: use New ticket, top right, to create one and name an owner, and the owner's desk session starts a ticket session for it.",
      /** The "×" that puts the empty-board note away for good (the same sentence stays in the page's "?"). */
      dismissHint: "Got it",
      columnEmpty: "Empty",
      ticketTitle: "Title",
      goal: "Goal",
      goalHint: "What to achieve, in a paragraph",
      acceptance: "Acceptance criteria",
      acceptanceHint: "What counts as done; checked one by one at review",
      result: "Result",
      owner: "Owner",
      noOwner: "Unassigned",
      ownerSelf: "Yourself",
      ownerSelfHint: "Left empty, the owner is you",
      parent: "Parent ticket",
      noParent: "None",
      notify: "Notify",
      notifyHint:
        "Comma-separated principals, e.g. agent:ceo, user:alice; notified on status changes",
      priority: "Priority",
      due: "Due",
      noDue: "None",
      blocked: "Blocked",
      blockedReason: "Blocked reason",
      blockedBy: "Waiting on",
      blockedTooltip: (reason: string, by: string): string =>
        `Blocked: ${reason} (waiting on ${by})`,
      unblock: "Unblock",
      unblockConfirm: (title: string): string => `Unblock "${title}"?`,
      block: "Mark blocked",
      blockTitle: "Mark blocked",
      blockReasonHint: "One line on what it is stuck on",
      blockByHint: "The ticket or principal it waits on",
      sessions: "Ticket sessions",
      sessionsCount: (n: number): string => `${n} session${n === 1 ? "" : "s"}`,
      openSession: "Open session",
      openTicket: "Open ticket",
      progress: "Progress",
      progressEmpty: "No progress recorded yet",
      addProgress: "Add progress",
      progressPlaceholder: "One line on what moved…",
      children: "Child tickets",
      childrenEmpty: "No child tickets",
      cost: "This ticket's cost",
      rolledUpCost: "Total cost",
      parentLine: (title: string): string => `Parent ticket: ${title}`,
      moveTitle: "Move ticket",
      moveConfirm: (title: string, column: string): string => `Move "${title}" to "${column}"?`,
      rejectReason: "Rejection reason",
      rejectReasonHint: "One line on why, recorded under the ticket's result",
      moved: "Ticket moved",
      invalid:
        "This ticket is invalid: its status disagrees with its column, or its id is duplicated",
      invalidFiles: "Ticket files that failed to parse",
      edit: "Edit fields",
      saveConfirm: (title: string): string =>
        `Save the changes to "${title}"? This rewrites the ticket file.`,
      saved: "Ticket saved",
      created: "Ticket created",
      detail: "Ticket detail",
      back: "Back",
      dragHint: "Drag to another column to move it",
      searchPlaceholder: "Search title or id",
      searchNoMatch: "No matching tickets",
      dropHere: "Drop here",
      overdue: "Overdue",
      summary: "Details",
      history: "History",
      historyEmpty: "No history yet",
      historyActions: {
        created: "created",
        assigned: "assigned to",
        moved: "moved to",
        blocked: "blocked",
        unblocked: "unblocked",
        progress: "noted progress",
        session_started: "started a session",
        session_attached: "attached a session",
        edited: "edited",
      } as Record<string, string>,
      slug: "Id slug",
      slugHint:
        "Lowercase English words joined by hyphens, e.g. marketplace-site; no digits, derived from the title when left empty",
      slugInvalid: "Lowercase English words joined by hyphens only, no digits",
      noGoal: "No goal yet",
      noAcceptance: "No acceptance criteria yet",
      noResult: "No result yet",
      moveTo: "Move to…",
      move: "Move",
      copyId: "Copy ticket id",
      invalidTickets: "Invalid tickets",
      loadFailed: (error: string): string => `Could not load the board: ${error}`,
    },
    finance: {
      title: "Finance",
      info: "Budgets are set per employee and count the employee plus every subordinate; a period is a calendar month in the organization's timezone. Reaching 80% warns, reaching 100% pauses that employee's automatic triggers.",
      period: "Period",
      thisPeriod: "This period",
      prevPeriod: "Previous period",
      total: "Total",
      unpriced: "* Some usage ran on a model without pricing; the cost is a lower bound",
      budget: "Budget",
      editBudget: "Edit budget",
      budgetPlaceholder: "Unbounded",
      clearBudget: "Clear",
      budgetSaved: "Budget updated",
      own: "Own spend",
      cumulative: "Cumulative",
      /** The spend tree reads cumulative against budget in one column; own spend rides in the row tooltip. */
      cumulativeBudget: "Cumulative spend / budget",
      ratio: "Ratio",
      warned: "Warned",
      paused: "Paused",
      spendTree: "Spend tree",
      spendTreeInfo:
        "Expanded along the reporting line: cumulative spend includes every subordinate, and budget and ratio use the same measure.",
      ticketsTable: "Ticket spend",
      ticketsInfo:
        "Each ticket's contributing-session cost; the total cost adds up along parent tickets. A session attached to several tickets is shared between them.",
      ticketsEmpty: "No ticket spend this period",
      rolledUp: "Total cost",
      /** The ledger's fold: child tickets are hidden until the parent's chevron opens them. */
      expandChildren: "Show child tickets",
      collapseChildren: "Hide child tickets",
      childCount: (n: number): string => `${n} child ticket${n === 1 ? "" : "s"}`,
      trend: "Trend",
      alerts: "Alerts and pauses",
      alertsEmpty: "No alerts this period",
      alertWarned: (name: string, at: string): string =>
        `${name} reached 80% of its budget at ${at}`,
      alertPaused: (name: string, at: string): string =>
        `${name} reached its budget at ${at}; automatic triggers paused`,
      alertsHint:
        "To lift a pause, raise the employee's budget or clear it; the next check resumes it automatically.",
      /** The KPI row under the title. */
      kpiTotal: "Total spend",
      orgBudget: "Organization budget (CEO)",
      kpiEmployees: "Employees",
      budgetsSet: (n: number): string => `${n} with a budget`,
      thresholds: "80% warns, 100% pauses",
      kpiAlerts: "Alerts",
      alertsSummary: (warned: number, paused: number): string =>
        `${warned} warned · ${paused} paused`,
      /** Column header explanations, and the tree's root mark. */
      cumulativeInfo:
        "The employee's own spend plus every subordinate's; budget and ratio use this measure.",
      rolledUpInfo: "This ticket plus its children.",
      root: "Root",
      /** The inline budget editor. */
      budgetEmptyHint: "Leave empty for unbounded",
      saveBudget: "Save budget",
      cancelEdit: "Cancel",
      editBudgetOf: (name: string): string => `Edit the budget of ${name}`,
      /** The ticket table's owner column and row action. */
      openTicket: "Open ticket",
      /** The trend section. */
      trendInfo:
        "The daily cost of every session in the organization, by the organization's timezone; only days with spend are drawn.",
      trendEmpty: "No spend recorded this period yet",
      /** The alert list. */
      alertsInfo:
        "Every check compares cumulative spend with the budget: reaching 80% records a warning, reaching 100% pauses the employee's and its subordinates' automatic triggers; lifting the pause resumes them.",
      pausedGroup: "Automatic triggers paused",
      warnedGroup: "Warned",
      warnedAt: (at: string): string => `reached 80% at ${at}`,
      pausedAt: (at: string): string => `reached 100% at ${at}`,
      /** A refetch failed while the last good data is still on screen. */
      refreshFailed: "Refresh failed; showing the last loaded data",
    },
    channels: {
      listTitle: "Channels",
      drawerLabel: "Channel list",
      allHands: "All hands",
      mine: "My channels",
      others: "Other channels",
      archivedGroup: "Archived",
      newChannel: "New channel",
      noChannels: "No channels yet",
      loadFailed: "Could not load the channels",
      join: "Join",
      joining: "Joining…",
      joined: "Joined the channel",
      joinTitle: "Join channel",
      joinConfirm:
        "Once you join, messages in this channel that @ you reach you, and you can post here.",
      mentionChip: "@me",
      badgeUnread: (n: number): string => `${n} unread`,
      badgeMentions: (n: number): string => `${n} mentioning me`,
      streamLabel: (name: string): string => `Messages in ${name}`,
      purpose: "Purpose",
      purposeEmpty: "No purpose written yet",
      memberCount: (n: number): string => `${n} member${n === 1 ? "" : "s"}`,
      memberList: "Channel members",
      invite: "Invite",
      inviteTitle: "Invite to the channel",
      inviteSearch: "Search employees and members",
      inviteEmpty: "Nobody left to invite",
      invited: (name: string): string => `Invited ${name}`,
      leave: "Leave",
      leaveTitle: "Leave the channel",
      leaveConfirm: (name: string): string =>
        `Leave "${name}"? You can still read it, but no @ will reach you and you cannot post until you join again.`,
      left: "Left the channel",
      channelMenu: "Channel actions",
      rename: "Rename",
      renameTitle: "Rename the channel",
      editPurpose: "Edit purpose",
      purposeTitle: "Edit the channel's purpose",
      archive: "Archive",
      unarchive: "Unarchive",
      archiveTitle: "Archive the channel",
      archiveConfirm: (name: string): string =>
        `Archive "${name}"? It becomes read-only and folds away under Archived; you can unarchive it at any time.`,
      archived: "Channel archived",
      unarchived: "Channel unarchived",
      archivedNotice: "This channel is archived and read-only. Unarchive it to post again.",
      notMemberNotice: "You are not in this channel yet. Join it to post.",
      channelLoadFailed: "Could not load the channel",
      allHandsInfo:
        "The all-hands channel is created with the organization: everyone in the organization is here — every employee, every Project member, and you, reading along — nobody can leave it and it cannot be archived. System notices — budget alerts and the like — are posted here.",
      channelInfo:
        "An invitation-only channel: an employee joins only when a member invites it, and an @ delivers within the channel's membership. People may join any channel themselves, and can read every channel.",
      allHandsNoArchive: "The all-hands channel cannot be archived",
      createTitle: "New channel",
      creating: "Creating…",
      created: "Channel created",
      idField: "Channel id",
      idHint: "2–64 characters: a lowercase letter, then lowercase letters, digits or underscores",
      idReserved: "default_channel belongs to the all-hands channel",
      idTaken: "That id is already taken",
      nameField: "Display name",
      nameHint: "Defaults to the id",
      purposeHint: "One line on what this channel is for",
      empty: "No messages yet",
      emptyHint:
        "Only an @ reaches an employee: @employee delivers to its desk session, @all to every member of the channel; a message without one is just a note.",
      placeholder: "Type a message — Enter sends, Shift+Enter breaks the line, @ mentions a member",
      send: "Send",
      you: "You",
      mentionAll: "Everyone",
      mentionAllDesc: "Every member of the channel",
      employees: "Employees",
      members: "Members",
      earlierDays: "Earlier days",
      ticketRef: (id: string): string => `Ticket ${id}`,
      sessionRef: "View session",
      replyTo: "Reply to",
      /** The ref chips' tooltips: what the chip's own text does not say — where it lands. */
      openTicketRef: "Open the ticket",
      replyToJump: "Jump to the message this replies to",
      hop: (n: number): string => `Relay · hop ${n}`,
      hopInfo:
        "Sent automatically by an employee's work run, N relays down an @-chain: a message from a person or the calendar is hop 0, an employee's reply from the run it triggered is hop 1 (unmarked), the reply of the next employee it @-mentioned is hop 2 … At the organization's chain limit (3 by default) an @ is recorded but triggers nobody, so two employees cannot @ each other all night.",
      hopSummary:
        'A mentioned employee may @ somebody else in its reply, which is an @-chain: from hop 2 a message is marked "Relay · hop N", and at the organization\'s chain limit (3 by default) an @ is recorded but triggers nobody.',
      today: "Today",
      yesterday: "Yesterday",
      noEarlier: "No earlier messages",
      unreadDivider: "Unread",
      newMessages: (n: number): string => `${n} new message${n === 1 ? "" : "s"}`,
      mentionPanel: "Mention",
      mentionsYou: "Mentions you",
      systemMessage: "System message",
      sentAt: (time: string): string => `Sent at ${time}`,
      notices: {
        employee_joined: (agent: string, title: string, manager: string): string =>
          `${agent} joined as ${title}, reporting to ${manager}.`,
        employee_left: (agent: string, manager: string): string =>
          `${agent} left the organization; reports now go to ${manager}.`,
        channel_created: (by: string): string => `${by} created the channel.`,
        channel_archived: (by: string): string => `${by} archived the channel.`,
        channel_unarchived: (by: string): string => `${by} unarchived the channel.`,
        channel_joined: (principal: string): string => `${principal} joined the channel.`,
        channel_invited: (by: string, principal: string): string =>
          `${by} invited ${principal} to the channel.`,
        channel_left: (principal: string): string => `${principal} left the channel.`,
        channel_removed: (by: string, principal: string): string =>
          `${by} removed ${principal} from the channel.`,
        budget_warned: (
          agent: string,
          percent: string,
          period: string,
          cost: string,
          budget: string,
        ): string =>
          `Budget warning: ${agent} has used ${percent}% of its ${period} budget (${cost} / ${budget} USD).`,
        budget_paused: (
          agent: string,
          percent: string,
          period: string,
          cost: string,
          budget: string,
        ): string =>
          `Budget pause: ${agent} reached ${percent}% of its ${period} budget (${cost} / ${budget} USD). Its calendar and its subordinates' are paused until the next month or a raised budget; mentions and direct conversations still work.`,
        ticket_blocked: (ticket: string, title: string): string =>
          `Ticket ${ticket} (${title}) is blocked.`,
        ticket_done: (ticket: string, title: string): string =>
          `Ticket ${ticket} (${title}) is done.`,
        ticket_rejected: (ticket: string, title: string): string =>
          `Ticket ${ticket} (${title}) was rejected.`,
      },
    },
    /** The handbook page: the knowledge base directory, its index and its documents. */
    handbook: {
      info: "The company's knowledge base: the Markdown documents under handbook/. The index (README.md) is the page every trigger makes the employee Agent read first; the other documents are listed from it and read on demand.",
      /** The pinned first row: the index, and why it is pinned. */
      indexLabel: "Index · read first every run",
      documents: "Documents",
      /** The tree's own controls: closing every folder, and what a folder row's count means. */
      collapseAll: "Collapse all",
      documentsInFolder: (n: number): string => `${n} document${n === 1 ? "" : "s"}`,
      noOtherDocuments: "No other documents yet. Create one and list it in the index.",
      emptyDocument: "This document is still empty.",
      newDocument: "New document",
      creating: "Creating…",
      pathField: "Path",
      pathPlaceholder: "decisions/2026-09-02-hire-plan.md",
      pathHint:
        "Relative to handbook/, folders separated by /; each segment starts with a letter or digit and uses only letters, digits, . _ -; .md is added when the extension is left out.",
      pathInvalid:
        "Invalid path: each segment starts with a letter or digit and uses only letters, digits, . _ -, folders separated by /, at most eight levels.",
      pathExists: "That document already exists.",
      documentCreated: "Document created",
      deleteDocument: "Delete document",
      deleteConfirm: (path: string): string =>
        `Delete ${path}? The document is removed from handbook/; the index entry pointing at it is not updated automatically.`,
      documentDeleted: "Document deleted",
      loadFailed: "Could not load the handbook",
      documentLoadFailed: "Could not load the document",
      /** A row's tooltip: when the file was last written, and its size. */
      updatedAt: (time: string, size: string): string => `Updated ${time} · ${size}`,
      /** Beside the editor's buttons: what the text is, and the shortcut. */
      editorHint: "Markdown · Ctrl/⌘+S to save",
    },
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
      unknown_skill: "This skill is not in the selected directory.",
      unknown_plugin: "This plugin is not in the plugin library.",
      goal_plugin_not_installed:
        "Goal mode needs the goal plugin — install it on this agent from the plugin library, and switch its hook package on.",
      skill_too_large: "This skill directory exceeds the import limits.",
      hook_too_large: "This hook package exceeds the import limits.",
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
      reveal_failed: "Could not open the folder.",
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
      company_mode_off: "Company mode is turned off on this server.",
      org_not_found: "This organization no longer exists.",
      org_exists: "That organization id is already taken.",
      org_invalid:
        "This organization's configuration needs repair; it accepts no changes until then.",
      invalid_org_id:
        "Invalid organization id: 2–64 characters, a lowercase letter first, then lowercase letters, digits or underscores.",
      employee_not_found: "That Agent is not an employee of this organization.",
      employee_exists: "That Agent is already an employee of this organization.",
      calendar_event_exists: "A calendar event with that name already exists.",
      calendar_event_not_found: "That calendar event no longer exists.",
      desk_unavailable: "The desk session could not be opened.",
      ticket_not_found: "That ticket no longer exists.",
      ticket_invalid: "This ticket file needs repair; it accepts no changes until then.",
      ticket_session_failed: "The ticket session could not be started.",
      handbook_file_not_found: "That document no longer exists.",
      handbook_index_required: "The handbook index (README.md) cannot be deleted.",
    },
  },
};
