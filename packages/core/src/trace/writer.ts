/**
 * Trace writer — append-only JSON Lines.
 *
 * Docs: packages/docs/content/sessions-and-traces.{zh,en}.md (site path
 * /docs/sessions-and-traces) documents the file layout and recording rules.
 *
 * Design points:
 *   - Every observable action is appended to Trace; historical events are never modified in place
 *     (append-only).
 *   - One Trace file corresponds to one continuous run of a model context; when the context is
 *     compacted and a new segment is produced, `rotate()` starts a new, separately numbered file.
 *     `maxShardBytes` adds a second, independent reason to start a new file: a size ceiling, so
 *     a single very long session cannot grow one unbounded shard (readers pay per shard).
 *   - Only "recordable" messages are written: `session_meta`, complete `model_msg`, and all
 *     `event_msg`; streaming `partial_*` messages are skipped (the producer appends the
 *     corresponding complete message once the segment ends); nested child-session messages are
 *     never written (their spawn location is recorded via the `subagent` pointer event written by
 *     context_engine).
 *   - Path convention: `<tracesDir>/<yyyy-mm-dd>/<sessionId>_<index3>.jsonl`.
 */
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { isCompleteModelMessage, isEventMessage, isSessionMeta } from "../omnimessage/index.js";
import type { OmniMessage } from "../omnimessage/index.js";
import { formatLocalDate } from "../internal/dates.js";

export interface WriterOptions {
  /** Trace root directory, typically `<agent>/traces`. */
  tracesDir: string;
  /** Current Session id, written into the file name. */
  sessionId: string;
  /** The time used to derive the date subdirectory; defaults to `new Date()`. */
  date?: Date;
  /**
   * Directly specifies the date subdirectory name (used when Session resumption continues
   * writing to the original file: the Trace file follows the context, not the date); takes
   * priority over `date`.
   */
  dateDir?: string;
  /** Starting Trace index (used when Session resumption continues the original index); defaults to 1. */
  startIndex?: number;
  /**
   * Soft ceiling on one shard's size in bytes. A write that would push the current shard past
   * it lands in a NEW shard instead (the rotation happens *before* the record, so a record is
   * never split across files). Unset = no size-based rotation, the historical behaviour where
   * only compaction rotates.
   *
   * This is a bound on FILE SIZE, not on model context: a shard cut here still spans one
   * continuous context segment, it simply continues into the next numbered file. Readers already
   * concatenate a session's shards by index (see the server's Trace index), so the extra
   * boundaries are transparent to them.
   *
   * Why it matters: without a byte bound, one long-running session's single shard grows without
   * limit (42MB observed in the wild), and every whole-shard reader — the server's line index
   * build, `readTrace`-style full parses — pays for it on every open.
   *
   * A single record larger than the ceiling still gets a shard of its own rather than being
   * split: the ceiling is a soft target, never a correctness constraint.
   *
   * Defaults to 32 MiB (see DEFAULT_MAX_SHARD_BYTES), so a long session gets bounded shards
   * without every call site having to opt in; pass 0 to turn size-based rotation off, or set
   * `PENGUIN_TRACE_MAX_SHARD_BYTES` to change it deployment-wide.
   */
  maxShardBytes?: number;
}

/**
 * Default soft ceiling on one Trace shard: 32 MiB.
 *
 * Sized against what readers actually pay: the server's per-shard line index walks a shard once
 * to record byte offsets (a ~34MB shard measured ~2.5s to index), and a whole-shard parse costs
 * more still. 32 MiB keeps the worst case bounded while staying far above a normal session —
 * the largest shard observed before this ceiling existed was 42MB, i.e. one unusually long
 * session with no compaction; the median session's shards are single-digit MB.
 *
 * Override per deployment with `PENGUIN_TRACE_MAX_SHARD_BYTES` (a positive integer number of
 * bytes; `0` disables size-based rotation entirely, restoring compaction-only rotation).
 */
const DEFAULT_MAX_SHARD_BYTES = 32 * 1024 * 1024;

