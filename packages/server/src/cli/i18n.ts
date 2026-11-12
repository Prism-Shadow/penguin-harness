/**
 * The CLI's text internationalization (i18n), hosted by the server package: the host's
 * own groups live below; every contribution's groups spread in from its message file.
 *
 * Language comes from the `PENGUIN_LANG` env var (`en` / `zh`), defaulting to English (en) —
 * independent of Project config or CLI options. This module centralizes all user-visible text:
 * command/option help descriptions and runtime output, one implementation per language.
 */

import type { SessionRuntimeText } from "./session-runtime.messages.js";
import { sessionruntimeEn } from "./session-runtime.messages.js";
import { sessionruntimeZh } from "./session-runtime.messages.js";
import type { RenderText } from "./render.messages.js";
import { renderEn } from "./render.messages.js";
import { renderZh } from "./render.messages.js";
import type { AgentText } from "./commands/agent.messages.js";
import { agentEn } from "./commands/agent.messages.js";
import { agentZh } from "./commands/agent.messages.js";
import type { AuthText } from "./commands/auth.messages.js";
import { authEn } from "./commands/auth.messages.js";
import { authZh } from "./commands/auth.messages.js";
import type { ChatText } from "./commands/chat.messages.js";
import { chatEn } from "./commands/chat.messages.js";
import { chatZh } from "./commands/chat.messages.js";
import type { ConfigText } from "./commands/config.messages.js";
import { configEn } from "./commands/config.messages.js";
import { configZh } from "./commands/config.messages.js";
import type { CostText } from "./commands/cost.messages.js";
import { costEn } from "./commands/cost.messages.js";
import { costZh } from "./commands/cost.messages.js";
import type { ExecText } from "./commands/exec.messages.js";
import { execEn } from "./commands/exec.messages.js";
import { execZh } from "./commands/exec.messages.js";
import type { InputText } from "./commands/input.messages.js";
import { inputEn } from "./commands/input.messages.js";
import { inputZh } from "./commands/input.messages.js";
import type { LogText } from "./commands/log.messages.js";
import { logEn } from "./commands/log.messages.js";
import { logZh } from "./commands/log.messages.js";
import type { LsText } from "./commands/ls.messages.js";
import { lsEn } from "./commands/ls.messages.js";
import { lsZh } from "./commands/ls.messages.js";
import type { PluginText } from "./commands/plugin.messages.js";
import { pluginEn } from "./commands/plugin.messages.js";
import { pluginZh } from "./commands/plugin.messages.js";
import type { ProjectText } from "./commands/project.messages.js";
import { projectEn } from "./commands/project.messages.js";
import { projectZh } from "./commands/project.messages.js";
import type { ResetPasswordText } from "./commands/reset-password.messages.js";
import { resetpasswordEn } from "./commands/reset-password.messages.js";
import { resetpasswordZh } from "./commands/reset-password.messages.js";
import type { RunText } from "./commands/run.messages.js";
import { runEn } from "./commands/run.messages.js";
import { runZh } from "./commands/run.messages.js";
import type { ServeText } from "./commands/serve.messages.js";
import { serveEn } from "./commands/serve.messages.js";
import { serveZh } from "./commands/serve.messages.js";
import type { SessionText } from "./commands/session.messages.js";
import { sessionEn } from "./commands/session.messages.js";
import { sessionZh } from "./commands/session.messages.js";
import type { ScheduleText } from "./commands/schedule.messages.js";
import { scheduleEn } from "./commands/schedule.messages.js";
import { scheduleZh } from "./commands/schedule.messages.js";
import type { UpdateText } from "./commands/update.messages.js";
import { updateEn } from "./commands/update.messages.js";
import { updateZh } from "./commands/update.messages.js";
import type { VersionText } from "./commands/version.messages.js";
import { versionEn } from "./commands/version.messages.js";
import { versionZh } from "./commands/version.messages.js";
import type { BrowserText } from "./commands/browser.messages.js";
import { browserEn } from "./commands/browser.messages.js";
import { browserZh } from "./commands/browser.messages.js";
import type { OrgText } from "./commands/org.messages.js";
import { orgEn } from "./commands/org-en.messages.js";
import { orgZh } from "./commands/org-zh.messages.js";

import type { CliCommandMessages } from "@prismshadow/penguin-core/cli";
import { DEFAULT_CHAT_THINKING_LEVELS } from "@prismshadow/penguin-core";

