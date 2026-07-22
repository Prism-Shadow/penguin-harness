/**
 * CLI text internationalization (i18n).
 *
 * Language comes from the `PENGUIN_LANG` env var (`en` / `zh`), defaulting to English (en) —
 * independent of Project config or CLI options. This module centralizes all user-visible text:
 * command/option help descriptions and runtime output, one implementation per language.
 */

/** UI language. */
export type Language = "en" | "zh";

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
    addPriceCacheRead: string;
    addPriceCacheWrite: string;
    addPriceOutput: string;
    addSetDefault: string;
    defaultDesc: string;
    visionDesc: string;
    /** `model default` / `model vision`'s --model-id: the upstream request id (pairs with --provider as a reference). */
    refModelId: string;
    /** `model default` / `model vision`'s --provider: the provider group of the referenced entry (required). */
    refProvider: string;
    listDesc: string;
    langDesc: string;
    langArg: string;
    vaultDesc: string;
    vaultSetDesc: string;
    vaultListDesc: string;
    vaultRemoveDesc: string;
    vaultKey: string;
    vaultValue: string;
  };
  run: { desc: string; message: string };
  chat: { desc: string; resume: string };
  serve: {
    serverDesc: string;
    webDesc: string;
    port: string;
    host: string;
    noOpen: string;
  };

  // —— Runtime output ——
  header(kind: "chat" | "run", agentId: string, workspace: string, model: string): string;
  chatHints(): string;
  confirmExit(): string;
  taskInterrupted(): string;
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
  /** request_end ended with timeout/malformed: the engine retries (reconnect) carrying already-produced content; attempt is the retry count. */
  reconnectLabel(status: "timeout" | "malformed", attempt: number): string;
  /** compaction start event: indicates compaction in progress (mode is summarize/discard, reason is context/turns/manual). */
  compactionStart(mode: string, reason: string): string;
  /**
   * compaction stop event: the compaction result (status is completed/failed/aborted;
   * completed varies its text by mode). tokens is Token usage (same convention as the stats
   * line: total = Session cumulative, delta = consumed by this compaction, carrying its own
   * sign); when present it is appended at the end of the line, e.g. ` · tokens 14k (+6k)`.
   */
  compactionStop(mode: string, status: string, tokens?: { total: string; delta: string }): string;
  /** Prompt shown when `/compact` has nothing to compact (session just started / two consecutive compactions). */
  compactNothing(): string;
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
  langSet(lang: string, rcPath: string): string;
  langRestartConfirm(): string;
  langRestart(): string;
  langRestartHint(rcPath: string): string;
  /** Result output for model add/default/vision: the argument is the already-formatted pair reference (formatModelRef). */
  modelAdded(model: string, defaultModel: string | undefined): string;
  modelUpdated(model: string, defaultModel: string | undefined): string;
  defaultModelSet(model: string): string;
  visionModelSet(model: string): string;
  modelListTitle(): string;
  modelListEmpty(): string;
  vaultSet(key: string): string;
  vaultRemoved(key: string): string;
  vaultKeyMissing(key: string): string;
  vaultListTitle(): string;
  vaultListEmpty(): string;
  /** URL prompt once the `penguin web` service is ready. */
  webReady(url: string): string;
  /** Manual-open prompt after the `penguin web` ready-poll times out (15s). */
  webTimeout(url: string): string;
}

