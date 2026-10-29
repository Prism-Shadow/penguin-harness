/**
 * A machine Session's history, brought over and kept on the hub (spec 05 「远程会话的历史」): one
 * job per machine × Session runs the machine stream — `GET …/history-lines`, the machine's own
 * route, over the API socket held to it — that brings a window's Trace lines into the hub's copy
 * (trace-cache.ts) and, while a reader stays for it, the rest of the Session; every reader of
 * that Session shares it.
 *
 * ONE MACHINE STREAM AT A TIME. A window (a `history` call), a body (`trace-body`) or one file
 * (the Trace panel) waits its turn, first come first served. Once the stream in front of it has
 * delivered what its own reader waited for, what that stream still carries — the window's heavy
 * lines, the fill — gives way: it is cancelled, what it committed stays, and the fill is opened
 * again once nothing waits.
 *
 * RESUMING IS ASKING AGAIN. Every stream opens with `have` (what the copy holds) and the machine
 * sends only what is missing, so a stream cut anywhere — the socket dropped, the stream silent
 * past its watchdog, a preemption — reopens from the copy, never from 0. While the machine is
 * not connected, or no socket can be had, the job tries again 1 s doubling to 30 s for as long as
 * a reader waits, and tells each reader so (`progress.waiting`). There is no deadline per stream.
 *
 * NOBODY LEFT, NOTHING SENT. The last reader leaving cancels the machine stream at once.
 *
 * A MACHINE ON AN OLDER BUILD has no `history-lines`: over the socket it answers a path its
 * platform does not own with 421 `not_on_socket` (HTTP would say 404). Its windows are then read
 * from `/messages` over HTTP inside the same stream — no deadline, the bytes counted as they
 * arrive — uncached and with nothing elided, since such a machine cannot send a body on its own.
 */
