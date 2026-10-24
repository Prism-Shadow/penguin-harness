/**
 * Following a Session: its history, then its live records, as one ordered sequence.
 *
 * {@link SessionReader} is the protocol half of what a chat view does when it opens a Session:
 *
 * 1. subscribe to the Session stream, holding what arrives;
 * 2. once the stream speaks (its first frame — a heartbeat on a fresh subscription), read the
 *    history's tail window;
 * 3. weave the live tail in: while the Session runs, the history answer carries `live`
 *    `{cursor, fragments}` — the stream's id at the read, and every open `partial_*` message so
 *    far as one `start` with the text streamed until then. Held fragments at or before the
 *    cursor are dropped (the snapshot holds their text), the snapshot takes their place, and the
 *    rest follows;
 * 4. deliver the held records;
 * 5. skipping any complete record the history already delivered (the stream can publish a record
 *    a moment before the Trace has it, so both can hold it);
 * 6. once the stream has carried a heartbeat, 50 s without any frame means the connection died
 *    without saying so: it is closed and opened again with `Last-Event-ID`, and the server
 *    replays what was missed. A stream that ends is reopened the same way;
 * 7. a reopen the server refuses 409 `resync_required` — the id it resumed from has left the
 *    server's buffer, or the server restarted — starts over as a first open does: a `reset`,
 *    then the stream without `Last-Event-ID` and the history read under it.
 *
 * There is no approvals table: pending approvals are a resource (`…/approvals`), not on the
 * stream. A record whose `payload.type` the caller does not know is delivered like any other.
 */
import { AmspHttpError } from "./errors.js";
import type { StreamEnd, Transport } from "./transport.js";
import type { AmspControl, AmspRecord, HistoryRecord, MessagesResponse } from "./types.js";

/** The server's answer to a resume its buffer cannot serve: start over from the history. */
const isResyncRequired = (err: unknown): boolean =>
  err instanceof AmspHttpError && err.status === 409 && err.code === "resync_required";

/** One record, as the reader delivers it: from the history read, or from the stream. */
export interface ReaderEvent {
  record: HistoryRecord;
  /** The stream's event id; null for a history record and for the live snapshot's fragments. */
  id: string | null;
  source: "history" | "live";
}

export interface SessionReaderOptions {
  /** Tasks in the history window read on open and on every resync. Default 20. */
  tailLimit?: number;
  /**
   * The Session stream's path. Default `/sessions/<id>/stream`, the key door's; a page reading
   * the cookie door with an {@link HttpTransport} at `/api` gives `/sessions/<id>/amsp`.
   */
  streamPath?: string;
  /** Silence after which a stream that has carried a heartbeat counts as dead. Default 50 000 ms. */
  watchdogMs?: number;
  /** Pause before a stream that ended or failed is opened again. Default 1 000 ms. */
  reconnectMs?: number;
}

type Listener<T> = (value: T) => void;

/** A stream event id, `<epoch>-<seq>`; null when it is not one. */
function parseId(id: string): { epoch: string; seq: number } | null {
  const sep = id.lastIndexOf("-");
  if (sep <= 0) return null;
  const seq = Number.parseInt(id.slice(sep + 1), 10);
  if (!Number.isInteger(seq) || seq < 0) return null;
  return { epoch: id.slice(0, sep), seq };
}

const isPartial = (rec: AmspRecord): boolean =>
  rec.type === "model_msg" &&
  ((rec.payload as { type?: string }).type ?? "").startsWith("partial_");

/**
 * An image slot as the duplicate check sees it: the bytes (`data:`) and a history page's
 * reference to the same Trace record (`…/sessions/<id>/trace-image?…`, either door) are one image.
 */
