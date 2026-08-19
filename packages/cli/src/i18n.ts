/**
 * CLI text internationalization (i18n).
 *
 * Language comes from the `PENGUIN_LANG` env var (`en` / `zh`), defaulting to English (en) —
 * independent of Project config or CLI options. This module centralizes all user-visible text:
 * command/option help descriptions and runtime output, one implementation per language.
 */

/** UI language. */
export type Language = "en" | "zh";

/** Installer locations are localized at the message boundary, not embedded in update logic. */
export type InstallerSource = "configured" | "oss" | "github";

/** Readiness probe failure classes; selects which hint `webProbeFailed` appends. */
export type WebProbeFailureKind =
  "timeout" | "refused" | "reset" | "permission" | "dns" | "unknown";

/** Resolve the language from the env var; `zh` matches exactly, everything else falls back to English (see comment #2). */
export function resolveLanguage(): Language {
  const v = (process.env.PENGUIN_LANG ?? "").trim().toLowerCase();
  return v === "zh" ? "zh" : "en";
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
  };
  chat: { desc: string; resume: string };
  serve: {
    serverDesc: string;
    webDesc: string;
    port: string;
    host: string;
    noOpen: string;
  };
  /** `penguin server reset-admin-password`: help text and every line the command can print. */
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
  /** Abort event label (may include a reason). */
  abortLabel(reason?: string): string;
  /**
   * request_end ended with a status the engine reconnects on (`failed` / `timeout` /
   * `malformed` — only `auth` is terminal): the engine retries carrying already-produced
   * content; attempt is the retry count.
   */
  reconnectLabel(status: "failed" | "timeout" | "malformed", attempt: number): string;
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
  /** mcp_connect_begin event: the first run is connecting the configured MCP servers. */
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
  /** `/goal` usage error (missing objective / malformed command). */
  goalUsage(): string;
  /** Invalid token-budget value (chat `/goal:<budget>` or run `--goal <budget>`). */
  goalBudgetInvalid(value: string): string;
  /** run's --goal given an empty/whitespace -m (the objective must be non-empty text). */
  goalObjectiveEmpty(): string;
  /** Prompt for an invalid --approve mode. */
  approveModeInvalid(value: string): string;
  /** Render label for an approval decision (frontend renders the approval_decision event; one label each for allow/deny). */
  approvalDecision(decision: "allow" | "deny"): string;
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

