import type { OrgChannelNoticeKind } from "@prismshadow/penguin-server/api";

/**
 * CLI text internationalization (i18n).
 *
 * Language comes from the `PENGUIN_LANG` env var (`en`), defaulting to English (en) —
 * independent of Project config or CLI options. This module centralizes all user-visible text:
 * command/option help descriptions and runtime output, one implementation per language.
 */

/** UI language. */
export type Language = string;

/** Installer locations are localized at the message boundary, not embedded in update logic. */
export type InstallerSource = "configured" | "oss" | "github";

/** Readiness probe failure classes; selects which hint `webProbeFailed` appends. */
export type WebProbeFailureKind =
  "timeout" | "refused" | "reset" | "permission" | "dns" | "unknown";

/** Unsupported language preferences fall back to the shipped English catalog. */
export function resolveLanguage(): Language {
  const candidate = (process.env.PENGUIN_LANG ?? "en").trim().toLowerCase();
  return Object.hasOwn(DICTIONARIES, candidate) ? candidate : "en";
}

export interface Messages {
  // —— Command/option help descriptions ——
  cliDescription: string;
  versionDesc: string;
  common: {
    projectId: string;
    agentId: string;
    modelId: string;
    /** run/chat's --provider: must be given together with --model-id (the group is never inferred). */
    provider: string;
    /** Data root directory option (priority: --root > PENGUIN_HOME > ~/.penguin/data). */
    root: string;
    workspace: string;
    approve: string;
    /** run/chat's --thinking: the session's thinking level (selectable tiers only, mirrors the web picker). */
    thinking: string;
    /** Machine-readable output (raw JSON instead of the rendered/tabular form). */
    json: string;
    /** --server: explicit server URL (overrides PENGUIN_API_URL, the local lock and auto-start). */
    server: string;
    /** --timeout: soft-yield wait budget on run/input/logs -f (30s / 5m / 2h / bare seconds). */
    timeout: string;
    /** input/logs' --agent-id: whose most recent session the omitted session argument means. */
    latestAgentId: string;
  };
  /** Commander's own parse failures, rebuilt in the user's language (see usage-error.ts). */
  usage: {
    /** A required positional argument was not given. */
    missingArgument(name: string): string;
    /** A required option (commander's requiredOption) was not given. */
    missingOption(flags: string): string;
    /** An option that takes a value was given none. */
    optionMissingArgument(flags: string): string;
    unknownOption(flag: string): string;
    unknownCommand(name: string): string;
    /** Everything else commander rejects: its own detail rides verbatim, so nothing is swallowed. */
    other(detail: string): string;
    /** Second line of a usage error: how the command is spelled, and where its full option list is. */
    hint(command: string, usage: string): string;
  };
  config: {
    desc: string;
    modelDesc: string;
    addDesc: string;
    addModelId: string;
    addProvider: string;
    addApiKey: string;
    addBaseUrl: string;
    addContextWindow: string;
    addMaxTokens: string;
    addClientType: string;
    addVision: string;
    addNoVision: string;
    addFastMode: string;
    addNoFastMode: string;
    fastModeUnsupported: (ref: string) => string;
    addPriceCacheRead: string;
    addPriceCacheWrite: string;
    addPriceOutput: string;
    addSetDefault: string;
    defaultDesc: string;
    visionDesc: string;
    /** `model default` / `model vision` / `model remove`'s --model-id: the upstream request id (pairs with --provider as a reference). */
    refModelId: string;
    /** `model default` / `model vision` / `model remove`'s --provider: the provider group of the referenced entry (required). */
    refProvider: string;
    listDesc: string;
    removeDesc: string;
    langDesc: string;
    langArg: string;
    vaultDesc: string;
    vaultSetDesc: string;
    vaultListDesc: string;
    vaultRemoveDesc: string;
    vaultKey: string;
    vaultValue: string;
  };
  run: {
    desc: string;
    message: string;
    /** run's --goal: goal mode, with an optional token budget value (`--goal 500k`). */
    goal: string;
    /** run's --session: reuse an existing Session (full id or unique fragment). */
    session: string;
    /** run's --source: mark the NEW Session as created by a Benchmark evaluation. */
    source: string;
    /** run's --background: POST the task and exit immediately, printing the session id. */
    background: string;
    /** --session combined with --workspace / the model pair / --source: all fixed at creation. */
    sessionNoOverride(): string;
    /** --source given a value other than `benchmark` (the only origin a client may set). */
    sourceInvalid(value: string): string;
    /** --background never waits, so a wait budget cannot apply to it. */
    timeoutWithBackground(): string;
  };
  chat: {
    desc: string;
    resume: string;
    /** chat's --verbose: start with full tool output (collapsing off). */
    verbose: string;
  };
  /** `penguin ls`: session listing. */
  ls: {
    desc: string;
    /** -a/--all: include archived sessions. */
    all: string;
    /** --days: keep sessions last active within the trailing n calendar days (today = day 1). */
    days: string;
    daysInvalid(value: string): string;
    empty(projectId: string): string;
    colId(): string;
    colAgent(): string;
    colTitle(): string;
    colState(): string;
    colLast(): string;
    colWorkspace(): string;
    stateIdle(): string;
    stateRunning(): string;
  };
  /** `penguin input`: send a message into an existing session (steer when running, task when idle). */
  input: {
    desc: string;
    message: string;
    /** Poll form on a session that has produced no assistant text yet. */
    noReplyYet(): string;
  };
  /** `penguin logs`: render a session's history, optionally following the live stream. */
  logs: {
    desc: string;
    tail: string;
    follow: string;
    tailInvalid(value: string): string;
    /** --timeout without -f: there is no wait to bound. */
    timeoutNeedsFollow(): string;
  };
  /** `penguin agent`: agent listing and creation. */
  agent: {
    desc: string;
    lsDesc: string;
    createDesc: string;
    createId: string;
    createName: string;
    createDescription: string;
    /** --plugins: comma-separated library plugin names to seed the new agent with. */
    createPlugins: string;
    created(agentId: string, projectId: string): string;
    colId(): string;
    colName(): string;
    colSessions(): string;
    colDescription(): string;
  };
  /** `penguin project`: project listing. */
  project: {
    desc: string;
    lsDesc: string;
    colId(): string;
    colName(): string;
    colRole(): string;
  };
  /** `penguin cost`: token/cost aggregates. */
  cost: {
    desc: string;
    days: string;
    from: string;
    to: string;
    by: string;
    rangeIncomplete(): string;
    daysInvalid(value: string): string;
    byInvalid(value: string): string;
    today(): string;
    last7d(): string;
    total(): string;
    empty(): string;
    /** Cost cell when no model in the bucket has pricing configured. */
    noPricing(): string;
    colTokens(): string;
    colRequests(): string;
    colCost(): string;
    colGroup(dimension: string): string;
  };
  /** `penguin schedule`: scheduled-task listing and management (a validated writer over the schedules API; the TOML file stays the single source of truth). */
  schedule: {
    desc: string;
    lsDesc: string;
    addDesc: string;
    updateDesc: string;
    rmDesc: string;
    /** --prompt: the text the firing sends. */
    prompt: string;
    /** --start-at: first fire time, ISO 8601 — or the literal `now` for the current instant. */
    startAt: string;
    /** --period: fixed interval (30m / 12h / 1d / 7d, minimum 5m); omitted = one-shot. */
    period: string;
    /** --end-at: stop firing after this instant (ISO 8601). */
    endAt: string;
    /** --session-id: bind firings to one session (excludes the new-session form). */
    sessionId: string;
    /** --workspace: new-session mode's workspace (omitted = a temp workspace per firing). */
    workspace: string;
    /** add's --disabled: opt out of the CLI's enabled-by-default divergence. */
    disabledOpt: string;
    /** update's --enable / --disable pair. */
    enableOpt: string;
    disableOpt: string;
    enableDisableConflict(): string;
    /** --session-id given together with the new-session form: the target is one or the other. */
    targetConflict(): string;
    /** Confirmation after add/update; nextFireAt is absent for done/disabled/invalid tasks. */
    written(name: string, enabledText: string, nextFireAt: string | undefined): string;
    removed(name: string): string;
    enabled(): string;
    disabled(): string;
    /** Period column for a one-off task (no period configured). */
    oneShot(): string;
    /** Target column when the schedule creates a new session each firing. */
    newSession(): string;
    empty(projectId: string): string;
    colName(): string;
    colEnabled(): string;
    colStartAt(): string;
    colPeriod(): string;
    colTarget(): string;
    colLastFired(): string;
    colStatus(): string;
  };
  /** `penguin org`: company mode — a thin client over the organization API (the organization's files stay the single source of truth; every DTO is a projection). */
  org: {
    desc: string;
    lsDesc: string;
    createDesc: string;
    showDesc: string;
    chartDesc: string;
    hireDesc: string;
    employeeDesc: string;
    employeeSetDesc: string;
    leaveDesc: string;
    deskDesc: string;
    deskShowDesc: string;
    deskRenewDesc: string;
    calendarDesc: string;
    calendarLsDesc: string;
    calendarAddDesc: string;
    calendarUpdateDesc: string;
    calendarRmDesc: string;
    ticketDesc: string;
    ticketLsDesc: string;
    ticketShowDesc: string;
    ticketCreateDesc: string;
    ticketMoveDesc: string;
    ticketAssignDesc: string;
    ticketBlockDesc: string;
    ticketUnblockDesc: string;
    ticketProgressDesc: string;
    ticketStartDesc: string;
    ticketAttachDesc: string;
    channelDesc: string;
    channelLsDesc: string;
    channelCreateDesc: string;
    channelShowDesc: string;
    channelInviteDesc: string;
    channelJoinDesc: string;
    channelLeaveDesc: string;
    channelRemoveDesc: string;
    channelArchiveDesc: string;
    channelUnarchiveDesc: string;
    channelTailDesc: string;
    channelSendDesc: string;
    handbookDesc: string;
    handbookListDesc: string;
    handbookShowDesc: string;
    handbookWriteDesc: string;
    handbookRmDesc: string;
    financeDesc: string;
    /** --org-id: the organization (defaults to PENGUIN_ORG_ID, the control environment of desk and ticket sessions). */
    orgId: string;
    /** create's --org-id: the id to create (never taken from the environment). */
    newOrgId: string;
    mission: string;
    orgName: string;
    /** create's --language: the organization's working language (default: detected from the mission). */
    orgLanguageOption: string;
    /** hire's --agent-id: employ an existing Agent (XOR --new-agent). */
    hireAgentId: string;
    /** hire's --new-agent: create the Agent and employ it. */
    newAgent: string;
    newAgentName: string;
    newAgentDescription: string;
    /** --skills: extra library plugins for the new Agent, comma-separated (added to the required pair). */
    skills: string;
    title: string;
    reportsTo: string;
    /** Employee workspace: a sub-directory of the shared workspace (`.` = all of it) or an absolute path, written as given. */
    employeeWorkspace: string;
    /** hire's --workspace: the same spec, with the default the employee's own sub-directory. */
    hireWorkspace: string;
    /** --budget: monthly USD for the employee plus every subordinate. */
    budget: string;
    /** create's --ceo-budget: the CEO's monthly USD, which is the whole company's. */
    ceoBudget: string;
    duties: string;
    /** calendar's --agent-id: the employee the event belongs to (defaults to PENGUIN_AGENT_ID); a filter on `ls`. */
    calendarAgentId: string;
    calendarTitle: string;
    /** ticket ls filters. */
    statusFilter: string;
    ownerFilter: string;
    blockedFilter: string;
    ticketTitle: string;
    /** create's --slug: the words of the ticket id, for a title that yields none. */
    ticketSlug: string;
    goal: string;
    criteria: string;
    /** --body-file: the whole Markdown body from a file (XOR --goal). */
    bodyFile: string;
    /** --owner: the ONE responsible principal; defaults to the caller on `create`. */
    owner: string;
    parent: string;
    /** --notify: principals told when the ticket ends, comma-separated. */
    notify: string;
    priority: string;
    due: string;
    /** move's --to: the target column. */
    moveTo: string;
    /** move's --reason: required when moving into rejected. */
    moveReason: string;
    blockReason: string;
    /** block's --by: who or which ticket the ticket waits for. */
    blockedBy: string;
    progressText: string;
    /** start's -m: a note appended to the ticket text the session opens with. */
    startMessage: string;
    /** start's --workspace: another directory inside the shared workspace (default: the employee's desk workspace). */
    startWorkspace: string;
    /** start's --agent-id: which employee the ticket session runs as (default: the caller inside a session, else the ticket's owner). */
    startAgentId: string;
    /** attach's --session: the session to attach (default: the calling session). */
    attachSession: string;
    /** tail / send's --channel: which channel to read or write in (default: the all-hands channel). */
    channelOpt: string;
    /** create's --name / --purpose. */
    channelName: string;
    channelPurpose: string;
    channelDate: string;
    channelCount: string;
    channelText: string;
    handbookPath: string;
    handbookText: string;
    handbookFile: string;
    handbookOneSource: string;
    refTicket: string;
    refSession: string;
    /** finance's --period: yyyy-mm (default: the current month). */
    period: string;
    /** No --org-id and no PENGUIN_ORG_ID: there is no default organization. */
    orgIdMissing(): string;
    /** hire: --agent-id XOR --new-agent. */
    hireTargetConflict(): string;
    /** hire: --name / --description / --skills describe the new Agent only. */
    newAgentFieldsOnly(): string;
    /** A non-numeric or negative budget on any of the budget flags (named, since there are several). */
    budgetInvalid(flag: string, value: string): string;
    /** employee set with no field to change. */
    nothingToSet(): string;
    /** A --language value that is neither zh nor en. */
    languageInvalid(value: string): string;
    /** A --status / --to value that is not a kanban column. */
    statusInvalid(value: string): string;
    priorityInvalid(value: string): string;
    /** ticket create: --goal XOR --body-file. */
    ticketBodyConflict(): string;
    criteriaNeedsGoal(): string;
    bodyFileUnreadable(file: string): string;
    countInvalid(value: string): string;
    /** An id or handbook path with a `.` / `..` segment: the URL would collapse onto another route. */
    pathSegmentInvalid(value: string): string;
    /** ticket attach outside a session and without --session. */
    attachSessionMissing(): string;
    /** Confirmations of the write commands. */
    created(orgId: string, ceoDeskSessionId: string | undefined): string;
    hired(agentId: string, title: string, reportsTo: string | null): string;
    employeeUpdated(agentId: string): string;
    left(agentId: string): string;
    desk(
      agentId: string,
      sessionId: string,
      workspace: string,
      openedAt: string,
      created: boolean,
    ): string;
    deskRenewed(agentId: string, sessionId: string): string;
    calendarWritten(
      agentId: string,
      name: string,
      enabledText: string,
      nextFireAt: string | undefined,
    ): string;
    /** One advisory rota line the server answered a calendar write with (its text stays English). */
    calendarWarning(warning: string): string;
    calendarRemoved(agentId: string, name: string): string;
    ticketCreated(ticketId: string, status: string): string;
    ticketMoved(ticketId: string, status: string): string;
    ticketAssigned(ticketId: string, owner: string): string;
    ticketBlocked(ticketId: string): string;
    ticketUnblocked(ticketId: string): string;
    progressRecorded(ticketId: string): string;
    ticketAttached(ticketId: string, sessionId: string): string;
    channelCreated(channelId: string): string;
    channelInvited(channelId: string, principal: string): string;
    channelJoined(channelId: string): string;
    channelLeft(channelId: string): string;
    channelMemberRemoved(channelId: string, principal: string): string;
    channelArchived(channelId: string): string;
    channelUnarchived(channelId: string): string;
    messageSent(id: string): string;
    handbookWritten(path: string): string;
    handbookRemoved(path: string): string;
    /** Empty states. */
    empty(projectId: string): string;
    calendarEmpty(): string;
    ticketsEmpty(): string;
    channelsEmpty(): string;
    channelEmpty(channelId: string, date: string): string;
    /** `show`: one line per fact. */
    showHead(name: string, orgId: string, status: string): string;
    showMission(mission: string): string;
    showLanguage(language: string): string;
    showEmployees(count: number, running: number, paused: number): string;
    showBoard(counts: string, blocked: number): string;
    showSpend(period: string, spend: string): string;
    showPending(mentions: number, review: number, blockedByMe: number): string;
    /** An invalid organization / employee / ticket, with the reason (a line in `show`, a cell in tables). */
    invalid(reason: string): string;
    /** `ticket show`: the derived state above the file. */
    ticketHead(
      ticketId: string,
      status: string,
      running: boolean,
      blocked: string | undefined,
    ): string;
    ticketFigures(cost: string, rolledUp: string, sessions: number, children: number): string;
    /** `ticket show`: the labels of the ticket's frontmatter fields, above the prose sections. */
    ticketFields(): Record<
      | "title"
      | "owner"
      | "parent"
      | "notify"
      | "priority"
      | "due"
      | "blocked"
      | "blockedBy"
      | "sessions",
      string
    >;
    /** `ticket show`: the heading above the operation history; the actions themselves stay in English. */
    ticketHistory(): string;
    /**
     * A `system` line rendered from its structured notice, in the reader's language; a kind
     * this build does not know falls back to the message's English `text`.
     */
    notices: Record<OrgChannelNoticeKind, (p: Record<string, string>) => string>;
    /** The all-hands channel's label; its stored name is never shown. */
    allHands(): string;
    /** `channel tail` on any channel but the default one: a dim line naming it above the messages. */
    channelHeader(channelId: string): string;
    /** `channel show`: the head line, then the lines the channel actually has. */
    channelHead(name: string, channelId: string, members: number, archived: boolean): string;
    channelPurposeLine(purpose: string): string;
    channelCreatedBy(principal: string, createdAt: string): string;
    channelLastMessage(time: string): string;
    financeTotal(period: string, total: string): string;
    /** stderr note under `finance`: some usage had no pricing, so the total is a lower bound. */
    unpriced(): string;
    colEmployees(): string;
    colRunning(): string;
    colOpen(): string;
    colBlocked(): string;
    colSpend(): string;
    colNote(): string;
    /** Chart / finance: the employee's job title. */
    colJobTitle(): string;
    /** Tickets: the ticket title. */
    colTitle(): string;
    colState(): string;
    colOwn(): string;
    colCumulative(): string;
    colBudget(): string;
    colNext(): string;
    colPriority(): string;
    colOwner(): string;
    colTicket(): string;
    colRolledUp(): string;
    colMembers(): string;
    colArchived(): string;
    colUnread(): string;
    colMentions(): string;
    colPrincipal(): string;
  };
  /** Server-connection layer: resolution, auto-start, tokens, streams. */
  client: {
    invalidServerUrl(value: string): string;
    /** --server names a non-loopback URL and no PENGUIN_API_TOKEN is set (the local token file must not travel). */
    remoteNeedsToken(url: string): string;
    /** No server reachable and auto-start was disabled by the caller. */
    noServer(): string;
    /** Auto-start impossible: the CLI entry is not plain-node runnable (tsx dev run). */
    autoStartUnavailable(): string;
    autoStartFailed(logPath: string): string;
    /** Printed to stderr when a server was auto-started for this invocation. */
    autoStarted(url: string, logPath: string): string;
    /** 401 with no token found anywhere (env or file). */
    noToken(url: string, tokenPath: string): string;
    /** 401 despite presenting a token. */
    authFailed(url: string): string;
    httpError(status: number, code: string, message: string): string;
    sessionNotFound(ref: string, projectId: string): string;
    sessionAmbiguous(ref: string, candidates: string[]): string;
    /** The SSE stream dropped and reconnecting gave up. */
    streamLost(detail: string): string;
    /** resync_required: the reconnect fell off the server's replay buffer (a display gap, not data loss). */
    streamResynced(): string;
    /** Invalid --timeout value (names the accepted shapes). */
    timeoutInvalid(value: string): string;
    /** Soft-yield detach: the wait budget expired, the task keeps running server-side. */
    stillRunning(shortId: string): string;
    /** Caller-context lookup failed (PENGUIN_SESSION_ID names a session this server cannot answer for): plain defaults apply. */
    callerDefaultsFailed(sessionId: string): string;
    /** Dim stderr note naming the session a bare `logs` / `input` resolved to (the agent's most recent). */
    latestSession(sessionId: string): string;
    /** Bare `logs` / `input` when the agent has no session at all: what to run to get one. */
    noSessionsYet(agentId: string, projectId: string): string;
  };
  /** `/thinking` display when the Session pins no level: the Agent's configured default applies. */
  chatThinkingConfigured(): string;
  serve: {
    serverDesc: string;
    webDesc: string;
    port: string;
    host: string;
    noOpen: string;
    /** Printed by the supervising process as it relaunches the service on a restart request (the web UI's "restart to update"). */
    restarting: string;
  };
  /** `penguin server reset-admin-password`: help text and every line the command can print. */
  auth: {
    desc: string;
    loginDesc: string;
    statusDesc: string;
    logoutDesc: string;
    server: string;
    userId: string;
    password: string;
    print: string;
    accountPrompt(fallback: string): string;
    prompt(userId: string): string;
    emptyPassword: string;
    noServer(root: string): string;
    unreachable(server: string, detail: string): string;
    refused(status: number, detail: string): string;
    noCookie: string;
    loggedIn(userId: string, server: string, file: string): string;
    notLoggedIn(file: string): string;
    statusLine(userId: string, server: string): string;
    expires(when: string): string;
    expired(when: string): string;
    loggedOut(server: string): string;
    loggedOutLocally(server: string): string;
  };
  authToken: {
    desc: string;
    userId: string;
    ttlSeconds: string;
    mark: string;
    badTtl: string;
    noServer(root: string): string;
    failed(detail: string): string;
  };
  /** `penguin server status`: help text. */
  serverStatus: {
    /** One-line description in `penguin server --help`. */
    desc: string;
  };
  /** `penguin server stop`: help text. */
  serverStop: {
    desc: string;
  };
  resetPassword: {
    desc: string;
    /** Refusal while a live server owns the data root (stop it first, then retry). */
    serverRunning(url: string): string;
    /** The root has no Web database: nothing to reset. */
    noDatabase(dbPath: string): string;
    /** The database exists but the admin was never seeded. */
    noAdmin(): string;
    /** Success header, printed above the framed credentials notice. */
    done(root: string): string;
    /** Hint printed below the notice. */
    next(): string;
  };
  /** `penguin version`: help text only — the command's output is data, never prose. */
  version: {
    description: string;
    json: string;
  };
  /** `penguin update`: help text and every line the command can print. */
  update: {
    desc: string;
    check: string;
    releaseOpt: string;
    yes: string;
    /** `--check` header: the running version against the resolved target. */
    checkReport(current: string, latest: string): string;
    upgradeAvailable(target: string): string;
    upToDate(current: string): string;
    /** `--release` naming a release older than the running one: allowed, but said out loud. */
    targetIsOlder(target: string): string;
    /** Pre-confirmation plan for a tarball install (mechanism, target, install dir, data-dir guarantee). */
    planTarball(current: string, target: string, installDir: string, universal: boolean): string;
    /** Pre-confirmation plan for a global npm install. */
    planNpm(current: string, target: string, manager: string, command: string): string;
    confirm(): string;
    /** stdin is not a TTY: require --yes instead of blocking on a prompt nobody can answer. */
    needsYes(): string;
    cancelled(): string;
    done(version: string): string;
    failed(): string;
    /** Running from a source checkout: refuse, because overwriting a working tree destroys work. */
    sourceCheckout(): string;
    /** Bundled into the desktop app: refuse, because the app updates itself. */
    desktopApp(): string;
    unknownInstall(modulePath: string): string;
    /** A global install whose package manager could not be identified: print the command, never guess. */
    npmUnknownManager(globalRoot: string, target: string): string;
    /** Windows, tarball install: the official installer is a POSIX shell script. */
    windowsUnsupported(): string;
    /**
     * Windows, global install: `spawn` cannot run a `.cmd` shim without a shell, so hand the user
     * the exact command instead of failing generically.
     */
    windowsGlobalInstall(command: string): string;
    networkFailed(url: string): string;
    rateLimited(): string;
    apiFailed(status: number): string;
    apiMalformed(): string;
    invalidDownloadSource(): string;
    downloadBaseMustBeHttps(name: string): string;
    ossUnavailable(): string;
    installerFetchFailed(sources: InstallerSource[]): string;
  };