function header(kind: "chat" | "run", agentId: string, workspace: string, model: string): string {
  return `PenguinHarness ${kind} — agent=${agentId}  workspace=${workspace}  model=${model}`;
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
    addClientType: "AgentHub client type (e.g. openai); defaults by provider group when omitted",
    addVision: "Mark the model as supporting image input (vision)",
    addNoVision: "Mark the model as NOT supporting image input; omit both to keep current",
    addPriceCacheRead: "Price per 1M tokens: cache read (USD)",
    addPriceCacheWrite: "Price per 1M tokens: cache write (USD)",
    addPriceOutput: "Price per 1M tokens: output (USD)",
    addSetDefault: "Also set as the Project default model",
    defaultDesc: "Set the Project default model",
    visionDesc: "Set the vision model used by read_image for non-vision session models",
    refModelId: "Upstream model id; forms the (provider, model_id) pair reference with --provider",
    refProvider: "Provider group of the referenced entry (see `penguin config model list`)",
    listDesc: "List the Project's models (API keys hidden)",
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
  run: { desc: "Run a single Task", message: "Prompt for this Task" },
  chat: {
    desc: "Open the interactive REPL",
    resume:
      "Resume an existing Session (defaults to the agent's most recent one); workspace and model follow the original Session",
  },
  serve: {
    serverDesc: "Start the Web service (HTTP API and the built-in frontend, same process)",
    webDesc: "Start the Web service and open the UI in a browser once it is ready",
    port: "Listen port (falls back to the PORT env var, default 7364)",
    host: "Listen address (falls back to the HOST env var, default 127.0.0.1)",
    noOpen: "Do not open a browser automatically",
  },

  header,
  chatHints: () =>
    "Type a message to start a conversation; end a line with \\; /compact to compact the context; /exit to quit; and Ctrl-C interrupts the current conversation.",
  confirmExit: () => "Exit penguin? [y/N] ",
  taskInterrupted: () => "[current conversation interrupted]",
  error: (message) => `[error] ${message}`,
  approvePrompt: () => "? Approve this tool call? [Y/n] ",
  taskStats: (s) =>
    `[stats] context ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · ${s.elapsed} (${s.elapsedDelta})`,
  abortLabel: (reason) => `[abort]${reason ? `: ${reason}` : ""}`,
  reconnectLabel: (status, attempt) =>
    `[retry] ${status === "timeout" ? "connection timed out" : "response incomplete or unparseable"}; sending retry #${attempt}…`,
  compactionStart: (mode, reason) =>
    mode === "discard"
      ? `[compaction] discarding context (${reason})…`
      : `[compaction] summarizing context (${reason})…`,
  compactionStop: (mode, status, tokens) =>
    (status === "completed"
      ? mode === "discard"
        ? "[compaction] done; old context discarded"
        : "[compaction] done; continuing with the summarized context"
      : `[compaction] ${status}; keeping the current context`) +
    (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),
  compactNothing: () => "[compaction] nothing to compact yet",
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
  langSet: (lang, rcPath) => `Language set to ${lang}; wrote PENGUIN_LANG to ${rcPath}.`,
  langRestartConfirm: () => "Open a new shell now to apply? [y/N] ",
  langRestart: () => "Opening a new shell with the new language (type exit to return)…",
  langRestartHint: (rcPath) => `Open a new terminal, or run: source ${rcPath}`,
  modelAdded: (model, def) => `Added model ${model}. Default model: ${def ?? "(unset)"}`,
  modelUpdated: (model, def) => `Updated model ${model}. Default model: ${def ?? "(unset)"}`,
  defaultModelSet: (model) => `Default model set to ${model}.`,
  visionModelSet: (model) => `Vision model set to ${model}.`,
  modelListTitle: () => "Configured models:",
  modelListEmpty: () => "No models configured yet. Add one with `penguin config model add`.",
  vaultSet: (key) => `Saved vault entry ${key}.`,
  vaultRemoved: (key) => `Removed vault entry ${key}.`,
  vaultKeyMissing: (key) => `Vault entry ${key} does not exist.`,
  vaultListTitle: () => "Vault environment variables (values masked):",
  vaultListEmpty: () => "The vault is empty. Add one with `penguin config vault set`.",
  webReady: (url) => `Web UI ready: ${url}`,
  webTimeout: (url) => `Server is not responding yet; open ${url} manually once it is ready.`,
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
    addClientType: "AgentHub 客户端协议（如 openai）；缺省按 provider 分组的语义取值",
    addVision: "标注该模型支持图片输入（视觉）",
    addNoVision: "标注该模型不支持图片输入；两者都不给则保留原值",
    addPriceCacheRead: "每百万 token 价格：缓存读取（USD）",
    addPriceCacheWrite: "每百万 token 价格：缓存写入（USD）",
    addPriceOutput: "每百万 token 价格：输出（USD）",
    addSetDefault: "同时设为该 Project 的默认模型",
    defaultDesc: "设置 Project 的默认模型",
    visionDesc: "设置 read_image 代读用的视觉模型（供不支持图片的会话模型读图）",
    refModelId: "上游模型 id；与 --provider 构成 (provider, model_id) 成对引用",
    refProvider: "引用条目的 provider 分组（见 `penguin config model list`）",
    listDesc: "列出当前 Project 的模型（API key 隐藏）",
    langDesc: "设置界面语言（en|zh）；将 PENGUIN_LANG 写入 shell 启动文件并持久化",
    langArg: "语言：en 或 zh",
    vaultDesc: "管理 Agent vault（注入该 Agent shell 命令的环境变量）",
    vaultSetDesc: "写入一个 vault 环境变量（不存在则新增，存在则覆盖）",
    vaultListDesc: "列出 vault 环境变量（值掩码显示）",
    vaultRemoveDesc: "删除一个 vault 环境变量",
    vaultKey: "变量名（字母、数字与下划线，不能以数字开头）",
    vaultValue: "变量值，写入该 Agent 的 agent_state/.vault.toml",
  },
  run: { desc: "单次运行一个 Task", message: "本次 Task 的 Prompt" },
  chat: {
    desc: "打开交互式 REPL",
    resume:
      "恢复既有 Session 继续对话（缺省恢复当前 Agent 最近一次）；Workspace 与模型沿用原 Session",
  },
  serve: {
    serverDesc: "启动 Web 服务（HTTP API 与内置前端，同一进程）",
    webDesc: "启动 Web 服务，就绪后用浏览器打开界面",
    port: "监听端口（其次取环境变量 PORT，缺省 7364）",
    host: "监听地址（其次取环境变量 HOST，缺省 127.0.0.1）",
    noOpen: "不自动打开浏览器",
  },

  header,
  chatHints: () =>
    "输入消息发起对话；行尾 \\ 续行；/compact 压缩上下文；/exit 退出；Ctrl-C 中断对话。",
  confirmExit: () => "确认退出 penguin？[y/N] ",
  taskInterrupted: () => "[已中断当前对话]",
  error: (message) => `[错误] ${message}`,
  approvePrompt: () => "? 批准此工具调用？[Y/n] ",
  taskStats: (s) =>
    `[统计信息] 上下文 ${s.context} (${s.contextDelta}) · tokens ${s.tokens} (${s.tokensDelta}) · 用时 ${s.elapsed} (${s.elapsedDelta})`,
  abortLabel: (reason) => `[已中断]${reason ? `：${reason}` : ""}`,
  reconnectLabel: (status, attempt) =>
    `[重试] ${status === "timeout" ? "连接超时或网络中断" : "响应不完整或无法解析"}，正在发起第 ${attempt} 次重试……`,
  compactionStart: (mode, reason) =>
    mode === "discard"
      ? `[压缩] 正在丢弃旧上下文（${reason}）……`
      : `[压缩] 正在总结压缩上下文（${reason}）……`,
  compactionStop: (mode, status, tokens) =>
    (status === "completed"
      ? mode === "discard"
        ? "[压缩] 完成，旧上下文已丢弃"
        : "[压缩] 完成，已切换到摘要后的新上下文"
      : `[压缩] ${status === "aborted" ? "已中断" : "失败"}，保留当前上下文`) +
    (tokens ? ` · tokens ${tokens.total} (${tokens.delta})` : ""),
  compactNothing: () => "[压缩] 当前上下文为空，无需压缩",
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
  langSet: (lang, rcPath) => `语言已设为 ${lang}；已将 PENGUIN_LANG 写入 ${rcPath}。`,
  langRestartConfirm: () => "现在打开新 shell 使其生效？[y/N] ",
  langRestart: () => "正在打开使用新语言的新 shell（输入 exit 可返回）……",
  langRestartHint: (rcPath) => `请打开新终端，或执行：source ${rcPath}`,
  modelAdded: (model, def) => `已添加模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,
  modelUpdated: (model, def) => `已更新模型 ${model}。当前默认模型：${def ?? "(未设置)"}`,
  defaultModelSet: (model) => `默认模型已设为 ${model}。`,
  visionModelSet: (model) => `视觉模型已设为 ${model}。`,
  modelListTitle: () => "已配置的模型：",
  modelListEmpty: () => "尚未配置任何模型。用 `penguin config model add` 添加。",
  vaultSet: (key) => `已保存 vault 条目 ${key}。`,
  vaultRemoved: (key) => `已删除 vault 条目 ${key}。`,
  vaultKeyMissing: (key) => `vault 条目 ${key} 不存在。`,
  vaultListTitle: () => "vault 环境变量（值已掩码）：",
  vaultListEmpty: () => "vault 为空。用 `penguin config vault set` 添加。",
  webReady: (url) => `Web 界面已就绪：${url}`,
  webTimeout: (url) => `服务尚未就绪，请稍后手动打开 ${url}。`,
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
