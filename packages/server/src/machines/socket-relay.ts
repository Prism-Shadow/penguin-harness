/**
 * One socket per machine (PRFC-0011): a machine's streaming endpoints, relayed over a single
 * API socket this server holds to that machine, instead of one SOCKS channel and one
 * never-ending HTTP response per stream.
 *
 * The shape is the request proxy's, one level down: the socket is dialled through the
 * machine's ssh session (the same http.Agent the proxy uses) as that machine's admin (the
 * same minted cookie, on the admin's reserved id — socket/ref.ts), and every stream a browser
 * asks for becomes a `call` frame on it. What comes back is turned into a `text/event-stream`
 * Response for the proxy to return — so the hop is invisible to the socket serving the
 * browser, which re-frames that Response exactly as it would any endpoint's.
 *
 * STREAMS NEVER FALL BACK TO HTTP. A forwarded stream is a never-ending response on a channel
 * of its own, and with many machines those add up to exactly the pile of held connections the
 * socket exists to avoid. When the socket cannot be had — the machine refuses the handshake
 * (a build without it), the dial does not complete, or the socket stops serving — the stream is
 * answered with an error at once and the browser re-issues it on its backoff; a machine that
 * keeps refusing is one to update, and says so.
 *
 * The socket belongs to the ssh SESSION it was dialled through, not to the machine id: when the
 * transport reopens the session (a drop, a reconnect), a socket or a dial made over the old one
 * is let go and the next stream dials over the new one. Nothing waits without a deadline —
 * a dial that neither opens nor fails in time is torn down, so one stuck handshake can never
 * hold every later stream to that machine behind it.
 *
 * When the machine socket closes (the ssh session dropped, the machine restarted), every
 * stream on it ends; the browser re-issues each with its last event id and the machine's own
 * buffer fills the gap, or says resync.
 */
import type http from "node:http";
import { WebSocket } from "ws";
import { ADMIN_USER_ID } from "../auth/service.js";
import type { EventFrame, ServerFrame } from "../socket/frames.js";
import { apiSocketPath } from "../socket/ref.js";
import { HEARTBEAT_MS } from "../socket/serve.js";
import { formatSseEvent } from "../socket/sse-text.js";

