/**
 * Trace writer — append-only JSON Lines.
 *
 * Docs: packages/docs/content/sessions-and-traces.{zh,en}.md (site path
 * /docs/sessions-and-traces) documents the file layout and recording rules.
 *
 * Design points:
 *   - Every observable action is appended to Trace; historical events are never modified in place
 *     (append-only).
 *   - One Trace file corresponds to one complete model context; when the context is compacted
 *     and a new segment is produced, `rotate()` starts a new, separately numbered file.
 *   - Only "recordable" messages are written: `session_meta`, complete `model_msg`, and all
 *     `event_msg`; streaming `partial_*` messages are skipped (the producer appends the
 *     corresponding complete message once the segment ends); nested child-session messages are
 *     never written (their spawn location is recorded via the `subagent` pointer event written by
 *     context_engine).
 *   - Path convention: `<tracesDir>/<yyyy-mm-dd>/<sessionId>_<index3>.jsonl`.
 */
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  PartialAggregator,
  isCompleteModelMessage,
  isEventMessage,
  isSessionMeta,
} from "../omnimessage/index.js";
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
  // compaction_delta is stream-only progress (like partial_*): the compaction request's
  // complete output is already recorded inside the compaction span, so persisting the
  // deltas would duplicate it — and history rebuild reconstructs the same text from the
  // span (see the Web reducer). Excluded here structurally so no writer path can leak it.
  if ((msg.payload as { type?: string }).type === "compaction_delta") return false;
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
  /** Serialization chain: mutating operations run strictly in submission order (see class docs). */
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: WriterOptions) {
    this.tracesDir = opts.tracesDir;
    this.sessionId = opts.sessionId;
    this.dateDir = opts.dateDir ?? formatLocalDate(opts.date ?? new Date());
    this.index = opts.startIndex ?? 1;
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
      const path = this.currentPath();
      if (this.preparedIndex !== this.index) {
        await mkdir(dirname(path), { recursive: true });
        this.tornTail = await this.probeTornTail(path);
        this.preparedIndex = this.index;
      }
      const record = `${JSON.stringify(msg)}\n`;
      await this.appendRecord(path, this.tornTail ? `\n${record}` : record);
      this.tornTail = false; // the record (and any heal prefix) fully reached the file
    });
  }

  /**
   * Whether a pre-existing shard file ends mid-record (resumption continues the original
   * file): a non-empty file whose last byte is not `\n` carries a crash-torn tail, and the
   * next append must not merge into that line. A missing or empty file is simply fresh; any
   * other probe error surfaces to the caller like an append failure (and is retried with the
   * next write, since the index stays unprepared).
   */
  private async probeTornTail(path: string): Promise<boolean> {
    let fh;
    try {
      fh = await open(path, "r");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
    try {
      const { size } = await fh.stat();
      if (size === 0) return false;
      const { bytesRead, buffer } = await fh.read(Buffer.alloc(1), 0, 1, size - 1);
      return bytesRead !== 1 || buffer[0] !== 0x0a;
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
   * Aggregates a message stream mixed with streaming `partial_*` into complete messages first,
   * then writes them per the `write` convention. A convenience helper: `write` skips partial_*
   * by default (the producer will already append the complete message), so this method is only
   * needed when reconstructing a complete context from raw streaming fragments.
   */
  async aggregateAndWrite(msgs: OmniMessage[]): Promise<void> {
    const agg = new PartialAggregator();
    for (const msg of msgs) {
      await this.writeAll(agg.push(msg));
    }
    await this.writeAll(agg.flush());
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
      // No torn-tail bookkeeping here: the first write to the new index re-probes and
      // reassigns the flag, so the previous shard's state cannot leak into the next file.
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
