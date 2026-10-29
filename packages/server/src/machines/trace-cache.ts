/**
 * The hub's copy of its machines' Trace lines (spec 05, "Remote Session history: the machine
 * cuts, this server caches"): what a machine has sent is kept, so a conversation opened again
 * asks the machine only for what is new, and a Trace file the machine has rotated is never asked
 * for twice.
 *
 * LAYOUT. `<root>/<machine>/<session>/<NNN>.jsonl` is a byte-exact copy of that machine's Trace
 * file: each line is written at its own offset, and the bytes between the runs held (holes) are
 * never read. `<machine>` and `<session>` are hashes of the ids, so no id — mixed case on a
 * case-blind disk, a Windows device name — can collide or misname a directory; the ids
 * themselves ride in the files. Beside each copy, `<NNN>.jsonl.json` says which runs are real —
 * each from a line start to just after a `\n`, with the ordinal of its first record and its
 * record count — and the identity and size of the machine's file they were copied from. A
 * Session's directory also keeps `group.json`, the descendant Sessions its windows read, so a
 * Session and its subagents are offered to the machine and evicted together. `<root>/VERSION`
 * names the format; any other version wipes the directory, which is only ever a cache.
 *
 * COMMIT RULE. Bytes are written only into holes, never over committed bytes, and only whole
 * lines; the data is synced to disk before the sidecar is replaced (tmp + rename), so a crash
 * leaves at most bytes no run vouches for, which no read returns. A data file that is gone when a
 * commit comes takes every run it held with it. A line that arrives in parts is held in memory
 * until its last part (socket/line-frames.ts) and offered to the machine as a partial when the
 * stream is reopened; a restart loses it, and that one line is sent again.
 *
 * READS NEVER GUESS. Bytes are answered only when every one of them is committed — a run whose
 * line starts read as NUL is a hole, whatever its sidecar says — and records only by the count
 * the caller expects; anything else is null, and the caller asks the machine.
 *
 * BOUNDS. Each copy counts its highest offset held, not the bytes in it: a copy of a file's tail
 * is not sparse on every disk (NTFS fills the extent). Past `capBytes`, when a stream ends, the
 * least recently read Sessions go first — never one an open job holds — until the cache is back
 * under 80 % of the cap. Eviction and a machine's removal take each file's own turn, so a commit
 * in flight finishes or is refused, never written into a directory being removed.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import type { AmspRecord } from "@prismshadow/penguin-core";
import type {
  HistoryFileFact,
  HistoryFileKey,
  HistoryHave,
  HistoryLinesFrame,
  HistoryPartFrame,
} from "../api/types.js";
import {
  HAVE_MAX_CHARS,
  anchorOf,
  hiAnchorRange,
  loAnchorRange,
  parseHistoryFileKey,
} from "../services/history-wire.js";
import { LineCommitter } from "../socket/line-frames.js";

/** The on-disk format; a directory written by another one is wiped when the cache opens. */
export const TRACE_CACHE_FORMAT = 2;
/** How many bytes of copies the cache keeps across machines (plan D1). */
export const TRACE_CACHE_CAP_BYTES = 1024 ** 3;
/** Eviction stops once the cache is back under this share of its cap. */
const EVICT_TO = 0.8;
/** How long a removal keeps trying past a file another handle still holds (Windows). */
const RM_DEADLINE_MS = 5_000;
const NEWLINE = 0x0a;
/** How much of a run one read of the record index takes at a time. */
const SCAN_CHUNK = 1024 * 1024;
/** What a `have` may take of the machine's ceiling, leaving room for the rest of the query. */
const HAVE_BUDGET_CHARS = HAVE_MAX_CHARS - 2048;

/** The directory name of an id: a hash, so no id can collide with another or misname a path. */
export const dirNameOf = (id: string): string =>
  createHash("sha256").update(id, "utf8").digest("hex").slice(0, 32);

/** A run of committed bytes: `[start, end)`, from record `ordinal`, holding `records`. */
interface Run {
  start: number;
  end: number;
  ordinal: number;
  records: number;
}

