/**
 * The web leg of a history stream (spec 05, "History stream"): how `GET …/sessions/:id/history` and
 * `…/trace-body` answer, for this server's own Sessions (http/routes/history.ts) and, on a hub,
 * for a machine's (machines/history-routes.ts) — one writer, so a record reads the same either way.
 *
 * A window travels as its `page` facts, then its records as whole JSON lines — each the
 * `HistoryMessage` the chat renders, its bulky values elided (core's history-elision.ts) — cut at
 * FRAME_TEXT_BUDGET, a record longer than that as `part`s, then `done`. Ids are
 * `<windowId>:<offset after the event>`, the offset counting the window's text in JS string
 * length (what the reader's acks count): a stream re-issued with `last-event-id` while its window
 * is still held — 2 min, a few per reader and a few MiB in all, and only for the same Session,
 * reader and query — continues where it stopped; otherwise the reader gets a new window under a
 * new id and drops what it had of the old one. The reader closes the stream itself on `done`,
 * `filled` or `error`: the socket client issues again any stream the server ends.
 *
 * Over the API socket the events go out as frames, paced by the reader's acks (`x-flow:
 * credit`, socket/stream-answer.ts); over HTTP as SSE text, paced by the reader's reading. A
 * named `ping` beats every 5 s either way, and no step has a deadline: a stream that waits on a
 * machine says so in its `progress`, at most every 250 ms and only when a number changed. An HTTP
 * stream is held against its sign-in as the channel streams are (http/sse.ts): signing out ends it.
 */
import { randomBytes } from "node:crypto";
import { elideHistoryRecord } from "@prismshadow/penguin-core/interfaces";
import type { BodySource } from "@prismshadow/penguin-core/interfaces";
import type {
  HistoryMessage,
  HistoryPage,
  HistoryProgress,
  HistoryRecords,
  HistoryStreamError,
  HistoryStreamEvent,
  MessagesResponse,
} from "../api/types.js";
import { HttpError, badRequest } from "../http/errors.js";
import { FRAME_TEXT_BUDGET } from "../socket/line-frames.js";
import { messagesPageQuery } from "./session-history.js";
import { MESSAGES_PAGE_MAX_BYTES } from "./trace-service.js";
import type { MessagesPageRequest } from "./trace-service.js";
import type { SseRevocation } from "../http/sse.js";
import { formatSseEvent } from "../socket/sse-text.js";
import { answerOf } from "../socket/stream-answer.js";
import type { StreamAnswer } from "../socket/stream-answer.js";

/**
 * What one `history` call asks for: a window — the grammar of `/messages` (`tailLimit` ·
 * `before&limit` · none for the whole transcript) plus `budget` — and with `fill=1` the rest of
 * the Session after it; or, with `fill=only`, no window: one file (`file=<index>`, of the
 * Session's own Agent unless `agent=` names another) or the whole Session made whole.
 */
export type HistoryQuery =
  | { kind: "window"; read: MessagesPageRequest | { kind: "full" }; fill: boolean }
  | { kind: "fill"; file: { index: number; agentId: string | null } | null };

