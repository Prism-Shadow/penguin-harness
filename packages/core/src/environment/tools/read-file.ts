/**
 * read_file — text-file reading tool, a builtin tool implementation (BuiltinTool).
 *
 * Reads a text file and returns it in `cat -n` style (line number, tab, content), so the
 * model can quote exact lines back to edit_file. Relative paths resolve against the
 * Workspace; absolute paths are allowed (tools run with the user's full permissions, same
 * as the shell tool). An optional 1-based `offset` and a `limit` (default 2000 lines) form
 * a window for paging through long files.
 *
 * Robustness properties:
 * - **Bounded read**: the file is scanned incrementally through a file handle, never loaded
 *   whole — a multi-GB log cannot balloon the process. A hard scan cap (8MB) turns
 *   pathological requests (offsets deeper than the cap, files with no newlines) into a
 *   clean failure with guidance; a window that already produced lines when the cap hits is
 *   returned as a partial result with a lower-bound line count instead.
 * - **Self-budgeted output**: the rendered window is trimmed to the tool's own
 *   maxOutputLength before Environment's front-keep truncation could cut the trailing
 *   continuation note — the note (and the shown range it reports) always survives.
 * - Overlong single lines are truncated with a marker; CRLF files display without the `\r`
 *   and get an explicit note; binary content (NUL bytes) is rejected with advice; the
 *   secret stores (.vault.toml / .project_config.toml) are refused outright.
 *
 * Division of responsibility with Environment (see environment.ts): non-streaming — yields
 * the whole numbered listing as one delta; failures (missing file, directory, binary
 * content, scan cap) are explanatory text finalized as `failed`; anything unexpected that
 * still throws is caught by Environment and likewise finalized as failed. If interrupted,
 * only reports `aborted` — the interruption note is appended by Environment.
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { open, realpath, stat } from "node:fs/promises";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const READ_FILE_NAME = "read_file";

/** Default max number of lines returned per call (overridable via the `limit` argument). */
export const DEFAULT_READ_FILE_LIMIT = 2000;

/** Max characters kept of a single line; the rest is replaced by a truncation marker. */
export const MAX_LINE_LENGTH = 2000;

/** Hard cap on bytes scanned per call: beyond it the tool stops instead of grinding through a huge file. */
export const READ_FILE_SCAN_CAP_BYTES = 8 * 1024 * 1024;

/** Bytes read per file-handle read (scan granularity; also the abort-signal check interval). */
const CHUNK_BYTES = 256 * 1024;

/** Per-line byte retention cap: at 4 bytes/char worst-case UTF-8 this always decodes to >= MAX_LINE_LENGTH chars, so char truncation stays exact. */
const LINE_BYTE_CAP = MAX_LINE_LENGTH * 4;

/** Output-budget headroom reserved for the trailing notes (continuation / CRLF), so they survive self-budget trimming. */
const NOTE_RESERVE = 256;

/** Fallback output budget when the definition carries no maxOutputLength (mirrors the default config entry). */
const DEFAULT_OUTPUT_BUDGET = 64000;

/**
 * Secret stores the system prompt bans the model from reading; read_file refuses them by
 * basename regardless of directory. The tool needs its own guard because `permission: "r"`
 * makes it auto-approved under read-only approval (the shell tool stays rw-gated).
 */
const SECRET_BASENAMES = new Set([".vault.toml", ".project_config.toml"]);

/**
 * The secret-store name a path hits, or null. Checks the LOWERCASED basename of both the
 * lexical path and its realpath: a case-insensitive filesystem (macOS/Windows) opens
 * ".VAULT.TOML" as .vault.toml, and a symlink's own name says nothing about what it
 * dereferences to — either would slip past a plain case-sensitive basename check. On a
 * case-sensitive filesystem the lowercase compare can refuse a differently-cased sibling
 * that is NOT the secret store; for a guard, that false positive is the right trade.
 */
async function secretStoreHit(resolved: string): Promise<string | null> {
  let target = resolved;
  try {
    target = await realpath(resolved);
  } catch {
    // Missing file / permission error: the lexical name is still checked below, and the
    // read path reports the real error afterwards.
  }
  for (const name of [path.basename(resolved), path.basename(target)]) {
    const lower = name.toLowerCase();
    if (SECRET_BASENAMES.has(lower)) return lower;
  }
  return null;
}

/** Renders one `cat -n` style line: 6-column right-aligned line number, tab, content. */
export function numberedLine(lineNo: number, content: string): string {
  const capped =
    content.length > MAX_LINE_LENGTH
      ? `${content.slice(0, MAX_LINE_LENGTH)}… [line truncated]`
      : content;
  return `${String(lineNo).padStart(6)}\t${capped}`;
}

/** Coerces a count argument (offset/limit): numbers and numeric strings are accepted; anything else is rejected. */
function coerceCount(
  value: unknown,
  fallback: number,
): { ok: true; value: number } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: fallback };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ok: true, value: Math.floor(value) };
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    if (Number.isFinite(n)) return { ok: true, value: Math.floor(n) };
  }
  return { ok: false };
}

