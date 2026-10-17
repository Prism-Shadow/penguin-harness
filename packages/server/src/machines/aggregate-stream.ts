/**
 * The aggregate stream (`GET /api/projects/:projectId/machines/events`): one response per tab,
 * carrying every watched machine's own events, each tagged with the machine it came from, out of
 * the hub's one subscription per machine (event-hub.ts). `last-event-id` is answered from the
 * hub's aggregate buffer, which outlives the stream it was written on — a tab that reconnects is
 * replayed the events it missed, or told to resync when the buffer has moved past its id.
 *
 * The set of machines is not fixed when the stream opens. A tab keeps its one stream for as long
 * as it shows the Project (web state/sessions.tsx deliberately does not re-issue it when a machine
 * appears), so a machine this server connects to after the stream opened — one the person brings
 * into use, one re-held after a restart or a hot push, one whose ssh session was being reopened —
 * has to join the stream it already holds. On each of its beats the stream reads the Project's
 * machines again and attaches the ones it does not carry yet. A machine that has joined stays
 * attached as the hub's holder, which dials it again after a failure (event-hub.ts, `Hold`).
 */
import { HEARTBEAT_MS } from "../http/sse.js";
import { formatSseEvent } from "../socket/sse-text.js";
import type { StreamAnswer } from "../socket/stream-answer.js";
import { SUBSCRIBER_HIGH_WATER_BYTES } from "./event-hub.js";
import type { MachineEventHub } from "./event-hub.js";
import type { MachineSocketTarget } from "./machine-sockets.js";

/** A machine a tab watches: its own id, and how to read its connection right now. */
export interface WatchedMachine {
  machineId: string;
  /** The machine's connection, or null while this server holds none to it. */
  target: () => Promise<MachineSocketTarget | null>;
}

export interface AggregateOptions {
  /**
   * The hub's own beat on a tab's stream, so a tab can tell a live aggregate from a stalled one.
   * The machines are read again on the same beat.
   */
  heartbeatMs?: number;
  /**
   * How many bytes a tab may fall behind on its own stream before it is ended and left to
   * re-issue. Injectable so a test does not have to fill a 4 MB socket.
   */
  highWaterBytes?: number;
  /**
   * The socket transport's own answer, when it is the caller (socket/stream-answer.ts): the
   * events answer it directly, as the frames they already are, and the Response this builds
   * carries nothing.
   */
  answer?: StreamAnswer | null;
}

/**
 * Opens one tab's aggregate. `watched` answers which machines the tab watches right now: it is
 * read once as the stream opens (which decides what a `last-event-id` replay reaches) and again
 * on every beat, and a machine is attached once its `target` answers a connection. The stream
 * opens at once whatever the machines behind it are doing.
 */
