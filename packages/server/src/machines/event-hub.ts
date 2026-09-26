/**
 * One event stream per machine (PRFC-0011, the machines' half of the API socket).
 *
 * A machine's `/api/events` used to be subscribed once per browser tab — T tabs over N machines
 * held T × N upstream streams, and a machine that went quiet multiplied its re-issue storm by
 * the tab count. The hub subscribes ONCE per machine, over the socket it already holds to that
 * machine (machines/machine-sockets.ts), keeps a bounded replay buffer of its own, and serves
 * every local reader from that one subscription:
 *
 *  - `/server/<machineId>/api/events`, in the machine's own words — same events, same ids,
 *    same `last-event-id` replay at the boundary the buffer still holds;
 *  - `GET /api/projects/:projectId/machines/events`, the aggregate: one stream per tab whatever
 *    the machine count, every event tagged with the machine it came from.
 *
 * The buffer is bounded per MACHINE, never per reader: a reader that stops consuming is ended
 * rather than buffered without bound (the socket's own `lagging` rule, one level down).
 *
 * A stream that goes silent is detected. The machine's `/api/events` writes a `heartbeat`
 * server event every 20 s (http/sse.ts), on the stream rather than under it, so a stream whose
 * machine stopped answering while its socket stays healthy is visible: this hub ends such an
 * upstream subscription after two missed beats and re-subscribes it with the last event id the
 * machine gave it, and the browser does the same with its own end of the stream (web
 * api/socket.ts). The upstream's own failure modes are the relay's: a dial that cannot be had
 * is answered with its reason, a stream that never opens takes the socket down with it.
 */
import { randomUUID } from "node:crypto";
import type { ServerEvent } from "../api/types.js";
import { HEARTBEAT_MS } from "../http/sse.js";
import type { EventFrame } from "../socket/frames.js";
import { formatSseEvent } from "../socket/sse-text.js";
import type {
  MachineSocket,
  MachineSocketTarget,
  MachineSockets,
  Sink,
} from "./machine-sockets.js";

/** The endpoint the hub aggregates: the machine's user-level event stream. */
export function isUserEventsPath(path: string): boolean {
  return (path.split("?")[0] ?? path) === "/api/events";
}

/** The SSE writer's own beat (http/sse.ts): what the hub times an upstream stream's silence by. */
export const STREAM_HEARTBEAT_MS = HEARTBEAT_MS;

/** Beats a stream may miss before it is read as silent. */
export const SILENT_BEATS = 2;
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
/** What one subscription's own replay buffer holds: the most recent 10,000 events or 8MB, like a channel's. */
export const EVENT_REPLAY_COUNT = 10_000;
export const EVENT_REPLAY_BYTES = 8 * 1024 * 1024;
/** A reader this far behind its own stream is ended rather than buffered without bound. */
export const SUBSCRIBER_HIGH_WATER_BYTES = 4 * 1024 * 1024;
/** The wait before a subscription that ended is re-issued: the browser's own backoff shape. */
const REISSUE_MIN_MS = 1_000;
const REISSUE_MAX_MS = 30_000;

/** One buffered event, exactly as the machine sent it (or as the aggregate framed it). */
interface RingEntry {
  id: string | null;
  event: string;
  data: string;
  /** Which machine it came from, in the aggregate's buffer — what a replay is filtered by. */
  machineId?: string;
}

/**
 * A bounded ring of events. `replayAfter` answers the one question a reconnect asks: is the id
 * I bring back still here? An id the ring never held or has already evicted is a miss, and the
 * caller sends `resync_required` — the same contract a channel's buffer has.
 */
class EventRing {
  #entries: RingEntry[] = [];
  #bytes = 0;

  constructor(
    private readonly maxCount: number,
    private readonly maxBytes: number,
  ) {}

  /** The newest id the ring holds — what a re-subscription resumes from. */
  get newestId(): string | null {
    for (let at = this.#entries.length - 1; at >= 0; at -= 1) {
      const id = this.#entries[at]!.id;
      if (id !== null) return id;
    }
    return null;
  }