/** Resolves the effective size ceiling: explicit option first, then env, then the default. */
function resolveMaxShardBytes(explicit: number | undefined): number | undefined {
  if (explicit !== undefined) return explicit > 0 ? explicit : undefined;
  const raw = process.env.PENGUIN_TRACE_MAX_SHARD_BYTES;
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_SHARD_BYTES;
  const n = Number(raw);
  // An unparseable or non-positive value disables the ceiling rather than throwing: Trace
  // recording is best-effort by contract and must never fail a session over a bad env var.
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.floor(n);
}

/** Zero-pads a Trace index to 3 digits, e.g. 1 -> "001". */
function formatIndex(index: number): string {
  return index.toString().padStart(3, "0");
}

/**
 * Determines whether an OmniMessage should be written to Trace (skips streaming partial_* and nested child-session messages).
 *
 * Child-session messages are never written to this Trace: the child Session has its own complete
 * Trace, and recording it again would distort this Trace's statistics. The spawn location is
 * recorded via the `subagent` pointer event (recording only the child Session id) that
 * context_engine writes at the spawn site; when the session is reopened, the server uses this to
 * re-attach the child session to its corresponding run_subagent tool card.
 * Docs: /docs/sessions-and-traces § "Trace design".
 */
function isRecordable(msg: OmniMessage): boolean {
  if (msg.origin && msg.origin.length > 0) return false;
  return isCompleteModelMessage(msg) || isEventMessage(msg) || isSessionMeta(msg);
}

/**
 * append-only JSONL Trace writer.
 *
 * Every append opens the file with O_APPEND, issues **one** `write(2)` for the whole record,
 * and closes the handle — no cached handle, no seeking, so existing content can never be
 * overwritten. `fs.appendFile` is deliberately NOT used: it splits payloads larger than
 * 512 KiB into multiple underlying writes (Node's internal `kWriteFileMaxChunkSize`), so a
 * process death between chunks leaves exactly the first 524288 bytes of a big record (a huge
 * tool_call's arguments, a base64 image Data URL) on disk — and every record appended after
 * it glues onto that torn line, turning one crash into an unparseable line that swallows
 * later records too. A single-write append can only be cut short by the OS itself (power
 * loss, ENOSPC short write), which the tail-heal below and the readers' torn-tail tolerance
 * (parseTraceLines) are built for.
 *
 * Tail healing: before the first append this instance makes to a **pre-existing** shard file
 * (Session resumption continues the original file), the last byte is probed — a file not
 * ending in `\n` carries a crash-torn tail, and the next record is prefixed with `\n` so it
 * starts on a fresh line instead of merging into the torn one (the torn line itself is
 * skipped by the tolerant readers; the records after it stay readable). A mid-record append
 * failure inside this process (ENOSPC, forced short write) marks the tail torn and heals the
 * same way on the next append. A spurious heal costs one blank line, which every reader
 * ignores.
 *
 * Concurrency: one live Session has exactly one Writer instance, but that instance receives
 * appends from **multiple async producers in the same process** — the engine's LLM stream
 * driver and each parallel tool execution write independently (#215). All mutating operations
 * (`write`, `rotate`) are therefore serialized through one per-instance promise chain: each
 * record lands as one uninterrupted append, and a rotation cannot land in the middle of an
 * append. Cross-instance/file concurrency does not occur by design **within a single
 * server/CLI process**: a Session allows one active run at a time, child sessions write their
 * own files, and server-side Trace import only ever creates brand-new files (`wx`). Two
 * processes pointed at the same agent data directory are outside this contract (and outside
 * supported usage), though the single-write append keeps even that case tear-free on local
 * filesystems that make O_APPEND writes atomic.
 *
 * Error semantics: a failed operation rejects **that caller's** returned promise only; the
 * chain itself absorbs the failure so subsequent operations still run (a transient disk error
 * must not wedge Trace recording for the rest of the session). A **hung** append is different:
 * it blocks this instance's chain until it settles — deliberate head-of-line blocking, because
 * ordering cannot be preserved around an append whose outcome is still unknown. Callers
 * (context_engine, Session) already treat Trace writes as best-effort and log the surfaced
 * error.
 */
