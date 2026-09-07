/**
 * The API socket client (PRFC-0011): one WebSocket per tab, carrying calls to the same
 * endpoints `apiFetch` speaks over HTTP.
 *
 * A call is a frame `{ id, call: { method, path, headers?, body? } }` and its answer is one
 * frame (`{ id, status, headers, body }`) or, for a `text/event-stream` endpoint, a `stream`
 * frame followed by one frame per event and an `end`. The server frames whatever the endpoint
 * answered — the socket adds no semantics of its own, so `apiFetch` treats a socket answer
 * exactly as it treats a fetch Response.
 *
 * Streams are the reason this exists: every long-lived subscription — this server's events,
 * each machine's events, the open chat's Session stream — used to be its own HTTP connection,
 * and a browser allows six per host, so a few machines and one chat left nothing for the
 * requests that draw the page. Here they are all calls on one socket. The client remembers
 * each stream's last event id and re-issues it (with `last-event-id`) after any interruption:
 * the socket dropping and reconnecting, the server ending it (`lagging`, or the machine
 * behind it going away), or an answer that was not a stream at all but may become one again
 * (a 503 while a machine reconnects). Fatal answers (401/403/404) stop the retries.
 *
 * Without a socket — the browser cannot open one, or the handshake keeps failing — streams
 * fall back to EventSource (the caller supplies the fallback) and calls fall back to fetch,
 * which is why `apiFetch` asks `isOpen()` first rather than waiting.
 */
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import { apiSocketPath } from "@prismshadow/penguin-server/api";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import type { StreamConnection, StreamHandlers } from "./sse";

/** Reconnect backoff, the ssh reconnect's shape: doubling from the floor to the ceiling. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
/** Consecutive handshakes that never opened before the page gives the socket up for EventSource and fetch. */
const GIVE_UP_AFTER = 3;
/** A handshake refused outright (a runtime without the socket, a session not yet signed in) is retried this soon — the backoff is for connections that were up and dropped. */
const REFUSED_RETRY_MS = 250;
/** A stream the server ended (or answered without streaming) is re-issued after this. */
const REISSUE_MS = 1_000;

export interface SocketCallResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface PendingCall {
  resolve: (r: SocketCallResult) => void;
  reject: (err: Error) => void;
}

interface StreamEntry {
  path: string;
  handlers: StreamHandlers;
  fallback: () => StreamConnection;
  /** The call id while the stream is issued on the live socket; null between issues. */
  id: number | null;
  lastEventId: string | null;
  retry: ReturnType<typeof setTimeout> | null;
  /** Set once the entry has been handed to EventSource; the socket never touches it again. */
  fallen: StreamConnection | null;
  closed: boolean;
}

type State = "closed" | "connecting" | "open" | "unavailable";

