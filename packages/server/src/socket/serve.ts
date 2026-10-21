/**
 * The API socket protocol (PRFC-0011), served by the platform over a socket the runtime's
 * terminal-stream seam handed over (socket/ref.ts says how it gets here).
 *
 * The socket is a second TRANSPORT of the same API: every `call` frame becomes a Request
 * and goes through the platform app's own routes — the same ones the HTTP seam dispatches
 * into — and the Response comes back as frames. So this module knows no endpoint:
 * authorization, validation and error shapes are the endpoint's own, byte for byte what
 * HTTP answers, and a pushed route needs nothing here.
 *
 * Identity is settled before this runs: the runtime authenticated the handshake cookie and
 * handed over a reference naming that user, so the `fetch` handed in is already bound to them
 * (Http.fetchAs) — no credential travels with a frame, and there is nothing in a frame to
 * forge.
 *
 * A call that asks for an event stream is answered directly: its route sends the stream to
 * the call's own answer (stream-answer.ts) — a start frame, one frame per event, an end —
 * with no HTTP Response in between. A route that answers a Response instead — an auth
 * refusal, a machine's non-streaming answer — leaves the answer untouched, and that Response
 * is framed like any call's. A cancel frame, the socket closing, or the client lagging past
 * HIGH_WATER aborts the Request, which is how the endpoint's own subscription is released.
 * Sign-in and the upgrade channel answer 421 — a cookie cannot be set on a socket answer,
 * and a push must not ride the transport it replaces — as does anything the platform
 * declines: the client makes those calls over HTTP instead.
 */
import type { WebSocket } from "ws";
import { API_SOCKET_PATH, sessionKindPath } from "../api/types.js";
import { declined } from "../hmr/hono-seam.js";
import { CALL_HEADERS, parseClientFrame } from "./frames.js";
import type { CallFrame, ServerFrame } from "./frames.js";
import { StreamAnswer } from "./stream-answer.js";

/** Same cadence as the SSE heartbeat: a peer that answers no ping within two beats is gone. */
export const HEARTBEAT_MS = 20_000;
/** A client this far behind on a stream is fast-forwarded (its stream ends with reason "lagging") rather than buffered without bound. */
export const HIGH_WATER_BYTES = 4 * 1024 * 1024;

/** Made over HTTP, never on the socket: sign-in (it sets the cookie) and the upgrade channel. */
const HTTP_ONLY_PREFIXES = ["/api/auth", "/api/hmr"];

