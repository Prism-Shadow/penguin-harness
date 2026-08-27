/**
 * The CLI's server client: connection resolution, Bearer-token auth, JSON requests, and
 * a dependency-free fetch-based SSE consumer (the HMR deploy path bundles this file with
 * esbuild, so everything here rides on globals — fetch above all).
 *
 * Connection resolution order (first hit wins):
 *   1. `--server <url>` — an explicit target. A non-loopback URL requires
 *      PENGUIN_API_TOKEN: the on-disk token file belongs to the LOCAL data root and must
 *      never be sent to a remote host.
 *   2. `PENGUIN_API_URL` — the same, from the environment. Server-driven sessions inject
 *      it (with PENGUIN_API_TOKEN) into tool subprocesses, which is how an agent's own
 *      `penguin` calls find the server that runs them.
 *   3. A live `server.lock` at the data root (PENGUIN_HOME or ~/.penguin/data): attach to
 *      the running local server on `http://localhost:<port>`.
 *   4. Auto-start: spawn a detached `node <cli entry> server` with PORT=0, wait for its
 *      lock, attach. The loser of a two-CLI spawn race exits with code 3 ("already
 *      running"), which the lock poll absorbs — it finds the winner's lock either way.
 *
 * Token resolution: PENGUIN_API_TOKEN, else `<root>/api-token` (written by the server
 * each boot). A 401 with a file-sourced token re-reads the file once and retries — the
 * server may have restarted (and rotated the token) since the first read.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveRoot } from "@prismshadow/penguin-core";
import { liveServerLock } from "@prismshadow/penguin-server/lock";
import type { Messages } from "./i18n.js";

/** Session-id shape (core's convention); a full id needs no directory search. */
const SESSION_ID_RE = /^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/** Hosts that count as this machine for token-file purposes. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** How the auth token was obtained; decides whether a 401 retries after re-reading the file. */
export type TokenSource = "env" | "file" | "none";

export interface Connection {
  /** Normalized base URL, no trailing slash. */
  baseUrl: string;
  /** Data root used for the token file and the lock (resolution-time value). */
  root: string;
  /** Whether this call auto-started the server (surfaced to the user on stderr). */
  autoStarted: boolean;
  /** Whether the target host is loopback (gates the file-token fallback). */
  loopback: boolean;
}

/** One parsed SSE frame; `data` is the raw payload (possibly multi-line joined). */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
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

/** The token file the server writes each boot (kept in sync with the server's auth/api-token.ts). */
export function apiTokenPath(root: string): string {
  return path.join(root, "api-token");
}