/** Answers the socket cannot make useful: the endpoint refused, and will keep refusing. */
function fatal(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

export class ApiSocket {
  #ws: WebSocket | null = null;
  #state: State = "closed";
  #next = 1;
  readonly #calls = new Map<number, PendingCall>();
  readonly #streams = new Map<number, StreamEntry>();
  readonly #waiting = new Set<StreamEntry>();
  #attempts = 0;
  #neverOpened = 0;
  #reconnect: ReturnType<typeof setTimeout> | null = null;
  /** Calls waiting on a handshake in progress (see ready()). */
  readonly #readyWaiters: ((open: boolean) => void)[] = [];

  /** `url` answers null while nobody is signed in: the socket is addressed by user (see the module doc), so there is nothing to open yet. */
  constructor(private readonly url: () => string | null) {}

  isOpen(): boolean {
    return this.#state === "open";
  }

  /** The socket is not coming: callers use HTTP and EventSource. */
  isUnavailable(): boolean {
    return this.#state === "unavailable";
  }

  /**
   * The signed-in user changed (or signed out): the socket was that user's, so it closes;
   * whatever streams are still wanted re-issue on the next user's socket. Called by the auth
   * provider whenever it learns who the page is.
   */
  userChanged(): void {
    if (this.#ws !== null) this.#ws.close();
  }

  /**
   * Whether a call can go over the socket, waiting for a handshake in progress rather than
   * deciding on the instant: true once open, false when the socket is not to be had right
   * now (nobody signed in, given up, or the handshake just failed) — the caller then uses
   * HTTP. Opens the socket if nothing has yet, so the page's first calls ride it instead of
   * racing it.
   */
  ready(): Promise<boolean> {
    if (this.#state === "open") return Promise.resolve(true);
    if (this.#state === "unavailable") return Promise.resolve(false);
    if (this.#state === "closed") this.ensureOpen();
    if (this.#state !== "connecting") return Promise.resolve(false);
    return new Promise((resolve) => this.#readyWaiters.push(resolve));
  }

  #settleReady(open: boolean): void {
    const waiters = this.#readyWaiters.splice(0);
    for (const resolve of waiters) resolve(open);
  }

  /** Opens the socket if it is closed; streams and calls queue behind the handshake. */
  ensureOpen(): void {
    if (this.#state !== "closed") return;
    if (typeof WebSocket === "undefined") {
      this.#state = "unavailable";
      return;
    }
    const url = this.url();
    if (url === null) return; // nobody signed in yet: streams wait, calls use HTTP
    this.#state = "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.#state = "closed";
      this.#dropped(false);
      return;
    }
    this.#ws = ws;
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#state = "open";
      this.#attempts = 0;
      this.#neverOpened = 0;
      this.#settleReady(true);
      for (const entry of [...this.#waiting]) this.#issue(entry);
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      if (this.#ws === ws) this.#frame(e.data);
    };
    ws.onclose = () => {
      if (this.#ws !== ws) return;
      const opened = this.#state === "open";
      this.#ws = null;
      this.#state = "closed";
      if (!opened) this.#neverOpened += 1;
      this.#settleReady(false);
      this.#dropped(opened);
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here that it will not do.
    };
  }

  /**
   * One call over the open socket. Rejects with `socket_closed` if the socket drops before
   * the answer — the caller decides what a lost answer means for its method.
   */
  call(
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<SocketCallResult> {
    if (this.#state !== "open" || this.#ws === null) {
      return Promise.reject(new Error("socket_closed"));
    }
    const id = this.#next++;
    const frame: Record<string, unknown> = { id, call: { method, path, ...opts } };
    return new Promise<SocketCallResult>((resolve, reject) => {
      this.#calls.set(id, { resolve, reject });
      this.#ws!.send(JSON.stringify(frame));
    });
  }

  /**
   * A streaming subscription that survives every interruption until `close()`. `fallback`
   * builds the EventSource equivalent, used when the socket is not coming.
   */
  stream(
    path: string,
    handlers: StreamHandlers,
    fallback: () => StreamConnection,
  ): StreamConnection {
    const entry: StreamEntry = {
      path,
      handlers,
      fallback,
      id: null,
      lastEventId: null,
      retry: null,
      fallen: null,
      closed: false,
    };
    if (this.isUnavailable()) {
      entry.fallen = fallback();
    } else {
      this.#waiting.add(entry);
      this.ensureOpen();
      if (this.#state === "open") this.#issue(entry);
    }
    return {
      close: () => {
        entry.closed = true;
        entry.fallen?.close();
        if (entry.retry !== null) clearTimeout(entry.retry);
        this.#waiting.delete(entry);
        if (entry.id !== null) {
          this.#streams.delete(entry.id);
          if (this.#ws !== null && this.#state === "open") {
            this.#ws.send(JSON.stringify({ id: entry.id, cancel: true }));
          }
          entry.id = null;
        }
      },
    };
  }

  #issue(entry: StreamEntry): void {
    if (entry.closed || entry.fallen !== null || this.#ws === null || this.#state !== "open")
      return;
    this.#waiting.delete(entry);
    const id = this.#next++;
    entry.id = id;
    this.#streams.set(id, entry);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (entry.lastEventId !== null) headers["last-event-id"] = entry.lastEventId;
    this.#ws.send(JSON.stringify({ id, call: { method: "GET", path: entry.path, headers } }));
  }

  /** The stream is off the socket for now; issue it again after a pause (or at once on reconnect). */
  #reissue(entry: StreamEntry, delayMs: number): void {
    if (entry.id !== null) {
      this.#streams.delete(entry.id);
      entry.id = null;
    }
    if (entry.closed) return;
    this.#waiting.add(entry);
    if (entry.retry !== null) clearTimeout(entry.retry);
    entry.retry = setTimeout(() => {
      entry.retry = null;
      if (this.#state === "open") this.#issue(entry);
      else this.ensureOpen();
    }, delayMs);
  }

  #frame(raw: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const id = frame.id as number;
    const stream = this.#streams.get(id);
    if (stream !== undefined) {
      if ("event" in frame) {
        const eventId = (frame.eventId as string | null) ?? null;
        if (eventId !== null) stream.lastEventId = eventId;
        let data: unknown;
        try {
          data = JSON.parse(frame.data as string);
        } catch {
          return; // single-line JSON by protocol; anything else is skipped as EventSource would
        }
        if (frame.event === "server_event") {
          stream.handlers.onServerEvent(data as ServerEvent, eventId);
        } else {
          stream.handlers.onOmniMessage(data as OmniMessage, eventId);
        }
      } else if ("stream" in frame) {
        stream.handlers.onOpen?.();
      } else if ("end" in frame) {
        stream.handlers.onError?.(false);
        this.#reissue(stream, REISSUE_MS);
      } else {
        // Answered without streaming: the endpoint refused (fatal) or is not ready (retry).
        const status = frame.status as number;
        if (fatal(status)) {
          this.#streams.delete(id);
          stream.id = null;
          stream.handlers.onError?.(true);
        } else {
          stream.handlers.onError?.(false);
          this.#reissue(stream, this.#backoff());
        }
      }
      return;
    }
    const pending = this.#calls.get(id);
    if (pending === undefined) return;
    this.#calls.delete(id);
    pending.resolve({
      status: frame.status as number,
      headers: (frame.headers as Record<string, string> | undefined) ?? {},
      body: frame.body,
    });
  }

  /** The socket is gone: fail the calls, park the streams, and decide whether to come back. */
  #dropped(wasOpen: boolean): void {
    for (const pending of this.#calls.values()) pending.reject(new Error("socket_closed"));
    this.#calls.clear();
    for (const entry of this.#streams.values()) {
      entry.id = null;
      entry.handlers.onError?.(false);
      this.#waiting.add(entry);
    }
    this.#streams.clear();

    if (this.#neverOpened >= GIVE_UP_AFTER) {
      this.#state = "unavailable";
      for (const entry of this.#waiting) {
        if (entry.closed) continue;
        entry.fallen = entry.fallback();
      }
      this.#waiting.clear();
      return;
    }
    if (this.#waiting.size === 0) return; // nothing to carry: reopen lazily on the next ask
    if (this.#reconnect !== null) return;
    this.#reconnect = setTimeout(
      () => {
        this.#reconnect = null;
        this.ensureOpen();
      },
      wasOpen ? this.#backoff() : REFUSED_RETRY_MS,
    );
  }

  #backoff(): number {
    const ms = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.#attempts);
    this.#attempts += 1;
    return ms;
  }
}

/** Who the page is signed in as, told by the auth provider; the socket is addressed by it. */
let socketUserId: string | null = null;

/**
 * The auth provider's report of the signed-in user. A change closes the current socket
 * (it was the previous user's); the next stream or call opens the new user's.
 */
export function setSocketUser(userId: string | null): void {
  if (userId === socketUserId) return;
  socketUserId = userId;
  apiSocket.userChanged();
  // Open at once: the page's first calls are about to be made, and ready() lets them wait
  // for this handshake rather than fall to HTTP.
  if (userId !== null) apiSocket.ensureOpen();
}

/** The page's socket: to this origin, same cookie the page holds, on the signed-in user's reserved id. */
export const apiSocket = new ApiSocket(() => {
  if (socketUserId === null) return null;
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${apiSocketPath(socketUserId)}`;
});
