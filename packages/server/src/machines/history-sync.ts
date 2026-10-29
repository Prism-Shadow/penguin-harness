/**
 * A machine Session's history, brought over and kept on the hub (spec 05, "Remote Session
 * history: the machine cuts, this server caches"): one job per machine × Session runs the machine
 * stream — `GET …/history-lines`, the machine's own route, over the API socket held to it — that
 * brings a window's Trace lines into the hub's copy (trace-cache.ts) and, while a reader stays for
 * it, the rest of the Session; every reader of that Session shares it.
 *
 * ONE MACHINE STREAM AT A TIME. A window (a `history` call), a body (`trace-body`) or one file
 * (the Trace panel) waits its turn, first come first served. Once the stream in front of it has
 * delivered what its own reader waited for, what that stream still carries — the window's heavy
 * lines, the fill — gives way: it is cancelled, what it committed stays, and the fill is opened
 * again once nothing waits. A fill nobody stays for any more ends, whoever's stream carries it.
 *
 * RESUMING IS ASKING AGAIN. Every stream opens with `have` (what the copy holds) and the machine
 * sends only what is missing, so a stream cut anywhere — the socket dropped, the link silent
 * past its watchdog (no byte from the machine on any of its connections: a stream starved behind
 * another channel of the same ssh session is on a busy link, not a dead one), a preemption —
 * reopens from the copy,
 * never from 0: at once when the cut stream had moved (bytes committed, its window delivered, its
 * end reached), else after a wait that grows 1 s doubling to 30 s. A machine that is not connected, or that cannot be reached, is
 * waited for the same way, for as long as a reader waits, and each reader is told
 * (`progress.waiting`). There is no deadline per stream.
 *
 * A COPY THAT CANNOT BE KEPT IS NO REASON NOT TO READ. When this server's copy fails (a disk that
 * refuses writes, a directory that cannot open), the job stops using it: the window is assembled
 * from the lines its own stream carried, and nothing is filled.
 *
 * NOBODY LEFT, NOTHING SENT. The last reader leaving cancels the machine stream at once. A
 * generation that is replaced ends every stream it holds without an error, so each reader asks
 * the generation that follows.
 *
 * A MACHINE ON AN OLDER BUILD has no `history-lines`: over the socket it answers a path its
 * platform does not own with 421 `not_on_socket` (HTTP would say 404). Its windows are then read
 * from `/messages` over HTTP inside the same stream — no deadline, the bytes counted as they
 * arrive — uncached and with nothing elided, since such a machine cannot send a body on its own.
 * So is a machine this server cannot hold a socket to (`machine_incompatible`,
 * `machine_socket_unavailable`). A machine that turns this server's session away (401/403) is an
 * error, and one being brought onto this hub's build is waited for.
 */