  // —— Runtime output ——
  /** Startup banner: product + subcommand + CLI version on the first line, then Agent / Workspace / Model each on its own line. */
  header(
    kind: "chat" | "run",
    version: string,
    agentId: string,
    workspace: string,
    model: string,
  ): string;
  chatHints(): string;
  confirmExit(): string;
  taskInterrupted(): string;
  /** Acknowledgment printed when a line typed mid-run is queued as steering (echoes the text; delivered between turns). */
  steerQueued(text: string): string;
  /** Prefix for a rendered [user_steering] line (a mid-run user message delivered between turns). */
  steerLinePrefix(): string;
  error(message: string): string;
  /** Approval prompt text (the tool call is already streamed above and directly precedes this prompt, so no index and no re-rendering). */
  approvePrompt(): string;
  /**
   * Stats shown at the end of each Task: Session cumulative values plus this task's delta —
   * context window length, Token usage, elapsed time. Delta strings carry their own sign
   * (contextDelta can be negative after context is compacted), e.g.
   * `[stats] context 4k (+1k) · tokens 6k (+1.2k) · 5.1s (+2.3s)`.
   */
  taskStats(s: {
    context: string;
    contextDelta: string;
    tokens: string;
    tokensDelta: string;
    elapsed: string;
    elapsedDelta: string;
  }): string;
  /** Abort line (user interruptions only): the cause localizes from `errorCode`; `errorMessage` (raw, untranslatable) rides verbatim; a legacy Trace without a code renders its English `reason` prose as-is. */
  abortLabel(abort?: { errorCode?: string; errorMessage?: string; reason?: string }): string;
  /** Run-ending LLM failure (request_end status fatal — no abort event follows); the provider's error text rides verbatim. */
  llmFatalLabel(errorMessage?: string): string;
  /** The retry ladder gave up (request_end `retryable` with no planned retry); `attempt` is the final attempt's ordinal, `errorMessage` the last failure's detail. */
  reconnectGaveUpLabel(attempt: number, errorMessage?: string): string;
  /**
   * request_end ended with a status the engine reconnects on: the engine retries carrying
   * already-produced content; attempt is the retry count. The cause wording localizes from
   * `errorCode` (legacy Traces: the retired status spellings say the same thing).
   */
  reconnectLabel(
    status: "retryable" | "failed" | "timeout" | "malformed",
    attempt: number,
    errorCode?: string,
  ): string;
  /** compaction start event: indicates compaction in progress (mode is summarize/discard, reason is context/turns/manual). */
  compactionStart(mode: string, reason: string): string;
  /**
   * compaction stop event: the compaction result (status is completed/failed/aborted;
   * completed varies its text by mode). tokens is Token usage (same convention as the stats
   * line: total = Session cumulative, delta = consumed by this compaction, carrying its own
   * sign); when present it is appended at the end of the line, e.g. ` · tokens 14k (+6k)`.
   */
  compactionStop(
    mode: string,
    status: string,
    tokens?: { total: string; delta: string },
    errorMessage?: string,
  ): string;
  /** mcp_connect_begin event: the configured MCP servers are being connected (the first run, or a new context after compaction). */
  mcpConnectStart(servers: string[]): string;
  /** mcp_connect_end event, one line: total wall time; `failures` carries "server (reason)" per failed connect (empty = all ok); `aborted` = the user interrupted mid-connect. */
  mcpConnectStop(
    durationMs: number,
    failures: { server: string; error: string }[],
    aborted: boolean,
  ): string;
  /** Prompt shown when `/compact` has nothing to compact (session just started / two consecutive compactions). */
  compactNothing(): string;
  /** Feedback after `/clear`: a fresh blank Session is now active; the old Session stays on disk (its resume command is printed right above when it has a Trace record). */
  clearDone(): string;
  /** Dim line announcing one goal round (printed before the round runs). */
  goalRound(round: number): string;
  /** Dim summary line after a goal ends: how it ended, rounds run, tokens consumed. */
  goalFinished(
    outcome: "complete" | "blocked" | "budget_limited" | "aborted",
    rounds: number,
    tokens: string,
  ): string;
  /** Dim line for a hook's answer (any hook but goal, whose own lines cover it): name, decision, reason. */
  hookEvent(name: string, decision: string | undefined, reason: string | undefined): string;
  /** `/goal` usage error (missing objective / malformed command). */
  goalUsage(): string;
  /** Invalid token-budget value (chat `/goal:<budget>` or run `--goal <budget>`). */
  goalBudgetInvalid(value: string): string;
  /** run's --goal given an empty/whitespace -m (the objective must be non-empty text). */
  goalObjectiveEmpty(): string;
  /** `/thinking` with no argument: the level this Session is pinned to (by `--thinking` or `/thinking`), else the Agent's configured level. */
  thinkingCurrent(level: string): string;
  /** `/thinking <level>` accepted: the Session is pinned to it, effective from the next request; the reply advises compacting first — a mid-context change invalidates the provider's cached context (never written to the Agent config). */
  thinkingSet(level: string): string;
  /** Invalid `--thinking` / `/thinking` value (lists the selectable levels). */
  thinkingInvalid(value: string): string;
  /** `/verbose` toggled on: tool output renders in full from here on. */
  verboseOn(): string;
  /** `/verbose` toggled off: long tool output is collapsed again from here on. */
  verboseOff(): string;
  /** Dim elision-marker line inside a collapsed tool output; `hidden` = lines not shown (>= 2). */
  toolOutputElided(hidden: number): string;
  /** Prompt for an invalid --approve mode. */
  approveModeInvalid(value: string): string;
  /** Render label for an approval decision (frontend renders the approval_decision event; one label each for allow/deny). */
  approvalDecision(decision: "allow" | "deny" | "forbidden"): string;
  /** run/chat given only one of --model-id / --provider: a model reference is always an explicit pair, never a lookup. */
  modelRefIncomplete(): string;
  /** --resume is mutually exclusive with --workspace/--model-id (neither can change once the Session is created). */
  resumeNoOverride(): string;
  /** --resume given without a session id, and the current Agent has no Session at all. */
  resumeNoSession(): string;
  /** One-line prompt shown after a successful resume, before rendering history. */
  resumedBanner(sessionId: string, messageCount: number): string;
  /** Example resume command shown when the REPL exits (dim print; only when this session has a resumable record). */
  resumeHint(command: string): string;
  langInvalid(value: string): string;
  /** `config lang` persists via POSIX shell startup files; on Windows it refuses with a pointer to a user env var instead. */
  langWindowsUnsupported(lang: string): string;
  langSet(lang: string, rcPath: string): string;
  langRestartConfirm(): string;
  langRestart(): string;
  langRestartHint(rcPath: string): string;
  /** Result output for model add/default/vision/remove: the argument is the already-formatted pair reference (formatModelRef). */
  modelAdded(model: string, defaultModel: string | undefined): string;
  modelUpdated(model: string, defaultModel: string | undefined): string;
  defaultModelSet(model: string): string;
  visionModelSet(model: string): string;
  modelRemoved(model: string, defaultModel: string | undefined): string;
  /** `model remove` on a pair the Project config doesn't have. */
  modelNotConfigured(model: string): string;
  /** Follows modelRemoved when the removed entry was also the vision model. */
  visionModelCleared(): string;
  modelListTitle(): string;
  modelListEmpty(): string;
  vaultSet(key: string): string;
  vaultRemoved(key: string): string;
  vaultKeyMissing(key: string): string;
  vaultListTitle(): string;
  vaultListEmpty(): string;
  /** URL prompt once the `penguin web` service is ready. */
  webReady(url: string): string;
  /** Refusal when `penguin server` finds a live server on the same data root. */
  serverAlreadyRunning(url: string): string;
  /** Notice when `penguin web` finds a live server on the same data root (it opens that instance instead). */
  webAlreadyRunning(url: string): string;
  /** Diagnostic shown after the `penguin web` ready-poll times out (15s). */
  webProbeFailed(url: string, detail: string, kind: WebProbeFailureKind, port: number): string;
}