export class Writer {
  private readonly tracesDir: string;
  private readonly sessionId: string;
  private readonly dateDir: string;
  /** Current Trace index, starting at 1; incremented by `rotate()`. */
  private index = 1;
  /** Index whose file is prepared (date directory created, pre-existing tail probed); avoids redoing either per append. */
  private preparedIndex = -1;
  /** True while the current shard may end mid-record — assigned per shard by the tail probe, set by a mid-record append failure, cleared once a record fully lands. The next record then starts on a fresh line. */
  private tornTail = false;
  /** Bytes the current shard holds once the write completes (probed with the shard on prepare, then incremented per append). Only meaningful when `maxShardBytes` is set. */
  private shardBytes = 0;
  /** Serialization chain: mutating operations run strictly in submission order (see class docs). */
  private chain: Promise<void> = Promise.resolve();
  /** Size-based rotation ceiling in bytes; undefined = rotate only on compaction. Resolved once in the constructor (see WriterOptions). */
  private readonly maxShardBytes: number | undefined;

  constructor(opts: WriterOptions) {
    this.tracesDir = opts.tracesDir;
    this.sessionId = opts.sessionId;
    this.dateDir = opts.dateDir ?? formatLocalDate(opts.date ?? new Date());
    this.index = opts.startIndex ?? 1;
    this.maxShardBytes = resolveMaxShardBytes(opts.maxShardBytes);
  }

  /**
   * Whether `recordBytes` appended to the current shard would cross the ceiling, i.e. whether the
   * NEXT record must open a new shard. False with no ceiling configured (the default), and false
   * for an empty shard — otherwise a ceiling smaller than the first record would rotate forever
   * without ever writing anything.
   */
  private shouldRotateBefore(recordBytes: number): boolean {
    if (this.maxShardBytes === undefined || this.maxShardBytes <= 0) return false;
    if (this.shardBytes === 0) return false;
    return this.shardBytes + recordBytes > this.maxShardBytes;
  }

  /** Absolute path of the current Trace file. */
  currentPath(): string {
    const fileName = `${this.sessionId}_${formatIndex(this.index)}.jsonl`;
    return join(this.tracesDir, this.dateDir, fileName);
  }

  /**
   * Enqueues one mutating operation on the serialization chain. The returned promise settles
   * with that operation's own outcome (so a failure surfaces to its caller), while the chain
   * swallows the failure and proceeds with whatever was enqueued next.
   */
  private enqueue<T>(op: () => Promise<T>): Promise<T> {
    const result = this.chain.then(op);
    this.chain = result.then(
      () => undefined,
      () => undefined, // a failed operation must not wedge the chain
    );
    return result;
  }

  /**
   * Appends one message. Only written if it's a recordable message; streaming `partial_*` is
   * skipped. The first write to the current file `mkdir -p`s the date directory and probes a
   * pre-existing file for a crash-torn tail (see `probeTornTail`).
   *
   * The append is serialized on the instance chain, so the record lands as one uninterrupted
   * JSONL line even when other writes (or a rotation) are submitted concurrently; the target
   * path is resolved when the operation runs, so a write submitted after `rotate()` goes to
   * the new file. The returned promise resolves only after this record has been appended
   * (callers may rely on write-then-send ordering), and rejects if this append failed.
   */
  async write(msg: OmniMessage): Promise<void> {
    if (!isRecordable(msg)) return;
    return this.enqueue(async () => {
      if (this.preparedIndex !== this.index) await this.prepareCurrentShard();
      const record = `${JSON.stringify(msg)}\n`;
      const recordBytes = Buffer.byteLength(record, "utf8");
      // Size-based rotation: switch to the next index BEFORE the append, so the record lands
      // whole in one file. It runs on the same chain as the append itself (no nested enqueue —
      // that would await this very chain), which is what keeps the two ordered.
      if (this.shouldRotateBefore(recordBytes)) this.index += 1;
      if (this.preparedIndex !== this.index) await this.prepareCurrentShard();
      const path = this.currentPath();
      const payload = this.tornTail ? `\n${record}` : record;
      await this.appendRecord(path, payload);
      // The heal prefix is a byte on disk too: count it so the ceiling reflects real file size.
      this.shardBytes += Buffer.byteLength(payload, "utf8");
      this.tornTail = false; // the record (and any heal prefix) fully reached the file
    });
  }