/** Parses a `history` call's query (`query` reads one parameter); a 400 for anything else. */
export function parseHistoryQuery(query: (name: string) => string | undefined): HistoryQuery {
  const fill = query("fill");
  if (fill !== undefined && fill !== "1" && fill !== "only") {
    throw badRequest("fill must be 1 or only.");
  }
  const rawFile = query("file");
  const rawAgent = query("agent");
  if (fill === "only") {
    for (const name of ["tailLimit", "before", "limit", "budget"]) {
      if (query(name) !== undefined) throw badRequest(`${name} does not apply to fill=only.`);
    }
    if (rawFile === undefined) {
      if (rawAgent !== undefined) throw badRequest("agent requires file.");
      return { kind: "fill", file: null };
    }
    const index = /^[1-9]\d{0,5}$/.test(rawFile) ? Number(rawFile) : null;
    if (index === null) throw badRequest("file must be a Trace file index.");
    if (rawAgent !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(rawAgent)) {
      throw badRequest("agent must be an Agent id.");
    }
    return { kind: "fill", file: { index, agentId: rawAgent ?? null } };
  }
  if (rawFile !== undefined || rawAgent !== undefined) {
    throw badRequest("file and agent only apply to fill=only.");
  }
  const page = messagesPageQuery(query);
  const rawBudget = query("budget");
  if (rawBudget === undefined) {
    return { kind: "window", read: page ?? { kind: "full" }, fill: fill === "1" };
  }
  if (page === null) throw badRequest("budget only applies to tailLimit and before reads.");
  const budget = /^\d{1,9}$/.test(rawBudget) ? Number(rawBudget) : 0;
  if (budget < 1 || budget > MESSAGES_PAGE_MAX_BYTES) {
    throw badRequest(`budget must be an integer between 1 and ${MESSAGES_PAGE_MAX_BYTES}.`);
  }
  return { kind: "window", read: { ...page, budget }, fill: fill === "1" };
}

/** The beat of a history stream: a `ping` whenever nothing else went for this long. */
export const HISTORY_BEAT_MS = 5_000;
/** `progress` goes at most this often. */
export const PROGRESS_EVERY_MS = 250;
/** How long a sent window is held for a re-issued stream to continue. */
export const HELD_WINDOW_MS = 120_000;
/** How many windows, and how many bytes of them, are held per reader and in all. */
export const HELD_WINDOWS_PER_USER = 8;
export const HELD_BYTES_PER_USER = 8 * 1024 * 1024;
export const HELD_BYTES = 32 * 1024 * 1024;

/** One history stream's way out, over either transport. Sends go in order. */
export interface HistoryOut {
  /** Aborts when the reader is gone (a cancel, the socket or the connection closing). */
  readonly signal: AbortSignal;
  /** Sends one event once the reader can take it; rejects once the reader is gone. */
  send(event: HistoryStreamEvent, id: string | null, data: string): Promise<void>;
  /** Ends the stream (the reader closes it itself on `done` or `filled`). */
  end(): void;
}

/** Over the API socket: the call's own answer, paced by its credit. */
class AnswerOut implements HistoryOut {
  readonly signal: AbortSignal;
  #chain: Promise<void> = Promise.resolve();

  constructor(private readonly answer: StreamAnswer) {
    this.signal = answer.signal;
  }

  send(event: HistoryStreamEvent, id: string | null, data: string): Promise<void> {
    const run = this.#chain.then(async () => {
      await this.answer.writable(data.length);
      if (this.signal.aborted) throw this.signal.reason;
      this.answer.event(event, id, data);
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  end(): void {
    this.answer.end("closed");
  }
}

/** Over HTTP: SSE text into the response body, waiting while the reader's queue is full. */
class SseOut implements HistoryOut {
  readonly signal: AbortSignal;
  readonly body: ReadableStream<Uint8Array>;
  readonly #abort = new AbortController();
  readonly #encoder = new TextEncoder();
  #controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  #wake: (() => void) | null = null;
  #chain: Promise<void> = Promise.resolve();
  #ended = false;
  #lastSent = Date.now();
  readonly #beat: ReturnType<typeof setInterval>;

  readonly #release: () => void;

  constructor(request: Request, revocation: SseRevocation | undefined) {
    this.signal = this.#abort.signal;
    const abort = () => this.#abort.abort(new Error("the reader is gone"));
    request.signal.addEventListener("abort", abort, { once: true });
    // Held for as long as the connection lives, so a sign-out elsewhere can end it (http/sse.ts).
    this.#release = revocation?.streams.add(revocation.userId, abort) ?? (() => undefined);
    this.body = new ReadableStream<Uint8Array>(
      {
        start: (c) => {
          this.#controller = c;
        },
        pull: () => this.#wakeUp(),
        cancel: abort,
      },
      new ByteLengthQueuingStrategy({ highWaterMark: 4 * FRAME_TEXT_BUDGET }),
    );
    this.#beat = setInterval(() => {
      // The beat re-asks whether the sign-in behind the stream still holds, never renewing it.
      if (revocation !== undefined && !revocation.sessionIsLive()) {
        abort();
        return;
      }
      if (Date.now() - this.#lastSent >= HISTORY_BEAT_MS) void this.send("ping", null, "{}");
    }, HISTORY_BEAT_MS);
    this.#beat.unref?.();
    this.signal.addEventListener("abort", () => this.end(), { once: true });
  }

