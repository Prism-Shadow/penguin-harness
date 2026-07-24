/**
 * write_file — whole-file writing tool, a builtin tool implementation (BuiltinTool).
 *
 * Writes `content` to a file, creating it (including missing parent directories) or
 * overwriting it entirely; an empty string is a valid content (creates an empty file).
 * The output distinguishes "Created" from "Overwrote" and reports the size written, so
 * the model notices when it clobbered an existing file. Relative paths resolve against
 * the Workspace; absolute paths are allowed (tools run with the user's full permissions,
 * same as the shell tool). For surgical changes to an existing file, edit_file is the
 * better tool — this one replaces the whole content.
 *
 * Division of responsibility with Environment (see environment.ts): non-streaming — yields
 * one final text delta; all failures (path is a directory, permission errors) are
 * explanatory text closed out with `failed`, **never throwing**; if interrupted, only
 * reports `aborted` — the interruption note is appended by Environment.
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const WRITE_FILE_NAME = "write_file";

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
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(`Cannot write "${filePath}": it is a directory.`);
          return { stopReason: "failed" };
        }
        existed = true;
      } catch {
        // Missing file (or unstatable path): proceed to create; real write errors surface below.
      }
      if (signal?.aborted) return { stopReason: "aborted" };

      try {
        await mkdir(path.dirname(resolved), { recursive: true });
        await writeFile(resolved, content, "utf8");
      } catch (err) {
        if (signal?.aborted) return { stopReason: "aborted" };
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`Failed to write "${filePath}": ${message}`);
        return { stopReason: "failed" };
      }

      const lines = countLines(content);
      const bytes = Buffer.byteLength(content, "utf8");
      yield delta(
        `${existed ? "Overwrote" : "Created"} "${filePath}" (${lines} line${lines === 1 ? "" : "s"}, ${bytes} byte${bytes === 1 ? "" : "s"}).`,
      );
      return;
    },
  };
}
