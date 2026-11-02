/**
 * The report a failed model request hands the person to share, and the GitHub bug form it can be
 * sent through — what the conversation's 「[详情]」 dialog shows, copies and opens.
 *
 * The report is English whatever the interface's language: it is written for the project's issue
 * tracker. It holds what a maintainer needs to tell a provider's outage from a bug here — what
 * happened (the attempts so far, of how many), the error code and the request's status, the HTTP
 * status and the request id where the provider's message names them, the provider and the model,
 * when it happened, the PenguinHarness version, how it is installed, and the OS of the machine
 * the Session runs on — then the provider's message itself.
 *
 * It never holds the API key, the provider's base URL, the prompt or any of the conversation,
 * or the Workspace's path. The provider's message is the one free text in it, so it is shown with
 * key-shaped strings redacted (`redactSecrets`) and the Workspace's path replaced; what the
 * dialog shows is exactly what would be shared.
 *
 * The bug form (`.github/ISSUE_TEMPLATE/bug_report.yml`) is opened prefilled by its field ids
 * (`title`, `summary`, `version`, `install`, `os`, `output`; a dropdown by its option's text).
 * The URL is kept under {@link ISSUE_URL_CAP} characters, well under what GitHub answers before
 * refusing a URL as too long: the provider's message is cut to fit, and says so.
 */
import { redactSecrets } from "../../lib/redact-secrets";
import { httpStatusOf, requestIdOf } from "./provider-error";

export const ISSUE_FORM_URL = "https://github.com/Prism-Shadow/penguin-harness/issues/new";
export const ISSUE_URL_CAP = 6000;

/** Where the failed request stands: the retry line's phases, and a failure that ended the run. */
export type RequestFailurePhase = "waiting" | "trying" | "retried" | "gaveUp" | "fatal";

export interface RequestFailure {
  phase: RequestFailurePhase;
  /** Requests made so far, the first included (request_end.attempt; 1 when unrecorded). */
  attempt: number;
  /** The most a turn makes (the engine's ceiling). */
  maxAttempts: number;
  /** request_end.status: `retryable`, `fatal`, or an old Trace's finer spelling. */
  status: string;
  /** request_end.error_code. */
  errorCode?: string;
  /** request_end.error_message: the provider's own words. */
  message?: string;
  /** The model the request went to. */
  model?: { provider: string; modelId: string };
  /** When the request ended (epoch ms). */
  atMs?: number;
}

/** How this PenguinHarness is installed, as the bug form's dropdown names it. */
export type InstallKind = "desktop" | "server" | "source";

const INSTALL_OPTION: Readonly<Record<InstallKind, string>> = {
  desktop: "Desktop app",
  server: "Server (penguin server / penguin web)",
  source: "From a source checkout (pnpm dev)",
};

/**
 * How the server this window talks to was installed: a build from a source checkout says so
 * whatever started it; otherwise the desktop shell's server, or a server started by hand.
 */
export function installKindOf(server: {
  channel: "release" | "source";
  desktopMode: boolean;
}): InstallKind {
  if (server.channel === "source") return "source";
  return server.desktopMode ? "desktop" : "server";
}

const PLATFORM_NAME: Readonly<Record<string, string>> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

/** A machine's OS as people name it, from a version report's runtime ("Linux (x64)"). */
export function osName(runtime: { platform: string; arch: string }): string {
  return `${PLATFORM_NAME[runtime.platform] ?? runtime.platform} (${runtime.arch})`;
}

export interface ReportEnvironment {
  /** The running build's identity (`describe`: "v0.2.18"); null while unknown. */
  version: string | null;
  install: InstallKind | null;
  /** The OS of the machine the Session runs on; null while unknown. */
  os: string | null;
  /** Set when the Session runs on another machine: that machine's own version, when known. */
  remote?: { version: string | null } | null;
  /** The Session's Workspace path, kept out of the provider's message. */
  workspace?: string | null;
}

export interface RequestReport {
  /** The report as the dialog shows it and Copy copies it. */
  markdown: string;
  /** The bug form, prefilled. */
  issueUrl: string;
}