  #wakeUp(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  send(event: HistoryStreamEvent, id: string | null, data: string): Promise<void> {
    const run = this.#chain.then(async () => {
      while (!this.#ended && (this.#controller?.desiredSize ?? 0) <= 0) {
        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
      }
      if (this.#ended || this.#controller === null) throw new Error("the stream has ended");
      this.#controller.enqueue(this.#encoder.encode(formatSseEvent({ id, event, data })));
      this.#lastSent = Date.now();
    });
    this.#chain = run.catch(() => undefined);
    return run;
  }

  end(): void {
    if (this.#ended) return;
    this.#ended = true;
    clearInterval(this.#beat);
    this.#release();
    this.#wakeUp();
    try {
      this.#controller?.close();
    } catch {
      // Already closed by the reader.
    }
  }
}

/**
 * Opens a history stream for `request`: over the socket when the socket carried the call, as
 * SSE text otherwise — held against `revocation`, the sign-in behind it, when one is given. The
 * Response is the route's to return at once.
 */
export function openHistoryOut(
  request: Request,
  options: { revocation?: SseRevocation } = {},
): { out: HistoryOut; response: Response } {
  const answer = answerOf(request);
  if (answer !== null) {
    answer.start(200, { "content-type": "text/event-stream" });
    answer.beat(HISTORY_BEAT_MS);
    return { out: new AnswerOut(answer), response: new Response(null, { status: 200 }) };
  }
  const out = new SseOut(request, options.revocation);
  return {
    out,
    response: new Response(out.body, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
      },
    }),
  };
}

/** A window as the stream sends it: its page facts and its record lines. */
export interface HistoryWindow {
  windowId: string;
  page: HistoryPage;
  /** Every record's JSON and a `\n`, in window order. */
  text: string;
}

const newWindowId = (): string => randomBytes(9).toString("base64url");

/**
 * Serializes a window: each record elided where `sourceOf` names its line (a held input not yet
 * in the Trace names none, and travels whole).
 */
export function serializeWindow(
  response: MessagesResponse,
  sourceOf: (record: HistoryMessage, index: number) => BodySource | null,
  serverNowMs: number | null,
): HistoryWindow {
  let text = "";
  response.messages.forEach((message, i) => {
    const source = sourceOf(message, i);
    const record = source === null ? message : elideHistoryRecord(message, source).record;
    text += `${JSON.stringify(record)}\n`;
  });
  const windowId = newWindowId();
  return {
    windowId,
    text,
    page: {
      windowId,
      count: response.messages.length,
      bytes: Buffer.byteLength(text, "utf8"),
      ...(response.page !== undefined ? { page: response.page } : {}),
      ...(response.live !== undefined ? { live: response.live } : {}),
      serverNowMs,
    },
  };
}

/** Whose a held window is: a re-issue continues it only for the same Session, reader and query. */
export interface WindowOwner {
  sessionId: string;
  userId: string;
  /** The read's parsed query, as one string. */
  query: string;
}

interface HeldWindow {
  window: HistoryWindow;
  owner: WindowOwner;
  bytes: number;
  until: number;
}

/**
 * The windows sent lately, for a re-issued stream to continue: for a while, a few per reader and
 * a bounded number of bytes in all, the oldest let go first.
 */
