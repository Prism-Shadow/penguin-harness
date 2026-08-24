/**
 * write_file — whole-file writing tool, a builtin tool implementation (BuiltinTool).
 *
 * Writes `content` to a file, creating it (including missing parent directories) or
 * overwriting it entirely; an empty string is a valid content (creates an empty file).
 * The output distinguishes "Created" from "Overwrote" and reports the size written, so
 * the model notices when it clobbered an existing file; an overwrite additionally shows a
 * git-style unified diff against the previous content when the change is small, and a
 * one-line `+X/−Y lines` summary otherwise (created files carry no diff — the model just
 * supplied the content). The write is atomic (temp file + rename, preserving an
 * overwritten file's permission bits), so a crash mid-write cannot leave the target
 * half-written; a symlinked path is followed to the file it names, so the link survives
 * and the content lands where it points. Relative paths resolve against the Workspace;
 * absolute paths are allowed (tools run with the user's full permissions, same as the
 * shell tool).
 * For surgical changes to an existing file, edit_file is the better tool — this one
 * replaces the whole content.
 *
 * Division of responsibility with Environment (see environment.ts): non-streaming — yields
 * one final text delta; failures (path is a directory, permission errors) are explanatory
 * text finalized as `failed`; anything unexpected that still throws is caught by
 * Environment and likewise finalized as failed. If interrupted, only reports `aborted` —
 * the interruption note is appended by Environment.
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { mkdir, readFile, stat } from "node:fs/promises";
import { atomicWriteFile, resolveWriteTarget } from "./file-utils.js";
import { buildLineDiffHunks, renderHunk } from "./diff.js";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const WRITE_FILE_NAME = "write_file";

/** Max bytes of previous content read back for the overwrite diff; larger files get no diff. */
const DIFF_SOURCE_CAP_BYTES = 1024 * 1024;

/** Max rendered diff lines (headers included) shown inline; larger diffs collapse to a +X/−Y summary. */
const MAX_DIFF_DISPLAY_LINES = 60;

/** Output-budget headroom kept below the tool's maxOutputLength when appending the diff. */
const NOTE_RESERVE = 120;

/** Fallback output budget when the definition carries no maxOutputLength (mirrors the default config entry). */
const DEFAULT_OUTPUT_BUDGET = 16000;

/** Counts content lines the way `cat -n` numbers them: a trailing newline ends the last line instead of adding an empty one. */
function countLines(content: string): number {
  if (content === "") return 0;
  const lines = content.split("\n");
  return lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
}

/**
 * write_file builtin tool: creates parent directories as needed and writes the full
 * content, reporting created/overwrote plus the written size.
 * `definition` is overridden by Environment at construction time with the same-named entry
 * from ToolConfig (description/arguments/permissions/limits).
 */
export function createWriteFileTool(definition: ToolDefinitionConfig): BuiltinTool {
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
      // An empty string is valid content (creates an empty file); only a missing/non-string
      // value is an argument error.
      const content = args["content"];
      if (typeof content !== "string") {
        yield delta(`Missing required argument "content" for ${definition.name}.`);
        return { stopReason: "failed" };
      }

      const resolved = path.resolve(ctx.workspaceDir, filePath);
      // Determine created-vs-overwrote before writing; also reject directories up front
      // (writeFile's raw EISDIR is not model-friendly).
      let existed = false;
      let fileMode: number | undefined;
      let previous: string | null = null; // Previous content, for the overwrite diff
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(`Cannot write "${filePath}": it is a directory.`);
          return { stopReason: "failed" };
        }
        existed = true;
        fileMode = st.mode & 0o777; // Preserved across the atomic temp-file + rename write
        // Read the old content back for the diff — bounded: a huge or unreadable/binary
        // previous file simply gets no diff (never a failure).
        if (st.size <= DIFF_SOURCE_CAP_BYTES) {
          const bytes = await readFile(resolved);
          if (!bytes.includes(0)) previous = bytes.toString("utf8");
        }
      } catch {
        // Missing file (or unstatable path): proceed to create; real write errors surface below.
      }
      if (signal?.aborted) return { stopReason: "aborted" };

      try {
        // The parent to create is the one holding the file that will actually be written:
        // through a symlink that is the target's directory, not the link's (a link pointing
        // into a directory that does not exist yet is created the way `>` would).
        await mkdir(path.dirname(await resolveWriteTarget(resolved)), { recursive: true });
        await atomicWriteFile(resolved, content, {
          ...(fileMode !== undefined ? { mode: fileMode } : {}),
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`Failed to write "${filePath}": ${message}`);
        return { stopReason: "failed" };
      }

      const lines = countLines(content);
      const bytes = Buffer.byteLength(content, "utf8");
      const out: string[] = [
        `${existed ? "Overwrote" : "Created"} "${filePath}" (${lines} line${lines === 1 ? "" : "s"}, ${bytes} byte${bytes === 1 ? "" : "s"}).`,
      ];
      // Overwrites show what changed, Claude Code style: a small unified diff inline, a
      // one-line +X/−Y summary otherwise. Self-budgeted below the tool's output cap so
      // the leading summary line always survives Environment's front-keep truncation.
      if (existed && previous !== null) {
        const diff = buildLineDiffHunks(previous, content);
        if (diff.kind === "identical") {
          out.push("(content unchanged)");
        } else if (diff.kind === "too-large") {
          out.push(
            `+${diff.plus}/−${diff.minus} lines vs the previous content (diff too large to show)`,
          );
        } else {
          const rendered = diff.hunks.map(renderHunk);
          const budget =
            definition.maxOutputLength !== undefined && definition.maxOutputLength > 0
              ? definition.maxOutputLength
              : DEFAULT_OUTPUT_BUDGET;
          const totalLines = rendered.reduce((acc, h) => acc + h.split("\n").length, 0);
          const totalChars = rendered.reduce((acc, h) => acc + h.length + 1, out[0]!.length);
          if (totalLines > MAX_DIFF_DISPLAY_LINES || totalChars > budget - NOTE_RESERVE) {
            out.push(
              `+${diff.plus}/−${diff.minus} lines vs the previous content (diff too large to show)`,
            );
          } else {
            out.push(...rendered);
          }
        }
      }
      yield delta(out.join("\n"));
      return;
    },
  };
}
