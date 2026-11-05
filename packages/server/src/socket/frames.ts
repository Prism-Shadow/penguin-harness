/**
 * The frames of the API socket (PRFC-0011): one JSON object per text frame.
 *
 * The socket is a second TRANSPORT of the same API, not a second API: a `call` frame names
 * an existing endpoint — method, path, a whitelisted header or two, a JSON body — and gets
 * that endpoint's own response back, framed. A one-shot response is one frame; a
 * `text/event-stream` response is a `stream` frame, then one frame per event, then `end`.
 * Ids are the client's, unique for the life of the socket; the server never invents one.
 */

/** Client -> server: invoke an endpoint. */
export interface CallFrame {
  id: number;
  call: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    /** Path with its query string; `/api/…` or `/server/<machineId>/api/…`. */
    path: string;
    /** Only CALL_HEADERS are honoured; credentials come from the handshake, never from here. */
    headers?: Record<string, string>;
    /** JSON body; sent as application/json. Multipart bodies do not ride this transport. */
    body?: unknown;
  };
}

/** Client -> server: end a streaming call (unsubscribe). Unknown ids are ignored. */
export interface CancelFrame {
  id: number;
  cancel: true;
}

/**
 * Client -> server: how much of a credit-flow stream (`x-flow: credit`) the client has
 * handled — the summed `data` length (JS string length) of every event frame of that call so
 * far except `ping`, cumulative. The server keeps at most the call's window of unacknowledged
 * data in flight (stream-answer.ts); a call without the header is never held back, and an ack
 * for an unknown id or a call without the header is ignored. A client sends acks only for a
 * stream whose start frame echoed `x-flow: credit`: a server older than acks would close the
 * socket on one.
 */
export interface AckFrame {
  id: number;
  ack: number;
}

export type ClientFrame = CallFrame | CancelFrame | AckFrame;

/** Server -> client: a one-shot response, whole. */
export interface ResponseFrame {
  id: number;
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON for a JSON response, the text for a text one, null for an empty body. */
  body: unknown;
}

/** Server -> client: a streaming response has begun; events follow until `end`. */
export interface StreamStartFrame {
  id: number;
  status: number;
  stream: true;
  headers: Record<string, string>;
}

/** Server -> client: one event of a streaming response (SSE's id / event / data). */
export interface EventFrame {
  id: number;
  event: string;
  eventId: string | null;
  data: string;
}

/** Server -> client: a streaming response is over. */
export interface EndFrame {
  id: number;
  end: true;
  /** Why, when the client should act on it: "lagging" (re-issue with last-event-id), "not_connected" (machine gone), "closed" (endpoint closed the stream). */
  reason?: string;
}

/**
 * Server -> client: liveness the client can see. A browser cannot observe protocol pings, so
 * the server also says "still here" as a frame on the same cadence; a client that hears
 * nothing for two beats closes and reconnects instead of sitting on a half-dead connection.
 */
export interface HeartbeatFrame {
  heartbeat: true;
}

export type ServerFrame = ResponseFrame | StreamStartFrame | EventFrame | EndFrame | HeartbeatFrame;

/** Request headers a call may set; everything else in `headers` is dropped. */
export const CALL_HEADERS: ReadonlySet<string> = new Set([
  "last-event-id",
  "accept",
  "content-type",
  // `credit`: a stream call opts into acknowledged flow (AckFrame).
  "x-flow",
]);

/** The `x-flow` value that opts a stream call into acknowledged flow. */
export const CREDIT_FLOW = "credit";

const METHODS: ReadonlySet<string> = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/**
 * A client frame, or the reason it is not one. Strict on purpose: a frame this server does
 * not understand is answered with a closed socket, not a guess — the client is this repo's
 * own, and a malformed frame is a bug, not a dialect.
 */
export function parseClientFrame(raw: string): { frame: ClientFrame } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "frame is not JSON" };
  }
  if (typeof value !== "object" || value === null) return { error: "frame is not an object" };
  const o = value as Record<string, unknown>;
  if (typeof o.id !== "number" || !Number.isInteger(o.id) || o.id < 0) {
    return { error: "frame id must be a non-negative integer" };
  }
  if (o.cancel === true) return { frame: { id: o.id, cancel: true } };
  if ("ack" in o) {
    if (typeof o.ack !== "number" || !Number.isFinite(o.ack) || o.ack < 0) {
      return { error: "frame ack must be a non-negative number" };
    }
    return { frame: { id: o.id, ack: o.ack } };
  }
  const call = o.call;
  if (typeof call !== "object" || call === null)
    return { error: "frame carries neither call, cancel nor ack" };
  const c = call as Record<string, unknown>;
  if (typeof c.method !== "string" || !METHODS.has(c.method))
    return { error: "call.method is not a method" };
  if (typeof c.path !== "string" || !c.path.startsWith("/"))
    return { error: "call.path is not a path" };
  let headers: Record<string, string> | undefined;
  if (c.headers !== undefined) {
    if (typeof c.headers !== "object" || c.headers === null)
      return { error: "call.headers is not an object" };
    headers = {};
    for (const [k, v] of Object.entries(c.headers as Record<string, unknown>)) {
      if (typeof v !== "string") return { error: `call.headers.${k} is not a string` };
      headers[k.toLowerCase()] = v;
    }
  }
  return {
    frame: {
      id: o.id,
      call: {
        method: c.method as CallFrame["call"]["method"],
        path: c.path,
        ...(headers !== undefined ? { headers } : {}),
        ...("body" in c ? { body: c.body } : {}),
      },
    },
  };
}