import type { AmspRecord } from "@prismshadow/penguin-core";
import type { BodySource } from "@prismshadow/penguin-core/interfaces";
import type {
  HistoryFileKey,
  HistoryHave,
  HistoryLinesFrame,
  HistoryLinesWindow,
  HistoryPartFrame,
  HistoryProgress,
  HistoryWindowPart,
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
import { LineCommitter, frameBytes } from "../socket/line-frames.js";
import type { MachineSocket, Sink } from "./machine-sockets.js";
import { withWindowUnits } from "./older-window-units.js";
import type { ProxyTarget } from "./proxy.js";
import type { TraceCache } from "./trace-cache.js";

/** A machine stream that sends nothing for this long — not even its beat — is cut and reopened. */
export const MACHINE_STREAM_WATCHDOG_MS = 15_000;
/** The first wait before trying a machine again, doubled per attempt up to RETRY_MAX_MS. */
export const RETRY_FIRST_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
/**
 * How long a machine's word that a Session is still there stands before a read the copy answers
 * on its own (an image, the Trace panel) asks again: a deletion this server never heard of (made
 * on the machine, or by another hub, while nothing watched it) is noticed within this.
 */
export const SESSION_CONFIRM_TTL_MS = 30_000;
/**
 * A machine stream that has carried only its beats for this long has a route stuck over there
 * (a slow disk, a hung read): its readers are told the machine is slow, and the stream goes on.
 */
export const MACHINE_STREAM_STALL_MS = 60_000;
/** A window the copy cannot be assembled into is read again this often before it is an error. */
const ASSEMBLY_ATTEMPTS = 3;
/**
 * The most a window's JSON may hold, joined from its `window-part`s: far past any window a machine
 * lays out (facts, layout and stubs of a Session tree), and a bound on what a broken one can make
 * this server hold.
 */
const WINDOW_TEXT_MAX = 16 * 1024 * 1024;

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
  /** Whether this server still lists the machine; absent: always (a suite's own machine). */
  known?(machineId: string): boolean;
  /**
   * When bytes last came in from the machine on any of its connections, on this sync's clock
   * (link-activity.ts; MachinesService.links); absent: the stream's own socket alone.
   */
  heardAt?(machineId: string): number | null;
  log(line: string): void;
  clock?: SyncClock;
  watchdogMs?: number;
  /** The most a window's JSON may hold, joined from its parts (WINDOW_TEXT_MAX). */
  windowTextMax?: number;
  /** How long a machine's word that a Session is there stands (SESSION_CONFIRM_TTL_MS). */
  confirmTtlMs?: number;
  /** How long a stream may carry only beats before its readers are told the machine is slow. */
  stallMs?: number;
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

/** What a machine says of a Session (HistorySync.sessionOn). */
export type SessionFact =
  { kind: "there"; projectId: string | null } | { kind: "gone" } | { kind: "unknown" };

/** A window read, in the trace service's terms. */
export type WindowRead = MessagesPageRequest | { kind: "full" };

/** A delivered window: the answer `/messages` would give, and each record's line for its body refs. */
export interface AssembledWindow {
  response: MessagesResponse;
  /** Parallel to `response.messages`; null where a record names no line (a held input, an older machine's). */
  sources: (BodySource | null)[];
  serverNowMs: number | null;
}

/** A body's line, once fetched: its record when the stream carried it whole, and the bytes counted. */
export interface FetchedBody {
  record: AmspRecord | null;
  totalBytes: number;
}

/**
 * The generation the job belonged to was replaced (a hot push, a shutdown): a reader's stream
 * ends without an error, and the client asks the generation that follows.
 */
export class GenerationClosed extends Error {
  constructor() {
    super("This server's generation was replaced; ask again.");
    this.name = "GenerationClosed";
  }
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

  get totalBytes(): number {
    return this.#totalBytes;
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

/** The lines one stream carried, kept in memory for a reader the copy cannot serve. */
class LineOverlay {
  readonly #files = new Map<
    HistoryFileKey,
    { committer: LineCommitter; runs: Array<{ off: number; bytes: Buffer }> }
  >();

  /** Takes one frame; answers the whole lines it completes, if any. */
  push(frame: HistoryLinesFrame | HistoryPartFrame): { off: number; bytes: Buffer } | null {
    let file = this.#files.get(frame.k);
    if (file === undefined) {
      file = { committer: new LineCommitter(), runs: [] };
      this.#files.set(frame.k, file);
    }
    const lines = file.committer.push(frame);
    if (lines !== null) file.runs.push(lines);
    return lines;
  }

  /** Bytes `[start, end)` of a file, when the stream carried every one of them. */
  bytes(k: HistoryFileKey, start: number, end: number): Buffer | null {
    const runs = [...(this.#files.get(k)?.runs ?? [])].sort((a, b) => a.off - b.off);
    const pieces: Buffer[] = [];
    let at = start;
    for (const run of runs) {
      if (at >= end) break;
      const runEnd = run.off + run.bytes.length;
      if (run.off > at || runEnd <= at) continue;
      const piece = run.bytes.subarray(at - run.off, Math.min(run.bytes.length, end - run.off));
      pieces.push(piece);
      at += piece.length;
    }
    return at >= end ? Buffer.concat(pieces) : null;
  }
}

/** One read waiting its turn on the machine stream. */
interface Op {
  kind: "window" | "body" | "file";
  reader: HistoryReader;
  /** What the stream asks the machine, given what the copy holds. */
  query(have: HistoryHave[], fill: boolean): HistoryLinesQuery;
  /** The one file a body or a file names: its `have` entry is the only one sent. */
  only: HistoryFileKey | null;
  /** A body op's record ordinal in `only`. */
  ordinal: number | null;
  /** A window op's read, for an older machine's `/messages`. */
  read: WindowRead | null;
  /** A window op whose reader stays for the fill: its stream goes on into it. */
  fill: boolean;
  track: Track;
  /** How many times the copy could not be assembled into this window. */
  assemblies: number;
  settled: boolean;
  resolve(value: unknown): void;
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
  /** A window that comes as `window-part`s, joined so far. */
  windowText: string;
  /** Its op has what it waited for (a window: at `ready`; a body or a file: at `done`). */
  delivered: boolean;
  sawDone: boolean;
  /** It moved: bytes committed (or carried), its window delivered, its end reached. */
  progressed: boolean;
  /** The lines it carried, for a copy that cannot serve them and for a body's own record. */
  overlay: LineOverlay;
  bodyRecord: AmspRecord | null;
  answer: { status: number; body: unknown } | null;
  /** The machine's own `error` event: the stream cannot be served. */
  refused: { code: string; message: string } | null;
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

/**
 * What a dial that found no socket means for a history stream (machine-sockets.ts's answers): a
 * build without the socket, or a socket this server cannot have, reads `/messages` over HTTP; a
 * refusal of this server's session is an error; a machine in its upgrade, or one that failed with
 * a server error, is waited for; a generation closing ends the stream.
 */
function socketVerdict(body: unknown): "older" | "http" | "refused" | "closed" | "wait" {
  const code = codeOf(body);
  if (code === "machine_socket_refused") {
    // The status the handshake was answered with, as the refusal names it.
    const status = Number(/handshake with (\d{3})/.exec(messageOf(body) ?? "")?.[1] ?? 0);
    if (status === 401 || status === 403) return "refused";
    return status >= 500 ? "wait" : "older";
  }
  if (code === "machine_incompatible" || code === "machine_socket_unavailable") return "http";
  if (code === "unavailable") return "closed";
  return "wait";
}

/** The `/messages` query of a window read. */
function messagesQuery(read: WindowRead): string {
  if (read.kind === "full") return "";
  if (read.kind === "tail") return `?tailLimit=${read.limit}`;
  return `?before=${encodeURIComponent(encodeCursor(read.cursor))}&limit=${read.limit}`;
}

/** The records a run of whole lines holds, each with its ordinal from `ord` on. */
function recordsOf(bytes: Buffer, ord: number): Array<{ ordinal: number; record: AmspRecord }> {
  const out: Array<{ ordinal: number; record: AmspRecord }> = [];
  let ordinal = ord;
  for (const line of bytes.toString("utf8").split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    try {
      out.push({ ordinal, record: JSON.parse(text) as AmspRecord });
      ordinal += 1;
    } catch {
      // A malformed line is no record (the tolerant reader's rule).
    }
  }
  return out;
}

/** One Session's sync job: its readers, its queue, its one machine stream. */
class HistoryJob {
  readonly #readers = new Set<HistoryReader>();
  /** The readers that stay for the fill: a window asked with it, or `fill()` itself. */
  readonly #fillReaders = new Set<HistoryReader>();
  readonly #queue: Op[] = [];
  readonly #fillWaiters = new Set<FillWaiter>();
  #stream: MachineStream | null = null;
  #retry: unknown = null;
  #attempt = 0;
  #older = false;
  /** This server's copy failed: windows come from the stream itself, and nothing is filled. */
  #noCache = false;
  /** The last stream that carried the fill finished it, and no stream opened since. */
  #whole = false;
  #closed = false;
  /** The Sessions the last window read (until then, what the copy remembers), held from eviction. */
  #group: string[];
  #windowSeen = false;
  readonly #clock: SyncClock;

  constructor(
    readonly machineId: string,
    readonly sessionId: string,
    private readonly deps: HistorySyncDeps,
    private readonly onIdle: (job: HistoryJob) => void,
    /** The `<machineId>\0<sessionId>` directories every open job uses. */
    private readonly held: () => Set<string>,
  ) {
    this.#clock = deps.clock ?? realClock;
    this.#group = [sessionId];
    // Until the first window says which descendants the Session has, the copy remembers them.
    deps.cache.groupSessions(machineId, sessionId).then(
      (group) => {
        if (!this.#windowSeen) this.#group = group;
      },
      () => undefined,
    );
  }

  get group(): readonly string[] {
    return this.#group;
  }

  get closed(): boolean {
    return this.#closed;
  }

  join(reader: HistoryReader): void {
    this.#readers.add(reader);
  }

  /** A reader left: what it waited for is dropped, and with the last one the stream goes. */
  leave(reader: HistoryReader): void {
    if (!this.#readers.delete(reader)) return;
    this.#fillReaders.delete(reader);
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
    if (this.#closed) {
      op.reject(new GenerationClosed());
      return;
    }
    if (op.kind === "window" && op.fill) this.#fillReaders.add(op.reader);
    this.#queue.push({ ...op, settled: false, assemblies: 0 });
    this.#pump();
  }

  /** The reader stays for the rest of the Session. */
  waitForFill(waiter: FillWaiter): void {
    if (this.#closed) {
      waiter.reject(new GenerationClosed());
      return;
    }
    if (this.#whole || this.#older || this.#noCache) {
      waiter.resolve();
      return;
    }
    this.#fillReaders.add(waiter.reader);
    this.#fillWaiters.add(waiter);
    const stream = this.#stream;
    if (stream !== null && stream.fill && (stream.delivered || stream.op === null)) {
      // Joining a stream already in its heavy lines or its fill: told what is left of it.
      waiter.track.begin(stream.phase, stream.left[stream.phase]);
    }
    this.#pump();
  }

  /** The generation is replaced: every reader's wait ends (GenerationClosed), and nothing more runs. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#failAll(new GenerationClosed());
    this.#stream?.stop();
    if (this.#retry !== null) this.#clock.clearTimeout(this.#retry);
    this.#retry = null;
  }

  #settle(op: Op, outcome: unknown): void {
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

  /**
   * The machine no longer has the Session (its `session_not_found`, or its `session_deleted`
   * heard by the event hub): every reader hears so, and its copy goes — kept, it would go on
   * answering for a conversation that was deleted.
   */
  gone(message = "Session does not exist."): void {
    this.#stream?.stop();
    this.#failAll(new HttpError(404, "session_not_found", message));
    this.deps.cache.dropSession(this.machineId, this.sessionId).catch((err: unknown) => {
      this.deps.log(
        `[machines] dropping the history copy of ${this.sessionId} on ${this.machineId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  #resolveFill(): void {
    for (const waiter of this.#fillWaiters) waiter.resolve();
    this.#fillWaiters.clear();
  }

  /** This server's copy failed: the job reads on without it (see the module header). */
  #cacheFailed(err: unknown): void {
    if (this.#noCache) return;
    this.#noCache = true;
    this.deps.log(
      `[machines] history copy of ${this.sessionId} on ${this.machineId} failed (${err instanceof Error ? err.message : String(err)}); reading on without it`,
    );
    this.#resolveFill();
  }

  /** A copy operation, or `fallback` once the copy has failed (it fails once, for the job's life). */
  async #cached<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    if (this.#noCache) return fallback;
    try {
      return await work();
    } catch (err) {
      this.#cacheFailed(err);
      return fallback;
    }
  }

  /** Decides what runs next. */
  #pump(): void {
    if (this.#closed) return;
    const stream = this.#stream;
    if (stream !== null) {
      const past = stream.delivered || stream.op === null;
      if (this.#readers.size === 0) stream.stop();
      else if (past && this.#queue.length > 0) stream.stop();
      else if (past) {
        // A stream past its own part goes on for whoever still wants what it carries: the fill's
        // readers when it carries the fill, else the reader whose window it was.
        const wanted = stream.fill
          ? this.#fillReaders.size > 0 && !this.#noCache
          : stream.op !== null && this.#readers.has(stream.op.reader);
        if (!wanted) stream.stop();
      }
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
    const fill =
      !this.#noCache &&
      (op === null || (op.kind === "window" && (op.fill || this.#fillReaders.size > 0)));
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
      windowText: "",
      delivered: false,
      sawDone: false,
      progressed: false,
      overlay: new LineOverlay(),
      bodyRecord: null,
      answer: null,
      refused: null,
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
        if (this.deps.known !== undefined && !this.deps.known(this.machineId)) {
          this.#failAll(
            new HttpError(
              404,
              "machine_not_found",
              "The machine holding this conversation is no longer in this server's list.",
              undefined,
              { machineId: this.machineId },
            ),
          );
          return;
        }
        wait = "not_connected";
        return;
      }
      if (this.#older) {
        await this.#readOverHttp(stream, target);
        return;
      }
      const got = await this.deps.socket(this.machineId, target);
      if (stream.cancelled) return;
      if ("answer" in got) {
        const body = (await got.answer.json().catch(() => null)) as unknown;
        const verdict = socketVerdict(body);
        if (verdict === "older") this.#older = true;
        if (verdict === "older" || verdict === "http") {
          await this.#readOverHttp(stream, target);
        } else if (verdict === "refused") {
          this.#failAll(this.#refusedError(messageOf(body)));
        } else if (verdict === "closed") {
          this.#failAll(new GenerationClosed());
        } else {
          wait = "retrying";
        }
        return;
      }
      const have = await this.#cached(
        () =>
          this.deps.cache.have(
            this.machineId,
            this.sessionId,
            op?.only !== null && op?.only !== undefined ? { only: op.only } : {},
          ),
        [] as HistoryHave[],
      );
      if (stream.cancelled) return;
      const query: HistoryLinesQuery = op === null ? { kind: "fill", have } : op.query(have, fill);
      await this.#carry(stream, got.socket, historyLinesPath(this.sessionId, query), (cancel) => {
        stop = cancel;
      });
      if (stream.answer !== null && isOlderBuild(stream.answer.status, stream.answer.body)) {
        this.#older = true;
        stream.answer = null;
        await this.#readOverHttp(stream, target);
        return;
      }
      wait = this.#outcome(stream);
    } catch (err) {
      this.deps.log(
        `[machines] history of ${this.sessionId} on ${this.machineId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      wait = "retrying";
    } finally {
      this.#stream = null;
      this.#afterStream(stream, wait);
    }
  }

  #refusedError(detail: string | undefined): HttpError {
    return new HttpError(
      502,
      "machine_refused",
      `The machine holding session ${this.sessionId} refused this server's session${detail !== undefined ? `: ${detail}` : "."}`,
      undefined,
      { machineId: this.machineId },
    );
  }

  /** What a stream's end means for its op, its fill and the next attempt. */
  #outcome(stream: MachineStream): "retrying" | null {
    const answer = stream.answer;
    if (answer !== null) {
      const { status, body } = answer;
      const code = codeOf(body);
      if (status === 404 && code === "session_not_found") {
        this.gone(messageOf(body));
        return null;
      }
      // The machine will not show this server's admin the Session: a refusal, said as it is.
      // The Session is there, so its copy stays, and no wait would change the answer.
      if (status === 403 && code === "session_forbidden") {
        this.#failAll(
          new HttpError(
            403,
            "session_forbidden",
            messageOf(body) ?? "The machine does not let this server read the Session.",
          ),
        );
        return null;
      }
      if (status === 401 || status === 403) {
        this.#failAll(this.#refusedError(`${status}`));
        return null;
      }
      if (status >= 400 && status < 500 && status !== 409 && status !== 429) {
        this.#refuse(
          new HttpError(
            status,
            code ?? "machine_answered",
            messageOf(body) ?? `The machine answered ${status}.`,
          ),
          stream,
        );
        return null;
      }
      return "retrying";
    }
    if (stream.refused !== null) {
      const { code, message } = stream.refused;
      this.#refuse(new HttpError(code.endsWith("_not_found") ? 404 : 502, code, message), stream);
      return null;
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
          this.#settle(
            stream.op,
            stream.op.kind === "body"
              ? ({
                  record: stream.bodyRecord,
                  totalBytes: stream.op.track.totalBytes,
                } satisfies FetchedBody)
              : null,
          );
        }
      }
      if (stream.fill) {
        this.#whole = true;
        this.#resolveFill();
      }
      // Evicted after a stream completes: every open job's group (this one's too) is left alone.
      this.deps.cache.evict(this.held()).catch((err: unknown) => {
        this.deps.log(
          `[machines] history copy eviction failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
      return null;
    }
    // Cut short (the socket dropped, the watchdog, an `end` without `done`): asked again, from
    // the copy — at once when it moved, after the growing wait when it did not.
    if (stream.progressed) {
      this.#attempt = 0;
      return null;
    }
    return "retrying";
  }

  /** A refusal for one stream: its op fails, and a fill it carried is not asked for again. */
  #refuse(err: HttpError, stream: MachineStream): void {
    if (stream.op !== null) this.#settle(stream.op, err);
    if (stream.op === null || stream.fill) {
      for (const waiter of this.#fillWaiters) waiter.reject(err);
      this.#fillWaiters.clear();
    }
  }

  #afterStream(stream: MachineStream, wait: "not_connected" | "retrying" | null): void {
    const op = stream.op;
    // An op its stream did not get to the end of goes back to the front, unless its reader left
    // or it was settled (an error).
    if (op !== null && !op.settled && this.#readers.has(op.reader)) this.#queue.unshift(op);
    if (wait !== null && !stream.cancelled && !this.#closed && this.#readers.size > 0) {
      this.#backoff(wait);
    }
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
      // Any bytes on the socket count as life, not only whole events: a large frame crossing a
      // slow link arrives as bytes long before it arrives as an event.
      let heard = this.#clock.now();
      const unheard = socket.onTraffic(() => {
        heard = this.#clock.now();
      });
      // Beats keep a stream alive, but a stream that carries nothing else is stuck over there:
      // its readers are told so (not cut), and told no more once anything else arrives.
      const stallMs = this.deps.stallMs ?? MACHINE_STREAM_STALL_MS;
      let moved = this.#clock.now();
      let slowSaid = false;
      const slow = (said: boolean): void => {
        slowSaid = said;
        const waiting: Waiting = said ? { reason: "slow", attempt: 0, nextAt: 0 } : null;
        for (const track of this.#tracks(stream, stream.phase)) track.wait(waiting);
      };
      const finish = (): void => {
        if (finished) return;
        finished = true;
        unheard();
        if (watchdog !== null) this.#clock.clearTimeout(watchdog);
        resolve();
      };
      const arm = (ms: number = watchdogMs): void => {
        if (watchdog !== null) this.#clock.clearTimeout(watchdog);
        watchdog = this.#clock.setTimeout(() => {
          // The link's last byte, whichever connection carried it, or this stream's own.
          const quiet =
            this.#clock.now() - Math.max(heard, this.deps.heardAt?.(this.machineId) ?? heard);
          if (quiet < watchdogMs) {
            arm(watchdogMs - quiet);
            return;
          }
          this.deps.log(
            `[machines] history of ${this.sessionId} on ${this.machineId}: nothing in ${watchdogMs} ms; asking again from what is held`,
          );
          socket.cancel(id);
          finish();
        }, ms);
      };
      onCancel(() => {
        socket.cancel(id);
        finish();
      });
      const sink: Sink = {
        onStart: () => {
          heard = this.#clock.now();
          arm();
        },
        onEvent: (frame) => {
          if (finished) return;
          heard = this.#clock.now();
          arm();
          if (frame.event !== "ping") {
            moved = heard;
            if (slowSaid) slow(false);
          } else if (!slowSaid && heard - moved >= stallMs) {
            slow(true);
          }
          chain = chain
            .then(async () => {
              if (finished) return;
              await this.#handle(stream, frame);
              // The beat is not counted by either end (it is not what the window paces).
              if (frame.event === "ping") return;
              handled += frame.data.length;
              socket.ack(id, handled);
            })
            .catch((err: unknown) => {
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
        await this.#window(stream, JSON.parse(frame.data) as HistoryLinesWindow);
        return;
      }
      case "window-part": {
        // A window larger than a frame comes in pieces: joined in order, parsed on the last.
        const piece = JSON.parse(frame.data) as HistoryWindowPart;
        const max = this.deps.windowTextMax ?? WINDOW_TEXT_MAX;
        if (stream.windowText.length + piece.text.length > max) {
          this.#broken(stream, "a window larger than any machine sends");
        }
        stream.windowText += piece.text;
        if (!piece.last) return;
        const text = stream.windowText;
        stream.windowText = "";
        await this.#window(stream, JSON.parse(text) as HistoryLinesWindow);
        return;
      }
      case "lines":
      case "part": {
        const line = JSON.parse(frame.data) as HistoryLinesFrame | HistoryPartFrame;
        const raw = frameBytes(line);
        // Bytes past the size the window gave their file are no Trace bytes: nothing of them is
        // kept (a held part grows only within it too, its parts being contiguous).
        const size = stream.window?.files.find((file) => file.k === line.k)?.size;
        if (size === undefined || line.off + raw.length > size) {
          this.#broken(stream, `bytes of ${line.k} past the end it gave that file`);
        }
        const committed = await this.#cached(() => this.deps.cache.commit(this.machineId, line), 0);
        // What the copy cannot serve, and a body's own line, are kept from the stream itself.
        const carried =
          this.#noCache || stream.op?.kind === "body" ? stream.overlay.push(line) : null;
        if (carried !== null && stream.op?.kind === "body" && stream.bodyRecord === null) {
          const found = recordsOf(carried.bytes, line.ord).find(
            (entry) => line.k === stream.op?.only && entry.ordinal === stream.op.ordinal,
          );
          if (found !== undefined) stream.bodyRecord = found.record;
        }
        if (committed > 0 || carried !== null) stream.progressed = true;
        const lines =
          frame.event === "lines"
            ? raw.reduce((n, byte) => (byte === 0x0a ? n + 1 : n), 0)
            : (line as HistoryPartFrame).last
              ? 1
              : 0;
        this.deps.observe?.({
          machineId: this.machineId,
          sessionId: this.sessionId,
          k: line.k,
          off: line.off,
          bytes: raw.length,
        });
        this.#count(stream, raw.length, lines);
        return;
      }
      case "ready":
        await this.#deliver(stream);
        return;
      case "done":
        stream.sawDone = true;
        stream.progressed = true;
        return;
      case "error": {
        const body = JSON.parse(frame.data) as { code?: unknown; message?: unknown };
        stream.refused = {
          code: typeof body.code === "string" ? body.code : "machine_answered",
          message:
            typeof body.message === "string" ? body.message : "The machine refused the read.",
        };
        return;
      }
      default:
        return;
    }
  }

  /**
   * The machine broke the stream's own rules: the stream ends (its handler throws), counted as
   * no progress, so it is asked again only after the growing wait — never in a tight loop.
   */
  #broken(stream: MachineStream, what: string): never {
    stream.progressed = false;
    throw new Error(`the machine sent ${what}`);
  }

  async #window(stream: MachineStream, window: HistoryLinesWindow): Promise<void> {
    stream.window = window;
    // A body stream's `files` is its one file (history-lines.ts): no word on the rest of the tree.
    const whole = stream.op?.kind !== "body";
    await this.#cached(
      () => this.deps.cache.reconcile(this.machineId, this.sessionId, window.files, { whole }),
      undefined,
    );
    if (whole) {
      this.#windowSeen = true;
      this.#group = [
        this.sessionId,
        ...new Set(
          window.files
            .map((file) => parseHistoryFileKey(file.k)?.sessionId)
            .filter((id): id is string => id !== undefined && id !== this.sessionId),
        ),
      ];
    }
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
  }

  /** The readers of a stream in `phase`: its op's own, and in the fill (and the heavy lines) every fill waiter. */
  #tracks(stream: MachineStream, phase: Phase): Track[] {
    const out: Track[] = [];
    if (stream.op !== null && !stream.delivered) out.push(stream.op.track);
    if (stream.fill && phase !== "window") {
      for (const waiter of this.#fillWaiters) out.push(waiter.track);
    }
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

  /** `ready`: the window's light lines are all here; assembled, it goes to its reader. */
  async #deliver(stream: MachineStream): Promise<void> {
    const op = stream.op;
    const window = stream.window;
    if (op === null || op.kind !== "window" || stream.delivered || window === null) return;
    const assembled = await this.#assemble(stream, window);
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
        // What the copy holds of the window does not read back as the machine laid it out: those
        // ranges are let go and sent again; the rest of the copy (other files, other runs) stays.
        const ranges = window.layout.map((segment) => ({
          k: segment.k,
          start: segment.from[0],
          end: segment.to[0],
        }));
        await this.#cached(() => this.deps.cache.release(this.machineId, ranges), undefined);
      }
      stream.stop();
      return;
    }
    stream.delivered = true;
    stream.progressed = true;
    this.#settle(op, assembled);
    if (stream.fill) {
      this.#enter(stream, stream.left.heavy.bytes > 0 ? "heavy" : "fill");
    }
  }

  async #assemble(
    stream: MachineStream,
    window: HistoryLinesWindow,
  ): Promise<AssembledWindow | null> {
    const records = await assembleWindow(
      window.layout,
      async (k, start, end) =>
        stream.overlay.bytes(k, start, end) ??
        (await this.#cached(() => this.deps.cache.bytes(this.machineId, k, start, end), null)),
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
   * A window from the machine's `/messages` over HTTP, counted as it arrives (an older build, or
   * a machine this server holds no socket to); a fill or a file has nothing to bring, since
   * nothing of such a read is kept; a body cannot be had this way.
   */
  async #readOverHttp(stream: MachineStream, target: ProxyTarget): Promise<void> {
    this.#resolveFill();
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
      stream.progressed = true;
      op.track.add(value.byteLength, 0);
    }
    if (stream.cancelled) return;
    // An older build's page has no `units`: counted here, as a newer machine's cut counts it.
    const response = await withWindowUnits(
      JSON.parse(Buffer.concat(chunks).toString("utf8")) as MessagesResponse,
    );
    if (stream.cancelled) return;
    const date = Date.parse(res.headers.get("date") ?? "");
    stream.delivered = true;
    this.#settle(op, {
      response,
      sources: response.messages.map(() => null),
      serverNowMs: Number.isFinite(date) ? date : null,
    } satisfies AssembledWindow);
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
    fields: Pick<Op, "kind" | "query" | "only" | "ordinal" | "read" | "fill">,
    phase: Phase,
    progress: ProgressListener,
  ): Promise<unknown> {
    if (this.job.closed) return Promise.reject(new GenerationClosed());
    if (this.#closed) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.job.enqueue({
        ...fields,
        reader: this,
        track: this.#track(phase, progress),
        resolve,
        reject,
      });
    });
  }

  /** A window, assembled once the machine has sent what the copy lacked. */
  async window(
    read: WindowRead,
    fill: boolean,
    progress: ProgressListener,
  ): Promise<AssembledWindow> {
    const query = (have: HistoryHave[], withFill: boolean): HistoryLinesQuery => {
      const more = withFill ? { fill: true } : {};
      if (read.kind === "full") return { kind: "full", have, ...more };
      const budget = read.budget !== undefined ? { budget: read.budget } : {};
      if (read.kind === "tail") {
        return { kind: "tail", limit: read.limit, have, ...budget, ...more };
      }
      return {
        kind: "before",
        cursor: encodeCursor(read.cursor),
        limit: read.limit,
        have,
        ...budget,
        ...more,
      };
    };
    return (await this.#op(
      { kind: "window", query, only: null, ordinal: null, read, fill },
      "window",
      progress,
    )) as AssembledWindow;
  }

  /** Settles once the copy holds the whole Session group, as of the stream that finished it. */
  fill(progress: ProgressListener): Promise<void> {
    if (this.job.closed) return Promise.reject(new GenerationClosed());
    if (this.#closed) return Promise.reject(aborted());
    return new Promise((resolve, reject) => {
      this.job.waitForFill({ reader: this, track: this.#track("fill", progress), resolve, reject });
    });
  }

  /** The line of one elided value (a trace-body ref naming `k`, record `ordinal`), fetched. */
  async body(
    ref: string,
    k: HistoryFileKey,
    ordinal: number,
    progress: ProgressListener,
  ): Promise<FetchedBody> {
    return (await this.#op(
      {
        kind: "body",
        query: (have) => ({ kind: "body", ref, have }),
        only: k,
        ordinal,
        read: null,
        fill: false,
      },
      "heavy",
      progress,
    )) as FetchedBody;
  }

  /** Settles once the copy holds one file whole (the Trace panel's). */
  async file(k: HistoryFileKey, progress: ProgressListener): Promise<void> {
    await this.#op(
      {
        kind: "file",
        query: (have) => ({ kind: "fill", file: k, have }),
        only: k,
        ordinal: null,
        read: null,
        fill: false,
      },
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
  /** What each machine said of a Session lately (sessionOn), by `<machineId>\0<sessionId>`. */
  readonly #facts = new Map<string, { at: number; fact: SessionFact }>();
  readonly #asking = new Map<string, Promise<SessionFact>>();
  readonly #clock: SyncClock;
  #closed = false;

  constructor(private readonly deps: HistorySyncDeps) {
    this.#clock = deps.clock ?? realClock;
  }

  /** A reader of one machine Session's history, until `signal` aborts or it is closed. */
  reader(machineId: string, sessionId: string, signal: AbortSignal): HistoryReader {
    const key = `${machineId}\0${sessionId}`;
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
      // A generation already replaced runs nothing: its reader's every ask ends at once.
      if (this.#closed) job.close();
      else this.#jobs.set(key, job);
    }
    return new HistoryReader(job, signal);
  }

  /**
   * What the machine says of a Session the copy answers for: there (with its Project over
   * there), gone (its `404 session_not_found`: the copy is dropped, its readers end), or unknown
   * (away, or no usable answer). Asked (`GET /api/sessions/:id`, a few hundred bytes) at most
   * once per `confirmTtlMs` per Session, concurrent askers sharing one ask; an unknown is not kept.
   */
  sessionOn(machineId: string, sessionId: string): Promise<SessionFact> {
    const key = `${machineId}\0${sessionId}`;
    const now = this.#clock.now();
    const known = this.#facts.get(key);
    if (
      known !== undefined &&
      now - known.at < (this.deps.confirmTtlMs ?? SESSION_CONFIRM_TTL_MS)
    ) {
      return Promise.resolve(known.fact);
    }
    let asking = this.#asking.get(key);
    if (asking === undefined) {
      asking = this.#askSession(machineId, sessionId)
        .then((fact) => {
          if (fact.kind === "there") this.#facts.set(key, { at: this.#clock.now(), fact });
          else this.#facts.delete(key);
          if (fact.kind === "gone") this.sessionDeleted(machineId, sessionId);
          return fact;
        })
        .finally(() => this.#asking.delete(key));
      this.#asking.set(key, asking);
    }
    return asking;
  }

  async #askSession(machineId: string, sessionId: string): Promise<SessionFact> {
    const target = await this.deps.target(machineId).catch(() => null);
    if (target === null) return { kind: "unknown" };
    const res = await this.deps
      .http(
        machineId,
        target,
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        AbortSignal.timeout(20_000),
      )
      .catch(() => null);
    if (res === null) return { kind: "unknown" };
    const body = (await res.json().catch(() => null)) as {
      session?: { projectId?: unknown };
      error?: { code?: unknown };
    } | null;
    if (res.status === 404 && body?.error?.code === "session_not_found") return { kind: "gone" };
    if (!res.ok) return { kind: "unknown" };
    const projectId = body?.session?.projectId;
    return {
      kind: "there",
      projectId: typeof projectId === "string" && projectId !== "" ? projectId : null,
    };
  }

  /** The Project a machine Session belongs to over there (sessionOn); null when it cannot say. */
  async projectOf(machineId: string, sessionId: string): Promise<string | null> {
    const fact = await this.sessionOn(machineId, sessionId);
    return fact.kind === "there" ? fact.projectId : null;
  }

  /** The machine deleted the Session: its readers end with `session_not_found`, and its copy goes. */
  sessionDeleted(machineId: string, sessionId: string): void {
    const job = this.#jobs.get(`${machineId}\0${sessionId}`);
    if (job !== undefined) {
      job.gone();
      return;
    }
    this.deps.cache.dropSession(machineId, sessionId).catch((err: unknown) => {
      this.deps.log(
        `[machines] dropping the history copy of ${sessionId} on ${machineId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  /** The `<machineId>\0<sessionId>` directories open jobs use: eviction leaves them alone. */
  held(): Set<string> {
    const out = new Set<string>();
    for (const job of this.#jobs.values()) {
      for (const sessionId of job.group) out.add(`${job.machineId}\0${sessionId}`);
    }
    return out;
  }

  /** The generation is replaced: every job's readers are let go (GenerationClosed), and no new job starts. */
  close(): void {
    this.#closed = true;
    for (const job of this.#jobs.values()) job.close();
    this.#jobs.clear();
  }
}