export class HeldWindows {
  readonly #held = new Map<string, HeldWindow>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  hold(window: HistoryWindow, owner: WindowOwner): void {
    this.#sweep();
    const bytes = window.page.bytes;
    if (bytes > HELD_BYTES_PER_USER) return;
    this.#held.set(window.windowId, { window, owner, bytes, until: this.now() + HELD_WINDOW_MS });
    // Per reader, oldest first: at most HELD_WINDOWS_PER_USER windows within HELD_BYTES_PER_USER.
    const mine = [...this.#held.values()].filter((entry) => entry.owner.userId === owner.userId);
    let count = mine.length;
    let mineBytes = mine.reduce((sum, entry) => sum + entry.bytes, 0);
    for (const entry of mine) {
      if (count <= HELD_WINDOWS_PER_USER && mineBytes <= HELD_BYTES_PER_USER) break;
      if (entry.window.windowId === window.windowId) break;
      this.#held.delete(entry.window.windowId);
      count -= 1;
      mineBytes -= entry.bytes;
    }
    // In all, oldest first: within HELD_BYTES.
    let total = [...this.#held.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [id, entry] of this.#held) {
      if (total <= HELD_BYTES) break;
      if (id === window.windowId) continue;
      this.#held.delete(id);
      total -= entry.bytes;
    }
  }

  /** The window `windowId` names, when it is still held for this very owner. */
  find(windowId: string, owner: WindowOwner): HistoryWindow | null {
    this.#sweep();
    const entry = this.#held.get(windowId);
    if (entry === undefined) return null;
    const same =
      entry.owner.sessionId === owner.sessionId &&
      entry.owner.userId === owner.userId &&
      entry.owner.query === owner.query;
    return same ? entry.window : null;
  }

  #sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.#held) if (entry.until <= now) this.#held.delete(id);
  }
}

/** Where a re-issued stream asks to continue: `<windowId>:<offset>`, or null for anything else. */
export function resumePoint(
  lastEventId: string | null,
): { windowId: string; offset: number } | null {
  const m = /^([A-Za-z0-9_-]{1,64}):(\d{1,12})$/.exec(lastEventId ?? "");
  return m === null ? null : { windowId: m[1]!, offset: Number(m[2]) };
}

/** The longest cut ≤ `max` from `from` that splits no surrogate pair. */
function cutAt(text: string, from: number, max: number): number {
  let end = Math.min(text.length, from + max);
  const before = text.charCodeAt(end - 1);
  if (end < text.length && end > from + 1 && before >= 0xd800 && before <= 0xdbff) end -= 1;
  return end;
}

/** The `records` and `part` events of a window's text from `from`, each within the frame budget. */
export function* windowFrames(
  window: HistoryWindow,
  from: number,
  budget: number = FRAME_TEXT_BUDGET,
): Generator<{ event: "records" | "part"; id: string; data: string }> {
  const { text, windowId } = window;
  let at = from;
  const frame = (event: "records" | "part", end: number, last?: boolean) => {
    const body: HistoryRecords = {
      windowId,
      offset: at,
      text: text.slice(at, end),
      ...(last !== undefined ? { last } : {}),
    };
    return { event, id: `${windowId}:${end}`, data: JSON.stringify(body) };
  };
  while (at < text.length) {
    const lineEnd = text.indexOf("\n", at) + 1 || text.length;
    const midLine = at > 0 && text[at - 1] !== "\n";
    if (midLine || lineEnd - at > budget) {
      // A line longer than a frame (or the rest of one a re-issue resumes inside): parts.
      while (at < lineEnd) {
        const end = cutAt(text, at, Math.min(budget, lineEnd - at));
        yield frame("part", end, end === lineEnd);
        at = end;
      }
      continue;
    }
    let end = lineEnd;
    while (end < text.length) {
      const next = text.indexOf("\n", end) + 1 || text.length;
      if (next - at > budget) break;
      end = next;
    }
    yield frame("records", end);
    at = end;
  }
}

/**
 * Sends a window: its `page` (unless a re-issue continues it from `from`), its records from
 * there, and `done`.
 */