  push(entry: RingEntry): void {
    this.#entries.push(entry);
    this.#bytes += entry.data.length;
    while (
      this.#entries.length > 0 &&
      (this.#entries.length > this.maxCount || this.#bytes > this.maxBytes)
    ) {
      const evicted = this.#entries.shift()!;
      this.#bytes -= evicted.data.length;
    }
  }

  /**
   * The events after that id. `only` narrows the replay to a subset of machines: the aggregate
   * buffer is the hub's, shared by every tab, while a tab watches the machines of one Project.
   */
  replayAfter(id: string, only?: ReadonlySet<string>): { hit: boolean; entries: RingEntry[] } {
    const at = this.#entries.findIndex((entry) => entry.id === id);
    if (at === -1) return { hit: false, entries: [] };
    const after = this.#entries.slice(at + 1);
    return {
      hit: true,
      entries:
        only === undefined
          ? after
          : after.filter((entry) => entry.machineId !== undefined && only.has(entry.machineId)),
    };
  }
}

/** One reader of a subscription: a stream the hub feeds events into. */
interface Reader {
  sink: Sink;
  /** What this reader brought back as its `last-event-id` (null on a fresh subscribe). */
  join: string | null;
  started: boolean;
  detached: boolean;
}

/** One machine's single subscription: its socket call, its buffer, and its readers. */
interface Subscription {
  machineId: string;
  target: MachineSocketTarget;
  ring: EventRing;
  readers: Set<Reader>;
  socket: MachineSocket | null;
  callId: number;
  /** The current upstream call has been opened by the machine (its `stream` frame arrived). */
  opened: boolean;
  openTimer: ReturnType<typeof setTimeout> | null;
  silenceTimer: ReturnType<typeof setTimeout> | null;
  reissueTimer: ReturnType<typeof setTimeout> | null;
  /** Re-issues in a row that did not open; reset once one does. */
  failures: number;
  /** The machine's newest event id, which a re-subscription resumes from. */
  resumeFrom: string | null;
  /** Dropped: no reader is left and nothing is to be re-issued. */
  gone: boolean;
}

export interface MachineEventHubOptions {
  /** The machine's beat; injectable so a test does not wait 40 s for one. */
  heartbeatMs?: number;
  replayCount?: number;
  replayBytes?: number;
  openTimeoutMs?: number;
  reissueMinMs?: number;
  reissueMaxMs?: number;
}

/** A machine whose events the aggregate stream carries. */
export interface MachineEventSource {
  machineId: string;
  target: MachineSocketTarget;
}

/** One tab's end of the aggregate: the machines it watches, and where its frames go. */
interface AggregateReader {
  sources: ReadonlySet<string>;
  deliver: (id: string, event: string, data: string) => void;
}

/**
 * The aggregate's own buffer and fan-out, one per hub generation.
 *
 * It lives on the HUB, not on a stream: a tab that reconnects brings back a `last-event-id`, and
 * an id can only be honoured by a buffer that outlived the stream it was written on. The buffer
 * is shared by every tab (bounded by the same count/bytes as a channel's), while each tab's
 * replay is narrowed to the machines that tab watches.
 */
class MachineEventAggregate {
  readonly #ring: EventRing;
  readonly #epoch = randomUUID().slice(0, 8);
  #seq = 0;
  readonly #readers = new Set<AggregateReader>();

  constructor(maxCount: number, maxBytes: number) {
    this.#ring = new EventRing(maxCount, maxBytes);
  }

  get readers(): number {
    return this.#readers.size;
  }

  /** One event, numbered and buffered, and handed to every tab watching that machine. */
  publish(machineId: string, event: string, data: string): void {
    const id = `${this.#epoch}-${(this.#seq += 1)}`;
    const tagged = `{"machineId":${JSON.stringify(machineId)},"event":${data}}`;
    this.#ring.push({ id, event: "machine_event", data: tagged, machineId });
    for (const reader of this.#readers) {
      if (reader.sources.has(machineId)) reader.deliver(id, "machine_event", tagged);
    }
  }

  /**
   * Registers one tab: `deliver` hears the live frames, the return value detaches it. The
   * replay is the caller's to write first, out of {@link replay}.
   */
  subscribe(
    sources: ReadonlySet<string>,
    deliver: (id: string, event: string, data: string) => void,
  ): () => void {
    const reader: AggregateReader = { sources, deliver };
    this.#readers.add(reader);
    return () => this.#readers.delete(reader);
  }

