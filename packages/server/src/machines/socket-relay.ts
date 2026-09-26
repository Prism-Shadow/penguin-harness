/**
 * The relay of a machine's streaming endpoints over the one API socket this server holds to it
 * (PRFC-0011): every stream a browser asks for becomes a `call` frame on that socket, and what
 * comes back is turned into a `text/event-stream` Response for the proxy to return — so the hop
 * is invisible to the socket serving the browser, which re-frames that Response exactly as it
 * would any endpoint's.
 *
 * STREAMS NEVER FALL BACK TO HTTP. A forwarded stream is a never-ending response on a channel
 * of its own, and with many machines those add up to exactly the pile of held connections the
 * socket exists to avoid. When the socket cannot be had — the machine refuses the handshake
 * (a build without it), the dial does not complete — the stream is answered with an error at
 * once and the browser re-issues it on its backoff; a machine that keeps refusing is one to
 * update, and says so.
 *
 * A MACHINE'S OWN EVENT STREAM IS SUBSCRIBED ONCE, not once per reader. `/api/events` is
 * answered by the event hub (machines/event-hub.ts) out of the hub's single subscription to
 * that machine, so a machine's quiet spell is not multiplied by the number of open tabs; every
 * other stream — a Session's output, a machine's other pushed endpoints — is its own call, as
 * it was.
 *
 * The socket itself is the cache's (machines/machine-sockets.ts), shared with the hub: it
 * belongs to the ssh SESSION it was dialled through, not to the machine id, so when the
 * transport reopens the session a socket or a dial made over the old one is let go and the next
 * stream dials over the new one. Nothing waits without a deadline — a dial that neither opens
 * nor fails in time is torn down, so one stuck handshake can never hold every later stream to
 * that machine behind it.
 */
import { formatSseEvent } from "../socket/sse-text.js";
import {
  MachineEventHub,
  STREAM_OPEN_TIMEOUT_MS,
  SUBSCRIBER_HIGH_WATER_BYTES,
  isUserEventsPath,
} from "./event-hub.js";
import type { MachineEventHubOptions } from "./event-hub.js";
import { SOCKET_DIAL_TIMEOUT_MS, MachineSockets } from "./machine-sockets.js";
import type { MachineSocket, MachineSocketTarget, Sink } from "./machine-sockets.js";

export { SOCKET_DIAL_TIMEOUT_MS, STREAM_OPEN_TIMEOUT_MS };
export type { MachineSocketTarget };

export interface MachineSocketRelayOptions extends MachineEventHubOptions {
  /** The shared socket cache; one is made when the relay is used on its own (tests). */
  sockets?: MachineSockets;
  /** The shared event hub; one is made over the same cache when not given. */
  events?: MachineEventHub;
  dialTimeoutMs?: number;
}

/**
 * The stream relay over the shared socket cache. One instance per proxy; the sockets and the
 * event hub are handed in so the machines routes can read the same facts the relay writes.
 */
export class MachineSocketRelay {
  readonly #sockets: MachineSockets;
  readonly #events: MachineEventHub;
  readonly #openTimeoutMs: number;

  constructor(
    private readonly log: (line: string) => void,
    options: MachineSocketRelayOptions = {},
  ) {
    this.#sockets =
      options.sockets ?? new MachineSockets(log, { dialTimeoutMs: options.dialTimeoutMs });
    this.#events = options.events ?? new MachineEventHub(this.#sockets, log, options);
    this.#openTimeoutMs = options.openTimeoutMs ?? STREAM_OPEN_TIMEOUT_MS;
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
    if (isUserEventsPath(request.path)) {
      // The one subscription per machine: every reader of this machine's events, whichever
      // tab or route asked, is served from it (event-hub.ts).
      return this.#respond(machineId, (sink) =>
        this.#events.subscribe(machineId, target, request.lastEventId, sink),
      );
    }
    const got = await this.#sockets.socketFor(machineId, target);
    if (!("answer" in got)) return this.#direct(machineId, got.socket, request);
    return got.answer;
  }

  /** The relay's own path: one call on the machine's socket per stream the caller asked for. */
  #direct(
    machineId: string,
    socket: MachineSocket,
    request: { path: string; lastEventId: string | null },
  ): Promise<Response> {
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (request.lastEventId !== null) headers["last-event-id"] = request.lastEventId;
    return this.#respond(machineId, (base) => {
      // Issued, but neither opened nor answered nor ended in time: the socket is not serving.
      const opening = setTimeout(() => {
        this.log(
          `[machines] stream ${request.path} on ${machineId}: not opened in ${this.#openTimeoutMs} ms over a socket that is alive; terminating the socket, the next stream dials again`,
        );
        socket.cancel(id);
        socket.terminate();
        base.onResponse(504, {
          error: {
            code: "machine_stream_not_opened",
            message: `${machineId} did not open ${request.path} in ${this.#openTimeoutMs} ms; its socket was torn down and the next attempt dials again.`,
          },
        });
      }, this.#openTimeoutMs);
      opening.unref?.();
      const sink: Sink = {
        ...base,
        onStart: (status) => {
          clearTimeout(opening);
          base.onStart(status);
        },
      };
      const id = socket.call({ method: "GET", path: request.path, headers }, sink);
      return () => {
        clearTimeout(opening);
        socket.cancel(id);
      };
    });
  }

  /**
   * Turns a stream's answers into one `text/event-stream` Response. `begin` issues whatever
   * carries the stream — a call on the machine's socket, or the event hub's subscription — and
   * returns the way to stop it; the open deadline is the caller's, since only the caller knows
   * what a stream that never opened means for its transport.
   */
  #respond(machineId: string, begin: (sink: Sink) => () => void): Promise<Response> {
    return new Promise<Response>((resolve) => {
      let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
      let ended = false;
      let stop: () => void = () => undefined;
      const encoder = new TextEncoder();
      const finish = (): void => {
        if (ended) return;
        ended = true;
        stop();
        try {
          controller?.close();
        } catch {
          // Already closed by the consumer.
        }
      };
      const sink: Sink = {
        onStart: (status) => {
          if (ended) return; // given up on already; the machine's late answer is not this request's
          resolve(
            new Response(
              new ReadableStream<Uint8Array>(
                {
                  start: (c) => {
                    controller = c;
                  },
                  cancel: () => finish(),
                },
                // The reader's own queue, in bytes: a consumer that stops reading leaves it
                // full, which is how a stalled reader is found (SUBSCRIBER_HIGH_WATER_BYTES).
                new ByteLengthQueuingStrategy({ highWaterMark: SUBSCRIBER_HIGH_WATER_BYTES }),
              ),
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
          if (controller.desiredSize !== null && controller.desiredSize <= 0) {
            // The reader stopped consuming: its stream is ended so it re-issues with its last
            // event id, rather than this server buffering for it without bound.
            this.log(
              `[machines] stream on ${machineId}: the reader is not consuming; ending the stream so it re-issues`,
            );
            finish();
          }
        },
        onEnd: () => {
          if (ended) return;
          if (controller === null) {
            // Ended before it began: the socket dropped mid-handshake of the call.
            ended = true;
            stop();
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
            return;
          }
          finish();
        },
        onResponse: (status, body) => {
          if (ended) return;
          ended = true;
          stop();
          // The endpoint answered without streaming (404, 403, …): pass its answer through.
          resolve(Response.json(body ?? null, { status }));
        },
      };
      stop = begin(sink);
    });
  }
}