import type { BodySource } from "@prismshadow/penguin-core/interfaces";
import type {
  HistoryFileKey,
  HistoryHave,
  HistoryLinesWindow,
  HistoryPartFrame,
  HistoryLinesFrame,
  HistoryProgress,
  MessagesResponse,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import { assembleWindow } from "../services/history-layout.js";
import { historyLinesPath, parseHistoryFileKey } from "../services/history-wire.js";
import type { HistoryLinesQuery } from "../services/history-wire.js";
import { encodeCursor } from "../services/message-window.js";
import { historyResponse } from "../services/session-history.js";
import { SESSION_ROUTES_BASE } from "../services/trace-images.js";
import type { MessagesPageRequest } from "../services/trace-service.js";
import { CREDIT_FLOW } from "../socket/frames.js";
import type { EventFrame } from "../socket/frames.js";
import { frameBytes } from "../socket/line-frames.js";
import type { MachineSocket, Sink } from "./machine-sockets.js";
import type { ProxyTarget } from "./proxy.js";
import type { TraceCache } from "./trace-cache.js";

/** A machine stream that sends nothing for this long — not even its beat — is cut and reopened. */
export const MACHINE_STREAM_WATCHDOG_MS = 15_000;
/** The first wait before trying a machine again, doubled per attempt up to RETRY_MAX_MS. */
export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
/** A window the copy cannot be assembled into is read again this often before it is an error. */
const ASSEMBLY_ATTEMPTS = 3;

/** The timers the job runs on; a test hands in its own clock. */
export interface SyncClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realClock: SyncClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface HistorySyncDeps {
  cache: TraceCache;
  /** The machine's forward, or null while it is not connected (MachinesService.proxyTarget). */
  target(machineId: string): Promise<ProxyTarget | null>;
  /** The API socket held to it, or the answer a stream gets instead (MachineSockets.socketFor). */
  socket(
    machineId: string,
    target: ProxyTarget,
  ): Promise<{ socket: MachineSocket } | { answer: Response }>;
  /** A GET of the machine's API over the forward (an older build's `/messages`). */
  http(
    machineId: string,
    target: ProxyTarget,
    path: string,
    signal: AbortSignal,
  ): Promise<Response>;
  log(line: string): void;
  clock?: SyncClock;
  watchdogMs?: number;
  retryFirstMs?: number;
  retryMaxMs?: number;
  /** Test observability: each run of Trace bytes a machine stream delivered, as it was handled. */
  observe?: (event: {
    machineId: string;
    sessionId: string;
    k: HistoryFileKey;
    off: number;
    bytes: number;
  }) => void;
}

/** A window read, in the trace service's terms. */
export type WindowRead = MessagesPageRequest | { kind: "full" };

/** A delivered window: the answer `/messages` would give, and each record's line for its body refs. */
export interface AssembledWindow {
  response: MessagesResponse;
  /** Parallel to `response.messages`; null where a record names no line (a held input, an older machine's). */
  sources: (BodySource | null)[];
  serverNowMs: number | null;
}

export type ProgressListener = (progress: HistoryProgress) => void;
type Phase = HistoryProgress["phase"];
type Waiting = HistoryProgress["waiting"];

/** One reader's progress, kept monotone across the streams that serve it. */
class Track {
  #phase: Phase;
  #doneBytes = 0;
  #totalBytes = 0;
  #doneLines = 0;
  #totalLines = 0;
  #waiting: Waiting = null;

  constructor(
    phase: Phase,
    private readonly machineId: string,
    private readonly listener: ProgressListener,
  ) {
    this.#phase = phase;
  }

  /** A stream starts (or reaches) `phase`, with `remaining` still to come in it. */
  begin(phase: Phase, remaining: { bytes: number; lines: number }): void {
    if (phase !== this.#phase) {
      this.#phase = phase;
      this.#doneBytes = 0;
      this.#doneLines = 0;
      this.#totalBytes = remaining.bytes;
      this.#totalLines = remaining.lines;
    } else {
      this.#totalBytes = Math.max(this.#totalBytes, this.#doneBytes + remaining.bytes);
      this.#totalLines = Math.max(this.#totalLines, this.#doneLines + remaining.lines);
    }
    this.#waiting = null;
    this.#emit();
  }

  add(bytes: number, lines: number): void {
    this.#doneBytes += bytes;
    this.#doneLines += lines;
    this.#totalBytes = Math.max(this.#totalBytes, this.#doneBytes);
    this.#totalLines = Math.max(this.#totalLines, this.#doneLines);
    this.#waiting = null;
    this.#emit();
  }

  wait(waiting: Waiting): void {
    this.#waiting = waiting;
    this.#emit();
  }

  #emit(): void {
    this.listener({
      phase: this.#phase,
      machineId: this.machineId,
      doneBytes: this.#doneBytes,
      totalBytes: this.#totalBytes,
      doneLines: this.#doneLines,
      totalLines: this.#totalLines,
      waiting: this.#waiting,
    });
  }
}

/** One read waiting its turn on the machine stream. */
interface Op {
  kind: "window" | "body" | "file";
  reader: HistoryReader;
  /** What the stream asks the machine, given what the copy holds. */
  query(have: HistoryHave[], fill: boolean): HistoryLinesQuery;
  /** A window op's read, for an older machine's `/messages`. */
  read: WindowRead | null;
  /** A window op whose reader stays for the fill: its stream goes on into it. */
  fill: boolean;
  track: Track;
  /** How many times the copy could not be assembled into this window. */
  assemblies: number;
  settled: boolean;
  resolve(value: AssembledWindow | null): void;
  reject(err: unknown): void;
}

interface FillWaiter {
  reader: HistoryReader;
  track: Track;
  resolve(): void;
  reject(err: unknown): void;
}

/** One machine stream and what it has carried so far. */
interface MachineStream {
  /** The op it serves; null for the background fill. */
  op: Op | null;
  /** It goes on into the fill after its own part. */
  fill: boolean;
  phase: Phase;
  /** What is left of each phase, as the machine's totals said. */
  left: Record<Phase, { bytes: number; lines: number }>;
  window: HistoryLinesWindow | null;
  /** Its op has what it waited for (a window: at `ready`; a body or a file: at `done`). */
  delivered: boolean;
  sawDone: boolean;
  frames: number;
  answer: { status: number; body: unknown } | null;
  failure: unknown;
  /** Cut by the job (preempted, nobody left): not an interruption to recover from. */
  cancelled: boolean;
  stop(): void;
}

