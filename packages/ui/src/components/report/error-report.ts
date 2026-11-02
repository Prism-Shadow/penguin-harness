/**
 * A problem report: what the app hands a person to share when something went wrong that they did
 * not cause — a request the provider failed, an action the server could not finish, a page that
 * crashed — and the project's GitHub bug form it can be sent through.
 *
 * A report is written in English whatever the interface's language: it is read on the issue
 * tracker. The caller says what happened as a few named facts and, optionally, one raw text the
 * report ends with (a provider's message, an exception and its stack); the host's environment
 * adds where it ran — the PenguinHarness version, how it is installed and the OS — so every
 * report carries them without its caller knowing them.
 *
 * It never carries what the person did not mean to share. The caller passes no key, prompt,
 * conversation text or base URL; the facts and the raw text are redacted before anything is shown
 * (`redactSecrets`, `redactHomePaths`), and the paths the caller names private (the Workspace) are
 * replaced with `<workspace>`. What the dialog shows is exactly what Copy copies and the link
 * sends; nothing leaves the app until the person presses one of them.
 *
 * The bug form (`.github/ISSUE_TEMPLATE/bug_report.yml`) is opened with the fields it requires
 * filled — `summary`, the facts; `system-info`, the environment, "unknown" for a line not read
 * yet — and `title` and `output`, so it can be submitted as it opens. The link is kept under
 * {@link ISSUE_URL_CAP} characters, well under the length GitHub refuses: the raw text is cut to
 * fit, and says so.
 */
import type { ReactNode } from "react";
import { redactHomePaths, redactSecrets } from "./redact";

export const ISSUE_FORM_URL = "https://github.com/Prism-Shadow/penguin-harness/issues/new";
export const ISSUE_URL_CAP = 6000;

/** How this PenguinHarness is installed. */
export type InstallKind = "desktop" | "server" | "source";

const INSTALL_LABEL: Readonly<Record<InstallKind, string>> = {
  desktop: "Desktop app",
  server: "Server (penguin server / penguin web)",
  source: "From a source checkout (pnpm dev)",
};

/**
 * How the server a window talks to was installed: a build from a source checkout says so
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

/** Where the problem happened, as the host knows it; null for a fact not read yet. */
export interface ReportEnvironment {
  /** The running build's identity ("v0.2.18"). */
  version: string | null;
  install: InstallKind | null;
  /** The OS of the machine involved. */
  os: string | null;
  /** Set when that machine is not the one serving the window: its own version, when known. */
  remote?: { version: string | null } | null;
}

export const UNKNOWN_ENVIRONMENT: ReportEnvironment = { version: null, install: null, os: null };

/** One fact of a report: its name and its value, in English. */
export type ReportFact = readonly [name: string, value: string];

export interface ErrorReport {
  /** The report's first line ("PenguinHarness model request failure"). */
  heading: string;
  /** The issue's title. */
  title: string;
  /** The issue summary's opening sentence, before the facts. */
  intro: string;
  /** What happened, as named facts. */
  facts: readonly ReportFact[];
  /** The raw text the report ends with, under its label; `missing` stands in when there is none. */
  output?: { label: string; text: string | null; missing: string } | null;
  /** Strings that look random but are safe to share and useful (a provider's request id). */
  keep?: readonly string[];
  /** Paths to keep out of the report, replaced with `<workspace>` (the Session's Workspace). */
  privatePaths?: readonly string[];
  /** Facts about where it ran that the host's environment does not know (another machine's OS). */
  environment?: Partial<ReportEnvironment>;
  /** The dialog's title and lead in place of the shared ones (a provider failure's own words). */
  dialog?: { title?: string; lead?: ReactNode };
}

export interface BuiltReport {
  /** The report as the dialog shows it and Copy copies it. */
  markdown: string;
  /** The bug form, prefilled. */
  issueUrl: string;
}

/** The OS fact: the machine's, and whose it is when it is not the one serving the window. */
function osLine(env: ReportEnvironment): string | null {
  if (env.os === null) return null;
  if (!env.remote) return env.os;
  const version = env.remote.version ? ` (PenguinHarness ${env.remote.version})` : "";
  return `${env.os}, the remote machine the Session runs on${version}`;
}

/** A fence longer than any run of backticks in the text, so the text cannot close it. */
function fenced(text: string): string {
  const runs = [...text.matchAll(/`+/g)].map((run) => (run[0] ?? "").length);
  const fence = "`".repeat(Math.max(2, ...runs) + 1);
  return `${fence}text\n${text}\n${fence}`;
}

const TRUNCATED = "\n… (cut short to fit the link; the full text is in the copied report)";

function query(fields: readonly [string, string][]): string {
  return fields.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
}

/** The bug form's URL, its `output` cut until the whole fits under the cap. */
function issueUrl(base: readonly [string, string][], output: string): string {
  const head = `${ISSUE_FORM_URL}?${query(base)}`;
  const whole = `${head}&output=${encodeURIComponent(output)}`;
  if (whole.length <= ISSUE_URL_CAP) return whole;
  // The longest beginning of the text whose encoded form still fits beside the note.
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

/** The report and its link, in the host's environment with the report's own facts over it. */
export function buildReport(report: ErrorReport, host: ReportEnvironment): BuiltReport {
  const env: ReportEnvironment = { ...host, ...report.environment };
  const keep = report.keep ?? [];
  const shareable = (text: string): string => {
    let out = redactSecrets(text, keep);
    for (const path of report.privatePaths ?? []) {
      if (path !== "") out = out.split(path).join("<workspace>");
    }
    return redactHomePaths(out);
  };
  const facts = report.facts.map(([name, value]) => `- ${name}: ${shareable(value)}`);
  const environment: [string, string | null][] = [
    ["PenguinHarness", env.version],
    ["Installed as", env.install === null ? null : INSTALL_LABEL[env.install]],
    ["OS", osLine(env)],
  ];
  const known = environment
    .filter((line): line is [string, string] => line[1] !== null)
    .map(([name, value]) => `- ${name}: ${value}`);
  const raw = report.output?.text?.trim() ? shareable(report.output.text) : null;
  const tail =
    report.output == null
      ? []
      : ["", `${report.output.label}:`, "", raw === null ? report.output.missing : fenced(raw)];
  const markdown = [`### ${report.heading}`, "", ...facts, ...known, ...tail].join("\n");
  const systemInfo = environment.map(([name, value]) =>
    name === "PenguinHarness" ? `Version: ${value ?? "unknown"}` : `${name}: ${value ?? "unknown"}`,
  );
  return {
    markdown,
    issueUrl: issueUrl(
      [
        ["template", "bug_report.yml"],
        ["title", shareable(report.title)],
        ["summary", [report.intro, "", ...facts].join("\n")],
        ["system-info", systemInfo.join("\n")],
      ],
      raw ?? report.output?.missing ?? "(none)",
    ),
  };
}