/** The machine answered the handshake with a status: it is up, and has no socket to offer (or refused this user). */
class HandshakeRefused extends Error {
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
/**
 * A stream the machine has not opened (or answered) after this rides a socket that is not
 * serving: one the machine's own hot push left bound to its disposed App, which keeps the
 * heartbeat going and answers nothing — the silence watchdog never fires. The socket is
 * terminated, which ends every stream on it so the browser re-issues each, this request is
 * answered with an error, and the next stream dials the machine's current App. Opening
 * `/api/events` is immediate on a serving machine; the dial deadline plus this stays under the
 * browser's own 20 s, so the browser hears the answer rather than giving up first.
 */
export const STREAM_OPEN_TIMEOUT_MS = 8_000;

/** Why no stream could be relayed, as the proxy answers it. */
function unavailable(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

interface Sink {
  onStart(status: number): void;
  onEvent(event: EventFrame): void;
  onEnd(): void;
  onResponse(status: number, body: unknown): void;
}

/** A live socket to one machine, multiplexing this server's stream calls by id. */
class MachineSocket {
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
 * The per-machine socket cache and the stream relay over it. One instance per proxy; keyed
 * by machine id and the ssh session under it, dropped when the socket closes or the session
 * is replaced, and re-dialled on the next stream.
 */
export class MachineSocketRelay {
  readonly #sockets = new Map<string, CachedSocket>();
  readonly #refusedUntil = new Map<string, { until: number; status: number }>();

  readonly #openTimeoutMs: number;
  readonly #dialTimeoutMs: number;

  constructor(
    private readonly log: (line: string) => void,
    options: { openTimeoutMs?: number; dialTimeoutMs?: number } = {},
  ) {
    this.#openTimeoutMs = options.openTimeoutMs ?? STREAM_OPEN_TIMEOUT_MS;
    this.#dialTimeoutMs = options.dialTimeoutMs ?? SOCKET_DIAL_TIMEOUT_MS;
  }

  /**
   * Relays one streaming request. Always answers: the stream, the machine's own non-streaming
   * answer, or an error saying why no socket carried it — never a hand-back to an HTTP forward.
   */
  async stream(
    machineId: string,
    target: MachineSocketTarget,
    request: { path: string; lastEventId: string | null },
  ): Promise<Response> {
    const got = await this.#socketFor(machineId, target);
    if (!("socket" in got)) return got.answer;
    const socket = got.socket;

    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (request.lastEventId !== null) headers["last-event-id"] = request.lastEventId;

    return new Promise<Response>((resolve) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let ended = false;
      const encoder = new TextEncoder();
      // Issued, but neither opened nor answered nor ended in time: the socket is not serving.
      const opening = setTimeout(() => {
        if (ended || controller !== null) return;
        ended = true;
        this.log(
          `[machines] stream ${request.path} on ${machineId}: not opened in ${this.#openTimeoutMs} ms over a socket that is alive; terminating the socket, the next stream dials again`,
        );
        socket.cancel(id);
        socket.terminate();
        resolve(
          unavailable(
            504,
            "machine_stream_not_opened",
            `${machineId} did not open ${request.path} in ${this.#openTimeoutMs} ms; its socket was torn down and the next attempt dials again.`,
          ),
        );
      }, this.#openTimeoutMs);
      opening.unref?.();
      const finish = () => {
        if (ended) return;
        ended = true;
        try {
          controller?.close();
        } catch {
          // Already closed by the consumer.
        }
      };
      let id = -1;
      const sink: Sink = {
        onStart: (status) => {
          clearTimeout(opening);
          if (ended) return; // given up on above; the machine's late answer is not this request's
          resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start: (c) => {
                  controller = c;
                },
                cancel: () => {
                  ended = true;
                  socket.cancel(id);
                },
              }),
              {
                status,
                headers: {
                  "content-type": "text/event-stream",
                  "cache-control": "no-cache",
                  "x-accel-buffering": "no",
                },
              },
            ),
          );
        },
        onEvent: (event) => {
          if (ended || controller === null) return;
          controller.enqueue(
            encoder.encode(
              formatSseEvent({ id: event.eventId, event: event.event, data: event.data }),
            ),
          );
        },
        onEnd: () => {
          clearTimeout(opening);
          if (ended) return;
          if (controller === null) {
            // Ended before it began: the socket dropped mid-handshake of the call.
            resolve(
              Response.json(
                {
                  error: {
                    code: "server_unreachable",
                    message: `The connection to ${machineId} closed before the stream began.`,
                  },
                },
                { status: 502 },
              ),
            );
            ended = true;
            return;
          }
          finish();
        },
        onResponse: (status, body) => {
          clearTimeout(opening);
          if (ended) return;
          // The endpoint answered without streaming (404, 403, …): pass its answer through.
          resolve(Response.json(body ?? null, { status }));
        },
      };
      id = socket.call({ method: "GET", path: request.path, headers }, sink);
    });
  }

  async #socketFor(
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
      const entry: CachedSocket = {
        session: target.session,
        pending: MachineSocket.open(target, this.#dialTimeoutMs),
      };
      entry.pending.then(
        (socket) => {
          this.#refusedUntil.delete(machineId);
          socket.onClose(() => {
            if (this.#sockets.get(machineId) === entry) this.#sockets.delete(machineId);
          });
        },
        (err: unknown) => {
          if (this.#sockets.get(machineId) === entry) this.#sockets.delete(machineId);
          // An ANSWERED refusal is remembered for a while (its build has no socket, or it
          // turned this server away): asking again on every stream would only repeat it. A
          // dial that failed says nothing about the build; the next stream tries again.
          if (err instanceof HandshakeRefused) {
            this.#refusedUntil.set(machineId, {
              until: Date.now() + REFUSED_FOR_MS,
              status: err.status,
            });
            this.log(
              `[machines] no socket on ${machineId} (${err.message}); its streams are refused until it is updated`,
            );
          } else {
            this.log(
              `[machines] socket to ${machineId} failed: ${err instanceof Error ? err.message : err}`,
            );
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
        return this.#socketFor(machineId, target);
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

/** A machine that answered the socket handshake with a status: its build has no socket, or it refused this server. */
function refusedAnswer(machineId: string, status: number): Response {
  return unavailable(
    502,
    "machine_socket_refused",
    `${machineId} answered the API socket handshake with ${status}; update the program on it — streams are not forwarded over HTTP.`,
  );
}