const aborted = (): Error => Object.assign(new Error("The reader left."), { name: "AbortError" });

/** The error code of a machine's answer body, if it has one. */
function codeOf(body: unknown): string | undefined {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : undefined;
}

function messageOf(body: unknown): string | undefined {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" ? message : undefined;
}

/** An answer meaning the machine's build predates `history-lines`. */
const isOlderBuild = (status: number, body: unknown): boolean =>
  (status === 421 && codeOf(body) === "not_on_socket") ||
  (status === 404 && codeOf(body) === "not_found");

/** The `/messages` query of a window read. */
function messagesQuery(read: WindowRead): string {
  if (read.kind === "full") return "";
  if (read.kind === "tail") return `?tailLimit=${read.limit}`;
  return `?before=${encodeURIComponent(encodeCursor(read.cursor))}&limit=${read.limit}`;
}

/** One Session's sync job: its readers, its queue, its one machine stream. */
class HistoryJob {
  readonly #readers = new Set<HistoryReader>();
  readonly #queue: Op[] = [];
  readonly #fillWaiters = new Set<FillWaiter>();
  #stream: MachineStream | null = null;
  #retry: unknown = null;
  #attempt = 0;
  #older = false;
  /** The last stream that carried the fill finished it, and no stream opened since. */
  #whole = false;
  #closed = false;
  /** The Sessions the last window read, for eviction to leave alone while the job is open. */
  #group: string[];
  readonly #clock: SyncClock;

  constructor(
    readonly machineId: string,
    readonly sessionId: string,
    private readonly deps: HistorySyncDeps,
    private readonly onIdle: (job: HistoryJob) => void,
    /** The `<machineId>/<sessionId>` directories every open job uses. */
    private readonly held: () => Set<string>,
  ) {
    this.#clock = deps.clock ?? realClock;
    this.#group = [sessionId];
  }

  get group(): readonly string[] {
    return this.#group;
  }

  join(reader: HistoryReader): void {
    this.#readers.add(reader);
  }

