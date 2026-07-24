/**
 * read_file — text-file reading tool, a builtin tool implementation (BuiltinTool).
 *
 * Reads a text file and returns it in `cat -n` style (line number, tab, content), so the
 * model can quote exact lines back to edit_file. Relative paths resolve against the
 * Workspace; absolute paths are allowed (tools run with the user's full permissions, same
 * as the shell tool). An optional 1-based `offset` and a `limit` (default 2000 lines) form
 * a window for paging through long files; overlong single lines are truncated so one
 * minified bundle line cannot blow the output cap.
 *
 * Division of responsibility with Environment (see environment.ts): non-streaming — yields
 * the whole numbered listing as one delta; failures (missing file, directory, binary
 * content) are explanatory text closed out with `failed`, **never throwing**; if
 * interrupted, only reports `aborted` — the interruption note is appended by Environment.
 * Docs: /docs/tools § "File tools".
 */
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
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

/** Renders one `cat -n` style line: 6-column right-aligned line number, tab, content. */
export function numberedLine(lineNo: number, content: string): string {
  const capped =
    content.length > MAX_LINE_LENGTH
      ? `${content.slice(0, MAX_LINE_LENGTH)}… [line truncated]`
      : content;
  return `${String(lineNo).padStart(6)}\t${capped}`;
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
      const rawOffset = args["offset"];
      const offset =
        typeof rawOffset === "number" && Number.isFinite(rawOffset)
          ? Math.max(1, Math.floor(rawOffset))
          : 1;
      const rawLimit = args["limit"];
      const limit =
        typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.floor(rawLimit)
          : DEFAULT_READ_FILE_LIMIT;

      const resolved = path.resolve(ctx.workspaceDir, filePath);
      let bytes: Buffer;
      try {
        const st = await stat(resolved);
        if (st.isDirectory()) {
          yield delta(
            `Cannot read "${filePath}": it is a directory. Pass the path of a file inside it.`,
          );
          return { stopReason: "failed" };
        }
        bytes = await readFile(resolved);
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

      if (bytes.length === 0) {
        yield delta(`"${filePath}" is an empty file (0 lines).`);
        return;
      }
      // NUL bytes mark binary content: numbered text output would be garbage. Point the
      // model at the appropriate tool instead.
      if (bytes.includes(0)) {
        yield delta(
          `"${filePath}" looks like a binary file (contains NUL bytes). Use shell commands to inspect it, or read_image if it is an image.`,
        );
        return { stopReason: "failed" };
      }

      const text = bytes.toString("utf8");
      // A trailing newline terminates the last line rather than starting an empty one
      // (cat -n semantics); intermediate empty lines are preserved.
      const lines = text.split("\n");
      if (lines[lines.length - 1] === "") lines.pop();
      const total = lines.length;
      if (offset > total) {
        yield delta(
          `Offset ${offset} is past the end of "${filePath}" (${total} line${total === 1 ? "" : "s"} total).`,
        );
        return { stopReason: "failed" };
      }
      const end = Math.min(total, offset + limit - 1); // Inclusive 1-based end of the window
      const out: string[] = [];
      for (let n = offset; n <= end; n += 1) {
        out.push(numberedLine(n, lines[n - 1]!));
      }
      if (end < total) {
        out.push(
          `[file has ${total} lines total; showing ${offset}-${end} — call again with offset to continue]`,
        );
      }
      yield delta(out.join("\n"));
      return;
    },
  };
}
