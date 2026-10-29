/**
 * The hub's copy of its machines' Trace lines (spec 05 「远程会话的历史」): what a machine has
 * sent is kept, so a conversation opened again asks the machine only for what is new, and a
 * Trace file the machine has rotated is never asked for twice.
 *
 * LAYOUT. `<root>/<machineId>/<sessionId>/<NNN>.jsonl` is a sparse, byte-exact copy of that
 * machine's Trace file: each line is written at its own offset, and the bytes between the runs
 * held (holes) are never read. Beside it, `<NNN>.jsonl.json` says which runs are real — each from
 * a line start to just after a `\n`, with the ordinal of its first record and its record count —
 * and the identity and size of the machine's file they were copied from. A Session's directory
 * also keeps `group.json`, the descendant Sessions its windows read, so a Session and its
 * subagents are offered to the machine and evicted together. `<root>/VERSION` names the format;
 * any other version wipes the directory, which is only ever a cache.
 *
 * COMMIT RULE. Bytes are written only into holes, never over committed bytes, and only whole
 * lines; the sidecar is replaced (tmp + rename) after the data, so a crash leaves at most bytes
 * no run vouches for, which no read returns. A line that arrives in parts is held in memory
 * until its last part (socket/line-frames.ts) and offered to the machine as a partial when the
 * stream is reopened; a restart loses it, and that one line is sent again.
 *
 * READS NEVER GUESS. Bytes are answered only when every one of them is committed, and records
 * only by the count the caller expects; anything else is null, and the caller asks the machine.
 *
 * BOUNDS. At most `capBytes` of committed bytes across machines; past it, when a stream ends,
 * the least recently read Sessions go first — never one an open job holds — until the cache is
 * back under 80 % of the cap. A machine's directory goes when the machine does.
 */
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
  anchorOf,
  hiAnchorRange,
  loAnchorRange,
  parseHistoryFileKey,
} from "../services/history-wire.js";
import { LineCommitter, frameBytes } from "../socket/line-frames.js";

/** The on-disk format; a directory written by another one is wiped at start. */
export const TRACE_CACHE_FORMAT = 1;
/** How many committed bytes the cache keeps across machines (plan D1). */
export const TRACE_CACHE_CAP_BYTES = 1024 ** 3;
/** Eviction stops once the cache is back under this share of its cap. */
const EVICT_TO = 0.8;
/** Machine and Session ids become directory names: nothing else gets there. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const NEWLINE = 0x0a;
/** How much of a run one read of the record index takes at a time. */
const SCAN_CHUNK = 1024 * 1024;

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
  k: HistoryFileKey;
  ino: number;
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
  sidecar: Sidecar;
  dataPath: string;
  sidecarPath: string;
  committer: LineCommitter;
  /** The record offsets of each run, by its start; built on first read, dropped on commit. */
  index: Map<number, { starts: number[]; ends: number[] }> | null;
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

const runBytes = (runs: readonly Run[]): number =>
  runs.reduce((sum, run) => sum + run.end - run.start, 0);

const isMissing = (err: unknown): boolean => (err as NodeJS.ErrnoException)?.code === "ENOENT";

export interface TraceCacheOptions {
  /** Committed bytes kept across machines. */
  capBytes?: number;
  now?: () => number;
}

/** One record read back from the copy: the record, and where its line lies. */
export interface CachedRecord {
  record: AmspRecord;
  offset: number;
  end: number;
}

export class TraceCache {
  readonly #root: string;
  readonly #capBytes: number;
  readonly #now: () => number;
  /** Loaded files, by `<machineId>\0<k>`. */
  readonly #files = new Map<string, FileState>();
  /** Committed bytes and last read per Session directory (`<machineId>/<sessionId>`). */
  readonly #dirs = new Map<string, { bytes: number; lastReadAt: number }>();
  /** One write at a time per file. */
  readonly #chains = new Map<string, Promise<unknown>>();
  #opened: Promise<void> | null = null;

  constructor(root: string, options: TraceCacheOptions = {}) {
    this.#root = root;
    this.#capBytes = options.capBytes ?? TRACE_CACHE_CAP_BYTES;
    this.#now = options.now ?? Date.now;
  }