  /** A reader left: what it waited for is dropped, and with the last one the stream goes. */
  leave(reader: HistoryReader): void {
    if (!this.#readers.delete(reader)) return;
    for (let i = this.#queue.length - 1; i >= 0; i--) {
      const op = this.#queue[i]!;
      if (op.reader !== reader) continue;
      this.#queue.splice(i, 1);
      this.#settle(op, aborted());
    }
    for (const waiter of [...this.#fillWaiters]) {
      if (waiter.reader !== reader) continue;
      this.#fillWaiters.delete(waiter);
      waiter.reject(aborted());
    }
    const stream = this.#stream;
    if (stream?.op?.reader === reader && !stream.delivered) {
      this.#settle(stream.op, aborted());
      stream.stop();
    }
    this.#pump();
  }

  enqueue(op: Omit<Op, "settled" | "assemblies">): void {
    this.#queue.push({ ...op, settled: false, assemblies: 0 });
    this.#pump();
  }

  /** The reader stays for the rest of the Session. */
  waitForFill(waiter: FillWaiter): void {
    if (this.#whole || this.#older) {
      waiter.resolve();
      return;
    }
    this.#fillWaiters.add(waiter);
    const stream = this.#stream;
    if (stream !== null && stream.fill && (stream.delivered || stream.op === null)) {
      // Joining a stream already in its heavy lines or its fill: told what is left of it.
      waiter.track.begin(stream.phase, stream.left[stream.phase]);
    }
    this.#pump();
  }

  close(): void {
    this.#closed = true;
    this.#stream?.stop();
    if (this.#retry !== null) this.#clock.clearTimeout(this.#retry);
    this.#retry = null;
  }

  #settle(op: Op, outcome: AssembledWindow | null | Error): void {
    if (op.settled) return;
    op.settled = true;
    if (outcome instanceof Error) op.reject(outcome);
    else op.resolve(outcome);
  }

  #failAll(err: Error): void {
    const stream = this.#stream;
    if (stream?.op !== null && stream?.op !== undefined) this.#settle(stream.op, err);
    for (const op of this.#queue.splice(0)) this.#settle(op, err);
    for (const waiter of this.#fillWaiters) waiter.reject(err);
    this.#fillWaiters.clear();
  }

  /** Decides what runs next. */
  #pump(): void {
    if (this.#closed) return;
    const stream = this.#stream;
    if (stream !== null) {
      const past = stream.delivered || stream.op === null;
      if (this.#readers.size === 0) stream.stop();
      else if (past && this.#queue.length > 0) stream.stop();
      else if (stream.op === null && this.#fillWaiters.size === 0) stream.stop();
      return;
    }
    if (this.#readers.size === 0) {
      if (this.#retry !== null) this.#clock.clearTimeout(this.#retry);
      this.#retry = null;
      this.onIdle(this);
      return;
    }
    if (this.#retry !== null) return;
    const op = this.#queue.shift() ?? null;
    if (op === null && this.#fillWaiters.size === 0) return;
    void this.#run(op);
  }

  async #run(op: Op | null): Promise<void> {
    const fill = op === null || (op.kind === "window" && (op.fill || this.#fillWaiters.size > 0));
    let stop: () => void = () => undefined;
    const stream: MachineStream = {
      op,
      fill,
      phase: op?.kind === "body" ? "heavy" : op?.kind === "file" || op === null ? "fill" : "window",
      left: {
        window: { bytes: 0, lines: 0 },
        heavy: { bytes: 0, lines: 0 },
        fill: { bytes: 0, lines: 0 },
      },
      window: null,
      delivered: false,
      sawDone: false,
      frames: 0,
      answer: null,
      failure: null,
      cancelled: false,
      stop: () => {
        stream.cancelled = true;
        stop();
      },
    };
    this.#stream = stream;
    this.#whole = false;
    let wait: "not_connected" | "retrying" | null = null;
    try {
      const target = await this.deps.target(this.machineId);
      if (stream.cancelled) return;
      if (target === null) {
        wait = "not_connected";
        return;
      }
      if (this.#older) {
        await this.#readOlder(stream, target);
        return;
      }
      const got = await this.deps.socket(this.machineId, target);
      if (stream.cancelled) return;
      if ("answer" in got) {
        const body = (await got.answer.json().catch(() => null)) as unknown;
        if (codeOf(body) === "machine_socket_refused") {
          // The handshake was answered with a status: a build without the socket at all.
          this.#older = true;
          await this.#readOlder(stream, target);
          return;
        }
        wait = "retrying";
        return;
      }
      const have = await this.deps.cache.have(this.machineId, this.sessionId);
      if (stream.cancelled) return;
      const query: HistoryLinesQuery = op === null ? { kind: "fill", have } : op.query(have, fill);
      await this.#carry(stream, got.socket, historyLinesPath(this.sessionId, query), (cancel) => {
        stop = cancel;
      });
      if (stream.answer !== null && isOlderBuild(stream.answer.status, stream.answer.body)) {
        this.#older = true;
        stream.answer = null;
        await this.#readOlder(stream, target);
        return;
      }
      wait = this.#outcome(stream);
    } catch (err) {
      stream.failure = err;
      this.deps.log(
        `[machines] history of ${this.sessionId} on ${this.machineId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      wait = "retrying";
    } finally {
      this.#stream = null;
      this.#afterStream(stream, wait);
    }
  }

  /** What a stream's end means for its op, its fill and the next attempt. */
  #outcome(stream: MachineStream): "retrying" | null {
    const answer = stream.answer;
    if (answer !== null) {
      const { status, body } = answer;
      const code = codeOf(body);
      if (status === 404 && code === "session_not_found") {
        this.#failAll(
          new HttpError(404, "session_not_found", messageOf(body) ?? "Session does not exist."),
        );
        return null;
      }
      if (status === 401 || status === 403) {
        this.#failAll(
          new HttpError(
            502,
            "machine_refused",
            `The machine holding session ${this.sessionId} refused this server's session (${status}).`,
            undefined,
            { machineId: this.machineId },
          ),
        );
        return null;
      }
      if (status >= 400 && status < 500 && status !== 409 && status !== 429) {
        const err = new HttpError(
          status,
          code ?? "machine_answered",
          messageOf(body) ?? `The machine answered ${status}.`,
        );
        if (stream.op !== null) this.#settle(stream.op, err);
        // A fill the machine refuses is not asked for again and again.
        if (stream.op === null) {
          for (const waiter of this.#fillWaiters) waiter.reject(err);
          this.#fillWaiters.clear();
        }
        return null;
      }
      return "retrying";
    }
    if (stream.sawDone) {
      this.#attempt = 0;
      if (stream.op !== null && !stream.delivered) {
        // A body or a file is delivered by its stream's end; a window by its `ready`, which a
        // stream that ended without one never sent.
        if (stream.op.kind === "window") {
          this.#settle(
            stream.op,
            new HttpError(502, "machine_answered", "The machine ended the window without it."),
          );
        } else {
          stream.delivered = true;
          this.#settle(stream.op, null);
        }
      }
      if (stream.fill) {
        this.#whole = true;
        for (const waiter of this.#fillWaiters) waiter.resolve();
        this.#fillWaiters.clear();
      }
      // Evicted after a stream completes: every open job's group (this one's too) is left alone.
      void this.deps.cache.evict(this.held());
      return null;
    }
    // Cut short (the socket dropped, the watchdog, an `end` without `done`): asked again, from
    // the copy — at once when it was moving, after the usual wait when it never got going.
    if (stream.frames > 0) this.#attempt = 0;
    return stream.frames > 0 ? null : "retrying";
  }

  #afterStream(stream: MachineStream, wait: "not_connected" | "retrying" | null): void {
    const op = stream.op;
    // An op its stream did not get to the end of goes back to the front, unless its reader left
    // or it was settled (an error).
    if (op !== null && !op.settled && this.#readers.has(op.reader)) this.#queue.unshift(op);
    if (wait !== null && !stream.cancelled && this.#readers.size > 0) this.#backoff(wait);
    this.#pump();
  }

  #backoff(reason: "not_connected" | "retrying"): void {
    this.#attempt += 1;
    const first = this.deps.retryFirstMs ?? RETRY_FIRST_MS;
    const max = this.deps.retryMaxMs ?? RETRY_MAX_MS;
    const delay = Math.min(max, first * 2 ** (this.#attempt - 1));
    const waiting: Waiting = { reason, attempt: this.#attempt, nextAt: this.#clock.now() + delay };
    for (const op of this.#queue) op.track.wait(waiting);
    for (const waiter of this.#fillWaiters) waiter.track.wait(waiting);
    this.#retry = this.#clock.setTimeout(() => {
      this.#retry = null;
      this.#pump();
    }, delay);
  }

  /**
   * Runs one call on the machine's socket until it ends, handling its events in order and
   * acknowledging each once handled (the credit the machine sends by).
   */
  #carry(
    stream: MachineStream,
    socket: MachineSocket,
    path: string,
    onCancel: (cancel: () => void) => void,
  ): Promise<void> {
    const watchdogMs = this.deps.watchdogMs ?? MACHINE_STREAM_WATCHDOG_MS;
    return new Promise<void>((resolve) => {
      let id = -1;
      let handled = 0;
      let chain: Promise<void> = Promise.resolve();
      let finished = false;
      let watchdog: unknown = null;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        if (watchdog !== null) this.#clock.clearTimeout(watchdog);
        resolve();
      };
      const arm = (): void => {
        if (watchdog !== null) this.#clock.clearTimeout(watchdog);
        watchdog = this.#clock.setTimeout(() => {
          this.deps.log(
            `[machines] history of ${this.sessionId} on ${this.machineId}: nothing in ${watchdogMs} ms; asking again from what is held`,
          );
          socket.cancel(id);
          finish();
        }, watchdogMs);
      };
      onCancel(() => {
        socket.cancel(id);
        finish();
      });
      const sink: Sink = {
        onStart: () => arm(),
        onEvent: (frame) => {
          if (finished) return;
          arm();
          chain = chain
            .then(async () => {
              if (finished) return;
              await this.#handle(stream, frame);
              handled += frame.data.length;
              socket.ack(id, handled);
            })
            .catch((err: unknown) => {
              stream.failure = err;
              this.deps.log(
                `[machines] history of ${this.sessionId} on ${this.machineId}: ${err instanceof Error ? err.message : String(err)}`,
              );
              socket.cancel(id);
              finish();
            });
        },
        onEnd: () => {
          void chain.then(finish);
        },
        onResponse: (status, body) => {
          stream.answer = { status, body };
          finish();
        },
      };
      arm();
      id = socket.call(
        { method: "GET", path, headers: { accept: "text/event-stream", "x-flow": CREDIT_FLOW } },
        sink,
      );
    });
  }

  async #handle(stream: MachineStream, frame: EventFrame): Promise<void> {
    switch (frame.event) {
      case "window": {
        const window = JSON.parse(frame.data) as HistoryLinesWindow;
        stream.window = window;
        stream.frames += 1;
        await this.deps.cache.reconcile(this.machineId, this.sessionId, window.files);
        this.#group = [
          this.sessionId,
          ...new Set(
            window.files
              .map((file) => parseHistoryFileKey(file.k)?.sessionId)
              .filter((id): id is string => id !== undefined && id !== this.sessionId),
          ),
        ];
        this.deps.cache.touch(this.machineId, this.#group);
        const { totals } = window;
        stream.left = {
          window: { ...totals.window },
          heavy: { ...totals.heavy },
          fill: { ...totals.fill },
        };
        if (stream.op?.kind === "body") {
          stream.left.heavy = {
            bytes: totals.window.bytes + totals.heavy.bytes + totals.fill.bytes,
            lines: totals.window.lines + totals.heavy.lines + totals.fill.lines,
          };
        }
        this.#enter(stream, stream.phase);
        return;
      }
      case "lines":
      case "part": {
        const line = JSON.parse(frame.data) as HistoryLinesFrame | HistoryPartFrame;
        await this.deps.cache.commit(this.machineId, line);
        const raw = frameBytes(line);
        const bytes = raw.length;
        const lines =
          frame.event === "lines"
            ? raw.reduce((n, byte) => (byte === 0x0a ? n + 1 : n), 0)
            : (line as HistoryPartFrame).last
              ? 1
              : 0;
        stream.frames += 1;
        this.deps.observe?.({
          machineId: this.machineId,
          sessionId: this.sessionId,
          k: line.k,
          off: line.off,
          bytes,
        });
        this.#count(stream, bytes, lines);
        return;
      }
      case "ready":
        stream.frames += 1;
        await this.#deliver(stream);
        return;
      case "done":
        stream.sawDone = true;
        return;
      default:
        return;
    }
  }

  /** The readers of a stream in `phase`: its op's own, and in the fill (and the heavy lines) every fill waiter. */
  #tracks(stream: MachineStream, phase: Phase): Track[] {
    const out: Track[] = [];
    if (stream.op !== null && !stream.delivered) out.push(stream.op.track);
    if (stream.fill && phase !== "window")
      for (const waiter of this.#fillWaiters) out.push(waiter.track);
    return out;
  }

  #enter(stream: MachineStream, phase: Phase): void {
    stream.phase = phase;
    for (const track of this.#tracks(stream, phase)) track.begin(phase, stream.left[phase]);
  }

  #count(stream: MachineStream, bytes: number, lines: number): void {
    // After the window, its heavy lines come first and the fill after them.
    if (stream.phase === "heavy" && stream.left.heavy.bytes <= 0 && stream.op?.kind !== "body") {
      this.#enter(stream, "fill");
    }
    const left = stream.left[stream.phase];
    left.bytes = Math.max(0, left.bytes - bytes);
    left.lines = Math.max(0, left.lines - lines);
    for (const track of this.#tracks(stream, stream.phase)) track.add(bytes, lines);
  }

  /** `ready`: the window's light lines are all held; assembled from the copy, it goes to its reader. */
  async #deliver(stream: MachineStream): Promise<void> {
    const op = stream.op;
    const window = stream.window;
    if (op === null || op.kind !== "window" || stream.delivered || window === null) return;
    const assembled = await this.#assemble(window);
    if (assembled === null) {
      op.assemblies += 1;
      if (op.assemblies >= ASSEMBLY_ATTEMPTS) {
        this.#settle(
          op,
          new HttpError(
            409,
            "trace_changed",
            "The conversation's Trace kept changing while its history was read.",
          ),
        );
      } else {
        // What the copy holds does not read back as the machine laid it out: forgotten, and the
        // window read again from the machine's bytes alone.
        await this.deps.cache.forget(this.machineId, this.sessionId);
      }
      stream.stop();
      return;
    }
    stream.delivered = true;
    this.#settle(op, assembled);
    if (stream.fill) {
      this.#enter(stream, stream.left.heavy.bytes > 0 ? "heavy" : "fill");
    }
  }

  async #assemble(window: HistoryLinesWindow): Promise<AssembledWindow | null> {
    const records = await assembleWindow(
      window.layout,
      (k, start, end) => this.deps.cache.bytes(this.machineId, k, start, end),
      window.stubs,
    );
    if (records === null) return null;
    const sources: (BodySource | null)[] = [];
    for (const segment of window.layout) {
      const file = parseHistoryFileKey(segment.k);
      for (let ordinal = segment.from[1]; ordinal < segment.to[1]; ordinal++) {
        sources.push(file === null ? null : { ...file, ordinal });
      }
    }
    if (sources.length !== records.length) return null;
    const { envelope } = window;
    const response = historyResponse(
      { messages: records, ...(envelope.page !== undefined ? { page: envelope.page } : {}) },
      {
        ...(envelope.live !== undefined ? { live: envelope.live } : {}),
        pendingInputs: envelope.pendingInputs,
      },
      this.sessionId,
      SESSION_ROUTES_BASE,
    );
    return { response, sources, serverNowMs: envelope.serverNowMs };
  }

  /**
   * An older machine: a window from its `/messages` over HTTP, counted as it arrives; a fill or
   * a file has nothing to bring (nothing of such a machine is held); a body cannot be had.
   */
  async #readOlder(stream: MachineStream, target: ProxyTarget): Promise<void> {
    for (const waiter of this.#fillWaiters) waiter.resolve();
    this.#fillWaiters.clear();
    const op = stream.op;
    if (op === null) return;
    if (op.kind === "file") {
      stream.delivered = true;
      this.#settle(op, null);
      return;
    }
    if (op.kind === "body" || op.read === null) {
      this.#settle(
        op,
        new HttpError(
          409,
          "machine_outdated",
          "This machine's build cannot send the whole value; update it from the Machines page.",
        ),
      );
      return;
    }
    const abort = new AbortController();
    const prev = stream.stop;
    stream.stop = () => {
      prev();
      abort.abort();
    };
    const res = await this.deps.http(
      this.machineId,
      target,
      `/api/sessions/${encodeURIComponent(this.sessionId)}/messages${messagesQuery(op.read)}`,
      abort.signal,
    );
    if (!res.ok) {
      stream.answer = { status: res.status, body: await res.json().catch(() => null) };
      if (this.#outcome(stream) !== null) throw new Error(`the machine answered ${res.status}`);
      return;
    }
    const total = Number(res.headers.get("content-length") ?? "0") || 0;
    stream.left.window = { bytes: total, lines: 0 };
    op.track.begin("window", stream.left.window);
    const chunks: Uint8Array[] = [];
    const reader = res.body?.getReader();
    while (reader !== undefined) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      stream.frames += 1;
      op.track.add(value.byteLength, 0);
    }
    if (stream.cancelled) return;
    const response = JSON.parse(Buffer.concat(chunks).toString("utf8")) as MessagesResponse;
    const date = Date.parse(res.headers.get("date") ?? "");
    stream.delivered = true;
    this.#settle(op, {
      response,
      sources: response.messages.map(() => null),
      serverNowMs: Number.isFinite(date) ? date : null,
    });
  }
}