/** Whether a call must be made over HTTP instead (see HTTP_ONLY_PREFIXES and sessionKindPath). */
function httpOnly(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  return (
    HTTP_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`)) ||
    sessionKindPath(pathname)
  );
}

/** The decline marker the platform app answers a path it does not own with, read off one such answer. */
const DECLINE: [string, string] = (() => {
  const probe = declined();
  for (const [name, value] of probe.headers) return [name, value];
  return ["", ""];
})();

const isDeclined = (res: Response): boolean =>
  DECLINE[0] !== "" && res.headers.get(DECLINE[0]) === DECLINE[1];

/** Prefixes a call may address. Upgrade routes — a terminal stream, and this socket's own address — are not calls. */
function callable(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  if (pathname === API_SOCKET_PATH) return false;
  if (/^\/api\/terminals\/[^/]+\/stream$/.test(pathname)) return false;
  return pathname.startsWith("/api/") || pathname.startsWith("/server/");
}

export interface ApiSocketDeps {
  /** The platform's routes, entered as the socket's user (Http.fetchAs). */
  fetch: (request: Request) => Promise<Response>;
  /** The same routes, for a call that asks for an event stream: its answer rides the Request in (stream-answer.ts). */
  fetchStream: (request: Request, answer: StreamAnswer) => Promise<Response>;
  /** The origin in-process requests are addressed to (the canonical App host, as HTTP requests carry it). */
  origin: string;
  log: (line: string) => void;
}

function nowHeaders(): Record<string, string> {
  return { date: new Date().toUTCString() };
}

/** Headers of a response worth carrying back: the client reads `date` for server time. */
function responseHeaders(res: Response): Record<string, string> {
  const out = nowHeaders();
  // The headers the Web App's client reads off an answer (api/client.ts): its type, how long a
  // refusal asks it to wait, and the version a Workspace file write produced.
  for (const name of ["content-type", "retry-after", "etag"]) {
    const value = res.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export function serveApiSocket(ws: WebSocket, deps: ApiSocketDeps): void {
  /** In-flight calls by id; a streaming call stays here until its answer is over. */
  const inflight = new Map<number, AbortController>();
  let alive = true;

  const send = (frame: ServerFrame): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };

  const reject = (id: number, status: number, code: string, message: string): void => {
    send({ id, status, headers: nowHeaders(), body: errorBody(code, message) });
  };
  const httpRequired = (id: number): void =>
    reject(id, 421, "not_on_socket", "This endpoint is served over HTTP only.");

  // Liveness, both ways, on the SSE cadence. A protocol ping: a peer that answers none for
  // two beats is terminated, which releases every subscription it held — the half-dead
  // connection that used to hold an SSE slot forever is exactly what this exists for. And a
  // heartbeat FRAME: a browser cannot see pings, so this is what its own watchdog hears.
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
    send({ heartbeat: true });
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  ws.on("pong", () => {
    alive = true;
  });

  ws.on("message", (data, isBinary) => {
    alive = true; // traffic is proof of life too
    if (isBinary) return ws.close(1003, "binary frames are reserved");
    const parsed = parseClientFrame(data.toString());
    if ("error" in parsed) return ws.close(1002, parsed.error);
    const frame = parsed.frame;
    if ("cancel" in frame) {
      inflight.get(frame.id)?.abort();
      return;
    }
    if (inflight.has(frame.id)) return ws.close(1002, `call id ${frame.id} is in flight`);
    const controller = new AbortController();
    inflight.set(frame.id, controller);
    void dispatch(frame, controller).finally(() => inflight.delete(frame.id));
  });

  ws.on("close", () => {
    clearInterval(heartbeat);
    for (const controller of inflight.values()) controller.abort();
    inflight.clear();
  });
  ws.on("error", (err) => deps.log(`[socket] ${err.message}`));

  async function dispatch(frame: CallFrame, controller: AbortController): Promise<void> {
    const { id, call } = frame;
    if (!callable(call.path)) {
      reject(id, 404, "not_found", "Endpoint does not exist.");
      return;
    }
    if (httpOnly(call.path)) {
      httpRequired(id);
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(call.headers ?? {}))
      if (CALL_HEADERS.has(k)) headers[k] = v;
    let body: string | undefined;
    if ("body" in call) {
      body = JSON.stringify(call.body);
      headers["content-type"] ??= "application/json";
    }
    const request = new Request(new URL(call.path, deps.origin), {
      method: call.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      signal: controller.signal,
    });
    // The client marks a stream call with the one header of its own it may set (CALL_HEADERS
    // lets it through): that call is handed the answer bound to its id, for its route to
    // answer the stream directly (stream-answer.ts). Every other call is made as any call
    // is, and whatever Response comes back is framed below.
    const answer = (headers["accept"] ?? "").includes("text/event-stream")
      ? new StreamAnswer(id, send, controller, () => ws.bufferedAmount > HIGH_WATER_BYTES)
      : null;
    let res: Response;
    try {
      res = await (answer === null ? deps.fetch(request) : deps.fetchStream(request, answer));
    } catch (err) {
      if (controller.signal.aborted) return;
      deps.log(`[socket] ${call.method} ${call.path}: ${err instanceof Error ? err.message : err}`);
      reject(id, 500, "internal", "Internal server error.");
      return;
    }
    if (answer?.started) {
      // The route answered the stream itself: the Response it returned carries nothing, and
      // the id stays in flight until the answer is over — a cancel frame still reaches it.
      await res.body?.cancel().catch(() => undefined);
      await answer.done;
      return;
    }
    if (controller.signal.aborted) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    await answerOnce(id, res);
  }

  /** Frames a Response a route answered without streaming, as any call's answer. */
  async function answerOnce(id: number, res: Response): Promise<void> {
    if (isDeclined(res)) {
      // Not the platform's to answer: not this transport's to carry either.
      httpRequired(id);
      return;
    }
    // One-shot: JSON parsed, text as text, an empty body as null. A body of another kind
    // (a download) does not ride this transport — the client falls back to HTTP on 415.
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    if (text !== "") {
      if (type.includes("json")) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      } else if (type.startsWith("text/")) {
        parsed = text;
      } else {
        reject(
          id,
          415,
          "unsupported_transport",
          "This response does not ride the socket; use HTTP.",
        );
        return;
      }
    }
    send({ id, status: res.status, headers: responseHeaders(res), body: parsed });
  }
}