/**
 * The selectable thinking tiers as each language lists them, built from the list the flag and
 * /thinking validate against, so the printed ladder is always the accepted one (#322).
 */
const listLevels = (separator: string, last: string): string =>
  `${DEFAULT_CHAT_THINKING_LEVELS.slice(0, -1).join(separator)}${last}${DEFAULT_CHAT_THINKING_LEVELS.at(-1)}`;
const EN_LEVELS = listLevels(", ", ", or ");
const ZH_LEVELS = listLevels("、", " 或 ");
const LEVEL_CHOICES = DEFAULT_CHAT_THINKING_LEVELS.join("|");

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

/**
 * The whole CLI message table, composed from the per-contribution files: the host's own
 * groups below, every contribution's groups spread in from its message file.
 */
export interface Messages
  extends
    SessionRuntimeText,
    RenderText,
    AgentText,
    AuthText,
    ChatText,
    ConfigText,
    CostText,
    ExecText,
    InputText,
    LogText,
    LsText,
    PluginText,
    ProjectText,
    ResetPasswordText,
    RunText,
    ServeText,
    SessionText,
    ScheduleText,
    UpdateText,
    VersionText,
    BrowserText,
    OrgText,
    CliCommandMessages {
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
    /** --timeout: soft-yield wait budget on run / session input / session log -f (30s / 5m / 2h / bare seconds). */
    timeout: string;
    /** The session group's --agent-id: whose most recent session the omitted session argument means. */
    latestAgentId: string;
    /** run's --title and session rename's -t/--title: empty or over `max` characters once whitespace is collapsed. */
    titleInvalid(length: number, max: number): string;
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
    /** Dim stderr note naming the session a bare `session log` / `input` / `rename` resolved to (the agent's most recent). */
    latestSession(sessionId: string): string;
    /** Bare `session log` / `input` / `rename` when the agent has no session at all: what to run to get one. */
    noSessionsYet(agentId: string, projectId: string): string;
  };
  error(message: string): string;
}

const en: Messages = {
  language: "en",
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
    thinking: `Thinking level for this session: ${EN_LEVELS} (defaults to the Agent's configured level)`,
    json: "Print raw JSON instead of the rendered output",
    server:
      "Server URL to connect to (defaults to PENGUIN_API_URL, then the local running server, then auto-start)",
    timeout:
      "Wait at most this long (30s / 5m / 2h, or bare seconds), then detach and leave the task running (exit 0)",
    latestAgentId: "Agent whose most recent session is used when no session id is given",
    titleInvalid: (length, max) => `--title must be 1–${max} characters (got ${length}).`,
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
      `No session matching "${ref}" in project ${projectId} (try \`penguin session ls\`).`,
    sessionAmbiguous: (ref, candidates) =>
      `"${ref}" matches ${candidates.length} sessions:\n  ${candidates.join("\n  ")}\nUse a longer fragment or the full id.`,
    streamLost: (detail) => `Lost the server stream and reconnecting failed: ${detail}`,
    streamResynced: () =>
      "[stream] reconnected past the server's replay buffer; some output may be missing here (penguin session log shows the full history)",
    timeoutInvalid: (value) =>
      `Invalid --timeout value "${value}": expected 30s, 5m, 2h, or a bare number of seconds.`,
    stillRunning: (shortId) =>
      `[still running] session ${shortId} continues on the server — follow with \`penguin session log -f ${shortId}\` or poll with \`penguin session input ${shortId}\``,
    callerDefaultsFailed: (sessionId) =>
      `[caller context] could not read calling session ${sessionId}; using the plain defaults`,
    latestSession: (sessionId) => `[latest] session ${sessionId}`,
    noSessionsYet: (agentId, projectId) =>
      `Agent ${agentId} has no sessions in project ${projectId} yet: start one with \`penguin run -m "..."\` or \`penguin chat\`.`,
  },
  error: (message) => `[error] ${message}`,
  ...sessionruntimeEn,
  ...renderEn,
  ...agentEn,
  ...authEn,
  ...chatEn,
  ...configEn,
  ...costEn,
  ...execEn,
  ...inputEn,
  ...logEn,
  ...lsEn,
  ...pluginEn,
  ...projectEn,
  ...resetpasswordEn,
  ...runEn,
  ...serveEn,
  ...sessionEn,
  ...scheduleEn,
  ...updateEn,
  ...versionEn,
  ...browserEn,
  org: orgEn.org,
};