  /** The directory, checked and counted on first use (a server that reads no remote history writes nothing). */
  get #ready(): Promise<void> {
    this.#opened ??= this.#open();
    return this.#opened;
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
      await fs.rm(this.#root, { recursive: true, force: true });
      await fs.mkdir(this.#root, { recursive: true });
      await fs.writeFile(versionPath, `${TRACE_CACHE_FORMAT}\n`);
      return;
    }
    for (const machineId of await this.#list(this.#root)) {
      if (machineId === "VERSION" || !SAFE_ID.test(machineId)) continue;
      for (const sessionId of await this.#list(path.join(this.#root, machineId))) {
        if (!SAFE_ID.test(sessionId)) continue;
        const dir = path.join(this.#root, machineId, sessionId);
        const usage = { bytes: 0, lastReadAt: 0 };
        for (const name of await this.#list(dir)) {
          if (!name.endsWith(".jsonl.json")) continue;
          const sidecar = await this.#readSidecar(path.join(dir, name));
          if (sidecar === null) continue;
          usage.bytes += runBytes(sidecar.runs);
          usage.lastReadAt = Math.max(usage.lastReadAt, sidecar.lastReadAt);
        }
        this.#dirs.set(`${machineId}/${sessionId}`, usage);
      }
    }
  }

  async #list(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch (err) {
      // Nothing there, or a file where a directory was looked for (`VERSION` beside the machines).
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") return [];
      throw err;
    }
  }

  async #readSidecar(file: string): Promise<Sidecar | null> {
    try {
      const value = JSON.parse(await fs.readFile(file, "utf8")) as Sidecar;
      return value.version === TRACE_CACHE_FORMAT && Array.isArray(value.runs) ? value : null;
    } catch {
      return null;
    }
  }

  /** One cached file's state, loaded from its sidecar on first use; null when there is none (or `k` names none). */
  async #state(machineId: string, k: HistoryFileKey, create: boolean): Promise<FileState | null> {
    await this.#ready;
    const id = `${machineId}\0${k}`;
    const loaded = this.#files.get(id);
    if (loaded !== undefined) return loaded;
    const parsed = parseHistoryFileKey(k);
    if (parsed === null || !SAFE_ID.test(machineId) || !SAFE_ID.test(parsed.sessionId)) return null;
    const dataPath = path.join(
      this.#root,
      machineId,
      parsed.sessionId,
      `${String(parsed.fileIndex).padStart(3, "0")}.jsonl`,
    );
    const sidecarPath = `${dataPath}.json`;
    let sidecar = await this.#readSidecar(sidecarPath);
    if (sidecar !== null && sidecar.k !== k) sidecar = null;
    if (sidecar === null) {
      if (!create) return null;
      sidecar = {
        version: TRACE_CACHE_FORMAT,
        k,
        ino: 0,
        birthtimeMs: 0,
        size: 0,
        final: false,
        runs: [],
        lastReadAt: this.#now(),
      };
    }
    const state: FileState = {
      machineId,
      sessionId: parsed.sessionId,
      sidecar,
      dataPath,
      sidecarPath,
      committer: new LineCommitter(),
      index: null,
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
    await fs.mkdir(path.dirname(state.sidecarPath), { recursive: true });
    const tmp = `${state.sidecarPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state.sidecar));
    await fs.rename(tmp, state.sidecarPath);
  }

  #usage(machineId: string, sessionId: string): { bytes: number; lastReadAt: number } {
    const key = `${machineId}/${sessionId}`;
    let usage = this.#dirs.get(key);
    if (usage === undefined) {
      usage = { bytes: 0, lastReadAt: this.#now() };
      this.#dirs.set(key, usage);
    }
    return usage;
  }

  /** Forgets every byte of a file — its data, its runs, a held partial; its identity stays. */
  async #clear(state: FileState): Promise<void> {
    this.#usage(state.machineId, state.sessionId).bytes -= runBytes(state.sidecar.runs);
    state.sidecar.runs = [];
    state.committer = new LineCommitter();
    state.index = null;
    await fs.rm(state.dataPath, { force: true });
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
        await fs.rm(state.sidecarPath, { force: true });
        this.#files.delete(`${machineId}\0${state.sidecar.k}`);
      });
    }
    const sessions = new Set<string>();
    for (const fact of facts) {
      const state = await this.#state(machineId, fact.k, true);
      if (state === null) continue;
      sessions.add(state.sessionId);
      await this.#serial(state, async () => {
        const sidecar = state.sidecar;
        const moved = sidecar.ino !== fact.ino || sidecar.birthtimeMs !== fact.birthtimeMs;
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
    if (!SAFE_ID.test(machineId) || !SAFE_ID.test(sessionId)) return;
    const groupPath = path.join(this.#root, machineId, sessionId, "group.json");
    await fs.mkdir(path.dirname(groupPath), { recursive: true });
    await fs.writeFile(`${groupPath}.tmp`, JSON.stringify({ sessions: [...sessions] }));
    await fs.rename(`${groupPath}.tmp`, groupPath);
  }

  /** A Session and the descendants its last window read. */
  async groupSessions(machineId: string, sessionId: string): Promise<string[]> {
    await this.#ready;
    if (!SAFE_ID.test(machineId) || !SAFE_ID.test(sessionId)) return [];
    let listed: unknown = null;
    try {
      listed = (
        JSON.parse(
          await fs.readFile(path.join(this.#root, machineId, sessionId, "group.json"), "utf8"),
        ) as { sessions?: unknown }
      ).sessions;
    } catch {
      // No window read yet: the group is the Session alone.
    }
    const descendants = Array.isArray(listed)
      ? listed.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id))
      : [];
    return [sessionId, ...descendants.filter((id) => id !== sessionId)];
  }

  async #groupFiles(machineId: string, sessionId: string): Promise<FileState[]> {
    const out: FileState[] = [];
    for (const member of await this.groupSessions(machineId, sessionId)) {
      const dir = path.join(this.#root, machineId, member);
      for (const name of (await this.#list(dir)).sort()) {
        if (!name.endsWith(".jsonl.json")) continue;
        const sidecar = await this.#readSidecar(path.join(dir, name));
        if (sidecar === null) continue;
        const state = await this.#state(machineId, sidecar.k, false);
        if (state !== null) out.push(state);
      }
    }
    return out;
  }

  /**
   * What the hub holds of one Session group, as the machine's `have` takes it: per file the run
   * at the top of its copy, the anchors the machine checks it by, and a line held in part.
   */
  async have(machineId: string, sessionId: string): Promise<HistoryHave[]> {
    const out: HistoryHave[] = [];
    for (const state of await this.#groupFiles(machineId, sessionId)) {
      const entry = await this.#serial(state, () => this.#haveOf(state));
      if (entry !== null) out.push(entry);
    }
    return out;
  }

  async #haveOf(state: FileState): Promise<HistoryHave | null> {
    const top = state.sidecar.runs.at(-1);
    if (top === undefined) return null;
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
      const lines = state.committer.push(frame);
      if (lines === null) return 0;
      return this.#commitBytes(state, lines.off, frame.ord, lines.bytes);
    });
  }

  async #commitBytes(state: FileState, off: number, ord: number, bytes: Buffer): Promise<number> {
    if (bytes.length === 0 || bytes[bytes.length - 1] !== NEWLINE) return 0;
    const holes = holesIn(state.sidecar.runs, off, off + bytes.length);
    if (holes.length === 0) return 0;
    const lines = splitLines(bytes);
    await fs.mkdir(path.dirname(state.dataPath), { recursive: true });
    // `a` creates the file without truncating it; positioned writes then need `r+`.
    await (await fs.open(state.dataPath, "a")).close();
    const handle = await fs.open(state.dataPath, "r+");
    const added: Run[] = [];
    let committed = 0;
    try {
      for (const [from, to] of holes) {
        let ordinal = ord;
        let records = 0;
        for (const line of lines) {
          if (!line.record) continue;
          const at = off + line.start;
          if (at < from) ordinal += 1;
          else if (at < to) records += 1;
        }
        await handle.write(bytes, from - off, to - from, from);
        added.push({ start: from, end: to, ordinal, records });
        committed += to - from;
      }
    } finally {
      await handle.close();
    }
    for (const run of added) this.#insert(state, run);
    state.index = null;
    this.#usage(state.machineId, state.sessionId).bytes += committed;
    await this.#writeSidecar(state);
    return committed;
  }

  /**
   * Adds a run, merging it with the runs it touches. Runs that touch must agree on their
   * ordinals; runs that do not mean the file changed under the copy, and only the new run —
   * what the machine just sent — is kept.
   */
  #insert(state: FileState, run: Run): void {
    const runs = state.sidecar.runs;
    const left = runs.find((x) => x.end === run.start);
    const right = runs.find((x) => x.start === run.end);
    if (
      (left !== undefined && left.ordinal + left.records !== run.ordinal) ||
      (right !== undefined && run.ordinal + run.records !== right.ordinal)
    ) {
      this.#usage(state.machineId, state.sessionId).bytes -= runBytes(runs);
      state.sidecar.runs = [run];
      return;
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
    state.sidecar.runs = [...runs.filter((x) => x !== left && x !== right), merged].sort(
      (a, b) => a.start - b.start,
    );
  }

  /** Bytes `[start, end)` of a file's copy, or null unless every one of them is committed. */
  async bytes(
    machineId: string,
    k: HistoryFileKey,
    start: number,
    end: number,
  ): Promise<Buffer | null> {
    const state = await this.#state(machineId, k, false);
    if (state === null) return null;
    if (end <= start) return Buffer.alloc(0);
    const covered = state.sidecar.runs.some((run) => run.start <= start && end <= run.end);
    return covered ? this.#read(state, start, end) : null;
  }

  /** Records `[from, to)` of a file by ordinal, or null unless all of them are held. */
  async records(
    machineId: string,
    k: HistoryFileKey,
    from: number,
    to: number,
  ): Promise<CachedRecord[] | null> {
    const state = await this.#state(machineId, k, false);
    if (state === null || to <= from) return state === null ? null : [];
    const run = state.sidecar.runs.find((x) => x.ordinal <= from && to <= x.ordinal + x.records);
    if (run === undefined) return null;
    const offsets = await this.#runIndex(state, run);
    if (offsets === null) return null;
    const first = from - run.ordinal;
    const last = to - run.ordinal - 1;
    const bytes = await this.#read(state, offsets.starts[first]!, offsets.ends[last]!);
    if (bytes === null) return null;
    const base = offsets.starts[first]!;
    const out: CachedRecord[] = [];
    try {
      for (let i = first; i <= last; i++) {
        const offset = offsets.starts[i]!;
        const end = offsets.ends[i]!;
        const record = JSON.parse(bytes.toString("utf8", offset - base, end - base).trim());
        out.push({ record: record as AmspRecord, offset, end });
      }
    } catch {
      return null;
    }
    return out;
  }

  /** The record offsets of one run, scanned once and kept until the file's next commit. */
  async #runIndex(
    state: FileState,
    run: Run,
  ): Promise<{ starts: number[]; ends: number[] } | null> {
    state.index ??= new Map();
    const known = state.index.get(run.start);
    if (known !== undefined) return known;
    const starts: number[] = [];
    const ends: number[] = [];
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
    if (starts.length !== run.records) return null;
    const offsets = { starts, ends };
    state.index.set(run.start, offsets);
    return offsets;
  }

  /**
   * The record count of a file whose copy holds every byte the machine last said it has, or
   * null while it does not.
   */
  async wholeRecords(machineId: string, k: HistoryFileKey): Promise<number | null> {
    const state = await this.#state(machineId, k, false);
    if (state === null) return null;
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
      const file = parseHistoryFileKey(state.sidecar.k);
      if (
        state.machineId === machineId &&
        file?.sessionId === sessionId &&
        file.fileIndex === index
      ) {
        return state.sidecar.k;
      }
    }
    if (!SAFE_ID.test(machineId) || !SAFE_ID.test(sessionId)) return null;
    const name = `${String(index).padStart(3, "0")}.jsonl.json`;
    const sidecar = await this.#readSidecar(path.join(this.#root, machineId, sessionId, name));
    return sidecar?.k ?? null;
  }

  /** Forgets every byte held of one Session group: what it holds could not be read back. */
  async forget(machineId: string, sessionId: string): Promise<void> {
    for (const state of await this.#groupFiles(machineId, sessionId)) {
      await this.#serial(state, async () => {
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

  /**
   * When the cache is over its cap, evicts the least recently read Sessions until it is back
   * under 80 % of it; `held` (`<machineId>/<sessionId>`) are the ones open jobs use.
   */
  async evict(held: ReadonlySet<string>): Promise<void> {
    await this.#ready;
    let total = 0;
    for (const usage of this.#dirs.values()) total += usage.bytes;
    if (total <= this.#capBytes) return;
    const order = [...this.#dirs.entries()]
      .filter(([dir]) => !held.has(dir))
      .sort((a, b) => a[1].lastReadAt - b[1].lastReadAt);
    for (const [dir, usage] of order) {
      if (total <= this.#capBytes * EVICT_TO) break;
      const [machineId, sessionId] = dir.split("/") as [string, string];
      for (const [id, state] of this.#files) {
        if (state.machineId === machineId && state.sessionId === sessionId) this.#files.delete(id);
      }
      this.#dirs.delete(dir);
      await fs.rm(path.join(this.#root, machineId, sessionId), { recursive: true, force: true });
      total -= usage.bytes;
    }
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
    if (!SAFE_ID.test(machineId) || !(this.#opened !== null || (await this.#exists()))) return;
    await this.#ready;
    for (const [id, state] of this.#files)
      if (state.machineId === machineId) this.#files.delete(id);
    for (const dir of [...this.#dirs.keys()]) {
      if (dir.startsWith(`${machineId}/`)) this.#dirs.delete(dir);
    }
    await fs.rm(path.join(this.#root, machineId), { recursive: true, force: true });
  }

  /** Drops every machine's directory but those of `known` (run as the hub starts). */
  async dropUnknown(known: ReadonlySet<string>): Promise<void> {
    if (this.#opened === null && !(await this.#exists())) return;
    await this.#ready;
    for (const name of await this.#list(this.#root)) {
      if (name === "VERSION" || known.has(name)) continue;
      await this.dropMachine(name);
    }
  }
}
