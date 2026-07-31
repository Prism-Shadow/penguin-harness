/**
 * TruncatedToolOutputArchive — bounded, Session-scoped recovery for text that Environment cannot
 * place in the model-visible tool result because of maxOutputLength.
 *
 * The archive is deliberately not a second tool protocol, and this module is internal:
 * Environment constructs it from the generic `EnvironmentConfig.sessionScratchpadDir` rather
 * than taking a manager object through the public config surface. Environment returns the file
 * path in the same truncated tool result seen by the frontend and the model; the model can then
 * use the existing file tools to inspect it. Files live in the Session scratchpad and are removed
 * by the host's existing Session-deletion path together with the rest of that scratchpad.
 *
 * Files are written only after a call actually exceeds maxOutputLength. A capture retains at
 * most one file's budget while the tool is streaming, then writes one UTF-8 .log file with mode
 * 0600. Small archives are exact. If a single call exceeds the per-file budget, the file keeps
 * bounded head/tail windows with an explicit gap marker.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { READ_FILE_SCAN_CAP_BYTES } from "./tools/read-file.js";

/**
 * Maximum stored bytes for one truncated tool call. One byte of headroom below read_file's
 * 8 MiB scan cap lets that tool perform its final zero-byte read and confirm EOF.
 */
export const TRUNCATED_TOOL_OUTPUT_FILE_LIMIT_BYTES = READ_FILE_SCAN_CAP_BYTES - 1;

const ARCHIVE_GAP_MARKER = "\n[archive middle truncated]\n";
const ARCHIVE_GAP_MARKER_BYTES = Buffer.byteLength(ARCHIVE_GAP_MARKER);

export type TruncatedToolOutputArchiveSaveResult =
  | {
      status: "saved";
      path: string;
      archiveTruncated: boolean;
    }
  | { status: "failed"; code: string };

interface TruncatedToolOutputArchiveOptions {
  rootDir: string;
  /** Test-only override; production and public SDK composition use the fixed default. */
  fileLimitBytes?: number;
}

/**
 * Copies one byte range into a dedicated Buffer. Using Buffer.subarray directly would retain
 * the source's entire backing ArrayBuffer, defeating the capture's memory bound.
 */
function copyBufferRange(buffer: Buffer, start: number, end: number): Buffer {
  const result = Buffer.alloc(Math.max(0, end - start));
  buffer.copy(result, 0, start, end);
  return result;
}

/**
 * Copies a UTF-8-safe Buffer prefix. Moving a cut inside a multi-byte code point back to its
 * leading byte excludes that partial character rather than writing U+FFFD.
 */
function utf8BufferPrefix(buffer: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0 || buffer.length === 0) return Buffer.alloc(0);
  if (buffer.length <= maxBytes) return copyBufferRange(buffer, 0, buffer.length);
  let cut = maxBytes;
  while (cut > 0 && (buffer[cut]! & 0xc0) === 0x80) cut -= 1;
  return copyBufferRange(buffer, 0, cut);
}

/** Copies a UTF-8-safe Buffer suffix whose encoded size does not exceed maxBytes. */
function utf8BufferSuffix(buffer: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0 || buffer.length === 0) return Buffer.alloc(0);
  if (buffer.length <= maxBytes) return copyBufferRange(buffer, 0, buffer.length);
  let start = buffer.length - maxBytes;
  while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
  return copyBufferRange(buffer, start, buffer.length);
}

/**
 * Encodes only a bounded string prefix before applying the byte cap. One UTF-16 code unit
 * contributes at least one UTF-8 byte, so maxBytes (+ one paired surrogate) is sufficient to
 * find the complete prefix without ever encoding an unbounded input delta.
 */
function utf8Prefix(text: string, maxBytes: number): Buffer {
  if (maxBytes <= 0 || text.length === 0) return Buffer.alloc(0);
  let end = Math.min(text.length, maxBytes);
  if (
    end < text.length &&
    end > 0 &&
    text.charCodeAt(end - 1) >= 0xd800 &&
    text.charCodeAt(end - 1) <= 0xdbff &&
    text.charCodeAt(end) >= 0xdc00 &&
    text.charCodeAt(end) <= 0xdfff
  ) {
    end += 1;
  }
  return utf8BufferPrefix(Buffer.from(text.slice(0, end), "utf8"), maxBytes);
}

/** Encodes only a bounded string suffix, preserving a surrogate pair at the slice boundary. */
function utf8Suffix(text: string, maxBytes: number): Buffer {
  if (maxBytes <= 0 || text.length === 0) return Buffer.alloc(0);
  let start = Math.max(0, text.length - maxBytes);
  if (
    start > 0 &&
    text.charCodeAt(start) >= 0xdc00 &&
    text.charCodeAt(start) <= 0xdfff &&
    text.charCodeAt(start - 1) >= 0xd800 &&
    text.charCodeAt(start - 1) <= 0xdbff
  ) {
    start -= 1;
  }
  return utf8BufferSuffix(Buffer.from(text.slice(start), "utf8"), maxBytes);
}

