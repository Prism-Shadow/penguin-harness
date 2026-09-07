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
 * A machine running a build without the API socket answers the handshake 404; that is
 * remembered briefly and the proxy falls back to forwarding the stream over HTTP, so a fleet
 * mid-upgrade keeps working. When the machine socket closes (the ssh session dropped, the
 * machine restarted), every stream on it ends; the browser re-issues each with its last
 * event id and the machine's own buffer fills the gap, or says resync.
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
}

/** How long a refused handshake keeps the machine on the HTTP path before another try. */
const REFUSED_FOR_MS = 60_000;

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

  /** Resolves on the open handshake; rejects when the machine refuses (no socket there) or cannot be reached. */
  static open(target: MachineSocketTarget): Promise<MachineSocket> {
    return new Promise((resolve, reject) => {
      // No Origin: the machine's guard reads its absence as a non-browser client, which this is.
      // The admin's reserved id: the session minted over there is the admin's, and the
      // machine's runtime holds the id's owner to it.
      const ws = new WebSocket(`ws://127.0.0.1:${target.port}${apiSocketPath(ADMIN_USER_ID)}`, {
        agent: target.agent,
        headers: { host: `localhost:${target.port}`, cookie: target.cookie },
        perMessageDeflate: false,
      });
      ws.once("open", () => resolve(new MachineSocket(ws)));
      ws.once("unexpected-response", (_req, res) => {
        res.resume();
        reject(new HandshakeRefused(res.statusCode ?? 0));
      });
      ws.once("error", (err) => reject(err));
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
}

/**
 * The per-machine socket cache and the stream relay over it. One instance per proxy; keyed
 * by machine id, dropped when the socket closes, and re-dialled on the next stream.
 */
export class MachineSocketRelay {
  readonly #sockets = new Map<string, Promise<MachineSocket>>();
  readonly #refusedUntil = new Map<string, number>();

  constructor(private readonly log: (line: string) => void) {}

  /**
   * Relays one streaming request; null when this machine has no socket to relay over (the
   * handshake was refused: an older build), in which case the caller forwards over HTTP.
   */
  async stream(
    machineId: string,
    target: MachineSocketTarget,
    request: { path: string; lastEventId: string | null },
  ): Promise<Response | null> {
    const socket = await this.#socketFor(machineId, target);
    if (socket === null) return null;

    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (request.lastEventId !== null) headers["last-event-id"] = request.lastEventId;

    return new Promise<Response>((resolve) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let ended = false;
      const encoder = new TextEncoder();
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
          // The endpoint answered without streaming (404, 403, …): pass its answer through.
          resolve(Response.json(body ?? null, { status }));
        },
      };
      id = socket.call({ method: "GET", path: request.path, headers }, sink);
    });
  }

  async #socketFor(machineId: string, target: MachineSocketTarget): Promise<MachineSocket | null> {
    const refusedUntil = this.#refusedUntil.get(machineId);
    if (refusedUntil !== undefined && Date.now() < refusedUntil) return null;
    let pending = this.#sockets.get(machineId);
    if (pending === undefined) {
      pending = MachineSocket.open(target).then(
        (socket) => {
          socket.onClose(() => {
            if (this.#sockets.get(machineId) === pending) this.#sockets.delete(machineId);
          });
          return socket;
        },
        (err: unknown) => {
          this.#sockets.delete(machineId);
          // Only an ANSWERED refusal parks the machine on the HTTP path (its build has no
          // socket); a dial that failed says nothing about the build, and the next stream
          // tries the socket again — the ssh session may well be back by then.
          if (err instanceof HandshakeRefused) {
            this.#refusedUntil.set(machineId, Date.now() + REFUSED_FOR_MS);
            this.log(
              `[machines] no socket on ${machineId} (${err.message}); streams go over HTTP for a while`,
            );
          } else {
            this.log(
              `[machines] socket to ${machineId} failed: ${err instanceof Error ? err.message : err}`,
            );
          }
          throw err;
        },
      );
      this.#sockets.set(machineId, pending);
    }
    try {
      const socket = await pending;
      if (socket.closed) {
        this.#sockets.delete(machineId);
        return this.#socketFor(machineId, target);
      }
      return socket;
    } catch {
      return null;
    }
  }
}
