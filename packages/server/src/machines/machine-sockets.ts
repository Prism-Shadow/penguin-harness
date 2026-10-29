/**
 * The API sockets this server holds to machines (PRFC-0011): one per machine, dialled through
 * the ssh session held to that machine, multiplexing every call by the client's own id.
 *
 * A socket is dialled as that machine's admin (the same minted cookie, on the admin's reserved
 * id — socket/ref.ts) over the same http.Agent the request proxy uses, so the dial rides the
 * ssh session's own channel rather than opening a second connection. Two things ask it for
 * calls: the request proxy's streams (machines/socket-relay.ts) and the event hub's one
 * subscription per machine's `/api/events` (machines/event-hub.ts) — one cache, so both share
 * the one socket per machine instead of racing to dial their own.
 *
 * The socket belongs to the ssh SESSION it was dialled through, not to the machine id: when the
 * transport reopens the session (a drop, a reconnect), a socket or a dial made over the old one
 * is let go and the next caller dials over the new one. Nothing waits without a deadline — a
 * dial that neither opens nor fails in time is torn down, so one stuck handshake can never hold
 * every later stream to that machine behind it.
 *
 * A handshake that goes unanswered is told apart by asking the same port for HTTP. A machine
 * whose server answers HTTP and never the handshake is running a server process older than the
 * socket — an update handed to a running server swaps its platform, never the process that takes
 * the upgrade — so it is not running this server's version, and its streams stay out of reach
 * until it does. Its fact says so (`unanswered`) and the answer every stream gets names the way
 * on: a restart, and failing that an update or a reinstall. Nothing here restarts it.
 */
import http from "node:http";
import { WebSocket } from "ws";
import type { MachineSocketFact } from "../api/types.js";
import { CREDIT_FLOW } from "../socket/frames.js";
import type { EventFrame, ServerFrame } from "../socket/frames.js";
import { apiSocketPath } from "../socket/ref.js";
import { HEARTBEAT_MS } from "../socket/serve.js";
import { API_SOCKET_DEFLATE } from "../socket/compression.js";

/** The machine answered the handshake with a status: it is up, and has no socket to offer (or refused this server). */
export class HandshakeRefused extends Error {
  constructor(readonly status: number) {
    super(`machine answered ${status}`);
  }
}

/** Nothing answered the handshake in time: the channel never came up, or the server never took the upgrade. */
export class HandshakeTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`no socket handshake in ${timeoutMs} ms`);
  }
}

/**
 * The handshake went unanswered while the machine's server answers HTTP on the same port: the
 * server process predates the socket, so the machine is not running this server's version. Its
 * words are the whole answer a stream gets, a page may show them as they are, and so they are
 * said for whoever uses the page: what is wrong and what to click.
 */
export class ServerPredatesSocket extends Error {
  constructor() {
    super(
      "This machine is on a different version, so its conversations won't update by themselves. On the Machines page, click Restart server; if that doesn't help, reinstall it.",
    );
  }
}

/**
 * How a socket tells a dead link from a busy one. The default period is two of the machine's
 * beats; `heardAt` is the machine's link (link-activity.ts): when bytes last came from the
 * machine on any connection to it.
 */
export interface MachineSocketLiveness {
  heardAt?: () => number | null;
  /** The link's bytes per second lately (LinkActivity.rate). */
  rate?: () => number;
  silenceMs?: number;
}

/**
 * What the machine's ssh server may queue for one channel ahead of this socket's bytes (an
 * OpenSSH channel window): on a busy link this socket's own silence is half-open only once it
 * outlasts that much at the link's rate.
 */
export const CHANNEL_QUEUE_BYTES = 2 * 1024 * 1024;

export interface MachineSocketTarget {
  agent: http.Agent;
  port: number;
  cookie: string;
  /** The ssh session the agent dials through (its pid): a socket is only ever reused within one. */
  session: number;
}

/** How long a refused handshake is remembered before the machine is asked again. */
const REFUSED_FOR_MS = 60_000;
/**
 * A dial that has neither opened nor failed after this is torn down. It covers the SOCKS
 * channel and the upgrade both: a machine that accepts the connection and never answers the
 * upgrade would otherwise hold every later stream to it behind one promise.
 */
