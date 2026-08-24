/**
 * edit_file — exact-string file editing tool, a builtin tool implementation (BuiltinTool).
 *
 * Replaces `old_string` with `new_string` in an existing file. `old_string` must match the
 * file content exactly (including whitespace/indentation) and, unless `replace_all` is set,
 * occur exactly once — zero or multiple occurrences fail with an explanation telling the
 * model to fix the match or widen the context. On success the output confirms the
 * replacement count and shows a git-style unified diff of the changed regions (one hunk
 * per replacement site, nearby sites merged; capped for replace_all storms), so both the
 * model and the user can verify exactly what changed without re-reading the file. The
 * write is atomic (temp file + rename, preserving the original permission bits), so a
 * crash mid-write cannot leave the file half-edited. Relative paths resolve against the
 * Workspace; absolute paths are allowed (tools run with the user's full permissions, same
 * as the shell tool).
 *
 * Division of responsibility with Environment (see environment.ts): non-streaming — yields
 * one final text delta; failures are explanatory text finalized as `failed`; anything
 * unexpected that still throws is caught by Environment and likewise finalized as failed.
 * If interrupted, only reports `aborted` — the interruption note is appended by
 * Environment.
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import { atomicWriteFile } from "../../internal/atomic-write.js";
import { buildReplacementHunks, renderHunk } from "./diff.js";
import { missingPathHint } from "./path-hint.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const EDIT_FILE_NAME = "edit_file";

/** Max diff hunks shown in the result (replace_all over a large file stays readable). */
const MAX_DIFF_HUNKS = 5;

/** Output-budget headroom reserved for the trailing "…and N more replacements" note. */
const NOTE_RESERVE = 120;

/** Fallback output budget when the definition carries no maxOutputLength (mirrors the default config entry). */
const DEFAULT_OUTPUT_BUDGET = 16000;

/** Counts non-overlapping occurrences of `needle` in `haystack` (needle is non-empty here). */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * edit_file builtin tool: reads the file, validates the uniqueness of `old_string`,
 * writes the replaced content back atomically, and reports a unified diff of the change.
 * `definition` is overridden by Environment at construction time with the same-named entry
 * from ToolConfig (description/arguments/permissions/limits).
 */
export function createEditFileTool(definition: ToolDefinitionConfig): BuiltinTool {
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
      const oldString = args["old_string"];
      if (typeof oldString !== "string") {
        yield delta(`Missing required argument "old_string" for ${definition.name}.`);
        return { stopReason: "failed" };
      }
      if (oldString.length === 0) {
        yield delta(
          "old_string must not be empty — edit_file replaces existing text. To create a file or rewrite it wholesale, use write_file.",
        );
        return { stopReason: "failed" };
      }
      const newString = args["new_string"];
      if (typeof newString !== "string") {
        yield delta(`Missing required argument "new_string" for ${definition.name}.`);
        return { stopReason: "failed" };
      }
      if (oldString === newString) {
        yield delta(
          "old_string and new_string are identical — nothing to change. Make new_string the desired replacement text.",
        );
        return { stopReason: "failed" };
      }
      const replaceAll = args["replace_all"] === true;

      const resolved = path.resolve(ctx.workspaceDir, filePath);
      let content: string;
      let fileMode: number | undefined;
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(`Cannot edit "${filePath}": it is a directory.`);
          return { stopReason: "failed" };
        }
        fileMode = st.mode & 0o777;
        content = await readFile(resolved, { encoding: "utf8", ...(signal ? { signal } : {}) });
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const code = (err as NodeJS.ErrnoException).code;
        // ENOTDIR is the same mistake seen one segment later (a file used as a directory),
        // so it gets the same diagnosis instead of a raw errno message.
        if (code === "ENOENT" || code === "ENOTDIR") {
          const hint = await missingPathHint(resolved);
          yield delta(
            `File not found: "${filePath}". edit_file only edits existing files — check the path (absolute paths are supported), or use write_file to create it.${hint}`,
          );
        } else {
          const message = err instanceof Error ? err.message : String(err);
          yield delta(`Failed to read "${filePath}": ${message}`);
        }
        return { stopReason: "failed" };
      }
      if (signal?.aborted) return { stopReason: "aborted" };

      const occurrences = countOccurrences(content, oldString);
      if (occurrences === 0) {
        // A CRLF file is the classic silent mismatch: text copied from read_file's display
        // has bare \n while the file has \r\n — say so explicitly.
        const crlfHint = content.includes("\r\n")
          ? " Note: the file uses CRLF (\\r\\n) line endings — a multi-line old_string must include the \\r characters."
          : "";
        yield delta(
          `old_string not found in "${filePath}". Make sure it matches the file content exactly, including whitespace and indentation.${crlfHint}`,
        );
        return { stopReason: "failed" };
      }
      if (occurrences > 1 && !replaceAll) {
        yield delta(
          `old_string occurs ${occurrences} times in "${filePath}". Add surrounding context to make it unique, or set replace_all to true to replace every occurrence.`,
        );
        return { stopReason: "failed" };
      }

      const replaceStart = content.indexOf(oldString);
      const newContent = replaceAll
        ? content.split(oldString).join(newString)
        : content.slice(0, replaceStart) +
          newString +
          content.slice(replaceStart + oldString.length);
      try {
        await atomicWriteFile(resolved, newContent, {
          ...(fileMode !== undefined ? { mode: fileMode } : {}),
          ...(signal ? { signal } : {}),
        });
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`Failed to write "${filePath}": ${message}`);
        return { stopReason: "failed" };
      }

      const replaced = replaceAll ? occurrences : 1;
      // Git-style unified diff of the changed regions, self-budgeted below the tool's
      // output cap so the leading summary line (and the elision note) always survive
      // Environment's front-keep truncation.
      const { hunks } = buildReplacementHunks(
        content,
        oldString,
        newString,
        replaceAll,
        MAX_DIFF_HUNKS,
      );
      const budget =
        definition.maxOutputLength !== undefined && definition.maxOutputLength > 0
          ? definition.maxOutputLength
          : DEFAULT_OUTPUT_BUDGET;
      const out: string[] = [
        `Replaced ${replaced} occurrence${replaced === 1 ? "" : "s"} in "${filePath}".`,
      ];
      let used = out[0]!.length;
      let shownSites = 0;
      for (const { hunk, sites } of hunks) {
        const rendered = renderHunk(hunk);
        if (used + 1 + rendered.length > budget - NOTE_RESERVE) break;
        out.push(rendered);
        used += 1 + rendered.length;
        shownSites += sites;
      }
      const omitted = replaced - shownSites;
      if (omitted > 0) {
        out.push(`…and ${omitted} more replacement${omitted === 1 ? "" : "s"}`);
      }
      yield delta(out.join("\n"));
      return;
    },
  };
}