function imageInKey(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.startsWith("data:") || /\/sessions\/[^/?#]+\/trace-image\?/.test(value)
    ? "<image>"
    : value;
}

/** The envelope a history copy and a stream copy of one record share. */
function dedupKey(rec: AmspRecord): string {
  const { tracePosition: _position, ...envelope } = rec as HistoryRecord;
  if (rec.type === "model_msg") {
    const p = rec.payload as { type?: string; image_url?: unknown; images?: unknown };
    if (p.type === "image_url") {
      return JSON.stringify({ ...envelope, payload: { ...p, image_url: imageInKey(p.image_url) } });
    }
    if (p.type === "tool_call_output" && Array.isArray(p.images)) {
      return JSON.stringify({ ...envelope, payload: { ...p, images: p.images.map(imageInKey) } });
    }
  }
  return JSON.stringify(envelope);
}

/** How many of the history's last records a held record is checked against. */
const DEDUP_WINDOW = 100;

interface Held {
  id: string | null;
  record: AmspRecord;
}

/**
 * Follows one Session through a {@link Transport}. It opens on the next microtask, so listeners
 * added right after construction see everything; `close()` stops it for good.
 *
 * ```ts
 * const reader = new SessionReader(new HttpTransport({ baseUrl, apiKey }), sessionId);
 * reader.on("event", ({ record, source }) => render(record, source));
 * reader.on("reset", () => clearView());
 * ```
 */
export class SessionReader {
  readonly #transport: Transport;
  readonly #sessionId: string;
  readonly #tailLimit: number;
  readonly #streamPath: string;
  readonly #watchdogMs: number;
  readonly #reconnectMs: number;
  readonly #listeners = {
    event: new Set<Listener<ReaderEvent>>(),
    reset: new Set<Listener<void>>(),
    error: new Set<Listener<unknown>>(),
  };
  #closed = false;
  /** `waiting`: subscribed, history not asked for yet; `loading`: history in flight; `live`: delivering as it comes. */
  #phase: "waiting" | "loading" | "live" = "waiting";
  #held: Held[] = [];
  /** The last stream id seen: where a reconnect resumes. */
  #lastId: string | null = null;
  /** Bumped by every history read, so a read a resync overtook is dropped. */
  #epoch = 0;
  #connection: AbortController | null = null;
  #watchdog: ReturnType<typeof setTimeout> | null = null;
  #retry: ReturnType<typeof setTimeout> | null = null;

  constructor(transport: Transport, sessionId: string, opts: SessionReaderOptions = {}) {
    this.#transport = transport;
    this.#sessionId = sessionId;
    this.#tailLimit = opts.tailLimit ?? 20;
    this.#streamPath = opts.streamPath ?? `/sessions/${encodeURIComponent(sessionId)}/stream`;
    this.#watchdogMs = opts.watchdogMs ?? 50_000;
    this.#reconnectMs = opts.reconnectMs ?? 1_000;
    queueMicrotask(() => this.#connect(true));
  }

  /**
   * `event`: one record, history first, then live. `reset`: what was delivered so far is void
   * (the stream lost its place); the history follows again. `error`: the server refused the
   * stream or the history for good (a 4xx such as 404), and the reader has stopped.
   */
  on(type: "event", listener: Listener<ReaderEvent>): () => void;
  on(type: "reset", listener: Listener<void>): () => void;
  on(type: "error", listener: Listener<unknown>): () => void;
  on(type: "event" | "reset" | "error", listener: Listener<never>): () => void {
    const set = this.#listeners[type] as Set<Listener<never>>;
    set.add(listener);
    return () => void set.delete(listener);
  }

  /** Stops following: the stream closes and nothing more is delivered. */
  close(): void {
    this.#closed = true;
    this.#connection?.abort();
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    if (this.#retry !== null) clearTimeout(this.#retry);
  }

  #emit(record: HistoryRecord, id: string | null, source: "history" | "live"): void {
    if (this.#closed) return;
    for (const listener of this.#listeners.event) listener({ record, id, source });
  }

  #fail(error: unknown): void {
    this.close();
    for (const listener of this.#listeners.error) listener(error);
  }

  /** Opens the stream; `fresh` reads the history once it speaks, else it resumes from the last id. */
  #connect(fresh: boolean): void {
    if (this.#closed) return;
    const connection = new AbortController();
    this.#connection = connection;
    let sawPing = false;
    if (fresh) {
      this.#phase = "waiting";
      this.#held = [];
    }
    const arm = (): void => {
      if (this.#watchdog !== null) clearTimeout(this.#watchdog);
      this.#watchdog = null;
      if (!sawPing || this.#closed) return;
      this.#watchdog = setTimeout(() => connection.abort("watchdog"), this.#watchdogMs);
    };
    const spoke = (): void => {
      arm();
      if (this.#phase === "waiting") void this.#loadHistory();
    };
    const resume = this.#lastId;
    const done = this.#transport.stream(this.#streamPath, {
      ...(fresh || resume === null ? {} : { lastEventId: resume }),
      signal: connection.signal,
      onRecord: (id, record) => {
        if (connection.signal.aborted) return;
        if (id !== null) this.#lastId = id;
        if (this.#phase === "live") this.#emit(record, id, "live");
        else this.#held.push({ id, record });
        spoke();
      },
      onControl: (control: AmspControl) => {
        if (connection.signal.aborted) return;
        if (control.kind === "ping") sawPing = true;
        spoke();
      },
    });
    done.then(
      (_end: StreamEnd) => this.#reopen(connection),
      (err: unknown) => {
        if (!connection.signal.aborted && isResyncRequired(err)) {
          this.#startOver(connection);
          return;
        }
        // A refusal no retry will change (the Session is gone, the key was revoked) ends it.
        if (
          !connection.signal.aborted &&
          err instanceof AmspHttpError &&
          err.status >= 400 &&
          err.status < 500 &&
          err.status !== 408 &&
          err.status !== 429
        ) {
          this.#fail(err);
          return;
        }
        this.#reopen(connection);
      },
    );
  }

  /** The stream is over (ended, broken, or cut by the watchdog): open it again, from the last id. */
  #reopen(connection: AbortController): void {
    if (this.#closed || this.#connection !== connection) return;
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#watchdog = null;
    const cutByWatchdog = connection.signal.aborted;
    connection.abort();
    // Without an id to resume from nothing says what was missed: read the history again.
    const fresh = this.#lastId === null;
    if (fresh) this.#reset();
    const go = () => {
      this.#retry = null;
      this.#connect(fresh);
    };
    if (cutByWatchdog) go();
    else this.#retry = setTimeout(go, this.#reconnectMs);
  }

  #reset(): void {
    this.#epoch += 1;
    this.#phase = "waiting";
    this.#held = [];
    for (const listener of this.#listeners.reset) listener();
  }

  /** A resume refused `resync_required`: what was delivered is void; open as the first time. */
  #startOver(connection: AbortController): void {
    if (this.#closed || this.#connection !== connection) return;
    if (this.#watchdog !== null) clearTimeout(this.#watchdog);
    this.#watchdog = null;
    this.#lastId = null;
    this.#reset();
    this.#connect(true);
  }

  async #loadHistory(): Promise<void> {
    const epoch = ++this.#epoch;
    this.#phase = "loading";
    let res: MessagesResponse | null;
    try {
      res = (
        await this.#transport.get<MessagesResponse>(
          `/sessions/${encodeURIComponent(this.#sessionId)}/messages?tailLimit=${this.#tailLimit}`,
        )
      ).body;
    } catch (err) {
      if (this.#closed || epoch !== this.#epoch) return;
      if (err instanceof AmspHttpError && err.status >= 400 && err.status < 500) {
        this.#fail(err);
        return;
      }
      // Try again on the same stream, holding what it brings meanwhile.
      this.#phase = "waiting";
      this.#retry = setTimeout(() => {
        this.#retry = null;
        if (this.#phase === "waiting") void this.#loadHistory();
      }, this.#reconnectMs);
      return;
    }
    if (this.#closed || epoch !== this.#epoch) return;
    const messages = res?.messages ?? [];
    for (const record of messages) this.#emit(record, null, "history");
    const seen = new Set<string>();
    for (let i = Math.max(0, messages.length - DEDUP_WINDOW); i < messages.length; i++) {
      seen.add(dedupKey(messages[i]!));
    }
    const held = this.#held;
    this.#held = [];
    for (const { id, record } of res?.live !== undefined ? this.#weave(held, res.live) : held) {
      if (!isPartial(record) && seen.has(dedupKey(record))) continue;
      this.#emit(record, id, "live");
      if (this.#closed || epoch !== this.#epoch) return;
    }
    this.#phase = "live";
  }

  /**
   * The held records with the live snapshot woven in: what came at or before the cursor without
   * its fragments, then the snapshot, then the rest. A cursor of another epoch than the stream's
   * (the server restarted between the two) is left out; the reopen that follows, refused
   * `resync_required`, covers it.
   */
  #weave(held: Held[], live: NonNullable<MessagesResponse["live"]>): Held[] {
    const cursor = parseId(live.cursor);
    if (cursor === null) return held;
    const seenEpoch = this.#lastId === null ? null : parseId(this.#lastId)?.epoch;
    if (seenEpoch !== undefined && seenEpoch !== null && seenEpoch !== cursor.epoch) return held;
    const before: Held[] = [];
    const after: Held[] = [];
    for (const entry of held) {
      const at = entry.id === null ? null : parseId(entry.id);
      if (at !== null && at.epoch === cursor.epoch && at.seq <= cursor.seq) {
        if (!isPartial(entry.record)) before.push(entry);
      } else {
        after.push(entry);
      }
    }
    return [...before, ...live.fragments.map((record) => ({ id: null, record })), ...after];
  }
}
