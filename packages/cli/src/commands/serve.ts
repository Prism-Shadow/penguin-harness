/**
 * `penguin server` / `penguin web` — starts the Web service.
 *
 *   penguin server [--port <port>] [--host <host>]
 *   penguin server reset-admin-password        (subcommand, see reset-password.ts)
 *   penguin web [--port <port>] [--host <host>] [--no-open]
 *
 * Both are entry points into the same service process: after setting PORT / HOST, it
 * dynamically imports `@prismshadow/penguin-server` (whose entry point handles dotenv
 * loading and graceful shutdown on its own), so the two never listen on separate ports
 * in parallel. Port/host priority: command-line option > existing environment variable
 * (including .env) > default 7364 / 127.0.0.1. `penguin web` additionally polls until the
 * service is ready, prints the URL, and opens a browser per-platform (`--no-open`
 * disables this). Before the import, PENGUIN_CLI_ENTRY is exported (when node can re-run
 * this entry) so the server's admin self-update endpoint can invoke `penguin update`.
 *
 * Supervision: when plain node can re-run this entry, the service runs as a CHILD process
 * (`node <entry> server …`, marked PENGUIN_SERVE_CHILD=1) and this process stays behind
 * as its supervisor — it forwards the terminal's signals, exits with the child's code, and
 * relaunches the child when it exits with core's SERVER_RESTART_EXIT_CODE. That exit is
 * what the Web App's "restart to update" asks for once `penguin update` has replaced the
 * install: the relaunch re-resolves the same entry path, which now holds the new release.
 * The child is told a supervisor is there (PENGUIN_SUPERVISED=1); a dev run through tsx
 * cannot be re-spawned by node and runs in-process as before, where the server reports
 * that a restart must be done by hand.
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import {
  DEFAULT_SERVER_PORT,
  SERVER_RESTART_EXIT_CODE,
  resolveRoot,
} from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import type { Command } from "commander";
import type { Messages, WebProbeFailureKind } from "../i18n.js";
import { registerResetPasswordCommand } from "./reset-password.js";
import { registerStatusCommand } from "./server-status.js";
import { registerStopCommand } from "./server-stop.js";

/** Why the readiness poll gave up: failure class plus a one-line diagnostic from the last probe. */
export interface ReadinessFailure {
  kind: WebProbeFailureKind;
  detail: string;
}

/** Result of `waitForReady`: ready, or timed out with the retained last probe failure. */
export type ReadinessResult = { ready: true } | { ready: false; failure: ReadinessFailure };

/** Default service port — core's DEFAULT_SERVER_PORT (7364), the single source of truth. */
export const DEFAULT_PORT = DEFAULT_SERVER_PORT;
/** Default service listen host. */
export const DEFAULT_HOST = "127.0.0.1";

/**
 * Resolves the listen port: command-line option takes priority, then the PORT
 * environment variable, defaulting to 7364; throws if not an integer or out of the
 * 0-65535 range. Exported for unit tests.
 */
export function resolvePort(option: string | undefined, env: string | undefined): number {
  const raw = option ?? env;
  if (raw === undefined || raw === "") return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port "${raw}". Use an integer between 0 and 65535.`);
  }
  return port;
}

/**
 * Picks the command to open a browser per-platform. On win32, `start` treats the first
 * quoted argument as the window title, so an extra empty title placeholder is passed.
 * Exported for unit tests.
 */
export function browserCommand(platform: string, url: string): { command: string; args: string[] } {
  if (platform === "darwin") return { command: "open", args: [url] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

/** URL used for the readiness probe and browser access: when listening on a wildcard address (0.0.0.0 / ::), access via 127.0.0.1 instead. Exported for unit tests. */
export function browserUrl(host: string, port: number): string {
  const target = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${target}:${port}/`;
}

/**
 * The CLI entry script advertised to the server for the admin self-update endpoint
 * (POST /api/version/update re-runs it as `node <entry> update --yes`), or null when it
 * must not be advertised. Only entries plain `node` can execute qualify: a dev CLI run
 * through tsx has a .ts entry that node would reject with a syntax error, and reporting
 * "unsupported" beats a misleading failure. Exported for unit tests.
 */
export function cliEntryFor(argv1: string | undefined): string | null {
  if (!argv1) return null;
  return /\.(js|mjs|cjs)$/i.test(argv1) ? path.resolve(argv1) : null;
}

/**
 * Sets PORT / HOST then starts the service: the server entry point only reads
 * process.env, and its dotenv loading never overrides existing environment variables,
 * so the values written here are the ones that take effect (options take priority over
 * .env and any pre-existing env vars).
 */
/**
 * Pre-start lock check: the App URL of a live server already owning the data root this
 * process would use (same resolution as the server: PENGUIN_HOME or the default root),
 * or null. The server itself re-checks on startup (the in-process backstop); checking
 * here keeps the friendly path — `penguin server` refuses with the URL, `penguin web`
 * simply opens the existing instance. Locks live per data root, so a second server on a
 * DIFFERENT root is untouched. See @prismshadow/penguin-server/lock.
 */