/** What happened, in one line. */
function happened(f: RequestFailure): string {
  const n = f.attempt;
  const of = `attempt ${n} of at most ${f.maxAttempts} failed`;
  switch (f.phase) {
    case "waiting":
      return `${of}, waiting to send attempt ${n + 1}`;
    case "trying":
      return `${of}, sending attempt ${n + 1}`;
    case "retried":
      return `${of}, attempt ${n + 1} was sent`;
    case "gaveUp":
      return `${n} ${n === 1 ? "attempt" : "attempts"} failed (at most ${f.maxAttempts}), and the run ended`;
    case "fatal":
      return `an error no retry can fix ended the run${n > 1 ? ` at attempt ${n}` : ""}`;
  }
}

/** The facts as bullet lines, in the report's order; a fact nobody knows is left out. */
function facts(f: RequestFailure, env: ReportEnvironment, http: number | null, id: string | null) {
  const lines: [string, string | null][] = [
    ["What happened", happened(f)],
    ["Error code", `${f.errorCode ?? "none"} (status ${f.status})`],
    ["HTTP status", http === null ? null : String(http)],
    ["Provider", f.model?.provider ?? null],
    ["Model", f.model?.modelId ?? null],
    ["Request ID", id],
    [
      "Time (UTC)",
      f.atMs === undefined ? null : new Date(f.atMs).toISOString().replace(/\.\d+Z$/, "Z"),
    ],
    ["PenguinHarness", env.version],
    ["Installed as", env.install === null ? null : INSTALL_OPTION[env.install]],
    [
      "OS",
      env.os === null
        ? null
        : env.remote
          ? `${env.os}, the remote machine the Session runs on${env.remote.version ? ` (PenguinHarness ${env.remote.version})` : ""}`
          : env.os,
    ],
  ];
  return lines.filter((line): line is [string, string] => line[1] !== null);
}

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fenced(text: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((run) => (run[0] ?? "").length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

/** The provider's message as it may be shared: secrets out, the Workspace's path out. */
function shareable(message: string | undefined, keep: string | null, workspace?: string | null) {
  if (message === undefined || message.trim() === "") return null;
  let text = redactSecrets(message, keep === null ? [] : [keep]);
  if (workspace) text = text.split(workspace).join("<workspace>");
  return text;
}

const TRUNCATED = "\n… (cut short to fit the link; the full message is in the copied report)";

function query(fields: readonly [string, string | null][]): string {
  return fields
    .filter((field): field is [string, string] => field[1] !== null && field[1] !== "")
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
}

/** The bug form's URL, its `output` cut until the whole fits under the cap. */
function issueUrl(base: readonly [string, string | null][], output: string): string {
  const head = `${ISSUE_FORM_URL}?${query(base)}`;
  const whole = `${head}&output=${encodeURIComponent(output)}`;
  if (whole.length <= ISSUE_URL_CAP) return whole;
  // The longest beginning of the message whose encoded form still fits beside the note.
  const room = ISSUE_URL_CAP - head.length - "&output=".length;
  let low = 0;
  let high = output.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (encodeURIComponent(output.slice(0, mid) + TRUNCATED).length <= room) low = mid;
    else high = mid - 1;
  }
  return `${head}&output=${encodeURIComponent(output.slice(0, low) + TRUNCATED)}`;
}

export function requestFailureReport(f: RequestFailure, env: ReportEnvironment): RequestReport {
  const http = httpStatusOf(f.message);
  const id = requestIdOf(f.message);
  const message = shareable(f.message, id, env.workspace);
  const lines = facts(f, env, http, id).map(([name, value]) => `- ${name}: ${value}`);
  const markdown = [
    "### PenguinHarness model request failure",
    "",
    ...lines,
    "",
    "Provider message:",
    "",
    message === null ? "(the provider sent no message)" : fenced(message),
  ].join("\n");
  const model = f.model ? ` (${f.model.provider} / ${f.model.modelId})` : "";
  const title = `Model request failed: ${f.errorCode ?? f.status}${http === null ? "" : `, HTTP ${http}`}${model}`;
  const summary = ["A model request failed in a conversation.", "", ...lines].join("\n");
  return {
    markdown,
    issueUrl: issueUrl(
      [
        ["template", "bug_report.yml"],
        ["title", title],
        ["summary", summary],
        ["version", env.version],
        ["install", env.install === null ? null : INSTALL_OPTION[env.install]],
        ["os", env.os],
      ],
      message ?? "(the provider sent no message)",
    ),
  };
}
