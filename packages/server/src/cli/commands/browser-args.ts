/**
 * `penguin browser`'s argument parsing and small helpers, split from the command's registration
 * half (commands/browser.ts): connection setup, the error shapes, option parsing, stdin and file
 * handling. Pure of commander; the registration half composes them.
 */
import fs from "node:fs";
import path from "node:path";
import type { BuiltinBrowserImportSourcesResponse } from "../../api/types.js";
import { ApiError, ServerClient } from "../client.js";
import { resolveConnection } from "../connection.js";
import type { Messages } from "../i18n.js";

export const BASE = "/api/builtin-browser";
export const enc = encodeURIComponent;
/** An implicit stdin (no `-`) that yields nothing this long is taken as "no script given". */
export const STDIN_GRACE_MS = 1000;

/** A failure found before or around a request, reported like an API error. */
export class BrowserCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface CommonOpts {
  json?: boolean;
  server?: string;
  tab?: string;
}

// ---------------------------------------------------------------------------
// Connection, errors, arguments
// ---------------------------------------------------------------------------

export async function connect(opts: CommonOpts, t: Messages): Promise<ServerClient> {
  try {
    return new ServerClient(
      await resolveConnection({ server: opts.server, autoStart: false }, t),
      t,
    );
  } catch (err) {
    // No server on this data root: the desktop app, whose server hosts the browser, is not running.
    if (err instanceof Error && err.message === t.client.noServer()) {
      throw new BrowserCliError("browser_unavailable", t.browser.unavailableHint(undefined));
    }
    throw err;
  }
}

/** Runs an action, turning whatever it throws into the one error line and exit code 1. */
export function action<A extends unknown[]>(
  t: Messages,
  run: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args) => {
    try {
      await run(...args);
    } catch (err) {
      const { code, message } = describeError(err, t);
      process.stderr.write(`${t.browser.errorLine(code, message.replace(/\s+/g, " ").trim())}\n`);
      process.exitCode = 1;
    }
  };
}

export function describeError(err: unknown, t: Messages): { code: string; message: string } {
  if (err instanceof BrowserCliError) return { code: err.code, message: err.message };
  if (err instanceof ApiError) {
    // The repo's `{error: {code, message}}`, and the flat `{error: code, message, reason}` too.
    const body = (err.body ?? {}) as { error?: unknown; message?: unknown; reason?: unknown };
    const nested =
      typeof body.error === "object" && body.error !== null
        ? (body.error as { message?: unknown; reason?: unknown })
        : {};
    const code = typeof body.error === "string" ? body.error : err.code;
    // A 401's own words are the CLI's (they name the token to check); otherwise the server's.
    const own = [nested.message, body.message].find((m) => typeof m === "string" && m !== "");
    if (code === "browser_unavailable") {
      // A reason the CLI words with what to tell the user; without one (the user paused the
      // extension, the link dropped mid-call) the server's own words say it.
      const reason = nested.reason ?? body.reason;
      if (typeof reason === "string") return { code, message: t.browser.unavailableHint(reason) };
      return {
        code,
        message: typeof own === "string" ? own : t.browser.unavailableHint(undefined),
      };
    }
    // Import and history asked of the user's Chrome (405): what to do instead.
    if (code === "not_supported") return { code, message: t.browser.notSupported() };
    return { code, message: err.status !== 401 && typeof own === "string" ? own : err.message };
  }
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: "request_failed",
    message: typeof cause === "string" ? `${message} (${cause})` : message,
  };
}

export const invalid = (message: string): BrowserCliError =>
  new BrowserCliError("invalid_argument", message);

/** `--tab` / a tab positional: a numeric id or `active` (the default). */
export function tabRef(raw: string | undefined, t: Messages): string {
  const value = raw?.trim() ?? "";
  if (value === "" || value === "active") return "active";
  if (/^\d+$/.test(value)) return value;
  throw invalid(t.browser.tabInvalid(value));
}

export function positiveInt(flag: string, raw: string, t: Messages): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value <= 0) {
    throw invalid(t.browser.positiveInt(flag, raw));
  }
  return value;
}

/** `--index`: which match of the selector, counting from 0. */
export function parseIndex(raw: string, t: Messages): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
    throw invalid(t.browser.indexInvalid(raw));
  }
  return value;
}

/**
 * A URL as typed. One naming no scheme goes as it is: the server gives it one the way the
 * address bar does (https, or http for this machine's own servers such as `localhost:5173`).
 */
export function normalizeUrl(raw: string): string {
  return raw.trim();
}

/** The calling session (PENGUIN_SESSION_ID), for a request body. */
export function session(): { sessionId?: string } {
  const id = process.env.PENGUIN_SESSION_ID?.trim();
  return id ? { sessionId: id } : {};
}

/** The same for the query of a GET or DELETE: `?sessionId=…` (or `&` after a query), or nothing. */
export function sessionQuery(joiner: "?" | "&" = "?"): string {
  const { sessionId } = session();
  return sessionId === undefined ? "" : `${joiner}sessionId=${enc(sessionId)}`;
}