/** Result of the bounded window scan. */
interface ScanOutcome {
  /** Decoded window lines (trailing \r already stripped), in order starting at `offset`. */
  lines: string[];
  /** Total line count — exact when `totalKnown`, otherwise a lower bound (lines seen before the scan cap). */
  total: number;
  totalKnown: boolean;
  /** Whether any CRLF (\r\n) line ending was seen in the scanned range. */
  sawCRLF: boolean;
  /** Whether a NUL byte was seen (binary content). */
  binary: boolean;
  /** Scan cap hit before the window produced any line: the request cannot be served. */
  capBeforeWindow: boolean;
  aborted: boolean;
}

/**
 * Incremental windowed scan: reads the file in chunks through a file handle, splitting on
 * `\n` at the byte level (always safe in UTF-8), storing only lines inside
 * [offset, offset+limit-1] (each retained up to LINE_BYTE_CAP bytes) and counting the rest.
 * After the window fills, it keeps counting lines until EOF or the scan cap so the
 * continuation note can report an exact total when cheap and a lower bound otherwise.
 */
async function scanWindow(
  filePath: string,
  offset: number,
  limit: number,
  signal?: AbortSignal,
): Promise<ScanOutcome> {
  const end = offset + limit - 1;
  const out: ScanOutcome = {
    lines: [],
    total: 0,
    totalKnown: false,
    sawCRLF: false,
    binary: false,
    capBeforeWindow: false,
    aborted: false,
  };
  let completedLines = 0; // Lines terminated by \n so far
  let currentHasBytes = false; // Whether the in-progress line has any content
  let currentParts: Buffer[] = []; // Retained bytes of the in-progress line (window lines only)
  let currentBytes = 0;
  let scanned = 0;

  const inWindow = (): boolean => completedLines + 1 >= offset && completedLines + 1 <= end;

  const appendRun = (buf: Buffer, from: number, to: number): void => {
    if (currentBytes >= LINE_BYTE_CAP) return; // Overlong line: keep only the head (display truncates anyway)
    const take = Math.min(LINE_BYTE_CAP - currentBytes, to - from);
    currentParts.push(Buffer.from(buf.subarray(from, from + take)));
    currentBytes += take;
  };

  const finishLine = (): void => {
    if (inWindow()) {
      let text = Buffer.concat(currentParts).toString("utf8");
      if (text.endsWith("\r")) text = text.slice(0, -1);
      out.lines.push(text);
    }
    completedLines += 1;
    currentParts = [];
    currentBytes = 0;
    currentHasBytes = false;
  };

  const fd = await open(filePath, "r");
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let prevByte = -1; // For CRLF detection across chunk boundaries
    for (;;) {
      if (signal?.aborted) {
        out.aborted = true;
        return out;
      }
      const toRead = Math.min(CHUNK_BYTES, READ_FILE_SCAN_CAP_BYTES - scanned);
      if (toRead <= 0) {
        // Scan cap: with no window line produced the request cannot be served (fails with
        // guidance); with a partial window, return it plus a lower-bound total.
        out.capBeforeWindow = out.lines.length === 0;
        out.total = completedLines + (currentHasBytes ? 1 : 0);
        return out;
      }
      const { bytesRead } = await fd.read(chunk, 0, toRead, scanned);
      if (bytesRead === 0) {
        // EOF: a final line without a trailing newline still counts.
        if (currentHasBytes) finishLine();
        out.total = completedLines;
        out.totalKnown = true;
        return out;
      }
      scanned += bytesRead;
      let from = 0;
      for (let i = 0; i < bytesRead; i += 1) {
        const b = chunk[i]!;
        if (b === 0) {
          out.binary = true;
          return out;
        }
        if (b === 0x0a) {
          if (prevByte === 0x0d) out.sawCRLF = true;
          if (i > from) {
            currentHasBytes = true;
            if (inWindow()) appendRun(chunk, from, i);
          }
          finishLine();
          from = i + 1;
        }
        prevByte = b;
      }
      if (from < bytesRead) {
        currentHasBytes = true;
        if (inWindow()) appendRun(chunk, from, bytesRead);
      }
    }
  } finally {
    await fd.close();
  }
}

/**
 * read_file builtin tool: resolves the path against the Workspace, validates it is a
 * readable text file, and outputs the requested line window with line numbers.
 * `definition` is overridden by Environment at construction time with the same-named entry
 * from ToolConfig (description/arguments/permissions/limits).
 */
