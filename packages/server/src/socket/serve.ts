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
 * held the reserved id's owner to it, so the `fetch` handed in is already bound to that user
 * (Http.fetchAs) — no credential travels with a frame, and there is nothing in a frame to
 * forge.
 *
 * A `text/event-stream` Response is read to its end and re-framed per event (the SSE
 * heartbeat comments are dropped — the socket pings on its own); a cancel frame, the socket
 * closing, or the client lagging past HIGH_WATER aborts the Request, which is how the
 * endpoint's own subscription is released. Everything else is a one-shot frame. A request
 * the platform declines (a runtime-owned path such as /api/auth) answers 421: the client
 * makes that call over HTTP instead.
 */
import type { WebSocket } from "ws";
import { declined } from "../hmr/hono-seam.js";
import { CALL_HEADERS, parseClientFrame } from "./frames.js";
import type { CallFrame, ServerFrame } from "./frames.js";
import { SseParser } from "./sse-text.js";

/** Same cadence as the SSE heartbeat: a peer that answers no ping within two beats is gone. */
export const HEARTBEAT_MS = 20_000;
/** A client this far behind on a stream is fast-forwarded (its stream ends with reason "lagging") rather than buffered without bound. */
export const HIGH_WATER_BYTES = 4 * 1024 * 1024;

/** The decline marker the platform app answers runtime-owned paths with, read off one such answer. */
const DECLINE: [string, string] = (() => {
  const probe = declined();
  for (const [name, value] of probe.headers) return [name, value];
  return ["", ""];
})();

const isDeclined = (res: Response): boolean =>
  DECLINE[0] !== "" && res.headers.get(DECLINE[0]) === DECLINE[1];

/** Prefixes a call may address. The terminal streams (the socket's own path among them) are upgrades, not calls. */
function callable(path: string): boolean {
  const pathname = path.split("?")[0] ?? path;
  if (/^\/api\/terminals\/[^/]+\/stream$/.test(pathname)) return false;
  return pathname.startsWith("/api/") || pathname.startsWith("/server/");
}

export interface ApiSocketDeps {
  /** The platform's routes, entered as the socket's user (Http.fetchAs). */
  fetch: (request: Request) => Promise<Response>;
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
  const type = res.headers.get("content-type");
  if (type !== null) out["content-type"] = type;
  return out;
}

const errorBody = (code: string, message: string) => ({ error: { code, message } });

export function serveApiSocket(ws: WebSocket, deps: ApiSocketDeps): void {
  /** In-flight calls by id; a streaming call stays here until its end. */
  const inflight = new Map<number, AbortController>();
  let alive = true;

  const send = (frame: ServerFrame): void => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
  };

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
      send({
        id,
        status: 404,
        headers: nowHeaders(),
        body: errorBody("not_found", "Endpoint does not exist."),
      });
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

    let res: Response;
    try {
      res = await deps.fetch(
        new Request(new URL(call.path, deps.origin), {
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
        headers: nowHeaders(),
        body: errorBody("internal", "Internal server error."),
      });
      return;
    }
    if (controller.signal.aborted) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }
    if (isDeclined(res)) {
      // Runtime-owned (auth, hmr, desktop): not this transport's to carry.
      send({
        id,
        status: 421,
        headers: nowHeaders(),
        body: errorBody("not_on_socket", "This endpoint is served over HTTP only."),
      });
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
          headers: nowHeaders(),
          body: errorBody(
            "unsupported_transport",
            "This response does not ride the socket; use HTTP.",
          ),
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
