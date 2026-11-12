/**
 * The CLI `ServerClient` (this package's commands and the CLI's commands share it): Bearer-token
 * auth, JSON requests, the one-shot 401 file-token refresh and the one-shot 403
 * `human_required` sign-in retry, plus a minimal fetch-based SSE consumer. Where a connection
 * comes from is connection.ts's business (the resolution order and auto-start live there, and
 * the HMR deploy path bundles this file with esbuild, so everything here rides on globals —
 * fetch above all).
 *
 * Token resolution: PENGUIN_API_TOKEN, else `<root>/api-token` (written by the server
 * each boot). A 401 with a file-sourced token re-reads the file once and retries — the
 * server may have restarted (and rotated the token) since the first read.
 *
 * A 403 `human_required` — a write the server takes only from a person's sign-in, such as
 * those that change an Agent's exposure — retries the same request once as the person's
 * stored sign-in (`<root>/cli-session.json`, written by `penguin auth login` or
 * `penguin auth token`), sent as the `penguin_session` cookie in place of the token. Only for
 * a loopback target, only for a sign-in made to a loopback server, and only outside a Session
 * (PENGUIN_SESSION_ID unset): inside one the command is an Agent's, and the refusal is the
 * point. Every other request goes exactly as above.
 */
import fs from "node:fs";
import path from "node:path";
import { readSession } from "./auth-session.js";
import type { Messages } from "./i18n.js";
import { type Connection, isLoopbackUrl } from "./connection.js";

/** Session-id shape (core's convention); a full id needs no directory search. */
const SESSION_ID_RE = /^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/;

/** How the auth token was obtained; decides whether a 401 retries after re-reading the file. */
export type TokenSource = "env" | "file" | "none";

/** The server's session cookie (auth/middleware.ts SESSION_COOKIE): a stored sign-in goes as it. */
const SESSION_COOKIE = "penguin_session";

/** The server's refusal of the local API token on a write only a person may make (requireHuman). */
const HUMAN_REQUIRED = "human_required";

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
 * The person's stored sign-in on this data root, for the one retry after a `human_required`
 * refusal (see the module doc); null inside a Session, where the command is an Agent's, and for a
 * sign-in to a server elsewhere, whose session must not be sent to this one.
 */
function readStoredSignIn(root: string): string | null {
  if (process.env.PENGUIN_SESSION_ID?.trim()) return null;
  const session = readSession(root);
  if (session === null) return null;
  try {
    return isLoopbackUrl(new URL(session.server)) ? session.token : null;
  } catch {
    return null;
  }
}

/** The error code of a JSON error body (`{error: {code}}`), or null for any other body. */
async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null;
    return typeof body?.error?.code === "string" ? body.error.code : null;
  } catch {
    return null;
  }
}

/** One parsed SSE frame; `data` is the raw payload (possibly multi-line joined). */
export interface SseFrame {
  id?: string;
  event?: string;
  data: string;
}

/**
 * Error the client raises for non-2xx responses; `code` is the server's error code when the body
 * carried one, and `body` the parsed JSON body itself (undefined when it was not JSON), for a
 * command that renders the server's own words or reads a field beside the code.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }

  /** The server's own message, unwrapped (empty when the body carried none) — for a caller that localizes the code and still needs the specifics. */
  get detail(): string {
    const message = (this.body as { error?: { message?: unknown } } | null | undefined)?.error
      ?.message;
    return typeof message === "string" ? message : "";
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
   * may have restarted and rotated it) and retries; 403 `human_required` retries once as the
   * person's stored sign-in (see fetchAuthed); every other non-2xx becomes an ApiError
   * carrying the server's code and message.
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

  /** A file upload or download: `request`'s credentials and errors, the body and answer raw. */
  async raw(method: string, apiPath: string, body?: Uint8Array): Promise<Response> {
    const res = await this.fetchAuthed(apiPath, {
      method,
      headers: this.headers(body ? { "content-type": "application/octet-stream" } : {}),
      ...(body ? { body } : {}),
    });
    if (!res.ok) throw await this.toError(res);
    return res;
  }

  /**
   * The authenticated fetch: the one-shot 401 file-token refresh, then the one-shot retry of a
   * 403 `human_required` as the person's stored sign-in.
   */
  private async fetchAuthed(apiPath: string, init: RequestInit): Promise<Response> {
    const res = await this.fetchWithToken(apiPath, init);
    return res.status === 403 ? this.retryAsPerson(apiPath, init, res) : res;
  }

  /** The token's fetch, with the one-shot 401 file-token refresh. */
  private async fetchWithToken(apiPath: string, init: RequestInit): Promise<Response> {
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

  /**
   * `refused` was a 403. When it is `human_required` and there is a stored sign-in to use (see the
   * module doc), sends the same request once more as that sign-in — the session cookie, no
   * Bearer, since the server reads a Bearer first — and answers with that. The refusal stands
   * when there is no usable sign-in, and when the server does not accept the sign-in either (a
   * 401: it expired or was revoked), so the caller still sees `human_required`.
   */
  private async retryAsPerson(
    apiPath: string,
    init: RequestInit,
    refused: Response,
  ): Promise<Response> {
    if (!this.conn.loopback) return refused;
    const signIn = readStoredSignIn(this.conn.root);
    if (signIn === null) return refused;
    if ((await errorCodeOf(refused.clone())) !== HUMAN_REQUIRED) return refused;
    const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${signIn}` };
    for (const [name, value] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      if (name.toLowerCase() !== "authorization") headers[name] = value;
    }
    const retried = await fetch(`${this.conn.baseUrl}${apiPath}`, { ...init, headers });
    if (retried.status === 401) {
      void retried.body?.cancel();
      return refused;
    }
    void refused.body?.cancel();
    return retried;
  }

  private async toError(res: Response): Promise<ApiError> {
    let code = "http_error";
    let message = "";
    let payload: unknown;
    try {
      payload = await res.json();
      const body = payload as { error?: { code?: string; message?: string } } | null;
      if (body?.error?.code) code = body.error.code;
      if (body?.error?.message) message = body.error.message;
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
    return new ApiError(
      res.status,
      code,
      this.t.client.httpError(res.status, code, message),
      payload,
    );
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

/** The 8-hex tail of a session id — the short form `penguin session ls` prints. */
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
