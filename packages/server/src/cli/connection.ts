/**
 * The server connection half the server package's CLI module shares with its commands:
 * connection resolution, server auto-start and the `Connection` shape every server-backed
 * command carries.
 *
 * Connection resolution order (first hit wins):
 *   1. `--server <url>` — an explicit target. A non-loopback URL requires
 *      PENGUIN_API_TOKEN: the on-disk token file belongs to the LOCAL data root and must
 *      never be sent to a remote host.
 *   2. `PENGUIN_API_URL` — the same, from the environment. Server-driven sessions inject
 *      it (with PENGUIN_API_TOKEN) into tool subprocesses, which is how an agent's own
 *      `penguin` calls find the server that runs them.
 *   3. A live `server.lock` at the data root (PENGUIN_HOME or ~/.penguin/data): attach to
 *      the running local server on `http://localhost:<port>`. A `penguin` started through a
 *      server's `<root>/bin/penguin` shim — in that server's terminals and Agent commands —
 *      gets that server's root as PENGUIN_HOME unless its caller set one (the server's
 *      services/cli-shim.ts), so it attaches to that server rather than the installed one.
 *   4. Auto-start: spawn a detached `node <cli entry> server` with PORT=0, wait for its
 *      lock, attach. The loser of a two-CLI spawn race exits with code 3 ("already
 *      running"), which the lock poll absorbs — it finds the winner's lock either way.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock } from "../lock.js";
import type { Messages } from "./i18n.js";

/** Hosts that count as this machine for token-file purposes. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export interface Connection {
  /** Normalized base URL, no trailing slash. */
  baseUrl: string;
  /** Data root used for the token file and the lock (resolution-time value). */
  root: string;
  /** Whether this call auto-started the server (surfaced to the user on stderr). */
  autoStarted: boolean;
  /** Whether the target host is loopback (gates the file-token fallback). */
  loopback: boolean;
  /**
   * Whether the server was found through `root` — its live lock, or one auto-started there —
   * rather than named by `--server` / PENGUIN_API_URL; then the root says which instance it is.
   */
  fromRoot: boolean;
}

/**
 * Which server a connection talks to, as the chat and run banners show it: the URL, and the
 * data root behind it when that is how it was found — the part that tells two local
 * instances apart, the installed app and a development server among them.
 */
export function connectionLabel(conn: Connection): string {
  return conn.fromRoot ? `${conn.baseUrl} (${conn.root})` : conn.baseUrl;
}

export function isLoopbackUrl(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/** Strips trailing slashes and validates the scheme; throws a localized error on junk. */
export function normalizeServerUrl(raw: string, t: Messages): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(t.client.invalidServerUrl(raw));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(t.client.invalidServerUrl(raw));
  }
  return url;
}

/**
 * The CLI entry script for auto-start, or null when this process cannot re-run itself
 * with plain node (a tsx dev run has a .ts entry) — same rule as serve.ts's cliEntryFor.
 */
export function autoStartEntry(argv1: string | undefined): string | null {
  if (!argv1) return null;
  return /\.(js|mjs|cjs)$/i.test(argv1) ? path.resolve(argv1) : null;
}

/** yyyy-mm-dd of the local clock (log file naming). */
function localDate(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Spawns a detached local server (PORT=0 → ephemeral port), logs to
 * `<root>/logs/server-auto-<date>.log`, and waits for a live lock on the root. The lock
 * poll accepts ANY live server on the root: if a concurrent CLI won the spawn race, our
 * child exits 3 and the winner's lock satisfies the wait just the same.
 */
export async function autoStartServer(
  root: string,
  t: Messages,
  opts: { timeoutMs?: number } = {},
): Promise<{ port: number; logPath: string }> {
  const entry = autoStartEntry(process.argv[1]);
  if (entry === null) throw new Error(t.client.autoStartUnavailable());
  fs.mkdirSync(path.join(root, "logs"), { recursive: true });
  const logPath = path.join(root, "logs", `server-auto-${localDate()}.log`);
  const fd = fs.openSync(logPath, "a");
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(process.execPath, [entry, "server"], {
      detached: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, PORT: "0" },
    });
  } finally {
    fs.closeSync(fd);
  }
  let exitCode: number | null = null;
  child.on("error", () => {
    exitCode = -1;
  });
  child.on("exit", (code) => {
    exitCode = code ?? -1;
  });
  child.unref();

  const deadline = Date.now() + (opts.timeoutMs ?? 20_000);
  for (;;) {
    const lock = await liveServerLock(root);
    if (lock !== null) return { port: lock.port, logPath };
    // Exit 3 = "another server owns this root" — the race's loser; keep polling for the
    // winner's lock. Any other exit is a startup failure: point at the log.
    if (exitCode !== null && exitCode !== 3) {
      throw new Error(t.client.autoStartFailed(logPath));
    }
    if (Date.now() >= deadline) throw new Error(t.client.autoStartFailed(logPath));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Resolves where to connect (see the module doc for the order); may auto-start a server. */
export async function resolveConnection(
  opts: { server?: string; autoStart?: boolean },
  t: Messages,
): Promise<Connection> {
  const root = resolveRoot();
  const explicit = opts.server?.trim() || process.env.PENGUIN_API_URL?.trim() || "";
  if (explicit !== "") {
    const url = normalizeServerUrl(explicit, t);
    const loopback = isLoopbackUrl(url);
    if (!loopback && !process.env.PENGUIN_API_TOKEN?.trim()) {
      throw new Error(t.client.remoteNeedsToken(url.origin));
    }
    return { baseUrl: url.origin, root, autoStarted: false, loopback, fromRoot: false };
  }
  const lock = await liveServerLock(root);
  if (lock !== null) {
    return {
      baseUrl: `http://localhost:${lock.port}`,
      root,
      autoStarted: false,
      loopback: true,
      fromRoot: true,
    };
  }
  if (opts.autoStart === false) throw new Error(t.client.noServer());
  const { port, logPath } = await autoStartServer(root, t);
  const conn: Connection = {
    baseUrl: `http://localhost:${port}`,
    root,
    autoStarted: true,
    loopback: true,
    fromRoot: true,
  };
  process.stderr.write(`${t.client.autoStarted(conn.baseUrl, logPath)}\n`);
  return conn;
}