async function existingInstanceUrl(): Promise<string | null> {
  const lock = await liveServerLock(resolveRoot());
  return lock === null ? null : `http://localhost:${lock.port}/`;
}

/** Marks the service child a supervising `penguin server|web` spawned: it runs the server in-process. */
export const SERVE_CHILD_ENV = "PENGUIN_SERVE_CHILD";

/** What the supervisor does when its child exits (pure; exported for unit tests). */
export function supervisorDecision(
  exit: { code: number | null; signal: NodeJS.Signals | null },
  stopping: boolean,
): { action: "respawn" } | { action: "exit"; code: number } {
  // The restart code is the child's own request to be relaunched; a signal-terminated
  // child reports no code and is simply gone. Once the supervisor itself was told to stop,
  // nothing is relaunched, whatever the child's last word.
  if (!stopping && exit.code === SERVER_RESTART_EXIT_CODE) return { action: "respawn" };
  return { action: "exit", code: exit.code ?? (exit.signal !== null ? 1 : 0) };
}

/**
 * Runs the service as a child of this process and keeps it running across restart
 * requests. Returns once the first child is spawned; the process then lives as long as
 * the child does (the handle keeps the event loop alive) and takes its exit code.
 */
function supervise(cliEntry: string, host: string, port: number, t: Messages): void {
  let stopping = false;
  let child: ChildProcess | null = null;
  const spawnChild = (): void => {
    child = spawn(process.execPath, [cliEntry, "server", "--port", String(port), "--host", host], {
      stdio: "inherit",
      env: { ...process.env, [SERVE_CHILD_ENV]: "1", PENGUIN_SUPERVISED: "1" },
    });
    child.on("exit", (code, signal) => {
      const decision = supervisorDecision({ code, signal }, stopping);
      if (decision.action === "respawn") {
        process.stdout.write(`${t.serve.restarting}\n`);
        spawnChild();
        return;
      }
      process.exitCode = decision.code;
    });
  };
  // A signal aimed at the supervisor alone (`kill <pid>`) must reach the service; one from
  // the terminal already reached both, and the child's shutdown is idempotent. Windows has
  // no signal to forward — the console delivers Ctrl+C to every process attached to it —
  // and kill() there is a hard TerminateProcess that would cut a shutdown short.
  if (process.platform !== "win32") {
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, () => {
        stopping = true;
        child?.kill(signal);
      });
    }
  }
  spawnChild();
}

async function startServer(
  opts: { port?: string; host?: string },
  t: Messages,
): Promise<{ host: string; port: number }> {
  const port = resolvePort(opts.port, process.env.PORT);
  const host = opts.host ?? process.env.HOST ?? DEFAULT_HOST;
  process.env.PORT = String(port);
  process.env.HOST = host;
  // Tell the server which CLI entry script launched it: the admin self-update endpoint
  // (POST /api/version/update) re-runs `node <entry> update --yes`. Set before the import
  // so it is visible however the server captures its environment; when the server was not
  // started through the CLI (or the entry is not re-runnable by plain node, e.g. a tsx dev
  // run) the variable stays unset and the endpoint reports "unsupported".
  const cliEntry = cliEntryFor(process.argv[1]);
  if (cliEntry !== null) {
    process.env.PENGUIN_CLI_ENTRY = cliEntry;
  }
  // The same re-runnable entry is what makes supervision possible: the child is exactly
  // this command again, marked as the child so it does not supervise in turn.
  if (cliEntry !== null && process.env[SERVE_CHILD_ENV] !== "1") {
    supervise(cliEntry, host, port, t);
    return { host, port };
  }
  await import("@prismshadow/penguin-server");
  return { host, port };
}

function errorProperty(
  value: unknown,
  property: "cause" | "code" | "errors" | "message" | "name",
): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  return (value as Record<string, unknown>)[property];
}

/**
 * Turns Node/undici's nested `fetch failed` errors into a stable one-line diagnostic.
 * The useful code usually lives on `error.cause` rather than the top-level TypeError.
 * Exported for unit tests.
 */
