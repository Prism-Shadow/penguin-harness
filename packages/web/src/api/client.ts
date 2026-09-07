/**
 * API client: JSON request/response, unified errors -> ApiError,
 * same-origin cookie auth (credentials: same-origin; CSRF relies on SameSite=Lax + JSON
 * Content-Type, see server README).
 *
 * Two transports of the same API (PRFC-0011): while the page's socket is open, a call is a
 * frame on it and the answer is the endpoint's own response, framed; otherwise it is a fetch.
 * The two are handled by one code path below — status, error body, the 401 rule — so a caller
 * cannot tell which carried its request, and an answer the socket declines to carry (a
 * download: 415 `unsupported_transport`) is simply fetched.
 *
 * When the session becomes invalid (server 401, e.g. database rebuilt, cookie expired),
 * notifies AuthProvider to clear the current user, letting the route guard redirect to the
 * login page — instead of each page popping its own "unauthorized" error.
 */
import { S } from "../lib/strings";
import { apiUrl } from "../lib/server-context";
import { machineForPath } from "../lib/session-machines";
import { apiSocket } from "./socket";

/** Unified API error: carries the HTTP status code and server error code (server error body {error:{code,message}}). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Session-invalidation callback (registered by AuthProvider; not triggered by 401s from the login/register endpoints themselves). */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/** 401/409 from auth endpoints themselves are business failures (e.g. wrong password) and must not trigger a global logout. */
function isAuthEndpoint(path: string): boolean {
  return path.startsWith("/api/auth/");
}

/**
 * Paths of this server that never ride the socket (see apiFetchWithMeta): the runtime's own
 * routes — auth, the install-id probe, the hot channel — which the socket would only answer
 * 421 for, and `/api/me`, which is where the cookie's own session facts come from.
 */
function httpOnly(path: string): boolean {
  return (
    path === "/api/me" ||
    path === "/api/install" ||
    path.startsWith("/api/hmr/") ||
    isAuthEndpoint(path)
  );
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON request body (auto-serialized with Content-Type: application/json). */
  body?: unknown;
  /** Query parameters (undefined values are skipped). */
  query?: Record<string, string | number | undefined>;
  /**
   * Which machine answers this call, when the caller knows and the path does not say.
   *
   * Omitted, a Session-scoped path routes itself to the machine that Session lives on (see
   * lib/session-machines.ts) and everything else stays here — the window never moves. Pass
   * `null` to force this server, or an id to send one request through that machine's
   * connection; browsing another machine's directories to pick a workspace on it, or asking
   * a machine for ITS Agents, are the calls that need it.
   */
  server?: string | null;
}

/** Response metadata a caller may need alongside the parsed body. */
export interface ApiFetchMeta {
  /**
   * The server's own clock at the moment it produced the response, read from the HTTP `Date`
   * header; null when absent or unparseable. Lets a caller measure a server-side interval
   * entirely in server time — differencing it against a server-supplied timestamp cancels any
   * client/server clock offset, which a local `Date.now()` cannot do. Whole-second precision
   * (RFC 9110 fixes the header's format), so treat it as ±1s. `Date` is CORS-safelisted, so it
   * is readable cross-origin too.
   */
  serverNowMs: number | null;
}

/** Makes an API request; non-2xx responses uniformly throw ApiError; 204/empty body returns undefined. */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  return (await apiFetchWithMeta<T>(path, options)).data;
}