function headerEn(
  kind: "chat" | "run",
  version: string,
  agentId: string,
  workspace: string,
  model: string,
): string {
  return [
    `PenguinHarness ${kind} v${version}`,
    `Agent: ${agentId}`,
    `Workspace: ${workspace}`,
    `Model: ${model}`,
  ].join("\n");
}

const en: Messages = {
  cliDescription: "PenguinHarness CLI",
  versionDesc: "output the version number",
  common: {
    projectId: "Project id",
    agentId: "Agent id",
    modelId: "Model to use (upstream model id; defaults to the Project default model)",
    provider:
      "Provider group of --model-id; required whenever --model-id is given (the group is never inferred)",
    root: "Data root directory (overrides PENGUIN_HOME and ~/.penguin/data)",
    workspace: "Workspace directory; must already exist (defaults to the current directory)",
    approve:
      "Approval mode: allow-all (auto-approve, default), deny-all (auto-reject), read-only (auto-approve read-only tools, prompt for the rest), always-ask (prompt per tool)",
    thinking:
      "Thinking level for this session: low, medium, high, xhigh, or max (defaults to the Agent's configured level)",
    json: "Print raw JSON instead of the rendered output",
    server:
      "Server URL to connect to (defaults to PENGUIN_API_URL, then the local running server, then auto-start)",
    timeout:
      "Wait at most this long (30s / 5m / 2h, or bare seconds), then detach and leave the task running (exit 0)",
    latestAgentId: "Agent whose most recent session is used when no session id is given",
  },
  usage: {
    missingArgument: (name) => `missing required argument <${name}>`,
    missingOption: (flags) => `missing required option ${flags}`,
    optionMissingArgument: (flags) => `option ${flags} needs a value`,
    unknownOption: (flag) => `unknown option ${flag}`,
    unknownCommand: (name) => `unknown command ${name}`,
    other: (detail) => detail,
    hint: (command, usage) =>
      `Usage: ${command} ${usage}  (run \`${command} --help\` for every option)`,
  },
  config: {
    desc: "Manage Project configuration",
    modelDesc: "Manage model credentials and the default model",
    addDesc: "Add or update a model, optionally writing a credential",
    addModelId: "Upstream model id sent to AgentHub as-is (e.g. claude-sonnet-4-6)",
    addProvider:
      "Provider group stored alongside model_id; required, never inferred (use custom for anything without a vendor group)",
    addApiKey: "API key, stored inline in the Project's hidden .project_config.toml",
    addBaseUrl: "Custom base URL",
    addContextWindow: "Context window size (tokens)",
    addMaxTokens:
      "Per-model max output tokens (positive integer); when set it overrides the Agent's max_tokens, omit to inherit — lower it for small-context models",
    addClientType:
      "AgentHub client type (e.g. openai-chat); defaults by provider group when omitted",
    addVision: "Mark the model as supporting image input (vision)",
    addNoVision: "Mark the model as NOT supporting image input; omit both to keep current",
    addFastMode:
      "Enable fast mode: faster output at premium pricing (models without a fast tier reject requests carrying it)",
    addNoFastMode: "Disable fast mode (the default); omit both to keep current",
    fastModeUnsupported: (ref: string): string =>
      `Warning: ${ref} cannot serve fast mode — AgentHub's client for it rejects the parameter, so its requests will fail. Re-run with --no-fast-mode to turn it off.`,
    addPriceCacheRead: "Price per 1M tokens: cache read (USD)",
    addPriceCacheWrite: "Price per 1M tokens: cache write (USD)",
    addPriceOutput: "Price per 1M tokens: output (USD)",
    addSetDefault: "Also set as the Project default model",
    defaultDesc: "Set the Project default model",
    visionDesc:
      "Set the vision model that reads images for non-vision session models (read_file hands images to it)",
    refModelId: "Upstream model id; forms the (provider, model_id) pair reference with --provider",
    refProvider: "Provider group of the referenced entry (see `penguin config model list`)",
    listDesc: "List the Project's models (API keys hidden)",
    removeDesc: "Remove a model from the Project (clears the default / vision pointers naming it)",
    langDesc: "Set the interface language (en); persists PENGUIN_LANG to your shell startup file",
    langArg: "Language: en",
    vaultDesc: "Manage an Agent's vault (environment variables injected into its shell commands)",
    vaultSetDesc: "Set a vault environment variable (added or overwritten)",
    vaultListDesc: "List vault environment variables (values masked)",
    vaultRemoveDesc: "Remove a vault environment variable",
    vaultKey: "Variable name (letters, digits and underscores; must not start with a digit)",
    vaultValue: "Variable value, written to the Agent's agent_state/.vault.toml",
  },
  run: {
    desc: "Run a single Task",
    message: "Prompt for this Task",
    goal: "Goal mode: loop until the goal completes; optional token budget (e.g. 500k, 2m)",
    session: "Reuse an existing Session (full id or a unique fragment, e.g. the 8-hex tail)",
    source:
      "Mark the new session as created by a Benchmark evaluation (`benchmark`); the Web App files it under the Evaluations folder",
    background: "Post the task and exit immediately, printing the session id",
    sessionNoOverride: () =>
      "--session reuses an existing Session: --workspace, --model-id, --provider and --source cannot be combined with it (none can change after creation).",
    sourceInvalid: (value) =>
      `Invalid --source value "${value}". The only accepted value is benchmark.`,
    timeoutWithBackground: () =>
      "--timeout bounds the wait, and --background does not wait: drop one of them.",
  },
  chat: {
    desc: "Open the interactive REPL",
    resume:
      "Resume an existing Session (defaults to the agent's most recent one); workspace and model follow the original Session",
    verbose:
      "Show full tool output (by default long tool outputs are collapsed to their first and last lines; /verbose toggles it mid-chat)",
  },
  ls: {
    desc: "List the project's sessions (all agents unless --agent-id is given)",
    all: "Include archived sessions",
    days: "Only sessions last active within the trailing <n> calendar days (today counts as day 1)",
    daysInvalid: (value) => `Invalid --days value "${value}": expected a positive integer.`,
    empty: (projectId) => `No sessions in project ${projectId} yet.`,
    colId: () => "ID",
    colAgent: () => "AGENT",
    colTitle: () => "TITLE",
    colState: () => "STATE",
    colLast: () => "LAST",
    colWorkspace: () => "WORKSPACE",
    stateIdle: () => "idle",
    stateRunning: () => "running",
  },
  input: {
    desc: "Send a message into a session (steering while it runs, a new task when idle); without -m, print its most recent assistant reply. The session defaults to the agent's most recent one",
    message: "Message text (omit to poll the session's last assistant reply instead)",
    noReplyYet: () => "(no assistant reply yet)",
  },
  logs: {
    desc: "Render a session's history (defaults to the agent's most recent session)",
    tail: "Show only the last <n> entries",
    follow: "Keep following the live stream after the history",
    tailInvalid: (value) => `Invalid --tail value "${value}": expected a positive integer.`,
    timeoutNeedsFollow: () =>
      "--timeout only applies to -f/--follow: without it, logs never waits.",
  },
  agent: {
    desc: "Manage the project's agents",
    lsDesc: "List the project's agents",
    createDesc: "Create an agent",
    createId: "Agent id (directory name; letters, digits, underscores)",
    createName: "Display name (defaults to the id)",
    createDescription: "Description",
    createPlugins:
      "Library plugins to preinstall, comma-separated (e.g. software-development,goal)",
    created: (agentId, projectId) => `Agent ${agentId} created in project ${projectId}.`,
    colId: () => "ID",
    colName: () => "NAME",
    colSessions: () => "SESSIONS",
    colDescription: () => "DESCRIPTION",
  },
  project: {
    desc: "Manage projects",
    lsDesc: "List the projects this account can reach",
    colId: () => "ID",
    colName: () => "NAME",
    colRole: () => "ROLE",
  },
  cost: {
    desc: "Show token usage and cost (summary card by default; --by prints a grouped table)",
    days: "Trailing window in days (sets --from/--to)",
    from: "Range start (yyyy-mm-dd); requires --to",
    to: "Range end (yyyy-mm-dd); requires --from",
    by: "Group the table by: date, agent, model or session",
    rangeIncomplete: () => "--from and --to must be given together.",
    daysInvalid: (value) => `Invalid --days value "${value}": expected a positive integer.`,
    byInvalid: (value) => `Invalid --by value "${value}": expected date, agent, model or session.`,
    today: () => "today",
    last7d: () => "last 7 days",
    total: () => "total",
    empty: () => "No usage recorded for this range.",
    noPricing: () => "-",
    colTokens: () => "TOKENS",
    colRequests: () => "REQUESTS",
    colCost: () => "COST",
    colGroup: (dimension) => dimension.toUpperCase(),
  },
  schedule: {
    desc: "Manage scheduled tasks",
    lsDesc: "List the project's scheduled tasks (all agents unless --agent-id is given)",
    addDesc:
      "Create a scheduled task (writes the schedule file through the API; enabled by default — use --disabled to opt out)",
    updateDesc:
      "Update a scheduled task (read-modify-write: unspecified fields keep their stored values)",
    rmDesc: "Delete a scheduled task (no prompt; the server's owner authorization applies)",
    prompt: "The text each firing sends",
    startAt: "First fire time (ISO 8601), or the literal `now` for the current instant",
    period: "Fixed interval, minimum 5m (e.g. 30m, 12h, 1d, 7d); omitted = one-shot",
    endAt: "Stop firing after this instant (ISO 8601)",
    sessionId: "Bind firings to one session (excludes --workspace / the model pair)",
    workspace: "New-session mode: workspace for each firing (omitted = a temp workspace)",
    disabledOpt: "Create the task disabled (the CLI default is enabled)",
    enableOpt: "Enable the task",
    disableOpt: "Disable the task",
    enableDisableConflict: () => "--enable and --disable are mutually exclusive.",
    targetConflict: () =>
      "--session-id and the new-session form (--workspace / --model-id / --provider) are mutually exclusive: the target is one or the other.",
    written: (name, enabledText, nextFireAt) =>
      `Schedule ${name} written (${enabledText}${nextFireAt !== undefined ? `, next fire ${nextFireAt}` : ""}).`,
    removed: (name) => `Schedule ${name} removed.`,
    enabled: () => "on",
    disabled: () => "off",
    oneShot: () => "once",
    newSession: () => "new session",
    empty: (projectId) => `No scheduled tasks in project ${projectId}.`,
    colName: () => "NAME",
    colEnabled: () => "ENABLED",
    colStartAt: () => "START",
    colPeriod: () => "PERIOD",
    colTarget: () => "TARGET",
    colLastFired: () => "LAST FIRED",
    colStatus: () => "STATUS",
  },
  org: {
    desc: "Company mode: manage an organization (employees, desks, calendar, tickets, channels, finance)",
    lsDesc: "List the project's organizations",
    createDesc:
      "Create an organization: its CEO Agent, the CEO's desk session and the initialization run",
    showDesc:
      "Overview: employees and their states, board counts, spend against budget, pending items",
    chartDesc: "The employee tree with titles, states, spend and budgets",
    hireDesc:
      "Employ an Agent: an existing one (--agent-id) or a new one (--new-agent), under --reports-to",
    employeeDesc: "Manage employees",
    employeeSetDesc: "Update an employee's entry in the tree (only the given fields change)",
    leaveDesc: "Remove an employee from the organization (not the CEO); the Agent itself stays",
    deskDesc: "Desk sessions (one standing session per employee)",
    deskShowDesc: "The employee's desk session id and Workspace (opens the desk if it has none)",
    deskRenewDesc: "Open a fresh desk session for the employee (resets its context)",
    calendarDesc: "Calendar events (schedules that fire into the employee's desk session)",
    calendarLsDesc: "List the organization's calendar events (one employee's with --agent-id)",
    calendarAddDesc:
      "Create a calendar event (writes the event file through the API; enabled by default — use --disabled to opt out)",
    calendarUpdateDesc:
      "Update a calendar event (read-modify-write: unspecified fields keep their stored values)",
    calendarRmDesc: "Delete a calendar event (no prompt)",
    ticketDesc: "Tickets on the kanban board",
    ticketLsDesc: "List the board's tickets (filtered locally by --status / --owner / --blocked)",
    ticketShowDesc: "Show a ticket: the derived figures, then the ticket file",
    ticketCreateDesc: "Create a ticket in the proposed column",
    ticketMoveDesc: "Move a ticket to another column (a reason is required for rejected)",
    ticketAssignDesc: "Set a ticket's owner",
    ticketBlockDesc: "Mark a ticket blocked (it stays in its column)",
    ticketUnblockDesc: "Clear a ticket's blocked state",
    ticketProgressDesc: "Append a progress entry (attributed to the calling session)",
    ticketStartDesc:
      "Open a ticket session that works on the ticket in the background; prints the session id. Only the ticket's owner (its desk) or a person may start one — assign the ticket to move it to another employee",
    ticketAttachDesc:
      "Attach an existing session as a contributor (defaults to the calling session)",
    channelDesc:
      "The organization's channels (default_channel is the all-hands one everybody is in)",
    channelLsDesc: "List the channels: every one of them for a person, its own for an employee",
    channelCreateDesc:
      "Open a channel; only its creator is in it, everyone else arrives by invitation",
    channelShowDesc: "Show a channel and its members",
    channelInviteDesc: "Invite principals into a channel (any member may)",
    channelJoinDesc: "Join a channel yourself (people only; an employee waits to be invited)",
    channelLeaveDesc: "Leave a channel",
    channelRemoveDesc: "Remove another member from a channel (people only)",
    channelArchiveDesc: "Archive a channel: read-only until it is unarchived (people only)",
    channelUnarchiveDesc: "Unarchive a channel (people only)",
    channelTailDesc: "Print a channel's last messages of a day (20 unless -n is given)",
    channelSendDesc:
      "Send a message to a channel (@agent:<id> / @all mention its members and trigger their desks)",
    handbookDesc:
      "The organization handbook: the knowledge base under handbook/, whose README.md is the index every run reads first",
    handbookListDesc: "List the handbook files (path, size, updated), the index first",
    handbookShowDesc: "Print a handbook document (the index when no path is given)",
    handbookWriteDesc: "Create or replace a handbook document from -m or --file",
    handbookRmDesc: "Delete a handbook document (the index cannot be deleted)",
    financeDesc: "Spend per employee (along the reporting line) and per ticket, against budgets",
    orgId:
      "Organization id (defaults to PENGUIN_ORG_ID, set inside desk and ticket sessions; no other default)",
    newOrgId:
      "Id of the organization to create (letters, digits, underscores; also its directory name)",
    mission: "The organization's mission",
    orgName: "Display name (defaults to the id)",
    orgLanguageOption:
      "Working language of everything the organization writes: zh or en (defaults to the mission's own language)",
    hireAgentId: "Employ this existing Agent (mutually exclusive with --new-agent)",
    newAgent: "Create an Agent with this id and employ it (mutually exclusive with --agent-id)",
    newAgentName: "Display name of the new Agent",
    newAgentDescription: "Description of the new Agent",
    skills:
      "Extra library plugins for the new Agent, comma-separated (added to agent-company,agent-development)",
    title: "Job title",
    reportsTo: "Agent id of the manager",
    employeeWorkspace:
      "Workspace: a sub-directory of the shared workspace (. = all of it) or an absolute path, written as given",
    hireWorkspace:
      "Workspace: a sub-directory of the shared workspace or an absolute path, written as given (defaults to a sub-directory named after the employee)",
    budget: "Monthly budget in USD for the employee plus everyone below it",
    ceoBudget:
      "The CEO's monthly budget in USD, which is the whole company's (budgets accumulate along the reporting line)",
    duties: "Duties, in prose",
    calendarAgentId:
      "Employee the event belongs to (defaults to PENGUIN_AGENT_ID); on ls, list only this employee's events",
    calendarTitle: "Event title",
    statusFilter: "Only this column: proposed, in_progress, review, done or rejected",
    ownerFilter: "Only tickets owned by this principal (agent:<id> / user:<id>)",
    blockedFilter: "Only blocked tickets",
    ticketTitle: "Ticket title",
    ticketSlug: "The ticket id's words: lowercase English words joined by hyphens",
    goal: "The goal, naming every input it relies on by full path (mutually exclusive with --body-file)",
    criteria: "Acceptance criteria, naming the expected deliverables by full path (with --goal)",
    bodyFile: "Read the whole Markdown body from this file (the header is still generated)",
    owner: "The responsible principal (agent:<id> / user:<id>); defaults to you on create",
    parent: "Parent ticket id",
    notify: "Principals notified when the ticket ends, comma-separated",
    priority: "Priority: P0, P1 or P2",
    due: "Due date (yyyy-mm-dd)",
    moveTo: "Target column: proposed, in_progress, review, done or rejected",
    moveReason: "Why (required when moving into rejected; recorded under Result)",
    blockReason: "Why the ticket is blocked",
    blockedBy: "Who or which ticket it waits for (a principal or a ticket id)",
    progressText: "The progress entry, naming the files it refers to by full path",
    startMessage: "A note appended to the ticket text the session opens with",
    startWorkspace:
      "Another directory inside the shared workspace (defaults to the employee's desk workspace)",
    startAgentId:
      "Which employee the session runs as: a colleague you enlist on your own ticket (defaults to you inside a session, otherwise the ticket's owner)",
    attachSession:
      "The session to attach, full id or unique fragment (defaults to PENGUIN_SESSION_ID)",
    channelOpt: "Channel to read or write in (default: default_channel, the all-hands channel)",
    channelName: "Display name (defaults to the id)",
    channelPurpose: "What the channel is for",
    channelDate: "Day to read (yyyy-mm-dd in the organization's timezone; defaults to today)",
    channelCount: "Number of messages to print (default 20)",
    channelText: "Message text (@agent:<id> or @all to mention, inside the channel's membership)",
    handbookPath:
      "Path relative to handbook/ (plain segments, e.g. decisions/2026-09-02-hire-plan.md)",
    handbookText: "Document text",
    handbookFile: "Read the document text from a local file",
    handbookOneSource: "Give exactly one of -m <text> or --file <file>.",
    refTicket: "Ticket the message refers to",
    refSession: "Session the message refers to",
    period: "Month to report (yyyy-mm; defaults to the current month)",
    orgIdMissing: () =>
      "No organization given: pass --org-id <id>, or set PENGUIN_ORG_ID (desk and ticket sessions carry it in their environment).",
    hireTargetConflict: () =>
      "Pass exactly one of --agent-id (an existing Agent) and --new-agent (create one).",
    newAgentFieldsOnly: () => "--name, --description and --skills describe --new-agent only.",
    budgetInvalid: (flag, value) =>
      `Invalid ${flag} value "${value}": expected a non-negative amount in USD.`,
    nothingToSet: () => "Nothing to update: pass at least one field.",
    languageInvalid: (value) => `Invalid --language value "${value}": expected zh or en.`,
    statusInvalid: (value) =>
      `Invalid column "${value}": expected proposed, in_progress, review, done or rejected.`,
    priorityInvalid: (value) => `Invalid --priority value "${value}": expected P0, P1 or P2.`,
    ticketBodyConflict: () => "Pass exactly one of --goal and --body-file.",
    criteriaNeedsGoal: () => "--criteria goes with --goal.",
    bodyFileUnreadable: (file) => `Cannot read --body-file ${file}.`,
    countInvalid: (value) => `Invalid -n value "${value}": expected a positive integer.`,
    pathSegmentInvalid: (value) =>
      `Invalid name "${value}": "." and ".." are neither an id nor a handbook path.`,
    attachSessionMissing: () =>
      "No session to attach: pass --session <id>, or run inside a session (PENGUIN_SESSION_ID).",
    created: (orgId, ceoDeskSessionId) =>
      `Organization ${orgId} created${ceoDeskSessionId !== undefined ? ` (CEO desk session ${ceoDeskSessionId})` : ""}.`,
    hired: (agentId, title, reportsTo) =>
      `Employee ${agentId} hired as ${title}${reportsTo !== null ? `, reporting to ${reportsTo}` : ""}.`,
    employeeUpdated: (agentId) => `Employee ${agentId} updated.`,
    left: (agentId) => `Employee ${agentId} left the organization.`,
    desk: (agentId, sessionId, workspace, openedAt, created) =>
      `Desk of ${agentId}: session ${sessionId} (workspace ${workspace}, opened ${openedAt})${created ? " — opened just now" : ""}`,
    deskRenewed: (agentId, sessionId) => `Desk of ${agentId} renewed: session ${sessionId}.`,
    calendarWritten: (agentId, name, enabledText, nextFireAt) =>
      `Calendar event ${agentId}/${name} written (${enabledText}${nextFireAt !== undefined ? `, next fire ${nextFireAt}` : ""}).`,
    calendarWarning: (warning) => `Rota notice: ${warning}`,
    calendarRemoved: (agentId, name) => `Calendar event ${agentId}/${name} removed.`,
    ticketCreated: (ticketId, status) => `Ticket ${ticketId} created (${status}).`,
    ticketMoved: (ticketId, status) => `Ticket ${ticketId} moved to ${status}.`,
    ticketAssigned: (ticketId, owner) => `Ticket ${ticketId} assigned to ${owner}.`,
    ticketBlocked: (ticketId) => `Ticket ${ticketId} marked blocked.`,
    ticketUnblocked: (ticketId) => `Ticket ${ticketId} unblocked.`,
    progressRecorded: (ticketId) => `Progress recorded on ticket ${ticketId}.`,
    ticketAttached: (ticketId, sessionId) => `Session ${sessionId} attached to ticket ${ticketId}.`,
    channelCreated: (channelId) => `Channel ${channelId} created.`,
    channelInvited: (channelId, principal) => `${principal} invited to ${channelId}.`,
    channelJoined: (channelId) => `Joined ${channelId}.`,
    channelLeft: (channelId) => `Left ${channelId}.`,
    channelMemberRemoved: (channelId, principal) => `${principal} removed from ${channelId}.`,
    channelArchived: (channelId) => `Channel ${channelId} archived.`,
    channelUnarchived: (channelId) => `Channel ${channelId} unarchived.`,
    messageSent: (id) => `Message ${id} sent.`,
    handbookWritten: (path) => `Handbook document ${path} written.`,
    handbookRemoved: (path) => `Handbook document ${path} removed.`,
    empty: (projectId) => `No organizations in project ${projectId}.`,
    calendarEmpty: () => "No calendar events.",
    ticketsEmpty: () => "No tickets match.",
    channelsEmpty: () => "No channels.",
    channelEmpty: (channelId, date) => `No messages in ${channelId} on ${date}.`,
    showHead: (name, orgId, status) => `${name} (${orgId}) — ${status}`,
    showMission: (mission) => `Mission: ${mission}`,
    showLanguage: (language) => `Working language: ${language}`,
    showEmployees: (count, running, paused) =>
      `Employees: ${count} (${running} running, ${paused} paused)`,
    showBoard: (counts, blocked) => `Board: ${counts} (${blocked} blocked)`,
    showSpend: (period, spend) => `Spend (${period}): ${spend}`,
    showPending: (mentions, review, blockedByMe) =>
      `Pending: ${mentions} mentions, ${review} tickets to review, ${blockedByMe} blocked by me`,
    invalid: (reason) => `invalid: ${reason}`,
    ticketHead: (ticketId, status, running, blocked) =>
      `Ticket ${ticketId}: ${status}${running ? ", running" : ""}${blocked !== undefined ? `, blocked (${blocked})` : ""}`,
    ticketFigures: (cost, rolledUp, sessions, children) =>
      `Cost ${cost} (rolled up ${rolledUp}), ${sessions} sessions, ${children} child tickets`,
    ticketFields: () => ({
      title: "Title",
      owner: "Owner",
      parent: "Parent",
      notify: "Notify",
      priority: "Priority",
      due: "Due",
      blocked: "Blocked",
      blockedBy: "Blocked by",
      sessions: "Sessions",
    }),
    ticketHistory: () => "History:",
    notices: {
      employee_joined: (p) => `${p.agent} joined as ${p.title}, reporting to ${p.reportsTo}.`,
      employee_left: (p) => `${p.agent} left the organization; reports now go to ${p.reportsTo}.`,
      channel_created: (p) => `${p.by} created the channel.`,
      channel_archived: (p) => `${p.by} archived the channel.`,
      channel_unarchived: (p) => `${p.by} unarchived the channel.`,
      channel_joined: (p) => `${p.principal} joined the channel.`,
      channel_invited: (p) => `${p.by} invited ${p.principal} to the channel.`,
      channel_left: (p) => `${p.principal} left the channel.`,
      channel_removed: (p) => `${p.by} removed ${p.principal} from the channel.`,
      budget_warned: (p) =>
        `Budget warning: ${p.agent} has used ${p.percent}% of its ${p.period} budget (${p.cost} / ${p.budget} USD).`,
      budget_paused: (p) =>
        `Budget pause: ${p.agent} reached ${p.percent}% of its ${p.period} budget (${p.cost} / ${p.budget} USD); its calendar and its subordinates' are paused.`,
      ticket_blocked: (p) => `Ticket ${p.ticket} (${p.title}) is now blocked.`,
      ticket_done: (p) => `Ticket ${p.ticket} (${p.title}) is now done.`,
      ticket_rejected: (p) => `Ticket ${p.ticket} (${p.title}) is now rejected.`,
    },
    allHands: () => "All hands",
    channelHeader: (channelId) => `[channel ${channelId}]`,
    channelHead: (name, channelId, members, archived) =>
      `${name} (${channelId}) — ${members} members${archived ? ", archived" : ""}`,
    channelPurposeLine: (purpose) => `Purpose: ${purpose}`,
    channelCreatedBy: (principal, createdAt) => `Created by ${principal} on ${createdAt}`,
    channelLastMessage: (time) => `Last message: ${time}`,
    financeTotal: (period, total) => `Total (${period}): ${total}`,
    unpriced: () =>
      "[unpriced] some usage ran on a model without pricing: the figures are a lower bound",
    colEmployees: () => "EMPLOYEES",
    colRunning: () => "RUNNING",
    colOpen: () => "OPEN",
    colBlocked: () => "BLOCKED",
    colSpend: () => "SPEND",
    colNote: () => "NOTE",
    colJobTitle: () => "TITLE",
    colTitle: () => "TITLE",
    colState: () => "STATE",
    colOwn: () => "OWN",
    colCumulative: () => "CUMULATIVE",
    colBudget: () => "BUDGET",
    colNext: () => "NEXT",
    colPriority: () => "PRIORITY",
    colOwner: () => "OWNER",
    colTicket: () => "TICKET",
    colRolledUp: () => "ROLLED UP",
    colMembers: () => "MEMBERS",
    colArchived: () => "ARCHIVED",
    colUnread: () => "UNREAD",
    colMentions: () => "@ME",
    colPrincipal: () => "PRINCIPAL",
  },
  client: {
    invalidServerUrl: (value) => `Invalid server URL "${value}": expected http(s)://host[:port].`,
    remoteNeedsToken: (url) =>
      `${url} is not this machine: set PENGUIN_API_TOKEN to authenticate against a remote server (the local api-token file never leaves its own data root).`,
    noServer: () => "No running server found for this data root.",
    autoStartUnavailable: () =>
      "No running server found, and this CLI entry cannot auto-start one (development run). Start it yourself with `penguin server`.",
    autoStartFailed: (logPath) =>
      `The auto-started server did not come up. Its output is in ${logPath}.`,
    autoStarted: (url, logPath) => `Started a local server at ${url} (log: ${logPath}).`,
    noToken: (url, tokenPath) =>
      `${url} rejected the request (401) and no API token is available: set PENGUIN_API_TOKEN, or make sure the server's token file is readable at ${tokenPath}.`,
    authFailed: (url) =>
      `${url} rejected the API token (401). If the server restarted, its token rotated — check PENGUIN_API_TOKEN, or let the CLI read the current api-token file.`,
    httpError: (status, code, message) =>
      `Server error ${status} (${code})${message ? `: ${message}` : ""}`,
    sessionNotFound: (ref, projectId) =>
      `No session matching "${ref}" in project ${projectId} (try \`penguin ls\`).`,
    sessionAmbiguous: (ref, candidates) =>
      `"${ref}" matches ${candidates.length} sessions:\n  ${candidates.join("\n  ")}\nUse a longer fragment or the full id.`,
    streamLost: (detail) => `Lost the server stream and reconnecting failed: ${detail}`,
    streamResynced: () =>
      "[stream] reconnected past the server's replay buffer; some output may be missing here (penguin logs shows the full history)",
    timeoutInvalid: (value) =>
      `Invalid --timeout value "${value}": expected 30s, 5m, 2h, or a bare number of seconds.`,
    stillRunning: (shortId) =>
      `[still running] session ${shortId} continues on the server — follow with \`penguin logs -f ${shortId}\` or poll with \`penguin input ${shortId}\``,
    callerDefaultsFailed: (sessionId) =>
      `[caller context] could not read calling session ${sessionId}; using the plain defaults`,
    latestSession: (sessionId) => `[latest] session ${sessionId}`,
    noSessionsYet: (agentId, projectId) =>
      `Agent ${agentId} has no sessions in project ${projectId} yet: start one with \`penguin run -m "..."\` or \`penguin chat\`.`,
  },
  chatThinkingConfigured: () => "agent default",
  serve: {
    serverDesc:
      "Start the Web service (HTTP API and the built-in frontend, same process); subcommand reset-admin-password resets a forgotten admin password",
    webDesc: "Start the Web service and open the UI in a browser once it is ready",
    port: "Listen port (falls back to the PORT env var, default 7364)",
    host: "Listen address (falls back to the HOST env var, default 127.0.0.1)",
    noOpen: "Do not open a browser automatically",
    restarting: "Restarting the service to apply the update…",
  },
  auth: {
    desc: "Sign in to a PenguinHarness server from the terminal",
    loginDesc: "Sign in with a password and remember the session",
    statusDesc: "Show the remembered session, if there is one",
    logoutDesc: "Revoke the remembered session and forget it",
    server: "Server URL (default: the server running on this data root)",
    userId: "Account to sign in as (asked for when omitted; default admin)",
    password: "Password (also read from PENGUIN_PASSWORD; prompted when neither is given)",
    print: "Also print the session token to stdout",
    accountPrompt: (fallback) => `Account [${fallback}]: `,
    prompt: (userId) => `Password for ${userId}: `,
    emptyPassword: "No password given.",
    noServer: (root) =>
      `No server is running on ${root}, so there is nothing to sign in to \u2014 pass --server <url>.`,
    unreachable: (server, detail) => `Could not reach ${server}: ${detail}`,
    refused: (status, detail) => `The server refused the sign-in (${status}): ${detail}`,
    noCookie: "The server accepted the sign-in but issued no session cookie.",
    loggedIn: (userId, server, file) => `Signed in as ${userId} on ${server}. Saved to ${file}.`,
    notLoggedIn: (file) => `Not signed in (no ${file}).`,
    statusLine: (userId, server) => `Signed in as ${userId} on ${server}.`,
    expires: (when) => `Expires ${when}.`,
    expired: (when) => `Expired ${when} \u2014 sign in again.`,
    loggedOut: (server) => `Signed out of ${server}; the session was revoked there.`,
    loggedOutLocally: (server) =>
      `Forgotten locally, but ${server} could not be reached \u2014 the session may still be valid there until it expires.`,
  },
  authToken: {
    desc: "Mint a short-lived API session token for this data root (for a controller reaching this machine over ssh)",
    userId: "Account to mint for (default: admin)",
    ttlSeconds: "Lifetime in seconds (default: 3600)",
    mark: "Print a fixed marker line before the token, for callers parsing it out of a shell",
    badTtl: "--ttl-seconds must be a positive integer.",
    noServer: (root) =>
      `${root} has no web.db — no server has ever run on this data root, so there is no account to mint for.`,
    failed: (detail) => `Could not mint a token: ${detail}`,
  },
  serverStatus: {
    desc: "Print this data root's server state and machine id as one line of JSON",
  },
  serverStop: {
    desc: "Stop the server running on this data root and report the outcome as JSON",
  },
  resetPassword: {
    desc: "Reset the Web admin account so the next server start prints a new first-login link (the server must be stopped)",
    serverRunning: (url) =>
      `A PenguinHarness server is running on this data root: ${url}\n` +
      `Stop it first, then run \`penguin server reset-admin-password\` again.`,
    noDatabase: (dbPath) =>
      `No Web database at ${dbPath} — nothing to reset. ` +
      `Start the service once (\`penguin web\`) to create the admin account.`,
    noAdmin: () =>
      "The Web database has no admin account yet — nothing to reset. " +
      "Start the service once (`penguin web`) to seed it.",
    done: (root) =>
      `The admin account on data root ${root} was returned to its unclaimed state, and all of its sign-in sessions were revoked.`,
    next: () =>
      "Start the service (`penguin web`): it will print a sign-in link that claims the account — usable until a password is set.",
  },
  version: {
    description: "Show which build is running",
    json: "Print the full build info as JSON (the body of GET /api/version)",
  },
  update: {
    desc: "Upgrade this PenguinHarness install in place",
    check: "Only report the current and latest versions; change nothing",
    releaseOpt:
      "Target a specific release tag instead of the latest (e.g. v0.1.2 or 0.1.2); named --release because -v/--version is the CLI's own version flag",
    yes: "Skip the confirmation prompt",
    checkReport: (current, latest) => `Installed ${current} · latest ${latest}`,
    upgradeAvailable: (target) =>
      `An upgrade is available: run \`penguin update\` to install ${target}.`,
    upToDate: (current) => `Already on the latest version (${current}); nothing to do.`,
    targetIsOlder: (target) =>
      `${target} is older than the installed version — this would be a downgrade.`,
    planTarball: (current, target, installDir, universal) =>
      [
        `Upgrade ${current} -> ${target}`,
        `  how:         re-run the official installer (this install came from the tarball)`,
        `  install dir: ${installDir}${universal ? " (universal package, no bundled Node runtime)" : ""}`,
        `  replaces:    bin, lib, web${universal ? "" : ", node"} — your data dir is NOT touched`,
      ].join("\n"),
    planNpm: (current, target, manager, command) =>
      [
        `Upgrade ${current} -> ${target}`,
        `  how:     global ${manager} install (this install came from ${manager})`,
        `  command: ${command}`,
        `  your data dir is NOT touched`,
      ].join("\n"),
    confirm: () => "Proceed? [y/N] ",
    needsYes: () =>
      "Not running in a terminal, so the confirmation cannot be answered. Re-run with --yes to upgrade non-interactively.",
    cancelled: () => "Cancelled; nothing was changed.",
    done: (version) =>
      `PenguinHarness ${version} installed. Run \`penguin --version\` in a new shell to confirm.`,
    failed: () => "Upgrade failed; the previous install was left in place where possible.",
    sourceCheckout: () =>
      "This penguin runs from a source checkout, so there is nothing to download — update it with `git pull` and rebuild (`pnpm install && pnpm -r build`).",
    desktopApp: () =>
      "This penguin ships inside the PenguinHarness desktop app and is replaced when the app updates — check for updates from the application menu.",
    unknownInstall: (modulePath) =>
      `Cannot tell how this penguin was installed (running from ${modulePath}), so it will not be replaced. Re-install with the official installer, or upgrade with the package manager you used.`,
    npmUnknownManager: (globalRoot, target) =>
      `This is a global install under ${globalRoot}, but the package manager that owns it could not be identified. Upgrade it yourself with that manager, e.g. \`npm install -g @prismshadow/penguin-cli@${target}\`.`,
    windowsUnsupported: () =>
      "The official installer is a POSIX shell script and does not run on Windows. Re-install from the GitHub Releases page, or use a global npm install instead.",
    windowsGlobalInstall: (command) =>
      [
        "On Windows, penguin cannot run your package manager for you: Node will not execute an npm/pnpm/yarn `.cmd` shim without a shell.",
        "Run this yourself in a terminal, then reopen it:",
        `  ${command}`,
      ].join("\n"),
    networkFailed: (url) => `Could not reach ${url}. Check your network and retry.`,
    rateLimited: () =>
      "GitHub rate-limited the release lookup. Wait a few minutes and retry, or pass --release <tag> to skip the lookup.",
    apiFailed: (status) => `The GitHub release lookup failed with HTTP ${status}.`,
    apiMalformed: () =>
      "The GitHub release lookup returned an unexpected response with no usable version tag.",
    invalidDownloadSource: () => "PENGUIN_DOWNLOAD_SOURCE must be auto, oss, or github.",
    downloadBaseMustBeHttps: (name) => `${name} must be an absolute HTTPS URL.`,
    ossUnavailable: () => "The OSS mirror is unavailable or its release metadata is invalid.",
    installerFetchFailed: (sources) =>
      `Could not download the installer from ${sources
        .map((source) =>
          source === "configured"
            ? "the configured mirror"
            : source === "oss"
              ? "the OSS mirror"
              : "GitHub",
        )
        .join(" or ")}. Check your network and retry.`,
  },

  header: headerEn,
  chatHints: () =>
    "Type a message to start a conversation; end a line with \\; typing while a task runs steers the agent; /goal runs a goal to completion; /compact to compact the context; /clear to start a fresh session; /thinking changes the thinking level; /verbose toggles full tool output; /exit to quit; and Ctrl-C interrupts the current conversation.",
  confirmExit: () => "Exit penguin? [y/N] ",
  taskInterrupted: () => "[current conversation interrupted]",
  steerQueued: (text) => `» steering queued (delivered with the next turn): ${text}`,
  steerLinePrefix: () => "↪ user: ",
  error: (message) => `[error] ${message}`,
  approvePrompt: () => "? Approve this tool call? [Y/n] ",
  taskStats: (s) =>
    `[stats] context ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · ${s.elapsed} (${s.elapsedDelta})`,
  abortLabel: (abort) => {
    const cause =
      abort?.errorCode === "user_abort"
        ? "aborted by user"
        : abort?.errorCode === "backoff_interrupted"
          ? "aborted during reconnect backoff"
          : abort?.errorCode === "compaction_interrupted"
            ? "aborted during compaction"
            : (abort?.errorCode ?? abort?.reason ?? "");
    const text = cause ? `${cause}${abort?.errorMessage ? `: ${abort.errorMessage}` : ""}` : "";
    return `[abort]${text ? `: ${text}` : ""}`;
  },
  llmFatalLabel: (errorMessage) =>
    `[error] llm request error${errorMessage ? `: ${errorMessage}` : ""}`,
  reconnectGaveUpLabel: (attempt, errorMessage) =>
    `[retry] giving up after attempt ${attempt}${errorMessage ? `: ${errorMessage}` : ""}`,
  reconnectLabel: (status, attempt, errorCode) =>
    // The live protocol carries the classified cause on error_code; the legacy status
    // spellings say the same thing for pre-convergence Traces.
    `[retry] ${((kind) =>
      kind === "timeout"
        ? "connection timed out"
        : kind === "malformed"
          ? "response incomplete or unparseable"
          : kind === "network"
            ? "network or service temporarily unavailable"
            : kind === "failed"
              ? "the model provider returned an error"
              : "the request failed")(errorCode ?? status)}; sending retry #${attempt}…`,
  compactionStart: (mode, reason) =>
    mode === "discard"
      ? `[compaction] discarding context (${reason})…`
      : `[compaction] summarizing context (${reason})…`,
  mcpConnectStart: (servers) => `[mcp] connecting MCP servers (${servers.join(", ")})…`,
  mcpConnectStop: (durationMs, failures, aborted) =>
    aborted
      ? "[mcp] connect interrupted — reconnects on the next run"
      : failures.length === 0
        ? `[mcp] connected in ${(durationMs / 1000).toFixed(1)}s`
        : `[mcp] connected in ${(durationMs / 1000).toFixed(1)}s; unavailable: ${failures.map((f) => `${f.server} (${f.error})`).join(", ")}`,
  compactionStop: (mode, status, tokens, errorMessage) =>
    (status === "completed"
      ? mode === "discard"
        ? "[compaction] done; old context discarded"
        : "[compaction] done; continuing with the summarized context"
      : status === "aborted"
        ? "[compaction] aborted; keeping the current context"
        : `[compaction] failed${errorMessage !== undefined ? ` (${errorMessage})` : ""}; keeping the current context${
            // retryable = abandoned this time, retried at the next trigger; fatal = a config
            // or credential change has to come first. Legacy Traces spell both "failed".
            status === "retryable"
              ? "; retries at the next trigger"
              : status === "fatal"
                ? "; fix the model configuration to retry"
                : ""
          }`) + (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),
  compactNothing: () => "[compaction] nothing to compact yet",
  clearDone: () => "[clear] started a fresh session (the previous one is kept and resumable)",
  goalRound: (round) => `[goal] round ${round}`,
  goalFinished: (outcome, rounds, tokens) => {
    const label = {
      complete: "completed",
      blocked: "blocked (see the final reply for what it needs)",
      budget_limited: "stopped: token budget exhausted",
      aborted: "interrupted",
    }[outcome];
    return `[goal] ${label} · ${rounds} round${rounds === 1 ? "" : "s"} · tokens ${tokens}`;
  },
  hookEvent: (name, decision, reason) =>
    `[hook] ${[name, decision, reason].filter(Boolean).join(" · ")}`,
  goalUsage: () => "Usage: /goal[:<budget>] <objective>  (e.g. /goal:500k fix all failing tests)",
  goalBudgetInvalid: (value) =>
    `Invalid token budget "${value}". Use a positive number with an optional k/m suffix (500k, 2m).`,
  goalObjectiveEmpty: () => "Goal mode requires a non-empty objective: pass it via -m.",
  thinkingCurrent: (level) =>
    `[thinking] level: ${level} (this Session's) — change with /thinking <low|medium|high|xhigh|max>`,
  thinkingSet: (level) =>
    `[thinking] level pinned to ${level} for this Session, effective from the next request — changing it invalidates the model's cached context, so /compact first is recommended (the Agent config is unchanged)`,
  thinkingInvalid: (value) =>
    `Invalid thinking level "${value}". Use low, medium, high, xhigh, or max.`,
  verboseOn: () => "[verbose] on — tool output from here on shows in full",
  verboseOff: () =>
    "[verbose] off — long tool output from here on is collapsed (/verbose to toggle)",
  toolOutputElided: (hidden) => `… (+${hidden} lines, /verbose for full output)`,
  approveModeInvalid: (value) =>
    `Invalid approval mode "${value}". Use allow-all, deny-all, read-only, or always-ask.`,
  approvalDecision: (decision) =>
    decision === "allow"
      ? "✓ [approved]"
      : decision === "forbidden"
        ? "× [forbidden by policy]"
        : "× [denied]",
  modelRefIncomplete: () =>
    "--model-id and --provider must be given together: a model reference is always an explicit (provider, model_id) pair. Omit both to use the Project default model.",
  resumeNoOverride: () =>
    "--resume does not accept --workspace, --model-id or --provider: they follow the original Session and cannot change.",
  resumeNoSession: () => "No session to resume: this agent has no recorded sessions yet.",
  resumedBanner: (sessionId, messageCount) =>
    `[resumed] ${sessionId} · ${messageCount} message${messageCount === 1 ? "" : "s"} in the current context`,
  resumeHint: (command) => `To continue this conversation: ${command}`,
  langInvalid: (value) => `Invalid language "${value}". Use en.`,
  langWindowsUnsupported: (lang) =>
    `penguin config lang persists via POSIX shell startup files, which Windows does not have.\n` +
    `Set the user environment variable instead: setx PENGUIN_LANG ${lang} (new terminals pick it up).`,
  langSet: (lang, rcPath) => `Language set to ${lang}; wrote PENGUIN_LANG to ${rcPath}.`,
  langRestartConfirm: () => "Open a new shell now to apply? [y/N] ",
  langRestart: () => "Opening a new shell with the new language (type exit to return)…",
  langRestartHint: (rcPath) => `Open a new terminal, or run: source ${rcPath}`,
  modelAdded: (model, def) => `Added model ${model}. Default model: ${def ?? "(unset)"}`,
  modelUpdated: (model, def) => `Updated model ${model}. Default model: ${def ?? "(unset)"}`,
  defaultModelSet: (model) => `Default model set to ${model}.`,
  visionModelSet: (model) => `Vision model set to ${model}.`,
  modelRemoved: (model, def) => `Removed model ${model}. Default model: ${def ?? "(unset)"}`,
  modelNotConfigured: (model) => `Model ${model} is not in the Project config.`,
  visionModelCleared: () => "It was also the vision model; that setting is now unset.",
  modelListTitle: () => "Configured models:",
  modelListEmpty: () => "No models configured yet. Add one with `penguin config model add`.",
  vaultSet: (key) =>
    `Saved vault entry ${key}. New conversations pick it up right away; running ones after their next compaction.`,
  vaultRemoved: (key) =>
    `Removed vault entry ${key}. New conversations pick it up right away; running ones after their next compaction.`,
  vaultKeyMissing: (key) => `Vault entry ${key} does not exist.`,
  vaultListTitle: () => "Vault environment variables (values masked):",
  vaultListEmpty: () => "The vault is empty. Add one with `penguin config vault set`.",
  webReady: (url) => `Web UI ready: ${url}`,
  serverAlreadyRunning: (url) =>
    `A PenguinHarness server is already running on this data root: ${url}\n` +
    `Stop it first, or point PENGUIN_HOME at a separate data root.`,
  webAlreadyRunning: (url) =>
    `Already running on this data root — opening the existing instance: ${url}`,
  webProbeFailed: (url, detail, kind, port) => {
    const hint = {
      timeout:
        `The connection timed out. Check whether a firewall or security application is blocking it. ` +
        `Allow PenguinHarness to communicate on local port ${port}.`,
      refused:
        "Nothing accepted the connection. Check whether the server exited or HOST/PORT points somewhere else.",
      reset:
        "The connection closed before an HTTP response. Check local security software and retry.",
      permission:
        "The operating system denied the connection. Check firewall or security policy permissions.",
      dns: "The host name could not be resolved. Check --host or HOST.",
      unknown: `Open ${url} manually after the server is ready.`,
    }[kind];
    return `Server readiness check failed for ${url}.\nLast probe error: ${detail}\n${hint}`;
  },
};

const DICTIONARIES: Record<string, Messages> = { en };

/** Get the message set for a language, falling back to English when unavailable. */
export function getMessages(language: Language): Messages {
  return DICTIONARIES[language] ?? en;
}

/** Resolve the language from the env var and return its message set (the default used when no explicit `t` is given). */
export function defaultMessages(): Messages {
  return getMessages(resolveLanguage());
}

/** Mask an API key: keep only a few trailing characters; return `-` when unconfigured. */
export function maskApiKey(apiKey: string | undefined): string {
  if (!apiKey) return "-";
  // Mask the whole thing when ≤12 chars: `****last4` reveals too much of a short secret (same threshold as the server-side mask).
  if (apiKey.length <= 12) return "***";
  return `****${apiKey.slice(-4)}`;
}
