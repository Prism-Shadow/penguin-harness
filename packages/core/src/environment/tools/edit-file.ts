/**
 * edit_file — exact-string file editing tool, a builtin tool implementation (BuiltinTool).
 *
 * Replaces `old_string` with `new_string` in an existing file. `old_string` must match the
 * file content exactly (including whitespace/indentation) and, unless `replace_all` is set,
 * occur exactly once — zero or multiple occurrences fail with an explanation telling the
 * model to fix the match or widen the context. On success the output confirms the
 * replacement count and shows a short line-numbered snippet around the first replacement so
 * the model can verify the result without re-reading the file. Relative paths resolve
 * against the Workspace; absolute paths are allowed (tools run with the user's full
 * permissions, same as the shell tool).
 *
 * Division of responsibility with Environment (see environment.ts): non-streaming — yields
 * one final text delta; all failures are explanatory text closed out with `failed`,
 * **never throwing**; if interrupted, only reports `aborted` — the interruption note is
 * appended by Environment.
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import { numberedLine } from "./read-file.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const EDIT_FILE_NAME = "edit_file";

/** Lines of context shown on each side of the first replacement in the verification snippet. */
const SNIPPET_CONTEXT_LINES = 4;

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
 * Builds the post-edit verification snippet: line-numbered lines of the new content
 * spanning the replaced text plus a few lines of context on each side.
 */
function buildSnippet(newContent: string, replaceStart: number, insertedLength: number): string {
  const lines = newContent.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  // 1-based line numbers of the replacement's first and last affected line.
  const startLine = newContent.slice(0, replaceStart).split("\n").length;
  const endLine = newContent.slice(0, replaceStart + insertedLength).split("\n").length;
  const from = Math.max(1, startLine - SNIPPET_CONTEXT_LINES);
  const to = Math.min(lines.length, endLine + SNIPPET_CONTEXT_LINES);
  const out: string[] = [];
  for (let n = from; n <= to; n += 1) out.push(numberedLine(n, lines[n - 1]!));
  return out.join("\n");
}

/**
 * edit_file builtin tool: reads the file, validates the uniqueness of `old_string`,
 * writes the replaced content back, and reports a verification snippet.
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
      if (typeof oldString !== "string" || oldString.length === 0) {
        yield delta(`Missing required argument "old_string" for ${definition.name}.`);
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
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(`Cannot edit "${filePath}": it is a directory.`);
          return { stopReason: "failed" };
        }
        content = await readFile(resolved, "utf8");
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          yield delta(
            `File not found: "${filePath}". edit_file only edits existing files — check the path, or use write_file to create it.`,
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
        yield delta(
          `old_string not found in "${filePath}". Make sure it matches the file content exactly, including whitespace and indentation.`,
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
        await writeFile(resolved, newContent, "utf8");
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`Failed to write "${filePath}": ${message}`);
        return { stopReason: "failed" };
      }

      const replaced = replaceAll ? occurrences : 1;
      const snippet = buildSnippet(newContent, replaceStart, newString.length);
      yield delta(
        `Replaced ${replaced} occurrence${replaced === 1 ? "" : "s"} in "${filePath}".\n${snippet}`,
      );
      return;
    },
  };
}
