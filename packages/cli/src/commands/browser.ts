/**
 * `penguin browser` — the desktop app's built-in browser, a thin client over
 * /api/builtin-browser in the shape of GenericAgent's web_scan / web_execute_js tools:
 *
 *   penguin browser status | tabs
 *   penguin browser open <url> [--new-tab] | switch <tab-id> | close [<tab-id>]
 *   penguin browser scan [--text] [--max-chars <n>]
 *   penguin browser exec [<script> | -] [--file <f>] [--save <f>] [--no-monitor] [--timeout <s>]
 *   penguin browser click <selector> [--index <n>] | click --at <x>,<y>
 *   penguin browser type <text> [--selector <css>] [--submit]
 *   penguin browser screenshot [-o <file.png>] [--full-page]
 *   penguin browser cdp <Domain.method> [--params <json>]
 *   penguin browser import --list | --from <source-id|browser> [--cookies] [--history] [--domain <d>]...
 *   penguin browser history [<query>] [-n <count>]
 *
 * Every command takes `--json` (the response DTO as one line) and `--server`; the commands that
 * act on a page take `--tab <id|active>`, `active` by default. Inside a session,
 * PENGUIN_SESSION_ID travels as `sessionId`, so the app can show which conversation is driving
 * the browser. What is printed is browser-output.ts; an error is one line on stderr,
 * `error: <code>: <message>`, with exit code 1.
 *
 * The CLI never auto-starts a server for these commands: the browser lives in the desktop app,
 * and a server started here would have no desktop shell to host it.
 * Docs: /docs/cli § "penguin browser".
 */
import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import type {
  BuiltinBrowserExecResult,
  BuiltinBrowserHistoryResponse,
  BuiltinBrowserImportResult,
  BuiltinBrowserImportSourcesResponse,
  BuiltinBrowserScanResult,
  BuiltinBrowserScreenshot,
  BuiltinBrowserStatus,
  BuiltinBrowserTab,
  BuiltinBrowserTabsResponse,
} from "@prismshadow/penguin-server/api";
import {
  renderCdpResult,
  renderExec,
  renderHistory,
  renderImportResult,
  renderImportSources,
  renderScan,
  renderStatus,
  renderTabs,
  tabHead,
} from "../browser-output.js";
import { ApiError, resolveConnection, ServerClient } from "../client.js";
import { parseDurationMs } from "../duration.js";
import type { Messages } from "../i18n.js";

const BASE = "/api/builtin-browser";
const enc = encodeURIComponent;
/** An implicit stdin (no `-`) that yields nothing this long is taken as "no script given". */
const STDIN_GRACE_MS = 1000;

/** A failure found before or around a request, reported like an API error. */
class BrowserCliError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface CommonOpts {
  json?: boolean;
  server?: string;
  tab?: string;
}

// ---------------------------------------------------------------------------
// Connection, errors, arguments
// ---------------------------------------------------------------------------

async function connect(opts: CommonOpts, t: Messages): Promise<ServerClient> {
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
function action<A extends unknown[]>(
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

function describeError(err: unknown, t: Messages): { code: string; message: string } {
  if (err instanceof BrowserCliError) return { code: err.code, message: err.message };
  if (err instanceof ApiError) {
    // The repo's `{error: {code, message}}`, and the flat `{error: code, message, reason}` too.
    const body = (err.body ?? {}) as { error?: unknown; message?: unknown; reason?: unknown };
    const nested =
      typeof body.error === "object" && body.error !== null
        ? (body.error as { message?: unknown; reason?: unknown })
        : {};
    const code = typeof body.error === "string" ? body.error : err.code;
    if (code === "browser_unavailable") {
      const reason = nested.reason ?? body.reason;
      return {
        code,
        message: t.browser.unavailableHint(typeof reason === "string" ? reason : undefined),
      };
    }
    // A 401's own words are the CLI's (they name the token to check); otherwise the server's.
    const own = [nested.message, body.message].find((m) => typeof m === "string" && m !== "");
    return { code, message: err.status !== 401 && typeof own === "string" ? own : err.message };
  }
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code;
  const message = err instanceof Error ? err.message : String(err);
  return {
    code: "request_failed",
    message: typeof cause === "string" ? `${message} (${cause})` : message,
  };
}

const invalid = (message: string): BrowserCliError =>
  new BrowserCliError("invalid_argument", message);

/** `--tab` / a tab positional: a numeric id or `active` (the default). */
function tabRef(raw: string | undefined, t: Messages): string {
  const value = raw?.trim() ?? "";
  if (value === "" || value === "active") return "active";
  if (/^\d+$/.test(value)) return value;
  throw invalid(t.browser.tabInvalid(value));
}

function positiveInt(flag: string, raw: string, t: Messages): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value <= 0) {
    throw invalid(t.browser.positiveInt(flag, raw));
  }
  return value;
}