/** One reader of a machine Session's history: what it asks for waits on the Session's one job. */
export class HistoryReader {
  #closed = false;

  constructor(
    private readonly job: HistoryJob,
    private readonly signal: AbortSignal,
  ) {
    job.join(this);
    if (signal.aborted) this.close();
    else signal.addEventListener("abort", () => this.close(), { once: true });
  }

  #track(phase: Phase, progress: ProgressListener): Track {
    return new Track(phase, this.job.machineId, progress);
  }

  #op(
    kind: Op["kind"],
    query: Op["query"],
    read: WindowRead | null,
    fill: boolean,
    phase: Phase,
    progress: ProgressListener,
  ): Promise<AssembledWindow | null> {
    if (this.#closed) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.job.enqueue({
        kind,
        reader: this,
        query,
        read,
        fill,
        track: this.#track(phase, progress),
        resolve,
        reject,
      });
    });
  }

  /** A window, assembled from the copy once the machine has sent what it lacked. */
  async window(
    read: WindowRead,
    fill: boolean,
    progress: ProgressListener,
  ): Promise<AssembledWindow> {
    const query = (have: HistoryHave[], withFill: boolean): HistoryLinesQuery => {
      const more = withFill ? { fill: true } : {};
      if (read.kind === "full") return { kind: "full", have, ...more };
      const budget = read.budget !== undefined ? { budget: read.budget } : {};
      if (read.kind === "tail")
        return { kind: "tail", limit: read.limit, have, ...budget, ...more };
      return {
        kind: "before",
        cursor: encodeCursor(read.cursor),
        limit: read.limit,
        have,
        ...budget,
        ...more,
      };
    };
    const window = await this.#op("window", query, read, fill, "window", progress);
    return window!;
  }

  /** Settles once the copy holds the whole Session group, as of the stream that finished it. */
  fill(progress: ProgressListener): Promise<void> {
    if (this.#closed) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.job.waitForFill({ reader: this, track: this.#track("fill", progress), resolve, reject });
    });
  }

  /** Settles once the copy holds the line of one elided value (a trace-body ref). */
  async body(ref: string, progress: ProgressListener): Promise<void> {
    await this.#op("body", (have) => ({ kind: "body", ref, have }), null, false, "heavy", progress);
  }

  /** Settles once the copy holds one file whole (the Trace panel's). */
  async file(k: HistoryFileKey, progress: ProgressListener): Promise<void> {
    await this.#op(
      "file",
      (have) => ({ kind: "fill", file: k, have }),
      null,
      false,
      "fill",
      progress,
    );
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.job.leave(this);
  }
}

/** Every machine Session's job, on one platform generation. */
export class HistorySync {
  readonly #jobs = new Map<string, HistoryJob>();

  constructor(private readonly deps: HistorySyncDeps) {}

  /** A reader of one machine Session's history, until `signal` aborts or it is closed. */
  reader(machineId: string, sessionId: string, signal: AbortSignal): HistoryReader {
    const key = `${machineId}/${sessionId}`;
    let job = this.#jobs.get(key);
    if (job === undefined) {
      job = new HistoryJob(
        machineId,
        sessionId,
        this.deps,
        (idle) => {
          if (this.#jobs.get(key) === idle) this.#jobs.delete(key);
        },
        () => this.held(),
      );
      this.#jobs.set(key, job);
    }
    return new HistoryReader(job, signal);
  }

  /** The `<machineId>/<sessionId>` directories open jobs use: eviction leaves them alone. */
  held(): Set<string> {
    const out = new Set<string>();
    for (const job of this.#jobs.values()) {
      for (const sessionId of job.group) out.add(`${job.machineId}/${sessionId}`);
    }
    return out;
  }

  close(): void {
    for (const job of this.#jobs.values()) job.close();
    this.#jobs.clear();
  }
}
