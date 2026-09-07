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
 * The socket is addressed by the signed-in user (the server's reserved terminal-stream id,
 * `apiSocketPath`), and this module finds out who that is BY ITSELF — asking `/api/me` over
 * HTTP once, or being told by the API client when a `/api/me` answer passes through it. No
 * caller has to know the socket exists: `ready()` settles the identity, opens the socket and
 * waits for the handshake, so the page's very first calls ride it rather than race it. A
 * sign-in or sign-out passing through the API client resets the identity, which closes the
 * socket; the next call opens the new user's.
 *
 * Without a socket — the browser cannot open one, or the handshake keeps failing — streams
 * fall back to EventSource (the caller supplies the fallback) and calls fall back to fetch.
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
/** A handshake refused outright (a runtime without the socket) is retried this soon — the backoff is for connections that were up and dropped. */
const REFUSED_RETRY_MS = 250;
/** A stream the server ended (or answered without streaming) is re-issued after this. */
const REISSUE_MS = 1_000;
/** The server's heartbeat cadence (socket/serve.ts); a socket silent for two beats is dead and is closed to reconnect. */
const HEARTBEAT_MS = 20_000;

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
  /** Who the page is signed in as, once settled (null = nobody); unset until asked. */
  #identity: Promise<string | null> | null = null;
  /** The user the current socket was opened for. */
  #openedFor: string | null = null;
  /**
   * Whether the identity behind the current handshake was just asked of the server over
   * HTTP: then the server is reachable, and a handshake that still fails is a refusal worth
   * counting towards giving up. A failure without that proof is a server that is down or
   * a network that is gone, and is only retried.
   */
  #freshProbe = false;
  /** This client is closing the socket itself (identity changed, watchdog): not a refusal. */
  #closingOnPurpose = false;
  /** Fires when the server has said nothing for two beats. */
  #watchdog: ReturnType<typeof setTimeout> | null = null;

  /**
   * `urlFor` spells the socket's address for a user; `whoAmI` finds out who is signed in
   * (null when nobody is), and may reject when it cannot tell — the question is then asked
   * again on the next call.
   */
  constructor(
    private readonly urlFor: (userId: string) => string,
    private readonly whoAmI: () => Promise<string | null>,
  ) {}

  isOpen(): boolean {
    return this.#state === "open";
  }

  /** The socket is not coming: callers use HTTP and EventSource. */
  isUnavailable(): boolean {
    return this.#state === "unavailable";
  }

  /**
   * The API client saw a `/api/me` answer: the identity is known without asking. A socket
   * open for someone else (the cookie was replaced under this tab) is closed.
   */
  identityIs(userId: string | null): void {
    this.#identity = Promise.resolve(userId);
    if (this.#ws !== null && this.#openedFor !== userId) this.#closeOnPurpose();
  }

  /**
   * A sign-in or sign-out went through, or the session was found expired: whoever the
   * socket was for, it is not that any more. It closes; the next call settles the identity
   * afresh and opens the right one.
   */
  identityChanged(): void {
    this.#identity = null;
    this.#closeOnPurpose();
  }

  #closeOnPurpose(): void {
    if (this.#ws === null) return;
    this.#closingOnPurpose = true;
    this.#ws.close();
  }

  /**
   * Whether a call can go over the socket — settling the identity and the handshake first
   * rather than deciding on the instant. True once open; false when the socket is not to be
   * had right now (nobody signed in, given up, or the handshake just failed), in which case
   * the caller uses HTTP.
   */
  async ready(): Promise<boolean> {
    if (this.#state === "open") return true;
    if (this.#state === "unavailable") return false;
    if (this.#state === "closed") {
      let userId: string | null;
      const fresh = this.#identity === null;
      try {
        userId = await (this.#identity ??= this.whoAmI());
      } catch {
        this.#identity = null; // could not tell (the server is unreachable): ask again next time
        return false;
      }
      if (userId === null) return false;
      this.#freshProbe = fresh;
      this.#open(this.urlFor(userId), userId);
    }
    const state = this.#stateNow(); // #open() moved it; read it afresh
    if (state !== "connecting") return state === "open";
    return new Promise((resolve) => this.#readyWaiters.push(resolve));
  }

  /** The state through a call, which the type checker cannot narrow across #open()'s mutation. */
  #stateNow(): State {
    return this.#state;
  }

  #settleReady(open: boolean): void {
    const waiters = this.#readyWaiters.splice(0);
    for (const resolve of waiters) resolve(open);
  }

  /**
   * Re-arms on every frame (the server's heartbeat among them). Silence for two beats is a
   * half-dead connection — a network that went away under the tab, a laptop back from
   * sleep — which the browser may take minutes to notice on its own; this closes it now, and
   * the ordinary reconnect brings the streams back with their last event ids.
   */
  #armWatchdog(): void {
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#watchdog = setTimeout(() => {
      this.#watchdog = null;
      this.#closeOnPurpose();
    }, 2 * HEARTBEAT_MS);
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
      if (this.#state === "open") this.#issue(entry);
      else void this.ready();
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

  /** Opens the socket; streams and calls queue behind the handshake. Only from ready(). */
  #open(url: string, userId: string): void {
    if (this.#state !== "closed") return;
    if (typeof WebSocket === "undefined") {
      this.#state = "unavailable";
      return;
    }
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
    this.#openedFor = userId;
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#state = "open";
      this.#attempts = 0;
      this.#neverOpened = 0;
      this.#armWatchdog();
      this.#settleReady(true);
      for (const entry of [...this.#waiting]) this.#issue(entry);
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      if (this.#ws !== ws) return;
      this.#armWatchdog();
      this.#frame(e.data);
    };
    ws.onclose = () => {
      if (this.#ws !== ws) return;
      const opened = this.#state === "open";
      const onPurpose = this.#closingOnPurpose;
      this.#closingOnPurpose = false;
      this.#ws = null;
      this.#openedFor = null;
      this.#state = "closed";
      if (this.#watchdog !== null) clearTimeout(this.#watchdog);
      this.#watchdog = null;
      if (!opened && !onPurpose) {
        // A handshake that never opened. Counted towards giving up only when the server was
        // just shown reachable (the identity was probed for this very attempt); otherwise
        // the identity is forgotten so the next attempt probes first — a server that is
        // down must not read as a server without a socket.
        if (this.#freshProbe) this.#neverOpened += 1;
        this.#identity = null;
      }
      this.#settleReady(false);
      this.#dropped(opened || onPurpose);
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here that it will not do.
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
      else void this.ready();
    }, delayMs);
  }

  #frame(raw: string): void {
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof frame.id !== "number") return; // a heartbeat: its arrival already re-armed the watchdog
    const id = frame.id;
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
    // A refusal from a reachable server is retried at once (it is cheap and answers fast);
    // a dropped connection, or a server that could not be reached, on the backoff.
    this.#scheduleReconnect(wasOpen || !this.#freshProbe ? this.#backoff() : REFUSED_RETRY_MS);
  }

  /**
   * Comes back for the parked streams. One attempt per timer; an attempt that could not
   * even reach the server (ready() false without a handshake) books the next one itself,
   * so a server that is down keeps being tried on the backoff until it is back.
   */
  #scheduleReconnect(delayMs: number): void {
    if (this.#reconnect !== null) return;
    this.#reconnect = setTimeout(() => {
      this.#reconnect = null;
      void this.ready().then((open) => {
        if (open || this.#state !== "closed" || this.#waiting.size === 0) return;
        this.#scheduleReconnect(this.#backoff());
      });
    }, delayMs);
  }

  #backoff(): number {
    const ms = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.#attempts);
    this.#attempts += 1;
    return ms;
  }
}

/** Who the page is signed in as, asked of the server over HTTP; null when nobody. Rejects when it cannot tell. */
async function whoAmI(): Promise<string | null> {
  const res = await fetch("/api/me", { credentials: "same-origin" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`/api/me answered ${res.status}`);
  const body = (await res.json()) as { user?: { userId?: string } };
  return body.user?.userId ?? null;
}

/** The page's socket: to this origin, same cookie the page holds, on the signed-in user's reserved id. */
export const apiSocket = new ApiSocket((userId) => {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${apiSocketPath(userId)}`;
}, whoAmI);
