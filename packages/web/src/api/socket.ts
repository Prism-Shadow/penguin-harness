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
 * The socket's address is the server's own route for it (`apiSocketPath`); who it opens as is
 * its cookie, so this module finds out who that is BY ITSELF — asking `/api/me` over HTTP
 * once, or being told by the API client when a `/api/me` answer passes through it. No
 * caller has to know the socket exists: `ready()` settles the identity, opens the socket and
 * waits for the handshake, so the page's very first calls ride it rather than race it. A
 * sign-in or sign-out passing through the API client resets the identity, which closes the
 * socket; the next call opens the new user's.
 *
 * A call is never answered by opening a second transport beside the socket: made while it is
 * not open, the call waits for the next handshake, so the page's requests queue behind one
 * connection instead of each taking one of the browser's six to this origin. Only a page with
 * no socket at all — no WebSocket in the browser, nobody signed in, the server unreachable —
 * refuses them, and its streams wait in silence. A connection that drops and a handshake that
 * never opens are the same thing to this client: both are retried on the one doubling
 * backoff, for as long as the tab is open.
 */
import type { AmspRecord } from "@prismshadow/amsp";
import type { ServerEvent } from "@prismshadow/penguin-server/api";
import type { StreamConnection, StreamHandlers } from "./sse";

/** Reconnect backoff, the ssh reconnect's shape: doubling from the floor to the ceiling. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const backoffMs = (fails: number): number =>
  Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** fails);
/** A stream the server ended (or answered without streaming) is re-issued after this. */
const REISSUE_MS = 1_000;
/** The server's heartbeat cadence (socket/serve.ts); a socket silent for two beats is dead and is closed to reconnect. */
const HEARTBEAT_MS = 20_000;
/**
 * A handshake still not open after this is closed and tried again: the browser reports
 * nothing about a handshake that neither completes nor fails, and every call waits behind it.
 */
const HANDSHAKE_TIMEOUT_MS = 10_000;
/**
 * A one-shot call the server has not answered after this is given up on — with a warning
 * saying so, because a socket that keeps its heartbeat while answering nothing is otherwise
 * invisible: no error, no closed connection, nothing in the network log — and with a cancel
 * frame, so the server stops working it. The caller decides whether to make the call over
 * HTTP (api/client.ts), from `SocketTimeoutError.socketLive`.
 */
export const ANSWER_TIMEOUT_MS = 20_000;
/** A stream the server has not opened after this is issued again, with the same warning. */
const STREAM_OPEN_TIMEOUT_MS = 20_000;

/**
 * A one-shot call given up on (ANSWER_TIMEOUT_MS). `socketLive` says whether the server sent
 * any frame on this socket while the call waited: then the socket was carrying traffic and
 * it is the endpoint behind it that is silent — asking again over HTTP reaches the same
 * route, and for a machine the same held forward (api/client.ts decides with it).
 */
export class SocketTimeoutError extends Error {
  constructor(readonly socketLive: boolean) {
    super("socket_timeout");
  }
}

