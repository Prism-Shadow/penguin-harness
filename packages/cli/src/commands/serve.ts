/**
 * `penguin server` / `penguin web` — starts the Web service.
 *
 *   penguin server [--port <port>] [--host <host>]
 *   penguin web [--port <port>] [--host <host>] [--no-open]
 *
 * Both are entry points into the same service process: after setting PORT / HOST, it
 * dynamically imports `@prismshadow/penguin-server` (whose entry point handles dotenv
 * loading and graceful shutdown on its own), so the two never listen on separate ports
 * in parallel. Port/host priority: command-line option > existing environment variable
 * (including .env) > default 7364 / 127.0.0.1. `penguin web` additionally polls until the
 * service is ready, prints the URL, and opens a browser per-platform (`--no-open`
 * disables this).
 * Docs: /docs/cli § "penguin server / penguin web".
 */
import { spawn } from "node:child_process";
import { DEFAULT_SERVER_PORT } from "@prismshadow/penguin-core";
import type { Command } from "commander";
import type { Messages } from "../i18n.js";

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
 * Sets PORT / HOST then starts the service: the server entry point only reads
 * process.env, and its dotenv loading never overrides existing environment variables,
 * so the values written here are the ones that take effect (options take priority over
 * .env and any pre-existing env vars).
 */
async function startServer(opts: {
  port?: string;
  host?: string;
}): Promise<{ host: string; port: number }> {
  const port = resolvePort(opts.port, process.env.PORT);
  const host = opts.host ?? process.env.HOST ?? DEFAULT_HOST;
  process.env.PORT = String(port);
  process.env.HOST = host;
  await import("@prismshadow/penguin-server");
  return { host, port };
}

/** Polls the service root path until it responds (any HTTP response counts as ready); keeps waiting on connection failure, returns false on timeout. */
async function waitForReady(url: string, timeoutMs = 15_000, intervalMs = 300): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
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
      return true;
    } catch {
      // The service isn't listening yet (or this probe timed out): keep polling.
    }
    if (Date.now() >= deadline) return false;
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
  program
    .command("server")
    .description(t.serve.serverDesc)
    .option("--port <port>", t.serve.port)
    .option("--host <host>", t.serve.host)
    .action(async (opts: { port?: string; host?: string }) => {
      await startServer(opts);
    });

  program
    .command("web")
    .description(t.serve.webDesc)
    .option("--port <port>", t.serve.port)
    .option("--host <host>", t.serve.host)
    .option("--no-open", t.serve.noOpen)
    .action(async (opts: { port?: string; host?: string; open: boolean }) => {
      const { host, port } = await startServer(opts);
      const url = browserUrl(host, port);
      const ready = await waitForReady(url);
      if (!ready) {
        process.stdout.write(`${t.webTimeout(url)}\n`);
        return;
      }
      process.stdout.write(`${t.webReady(url)}\n`);
      if (opts.open) openBrowser(url);
    });
}