const zh: Messages = {
  language: "zh",
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
    thinking: `本会话的思考等级：${ZH_LEVELS}（缺省用 Agent 配置的等级）`,
    json: "输出原始 JSON，不做渲染",
    server: "要连接的服务器地址（缺省依次取 PENGUIN_API_URL、本机运行中的服务器、自动拉起）",
    timeout:
      "最长等待时长（30s / 5m / 2h，或纯数字秒数）；到时脱开、任务继续在服务端运行（退出码 0）",
    latestAgentId: "省略 session id 时，取哪个 Agent 的最近一次会话",
    titleInvalid: (length, max) => `--title 须为 1–${max} 个字符（实际 ${length} 个）。`,
  },
  usage: {
    missingArgument: (name) => `缺少必填参数 <${name}>`,
    missingOption: (flags) => `缺少必填选项 ${flags}`,
    optionMissingArgument: (flags) => `选项 ${flags} 缺少取值`,
    unknownOption: (flag) => `未知选项 ${flag}`,
    unknownCommand: (name) => `未知命令 ${name}`,
    other: (detail) => detail,
    hint: (command, usage) =>
      `用法：${command} ${usage}（运行 \`${command} --help\` 查看全部选项）`,
  },
  client: {
    invalidServerUrl: (value) => `服务器地址「${value}」无效：应为 http(s)://host[:port]。`,
    remoteNeedsToken: (url) =>
      `${url} 不是本机：连接远端服务器须设置 PENGUIN_API_TOKEN（本机的 api-token 文件不会发往其它主机）。`,
    noServer: () => "该数据根目录没有正在运行的服务器。",
    autoStartUnavailable: () =>
      "没有正在运行的服务器，且当前 CLI 入口无法自动拉起（开发态运行）。请自行执行 `penguin server`。",
    autoStartFailed: (logPath) => `自动启动的服务器未能就绪，输出见 ${logPath}。`,
    autoStarted: (url, logPath) => `已在本机启动服务器 ${url}（日志：${logPath}）。`,
    noToken: (url, tokenPath) =>
      `${url} 拒绝了请求（401），且没有可用的 API token：请设置 PENGUIN_API_TOKEN，或确认服务器的 token 文件可读（${tokenPath}）。`,
    authFailed: (url) =>
      `${url} 拒绝了 API token（401）。服务器重启会轮换 token——检查 PENGUIN_API_TOKEN，或让 CLI 读取最新的 api-token 文件。`,
    httpError: (status, code, message) =>
      `服务器错误 ${status}（${code}）${message ? `：${message}` : ""}`,
    sessionNotFound: (ref, projectId) =>
      `Project ${projectId} 中没有匹配「${ref}」的会话（可用 \`penguin session ls\` 查看）。`,
    sessionAmbiguous: (ref, candidates) =>
      `「${ref}」匹配到 ${candidates.length} 个会话：\n  ${candidates.join("\n  ")}\n请使用更长的片段或完整 id。`,
    streamLost: (detail) => `与服务器的输出流断开且重连失败：${detail}`,
    streamResynced: () =>
      "[stream] 重连时已超出服务端回放缓冲，此处可能缺少部分输出（penguin session log 可查看完整历史）",
    timeoutInvalid: (value) => `--timeout 值「${value}」无效：应为 30s、5m、2h 或纯数字秒数。`,
    stillRunning: (shortId) =>
      `[仍在运行] 会话 ${shortId} 继续在服务端执行——可用 \`penguin session log -f ${shortId}\` 跟随，或 \`penguin session input ${shortId}\` 轮询`,
    callerDefaultsFailed: (sessionId) =>
      `[调用方上下文] 无法读取调用方会话 ${sessionId}，改用普通缺省值`,
    latestSession: (sessionId) => `[latest] 会话 ${sessionId}`,
    noSessionsYet: (agentId, projectId) =>
      `Agent ${agentId} 在 Project ${projectId} 下还没有任何会话：先用 \`penguin run -m "..."\` 或 \`penguin chat\` 开始一个。`,
  },
  error: (message) => `[错误] ${message}`,
  ...sessionruntimeZh,
  ...renderZh,
  ...agentZh,
  ...authZh,
  ...chatZh,
  ...configZh,
  ...costZh,
  ...execZh,
  ...inputZh,
  ...logZh,
  ...lsZh,
  ...pluginZh,
  ...projectZh,
  ...resetpasswordZh,
  ...runZh,
  ...serveZh,
  ...sessionZh,
  ...scheduleZh,
  ...updateZh,
  ...versionZh,
  ...browserZh,
  org: orgZh.org,
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