/** `--index`: which match of the selector, counting from 0. */
function parseIndex(raw: string, t: Messages): number {
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
    throw invalid(t.browser.indexInvalid(raw));
  }
  return value;
}

/** A URL as typed: one naming no scheme is a host, so it gets https://. */
function normalizeUrl(raw: string): string {
  const url = raw.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(about|data|blob):/i.test(url)
    ? url
    : `https://${url}`;
}

/** The calling session (PENGUIN_SESSION_ID), for the bodies that accept one. */
function session(): { sessionId?: string } {
  const id = process.env.PENGUIN_SESSION_ID?.trim();
  return id ? { sessionId: id } : {};
}

function print(text: string): void {
  process.stdout.write(text);
}

function printJson(value: unknown): void {
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
async function resolveScript(
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
function readStdin(graceMs?: number): Promise<string | null> {
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
function saveValue(file: string, value: unknown, t: Messages): string {
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Other argument shapes
// ---------------------------------------------------------------------------

/** `--at x,y`: two numbers in CSS pixels. */
function parsePoint(raw: string, t: Messages): { x: number; y: number } {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(raw);
  if (m === null) throw invalid(t.browser.atInvalid(raw));
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** `--params`: a JSON object. */
function parseParams(raw: string, t: Messages): Record<string, unknown> {
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

/** `--timeout`: 30s / 2m / bare seconds, more than zero. */
function parseTimeout(raw: string, t: Messages): number {
  const ms = parseDurationMs(raw);
  if (ms === null || ms === 0) throw invalid(t.client.timeoutInvalid(raw));
  return ms;
}

/** Commander collector for a repeatable option; a value may also list several, comma-separated. */
function collect(value: string, previous: string[]): string[] {
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
async function resolveSource(client: ServerClient, from: string, t: Messages): Promise<string> {
  if (from.includes(":")) return from;
  const { sources } = await client.request<BuiltinBrowserImportSourcesResponse>(
    "GET",
    `${BASE}/import/sources`,
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
function fileStamp(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** A PNG's pixel size from its IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(png: Buffer): string | null {
  const signature = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== signature) return null;
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerBrowserCommand(program: Command, t: Messages): void {
  const browser = program.command("browser").description(t.browser.desc);
  /** `--json` and `--server`, which every leaf takes, after its own options. */
  const leaf = (cmd: Command): Command =>
    cmd.option("--json", t.common.json).option("--server <url>", t.common.server);
  /** A leaf acting on a page: `--tab` too. */
  const onTab = (cmd: Command): Command => leaf(cmd.option("--tab <id>", t.browser.tab));

  leaf(browser.command("status").description(t.browser.statusDesc)).action(
    action(t, async (opts: CommonOpts) => {
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserStatus>("GET", `${BASE}/status`);
      if (opts.json === true) printJson(res);
      else print(renderStatus(res, t));
      if (!res.available) process.exitCode = 1;
    }),
  );

  leaf(browser.command("tabs").description(t.browser.tabsDesc)).action(
    action(t, async (opts: CommonOpts) => {
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserTabsResponse>("GET", `${BASE}/tabs`);
      if (opts.json === true) printJson(res);
      else print(renderTabs(res, t));
    }),
  );

  onTab(
    browser
      .command("open")
      .description(t.browser.openDesc)
      .argument("<url>", t.browser.urlArg)
      .option("--new-tab", t.browser.newTab),
  ).action(
    action(t, async (raw: string, opts: CommonOpts & { newTab?: boolean }) => {
      if (opts.newTab === true && opts.tab !== undefined) throw invalid(t.browser.newTabWithTab());
      const tab = tabRef(opts.tab, t);
      const url = normalizeUrl(raw);
      const client = await connect(opts, t);
      const res =
        opts.newTab === true
          ? await client.request<{ tab: BuiltinBrowserTab }>("POST", `${BASE}/tabs`, {
              url,
              activate: true,
              ...session(),
            })
          : await client.request<{ tab: BuiltinBrowserTab }>(
              "POST",
              `${BASE}/tabs/${tab}/navigate`,
              { url, ...session() },
            );
      if (opts.json === true) printJson(res);
      else print(`${tabHead(res.tab, t)}\n`);
    }),
  );

  leaf(
    browser
      .command("switch")
      .description(t.browser.switchDesc)
      .argument("<tab-id>", t.browser.tabIdArg),
  ).action(
    action(t, async (raw: string, opts: CommonOpts) => {
      if (!/^\d+$/.test(raw.trim())) throw invalid(t.browser.positiveInt("<tab-id>", raw));
      const tab = raw.trim();
      const client = await connect(opts, t);
      const res = await client.request<{ tab: BuiltinBrowserTab }>(
        "POST",
        `${BASE}/tabs/${tab}/activate`,
      );
      if (opts.json === true) printJson(res);
      else print(`${tabHead(res.tab, t)}\n`);
    }),
  );

  leaf(
    browser
      .command("close")
      .description(t.browser.closeDesc)
      .argument("[tab-id]", t.browser.closeTabArg),
  ).action(
    action(t, async (raw: string | undefined, opts: CommonOpts) => {
      const tab = tabRef(raw, t);
      const client = await connect(opts, t);
      await client.request("DELETE", `${BASE}/tabs/${tab}`);
      if (opts.json === true) printJson({ closed: tab === "active" ? tab : Number(tab) });
      else print(`${tab === "active" ? t.browser.closedActive() : t.browser.closed(tab)}\n`);
    }),
  );

  onTab(
    browser
      .command("scan")
      .description(t.browser.scanDesc)
      .option("--text", t.browser.textOnly)
      .option("--max-chars <n>", t.browser.maxChars),
  ).action(
    action(t, async (opts: CommonOpts & { text?: boolean; maxChars?: string }) => {
      const tab = tabRef(opts.tab, t);
      const maxChars =
        opts.maxChars !== undefined ? positiveInt("--max-chars", opts.maxChars, t) : undefined;
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserScanResult>(
        "POST",
        `${BASE}/tabs/${tab}/scan`,
        {
          ...(opts.text === true ? { textOnly: true } : {}),
          ...(maxChars !== undefined ? { maxChars } : {}),
        },
      );
      if (opts.json === true) printJson(res);
      else print(renderScan(res, t));
    }),
  );

  onTab(
    browser
      .command("exec")
      .description(t.browser.execDesc)
      .argument("[script]", t.browser.scriptArg)
      .option("--file <file>", t.browser.file)
      .option("--save <file>", t.browser.save)
      .option("--no-monitor", t.browser.noMonitor)
      .option("--timeout <duration>", t.browser.timeout),
  ).action(
    action(
      t,
      async (
        arg: string | undefined,
        opts: CommonOpts & { file?: string; save?: string; monitor?: boolean; timeout?: string },
      ) => {
        const tab = tabRef(opts.tab, t);
        const timeoutMs = opts.timeout !== undefined ? parseTimeout(opts.timeout, t) : undefined;
        const script = await resolveScript(arg, opts.file, t);
        const client = await connect(opts, t);
        const res = await client.request<BuiltinBrowserExecResult>(
          "POST",
          `${BASE}/tabs/${tab}/exec`,
          {
            script,
            ...(opts.monitor === false ? { noMonitor: true } : {}),
            ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            ...session(),
          },
        );
        const savedTo =
          opts.save !== undefined && res.status === "success"
            ? saveValue(opts.save, res.value, t)
            : undefined;
        if (opts.json === true) printJson(res);
        else print(renderExec(res, t, { alwaysReturn: true, savedTo }));
        if (res.status === "failed") process.exitCode = 1;
      },
    ),
  );

  onTab(
    browser
      .command("click")
      .description(t.browser.clickDesc)
      .argument("[selector]", t.browser.selectorArg)
      .option("--index <n>", t.browser.index)
      .option("--at <x,y>", t.browser.at),
  ).action(
    action(
      t,
      async (selector: string | undefined, opts: CommonOpts & { index?: string; at?: string }) => {
        const tab = tabRef(opts.tab, t);
        const byPoint = opts.at !== undefined;
        if ((selector === undefined) !== byPoint || (byPoint && opts.index !== undefined)) {
          throw invalid(t.browser.clickTarget());
        }
        const target = byPoint
          ? parsePoint(opts.at!, t)
          : {
              selector: selector!,
              ...(opts.index !== undefined ? { index: parseIndex(opts.index, t) } : {}),
            };
        const client = await connect(opts, t);
        const res = await client.request<BuiltinBrowserExecResult>(
          "POST",
          `${BASE}/tabs/${tab}/click`,
          { ...target, ...session() },
        );
        if (opts.json === true) printJson(res);
        else print(renderExec(res, t, { alwaysReturn: false }));
        if (res.status === "failed") process.exitCode = 1;
      },
    ),
  );

  onTab(
    browser
      .command("type")
      .description(t.browser.typeDesc)
      .argument("<text>", t.browser.textArg)
      .option("--selector <css>", t.browser.selector)
      .option("--submit", t.browser.submit),
  ).action(
    action(t, async (text: string, opts: CommonOpts & { selector?: string; submit?: boolean }) => {
      const tab = tabRef(opts.tab, t);
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserExecResult>(
        "POST",
        `${BASE}/tabs/${tab}/type`,
        {
          text,
          ...(opts.selector !== undefined ? { selector: opts.selector } : {}),
          ...(opts.submit === true ? { submit: true } : {}),
          ...session(),
        },
      );
      if (opts.json === true) printJson(res);
      else print(renderExec(res, t, { alwaysReturn: false }));
      if (res.status === "failed") process.exitCode = 1;
    }),
  );

  onTab(
    browser
      .command("screenshot")
      .description(t.browser.screenshotDesc)
      .option("-o, --output <file>", t.browser.output)
      .option("--full-page", t.browser.fullPage),
  ).action(
    action(t, async (opts: CommonOpts & { output?: string; fullPage?: boolean }) => {
      const tab = tabRef(opts.tab, t);
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserScreenshot>(
        "POST",
        `${BASE}/tabs/${tab}/screenshot`,
        opts.fullPage === true ? { fullPage: true } : {},
      );
      if (opts.json === true && opts.output === undefined) {
        printJson(res);
        return;
      }
      const png = Buffer.from(res.data, "base64");
      const target = path.resolve(opts.output ?? `screenshot-${fileStamp()}.png`);
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, png);
      } catch (err) {
        throw new BrowserCliError("io_error", t.browser.fileUnwritable(target, errorText(err)));
      }
      if (opts.json === true) printJson(res);
      else {
        const size = pngSize(png) ?? res.mime;
        const kilobytes = Math.max(1, Math.round(png.length / 1024));
        print(
          `${t.browser.line(t.browser.label.screenshot, t.browser.screenshotSaved(target, size, kilobytes))}\n`,
        );
      }
    }),
  );

  onTab(
    browser
      .command("cdp")
      .description(t.browser.cdpDesc)
      .argument("<method>", t.browser.methodArg)
      .option("--params <json>", t.browser.params),
  ).action(
    action(t, async (method: string, opts: CommonOpts & { params?: string }) => {
      const tab = tabRef(opts.tab, t);
      if (!/^[A-Za-z]+\.[A-Za-z]+$/.test(method)) throw invalid(t.browser.methodInvalid(method));
      const params = opts.params !== undefined ? parseParams(opts.params, t) : undefined;
      const client = await connect(opts, t);
      const res = await client.request<{ result: unknown }>("POST", `${BASE}/tabs/${tab}/cdp`, {
        method,
        ...(params !== undefined ? { params } : {}),
      });
      if (opts.json === true) printJson(res);
      else print(renderCdpResult(res.result, t));
    }),
  );

  leaf(
    browser
      .command("import")
      .description(t.browser.importDesc)
      .option("--list", t.browser.list)
      .option("--from <source>", t.browser.from)
      .option("--cookies", t.browser.cookies)
      .option("--history", t.browser.history)
      .option("--domain <domain>", t.browser.domain, collect, []),
  ).action(
    action(
      t,
      async (
        opts: CommonOpts & {
          list?: boolean;
          from?: string;
          cookies?: boolean;
          history?: boolean;
          domain: string[];
        },
      ) => {
        if ((opts.list === true) === (opts.from !== undefined))
          throw invalid(t.browser.importMode());
        const client = await connect(opts, t);
        if (opts.list === true) {
          const res = await client.request<BuiltinBrowserImportSourcesResponse>(
            "GET",
            `${BASE}/import/sources`,
          );
          if (opts.json === true) printJson(res);
          else print(renderImportSources(res.sources, t));
          return;
        }
        const sourceId = await resolveSource(client, opts.from!, t);
        // Neither flag means both: an import brings everything unless told otherwise.
        const both = opts.cookies !== true && opts.history !== true;
        const res = await client.request<BuiltinBrowserImportResult>("POST", `${BASE}/import`, {
          sourceId,
          cookies: both || opts.cookies === true,
          history: both || opts.history === true,
          ...(opts.domain.length > 0 ? { domains: opts.domain } : {}),
        });
        if (opts.json === true) printJson(res);
        else print(renderImportResult(res, t));
      },
    ),
  );

  leaf(
    browser
      .command("history")
      .description(t.browser.historyDesc)
      .argument("[query]", t.browser.queryArg)
      .option("-n, --count <count>", t.browser.count),
  ).action(
    action(t, async (query: string | undefined, opts: CommonOpts & { count?: string }) => {
      const limit = opts.count !== undefined ? positiveInt("-n", opts.count, t) : 20;
      const client = await connect(opts, t);
      const res = await client.request<BuiltinBrowserHistoryResponse>(
        "GET",
        `${BASE}/history?q=${enc(query ?? "")}&limit=${limit}`,
      );
      if (opts.json === true) printJson(res);
      else print(renderHistory(res.entries, t));
    }),
  );
}
