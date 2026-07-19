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
import { appendFile, mkdir, readFile } from "node:fs/promises";
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
  return isCompleteModelMessage(msg) || isEventMessage(msg) || isSessionMeta(msg);
}

/**
 * append-only JSONL Trace writer.
 *
 * Single-writer scenario (MVP): concurrency safety isn't required, but every write uses
 * `appendFile` (O_APPEND) rather than caching a file handle and seeking to write, avoiding
 * overwriting existing content; this also removes the need for an explicit close.
 */
export class Writer {
  private readonly tracesDir: string;
  private readonly sessionId: string;
  private readonly dateDir: string;
  /** Current Trace index, starting at 1; incremented by `rotate()`. */
  private index = 1;
  /** Set true once the date directory has been created for the current file, to avoid a redundant mkdir. */
  private ensuredDirForIndex = -1;

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
   * Appends one message. Only written if it's a recordable message; streaming `partial_*` is
   * skipped. `mkdir -p`s the date directory on the first write to the current file.
   */
  async write(msg: OmniMessage): Promise<void> {
    if (!isRecordable(msg)) return;
    const path = this.currentPath();
    if (this.ensuredDirForIndex !== this.index) {
      await mkdir(dirname(path), { recursive: true });
      this.ensuredDirForIndex = this.index;
    }
    await appendFile(path, `${JSON.stringify(msg)}\n`, "utf8");
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
   * Docs: /docs/sessions-and-traces § "Trace design".
   */
  async rotate(): Promise<void> {
    this.index += 1;
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
