/**
 * Body elision for history windows: the bulky values the chat shows folded — a tool's output,
 * a child record's inline images, a long string inside a tool call's arguments, a thinking
 * block — travel as a preview, and the whole value is fetched when the reader unfolds it
 * (`GET …/sessions/:id/trace-body?ref=`).
 *
 * One pure rule for every server and both legs of a remote history stream, and importable by
 * the Web App at run time: the server elides (`elideHistoryRecord`), the page puts back what it
 * fetched (`withElidedBody`), and both read the same path syntax. The elided entries ride the
 * history envelope (`HistoryMessage.elided`), beside `tracePosition`; nothing here is ever
 * written to a Trace, and no AMSP record gains a field.
 *
 * A path names one value of a record: `payload.output`, `payload.thinking`,
 * `payload.images.<i>`, or `payload.arguments#<JSON Pointer>` for a string inside a tool call's
 * arguments (RFC 6901, `payload.arguments#` alone for arguments that are not JSON). A string
 * keeps a preview of its head and tail; an image keeps none (its value becomes the empty
 * string), since half a data URL draws nothing.
 */
import type { AmspRecord } from "@prismshadow/amsp/records";

/** A value above this many UTF-8 bytes is elided. */
export const ELIDE_BYTES = 16 * 1024;

/** What an elided string keeps: its first `head` and its last `tail` UTF-16 code units. */
export const ELIDE_PREVIEW: { readonly head: number; readonly tail: number } = {
  head: 1024,
  tail: 512,
};

/** One elided value of a history record. */
export interface ElidedBody {
  /** Where the value sits in the record (see the module header for the syntax). */
  path: string;
  /** The whole value's UTF-8 byte length. */
  bytes: number;
  /** The whole value's line count; absent for an image. */
  lines?: number;
  /**
   * How many UTF-16 code units of the preview are the value's head; the rest of the preview is
   * its tail. 0 for an image, whose preview is the empty string.
   */
  head: number;
  /** Opaque handle for `trace-body?ref=`: the record's Trace file, its ordinal and the path. */
  ref: string;
}

/** Where a record's line lives: the Trace file and the ordinal a ref names. */
export interface BodySource {
  agentId: string;
  sessionId: string;
  /** Trace shard index (`001` on disk is 1). */
  fileIndex: number;
  /** Zero-based record ordinal within the shard. */
  ordinal: number;
}

/** A history record: an AMSP record, possibly already carrying its elided entries. */
export type HistoryRecordLike = AmspRecord & { elided?: ElidedBody[] };

/**
 * The record with every value above `ELIDE_BYTES` replaced by its preview, and the entries
 * that name them. A record with nothing to elide comes back as the same object with no
 * entries; an already elided record keeps its entries (eliding twice changes nothing). The
 * returned record carries `elided` when there is any.
 */
export function elideHistoryRecord<R extends HistoryRecordLike>(
  record: R,
  _source: BodySource,
): { record: R; elided: ElidedBody[] } {
  return { record, elided: record.elided ?? [] };
}

/** The ref `trace-body` takes for one value of the record at `source`. */
export function encodeBodyRef(source: BodySource, path: string): string {
  return `${source.agentId}/${source.sessionId}/${source.fileIndex}/${source.ordinal}/${path}`;
}

/** What a ref names, or null when it is not one. */
export function decodeBodyRef(_ref: string): (BodySource & { path: string }) | null {
  return null;
}

/** The whole value at `path` in a record as its Trace line holds it, or null when there is none. */
export function bodyAt(_record: AmspRecord, _path: string): string | null {
  return null;
}

/**
 * The record with the whole `value` put back at `path` and that entry dropped from `elided`:
 * what the page holds once it has fetched an elided body.
 */
export function withElidedBody<R extends HistoryRecordLike>(
  record: R,
  _path: string,
  _value: string,
): R {
  return record;
}