/** {@link apiFetch} plus the response metadata in {@link ApiFetchMeta}; identical in every other respect. */
export async function apiFetchWithMeta<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ data: T } & ApiFetchMeta> {
  // Two routing rules, in order: an explicit `server` wins, otherwise a Session-scoped path
  // goes to the machine that Session lives on. Everything else stays here.
  const target = "server" in options ? (options.server ?? null) : machineForPath(path);
  let url = apiUrl(path, target);
  if (options.query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const method = options.method ?? "GET";
  // Over the socket when it is open, except what stays on HTTP by design: the auth routes
  // and `/api/me` are the runtime's (the socket answers them 421), and `/api/me` is also
  // where the cookie's own session facts come from — the socket knows only the user.
  const wantsSocket = target !== null || !httpOnly(path);
  // ready() waits for a handshake in progress, so the page's first calls ride the socket
  // instead of racing it; false means HTTP for this call.
  const overSocket = wantsSocket && (await apiSocket.ready());
  let answer = overSocket ? await callOverSocket(method, url, options.body) : null;
  if (answer === null || answer.status === 415 || answer.status === 421)
    answer = await callOverHttp(method, url, options.body);

  if (answer.status < 200 || answer.status >= 300) {
    let code = "http_error";
    let message: string = S.common.unknownError;
    const body = answer.body as { error?: { code?: string; message?: string } } | null;
    if (body !== null && typeof body === "object") {
      if (body.error?.code) code = body.error.code;
      if (body.error?.message) message = body.error.message;
    }
    // A 401 from ANOTHER machine is that machine's answer, not this server's: it means we
    // are not signed in over there, which says nothing about the session here. Treating it
    // as a local logout is how clicking a remote host in a picker bounced the window to the
    // login page of a server it was still perfectly signed in to.
    const fromThisServer = target === null;
    if (answer.status === 401 && fromThisServer && !isAuthEndpoint(path)) {
      apiSocket.identityChanged();
      onUnauthorized?.();
    }
    throw new ApiError(answer.status, code, message);
  }

  // What passes through here tells the socket who the page is: a `/api/me` answer names the
  // user, a sign-in or sign-out changes it. The socket never has to be told by anyone else.
  if (target === null) {
    if (path === "/api/me") {
      apiSocket.identityIs((answer.body as { user?: { userId?: string } })?.user?.userId ?? null);
    } else if (isAuthEndpoint(path)) {
      apiSocket.identityChanged();
    }
  }

  const headerDate = Date.parse(answer.date ?? "");
  const serverNowMs = Number.isFinite(headerDate) ? headerDate : null;
  return { data: (answer.status === 204 ? undefined : answer.body) as T, serverNowMs };
}

/** What either transport reduces a response to: the status, the parsed body (null when empty), the Date header. */
interface Answer {
  status: number;
  body: unknown;
  date: string | null;
}

/** The socket transport; null when the socket dropped before answering (the caller then fetches). */
async function callOverSocket(method: string, url: string, body: unknown): Promise<Answer | null> {
  try {
    const res = await apiSocket.call(method, url, body !== undefined ? { body } : {});
    return { status: res.status, body: res.body ?? null, date: res.headers.date ?? null };
  } catch {
    // The socket closed under the call. A lost answer is a lost answer whichever transport
    // lost it, so this is not retried blindly: the HTTP fallback is only for calls that never
    // left (the socket rejects before sending when it is not open), which is the isOpen()
    // check above. Here the frame may have been delivered — report it as a network error.
    throw new ApiError(0, "network_error", S.errors.networkError);
  }
}

async function callOverHttp(method: string, url: string, body: unknown): Promise<Answer> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: "same-origin",
      ...(body !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
        : {}),
    });
  } catch {
    throw new ApiError(0, "network_error", S.errors.networkError);
  }
  const date = response.headers.get("date");
  if (response.status === 204) return { status: 204, body: null, date };
  const text = await response.text();
  if (!text) return { status: response.status, body: null, date };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null; // Non-JSON body (an error page): the default message applies.
  }
  return { status: response.status, body: parsed, date };
}

/**
 * `fetch`, for the few callers that read the Response themselves (a status they act on, a
 * body they parse): the same request over the socket when it is open, handed back as a
 * Response, and a real fetch otherwise. Only the socket's own answers are carried — JSON
 * or empty bodies, no request body; anything else stays a plain fetch. Same-origin
 * credentials, as every API call here.
 */
export async function apiRequest(url: string, init: { method?: string } = {}): Promise<Response> {
  const path = url.split("?")[0] ?? url;
  const local = !url.startsWith("/server/");
  const overSocket = !(local && httpOnly(path)) && (await apiSocket.ready());
  if (overSocket) {
    try {
      const res = await apiSocket.call(init.method ?? "GET", url);
      if (res.status !== 415 && res.status !== 421) {
        const empty = res.body === null || res.status === 204 || res.status === 304;
        return new Response(empty ? null : JSON.stringify(res.body), {
          status: res.status,
          headers: { "content-type": "application/json", ...res.headers },
        });
      }
    } catch {
      throw new TypeError("network error"); // what fetch throws when the connection is lost
    }
  }
  return fetch(url, { ...init, credentials: "same-origin" });
}