/** What `<NNN>.jsonl.json` holds. */
interface Sidecar {
  version: number;
  machineId: string;
  k: HistoryFileKey;
  /** The machine file's identity as it reported it (`HistoryFileFact.ino`). */
  ino: HistoryFileFact["ino"] | null;
  birthtimeMs: number;
  /** The machine's file size as last told; a copy with one run [0, size) is whole. */
  size: number;
  final: boolean;
  runs: Run[];
  lastReadAt: number;
}

interface FileState {
  machineId: string;
  sessionId: string;
  index: number;
  sidecar: Sidecar;
  dataPath: string;
  sidecarPath: string;
  committer: LineCommitter;
  /** The records before the line held in part (its part frame's `ord`), while one is held. */
  partialOrd: number | null;
  /** Every record's line in the copy, sorted by offset; built on first read, extended by commits. */
  lines: { starts: number[]; ends: number[] } | null;
  /** Removed (evicted, dropped): a write still queued for it does nothing. */
  dead: boolean;
}

/** Whether `bytes` holds one Trace record by the tolerant reader's rule (trace-line-index.ts). */
function isRecordLine(bytes: Buffer): boolean {
  const text = bytes.toString("utf8").trim();
  if (text === "") return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** The lines of `bytes` (which end with `\n`) as offsets within it, and whether each is a record. */
function splitLines(bytes: Buffer): Array<{ start: number; end: number; record: boolean }> {
  const out: Array<{ start: number; end: number; record: boolean }> = [];
  let start = 0;
  while (start < bytes.length) {
    const nl = bytes.indexOf(NEWLINE, start);
    const end = nl < 0 ? bytes.length : nl + 1;
    out.push({ start, end, record: isRecordLine(bytes.subarray(start, end)) });
    start = end;
  }
  return out;
}

/** The parts of `[from, to)` no run covers, in order. */
function holesIn(runs: readonly Run[], from: number, to: number): Array<[number, number]> {
  const holes: Array<[number, number]> = [];
  let at = from;
  for (const run of runs) {
    if (run.end <= at) continue;
    if (run.start >= to) break;
    if (run.start > at) holes.push([at, run.start]);
    at = Math.max(at, run.end);
    if (at >= to) break;
  }
  if (at < to) holes.push([at, to]);
  return holes;
}

/** What a copy counts toward the cap: its highest offset held (see the module header). */
const extentOf = (runs: readonly Run[]): number =>
  runs.reduce((max, run) => Math.max(max, run.end), 0);

/**
 * Whether a buffer read from the copy starts a line with NUL: a hole reads as zeros, and every
 * hole begins at a line start (runs end on `\n`), while no Trace line begins with NUL.
 */
function opensWithNul(buf: Buffer): boolean {
  if (buf.length > 0 && buf[0] === 0) return true;
  for (
    let at = buf.indexOf(NEWLINE);
    at >= 0 && at + 1 < buf.length;
    at = buf.indexOf(NEWLINE, at + 1)
  ) {
    if (buf[at + 1] === 0) return true;
  }
  return false;
}

/** The first index of `sorted` whose value is at least `value`. */
function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException)?.code;
const isMissing = (err: unknown): boolean => codeOf(err) === "ENOENT";

/**
 * Removes a path, trying again while another handle still holds a file in it (Windows answers
 * EBUSY or EPERM until it is let go), up to a deadline.
 */