/**
 * One bounded capture. Each capture independently enforces the per-file memory and disk limit.
 */
export class TruncatedToolOutputCapture {
  private exactChunks: Buffer[] = [];
  private exactBytes = 0;
  private head: Buffer = Buffer.alloc(0);
  /** Fixed-capacity ring storage for the rolling UTF-8 tail after promotion. */
  private tail: Buffer = Buffer.alloc(0);
  private tailStart = 0;
  private tailLength = 0;
  private archiveTruncated = false;
  private settled = false;
  /** A streamed JS string may split one UTF-16 surrogate pair across deltas. */
  private pendingHighSurrogate = "";

  constructor(
    private readonly owner: TruncatedToolOutputArchive,
    private readonly fileLimitBytes: number,
  ) {}

  /** Appends the exact text delta produced by the tool before Environment truncates it. */
  append(text: string): void {
    if (this.settled || text.length === 0) return;
    if (this.pendingHighSurrogate) {
      const pending = this.pendingHighSurrogate;
      this.pendingHighSurrogate = "";
      const first = text.charCodeAt(0);
      if (first >= 0xdc00 && first <= 0xdfff) {
        // Join only the actual pair, not the whole new delta: concatenating a one-character
        // pending surrogate with an arbitrarily large delta would create an unbounded copy.
        this.appendStable(pending + text.slice(0, 1));
        text = text.slice(1);
        if (text.length === 0) return;
      } else {
        // The pending high surrogate is now known to be lone. Keep the current delta untouched:
        // its own final high surrogate may still pair with the following delta.
        this.appendStable(pending);
      }
    }
    const last = text.charCodeAt(text.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) {
      this.pendingHighSurrogate = text.slice(-1);
      text = text.slice(0, -1);
    }
    if (text.length === 0) return;
    this.appendStable(text);
  }

  private appendStable(text: string): void {
    const chunkBytes = Buffer.byteLength(text, "utf8");

    if (!this.archiveTruncated) {
      if (this.exactBytes + chunkBytes <= this.fileLimitBytes) {
        // Keep this encoding inside the accepted branch. Moving Buffer.from above the size
        // guard would allocate an unbounded Buffer for one huge delta before rejecting it.
        // append() also guarantees no chunk boundary can split a still-pairable surrogate:
        // paired halves are joined first, while confirmed lone surrogates intentionally encode
        // as U+FFFD (guarded by the cross-delta Unicode test).
        this.exactChunks.push(Buffer.from(text, "utf8"));
        this.exactBytes += chunkBytes;
        return;
      }
      this.archiveTruncated = true;
      this.promoteToHeadTail(text, chunkBytes);
      return;
    }

    this.appendTail(text, chunkBytes);
  }

  /** Replaces the capture basis (used only by the compatibility full-message tool path). */
  replace(text: string): void {
    if (this.settled) return;
    this.exactChunks = [];
    this.exactBytes = 0;
    this.head = Buffer.alloc(0);
    this.tail = Buffer.alloc(0);
    this.tailStart = 0;
    this.tailLength = 0;
    this.archiveTruncated = false;
    this.pendingHighSurrogate = "";
    this.append(text);
  }

  /** Writes this single-use capture to the Session archive directory. */
  async save(toolName: string, toolCallId: string): Promise<TruncatedToolOutputArchiveSaveResult> {
    if (this.settled) return { status: "failed", code: "ALREADY_SAVED" };
    if (this.pendingHighSurrogate) {
      const pending = this.pendingHighSurrogate;
      this.pendingHighSurrogate = "";
      // A truly lone high surrogate has no direct UTF-8 representation; Node's UTF-8 encoder
      // serializes it as U+FFFD, which is the same behavior writeFile(text, "utf8") would use.
      this.appendStable(pending);
    }
    this.settled = true;
    const data = this.serialized();
    return this.owner.commit(toolName, toolCallId, data, this.archiveTruncated);
  }

  /** Discards an unfinished in-memory capture without writing a file. */
  cancel(): void {
    if (this.settled) return;
    this.settled = true;
  }

  private promoteToHeadTail(text: string, chunkBytes: number): void {
    const contentBudget = Math.max(0, this.fileLimitBytes - ARCHIVE_GAP_MARKER_BYTES);
    const headBudget = Math.floor(contentBudget / 2);
    const tailBudget = contentBudget - headBudget;
    const exact = Buffer.concat(this.exactChunks);

    this.head =
      this.exactBytes >= headBudget
        ? utf8BufferPrefix(exact, headBudget)
        : Buffer.concat([exact, utf8Prefix(text, headBudget - this.exactBytes)]);
    const initialTail =
      chunkBytes >= tailBudget
        ? utf8Suffix(text, tailBudget)
        : Buffer.concat([
            utf8BufferSuffix(exact, tailBudget - chunkBytes),
            Buffer.from(text, "utf8"),
          ]);
    this.resetTail(initialTail, tailBudget);
    this.exactChunks = [];
    this.exactBytes = 0;
  }

