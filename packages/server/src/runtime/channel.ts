/**
 * SSE event channel.
 *
 * The Session channel and the user channel share this implementation:
 *   - Event id is an opaque string `<epoch>-<seq>`: epoch is a random short string
 *     generated when each Channel instance is created, seq is a monotonically increasing
 *     integer within the channel. epoch necessarily changes when the channel is
 *     recycled/recreated or the process restarts, so a stale Last-Event-ID always misses
 *     and falls through to resync — this prevents a silent false-hit event loss when the
 *     new epoch's event count happens to exceed the old id;
 *   - A bounded ring buffer (most recent 1000 entries or 2MB, whichever comes first,
 *     evicting the oldest on overflow) serves replay-on-reconnect via `Last-Event-ID`;
 *     an evicted/unknown id is handled by the caller sending `resync_required`;
 *   - Unicast (sendTo) is used for one-off replay at subscribe time (pending approvals /
 *     resync / hello): it consumes a seq number but doesn't enter the buffer or get
 *     broadcast — if that subscriber later reconnects with this id, the hit check is
 *     still safe (seq is monotonic).
 *
 * This module only handles event numbering / buffering / dispatch, not HTTP — SSE
 * output is adapted at the routing layer.
 * Docs: /docs/server-api § "Delivery Guarantees".
 */
import { randomUUID } from "node:crypto";

/** A numbered channel event; `id` is `<epoch>-<seq>`, `data` is serialized single-line JSON. */
export interface ChannelEvent {
  id: string;
  /** SSE event name; omitted (OmniMessage) means no `event:` line. */
  event?: string;
  data: string;
}

export type ChannelListener = (evt: ChannelEvent) => void;

export interface ChannelOptions {
  maxBufferCount?: number;
  maxBufferBytes?: number;
}

// Sized so a mid-stream reconnect during a fast large-code reply still hits replay instead of
// resync_required: the server publishes one event per provider delta (a 240KB reply ≈ 5k events
// / 1.4MB), and 1000 events covered only ~6s of such a stream — every longer blip forced a full
// client-side history rebuild.
const DEFAULT_MAX_COUNT = 10_000;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** Buffered entry: seq is stored separately so hit checks never need to parse the string id. */
interface BufferedEvent {
  seq: number;
  evt: ChannelEvent;
}

export class Channel {
  /** Channel epoch: generated at instance creation, prefixed onto event ids (necessarily changes after recycle/recreate or restart). */
  readonly epoch: string = randomUUID().slice(0, 8);
  private nextSeq = 1;
  private buffer: BufferedEvent[] = [];
  private bufferBytes = 0;
  /** Max seq among evicted events (0 means never evicted): lower bound for hit checks. */
  private lastEvictedSeq = 0;
  private readonly listeners = new Set<ChannelListener>();
  private readonly maxCount: number;
  private readonly maxBytes: number;
  /** Timestamp of last activity (publish/subscription change), used for idle-reclaim checks. */
  lastActivityMs = Date.now();