export function createReadFileTool(definition: ToolDefinitionConfig): BuiltinTool {
  return {
    name: definition.name,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      const filePath = args["file_path"];
      if (typeof filePath !== "string" || filePath.length === 0) {
        yield delta(`Missing required argument "file_path" for ${definition.name}.`);
        return { stopReason: "failed" };
      }
      const offsetArg = coerceCount(args["offset"], 1);
      if (!offsetArg.ok) {
        yield delta(`Invalid "offset": expected a number (got ${JSON.stringify(args["offset"])}).`);
        return { stopReason: "failed" };
      }
      const offset = Math.max(1, offsetArg.value);
      const limitArg = coerceCount(args["limit"], DEFAULT_READ_FILE_LIMIT);
      if (!limitArg.ok || limitArg.value <= 0) {
        yield delta(
          `Invalid "limit": expected a positive number (got ${JSON.stringify(args["limit"])}).`,
        );
        return { stopReason: "failed" };
      }
      const limit = limitArg.value;

      const resolved = path.resolve(ctx.workspaceDir, filePath);
      // Secret stores are refused by name: read_file is auto-approved under read-only
      // approval, so it needs its own guard (aligned with the system prompt's ban).
      // secretStoreHit resolves symlinks and compares case-insensitively — the lexical
      // basename alone is bypassable via ".VAULT.TOML" (case-insensitive filesystems) or
      // a symlink pointing at the store.
      const secretHit = await secretStoreHit(resolved);
      if (secretHit !== null) {
        yield delta(
          `Refusing to read "${filePath}": ${secretHit} holds the user's secrets and must never enter the conversation.`,
        );
        return { stopReason: "failed" };
      }

      let size: number;
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(
            `Cannot read "${filePath}": it is a directory. Pass the path of a file inside it.`,
          );
          return { stopReason: "failed" };
        }
        size = st.size;
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          yield delta(
            `File not found: "${filePath}". Check the path — relative paths resolve against the workspace (${ctx.workspaceDir}).`,
          );
        } else {
          const message = err instanceof Error ? err.message : String(err);
          yield delta(`Failed to read "${filePath}": ${message}`);
        }
        return { stopReason: "failed" };
      }
      if (signal?.aborted) return { stopReason: "aborted" };
      if (size === 0) {
        yield delta(`"${filePath}" is an empty file (0 lines).`);
        return;
      }

      let scan: ScanOutcome;
      try {
        scan = await scanWindow(resolved, offset, limit, signal);
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`Failed to read "${filePath}": ${message}`);
        return { stopReason: "failed" };
      }
      if (scan.aborted || signal?.aborted) return { stopReason: "aborted" };
      if (scan.binary) {
        yield delta(
          `"${filePath}" looks like a binary file (contains NUL bytes). Use shell commands to inspect it, or read_image if it is an image.`,
        );
        return { stopReason: "failed" };
      }
      if (scan.capBeforeWindow) {
        const mb = Math.round(READ_FILE_SCAN_CAP_BYTES / (1024 * 1024));
        yield delta(
          `Stopped after scanning ${mb} MB of "${filePath}" without reaching the requested window ` +
            `(scanned ${scan.total} line${scan.total === 1 ? "" : "s"}). The offset is too deep or the file has extremely long ` +
            `lines — use shell commands (e.g. sed -n '${offset},${offset + limit - 1}p') for this file.`,
        );
        return { stopReason: "failed" };
      }
      if (scan.totalKnown && offset > scan.total) {
        yield delta(
          `Offset ${offset} is past the end of "${filePath}" (${scan.total} line${scan.total === 1 ? "" : "s"} total).`,
        );
        return { stopReason: "failed" };
      }

      // Render the window, self-budgeted below the tool's output cap so the trailing notes
      // are never cut by Environment's front-keep truncation.
      const budget =
        definition.maxOutputLength !== undefined && definition.maxOutputLength > 0
          ? definition.maxOutputLength
          : DEFAULT_OUTPUT_BUDGET;
      const contentBudget = Math.max(1, budget - NOTE_RESERVE);
      const rows: string[] = [];
      let used = 0;
      let shownEnd = offset - 1;
      let budgetTrimmed = false;
      for (let i = 0; i < scan.lines.length; i += 1) {
        const row = numberedLine(offset + i, scan.lines[i]!);
        const cost = row.length + (rows.length > 0 ? 1 : 0);
        if (used + cost > contentBudget) {
          if (rows.length === 0) {
            // Even the first row overflows a (tiny custom) budget: hard-cut it so the notes survive.
            rows.push(row.slice(0, contentBudget));
            shownEnd = offset + i;
          }
          budgetTrimmed = true;
          break;
        }
        used += cost;
        rows.push(row);
        shownEnd = offset + i;
      }

      const moreRemains = budgetTrimmed || !scan.totalKnown || shownEnd < scan.total;
      if (scan.sawCRLF) rows.push("(file uses CRLF line endings)");
      if (moreRemains) {
        const trimmedInfix = budgetTrimmed ? " (output limit reached)" : "";
        const totalPart = scan.totalKnown
          ? `file has ${scan.total} lines total`
          : `file has more than ${scan.total} lines`;
        rows.push(
          `[${totalPart}; showing ${offset}-${shownEnd}${trimmedInfix} — call again with offset to continue]`,
        );
      }
      yield delta(rows.join("\n"));
      return;
    },
  };
}