  /**
   * Appends one stable delta to the rolling tail without rebuilding the retained window.
   * Encoding remains below the tail budget: a delta at least that large takes the bounded
   * string-suffix path instead of allocating a Buffer for the whole delta.
   */
  private appendTail(text: string, chunkBytes: number): void {
    const tailBudget = this.tailBudget();
    if (tailBudget <= 0) {
      this.resetTail(Buffer.alloc(0), 0);
      return;
    }
    if (chunkBytes >= tailBudget) {
      this.resetTail(utf8Suffix(text, tailBudget), tailBudget);
      return;
    }

    const chunk = Buffer.from(text, "utf8");
    const overflow = Math.max(0, this.tailLength + chunk.length - tailBudget);
    this.tailStart = (this.tailStart + overflow) % tailBudget;
    const nextLength = Math.min(tailBudget, this.tailLength + chunk.length);
    const writeStart = (this.tailStart + nextLength - chunk.length) % tailBudget;
    const firstLength = Math.min(chunk.length, tailBudget - writeStart);
    chunk.copy(this.tail, writeStart, 0, firstLength);
    if (firstLength < chunk.length) {
      chunk.copy(this.tail, 0, firstLength);
    }
    this.tailLength = nextLength;
  }

  /** Reinitializes the rolling tail from one already-bounded, code-point-aligned suffix. */
  private resetTail(buffer: Buffer, tailBudget: number): void {
    if (tailBudget <= 0) {
      this.tail = Buffer.alloc(0);
      this.tailStart = 0;
      this.tailLength = 0;
      return;
    }
    this.tail = Buffer.allocUnsafe(tailBudget);
    buffer.copy(this.tail);
    this.tailStart = 0;
    this.tailLength = buffer.length;
  }

  private tailBudget(): number {
    const contentBudget = Math.max(0, this.fileLimitBytes - ARCHIVE_GAP_MARKER_BYTES);
    return contentBudget - Math.floor(contentBudget / 2);
  }

  /** Copies the logical ring suffix once, dropping a leading partial UTF-8 code point. */
  private serializedTail(): Buffer {
    if (this.tailLength === 0) return Buffer.alloc(0);
    const capacity = this.tail.length;
    let skip = 0;
    while (
      skip < this.tailLength &&
      (this.tail[(this.tailStart + skip) % capacity]! & 0xc0) === 0x80
    ) {
      skip += 1;
    }
    const length = this.tailLength - skip;
    const result = Buffer.allocUnsafe(length);
    const readStart = (this.tailStart + skip) % capacity;
    const firstLength = Math.min(length, capacity - readStart);
    this.tail.copy(result, 0, readStart, readStart + firstLength);
    if (firstLength < length) {
      this.tail.copy(result, firstLength, 0, length - firstLength);
    }
    return result;
  }

  private serialized(): Buffer {
    if (!this.archiveTruncated) return Buffer.concat(this.exactChunks);
    return Buffer.concat([
      this.head,
      Buffer.from(ARCHIVE_GAP_MARKER, "utf8"),
      this.serializedTail(),
    ]);
  }
}

export class TruncatedToolOutputArchive {
  private readonly rootDir: string;
  private readonly fileLimitBytes: number;

  constructor(opts: TruncatedToolOutputArchiveOptions) {
    // The explicit gap marker is part of every bounded head/tail archive, so even internal
    // test overrides must leave enough room for it; production stays just below 8 MiB.
    this.fileLimitBytes = Math.max(
      ARCHIVE_GAP_MARKER_BYTES,
      opts.fileLimitBytes ?? TRUNCATED_TOOL_OUTPUT_FILE_LIMIT_BYTES,
    );
    this.rootDir = opts.rootDir;
  }

  /** Starts one independently bounded capture; the directory remains lazy until save(). */
  startCapture(): TruncatedToolOutputCapture {
    return new TruncatedToolOutputCapture(this, this.fileLimitBytes);
  }

  /** Internal commit path used by TruncatedToolOutputCapture. */
  async commit(
    toolName: string,
    toolCallId: string,
    data: Buffer,
    archiveTruncated: boolean,
  ): Promise<TruncatedToolOutputArchiveSaveResult> {
    const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "tool";
    const idHash = createHash("sha256").update(toolCallId).digest("hex").slice(0, 16);
    const filePath = path.join(this.rootDir, `${safeToolName}-${idHash}.log`);
    try {
      // Create shared Session ancestors with their existing/default policy, then apply the
      // archive's private directory mode only to the archive directory itself.
      await mkdir(path.dirname(this.rootDir), { recursive: true });
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      await writeFile(filePath, data, { flag: "wx", mode: 0o600 });
      return {
        status: "saved",
        path: filePath,
        archiveTruncated,
      };
    } catch (err) {
      const rawCode = (err as { code?: unknown }).code;
      const code = typeof rawCode === "string" ? rawCode : "UNKNOWN";
      process.stderr.write(
        `[penguin] tool "${toolName}" truncated output archive write failed (${code}).\n`,
      );
      return { status: "failed", code };
    }
  }
}