  constructor(opts: ChannelOptions = {}) {
    this.maxCount = opts.maxBufferCount ?? DEFAULT_MAX_COUNT;
    this.maxBytes = opts.maxBufferBytes ?? DEFAULT_MAX_BYTES;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  /** Broadcast an event: number it, buffer it (evicting the oldest), notify all subscribers. */
  publish(data: unknown, event?: string): ChannelEvent {
    const entry = this.makeEvent(data, event);
    this.buffer.push(entry);
    this.bufferBytes += entry.evt.data.length;
    while (
      this.buffer.length > 0 &&
      (this.buffer.length > this.maxCount || this.bufferBytes > this.maxBytes)
    ) {
      const evicted = this.buffer.shift()!;
      this.bufferBytes -= evicted.evt.data.length;
      this.lastEvictedSeq = Math.max(this.lastEvictedSeq, evicted.seq);
    }
    for (const listener of this.listeners) listener(entry.evt);
    return entry.evt;
  }

  /** Unicast an event to a single subscriber: consumes a seq but doesn't buffer or broadcast (used for replay at subscribe time). */
  sendTo(listener: ChannelListener, data: unknown, event?: string): ChannelEvent {
    const entry = this.makeEvent(data, event);
    listener(entry.evt);
    return entry.evt;
  }

  subscribe(listener: ChannelListener): () => void {
    this.listeners.add(listener);
    this.lastActivityMs = Date.now();
    return () => {
      this.listeners.delete(listener);
      this.lastActivityMs = Date.now();
    };
  }

  /**
   * Compute replay from a Last-Event-ID (`<epoch>-<seq>`): a mismatched epoch (channel
   * recycled/recreated, process restarted, or malformed id) always misses; a matching
   * epoch hits the buffer (if no events after that seq have been evicted and the seq was
   * indeed assigned by this channel) and returns the buffered events after it; otherwise
   * miss (the caller should send `resync_required` first).
   */
  replayAfter(lastEventId: string): { hit: boolean; events: ChannelEvent[] } {
    const sep = lastEventId.lastIndexOf("-");
    if (sep <= 0) return { hit: false, events: [] };
    const epoch = lastEventId.slice(0, sep);
    const seq = Number.parseInt(lastEventId.slice(sep + 1), 10);
    if (epoch !== this.epoch || !Number.isInteger(seq) || seq < 0) {
      return { hit: false, events: [] };
    }
    const hit = seq >= this.lastEvictedSeq && seq < this.nextSeq;
    if (!hit) return { hit: false, events: [] };
    return { hit: true, events: this.buffer.filter((e) => e.seq > seq).map((e) => e.evt) };
  }

  private makeEvent(data: unknown, event?: string): BufferedEvent {
    this.lastActivityMs = Date.now();
    const serialized = typeof data === "string" ? data : JSON.stringify(data);
    const seq = this.nextSeq++;
    const evt: ChannelEvent = { id: `${this.epoch}-${seq}`, data: serialized };
    if (event !== undefined) evt.event = event;
    return { seq, evt };
  }
}

const DEFAULT_IDLE_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export interface ChannelHubOptions {
  idleMs?: number;
  /**
   * Active check: keys for which this returns true are excluded from idle reclaim (app
   * assembly injects `manager.statusOf(key) !== "idle"`, so a running/compacting
   * Session channel is never reclaimed no matter how long since its last publish; a
   * user channel key looks like `user:<id>` and is always considered active).
   */
  isActive?: (key: string) => boolean;
}

/**
 * Channel collection: lazily created by key (Session id or `user:<user_id>`);
 * a channel whose Session is idle and has had no subscribers for over 30 minutes is
 * reclaimed, releasing its buffer as well.
 */
export class ChannelHub {
  private readonly channels = new Map<string, Channel>();
  private readonly timer: NodeJS.Timeout;
  private readonly idleMs: number;
  private readonly isActive: (key: string) => boolean;

  constructor(opts: ChannelHubOptions = {}) {
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.isActive = opts.isActive ?? (() => false);
    this.timer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref?.();
  }

  get(key: string): Channel {
    let ch = this.channels.get(key);
    if (!ch) {
      ch = new Channel();
      this.channels.set(key, ch);
    }
    return ch;
  }

  peek(key: string): Channel | undefined {
    return this.channels.get(key);
  }

  /** Reclaim idle channels (skips active Sessions: no reclaim even without a publish while awaiting approval); `now` is injectable for tests. */
  sweep(now: number = Date.now()): void {
    for (const [key, ch] of this.channels) {
      if (this.isActive(key)) continue;
      if (ch.subscriberCount === 0 && now - ch.lastActivityMs > this.idleMs) {
        this.channels.delete(key);
      }
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.channels.clear();
  }
}