async function rmEventually(target: string): Promise<void> {
  const deadline = Date.now() + RM_DEADLINE_MS;
  for (;;) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = codeOf(err);
      const busy = code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY";
      if (!busy || Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export interface TraceCacheOptions {
  /** Bytes of copies kept across machines. */
  capBytes?: number;
  now?: () => number;
  /** Test observability: every byte range read from a copy, as [start, end). */
  observeRead?: (start: number, end: number) => void;
}

/** One record read back from the copy: the record, and where its line lies. */
export interface CachedRecord {
  record: AmspRecord;
  offset: number;
  end: number;
}

/** What a `have` names: the whole group (a window, the fill) or one file (a body, the Trace panel). */
export interface HaveRequest {
  /** Only this file's entry. */
  only?: HistoryFileKey;
  /** The most characters the encoded entries may take. */
  budget?: number;
}

export class TraceCache {
  readonly #root: string;
  readonly #capBytes: number;
  readonly #now: () => number;
  readonly #observeRead: ((start: number, end: number) => void) | undefined;
  /** Loaded files, by `<machineId>\0<k>`. */
  readonly #files = new Map<string, FileState>();
  /** What each Session directory counts toward the cap, and when it was read, by `<machineId>\0<sessionId>`. */
  readonly #dirs = new Map<
    string,
    { machineId: string; sessionId: string; bytes: number; lastReadAt: number }
  >();
  /** One write at a time per file. */
  readonly #chains = new Map<string, Promise<unknown>>();
  #opened: Promise<void> | null = null;

  constructor(root: string, options: TraceCacheOptions = {}) {
    this.#root = root;
    this.#capBytes = options.capBytes ?? TRACE_CACHE_CAP_BYTES;
    this.#now = options.now ?? Date.now;
    this.#observeRead = options.observeRead;
  }

  /**
   * The directory, checked and counted on first use (a server that reads no remote history
   * writes nothing). An open that failed is tried again on the next use, never remembered.
   */
  get #ready(): Promise<void> {
    this.#opened ??= this.#open().catch((err: unknown) => {
      this.#opened = null;
      throw err;
    });
    return this.#opened;
  }

  #sessionDir(machineId: string, sessionId: string): string {
    return path.join(this.#root, dirNameOf(machineId), dirNameOf(sessionId));
  }

  async #open(): Promise<void> {
    const versionPath = path.join(this.#root, "VERSION");
    let version: string | null = null;
    try {
      version = (await fs.readFile(versionPath, "utf8")).trim();
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    if (version !== String(TRACE_CACHE_FORMAT)) {
      await rmEventually(this.#root);
      await fs.mkdir(this.#root, { recursive: true });
      await fs.writeFile(versionPath, `${TRACE_CACHE_FORMAT}\n`);
      return;
    }
    for (const machineDir of await this.#list(this.#root)) {
      if (machineDir === "VERSION") continue;
      for (const sessionDir of await this.#list(path.join(this.#root, machineDir))) {
        const dir = path.join(this.#root, machineDir, sessionDir);
        for (const name of await this.#list(dir)) {
          if (!name.endsWith(".jsonl.json")) continue;
          const sidecar = await this.#readSidecar(path.join(dir, name));
          const file = sidecar === null ? null : parseHistoryFileKey(sidecar.k);
          if (sidecar === null || file === null) continue;
          const usage = this.#usage(sidecar.machineId, file.sessionId);
          usage.bytes += extentOf(sidecar.runs);
          usage.lastReadAt = Math.max(usage.lastReadAt, sidecar.lastReadAt);
        }
      }
    }
  }

  async #list(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (err) {
      // Nothing there, or a file where a directory was looked for (`VERSION` beside the machines).
      const code = codeOf(err);
      if (code === "ENOENT" || code === "ENOTDIR") return [];
      throw err;
    }
  }

  async #readSidecar(file: string): Promise<Sidecar | null> {
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8")) as Sidecar;
      return value.version === TRACE_CACHE_FORMAT &&
        Array.isArray(value.runs) &&
        typeof value.machineId === "string"
        ? value
        : null;
    } catch {
      return null;
    }
  }

  #usage(machineId: string, sessionId: string): { bytes: number; lastReadAt: number } {
    const key = `${machineId}\0${sessionId}`;
    let usage = this.#dirs.get(key);
    if (usage === undefined) {
      usage = { machineId, sessionId, bytes: 0, lastReadAt: this.#now() };
      this.#dirs.set(key, usage);
    }
    return usage;
  }

  /** One cached file's state, loaded from its sidecar on first use; null when there is none (or `k` names none). */
  async #state(machineId: string, k: HistoryFileKey, create: boolean): Promise<FileState | null> {
    await this.#ready;
    const id = `${machineId}\0${k}`;
    const loaded = this.#files.get(id);
    if (loaded !== undefined) return loaded;
    const parsed = parseHistoryFileKey(k);
    if (parsed === null || machineId === "") return null;
    const dataPath = path.join(
      this.#sessionDir(machineId, parsed.sessionId),
      `${String(parsed.fileIndex).padStart(3, "0")}.jsonl`,
    );
    const sidecarPath = `${dataPath}.json`;
    let sidecar = await this.#readSidecar(sidecarPath);
    if (sidecar !== null && (sidecar.k !== k || sidecar.machineId !== machineId)) sidecar = null;
    if (sidecar === null) {
      if (!create) return null;
      sidecar = {
        version: TRACE_CACHE_FORMAT,
        machineId,
        k,
        ino: null,
        birthtimeMs: 0,
        size: 0,
        final: false,
        runs: [],
        lastReadAt: this.#now(),
      };
    }
    // Another caller may have loaded it while this one read the sidecar: one state per file.
    const raced = this.#files.get(id);
    if (raced !== undefined) return raced;
    const state: FileState = {
      machineId,
      sessionId: parsed.sessionId,
      index: parsed.fileIndex,
      sidecar,
      dataPath,
      sidecarPath,
      committer: new LineCommitter(),
      partialOrd: null,
      lines: null,
      dead: false,
    };
    this.#files.set(id, state);
    return state;
  }

  /** Runs `work` after every earlier one on the same file. */
  #serial<T>(state: FileState, work: () => Promise<T>): Promise<T> {
    const id = `${state.machineId}\0${state.sidecar.k}`;
    const run = (this.#chains.get(id) ?? Promise.resolve()).catch(() => undefined).then(work);
    this.#chains.set(id, run);
    void run.then(
      () => this.#settled(id, run),
      () => this.#settled(id, run),
    );
    return run;
  }

  #settled(id: string, run: Promise<unknown>): void {
    if (this.#chains.get(id) === run) this.#chains.delete(id);
  }

  async #writeSidecar(state: FileState): Promise<void> {
    if (state.dead) return;
    await fs.mkdir(path.dirname(state.sidecarPath), { recursive: true });
    const tmp = `${state.sidecarPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state.sidecar));
    await fs.rename(tmp, state.sidecarPath);
  }

  /** Replaces a file's runs, keeping the directory's count of its extent in step. */
  #setRuns(state: FileState, runs: Run[]): void {
    const usage = this.#usage(state.machineId, state.sessionId);
    usage.bytes += extentOf(runs) - extentOf(state.sidecar.runs);
    state.sidecar.runs = runs;
  }

  /** Forgets every byte of a file — its data, its runs, a held partial; its identity stays. */
  async #clear(state: FileState): Promise<void> {
    this.#setRuns(state, []);
    state.committer = new LineCommitter();
    state.partialOrd = null;
    state.lines = null;
    await rmEventually(state.dataPath);
  }

  /**
   * Brings one Session group's copies in line with what the machine says its files are now
   * (the `window` event's `files`): a file the machine reset, or whose identity changed, starts
   * over; a cached file of the group the machine no longer lists is dropped; the group's
   * Sessions are remembered for the next `have`.
   */
  async reconcile(
    machineId: string,
    sessionId: string,
    facts: readonly HistoryFileFact[],
  ): Promise<void> {
    await this.#ready;
    const listed = new Set(facts.map((fact) => fact.k));
    for (const state of await this.#groupFiles(machineId, sessionId)) {
      if (listed.has(state.sidecar.k)) continue;
      await this.#serial(state, async () => {
        await this.#clear(state);
        state.dead = true;
        await rmEventually(state.sidecarPath);
        this.#files.delete(`${machineId}\0${state.sidecar.k}`);
      });
    }
    const sessions = new Set<string>();
    for (const fact of facts) {
      const state = await this.#state(machineId, fact.k, true);
      if (state === null) continue;
      sessions.add(state.sessionId);
      await this.#serial(state, async () => {
        if (state.dead) return;
        const sidecar = state.sidecar;
        const moved =
          sidecar.ino === null ||
          String(sidecar.ino) !== String(fact.ino) ||
          sidecar.birthtimeMs !== fact.birthtimeMs;
        if (fact.reset === true || moved || fact.size < sidecar.size) await this.#clear(state);
        sidecar.ino = fact.ino;
        sidecar.birthtimeMs = fact.birthtimeMs;
        sidecar.size = fact.size;
        sidecar.final = fact.final;
        sidecar.lastReadAt = this.#now();
        await this.#writeSidecar(state);
      });
    }
    sessions.delete(sessionId);
    const groupPath = path.join(this.#sessionDir(machineId, sessionId), "group.json");
    await fs.mkdir(path.dirname(groupPath), { recursive: true });
    await fs.writeFile(
      `${groupPath}.tmp`,
      JSON.stringify({ machineId, sessionId, sessions: [...sessions] }),
    );
    await fs.rename(`${groupPath}.tmp`, groupPath);
  }

  /** A Session and the descendants its last window read. */
  async groupSessions(machineId: string, sessionId: string): Promise<string[]> {
    await this.#ready;
    let listed: unknown = null;
    try {
      const group = JSON.parse(
        await fs.readFile(path.join(this.#sessionDir(machineId, sessionId), "group.json"), "utf8"),
      ) as { machineId?: unknown; sessionId?: unknown; sessions?: unknown };
      if (group.machineId === machineId && group.sessionId === sessionId) listed = group.sessions;
    } catch {
      // No window read yet: the group is the Session alone.
    }
    const descendants = Array.isArray(listed)
      ? listed.filter((id): id is string => typeof id === "string" && id !== "")
      : [];
    return [sessionId, ...descendants.filter((id) => id !== sessionId)];
  }

  async #groupFiles(machineId: string, sessionId: string): Promise<FileState[]> {
    const out: FileState[] = [];
    for (const member of await this.groupSessions(machineId, sessionId)) {
      const dir = this.#sessionDir(machineId, member);
      for (const name of (await this.#list(dir)).sort()) {
        if (!name.endsWith(".jsonl.json")) continue;
        const sidecar = await this.#readSidecar(path.join(dir, name));
        if (sidecar === null || sidecar.machineId !== machineId) continue;
        const state = await this.#state(machineId, sidecar.k, false);
        if (state !== null && !state.dead) out.push(state);
      }
    }
    return out;
  }

  /**
   * What the hub holds, as the machine's `have` takes it: per file its runs, with the anchors the
   * machine checks them by, and a line held in part. A body or the Trace panel's one file names
   * only that file (`only`); a window or a fill names the group under `budget` — the Session's own
   * files newest first, then the descendants' largest first — and a file left out is simply sent
   * again (what is committed is skipped), never reset.
   */
  async have(
    machineId: string,
    sessionId: string,
    request: HaveRequest = {},
  ): Promise<HistoryHave[]> {
    let states: FileState[];
    if (request.only !== undefined) {
      const state = await this.#state(machineId, request.only, false);
      states = state === null || state.dead ? [] : [state];
    } else {
      states = (await this.#groupFiles(machineId, sessionId)).sort((a, b) => {
        const own = Number(b.sessionId === sessionId) - Number(a.sessionId === sessionId);
        if (own !== 0) return own;
        if (a.sessionId === sessionId) return b.index - a.index;
        return extentOf(b.sidecar.runs) - extentOf(a.sidecar.runs);
      });
    }
    const budget = request.budget ?? HAVE_BUDGET_CHARS;
    const out: HistoryHave[] = [];
    // The encoded size of the JSON array so far: `[`, `]`, the entries and their commas, base64url.
    let jsonBytes = 2;
    for (const state of states) {
      const entry = await this.#serial(state, () => this.#haveOf(state));
      if (entry === null) continue;
      const more = Buffer.byteLength(JSON.stringify(entry), "utf8") + (out.length > 0 ? 1 : 0);
      if (Math.ceil(((jsonBytes + more) * 4) / 3) > budget) continue;
      jsonBytes += more;
      out.push(entry);
    }
    return out;
  }

  async #haveOf(state: FileState): Promise<HistoryHave | null> {
    const top = state.sidecar.runs.at(-1);
    if (top === undefined || state.dead || state.sidecar.ino === null) return null;
    const lo = await this.#read(state, ...loAnchorRange(top.start, top.end));
    const hi = await this.#read(state, ...hiAnchorRange(top.start, top.end));
    if (lo === null || hi === null) return null;
    const partial = state.committer.partial();
    return {
      k: state.sidecar.k,
      ino: state.sidecar.ino,
      birthtimeMs: state.sidecar.birthtimeMs,
      lo: top.start,
      loOrd: top.ordinal,
      hi: top.end,
      loAnchor: anchorOf(lo),
      hiAnchor: anchorOf(hi),
      ...(partial !== null
        ? {
            partial: {
              off: partial.off,
              len: partial.bytes.length,
              anchor: anchorOf(partial.bytes),
            },
          }
        : {}),
    };
  }

  async #read(state: FileState, from: number, to: number): Promise<Buffer | null> {
    if (to <= from) return Buffer.alloc(0);
    let handle: FileHandle;
    try {
      handle = await fs.open(state.dataPath, "r");
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
    try {
      const buf = Buffer.alloc(to - from);
      const { bytesRead } = await handle.read(buf, 0, buf.length, from);
      this.#observeRead?.(from, to);
      return bytesRead === buf.length ? buf : null;
    } finally {
      await handle.close();
    }
  }

  /**
   * Takes one `lines` or `part` frame of a file the window listed: the whole lines it completes
   * are committed where they fall in holes. Answers how many bytes were newly committed.
   */
  async commit(machineId: string, frame: HistoryLinesFrame | HistoryPartFrame): Promise<number> {
    const state = await this.#state(machineId, frame.k, false);
    if (state === null) return 0;
    return this.#serial(state, async () => {
      if (state.dead) return 0;
      const lines = state.committer.push(frame);
      if (lines === null) {
        state.partialOrd = frame.ord;
        return 0;
      }
      if (state.committer.partial() === null) state.partialOrd = null;
      return this.#commitBytes(state, lines.off, frame.ord, lines.bytes);
    });
  }

  async #commitBytes(state: FileState, off: number, ord: number, bytes: Buffer): Promise<number> {
    if (bytes.length === 0 || bytes[bytes.length - 1] !== NEWLINE) return 0;
    let handle: FileHandle;
    try {
      handle = await fs.open(state.dataPath, "r+");
    } catch (err) {
      if (!isMissing(err)) throw err;
      // The copy's data is gone (evicted, removed by hand): nothing the runs said is there.
      if (state.sidecar.runs.length > 0) {
        this.#setRuns(state, []);
        state.lines = null;
      }
      await fs.mkdir(path.dirname(state.dataPath), { recursive: true });
      handle = await fs.open(state.dataPath, "w+");
    }
    const holes = holesIn(state.sidecar.runs, off, off + bytes.length);
    const lines = splitLines(bytes);
    const added: Run[] = [];
    const addedLines: Array<{ start: number; end: number }> = [];
    let committed = 0;
    try {
      for (const [from, to] of holes) {
        let ordinal = ord;
        let records = 0;
        for (const line of lines) {
          if (!line.record) continue;
          const at = off + line.start;
          if (at < from) ordinal += 1;
          else if (at < to) {
            records += 1;
            addedLines.push({ start: at, end: off + line.end });
          }
        }
        await handle.write(bytes, from - off, to - from, from);
        added.push({ start: from, end: to, ordinal, records });
        committed += to - from;
      }
      // On disk before any sidecar says so.
      if (committed > 0) await handle.datasync();
    } finally {
      await handle.close();
    }
    if (committed === 0) return 0;
    let consistent = true;
    for (const run of added) consistent = this.#insert(state, run) && consistent;
    if (consistent && state.lines !== null) {
      for (const line of addedLines) {
        const at = lowerBound(state.lines.starts, line.start);
        state.lines.starts.splice(at, 0, line.start);
        state.lines.ends.splice(at, 0, line.end);
      }
    } else if (!consistent) {
      state.lines = null;
    }
    await this.#writeSidecar(state);
    return committed;
  }

  /**
   * Adds a run, merging it with the runs it touches. Runs that touch must agree on their
   * ordinals; runs that do not mean the file changed under the copy, and only the new run —
   * what the machine just sent — is kept (answered false).
   */
  #insert(state: FileState, run: Run): boolean {
    const runs = state.sidecar.runs;
    const left = runs.find((x) => x.end === run.start);
    const right = runs.find((x) => x.start === run.end);
    if (
      (left !== undefined && left.ordinal + left.records !== run.ordinal) ||
      (right !== undefined && run.ordinal + run.records !== right.ordinal)
    ) {
      this.#setRuns(state, [run]);
      return false;
    }
    let merged = run;
    if (left !== undefined) {
      merged = {
        start: left.start,
        end: merged.end,
        ordinal: left.ordinal,
        records: left.records + merged.records,
      };
    }
    if (right !== undefined) {
      merged = { ...merged, end: right.end, records: merged.records + right.records };
    }
    this.#setRuns(
      state,
      [...runs.filter((x) => x !== left && x !== right), merged].sort((a, b) => a.start - b.start),
    );
    return true;
  }

  /** Bytes `[start, end)` of a file's copy, or null unless every one of them is committed. */
  async bytes(
    machineId: string,
    k: HistoryFileKey,
    start: number,
    end: number,
  ): Promise<Buffer | null> {
    const state = await this.#state(machineId, k, false);
    if (state === null || state.dead) return null;
    if (end <= start) return Buffer.alloc(0);
    const covered = state.sidecar.runs.some((run) => run.start <= start && end <= run.end);
    if (!covered) return null;
    const buf = await this.#read(state, start, end);
    return buf === null || opensWithNul(buf) ? null : buf;
  }

  /** Records `[from, to)` of a file by ordinal, or null unless all of them are held. */
  async records(
    machineId: string,
    k: HistoryFileKey,
    from: number,
    to: number,
  ): Promise<CachedRecord[] | null> {
    const state = await this.#state(machineId, k, false);
    if (state === null || state.dead) return null;
    if (to <= from) return [];
    const run = state.sidecar.runs.find((x) => x.ordinal <= from && to <= x.ordinal + x.records);
    if (run === undefined) return null;
    const lines = await this.#lines(state);
    if (lines === null) return null;
    const first = lowerBound(lines.starts, run.start) + (from - run.ordinal);
    const last = first + (to - from) - 1;
    const base = lines.starts[first];
    const top = lines.ends[last];
    if (base === undefined || top === undefined || top > run.end) return null;
    const bytes = await this.#read(state, base, top);
    if (bytes === null || opensWithNul(bytes)) return null;
    const out: CachedRecord[] = [];
    try {
      for (let i = first; i <= last; i++) {
        const offset = lines.starts[i]!;
        const end = lines.ends[i]!;
        const record = JSON.parse(bytes.toString("utf8", offset - base, end - base).trim());
        out.push({ record: record as AmspRecord, offset, end });
      }
    } catch {
      return null;
    }
    return out;
  }

  /**
   * Every record's line in the copy, scanned once and then kept in step by each commit; null
   * when a run does not hold the records its sidecar says.
   */
  async #lines(state: FileState): Promise<{ starts: number[]; ends: number[] } | null> {
    if (state.lines !== null) return state.lines;
    const starts: number[] = [];
    const ends: number[] = [];
    for (const run of state.sidecar.runs) {
      const before = starts.length;
      let carry: Buffer = Buffer.alloc(0);
      let lineStart = run.start;
      for (let at = run.start; at < run.end; at += SCAN_CHUNK) {
        const chunk = await this.#read(state, at, Math.min(run.end, at + SCAN_CHUNK));
        if (chunk === null) return null;
        const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk;
        let from = 0;
        for (let nl = buf.indexOf(NEWLINE, from); nl >= 0; nl = buf.indexOf(NEWLINE, from)) {
          if (isRecordLine(buf.subarray(from, nl + 1))) {
            starts.push(lineStart + from);
            ends.push(lineStart + nl + 1);
          }
          from = nl + 1;
        }
        lineStart += from;
        carry = buf.subarray(from);
      }
      if (starts.length - before !== run.records) return null;
    }
    state.lines = { starts, ends };
    return state.lines;
  }

  /**
   * The record count of a rotated file whose copy holds every byte the machine said it has, or
   * null otherwise — a live file's copy is behind the machine by whatever it wrote since.
   */
  async finalRecords(machineId: string, k: HistoryFileKey): Promise<number | null> {
    const state = await this.#state(machineId, k, false);
    if (state === null || state.dead || !state.sidecar.final) return null;
    const [only, ...more] = state.sidecar.runs;
    const whole =
      only !== undefined &&
      more.length === 0 &&
      only.start === 0 &&
      only.end === state.sidecar.size;
    return whole ? only.records : null;
  }

  /** The key of a Session's own file `index`, when the copy has been told of it. */
  async ownFileKey(
    machineId: string,
    sessionId: string,
    index: number,
  ): Promise<HistoryFileKey | null> {
    await this.#ready;
    for (const state of this.#files.values()) {
      if (state.machineId === machineId && state.sessionId === sessionId && state.index === index) {
        return state.dead ? null : state.sidecar.k;
      }
    }
    const name = `${String(index).padStart(3, "0")}.jsonl.json`;
    const sidecar = await this.#readSidecar(
      path.join(this.#sessionDir(machineId, sessionId), name),
    );
    return sidecar !== null && sidecar.machineId === machineId ? sidecar.k : null;
  }

  /** Forgets every byte held of one Session group: what it holds could not be read back. */
  async forget(machineId: string, sessionId: string): Promise<void> {
    for (const state of await this.#groupFiles(machineId, sessionId)) {
      await this.#serial(state, async () => {
        if (state.dead) return;
        await this.#clear(state);
        await this.#writeSidecar(state);
      });
    }
  }

  /** Marks Sessions as read now: eviction takes the least recently read first. */
  touch(machineId: string, sessionIds: readonly string[]): void {
    const now = this.#now();
    for (const sessionId of sessionIds) this.#usage(machineId, sessionId).lastReadAt = now;
  }

  /** Bytes the copies count toward the cap (each file's highest offset held). */
  get usedBytes(): number {
    let total = 0;
    for (const usage of this.#dirs.values()) total += usage.bytes;
    return total;
  }

  /**
   * When the cache is over its cap, evicts the least recently read Sessions until it is back
   * under 80 % of it; `held` (`<machineId>\0<sessionId>`) are the ones open jobs use.
   */
  async evict(held: ReadonlySet<string>): Promise<void> {
    await this.#ready;
    let total = this.usedBytes;
    if (total <= this.#capBytes) return;
    const order = [...this.#dirs.entries()]
      .filter(([key]) => !held.has(key))
      .sort((a, b) => a[1].lastReadAt - b[1].lastReadAt);
    for (const [, usage] of order) {
      if (total <= this.#capBytes * EVICT_TO) break;
      const bytes = usage.bytes;
      await this.#remove(
        (state) => state.machineId === usage.machineId && state.sessionId === usage.sessionId,
        this.#sessionDir(usage.machineId, usage.sessionId),
        (key) => key === `${usage.machineId}\0${usage.sessionId}`,
      );
      total -= bytes;
    }
  }

  /**
   * Removes a directory once every loaded file in it has had its turn: each is marked dead on
   * its own chain (a commit in flight finishes first, a later one does nothing), then the
   * directory goes, and only then do the states and the accounting.
   */
  async #remove(
    owns: (state: FileState) => boolean,
    dir: string,
    counts: (usageKey: string) => boolean,
  ): Promise<void> {
    const states = [...this.#files.values()].filter(owns);
    for (const state of states) {
      await this.#serial(state, async () => {
        state.dead = true;
      });
    }
    await rmEventually(dir);
    for (const state of states) {
      const id = `${state.machineId}\0${state.sidecar.k}`;
      if (this.#files.get(id) === state) this.#files.delete(id);
    }
    for (const key of [...this.#dirs.keys()]) if (counts(key)) this.#dirs.delete(key);
  }

  /** Whether the directory exists at all (nothing to drop from one never written). */
  async #exists(): Promise<boolean> {
    try {
      await fs.access(this.#root);
      return true;
    } catch {
      return false;
    }
  }

  /** Drops everything held of one machine: it left this hub's list, or its data was removed. */
  async dropMachine(machineId: string): Promise<void> {
    if (machineId === "" || !(this.#opened !== null || (await this.#exists()))) return;
    await this.#ready;
    await this.#remove(
      (state) => state.machineId === machineId,
      path.join(this.#root, dirNameOf(machineId)),
      (key) => key.startsWith(`${machineId}\0`),
    );
  }

  /** Drops every machine's directory but those of `known` (run as the hub starts). */
  async dropUnknown(known: ReadonlySet<string>): Promise<void> {
    if (this.#opened === null && !(await this.#exists())) return;
    await this.#ready;
    const keep = new Set([...known].map(dirNameOf));
    for (const name of await this.#list(this.#root)) {
      if (name === "VERSION" || keep.has(name)) continue;
      await this.#remove(
        (state) => dirNameOf(state.machineId) === name,
        path.join(this.#root, name),
        (key) => dirNameOf(key.slice(0, key.indexOf("\0"))) === name,
      );
    }
  }
}