function readTokenFile(root: string): string | null {
  try {
    const value = fs.readFileSync(apiTokenPath(root), "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
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
    return { baseUrl: url.origin, root, autoStarted: false, loopback };
  }
  const lock = await liveServerLock(root);
  if (lock !== null) {
    return { baseUrl: `http://localhost:${lock.port}`, root, autoStarted: false, loopback: true };
  }
  if (opts.autoStart === false) throw new Error(t.client.noServer());
  const { port, logPath } = await autoStartServer(root, t);
  const conn: Connection = {
    baseUrl: `http://localhost:${port}`,
    root,
    autoStarted: true,
    loopback: true,
  };
  process.stderr.write(`${t.client.autoStarted(conn.baseUrl, logPath)}\n`);
  return conn;
}

/** Error the client raises for non-2xx responses; `code` is the server's error code when the body carried one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ServerClient {
  private token: string | null;
  private tokenSource: TokenSource;

  constructor(
    readonly conn: Connection,
    private readonly t: Messages,
  ) {
    const envToken = process.env.PENGUIN_API_TOKEN?.trim();
    if (envToken) {
      this.token = envToken;
      this.tokenSource = "env";
    } else if (conn.loopback) {
      this.token = readTokenFile(conn.root);
      this.tokenSource = this.token !== null ? "file" : "none";
    } else {
      this.token = null;
      this.tokenSource = "none";
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      ...(this.token !== null ? { authorization: `Bearer ${this.token}` } : {}),
      ...extra,
    };
  }

  /**
   * One JSON request. 401 with a file-sourced token re-reads the file once (the server
   * may have restarted and rotated it) and retries; every other non-2xx becomes an
   * ApiError carrying the server's code and message.
   */
  async request<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
    const res = await this.fetchAuthed(apiPath, {
      method,
      headers: this.headers(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204 || res.headers.get("content-length") === "0") {
      void res.body?.cancel();
      return undefined as T;
    }
    const text = await res.text();
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  /** The authenticated fetch with the one-shot 401 file-token refresh. */
  private async fetchAuthed(apiPath: string, init: RequestInit): Promise<Response> {
    const res = await fetch(`${this.conn.baseUrl}${apiPath}`, init);
    if (res.status !== 401) return res;
    if (this.tokenSource === "env" || !this.conn.loopback) return res;
    const fresh = readTokenFile(this.conn.root);
    if (fresh === null || fresh === this.token) return res;
    void res.body?.cancel();
    this.token = fresh;
    this.tokenSource = "file";
    const headers = { ...(init.headers as Record<string, string>), ...this.headers() };
    return fetch(`${this.conn.baseUrl}${apiPath}`, { ...init, headers });
  }

  private async toError(res: Response): Promise<ApiError> {
    let code = "http_error";
    let message = "";
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Non-JSON error body: keep the fallback wording.
    }
    if (res.status === 401) {
      return new ApiError(
        401,
        "unauthorized",
        this.token === null
          ? this.t.client.noToken(this.conn.baseUrl, apiTokenPath(this.conn.root))
          : this.t.client.authFailed(this.conn.baseUrl),
      );
    }
    return new ApiError(res.status, code, this.t.client.httpError(res.status, code, message));
  }

  /**
   * Opens one SSE subscription (fetch with headers — EventSource cannot carry the
   * Bearer token) and yields parsed frames. The caller handles reconnects; aborting
   * `signal` ends the generator quietly.
   */
  async *sse(apiPath: string, opts: { lastEventId?: string; signal?: AbortSignal } = {}) {
    const res = await this.fetchAuthed(apiPath, {
      headers: this.headers({
        accept: "text/event-stream",
        ...(opts.lastEventId !== undefined ? { "last-event-id": opts.lastEventId } : {}),
      }),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (!res.ok || res.body === null) throw await this.toError(res);
    yield* parseSseBody(res.body, opts.signal);
  }
}

/**
 * Minimal SSE parser over a fetch body: `id:` / `event:` / `data:` fields, multi-line
 * data joined with \n, blank line dispatches, `:` comment lines (heartbeats) ignored.
 * Tolerates \r\n line endings.
 */
export async function* parseSseBody(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let id: string | undefined;
  let event: string | undefined;
  let data: string[] = [];
  const flush = (): SseFrame | null => {
    if (data.length === 0 && event === undefined) {
      id = undefined;
      event = undefined;
      return null;
    }
    const frame: SseFrame = {
      ...(id !== undefined ? { id } : {}),
      ...(event !== undefined ? { event } : {}),
      data: data.join("\n"),
    };
    event = undefined;
    data = [];
    return frame;
  };
  try {
    for (;;) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl === -1) break;
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          const frame = flush();
          if (frame) yield frame;
          continue;
        }
        if (line.startsWith(":")) continue; // heartbeat comment
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value2 = colon === -1 ? "" : line.slice(colon + 1);
        if (value2.startsWith(" ")) value2 = value2.slice(1);
        if (field === "data") data.push(value2);
        else if (field === "event") event = value2;
        else if (field === "id") id = value2;
        // Other fields (retry) are ignored.
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream is already closed/errored; nothing to release.
    }
  }
}

// ---------------------------------------------------------------------------
// Session references
// ---------------------------------------------------------------------------

/** The 8-hex tail of a session id — the short form `penguin ls` prints. */
export function shortSessionId(sessionId: string): string {
  const m = /-([0-9a-f]{8})$/.exec(sessionId);
  return m === null ? sessionId : m[1]!;
}

/** Minimal shape of a session row for reference resolution (matches the server's SessionInfo). */
export interface SessionRef {
  sessionId: string;
  agentId: string;
}

/**
 * Resolves a session argument: a full session id is used as-is; anything else is a
 * fragment matched as a substring over the project's sessions (all agents). Exactly one
 * match resolves; zero or several are errors — the ambiguous error lists the candidates.
 */
export async function resolveSessionRef(
  client: ServerClient,
  projectId: string,
  ref: string,
  t: Messages,
): Promise<string> {
  const trimmed = ref.trim();
  if (SESSION_ID_RE.test(trimmed)) return trimmed;
  const { agents } = await client.request<{ agents: Array<{ agentId: string }> }>(
    "GET",
    `/api/projects/${encodeURIComponent(projectId)}/agents`,
  );
  const candidates: string[] = [];
  for (const agent of agents) {
    const { sessions } = await client.request<{ sessions: SessionRef[] }>(
      "GET",
      `/api/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agent.agentId)}/sessions`,
    );
    for (const s of sessions) {
      if (s.sessionId.includes(trimmed)) candidates.push(s.sessionId);
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length === 0) throw new Error(t.client.sessionNotFound(trimmed, projectId));
  throw new Error(t.client.sessionAmbiguous(trimmed, candidates));
}

// ---------------------------------------------------------------------------
// Shared option defaults
// ---------------------------------------------------------------------------

/** `--project-id` default chain: flag > PENGUIN_PROJECT_ID > default_project. */
export function resolveProjectId(flag: string | undefined): string {
  return flag?.trim() || process.env.PENGUIN_PROJECT_ID?.trim() || "default_project";
}

/** `--agent-id` default chain: flag > PENGUIN_AGENT_ID > default_agent. */
export function resolveAgentId(flag: string | undefined): string {
  return flag?.trim() || process.env.PENGUIN_AGENT_ID?.trim() || "default_agent";
}