  /** What that tab's `last-event-id` still reaches, or a miss it must resync from. */
  replay(
    lastEventId: string,
    sources: ReadonlySet<string>,
  ): { hit: boolean; entries: RingEntry[] } {
    return this.#ring.replayAfter(lastEventId, sources);
  }
}

/**
 * The per-machine event subscriptions of one proxy generation. Readers come and go; the
 * subscription exists while at least one of them is attached, and the buffer goes with it.
 */
export class MachineEventHub {
  readonly #subscriptions = new Map<string, Subscription>();
  readonly #aggregate: MachineEventAggregate;
  readonly #heartbeatMs: number;
  readonly #replayCount: number;
  readonly #replayBytes: number;
  readonly #openTimeoutMs: number;
  readonly #reissueMinMs: number;
  readonly #reissueMaxMs: number;

  constructor(
    private readonly sockets: MachineSockets,
    private readonly log: (line: string) => void,
    options: MachineEventHubOptions = {},
  ) {
    this.#heartbeatMs = options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
    this.#replayCount = options.replayCount ?? EVENT_REPLAY_COUNT;
    this.#replayBytes = options.replayBytes ?? EVENT_REPLAY_BYTES;
    this.#openTimeoutMs = options.openTimeoutMs ?? STREAM_OPEN_TIMEOUT_MS;
    this.#reissueMinMs = options.reissueMinMs ?? REISSUE_MIN_MS;
    this.#reissueMaxMs = options.reissueMaxMs ?? REISSUE_MAX_MS;
    this.#aggregate = new MachineEventAggregate(this.#replayCount, this.#replayBytes);
  }

  /** How many machines the hub is subscribed to right now — the number the aggregation is about. */
  get subscriptions(): number {
    return this.#subscriptions.size;
  }

  /** The aggregate stream's buffer, said in the docs as "the hub keeps a replay buffer of its own". */
  get aggregate(): MachineEventAggregate {
    return this.#aggregate;
  }

  /**
   * One machine's `/api/events`, from the hub's single subscription to it. `lastEventId` is what
   * the reader brings back; the answer is a stream in the machine's own words, so a reader that
   * came from `/server/<machineId>/api/events` cannot tell the hub is in the middle.
   */
  subscribe(
    machineId: string,
    target: MachineSocketTarget,
    lastEventId: string | null,
    sink: Sink,
  ): () => void {
    const subscription = this.#subscriptionFor(machineId, target);
    const reader: Reader = { sink, join: lastEventId, started: false, detached: false };
    subscription.readers.add(reader);
    if (subscription.opened) this.#start(subscription, reader);
    else this.#ensure(subscription);
    return () => {
      reader.detached = true;
      subscription.readers.delete(reader);
      if (subscription.readers.size === 0) this.#drop(subscription);
    };
  }

  #subscriptionFor(machineId: string, target: MachineSocketTarget): Subscription {
    let subscription = this.#subscriptions.get(machineId);
    if (subscription !== undefined && subscription.target.session !== target.session) {
      // The transport reopened the ssh session: the socket this subscription runs on is gone
      // with it, so the subscription is re-established over the new session.
      this.log(
        `[machines] ssh session to ${machineId} was replaced; re-subscribing its event stream over the new one`,
      );
      subscription.target = target;
      this.#restart(subscription);
    }
    if (subscription === undefined) {
      subscription = {
        machineId,
        target,
        ring: new EventRing(this.#replayCount, this.#replayBytes),
        readers: new Set(),
        socket: null,
        callId: -1,
        opened: false,
        openTimer: null,
        silenceTimer: null,
        reissueTimer: null,
        failures: 0,
        resumeFrom: null,
        gone: false,
      };
      this.#subscriptions.set(machineId, subscription);
    }
    return subscription;
  }

  /** Dials the machine and issues the one call this subscription lives on. */
  #ensure(subscription: Subscription): void {
    if (subscription.gone || subscription.socket !== null || subscription.reissueTimer !== null) {
      return;
    }
    void this.#dial(subscription);
  }