  /**
   * Makes the current shard writable: creates its date directory and probes a pre-existing file
   * for a crash-torn tail AND its current size (the size seeds the size-based rotation ceiling,
   * so a session resumed into a large shard keeps rotating from where it actually is rather than
   * from zero). Per index, so this runs once per shard.
   */
  private async prepareCurrentShard(): Promise<void> {
    const path = this.currentPath();
    await mkdir(dirname(path), { recursive: true });
    const probed = await this.probeShard(path);
    this.tornTail = probed.torn;
    this.shardBytes = probed.bytes;
    this.preparedIndex = this.index;
  }

  /**
   * Whether a pre-existing shard file ends mid-record (resumption continues the original
   * file): a non-empty file whose last byte is not `\n` carries a crash-torn tail, and the
   * next append must not merge into that line. A missing or empty file is simply fresh; any
   * other probe error surfaces to the caller like an append failure (and is retried with the
   * next write, since the index stays unprepared).
   *
   * The probe also reports the file's current size, which seeds the size-based rotation ceiling.
   */
  private async probeShard(path: string): Promise<{ torn: boolean; bytes: number }> {
    let fh;
    try {
      fh = await open(path, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { torn: false, bytes: 0 };
      throw err;
    }
    try {
      const { size } = await fh.stat();
      if (size === 0) return { torn: false, bytes: 0 };
      const { bytesRead, buffer } = await fh.read(Buffer.alloc(1), 0, 1, size - 1);
      return { torn: bytesRead !== 1 || buffer[0] !== 0x0a, bytes: size };
    } finally {
      await fh.close();
    }
  }

  /**
   * Appends one record through a single `write(2)` on an O_APPEND handle (see the class docs
   * for why `appendFile`'s 512 KiB chunking is unacceptable here). The short-write loop is a
   * safety net only — one iteration is the norm; if a retry is ever needed and then fails,
   * part of the record is on disk, so the tail is marked torn for the next append to heal.
   */
  private async appendRecord(path: string, data: string): Promise<void> {
    const buf = Buffer.from(data, "utf8");
    const fh = await open(path, "a");
    try {
      let written = 0;
      while (written < buf.length) {
        let bytesWritten: number;
        try {
          ({ bytesWritten } = await fh.write(buf, written, buf.length - written));
        } catch (err) {
          if (written > 0) this.tornTail = true;
          throw err;
        }
        if (bytesWritten <= 0) {
          // A zero-progress write (out-of-space filesystems can report this instead of
          // throwing): bail out rather than loop forever.
          if (written > 0) this.tornTail = true;
          throw new Error(`Trace append made no progress at byte ${written} of ${buf.length}`);
        }
        written += bytesWritten;
      }
    } finally {
      await fh.close();
    }
  }

  /** Writes multiple messages in sequence. */
  async writeAll(msgs: OmniMessage[]): Promise<void> {
    for (const msg of msgs) {
      await this.write(msg);
    }
  }

  /**
   * Starts a new Trace file: increments the index, so the next `write` goes to the new file.
   * Used to split into a separate file when the context is compacted and a new context segment is produced.
   * Serialized on the instance chain: appends submitted before the rotation land in the old
   * file, appends submitted after it land in the new one — a rotation can never split a record.
   * Docs: /docs/sessions-and-traces § "Trace design".
   */
  async rotate(): Promise<void> {
    return this.enqueue(async () => {
      // No torn-tail / size bookkeeping here: the first write to the new index re-probes and
      // reassigns both, so the previous shard's state cannot leak into the next file.
      this.index += 1;
    });
  }
}

/** Parses a Trace file line by line (ignoring blank lines), for testing and later reads. */
export async function readTrace(path: string): Promise<OmniMessage[]> {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OmniMessage);
}