export function describeReadinessFailure(error: unknown): ReadinessFailure {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    // Follow `cause` first; an AggregateError (e.g. localhost resolving to several
    // addresses, all refused) keeps the real connect errors in `errors` instead.
    const cause = errorProperty(current, "cause");
    if (cause !== undefined && cause !== null) {
      current = cause;
      continue;
    }
    const errors = errorProperty(current, "errors");
    current = Array.isArray(errors) ? errors[0] : undefined;
  }

  const code = chain
    .map((item) => errorProperty(item, "code"))
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const selected = [...chain].reverse().find((item) => {
    const value = errorProperty(item, "message");
    // Skip empty messages: an AggregateError's own message is "" and would mask real text.
    return typeof value === "string" && value.length > 0;
  });
  const messageValue = selected === undefined ? undefined : errorProperty(selected, "message");
  const nameValue = selected === undefined ? undefined : errorProperty(selected, "name");
  const message =
    typeof messageValue === "string" && messageValue.length > 0
      ? messageValue
      : typeof error === "string"
        ? error
        : "Unknown readiness probe error";
  const name = typeof nameValue === "string" && nameValue !== "Error" ? nameValue : undefined;
  const detail =
    code !== undefined
      ? `${code}: ${message}`
      : name !== undefined
        ? `${name}: ${message}`
        : message;
  const signature = chain
    .flatMap((item) => [
      errorProperty(item, "code"),
      errorProperty(item, "name"),
      errorProperty(item, "message"),
    ])
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();

  let kind: WebProbeFailureKind = "unknown";
  if (signature.includes("ECONNREFUSED")) kind = "refused";
  else if (
    signature.includes("ETIMEDOUT") ||
    signature.includes("TIMEOUT") ||
    signature.includes("ABORTERROR")
  ) {
    kind = "timeout";
  } else if (
    signature.includes("ECONNRESET") ||
    signature.includes("UND_ERR_SOCKET") ||
    signature.includes("EPIPE")
  ) {
    kind = "reset";
  } else if (signature.includes("EACCES") || signature.includes("EPERM")) {
    kind = "permission";
  } else if (signature.includes("ENOTFOUND") || signature.includes("EAI_AGAIN")) {
    kind = "dns";
  }

  return { kind, detail };
}

/** Polls the service root path until it responds (any HTTP response counts as ready); retains the last connection failure for diagnostics on timeout. Exported for unit tests. */
export async function waitForReady(
  url: string,
  timeoutMs = 15_000,
  intervalMs = 300,
): Promise<ReadinessResult> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      // Each probe is capped at 1s: if the port is held by a non-HTTP program, the
      // connection can succeed while the response hangs forever; without a timeout this
      // would block the whole polling loop (the deadline check below would never run).
      // `redirect: "manual"`: on a loopback bind the root path 302s to the canonical host
      // (127.0.0.1 is reserved for previews); the probe only needs to know the port answers,
      // so treat that 302 as ready rather than chasing it to a name that may resolve to ::1.
      const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1000) });
      void res.body?.cancel();
      return { ready: true };
    } catch (error) {
      // The service isn't listening yet (or this probe timed out): retain the reason and keep polling.
      lastError = error;
    }
    if (Date.now() >= deadline) {
      return { ready: false, failure: describeReadinessFailure(lastError) };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Opens the browser: spawn detached with output ignored; any failure is silently swallowed (failing to open doesn't affect the running service). */
function openBrowser(url: string): void {
  const { command, args } = browserCommand(process.platform, url);
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // e.g. the browser command doesn't exist: ignore, the user can open it manually.
  }
}

export function registerServeCommands(program: Command, t: Messages): void {
  const server = program
    .command("server")
    .description(t.serve.serverDesc)
    .option("--port <port>", t.serve.port)
    .option("--host <host>", t.serve.host)
    .action(async (opts: { port?: string; host?: string }) => {
      const existing = await existingInstanceUrl();
      if (existing !== null) {
        process.stderr.write(t.serverAlreadyRunning(existing) + "\n");
        process.exitCode = 1;
        return;
      }
      await startServer(opts, t);
    });
  // Bare `penguin server` still starts the service (commander runs the action when no
  // subcommand is named); the subcommand only dispatches on an exact name match.
  registerResetPasswordCommand(server, t);
  registerStatusCommand(server, t);
  registerStopCommand(server, t);

  program
    .command("web")
    .description(t.serve.webDesc)
    .option("--port <port>", t.serve.port)
    .option("--host <host>", t.serve.host)
    .option("--no-open", t.serve.noOpen)
    .action(async (opts: { port?: string; host?: string; open: boolean }) => {
      const existing = await existingInstanceUrl();
      if (existing !== null) {
        process.stdout.write(t.webAlreadyRunning(existing) + "\n");
        // Nothing is printed when attaching to a server that is already up: a server with
        // no admin password yet prints a first-login LINK, and that link's token lives only
        // in the running server's memory — this terminal cannot reproduce it, and should
        // not. Its own console has it; restarting reissues it.
        if (opts.open) openBrowser(existing);
        return;
      }
      const { host, port } = await startServer(opts, t);
      const url = browserUrl(host, port);
      const readiness = await waitForReady(url);
      if (!readiness.ready) {
        process.stderr.write(
          `${t.webProbeFailed(url, readiness.failure.detail, readiness.failure.kind, port)}\n`,
        );
        return;
      }
      process.stdout.write(`${t.webReady(url)}\n`);
      if (opts.open) openBrowser(url);
    });
}
