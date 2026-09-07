/**
 * The API socket transport: `GET /api/socket` (Upgrade) — PRFC-0011.
 *
 * Runtime, and only the transport. Every `call` frame becomes a Request and goes through the
 * SAME entry the HTTP listener uses (the runtime app's fetch: auth guards, runtime routes,
 * the platform seam), and the Response comes back as frames. So this module knows no
 * endpoint: authorization, validation and error shapes are the endpoint's own, byte for byte
 * what HTTP answers, and a platform push that adds or changes a route needs nothing here.
 *
 * Credentials: the handshake is gated on the session cookie or a Bearer token — a socket a
 * stranger cannot open — and the SAME headers are copied onto every in-process Request, so
 * each call is authenticated by the app exactly as an HTTP request would be (a session that
 * expires mid-socket starts answering 401, as it would over HTTP). Frames cannot carry
 * credentials; CALL_HEADERS is the whole allowance.
 *
 * A `text/event-stream` Response is read to its end and re-framed per event (the SSE
 * heartbeat comments are dropped — the socket pings on its own); a cancel frame, the socket
 * closing, or the client lagging past HIGH_WATER aborts the Request, which is how the
 * endpoint's own subscription is released. Everything else is a one-shot frame.
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { SESSION_COOKIE } from "../auth/middleware.js";
import { isAllowedOrigin, readBearer, readCookie, refuse } from "../http/ws-handshake.js";
import type { Auth } from "../mechanisms/identity.js";
import { CALL_HEADERS, parseClientFrame } from "./frames.js";
import type { CallFrame, ServerFrame } from "./frames.js";
import { SseParser } from "./sse-text.js";

export const SOCKET_PATH = "/api/socket";

/** Same cadence as the SSE heartbeat: a peer that answers no ping within two beats is gone. */
export const HEARTBEAT_MS = 20_000;
/** A client this far behind on a stream is fast-forwarded (its stream ends with reason "lagging") rather than buffered without bound. */
export const HIGH_WATER_BYTES = 4 * 1024 * 1024;

/** Prefixes a call may address. `/api/hmr` is the rescue channel and never rides the socket; the socket itself is not an endpoint. */
function callable(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  if (pathname === SOCKET_PATH) return false;
  if (pathname === "/api/hmr" || pathname.startsWith("/api/hmr/")) return false;
  return pathname.startsWith("/api/") || pathname.startsWith("/server/");
}

export interface ApiSocketDeps {
  /** The runtime app's fetch — the one entry HTTP requests take. */
  fetch: (request: Request) => Promise<Response>;
  authService: Auth;
  log: (line: string) => void;
}

/** Headers of a response worth carrying back: the client reads `date` for server time. */
function responseHeaders(res: Response): Record<string, string> {
  const out: Record<string, string> = { date: new Date().toUTCString() };
  const type = res.headers.get("content-type");
  if (type !== null) out["content-type"] = type;
  return out;
}

export function attachApiSocket(server: HttpServer, deps: ApiSocketDeps): void {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== SOCKET_PATH) return; // not ours: another upgrade handler may claim it
    if (!isAllowedOrigin(req)) return refuse(socket, 403, "Forbidden");

    // Gate: the same two credentials the auth middleware honours, in the same order (an
    // explicit Bearer outranks the ambient cookie). Only the gate — each call is
    // re-authenticated by the app from the copied headers.
    const bearer = readBearer(req.headers.authorization);
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    const authed =
      bearer !== null
        ? deps.authService.authenticateApiToken(bearer)
        : cookie !== null
          ? deps.authService.authenticateWithMeta(cookie)
          : null;
    if (!authed) return refuse(socket, 401, "Unauthorized");

    const credentials: Record<string, string> = {};
    if (req.headers.authorization !== undefined)
      credentials.authorization = req.headers.authorization;
    if (req.headers.cookie !== undefined) credentials.cookie = req.headers.cookie;
    // The canonical-host guard reads the Host the browser targeted; in-process requests
    // carry the same one so a socket call is judged exactly as its HTTP twin.
    const origin = `http://${req.headers.host ?? "localhost"}`;

    wss.handleUpgrade(req, socket, head, (ws) => {
      serve(ws, { origin, credentials }, deps);
    });
  });
}