  async #dial(subscription: Subscription): Promise<void> {
    const machineId = subscription.machineId;
    const got = await this.sockets.socketFor(machineId, subscription.target);
    if ("answer" in got) {
      if (subscription.gone) return;
      const body = await got.answer
        .clone()
        .json()
        .catch(() => null);
      this.#fail(subscription, got.answer.status, body);
      return;
    }
    const socket = got.socket;
    if (subscription.gone) return;
    subscription.socket = socket;
    socket.onClose(() => {
      if (subscription.socket !== socket) return;
      subscription.socket = null;
      this.#ended(subscription);
    });
    const headers: Record<string, string> = { accept: "text/event-stream" };
    if (subscription.resumeFrom !== null) headers["last-event-id"] = subscription.resumeFrom;
    subscription.opened = false;
    subscription.callId = socket.call(
      { method: "GET", path: "/api/events", headers },
      this.#upstreamSink(subscription),
    );
    subscription.openTimer = setTimeout(() => this.#notOpened(subscription), this.#openTimeoutMs);
    subscription.openTimer.unref?.();
  }

  /** The upstream call's own answers, turned into the subscription's state and its readers' events. */
  #upstreamSink(subscription: Subscription): Sink {
    return {
      onStart: () => {
        this.#clearOpenTimer(subscription);
        subscription.opened = true;
        subscription.failures = 0;
        this.#armSilence(subscription);
        for (const reader of [...subscription.readers]) this.#start(subscription, reader);
      },
      onEvent: (frame) => {
        if (frame.eventId !== null) {
          subscription.resumeFrom = frame.eventId;
        }
        this.#armSilence(subscription);
        subscription.ring.push({ id: frame.eventId, event: frame.event, data: frame.data });
        // The aggregate is fed from here, so a machine's events reach it whether the reader
        // that keeps this subscription alive is one machine's stream or another tab's aggregate.
        if (frame.event === "server_event") {
          this.#aggregate.publish(subscription.machineId, frame.event, frame.data);
        }
        for (const reader of [...subscription.readers]) {
          if (reader.started) reader.sink.onEvent(frame);
        }
      },
      onEnd: () => this.#ended(subscription),
      onResponse: (status, body) => this.#answered(subscription, status, body),
    };
  }

  /** A reader joins a stream the machine has opened: its own preamble, then the live events. */
  #start(subscription: Subscription, reader: Reader): void {
    if (reader.detached || reader.started) return;
    reader.started = true;
    reader.sink.onStart(200);
    if (reader.join === null) {
      // As on /api/events: a fresh subscriber is handed the handshake, not the history.
      reader.sink.onEvent(serverEventFrame({ type: "hello" }));
      return;
    }
    const replay = subscription.ring.replayAfter(reader.join);
    if (!replay.hit) {
      // The id this reader brings back is not in the buffer any more (or never was): the gap
      // cannot be filled from here, and the reader re-fetches what it missed.
      reader.sink.onEvent(serverEventFrame({ type: "resync_required" }));
      return;
    }
    for (const entry of replay.entries) {
      reader.sink.onEvent({ id: 0, event: entry.event, eventId: entry.id, data: entry.data });
    }
  }

  /**
   * The upstream call is over. An opened stream is re-subscribed from the machine's last event
   * id — the readers keep their streams, which is the point of the aggregation; an attempt that
   * never opened is the connection dying mid-handshake, and the readers are told, as they are
   * without a hub in the middle.
   */
  #ended(subscription: Subscription): void {
    this.#clearTimers(subscription);
    subscription.socket = null;
    subscription.callId = -1;
    const wasOpen = subscription.opened;
    subscription.opened = false;
    if (wasOpen || [...subscription.readers].some((reader) => reader.started)) {
      this.#reissue(subscription);
      return;
    }
    this.#fail(subscription, 502, {
      error: {
        code: "server_unreachable",
        message: `The connection to ${subscription.machineId} closed before the stream began.`,
      },
    });
  }

  /** The socket is up but the machine never opened the stream: the socket is not serving. */
  #notOpened(subscription: Subscription): void {
    const machineId = subscription.machineId;
    this.log(
      `[machines] stream /api/events on ${machineId}: not opened in ${this.#openTimeoutMs} ms over a socket that is alive; terminating the socket, the next stream dials again`,
    );
    if (subscription.callId >= 0) subscription.socket?.cancel(subscription.callId);
    subscription.socket?.terminate();
    subscription.socket = null;
    subscription.callId = -1;
    this.#fail(subscription, 504, {
      error: {
        code: "machine_stream_not_opened",
        message: `${machineId} did not open /api/events in ${this.#openTimeoutMs} ms; its socket was torn down and the next attempt dials again.`,
      },
    });
  }

  /** Two beats missed: the stream is not the socket, and only the stream says the machine stopped. */
  #silent(subscription: Subscription): void {
    this.log(
      `[machines] no event on ${subscription.machineId}'s stream for ${SILENT_BEATS * this.#heartbeatMs} ms; re-subscribing it from its last event id`,
    );
    if (subscription.callId >= 0) subscription.socket?.cancel(subscription.callId);
    subscription.callId = -1;
    this.#ended(subscription);
  }

  /** The endpoint answered without streaming (a `403`, a `404`): pass it on, as the proxy does. */
  #answered(subscription: Subscription, status: number, body: unknown): void {
    this.#clearTimers(subscription);
    subscription.socket = null;
    subscription.callId = -1;
    const readers = this.#takeReaders(subscription);
    for (const reader of readers) reader.sink.onResponse(status, body);
  }

  /**
   * The subscription could not be had at all: readers already streaming are ended (they re-issue
   * and hear the reason), readers still waiting are answered with it. Nothing is remembered here
   * — the socket cache remembers a refusal, and a failed dial is retried by the next reader.
   */
  #fail(subscription: Subscription, status: number, body: unknown): void {
    this.#clearTimers(subscription);
    subscription.socket = null;
    subscription.callId = -1;
    subscription.opened = false;
    const readers = this.#takeReaders(subscription);
    for (const reader of readers) {
      if (reader.started) reader.sink.onEnd();
      else reader.sink.onResponse(status, body);
    }
  }

  /** Issues the subscription again while anyone is reading; drops it when nobody is. */
  #reissue(subscription: Subscription): void {
    if (subscription.gone || subscription.readers.size === 0) {
      this.#drop(subscription);
      return;
    }
    const delay = Math.min(this.#reissueMaxMs, this.#reissueMinMs * 2 ** subscription.failures);
    subscription.failures += 1;
    subscription.reissueTimer = setTimeout(() => {
      subscription.reissueTimer = null;
      this.#ensure(subscription);
    }, delay);
    subscription.reissueTimer.unref?.();
  }

  /** The session moved: whatever is in flight for the old one is let go and re-issued at once. */
  #restart(subscription: Subscription): void {
    this.#clearTimers(subscription);
    if (subscription.callId >= 0) subscription.socket?.cancel(subscription.callId);
    subscription.socket = null;
    subscription.callId = -1;
    subscription.opened = false;
    this.#ensure(subscription);
  }

  /** Detaches every reader and forgets the subscription: the buffer goes with it. */
  #drop(subscription: Subscription): void {
    if (subscription.gone) return;
    subscription.gone = true;
    this.#clearTimers(subscription);
    if (subscription.callId >= 0) subscription.socket?.cancel(subscription.callId);
    subscription.socket = null;
    subscription.callId = -1;
    subscription.readers.clear();
    if (this.#subscriptions.get(subscription.machineId) === subscription) {
      this.#subscriptions.delete(subscription.machineId);
    }
  }

  #takeReaders(subscription: Subscription): Reader[] {
    const readers = [...subscription.readers];
    subscription.readers.clear();
    subscription.gone = true;
    if (this.#subscriptions.get(subscription.machineId) === subscription) {
      this.#subscriptions.delete(subscription.machineId);
    }
    return readers;
  }

  #armSilence(subscription: Subscription): void {
    this.#clearSilenceTimer(subscription);
    subscription.silenceTimer = setTimeout(
      () => this.#silent(subscription),
      SILENT_BEATS * this.#heartbeatMs,
    );
    subscription.silenceTimer.unref?.();
  }

  #clearOpenTimer(subscription: Subscription): void {
    if (subscription.openTimer !== null) clearTimeout(subscription.openTimer);
    subscription.openTimer = null;
  }

  #clearSilenceTimer(subscription: Subscription): void {
    if (subscription.silenceTimer !== null) clearTimeout(subscription.silenceTimer);
    subscription.silenceTimer = null;
  }

  #clearTimers(subscription: Subscription): void {
    this.#clearOpenTimer(subscription);
    this.#clearSilenceTimer(subscription);
    if (subscription.reissueTimer !== null) clearTimeout(subscription.reissueTimer);
    subscription.reissueTimer = null;
  }
}

