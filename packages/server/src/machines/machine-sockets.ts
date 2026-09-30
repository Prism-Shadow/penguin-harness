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
 */
import type http from "node:http";
import { WebSocket } from "ws";
import { ADMIN_USER_ID } from "../auth/service.js";
import type { MachineSocketFact } from "../api/types.js";
import type { EventFrame, ServerFrame } from "../socket/frames.js";
import { apiSocketPath } from "../socket/ref.js";
import { HEARTBEAT_MS } from "../socket/serve.js";

/** The machine answered the handshake with a status: it is up, and has no socket to offer (or refused this server). */
export class HandshakeRefused extends Error {
  constructor(readonly status: number) {
    super(`machine answered ${status}`);
  }
}

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

/** What a caller's stream call hears back from a socket (or, for the event hub, from its upstream). */
export interface Sink {
  onStart(status: number): void;
  onEvent(event: EventFrame): void;
  onEnd(): void;
  onResponse(status: number, body: unknown): void;
}

/** A live socket to one machine, multiplexing this server's call frames by id. */
export class MachineSocket {
  readonly #ws: WebSocket;
  readonly #calls = new Map<number, Sink>();
  #next = 1;
  #closed = false;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    // Silence watchdog: the machine's socket sends a heartbeat frame every beat; nothing for
    // two beats means the channel is dead under us (an ssh session gone quiet), and every
    // stream on it must end so the browser re-issues — not sit on a socket that never speaks.
    let watchdog = setTimeout(() => ws.terminate(), 2 * HEARTBEAT_MS);
    watchdog.unref?.();
    ws.on("message", (data, isBinary) => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => ws.terminate(), 2 * HEARTBEAT_MS);
      watchdog.unref?.();
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
        this.#calls.delete(frame.id);
        sink.onEnd();
      } else if ("stream" in frame) sink.onStart(frame.status);
      else {
        this.#calls.delete(frame.id);
        sink.onResponse(frame.status, frame.body);
      }
    });
    const drop = () => {
      clearTimeout(watchdog);
      this.#closed = true;
      const sinks = [...this.#calls.values()];
      this.#calls.clear();
      for (const sink of sinks) sink.onEnd();
    };
    ws.on("close", drop);
    ws.on("error", drop);
  }

  /**
   * Resolves on the open handshake; rejects when the machine refuses (no socket there), cannot
   * be reached, or has not answered within `timeoutMs`.
   */
  static open(target: MachineSocketTarget, timeoutMs: number): Promise<MachineSocket> {
    return new Promise((resolve, reject) => {
      // No Origin: the machine's guard reads its absence as a non-browser client, which this is.
      // The admin's reserved id: the session minted over there is the admin's, and the
      // machine's runtime holds the id's owner to it.
      const ws = new WebSocket(`ws://127.0.0.1:${target.port}${apiSocketPath(ADMIN_USER_ID)}`, {
        agent: target.agent,
        headers: { host: `localhost:${target.port}`, cookie: target.cookie },
        perMessageDeflate: false,
      });
      const deadline = setTimeout(() => {
        reject(new Error(`no socket handshake in ${timeoutMs} ms`));
        ws.terminate();
      }, timeoutMs);
      deadline.unref?.();
      ws.once("open", () => {
        clearTimeout(deadline);
        resolve(new MachineSocket(ws));
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

  get closed(): boolean {
    return this.#closed;
  }

  onClose(listener: () => void): void {
    this.#ws.once("close", listener);
    this.#ws.once("error", listener);
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
    if (!this.#calls.delete(id)) return;
    if (this.#ws.readyState === this.#ws.OPEN) this.#ws.send(JSON.stringify({ id, cancel: true }));
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

  constructor(
    private readonly log: (line: string) => void,
    options: { dialTimeoutMs?: number } = {},
  ) {
    this.#dialTimeoutMs = options.dialTimeoutMs ?? SOCKET_DIAL_TIMEOUT_MS;
  }

  /** What the socket to one machine is doing, or null when none has been asked for yet. */
  fact(machineId: string): MachineSocketFact | null {
    return this.#facts.get(machineId) ?? null;
  }

  /** Marks a state change; `since` is now, so the page can say how long it has been in it. */
  #state(machineId: string, state: MachineSocketFact["state"], detail?: string): void {
    this.#facts.set(machineId, {
      state,
      since: new Date().toISOString(),
      ...(detail !== undefined ? { detail } : {}),
    });
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
      this.#state(machineId, "dialling");
      const entry: CachedSocket = {
        session: target.session,
        pending: MachineSocket.open(target, this.#dialTimeoutMs),
      };
      entry.pending.then(
        (socket) => {
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
          if (this.#sockets.get(machineId) === entry) this.#sockets.delete(machineId);
          // An ANSWERED refusal is remembered for a while (its build has no socket, or it
          // turned this server away): asking again on every stream would only repeat it. A
          // dial that failed says nothing about the build; the next stream tries again.
          if (err instanceof HandshakeRefused) {
            this.#failing.delete(machineId);
            this.#refusedUntil.set(machineId, {
              until: Date.now() + REFUSED_FOR_MS,
              status: err.status,
            });
            this.#state(machineId, "refused", err.message);
            this.log(
              `[machines] no socket on ${machineId} (${err.message}); its streams are refused until it is updated`,
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
      if (socket.closed) {
        if (this.#sockets.get(machineId) === cached) this.#sockets.delete(machineId);
        return this.socketFor(machineId, target);
      }
      return { socket };
    } catch (err) {
      if (err instanceof HandshakeRefused) return { answer: refusedAnswer(machineId, err.status) };
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