export interface SocketCallResult {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

interface PendingCall {
  method: string;
  path: string;
  resolve: (r: SocketCallResult) => void;
  reject: (err: Error) => void;
  deadline: ReturnType<typeof setTimeout>;
}

/** A call made while the socket was not open: it waits for a handshake and is sent by it. */
interface QueuedCall {
  method: string;
  path: string;
  opts: { headers?: Record<string, string>; body?: unknown };
  resolve: (r: SocketCallResult) => void;
  reject: (err: Error) => void;
  /**
   * The identity generation this call was made under (see `#identityMoved`): a call held
   * across a sign-in, a sign-out or a different user's `/api/me` is never sent.
   */
  generation: number;
}

interface StreamEntry {
  path: string;
  handlers: StreamHandlers;
  /** The call id while the stream is issued on the live socket; null between issues. */
  id: number | null;
  /** Fires when the server has not opened the issued stream in time. */
  openDeadline: ReturnType<typeof setTimeout> | null;
  lastEventId: string | null;
  retry: ReturnType<typeof setTimeout> | null;
  /** Issues in a row that did not open; the stream's own backoff, reset when it opens. */
  failures: number;
  closed: boolean;
  /**
   * The cadence this stream is expected to speak at, in ms (the caller's `heartbeatMs`), or
   * null when the caller asked for no per-stream watchdog. The socket's own heartbeat says
   * the SOCKET is alive; only the stream's own frames say the STREAM is, which is the fact a
   * machine whose server stopped answering while its socket stayed healthy hides.
   */
  heartbeatMs: number | null;
  /** Fires when no frame carrying this stream's id has arrived for two beats. */
  streamDeadline: ReturnType<typeof setTimeout> | null;
  /** The caller asked for acknowledged flow (`StreamOptions.flow`). */
  flow: boolean;
  /** Event data handled on the current issue, the cumulative figure an ack reports. */
  handled: number;
}

/** What `stream` may be told beyond the handlers; see `heartbeatMs`. */
export interface StreamOptions {
  /**
   * The cadence the stream is expected to speak at, in ms. When set, a stream silent for two
   * beats is ended here and re-subscribed from its last event id — the same two-beats reading
   * the socket's own watchdog makes of the socket (PRFC-0011). Only a stream that actually
   * carries a beat should ask for it: on a stream that can legitimately go quiet, the watchdog
   * would end a healthy subscription every two beats forever.
   */
  heartbeatMs?: number;
  /**
   * Acknowledged flow (`x-flow: credit`, the server's socket/frames.ts AckFrame): the stream
   * acknowledges the event data it has handled, and the server keeps no more than its window
   * of unacknowledged data in flight — for an endpoint that ships bulk, so one big transfer
   * cannot hold back the socket's other calls. Only an endpoint that paces its events reads
   * the header; on any other it changes nothing.
   */
  flow?: boolean;
}

type State = "closed" | "connecting" | "open" | "unavailable";

/** What the socket is doing right now, for a caller that has waited too long and wants to say why. */
export interface SocketReport {
  state: State;
  /** Milliseconds since the server's last frame on the open socket; null when it is not open. */
  lastFrameAgoMs: number | null;
  /** One-shot calls awaiting an answer, as `METHOD path`. */
  pendingCalls: string[];
  /** Streams issued on the socket, by path. */
  streams: string[];
}

/** Answers the socket cannot make useful: the endpoint refused, and will keep refusing. */
function fatal(status: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

export class ApiSocket {
  #ws: WebSocket | null = null;
  #state: State = "closed";
  #next = 1;
  readonly #calls = new Map<number, PendingCall>();
  /** Calls made before the socket was open, in the order they were made (see call()). */
  readonly #queued: QueuedCall[] = [];
  readonly #streams = new Map<number, StreamEntry>();
  readonly #waiting = new Set<StreamEntry>();
  #attempts = 0;
  /** Why the last socket closed, as the browser reports it — the one fact a refused handshake leaves behind. */
  #lastClose = "never closed";
  #reconnect: ReturnType<typeof setTimeout> | null = null;
  /** Calls waiting on a handshake in progress (see ready()). */
  readonly #readyWaiters: ((open: boolean) => void)[] = [];
  /** Who the page is signed in as, once settled (null = nobody); unset until asked. */
  #identity: Promise<string | null> | null = null;
  /** The user the identity last settled as; undefined until it is first settled. */
  #identityUser: string | null | undefined = undefined;
  /**
   * Which identity the queued calls belong to. Bumped whenever the page's identity is known
   * to have moved, so a call Alice queued while the socket was down can never be flushed
   * under Bob's authorization (see `#identityMoved`).
   */
  #generation = 0;
  /** The user the current socket was opened for. */
  #openedFor: string | null = null;
  /** This client is closing the socket itself (identity changed, watchdog): not a refusal. */
  #closingOnPurpose = false;
  /** Fires when the server has said nothing for two beats. */
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  /** Fires when a handshake has neither opened nor failed in time. */
  #handshakeDeadline: ReturnType<typeof setTimeout> | null = null;
  /** When the server's last frame arrived on the open socket (performance.now()). */
  #lastFrameAt = 0;
  /** Frames received on the current socket, heartbeats included (a call's timeout compares it). */
  #framesSeen = 0;

  /**
   * `urlFor` spells the socket's address for a user; `whoAmI` finds out who is signed in
   * (null when nobody is), and may reject when it cannot tell — the question is then asked
   * again on the next call.
   */
  /**
   * `available` false starts the socket as unavailable: there is nothing it could connect to,
   * so callers go straight to HTTP without settling an identity first.
   */
  constructor(
    private readonly urlFor: (userId: string) => string,
    private readonly whoAmI: () => Promise<string | null>,
    available = true,
  ) {
    if (!available) this.#state = "unavailable";
  }

  isOpen(): boolean {
    return this.#state === "open";
  }

  /** The socket's state and what is waiting on it — for the warning a caller prints when it has waited too long. */
  report(): SocketReport {
    return {
      state: this.#state,
      lastFrameAgoMs:
        this.#state === "open" ? Math.round(performance.now() - this.#lastFrameAt) : null,
      pendingCalls: [
        ...this.#queued.map((c) => `${c.method} ${c.path} (waiting for the socket)`),
        ...[...this.#calls.values()].map((c) => `${c.method} ${c.path}`),
      ],
      streams: [...this.#streams.values()].map((s) => s.path),
    };
  }

  /** This page has no socket: calls use HTTP, and streams wait for one that never comes. */
  isUnavailable(): boolean {
    return this.#state === "unavailable";
  }

  /**
   * The API client saw a `/api/me` answer: the identity is known without asking. A socket
   * open for someone else (the cookie was replaced under this tab) is closed, and the calls
   * that waited under the old identity are refused rather than flushed for this one.
   */
  identityIs(userId: string | null): void {
    const settled = this.#identityUser;
    this.#identity = Promise.resolve(userId);
    this.#identityUser = userId;
    if (settled !== undefined && settled !== userId) this.#identityMoved();
    if (this.#ws !== null && this.#openedFor !== userId) this.#closeOnPurpose();
  }

  /**
   * A sign-in or sign-out went through, or the session was found expired: whoever the
   * socket was for, it is not that any more. It closes; the next call settles the identity
   * afresh and opens the right one.
   */
  identityChanged(): void {
    this.#identity = null;
    this.#identityUser = undefined;
    this.#identityMoved();
    this.#closeOnPurpose();
  }

  /**
   * The page's identity moved under this client. What was queued was made as whoever the
   * page was then; those calls are refused instead of being sent on the next user's socket —
   * the one place where the queue's delay could otherwise run one user's write under
   * another user's authorization. Calls made after this point belong to the new generation.
   */
  #identityMoved(): void {
    this.#generation += 1;
    this.#refuseQueued("identity_changed");
  }

  #closeOnPurpose(): void {
    if (this.#ws === null) return;
    this.#closingOnPurpose = true;
    this.#ws.close();
  }

  /**
   * Whether a call can go over the socket — settling the identity and the handshake first
   * rather than deciding on the instant. True once open; false when there is no socket to be
   * had at all right now (this page has no WebSocket, nobody is signed in, the server cannot
   * be reached), in which case the calls waiting for one are refused rather than carried by
   * another transport. A handshake that merely failed does not answer false here: it is
   * retried, and what waits for it keeps waiting.
   */
  async ready(): Promise<boolean> {
    if (this.#state === "open") return true;
    if (this.#state === "unavailable") return this.#noSocket();
    if (this.#state === "closed") {
      // The identity can move while it is being asked (a sign-out lands first): an answer
      // from before that belongs to the wrong user, so it is asked again rather than acted
      // on — a stale answer must never open the old user's socket.
      while (true) {
        const generation = this.#generation;
        const asked = (this.#identity ??= this.whoAmI());
        let userId: string | null;
        try {
          userId = await asked;
        } catch {
          // Asked across a move (a sign-out, or a `/api/me` that settled the identity first):
          // the answer is about the page as it was, so it is asked again.
          if (asked !== this.#identity || generation !== this.#generation) continue;
          this.#identity = null; // could not tell (the server is unreachable): ask again next time
          return this.#noSocket();
        }
        if (asked !== this.#identity || generation !== this.#generation) continue;
        const settled = this.#identityUser;
        if (settled !== undefined && settled !== userId) {
          // The server says the page is someone else than the identity last settled: what
          // waited under that one is not this user's to send.
          this.#identityMoved();
        }
        this.#identityUser = userId;
        if (userId === null) return this.#noSocket();
        this.#open(this.urlFor(userId), userId);
        break; // one attempt made; its outcome is read below
      }
    }
    const state = this.#stateNow(); // #open() moved it; read it afresh
    if (state !== "connecting") return state === "open" ? true : this.#noSocket();
    return new Promise((resolve) => this.#readyWaiters.push(resolve));
  }

  /** Nothing is going to open: what waited for it is refused, and false says so. */
  #noSocket(): false {
    this.#refuseQueued("socket_closed");
    return false;
  }

  /**
   * Asks for a handshake only when nothing else is already arranging one. A drop has its
   * own backoff timer, and work arriving in the wait must not bring the next attempt
   * forward: calls and streams ride the one ladder the socket has. With no attempt under
   * way (a fresh client, or a drop that left nothing to carry), the ask opens at once.
   */
  #wake(): void {
    if (this.#state !== "closed" || this.#reconnect !== null) return;
    void this.ready();
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
      console.warn(
        `[api-socket] no frame for ${2 * HEARTBEAT_MS} ms: closing the silent socket to reconnect`,
      );
      this.#closeOnPurpose();
    }, 2 * HEARTBEAT_MS);
  }

  /**
   * One call, on the socket. Open, it is a frame now; not open, the call waits in the order it
   * was made for the next handshake to complete — and asks for one only when no attempt is
   * already arranged: a call arriving during a reconnect's backoff waits for that attempt
   * rather than starting one of its own. A call is never the reason a fetch is opened beside
   * the socket, because every one of those is a browser connection to this origin and a page
   * has six. Rejects with `socket_closed` when there is no socket to be had at all (this page
   * has no WebSocket, nobody is signed in, the server cannot be reached), with
   * `identity_changed` when the page's identity moved before it was sent, or when the socket
   * drops after the frame was sent — the caller decides what a lost answer means for its
   * method.
   */
  call(
    method: string,
    path: string,
    opts: { headers?: Record<string, string>; body?: unknown } = {},
  ): Promise<SocketCallResult> {
    return new Promise<SocketCallResult>((resolve, reject) => {
      const entry: QueuedCall = {
        method,
        path,
        opts,
        resolve,
        reject,
        generation: this.#generation,
      };
      if (this.#state === "open" && this.#ws !== null) {
        this.#send(entry);
        return;
      }
      if (this.#state === "unavailable") {
        reject(new Error("socket_closed"));
        return;
      }
      // A handshake that opens sends it (#flushQueued, from onopen); one that fails is retried
      // on the same ladder the streams ride, and this call waits through it — a drop is not a
      // verdict on the request. Only "there is no socket to be had" refuses it, in ready(). A
      // pending backoff is left to decide when: a call arriving in the wait asks for nothing.
      this.#queued.push(entry);
      this.#wake();
    });
  }

  /**
   * Puts one call on the live socket as a frame and starts its answer deadline. Never throws
   * and never leaves the call unaccounted for: a frame that cannot be built or handed to the
   * socket ends that call here, so a batch can carry on with the next one (see `#flushQueued`).
   */
  #send(entry: QueuedCall): void {
    if (this.#state !== "open" || this.#ws === null) {
      entry.reject(new Error("socket_closed")); // taken out of the queue but no socket to put it on
      return;
    }
    const { method, path } = entry;
    const id = this.#next++;
    const frame: Record<string, unknown> = { id, call: { method, path, ...entry.opts } };
    let text: string;
    try {
      text = JSON.stringify(frame);
    } catch {
      // A body that cannot be a JSON frame (a cycle, a BigInt) is this call's failure, not the
      // socket's: the rest of the batch still goes out on it.
      console.warn(`[api-socket] ${method} ${path}: could not be framed as JSON; refusing it`);
      entry.reject(new Error("socket_unserializable"));
      return;
    }
    const framesAtSend = this.#framesSeen;
    const deadline = setTimeout(() => {
      if (this.#calls.get(id)?.reject !== entry.reject) return;
      this.#calls.delete(id);
      const live = this.#state === "open" && this.#framesSeen > framesAtSend;
      console.warn(
        `[api-socket] ${method} ${path}: no answer in ${ANSWER_TIMEOUT_MS} ms over a socket that is ${this.#describeLiveness()}; ` +
          (live
            ? "the socket carried frames meanwhile, so it is the endpoint that is silent"
            : "the socket itself went quiet"),
      );
      // Tell the server too: it keeps working a call nobody waits for any more, and for a
      // machine that is a forward held open on the very route that is not answering. The
      // cancel aborts the call's Request there (socket/serve.ts), which the machine proxy
      // answers by dropping its forward.
      this.#cancel(id);
      entry.reject(new SocketTimeoutError(live));
    }, ANSWER_TIMEOUT_MS);
    this.#calls.set(id, {
      method,
      path,
      resolve: entry.resolve,
      reject: entry.reject,
      deadline,
    });
    try {
      this.#ws.send(text);
    } catch {
      // The frame never left: take the call back out and end it now, rather than wait out a
      // deadline for an answer that was never asked for. A socket that cannot send anything
      // is dead; closing it brings the ordinary reconnect for whatever else is waiting.
      clearTimeout(deadline);
      this.#calls.delete(id);
      console.warn(`[api-socket] ${method} ${path}: could not be sent; refusing it`);
      entry.reject(new Error("socket_closed"));
      this.#closeOnPurpose();
    }
  }

  /**
   * Sends everything that waited for the handshake, in the order it was asked for. Each entry
   * stands alone: one that was refused, cannot be framed or cannot be sent ends there and the
   * rest of the batch still gets its turn — no entry may be dropped between the queue and the
   * socket, which would leave its caller waiting for a deadline that never comes.
   */
  #flushQueued(): void {
    const queued = this.#queued.splice(0);
    for (const entry of queued) {
      if (entry.generation !== this.#generation) {
        entry.reject(new Error("identity_changed")); // the identity moved after it was queued
        continue;
      }
      this.#send(entry);
    }
  }

  /**
   * The calls waiting for a socket are refused rather than carried by another transport,
   * which is the whole point of waiting for the socket; `reason` says why they never got one.
   */
  #refuseQueued(reason: string): void {
    for (const entry of this.#queued.splice(0)) entry.reject(new Error(reason));
  }

  /** Cancel only on the live socket; each caller owns its local cleanup and retry. */
  #cancel(id: number): void {
    if (this.#state !== "open" || this.#ws === null) return;
    try {
      this.#ws.send(JSON.stringify({ id, cancel: true }));
    } catch {
      // The socket is not carrying frames any more; its close (and the reconnect) is the cure,
      // and the caller has already ended the call this cancel was for.
    }
  }

  /** "open (last frame N ms ago)" or the state — the one fact that separates a dead socket from a silent endpoint. */
  #describeLiveness(): string {
    const r = this.report();
    return r.lastFrameAgoMs === null ? r.state : `open (last frame ${r.lastFrameAgoMs} ms ago)`;
  }

  /**
   * A streaming subscription that survives every interruption until `close()`; without a
   * socket it waits for one, in silence — there is no second transport for a stream.
   */
  stream(path: string, handlers: StreamHandlers, options: StreamOptions = {}): StreamConnection {
    const entry: StreamEntry = {
      path,
      handlers,
      id: null,
      openDeadline: null,
      lastEventId: null,
      retry: null,
      failures: 0,
      closed: false,
      heartbeatMs: options.heartbeatMs ?? null,
      streamDeadline: null,
      flow: options.flow === true,
      handled: 0,
    };
    this.#waiting.add(entry);
    if (this.isUnavailable()) return { close: () => this.#dropStream(entry) };
    if (this.#state === "open") this.#issue(entry);
    else this.#wake();
    return { close: () => this.#dropStream(entry) };
  }

  /** Takes a stream out of every queue it may sit in and ends its call, if it has one. */
  #dropStream(entry: StreamEntry): void {
    entry.closed = true;
    entry.retry = this.#clearTimer(entry.retry);
    entry.openDeadline = this.#clearTimer(entry.openDeadline);
    entry.streamDeadline = this.#clearTimer(entry.streamDeadline);
    this.#waiting.delete(entry);
    if (entry.id !== null) {
      this.#streams.delete(entry.id);
      this.#cancel(entry.id);
      entry.id = null;
    }
    // A booked reconnect exists to bring parked streams and queued calls back. With none of
    // them left it has nothing to carry, and left to fire it would settle an identity and open
    // a socket for a page that has gone (an unmounted app, a closed workbench); the next ask
    // opens one. A call still queued behind the handshake is work, so it keeps the ladder.
    if (this.#waiting.size === 0 && this.#queued.length === 0)
      this.#reconnect = this.#clearTimer(this.#reconnect);
  }

  /** Opens the socket; streams and calls queue behind the handshake. Only from ready(). */
  #open(url: string, userId: string): void {
    if (this.#state !== "closed") return;
    if (typeof WebSocket === "undefined") {
      this.#state = "unavailable";
      console.warn(
        "[api-socket] this browser has no WebSocket: calls are refused, streams stay silent",
      );
      this.#settleReady(false);
      return;
    }
    this.#state = "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.#state = "closed";
      this.#dropped();
      return;
    }
    this.#ws = ws;
    this.#openedFor = userId;
    this.#handshakeDeadline = setTimeout(() => {
      this.#handshakeDeadline = null;
      if (this.#ws !== ws || this.#state !== "connecting") return;
      // Neither opened nor failed: close it ourselves. It counts as a handshake that never
      // opened (onclose below), so a server that keeps doing this is retried like one that
      // keeps refusing — with the reason on record.
      this.#lastClose = `the handshake neither opened nor failed in ${HANDSHAKE_TIMEOUT_MS} ms`;
      console.warn(`[api-socket] ${this.#lastClose}; closing it to try again — ${url}`);
      ws.close();
    }, HANDSHAKE_TIMEOUT_MS);
    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.#handshakeDeadline = this.#clearTimer(this.#handshakeDeadline);
      this.#state = "open";
      this.#attempts = 0;
      this.#lastFrameAt = performance.now();
      this.#armWatchdog();
      this.#settleReady(true);
      this.#flushQueued();
      for (const entry of [...this.#waiting]) this.#issue(entry);
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      if (this.#ws !== ws) return;
      this.#lastFrameAt = performance.now();
      this.#framesSeen += 1;
      this.#armWatchdog();
      this.#frame(e.data);
    };
    ws.onclose = (event?: CloseEvent) => {
      if (this.#ws !== ws) return;
      this.#handshakeDeadline = this.#clearTimer(this.#handshakeDeadline);
      // The browser's one word on a refused handshake: 1006 with no reason is a handshake the
      // server answered with a status (401, 404, 503…), which the WebSocket API never shows.
      // A handshake this client gave up on keeps the reason it recorded.
      const timedOut = this.#lastClose.startsWith("the handshake neither");
      this.#lastClose = timedOut
        ? this.#lastClose
        : event === undefined
          ? "closed"
          : `close code ${event.code}${event.reason ? ` (${event.reason})` : ""}${event.wasClean ? "" : ", not clean"}`;
      const opened = this.#state === "open";
      const onPurpose = this.#closingOnPurpose;
      this.#closingOnPurpose = false;
      this.#ws = null;
      this.#openedFor = null;
      this.#state = "closed";
      if (this.#watchdog !== null) clearTimeout(this.#watchdog);
      this.#watchdog = null;
      if (!opened && !onPurpose) {
        // A handshake that never opened: forgetting the identity makes the next attempt probe
        // the server over HTTP first, so a server that is down does not read as a server
        // without a socket. The attempt itself is retried on the backoff like any other drop:
        // nothing counts these up, and nothing ends them.
        console.warn(`[api-socket] the handshake did not open: ${this.#lastClose} — ${url}`);
        this.#identity = null;
      }
      this.#settleReady(false);
      this.#dropped();
    };
    ws.onerror = () => {
      // onclose follows; nothing to do here that it will not do.
    };
  }

  #issue(entry: StreamEntry): void {
    // Whatever issues it — a reconnect or its own retry — the other must not issue it again.
    entry.retry = this.#clearTimer(entry.retry);
    if (entry.closed || entry.id !== null) return;
    if (this.#ws === null || this.#state !== "open") return;
    this.#waiting.delete(entry);
    const id = this.#next++;
    entry.id = id;
    this.#streams.set(id, entry);
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (entry.lastEventId !== null) headers["last-event-id"] = entry.lastEventId;
    // Credit is counted per call: a new issue starts from nothing acknowledged.
    entry.handled = 0;
    if (entry.flow) headers["x-flow"] = "credit";
    entry.openDeadline = this.#clearTimer(entry.openDeadline);
    entry.openDeadline = setTimeout(() => {
      entry.openDeadline = null;
      if (entry.id !== id || this.#streams.get(id) !== entry) return;
      const delay = this.#streamBackoff(entry);
      console.warn(
        `[api-socket] stream ${entry.path}: not opened in ${STREAM_OPEN_TIMEOUT_MS} ms over a socket that is ${this.#describeLiveness()}; issuing it again in ${delay} ms`,
      );
      this.#cancel(id);
      this.#reissue(entry, delay);
    }, STREAM_OPEN_TIMEOUT_MS);
    try {
      this.#ws.send(JSON.stringify({ id, call: { method: "GET", path: entry.path, headers } }));
    } catch {
      // The frame never left: hand the stream back to the ones waiting for a socket and let
      // the reconnect carry it, rather than leave it hanging on a call this socket never got.
      entry.openDeadline = this.#clearTimer(entry.openDeadline);
      this.#streams.delete(id);
      entry.id = null;
      this.#waiting.add(entry);
      this.#closeOnPurpose();
    }
  }

  /** Clears a timer that may or may not be running; either way there is none afterwards. */
  #clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
    if (timer !== null) clearTimeout(timer);
    return null;
  }

  /**
   * The stream's own beat, armed afresh by every frame that carries its id. Silence for two
   * beats ends the stream and re-subscribes it from its last event id: the socket's heartbeat
   * keeps arriving all the while — it proves the socket is alive and nothing else — so a
   * stream that stopped answering (a machine whose App was disposed by a hot push, its socket
   * still healthy) would otherwise sit there looking connected for as long as the tab is open.
   */
  #armStreamDeadline(entry: StreamEntry): void {
    if (entry.heartbeatMs === null) return;
    const beatMs = entry.heartbeatMs;
    if (entry.streamDeadline !== null) clearTimeout(entry.streamDeadline);
    entry.streamDeadline = setTimeout(() => {
      entry.streamDeadline = null;
      if (entry.closed) return; // close() cleared this timer; an entry can outlive a frame, never a close
      console.warn(
        `[api-socket] stream ${entry.path}: no frame for ${2 * beatMs} ms (two beats at ${beatMs} ms) — ending it and re-subscribing from its last event id`,
      );
      if (entry.id !== null) this.#cancel(entry.id);
      entry.handlers.onError?.(false);
      this.#reissue(entry, REISSUE_MS);
    }, 2 * beatMs);
  }

  /** The stream is off the socket for now; issue it again after a pause (or at once on reconnect). */
  #reissue(entry: StreamEntry, delayMs: number): void {
    entry.openDeadline = this.#clearTimer(entry.openDeadline);
    entry.streamDeadline = this.#clearTimer(entry.streamDeadline);
    if (entry.id !== null) {
      this.#streams.delete(entry.id);
      entry.id = null;
    }
    if (entry.closed) return;
    this.#waiting.add(entry);
    entry.retry = this.#clearTimer(entry.retry);
    entry.retry = setTimeout(() => {
      entry.retry = null;
      if (this.#state === "open") this.#issue(entry);
      else this.#wake(); // a pending reconnect decides when; the stream does not start one
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
      // Any frame for the id is the server's answer to the issue, opened or not — and it is
      // this stream's own beat: the open `stream` frame, a machine_event, a server_event and a
      // bare `heartbeat` all count.
      stream.openDeadline = this.#clearTimer(stream.openDeadline);
      this.#armStreamDeadline(stream);
      if ("event" in frame) {
        try {
          this.#streamEvent(stream, frame);
        } finally {
          // Handled, however it went (a skipped frame too): an unacknowledged frame would
          // hold the server's credit window shut for good.
          if (stream.flow && this.#streams.get(id) === stream) {
            stream.handled += typeof frame.data === "string" ? frame.data.length : 0;
            this.#ack(id, stream.handled);
          }
        }
      } else if ("stream" in frame) {
        stream.failures = 0;
        stream.handlers.onOpen?.();
      } else if ("end" in frame) {
        stream.handlers.onError?.(false);
        this.#reissue(stream, REISSUE_MS);
      } else {
        // Answered without streaming: the endpoint refused (fatal) or is not ready (retry).
        const status = frame.status as number;
        if (fatal(status)) {
          console.warn(`[api-socket] stream ${stream.path} refused with ${status}; not retried`);
          this.#streams.delete(id);
          stream.id = null;
          stream.handlers.onError?.(true);
        } else {
          // Not ready — for a machine's stream, the hub saying why no socket carried it. Each
          // stream backs off on its own: one unreachable machine must neither slow the others
          // nor the page's reconnects, and none of them is ever moved onto HTTP.
          const delay = this.#streamBackoff(stream);
          const reason = (frame.body as { error?: { message?: string } } | null)?.error?.message;
          console.warn(
            `[api-socket] stream ${stream.path} answered ${status}${reason === undefined ? "" : ` (${reason})`}; issuing it again in ${delay} ms`,
          );
          stream.handlers.onError?.(false);
          this.#reissue(stream, delay);
        }
      }
      return;
    }
    const pending = this.#calls.get(id);
    if (pending === undefined) return;
    this.#calls.delete(id);
    clearTimeout(pending.deadline);
    pending.resolve({
      status: frame.status as number,
      headers: (frame.headers as Record<string, string> | undefined) ?? {},
      body: frame.body,
    });
  }

  /** One event of a stream, to its handlers. */
  #streamEvent(stream: StreamEntry, frame: Record<string, unknown>): void {
    const eventId = (frame.eventId as string | null) ?? null;
    if (eventId !== null) stream.lastEventId = eventId;
    let data: unknown;
    try {
      data = JSON.parse(frame.data as string);
    } catch {
      return; // single-line JSON by protocol; anything else is skipped unread
    }
    // SSE names a frame by its `event:` line, and sse-text.ts defaults an absent one to
    // `message` — the AmspRecord shape. Everything else is named dispatch, with the
    // handlers this module knows by name first and `onEvent` for the rest.
    const name = typeof frame.event === "string" ? frame.event : "message";
    if (name === "server_event") {
      stream.handlers.onServerEvent(data as ServerEvent, eventId);
    } else if (name === "message") {
      stream.handlers.onRecord(data as AmspRecord, eventId);
    } else if (name === "heartbeat" || name === "ping") {
      // Liveness only, and it has already been banked above: the beat is never an
      // application event, so it reaches no handler. `ping` is the session and user
      // streams' own beat; over HTTP the SSE reader drops it by the same name — and
      // here it is a frame whose `{}` payload must not be read as a record.
    } else if (stream.handlers.onEvent !== undefined) {
      stream.handlers.onEvent(name, data, eventId);
    } else {
      // No named-event handler: an unlisted name is a record, exactly as every name
      // but `server_event` was treated before `onEvent` existed.
      stream.handlers.onRecord(data as AmspRecord, eventId);
    }
  }

  /** Tells the server how much of a flow stream was handled (the server's AckFrame). */
  #ack(id: number, handled: number): void {
    if (this.#state !== "open" || this.#ws === null) return;
    try {
      this.#ws.send(JSON.stringify({ id, ack: handled }));
    } catch {
      // A socket that cannot send is closing; the stream is re-issued on the reconnect.
    }
  }

  /** The socket is gone: fail the calls, park the streams, and come back on the backoff. */
  #dropped(): void {
    for (const pending of this.#calls.values()) {
      clearTimeout(pending.deadline);
      pending.reject(new Error("socket_closed"));
    }
    this.#calls.clear();
    for (const entry of this.#streams.values()) {
      entry.openDeadline = this.#clearTimer(entry.openDeadline);
      // The stream is off the socket, so its silence is no longer a fact about it: the drop
      // has already been reported, and the beat is measured again from the next issue's first
      // frame. Left armed, it would warn about a stream that is not there.
      entry.streamDeadline = this.#clearTimer(entry.streamDeadline);
      entry.id = null;
      entry.handlers.onError?.(false);
      this.#waiting.add(entry);
    }
    this.#streams.clear();

    if (this.#waiting.size === 0 && this.#queued.length === 0) return; // nothing to carry: reopen lazily on the next ask
    // Every drop — a connection that was up and went away, a handshake that never opened, a
    // server that could not be reached — comes back on the one ladder. It never stops.
    this.#scheduleReconnect();
  }

  /**
   * Comes back for the parked streams. One attempt per timer; an attempt that could not
   * even reach the server (ready() false without a handshake) books the next one itself,
   * so a server that is down keeps being tried on the backoff until it is back.
   *
   * The ladder's next step is taken here, after the one-timer guard, so one failed attempt
   * costs exactly one step however many paths notice it: a handshake that reached the server
   * and failed has already booked its next timer in `#dropped`, and the continuation below
   * then finds that timer armed and spends nothing.
   */
  #scheduleReconnect(): void {
    if (this.#reconnect !== null) return;
    const delayMs = this.#backoff();
    this.#reconnect = setTimeout(() => {
      this.#reconnect = null;
      void this.ready().then((open) => {
        if (open || this.#state !== "closed") return;
        if (this.#waiting.size === 0 && this.#queued.length === 0) return;
        this.#scheduleReconnect();
      });
    }, delayMs);
  }

  /** A stream's own re-issue delay: the reconnect's doubling shape, counted per stream. */
  #streamBackoff(entry: StreamEntry): number {
    return backoffMs(entry.failures++);
  }

  #backoff(): number {
    return backoffMs(this.#attempts++);
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

/**
 * The socket's address: the server's own upgrade route for it, whose cookie names the user.
 * Spelled here rather than imported because the site build compiles this package without the
 * server's dist: the `./api` subpath resolves into that dist, so a value import leaves the
 * gallery build with nothing to resolve (main keeps that subpath type-only, and type imports
 * are dropped).
 */
const apiSocketPath = (): string => "/api/socket";

/** The page's socket: to this origin, same cookie the page holds — whoever it names. */
// Off a page (no `location` — the Web App's logic under test in Node) there is no origin to
// open the socket on, so it is unavailable from the start.
export const apiSocket = new ApiSocket(
  () => {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${location.host}${apiSocketPath()}`;
  },
  whoAmI,
  typeof location !== "undefined" && typeof WebSocket !== "undefined",
);