/** A server event as a frame of the machine's own stream. `id` is the caller's and unused here. */
function serverEventFrame(event: ServerEvent): EventFrame {
  return { id: 0, event: "server_event", eventId: null, data: JSON.stringify(event) };
}

export interface AggregateOptions {
  /** The hub's own beat on a tab's stream, so a tab can tell a live aggregate from a stalled one. */
  heartbeatMs?: number;
  /**
   * How many bytes a tab may fall behind on its own stream before it is ended and left to
   * re-issue. Injectable so a test does not have to fill a 4 MB socket.
   */
  highWaterBytes?: number;
}

/**
 * The aggregate stream (`GET /api/projects/:projectId/machines/events`): one response per tab,
 * carrying every watched machine's own events, each tagged with the machine it came from, out of
 * the hub's one subscription per machine. `last-event-id` is answered from the hub's aggregate
 * buffer, which outlives the stream it was written on — a tab that reconnects is replayed the
 * events it missed, or told to resync when the buffer has moved past its id.
 *
 * `watched` is the machine ids this tab watches, which decides what it hears and what its replay
 * reaches; `sources` is the same set as hub subscriptions, resolved as their targets come in, so
 * a tab's stream opens at once whatever the machines behind it are doing.
 */
export function machineEventsStream(
  hub: MachineEventHub,
  watched: readonly string[],
  sources: readonly MachineEventSource[] | Promise<readonly MachineEventSource[]>,
  lastEventId: string | null,
  log: (line: string) => void = () => undefined,
  options: AggregateOptions = {},
): Response {
  const encoder = new TextEncoder();
  const watching = new Set(watched);
  const highWater = options.highWaterBytes ?? SUBSCRIBER_HIGH_WATER_BYTES;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let ended = false;
  let beat: ReturnType<typeof setInterval> | null = null;
  let detach: () => void = () => undefined;

  const stop = (): void => {
    if (ended) return;
    ended = true;
    if (beat !== null) clearInterval(beat);
    beat = null;
    detach();
    try {
      controller?.close();
    } catch {
      // Already closed by the consumer.
    }
  };

  /** Writes one frame. The aggregate's buffer already holds what is replay material, so nothing is buffered here. */
  const write = (event: string, data: string, id: string | null): void => {
    if (ended || controller === null) return;
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

  const response = new Response(
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

  const detachAggregate = hub.aggregate.subscribe(watching, (id, event, data) =>
    write(event, data, id),
  );
  // The sources attach as their targets resolve: a machine that answers late joins late.
  let detachSources: () => void = () => undefined;
  void Promise.resolve(sources).then((resolved) => {
    const unsubscribe = resolved.map((source) =>
      hub.subscribe(source.machineId, source.target, null, {
        onStart: () => undefined, // the aggregate starts at once; a machine's own open is not the tab's
        onEvent: () => undefined, // the hub feeds the aggregate itself, on the way past
        onEnd: () => undefined, // the hub re-subscribes; the tab's stream is not the machine's
        onResponse: () => undefined,
      }),
    );
    detachSources = () => {
      for (const stop of unsubscribe) stop();
    };
    if (ended) detachSources();
  });
  detach = () => {
    detachAggregate();
    detachSources();
  };

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
  // machines behind it are doing.
  beat = setInterval(
    () => write("heartbeat", "{}", null),
    options.heartbeatMs ?? STREAM_HEARTBEAT_MS,
  );
  beat.unref?.();

  return response;
}