export const SOCKET_DIAL_TIMEOUT_MS = 10_000;
/**
 * The HTTP check after an unanswered handshake waits at most this long, and never longer than the
 * dial did: on a healthy channel a server answers in milliseconds, and the stream that asked is
 * still waiting for its answer, inside the browser's own open deadline.
 */
const HTTP_CHECK_TIMEOUT_MS = 2_000;

/** Whether the machine's server answers an HTTP request through `target` within `timeoutMs`: any status counts. */
function answersHttp(target: MachineSocketTarget, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        agent: target.agent,
        host: "127.0.0.1",
        port: target.port,
        path: "/api/version",
        method: "GET",
        headers: { host: `localhost:${target.port}`, cookie: target.cookie },
      },
      (res) => {
        clearTimeout(deadline);
        res.resume();
        resolve(true);
      },
    );
    // Its own timer rather than the request's `timeout`: that one arms only once a socket is
    // assigned, and a channel that never comes up assigns none.
    const deadline = setTimeout(() => {
      req.destroy();
      resolve(false);
    }, timeoutMs);
    deadline.unref?.();
    req.on("error", () => {
      clearTimeout(deadline);
      resolve(false);
    });
    req.end();
  });
}

/** Why no stream could be relayed, as the proxy answers it. */
export function unavailable(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** A machine that answered the socket handshake with a status: its build has no socket, or it refused this server. */
export function refusedAnswer(machineId: string, status: number): Response {
  return unavailable(
    502,
    "machine_socket_refused",
    `${machineId} answered the API socket handshake with ${status}; update the program on it — streams are not forwarded over HTTP.`,
  );
}

/** What a dial that found no socket is told, once one settle has been asked for. */
export type StreamSettle =
  { kind: "upgrading"; detail: string } | { kind: "incompatible"; detail: string };

/** A machine being brought to this hub's build: a named state, not the same 502. */
export function upgradingAnswer(detail: string): Response {
  return unavailable(
    503,
    "machine_upgrading",
    `This machine is being brought to this hub's build — ${detail}. Streams answer again when it is on it.`,
  );
}

/** A machine that cannot be brought to this hub's build: the verdict, in the last step's words. */
export function incompatibleAnswer(detail: string): Response {
  return unavailable(
    502,
    "machine_incompatible",
    `This machine cannot be brought to this hub's build — ${detail}.`,
  );
}

/** What a caller's stream call hears back from a socket (or, for the event hub, from its upstream). */
export interface Sink {
  /** The stream began; `headers` are its start frame's (an `x-flow: credit` echo says it reads acks). */
  onStart(status: number, headers?: Record<string, string>): void;
  onEvent(event: EventFrame): void;
  onEnd(): void;
  onResponse(status: number, body: unknown): void;
}

/** A live socket to one machine, multiplexing this server's call frames by id. */
export class MachineSocket {
  readonly #ws: WebSocket;
  readonly #calls = new Map<number, Sink>();
  /** Calls whose start frame echoed `x-flow: credit`: the only ones `ack` speaks for. */
  readonly #credited = new Set<number>();
  #next = 1;
  #closed = false;
  /**
   * Who hears the bytes of the connection under the socket, which say the link is alive before a
   * frame is whole: one `data` listener on the connection for all of them, however many streams.
   */
  readonly #traffic = new Set<() => void>();

  private constructor(
    ws: WebSocket,
    raw: NodeJS.EventEmitter | null = null,
    liveness: MachineSocketLiveness = {},
  ) {
    this.#ws = ws;
    // Silence watchdog. The machine's socket sends a heartbeat frame every beat, and nothing
    // from the machine for two beats means the channel is dead under us (an ssh session gone
    // quiet): every stream on it must end so the browser re-issues, not sit on a socket that
    // never speaks. Nothing means no byte at all — of this socket, whole frame or not, or of
    // any other connection to the machine: on a slow link its ssh server queues those ahead of
    // this socket's bytes, and a socket behind a long queue is on a busy link, not a dead one.
    const silenceMs = liveness.silenceMs ?? 2 * HEARTBEAT_MS;
    let heard = Date.now();
    raw?.on("data", () => {
      heard = Date.now();
      for (const listener of this.#traffic) listener();
    });
    const tick = setInterval(() => {
      const now = Date.now();
      const last = Math.max(heard, liveness.heardAt?.() ?? 0);
      // The link's bytes stand in for this socket's for a while, not for good: a channel of its
      // own that stays silent (not even a pong to the pings below) past what another channel can
      // queue ahead of it at the link's rate — and never less than twice the period — is
      // half-open, however busy the rest of the link is.
      const rate = liveness.rate?.() ?? 0;
      const ownLimit = Math.max(2 * silenceMs, rate > 0 ? (CHANNEL_QUEUE_BYTES / rate) * 1000 : 0);
      if (now - last >= silenceMs || now - heard >= ownLimit) {
        ws.terminate();
        return;
      }
      // Heard within the period: the machine is told so too. Its own check waits on the answer
      // to its ping, which sits behind that same queue, or on anything from here (socket/serve.ts).
      if (ws.readyState === ws.OPEN) ws.ping();
    }, silenceMs / 4);
    tick.unref?.();
    ws.on("message", (data, isBinary) => {
      heard = Date.now();
      if (isBinary) return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(data.toString()) as ServerFrame;
      } catch {
        return;
      }
      if ("heartbeat" in frame) return; // its arrival already re-armed the watchdog
      const sink = this.#calls.get(frame.id);
      if (sink === undefined) return;
      if ("event" in frame) sink.onEvent(frame);
      else if ("end" in frame) {
        this.#forget(frame.id);
        sink.onEnd();
      } else if ("stream" in frame) {
        if (frame.headers["x-flow"] === CREDIT_FLOW) this.#credited.add(frame.id);
        sink.onStart(frame.status, frame.headers);
      } else {
        this.#forget(frame.id);
        sink.onResponse(frame.status, frame.body);
      }
    });
    const drop = () => {
      clearInterval(tick);
      this.#closed = true;
      const sinks = [...this.#calls.values()];
      this.#calls.clear();
      this.#credited.clear();
      for (const sink of sinks) sink.onEnd();
    };
    ws.on("close", drop);
    ws.on("error", drop);
  }

  /**
   * Resolves on the open handshake; rejects when the machine refuses (no socket there), cannot
   * be reached, or has not answered within `timeoutMs`.
   */
  static open(
    target: MachineSocketTarget,
    timeoutMs: number,
    liveness: MachineSocketLiveness = {},
  ): Promise<MachineSocket> {
    return new Promise((resolve, reject) => {
      // No Origin: the machine's guard reads its absence as a non-browser client, which this is.
      // The socket's own route: the session minted over there is the admin's, and the
      // machine's handshake serves the socket as the user that cookie names.
      const ws = new WebSocket(`ws://127.0.0.1:${target.port}${apiSocketPath()}`, {
        agent: target.agent,
        headers: { host: `localhost:${target.port}`, cookie: target.cookie },
        // Offered, not imposed: a machine whose server predates compression answers without it.
        perMessageDeflate: API_SOCKET_DEFLATE,
      });
      const deadline = setTimeout(() => {
        reject(new HandshakeTimeout(timeoutMs));
        ws.terminate();
      }, timeoutMs);
      deadline.unref?.();
      // The upgrade's connection, kept for `onTraffic`: a frame larger than what a slow link
      // carries in one stream's watchdog is still arriving, and its bytes say so.
      let raw: NodeJS.EventEmitter | null = null;
      ws.once("upgrade", (res) => {
        raw = res.socket;
      });
      ws.once("open", () => {
        clearTimeout(deadline);
        resolve(new MachineSocket(ws, raw, liveness));
      });
      ws.once("unexpected-response", (_req, res) => {
        clearTimeout(deadline);
        res.resume();
        reject(new HandshakeRefused(res.statusCode ?? 0));
      });
      ws.once("error", (err) => {
        clearTimeout(deadline);
        reject(err);
      });
    });
  }

  /**
   * Tells `listener` whenever bytes arrive on the connection, whole frames or not: liveness for
   * a stream waiting on a frame that a slow link is still carrying. Returns the stop.
   */
  onTraffic(listener: () => void): () => void {
    // A wrapper of its own, so the same listener given twice is two subscriptions.
    const heard = (): void => listener();
    this.#traffic.add(heard);
    return () => this.#traffic.delete(heard);
  }

  get closed(): boolean {
    return this.#closed;
  }

  onClose(listener: () => void): () => void {
    const unsubscribe = (): void => {
      this.#ws.off("close", closed);
      this.#ws.off("error", closed);
    };
    const closed = (): void => {
      unsubscribe();
      listener();
    };
    this.#ws.once("close", closed);
    this.#ws.once("error", closed);
    return unsubscribe;
  }

  /** Issues a call; returns the id (for cancel). */
  call(
    call: { method: string; path: string; headers?: Record<string, string> },
    sink: Sink,
  ): number {
    const id = this.#next++;
    this.#calls.set(id, sink);
    this.#ws.send(JSON.stringify({ id, call }));
    return id;
  }

  cancel(id: number): void {
    this.#credited.delete(id);
    if (!this.#calls.delete(id)) return;
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify({ id, cancel: true }));
  }

  #forget(id: number): void {
    this.#calls.delete(id);
    this.#credited.delete(id);
  }

  /**
   * Acknowledges a credit-flow stream (`x-flow: credit`, socket/frames.ts AckFrame): this
   * server has handled `cumulative` of that call's event data (`ping`s not counted). Nothing
   * for a call already over, or for one whose start frame did not echo the header — a machine
   * older than acks closes its socket on one.
   */
  ack(id: number, cumulative: number): void {
    if (!this.#calls.has(id) || !this.#credited.has(id)) return;
    if (this.#ws.readyState === this.#ws.OPEN) {
      this.#ws.send(JSON.stringify({ id, ack: cumulative }));
    }
  }

  /** Tears the socket down as dead: every stream on it ends, and the relay dials again next time. */
  terminate(): void {
    this.#ws.terminate();
  }
}

/** A socket to one machine, or the dial for it, and the ssh session it rides. */
interface CachedSocket {
  session: number;
  pending: Promise<MachineSocket>;
}

/**
 * The per-machine socket cache: one instance per proxy generation, keyed by machine id and the
 * ssh session under it, dropped when the socket closes or the session is replaced, and
 * re-dialled by the next caller. It also keeps what each socket is DOING — the Machines page's
 * own `socket` fact (api/types.ts MachineInfo.socket) — so a stuck stream has a place to be
 * seen that is not the browser console.
 */
export class MachineSockets {
  readonly #sockets = new Map<string, CachedSocket>();
  readonly #refusedUntil = new Map<string, { until: number; status: number }>();
  readonly #facts = new Map<string, MachineSocketFact>();
  /** The failure each machine's dials have been repeating since its last good one. */
  readonly #failing = new Map<string, string>();
  readonly #dialTimeoutMs: number;
  readonly #announce: () => void;
  /**
   * What a dial that found no socket means to the Machines service. Absent — a relay built by a
   * test, a page's own sockets before the service is up — a refusal and a failed dial are
   * answered as they always were.
   */
  readonly #settle: ((machineId: string) => StreamSettle | null) | undefined;
  readonly #heardAt: ((machineId: string) => number | null) | undefined;
  readonly #rateOf: ((machineId: string) => number) | undefined;
  readonly #silenceMs: number | undefined;
  #closed = false;

  constructor(
    private readonly log: (line: string) => void,
    options: {
      dialTimeoutMs?: number;
      /**
       * Told when a machine starts or stops reading `unanswered` — the one socket fact the
       * Machines page shows as the machine's own state, which must not wait for the page's
       * next read of the list.
       */
      announce?: () => void;
      settle?: (machineId: string) => StreamSettle | null;
      /** When bytes last came from a machine on any connection to it (MachinesService.links). */
      heardAt?: (machineId: string) => number | null;
      /** How fast bytes come from a machine lately (MachinesService.links). */
      rateOf?: (machineId: string) => number;
      /** The silence a socket is dropped after (MachineSocketLiveness.silenceMs). */
      silenceMs?: number;
    } = {},
  ) {
    this.#dialTimeoutMs = options.dialTimeoutMs ?? SOCKET_DIAL_TIMEOUT_MS;
    this.#announce = options.announce ?? (() => undefined);
    this.#settle = options.settle;
    this.#heardAt = options.heardAt;
    this.#rateOf = options.rateOf;
    this.#silenceMs = options.silenceMs;
  }

  /** Ends this generation's sockets, including a dial that settles after disposal. */
  close(): void {
    this.#closed = true;
    for (const entry of this.#sockets.values()) {
      entry.pending.then(
        (socket) => socket.terminate(),
        () => undefined,
      );
    }
    this.#sockets.clear();
    this.#facts.clear();
    this.#refusedUntil.clear();
    this.#failing.clear();
  }

  /** What the socket to one machine is doing, or null when none has been asked for yet. */
  fact(machineId: string): MachineSocketFact | null {
    return this.#facts.get(machineId) ?? null;
  }

  /** Marks a state change; `since` is now, so the page can say how long it has been in it. */
  #state(machineId: string, state: MachineSocketFact["state"], detail?: string): void {
    const was = this.#facts.get(machineId)?.state;
    this.#facts.set(machineId, {
      state,
      since: new Date().toISOString(),
      ...(detail !== undefined ? { detail } : {}),
    });
    if ((was === "unanswered") !== (state === "unanswered")) this.#announce();
  }

  /**
   * One dial, with an unanswered handshake told apart: the same port answering HTTP means the
   * server is up and older than the socket, which no amount of dialling again will change.
   */
  async #dial(machineId: string, target: MachineSocketTarget): Promise<MachineSocket> {
    const heardAt = this.#heardAt;
    const rateOf = this.#rateOf;
    const liveness: MachineSocketLiveness = {
      ...(heardAt !== undefined ? { heardAt: () => heardAt(machineId) } : {}),
      ...(rateOf !== undefined ? { rate: () => rateOf(machineId) } : {}),
      ...(this.#silenceMs !== undefined ? { silenceMs: this.#silenceMs } : {}),
    };
    try {
      return await MachineSocket.open(target, this.#dialTimeoutMs, liveness);
    } catch (err) {
      if (!(err instanceof HandshakeTimeout) || this.#closed) throw err;
      const checkMs = Math.min(this.#dialTimeoutMs, HTTP_CHECK_TIMEOUT_MS);
      if (await answersHttp(target, checkMs)) throw new ServerPredatesSocket();
      throw err;
    }
  }

  /**
   * The socket held to that machine, dialling one if there is none: the cached socket (or the
   * dial in flight), or the answer the caller gets instead — a refusal the machine sent, or the
   * reason no socket could be had at all.
   */
  async socketFor(
    machineId: string,
    target: MachineSocketTarget,
  ): Promise<{ socket: MachineSocket } | { answer: Response }> {
    if (this.#closed) return { answer: unavailable(503, "unavailable", "The App was replaced.") };
    const refused = this.#refusedUntil.get(machineId);
    if (refused !== undefined && Date.now() < refused.until) {
      return { answer: refusedAnswer(machineId, refused.status) };
    }
    let cached = this.#sockets.get(machineId);
    if (cached !== undefined && cached.session !== target.session) {
      // The transport reopened the ssh session: whatever was dialled over the old one is
      // let go (a settled socket is closed, a pending dial is closed when it settles).
      this.log(
        `[machines] ssh session to ${machineId} was replaced; dropping the socket dialled over the old one`,
      );
      this.#sockets.delete(machineId);
      cached.pending.then(
        (socket) => socket.terminate(),
        () => undefined,
      );
      cached = undefined;
    }
    if (cached === undefined) {
      // A machine read as needing a restart keeps that reading while it is dialled again: only a
      // handshake that completes clears it, so the page does not blink at every re-dial.
      if (this.#facts.get(machineId)?.state !== "unanswered") this.#state(machineId, "dialling");
      const entry: CachedSocket = {
        session: target.session,
        pending: this.#dial(machineId, target),
      };
      entry.pending.then(
        (socket) => {
          if (this.#closed) {
            socket.terminate();
            return;
          }
          this.#refusedUntil.delete(machineId);
          this.#failing.delete(machineId);
          this.#state(machineId, "connected");
          socket.onClose(() => {
            if (this.#sockets.get(machineId) === entry) this.#sockets.delete(machineId);
            // A socket that was up and is not any more is not "connected": the page must not
            // read the last successful dial as liveness (the lesson of #561).
            if (this.#facts.get(machineId)?.state === "connected") {
              this.#state(machineId, "failed", "the socket closed");
            }
          });
        },
        (err: unknown) => {
          if (this.#closed) return;
          if (this.#sockets.get(machineId) === entry) this.#sockets.delete(machineId);
          // An ANSWERED refusal is remembered for a while (its build has no socket, or it
          // turned this server away): asking again on every stream would only repeat it. A
          // dial that failed says nothing about the build; the next stream tries again.
          if (err instanceof HandshakeRefused) {
            this.#failing.delete(machineId);
            // An ANSWERED refusal is remembered for a while: asking again on every stream would
            // only repeat it. With the Machines service deciding, every stream goes through it
            // instead, and its answer is the true one — a machine it just brought onto this
            // hub's build must not be held at a refusal remembered before that.
            if (this.#settle === undefined) {
              this.#refusedUntil.set(machineId, {
                until: Date.now() + REFUSED_FOR_MS,
                status: err.status,
              });
            }
            this.#state(machineId, "refused", err.message);
            this.log(
              `[machines] no socket on ${machineId} (${err.message}); its streams are refused until it is updated`,
            );
          } else if (err instanceof ServerPredatesSocket) {
            this.#failing.delete(machineId);
            // Entered once per run: a dial again that meets the same server re-dates nothing
            // and logs nothing, so `since` says when the machine first read this way.
            if (this.#facts.get(machineId)?.state === "unanswered") return;
            this.#state(machineId, "unanswered", err.message);
            this.log(
              `[machines] socket to ${machineId}: its server answers HTTP and never the handshake — a server process older than the socket, so not this server's version; it needs a restart, or else a reinstall`,
            );
          } else {
            const detail = err instanceof Error ? err.message : String(err);
            this.#state(machineId, "failed", detail);
            // A machine that stays down is dialled again and again (the event hub keeps dialling
            // for a tab that holds it): the same failure is logged and filed once per run, and
            // the fact's `since` says when the latest attempt gave up.
            if (this.#failing.get(machineId) === detail) return;
            this.#failing.set(machineId, detail);
            this.log(`[machines] socket to ${machineId} failed: ${detail}`);
          }
        },
      );
      this.#sockets.set(machineId, entry);
      cached = entry;
    }
    try {
      const socket = await cached.pending;
      if (this.#closed) return { answer: unavailable(503, "unavailable", "The App was replaced.") };
      if (socket.closed) {
        if (this.#sockets.get(machineId) === cached) this.#sockets.delete(machineId);
        return this.socketFor(machineId, target);
      }
      return { socket };
    } catch (err) {
      // One action is asked for before the stream is answered: a machine whose process is on
      // another build is brought onto this hub's, and the stream says where it stands — never
      // the same 502 that says neither.
      const settling = this.#settle?.(machineId) ?? null;
      if (settling !== null) {
        return {
          answer:
            settling.kind === "upgrading"
              ? upgradingAnswer(settling.detail)
              : incompatibleAnswer(settling.detail),
        };
      }
      if (err instanceof HandshakeRefused) return { answer: refusedAnswer(machineId, err.status) };
      if (err instanceof ServerPredatesSocket) {
        return { answer: unavailable(502, "machine_socket_unavailable", err.message) };
      }
      return {
        answer: unavailable(
          502,
          "machine_socket_unavailable",
          `No API socket to ${machineId}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      };
    }
  }
}