export function print(text: string): void {
  process.stdout.write(text);
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

// ---------------------------------------------------------------------------
// The script of `exec`
// ---------------------------------------------------------------------------

/**
 * The script, from exactly one source: the argument, `--file`, or stdin — read when the argument
 * is `-`, or when there is no argument and stdin is not a terminal (a heredoc or a pipe, which
 * spares a model all escaping). An implicit stdin that stays silent is "no script": a caller
 * whose stdin is an idle pipe gets the error instead of a hang.
 */
export async function resolveScript(
  arg: string | undefined,
  file: string | undefined,
  t: Messages,
): Promise<string> {
  if (file !== undefined && arg !== undefined) throw invalid(t.browser.scriptSources());
  let script: string | null;
  if (file !== undefined) {
    try {
      script = fs.readFileSync(file, "utf8");
    } catch (err) {
      throw new BrowserCliError("io_error", t.browser.fileUnreadable(file, errorText(err)));
    }
  } else if (arg === "-") {
    script = await readStdin();
  } else if (arg !== undefined) {
    script = arg;
  } else if (process.stdin.isTTY !== true) {
    script = await readStdin(STDIN_GRACE_MS);
    if (script === null || script.trim() === "") throw invalid(t.browser.scriptMissing());
  } else {
    throw invalid(t.browser.scriptMissing());
  }
  if (script === null || script.trim() === "") throw invalid(t.browser.scriptEmpty());
  return script;
}

/** All of stdin; null when `graceMs` passes before its first byte (or its end). */
export function readStdin(graceMs?: number): Promise<string | null> {
  const stdin = process.stdin;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
    };
    const onData = (chunk: Buffer | string): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    };
    const onEnd = (): void => {
      finish();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (err: Error): void => {
      finish();
      reject(err);
    };
    if (graceMs !== undefined) {
      timer = setTimeout(() => {
        finish();
        // Nothing came: let go of stdin so the process can exit.
        stdin.destroy();
        resolve(null);
      }, graceMs);
    }
    stdin.on("data", onData);
    stdin.once("end", onEnd);
    stdin.once("error", onError);
    stdin.resume();
  });
}

/**
 * `--save`: the whole value to a file — a string as-is, anything else as indented JSON — and the
 * absolute path back for the `[saved to …]` note.
 */
export function saveValue(file: string, value: unknown, t: Messages): string {
  const target = path.resolve(file);
  const content =
    value === undefined
      ? ""
      : typeof value === "string"
        ? value
        : `${JSON.stringify(value, null, 2)}\n`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  } catch (err) {
    throw new BrowserCliError("io_error", t.browser.fileUnwritable(target, errorText(err)));
  }
  return target;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Other argument shapes
// ---------------------------------------------------------------------------

/** `--at x,y`: two numbers in CSS pixels. */
export function parsePoint(raw: string, t: Messages): { x: number; y: number } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (m === null) throw invalid(t.browser.atInvalid(raw));
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** `--params`: a JSON object. */
export function parseParams(raw: string, t: Messages): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw invalid(t.browser.paramsInvalid());
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalid(t.browser.paramsInvalid());
  }
  return value as Record<string, unknown>;
}

/**
 * `--timeout` duration parsing, the CLI's duration.ts contract (`30s`, `5m`, `2h`, or a bare
 * non-negative integer of seconds); null when the shape is not one of them.
 */
function parseDurationMs(raw: string): number | null {
  const m = /^(\d+)([smh])?$/.exec(raw.trim());
  if (m === null) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  const unit = m[2] ?? "s";
  return n * (unit === "s" ? 1000 : unit === "m" ? 60_000 : 3_600_000);
}

/** `--timeout`: 30s / 2m / bare seconds, more than zero. */
export function parseTimeout(raw: string, t: Messages): number {
  const ms = parseDurationMs(raw);
  if (ms === null || ms === 0) throw invalid(t.client.timeoutInvalid(raw));
  return ms;
}

/** Commander collector for a repeatable option; a value may also list several, comma-separated. */
export function collect(value: string, previous: string[]): string[] {
  return [
    ...previous,
    ...value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== ""),
  ];
}

/**
 * `import --from`: a source id as `--list` prints it, or a browser, which means its Default
 * profile — or its only one.
 */
export async function resolveSource(
  client: ServerClient,
  from: string,
  t: Messages,
): Promise<string> {
  if (from.includes(":")) return from;
  const { sources } = await client.request<BuiltinBrowserImportSourcesResponse>(
    "GET",
    `${BASE}/import/sources${sessionQuery()}`,
  );
  const browser = from.trim().toLowerCase();
  const matching = sources.filter((s) => s.browser === browser);
  if (matching.length === 0) {
    const known = [...new Set(sources.map((s) => s.browser))];
    throw new BrowserCliError("source_not_found", t.browser.sourceNotFound(from, known));
  }
  const chosen =
    matching.length === 1 ? matching[0] : matching.find((s) => s.profile === "Default");
  if (chosen === undefined) {
    const ids = matching.map((s) => s.id);
    throw invalid(t.browser.sourceAmbiguous(from, ids));
  }
  return chosen.id;
}

/** `yyyymmdd-hhmmss` in local time, for a default file name. */
export function fileStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** A PNG's pixel size from its IHDR chunk, or null when the bytes are not a PNG. */
export function pngSize(png: Buffer): string | null {
  const signature = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) return null;
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}