function headerZh(
  kind: "chat" | "run",
  version: string,
  agentId: string,
  workspace: string,
  model: string,
): string {
  return [
    `PenguinHarness ${kind} v${version}`,
    `Agent：${agentId}`,
    `Workspace：${workspace}`,
    `模型：${model}`,
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
    visionDesc: "Set the vision model used by read_image for non-vision session models",
    refModelId: "Upstream model id; forms the (provider, model_id) pair reference with --provider",
    refProvider: "Provider group of the referenced entry (see `penguin config model list`)",
    listDesc: "List the Project's models (API keys hidden)",
    removeDesc: "Remove a model from the Project (clears the default / vision pointers naming it)",
    langDesc:
      "Set the interface language (en|zh); persists PENGUIN_LANG to your shell startup file",
    langArg: "Language: en or zh",
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
  },
  chat: {
    desc: "Open the interactive REPL",
    resume:
      "Resume an existing Session (defaults to the agent's most recent one); workspace and model follow the original Session",
  },
  serve: {
    serverDesc:
      "Start the Web service (HTTP API and the built-in frontend, same process); subcommand reset-admin-password resets a forgotten admin password",
    webDesc: "Start the Web service and open the UI in a browser once it is ready",
    port: "Listen port (falls back to the PORT env var, default 7364)",
    host: "Listen address (falls back to the HOST env var, default 127.0.0.1)",
    noOpen: "Do not open a browser automatically",
  },
  resetPassword: {
    desc: "Reset the Web admin password to a fresh initial password (the server must be stopped)",
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
      `Admin password reset for data root ${root}. All admin sign-in sessions were cleared.`,
    next: () => "Start the service (`penguin web`) and sign in with the password above.",
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
    "Type a message to start a conversation; end a line with \\; typing while a task runs steers the agent; /goal runs a goal to completion; /compact to compact the context; /clear to start a fresh session; /exit to quit; and Ctrl-C interrupts the current conversation.",
  confirmExit: () => "Exit penguin? [y/N] ",
  taskInterrupted: () => "[current conversation interrupted]",
  steerQueued: (text) => `» steering queued (delivered with the next turn): ${text}`,
  steerLinePrefix: () => "↪ user: ",
  error: (message) => `[error] ${message}`,
  approvePrompt: () => "? Approve this tool call? [Y/n] ",
  taskStats: (s) =>
    `[stats] context ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · ${s.elapsed} (${s.elapsedDelta})`,
  abortLabel: (reason) => `[abort]${reason ? `: ${reason}` : ""}`,
  reconnectLabel: (status, attempt) =>
    `[retry] ${
      status === "timeout"
        ? "connection timed out"
        : status === "malformed"
          ? "response incomplete or unparseable"
          : "the model provider returned an error"
    }; sending retry #${attempt}…`,
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
      : `[compaction] ${status}${errorMessage !== undefined ? ` (${errorMessage})` : ""}; keeping the current context`) +
    (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),
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
  goalUsage: () => "Usage: /goal[:<budget>] <objective>  (e.g. /goal:500k fix all failing tests)",
  goalBudgetInvalid: (value) =>
    `Invalid token budget "${value}". Use a positive number with an optional k/m suffix (500k, 2m).`,
  goalObjectiveEmpty: () => "Goal mode requires a non-empty objective: pass it via -m.",
  approveModeInvalid: (value) =>
    `Invalid approval mode "${value}". Use allow-all, deny-all, read-only, or always-ask.`,
  approvalDecision: (decision) => (decision === "allow" ? "✓ [approved]" : "× [denied]"),
  modelRefIncomplete: () =>
    "--model-id and --provider must be given together: a model reference is always an explicit (provider, model_id) pair. Omit both to use the Project default model.",
  resumeNoOverride: () =>
    "--resume does not accept --workspace, --model-id or --provider: they follow the original Session and cannot change.",
  resumeNoSession: () => "No session to resume: this agent has no recorded sessions yet.",
  resumedBanner: (sessionId, messageCount) =>
    `[resumed] ${sessionId} · ${messageCount} message${messageCount === 1 ? "" : "s"} in the current context`,
  resumeHint: (command) => `To continue this conversation: ${command}`,
  langInvalid: (value) => `Invalid language "${value}". Use en or zh.`,
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
  vaultSet: (key) => `Saved vault entry ${key}.`,
  vaultRemoved: (key) => `Removed vault entry ${key}.`,
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

const zh: Messages = {
  cliDescription: "PenguinHarness CLI",
  versionDesc: "输出版本号",
  common: {
    projectId: "Project id",
    agentId: "Agent id",
    modelId: "本次使用的模型（上游模型 id；默认 Project 默认模型）",
    provider: "--model-id 的 provider 分组；给出 --model-id 时必须一并给出（分组不作任何推断）",
    root: "数据根目录（优先于 PENGUIN_HOME 与 ~/.penguin/data）",
    workspace: "Workspace 目录，须为已存在目录（默认当前目录）",
    approve:
      "审批模式：allow-all（全部放行，缺省）、deny-all（全部拒绝）、read-only（自动放行只读工具，其余仍逐个询问）、always-ask（逐个询问）",
  },
  config: {
    desc: "管理 Project 配置",
    modelDesc: "管理模型 credential 与默认模型",
    addDesc: "新增或更新一个模型，并可写入 credential",
    addModelId: "上游模型 id（如 claude-sonnet-4-6，原样发给 AgentHub）",
    addProvider: "与 model_id 分列存储的 provider 分组；必填，不作推断（无厂商分组时填 custom）",
    addApiKey: "API key，内联存入 Project 的隐藏文件 .project_config.toml",
    addBaseUrl: "自定义 base url",
    addContextWindow: "上下文窗口大小（token 数）",
    addMaxTokens:
      "该模型的最大输出长度（正整数）；设置后覆盖 Agent 的 max_tokens，缺省沿用——小上下文模型建议调低",
    addClientType: "AgentHub 客户端协议（如 openai-chat）；缺省按 provider 分组的语义取值",
    addVision: "标注该模型支持图片输入（视觉）",
    addNoVision: "标注该模型不支持图片输入；两者都不给则保留原值",
    addFastMode: "开启快速模式：输出更快、按溢价计费（不支持 fast 档位的模型会拒绝请求）",
    addNoFastMode: "关闭快速模式（缺省即关闭）；两者都不给则保留原值",
    fastModeUnsupported: (ref: string): string =>
      `警告：${ref} 不支持快速模式——AgentHub 为它选用的 client 会拒绝该参数，其请求都会失败。请用 --no-fast-mode 重新执行以关闭。`,
    addPriceCacheRead: "每百万 token 价格：缓存读取（USD）",
    addPriceCacheWrite: "每百万 token 价格：缓存写入（USD）",
    addPriceOutput: "每百万 token 价格：输出（USD）",
    addSetDefault: "同时设为该 Project 的默认模型",
    defaultDesc: "设置 Project 的默认模型",
    visionDesc: "设置 read_image 代读用的视觉模型（供不支持图片的会话模型读图）",
    refModelId: "上游模型 id；与 --provider 构成 (provider, model_id) 成对引用",
    refProvider: "引用条目的 provider 分组（见 `penguin config model list`）",
    listDesc: "列出当前 Project 的模型（API key 隐藏）",
    removeDesc: "从当前 Project 删除一个模型（指向它的默认模型 / 视觉模型设置一并清空）",
    langDesc: "设置界面语言（en|zh）；将 PENGUIN_LANG 写入 shell 启动文件并持久化",
    langArg: "语言：en 或 zh",
    vaultDesc: "管理 Agent vault（注入该 Agent shell 命令的环境变量）",
    vaultSetDesc: "写入一个 vault 环境变量（不存在则新增，存在则覆盖）",
    vaultListDesc: "列出 vault 环境变量（值掩码显示）",
    vaultRemoveDesc: "删除一个 vault 环境变量",
    vaultKey: "变量名（字母、数字与下划线，不能以数字开头）",
    vaultValue: "变量值，写入该 Agent 的 agent_state/.vault.toml",
  },
  run: {
    desc: "单次运行一个 Task",
    message: "本次 Task 的 Prompt",
    goal: "目标模式：循环运行直至目标完成；可选 token 预算（如 500k、2m）",
  },
  chat: {
    desc: "打开交互式 REPL",
    resume:
      "恢复既有 Session 继续对话（缺省恢复当前 Agent 最近一次）；Workspace 与模型沿用原 Session",
  },
  serve: {
    serverDesc:
      "启动 Web 服务（HTTP API 与内置前端，同一进程）；子命令 reset-admin-password 重置忘记的管理员密码",
    webDesc: "启动 Web 服务，就绪后用浏览器打开界面",
    port: "监听端口（其次取环境变量 PORT，缺省 7364）",
    host: "监听地址（其次取环境变量 HOST，缺省 127.0.0.1）",
    noOpen: "不自动打开浏览器",
  },
  resetPassword: {
    desc: "把 Web 管理员密码重置为新的初始密码（须先停止服务）",
    serverRunning: (url) =>
      `该数据根目录已有 PenguinHarness 服务在运行：${url}\n` +
      `请先停止它，再重新执行 \`penguin server reset-admin-password\`。`,
    noDatabase: (dbPath) =>
      `${dbPath} 处没有 Web 数据库，无可重置。请先执行 \`penguin web\` 启动一次服务以创建管理员账号。`,
    noAdmin: () =>
      "Web 数据库中尚无管理员账号，无可重置。请先执行 `penguin web` 启动一次服务完成种子创建。",
    done: (root) => `已重置数据根目录 ${root} 的管理员密码，并清空其全部登录会话。`,
    next: () => "启动服务（`penguin web`）后用上方密码登录。",
  },
  update: {
    desc: "原地升级当前的 PenguinHarness 安装",
    check: "只报告当前版本与最新版本，不做任何修改",
    releaseOpt:
      "指定目标版本而不是最新版（如 v0.1.2 或 0.1.2）；之所以叫 --release，是因为 -v/--version 是 CLI 自身的版本参数",
    yes: "跳过确认提示",
    checkReport: (current, latest) => `已安装 ${current} · 最新 ${latest}`,
    upgradeAvailable: (target) => `有可用升级：执行 \`penguin update\` 安装 ${target}。`,
    upToDate: (current) => `已是最新版本（${current}），无需升级。`,
    targetIsOlder: (target) => `${target} 低于当前已安装的版本——这将是一次降级。`,
    planTarball: (current, target, installDir, universal) =>
      [
        `升级 ${current} -> ${target}`,
        `  方式：    重新执行官方安装脚本（当前安装来自 tarball）`,
        `  安装目录：${installDir}${universal ? "（universal 包，不含内置 Node 运行时）" : ""}`,
        `  将替换：  bin、lib、web${universal ? "" : "、node"}——数据目录不会被改动`,
      ].join("\n"),
    planNpm: (current, target, manager, command) =>
      [
        `升级 ${current} -> ${target}`,
        `  方式：  ${manager} 全局安装（当前安装来自 ${manager}）`,
        `  命令：  ${command}`,
        `  数据目录不会被改动`,
      ].join("\n"),
    confirm: () => "确认继续？[y/N] ",
    needsYes: () => "当前不在终端中，无法回答确认提示。请加 --yes 以非交互方式升级。",
    cancelled: () => "已取消，未做任何修改。",
    done: (version) =>
      `PenguinHarness ${version} 安装完成。在新 shell 中执行 \`penguin --version\` 确认。`,
    failed: () => "升级失败；在可能的情况下已保留原有安装。",
    sourceCheckout: () =>
      "当前 penguin 运行自源码检出，无需下载——请用 `git pull` 更新并重新构建（`pnpm install && pnpm -r build`）。",
    unknownInstall: (modulePath) =>
      `无法判断当前 penguin 的安装方式（运行自 ${modulePath}），因此不会替换它。请用官方安装脚本重新安装，或用你当初使用的包管理器升级。`,
    npmUnknownManager: (globalRoot, target) =>
      `这是位于 ${globalRoot} 的全局安装，但无法确定是哪个包管理器安装的。请自行用该包管理器升级，例如 \`npm install -g @prismshadow/penguin-cli@${target}\`。`,
    windowsUnsupported: () =>
      "官方安装脚本是 POSIX shell 脚本，无法在 Windows 上运行。请从 GitHub Releases 页面重新安装，或改用 npm 全局安装。",
    windowsGlobalInstall: (command) =>
      [
        "在 Windows 上，penguin 无法代你调用包管理器：Node 不会在没有 shell 的情况下执行 npm/pnpm/yarn 的 `.cmd` 包装脚本。",
        "请在终端里自行执行下面的命令，然后重新打开终端：",
        `  ${command}`,
      ].join("\n"),
    networkFailed: (url) => `无法访问 ${url}。请检查网络后重试。`,
    rateLimited: () =>
      "GitHub 对版本查询做了限流。请等待几分钟后重试，或用 --release <tag> 跳过查询。",
    apiFailed: (status) => `GitHub 版本查询失败，HTTP ${status}。`,
    apiMalformed: () => "GitHub 版本查询返回了非预期的响应，其中没有可用的版本号。",
    invalidDownloadSource: () => "PENGUIN_DOWNLOAD_SOURCE 必须是 auto、oss 或 github。",
    downloadBaseMustBeHttps: (name) => `${name} 必须是绝对 HTTPS URL。`,
    ossUnavailable: () => "OSS 镜像不可用，或其版本元数据无效。",
    installerFetchFailed: (sources) => {
      const sourceText = sources
        .map((source) =>
          source === "configured" ? "配置的镜像" : source === "oss" ? "OSS 镜像" : "GitHub",
        )
        .join("或 ");
      const leadingSpace = /^[A-Za-z]/.test(sourceText) ? " " : "";
      const trailingSpace = /[A-Za-z]$/.test(sourceText) ? " " : "";
      return `无法从${leadingSpace}${sourceText}${trailingSpace}下载安装脚本。请检查网络后重试。`;
    },
  },

  header: headerZh,
  chatHints: () =>
    "输入消息发起对话；行尾 \\ 续行；运行中输入可插话引导；/goal 以目标模式运行至完成；/compact 压缩上下文；/clear 开启全新会话；/exit 退出；Ctrl-C 中断对话。",
  confirmExit: () => "确认退出 penguin？[y/N] ",
  taskInterrupted: () => "[已中断当前对话]",
  steerQueued: (text) => `» 插话已排队（随下一轮送达）：${text}`,
  steerLinePrefix: () => "↪ 用户: ",
  error: (message) => `[错误] ${message}`,
  approvePrompt: () => "? 批准此工具调用？[Y/n] ",
  taskStats: (s) =>
    `[统计信息] 上下文 ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · 用时 ${s.elapsed} (${s.elapsedDelta})`,
  abortLabel: (reason) => `[已中断]${reason ? `：${reason}` : ""}`,
  reconnectLabel: (status, attempt) =>
    `[重试] ${
      status === "timeout"
        ? "连接超时或网络中断"
        : status === "malformed"
          ? "响应不完整或无法解析"
          : "模型服务返回错误"
    }，正在发起第 ${attempt} 次重试……`,
  compactionStart: (mode, reason) =>
    mode === "discard"
      ? `[压缩] 正在丢弃旧上下文（${reason}）……`
      : `[压缩] 正在总结压缩上下文（${reason}）……`,
  mcpConnectStart: (servers) => `[mcp] 正在连接 MCP Server（${servers.join("、")}）……`,
  mcpConnectStop: (durationMs, failures, aborted) =>
    aborted
      ? "[mcp] 连接已中断，下次运行时重新连接"
      : failures.length === 0
        ? `[mcp] 连接完成，耗时 ${(durationMs / 1000).toFixed(1)}s`
        : `[mcp] 连接完成，耗时 ${(durationMs / 1000).toFixed(1)}s；不可用：${failures.map((f) => `${f.server}（${f.error}）`).join("、")}`,
  compactionStop: (mode, status, tokens, errorMessage) =>
    (status === "completed"
      ? mode === "discard"
        ? "[压缩] 完成，旧上下文已丢弃"
        : "[压缩] 完成，已切换到摘要后的新上下文"
      : `[压缩] ${status === "aborted" ? "已中断" : `失败${errorMessage !== undefined ? `（${errorMessage}）` : ""}`}，保留当前上下文`) +
    (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),
  compactNothing: () => "[压缩] 当前上下文为空，无需压缩",
  clearDone: () => "[清空] 已开启全新 Session（原会话仍保留，可恢复）",
  goalRound: (round) => `[目标] 第 ${round} 轮`,
  goalFinished: (outcome, rounds, tokens) => {
    const label = {
      complete: "已完成",
      blocked: "受阻（所缺条件见最后一条回复）",
      budget_limited: "已停止：token 预算耗尽",
      aborted: "已中断",
    }[outcome];
    return `[目标] ${label} · 共 ${rounds} 轮 · tokens ${tokens}`;
  },
  goalUsage: () => "用法：/goal[:<预算>] <目标>（例如 /goal:500k 修复所有失败的测试）",
  goalBudgetInvalid: (value) =>
    `无效的 token 预算 "${value}"：应为正数，可带 k/m 后缀（500k、2m）。`,
  goalObjectiveEmpty: () => "目标模式需要非空的目标文本：请通过 -m 传入。",
  approveModeInvalid: (value) =>
    `无效的审批模式 "${value}"。请使用 allow-all、deny-all、read-only 或 always-ask。`,
  approvalDecision: (decision) => (decision === "allow" ? "✓ [已批准]" : "× [已拒绝]"),
  modelRefIncomplete: () =>
    "--model-id 与 --provider 必须成对给出：模型引用始终是显式的 (provider, model_id) 组合。两者都不给则使用 Project 默认模型。",
  resumeNoOverride: () =>
    "--resume 不接受 --workspace、--model-id 与 --provider：均沿用原 Session，创建后不可更换。",
  resumeNoSession: () => "没有可恢复的 Session：当前 Agent 还没有任何会话记录。",
  resumedBanner: (sessionId, messageCount) =>
    `[已恢复] ${sessionId} · 当前上下文共 ${messageCount} 条消息`,
  resumeHint: (command) => `继续本次对话：${command}`,
  langInvalid: (value) => `无效的语言 "${value}"。请使用 en 或 zh。`,
  langWindowsUnsupported: (lang) =>
    `penguin config lang 通过 POSIX shell 启动文件持久化语言，Windows 上没有对应机制。\n` +
    `请改为设置用户环境变量：setx PENGUIN_LANG ${lang}（新终端生效）。`,
  langSet: (lang, rcPath) => `语言已设为 ${lang}；已将 PENGUIN_LANG 写入 ${rcPath}。`,
  langRestartConfirm: () => "现在打开新 shell 使其生效？[y/N] ",
  langRestart: () => "正在打开使用新语言的新 shell（输入 exit 可返回）……",
  langRestartHint: (rcPath) => `请打开新终端，或执行：source ${rcPath}`,
  modelAdded: (model, def) => `已添加模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,
  modelUpdated: (model, def) => `已更新模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,
  defaultModelSet: (model) => `默认模型已设为 ${model}。`,
  visionModelSet: (model) => `视觉模型已设为 ${model}。`,
  modelRemoved: (model, def) => `已删除模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,
  modelNotConfigured: (model) => `模型 ${model} 不在当前 Project 配置中。`,
  visionModelCleared: () => "它同时是视觉模型，该设置已一并清空。",
  modelListTitle: () => "已配置的模型：",
  modelListEmpty: () => "尚未配置任何模型。用 `penguin config model add` 添加。",
  vaultSet: (key) => `已保存 vault 条目 ${key}。`,
  vaultRemoved: (key) => `已删除 vault 条目 ${key}。`,
  vaultKeyMissing: (key) => `vault 条目 ${key} 不存在。`,
  vaultListTitle: () => "vault 环境变量（值已掩码）：",
  vaultListEmpty: () => "vault 为空。用 `penguin config vault set` 添加。",
  webReady: (url) => `Web 界面已就绪：${url}`,
  serverAlreadyRunning: (url) =>
    `该数据根目录已有 PenguinHarness 服务在运行：${url}\n请先停止它，或用 PENGUIN_HOME 指定另一个数据根目录。`,
  webAlreadyRunning: (url) => `该数据根目录已有服务在运行，打开既有实例：${url}`,
  webProbeFailed: (url, detail, kind, port) => {
    const hint = {
      timeout: `连接超时。请检查防火墙或安全软件是否拦截。请允许 PenguinHarness 在本机端口 ${port} 上通信。`,
      refused: "没有进程接受连接。请检查服务是否已经退出，或 HOST/PORT 是否指向了其他地址。",
      reset: "连接在收到 HTTP 响应前已关闭。请检查本机安全软件后重试。",
      permission: "操作系统拒绝了连接。请检查防火墙或安全策略权限。",
      dns: "无法解析主机名。请检查 --host 或 HOST。",
      unknown: `请在服务就绪后手动打开 ${url}。`,
    }[kind];
    return `服务探活失败：${url}\n最后一次探测错误：${detail}\n${hint}`;
  },
};

/** Get the message set for a language. */
export function getMessages(language: Language): Messages {
  return language === "zh" ? zh : en;
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