interface SocketContext {
  origin: string;
  credentials: Record<string, string>;
}

function serve(ws: WebSocket, ctx: SocketContext, deps: ApiSocketDeps): void {
  /** In-flight calls by id; a streaming call stays here until its end. */
  const inflight = new Map<number, AbortController>();
  let alive = true;

  const send = (frame: ServerFrame): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };

  // Liveness: ping on the SSE cadence; a peer silent for two beats is terminated, which
  // releases every subscription it held — the half-dead connection that used to hold an
  // SSE slot forever is exactly what this exists for.
  const heartbeat = setInterval(() => {
    if (!alive) {
      ws.terminate();
      return;
    }
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  ws.on("pong", () => {
    alive = true;
  });
  ws.on("message", () => {
    alive = true; // traffic is proof of life too
  });

  ws.on("message", (data, isBinary) => {
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
      send({
        id,
        status: 404,
        headers: { date: new Date().toUTCString() },
        body: { error: { code: "not_found", message: "Endpoint does not exist." } },
      });
      return;
    }
    const headers: Record<string, string> = { ...ctx.credentials };
    for (const [k, v] of Object.entries(call.headers ?? {}))
      if (CALL_HEADERS.has(k)) headers[k] = v;
    let body: string | undefined;
    if ("body" in call) {
      body = JSON.stringify(call.body);
      headers["content-type"] ??= "application/json";
    }

    let res: Response;
    try {
      res = await deps.fetch(
        new Request(new URL(call.path, ctx.origin), {
          method: call.method,
          headers,
          ...(body !== undefined ? { body } : {}),
          signal: controller.signal,
        }),
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      deps.log(`[socket] ${call.method} ${call.path}: ${err instanceof Error ? err.message : err}`);
      send({
        id,
        status: 500,
        headers: { date: new Date().toUTCString() },
        body: { error: { code: "internal", message: "Internal server error." } },
      });
      return;
    }
    if (controller.signal.aborted) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }

    const type = res.headers.get("content-type") ?? "";
    if (type.startsWith("text/event-stream")) return stream(id, res, controller);

    // One-shot: JSON parsed, text as text, an empty body as null. A body of another kind
    // (a download) does not ride this transport — the client falls back to HTTP on 415.
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
        send({
          id,
          status: 415,
          headers: { date: new Date().toUTCString() },
          body: {
            error: {
              code: "unsupported_transport",
              message: "This response does not ride the socket; use HTTP.",
            },
          },
        });
        return;
      }
    }
    send({ id, status: res.status, headers: responseHeaders(res), body: parsed });
  }

  async function stream(id: number, res: Response, controller: AbortController): Promise<void> {
    send({ id, status: res.status, stream: true, headers: responseHeaders(res) });
    const reader = res.body?.getReader();
    if (!reader) return send({ id, end: true, reason: "closed" });
    const stop = () => reader.cancel().catch(() => undefined);
    controller.signal.addEventListener("abort", stop, { once: true });
    const parser = new SseParser();
    const decoder = new TextDecoder();
    let reason: string | undefined = "closed";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (ws.bufferedAmount > HIGH_WATER_BYTES) {
          // Fast-forward, never buffer without bound: the client re-issues the call with
          // its last event id and the endpoint's own buffer fills the gap (or says resync).
          reason = "lagging";
          await stop();
          break;
        }
        for (const event of parser.feed(decoder.decode(value, { stream: true }))) {
          send({ id, event: event.event, eventId: event.id, data: event.data });
        }
      }
      const last = parser.flush();
      if (last !== null && reason === "closed") {
        send({ id, event: last.event, eventId: last.id, data: last.data });
      }
    } catch {
      // The reader was cancelled (our abort) or the endpoint failed; either way the stream is over.
    } finally {
      controller.signal.removeEventListener("abort", stop);
    }
    if (!controller.signal.aborted) send({ id, end: true, reason });
  }
}