export function machineEventsStream(
  hub: MachineEventHub,
  watched: () => readonly WatchedMachine[],
  lastEventId: string | null,
  log: (line: string) => void = () => undefined,
  options: AggregateOptions = {},
): Response {
  const answer = options.answer ?? null;
  const encoder = new TextEncoder();
  const highWater = options.highWaterBytes ?? SUBSCRIBER_HIGH_WATER_BYTES;
  // Grows as machines join: the aggregate reads it on every event, so a machine is heard from
  // the moment it is added here.
  const watching = new Set<string>();
  // The machines this tab holds a hub subscription for, and the ones whose target is being read.
  const attached = new Map<string, () => void>();
  const reading = new Set<string>();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let ended = false;
  let beat: ReturnType<typeof setInterval> | null = null;
  let detachAggregate: () => void = () => undefined;

  const stop = (): void => {
    if (ended) return;
    ended = true;
    if (beat !== null) clearInterval(beat);
    beat = null;
    detachAggregate();
    for (const unsubscribe of attached.values()) unsubscribe();
    attached.clear();
    try {
      controller?.close();
    } catch {
      // Already closed by the consumer.
    }
    answer?.end("closed");
  };

  /** Writes one frame. The aggregate's buffer already holds what is replay material, so nothing is buffered here. */
  const write = (event: string, data: string, id: string | null): void => {
    if (ended) return;
    if (answer !== null) {
      answer.event(event, id, data);
      return;
    }
    if (controller === null) return;
    controller.enqueue(encoder.encode(formatSseEvent({ id, event, data })));
    if (controller.desiredSize !== null && controller.desiredSize <= 0) {
      // This tab has stopped consuming: it is ended and re-issues with its last event id rather
      // than being buffered without bound (the socket's own `lagging` rule, one level down).
      log(
        `[machines] an aggregate event stream is over ${highWater} bytes behind; ending it so the tab re-issues with its last event id`,
      );
      stop();
    }
  };

  /** Subscribes one machine as this tab's holder once its connection can be read. */
  const attach = (machine: WatchedMachine): void => {
    const { machineId } = machine;
    if (attached.has(machineId) || reading.has(machineId)) return;
    reading.add(machineId);
    void machine
      .target()
      .catch(() => null)
      .then((target) => {
        reading.delete(machineId);
        // No connection yet: read again on the next beat.
        if (ended || target === null || attached.has(machineId)) return;
        attached.set(
          machineId,
          hub.subscribe(
            machineId,
            target,
            null,
            {
              onStart: () => undefined, // the aggregate starts at once; a machine's own open is not the tab's
              onEvent: () => undefined, // the hub feeds the aggregate itself, on the way past
              onEnd: () => undefined, // the hub re-subscribes; the tab's stream is not the machine's
              onResponse: () => undefined, // likewise: a failed dial is the hub's to retry, not the tab's
            },
            // The tab never re-issues for one machine, so it holds it: a failed dial is dialled again.
            { retarget: machine.target },
          ),
        );
      });
  };

  const join = (machines: readonly WatchedMachine[]): void => {
    for (const machine of machines) {
      watching.add(machine.machineId);
      attach(machine);
    }
  };

  // The stream opens before anything is written into it — an HTTP reader gets the Response
  // with its own queue, the socket's answer its start frame — so the replay below is
  // written into an open stream, never dropped.
  let response: Response;
  if (answer === null) {
    response = new Response(
      new ReadableStream<Uint8Array>(
        {
          start: (c) => {
            controller = c;
          },
          cancel: () => stop(),
        },
        // The tab's own queue, in bytes: a tab that stops reading leaves it full, which is how a
        // stalled reader is found instead of being buffered for without bound.
        new ByteLengthQueuingStrategy({ highWaterMark: highWater }),
      ),
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          "x-accel-buffering": "no",
        },
      },
    );
  } else {
    answer.start(200, { "content-type": "text/event-stream" });
    // The one release path (socket/serve.ts): a cancel frame or the socket closing aborts
    // the call's Request, which ends this stream the way cancelling the HTTP body does.
    answer.signal.addEventListener("abort", stop, { once: true });
    if (answer.signal.aborted) stop();
    // Nothing rides it — the answer carries the stream, and serve.ts drops the body.
    response = new Response(null, { status: 200 });
  }

  // Read before the replay: the machines watched at open are what a `last-event-id` reaches.
  join(watched());
  detachAggregate = hub.aggregate.subscribe(
    watching,
    (id, event, data) => write(event, data, id),
    stop,
  );

  if (lastEventId === null) {
    // As on /api/events: a fresh subscriber is handed the handshake, not the history.
    write("server_event", JSON.stringify({ type: "hello" }), null);
  } else {
    const replay = hub.aggregate.replay(lastEventId, watching);
    if (!replay.hit) {
      write("server_event", JSON.stringify({ type: "resync_required" }), null);
    } else {
      for (const entry of replay.entries) write(entry.event, entry.data, entry.id);
    }
  }
  // The hub's own beat: what lets a tab tell a live aggregate from a stalled one, whatever the
  // machines behind it are doing. It also brings in the machines connected since the last one.
  beat = setInterval(() => {
    write("heartbeat", "{}", null);
    if (ended) return;
    try {
      join(watched());
    } catch (err) {
      log(
        `[machines] could not read the machines an aggregate event stream watches: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, options.heartbeatMs ?? HEARTBEAT_MS);
  beat.unref?.();

  return response;
}