export async function sendWindow(
  out: HistoryOut,
  window: HistoryWindow,
  from: number | null,
): Promise<void> {
  if (from === null) {
    await out.send("page", `${window.windowId}:0`, JSON.stringify(window.page));
  }
  const start = Math.min(Math.max(from ?? 0, 0), window.text.length);
  for (const frame of windowFrames(window, start)) {
    await out.send(frame.event, frame.id, frame.data);
  }
  await out.send(
    "done",
    `${window.windowId}:${window.text.length}`,
    JSON.stringify({ windowId: window.windowId }),
  );
}

/**
 * Sends one whole value (`trace-body`) the way every server answers it (http/routes/
 * history-lines.ts for its own Sessions): a `progress` at 0, the value as `part`s of at most a
 * frame — their `windowId` the ref they answer — a `progress` at its end, then `done`. No ids:
 * a body read again is sent again. A value the hub first fetched from its machine (`fetched`)
 * has had its progress already, counted in the line's bytes: no second count from 0, only the
 * end in that same total, so the numbers a reader shows never run backwards.
 */
export async function sendBody(
  out: HistoryOut,
  ref: string,
  value: string,
  machineId: string | null,
  fetched: { totalBytes: number } | null = null,
  budget: number = FRAME_TEXT_BUDGET,
): Promise<void> {
  const totalBytes = fetched?.totalBytes ?? Buffer.byteLength(value, "utf8");
  const progress = (doneBytes: number): HistoryProgress => ({
    phase: "heavy",
    machineId,
    doneBytes,
    totalBytes,
    doneLines: doneBytes === totalBytes ? 1 : 0,
    totalLines: 1,
    waiting: null,
  });
  if (fetched === null) await out.send("progress", null, JSON.stringify(progress(0)));
  let at = 0;
  do {
    const end = cutAt(value, at, budget);
    const text = value.slice(at, end);
    const part: HistoryRecords = { windowId: ref, offset: at, text, last: end === value.length };
    await out.send("part", null, JSON.stringify(part));
    at = end;
  } while (at < value.length);
  await out.send("progress", null, JSON.stringify(progress(totalBytes)));
  await out.send("done", null, "{}");
}

/** A stream's terminal `error` event, in the API's error shape. */
export async function sendError(out: HistoryOut, err: unknown): Promise<void> {
  const body: HistoryStreamError =
    err instanceof HttpError
      ? {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        }
      : { code: "internal", message: "The history could not be read." };
  await out.send("error", null, JSON.stringify(body)).catch(() => undefined);
}

/**
 * The `progress` a stream sends: only a change goes, at most every PROGRESS_EVERY_MS, and the
 * newest value is never left behind (a trailing send carries it).
 */
export class ProgressOut {
  #last: string | null = null;
  #pending: HistoryProgress | null = null;
  #sentAt = -Infinity;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly out: HistoryOut,
    private readonly now: () => number = () => Date.now(),
  ) {
    out.signal.addEventListener("abort", () => this.#cancel(), { once: true });
  }

  report(progress: HistoryProgress): void {
    if (JSON.stringify(progress) === this.#last) return;
    this.#pending = progress;
    const wait = this.#sentAt + PROGRESS_EVERY_MS - this.now();
    if (wait <= 0) {
      this.#flushNow();
      return;
    }
    if (this.#timer === null) {
      this.#timer = setTimeout(() => {
        this.#timer = null;
        this.#flushNow();
      }, wait);
      this.#timer.unref?.();
    }
  }

  /** Sends the newest unsent value now (before the event that follows it). */
  flush(): Promise<void> {
    this.#cancel();
    return this.#flushNow();
  }

  #flushNow(): Promise<void> {
    const progress = this.#pending;
    this.#pending = null;
    if (progress === null) return Promise.resolve();
    const data = JSON.stringify(progress);
    if (data === this.#last) return Promise.resolve();
    this.#last = data;
    this.#sentAt = this.now();
    return this.out.send("progress", null, data).catch(() => undefined);
  }

  #cancel(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }
}
