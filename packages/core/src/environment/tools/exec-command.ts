/**
 * exec_command —— local shell executor, a built-in tool implementation (BuiltinTool).
 *
 * Spawns a process inside the Workspace via `bash -lc <cmd>` and streams content deltas as
 * stdout/stderr chunks arrive. Waits up to `yield_time_ms`: if the command finishes in time,
 * returns the full output and exit status; if it's still running when the deadline hits,
 * returns the output collected so far plus a `process_id` — the process moves to background,
 * managed by `CommandSessionManager`, and is interacted with afterward via `input_command`.
 * Completion is decided by **the foreground
 * process exiting**, not by waiting for EOF on the output stream — background children (e.g.
 * `node server.js &`) that inherit the pipes won't hold up the tool.
 *
 * Division of responsibility with Environment (see environment.ts): this tool only produces
 * content deltas; exit code/signal/spawn errors and `process_id` are reported via the return
 * value's `note` (appended outside the maxOutputLength truncation, so it survives even when
 * long output gets truncated). Whether it ends normally or abnormally, it always finishes via
 * the return value, **never throws**; on interruption it only reports `aborted` — the
 * interruption note itself is appended by Environment.
 * Docs: /docs/tools § "Command sessions".
 */
import path from "node:path";
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import { DEFAULT_EXEC_YIELD_MS, resultForExit } from "./command/index.js";
import { clampYield } from "./background/index.js";

/** Tool name constant (used only inside this tool module, not exposed to Environment). */
export const EXEC_COMMAND_NAME = "exec_command";

/**
 * exec_command built-in tool: parses arguments, resolves workdir, and delegates to
 * `CommandSessionManager` to spawn the process and collect output.
 * `definition` is overridden by Environment at construction time with the matching entry
 * from ToolConfig (description/parameters/permission/limits).
 * `services.commandSessions` is injected by Environment (shares the same registry with
 * input_command).
 */
export function createExecCommandTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const manager = services?.commandSessions;
  return {
    name: EXEC_COMMAND_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      if (!manager) {
        yield delta("[exec_command unavailable: no command session manager configured]");
        return { stopReason: "failed" };
      }

      const cmd = args["cmd"];
      if (typeof cmd !== "string" || cmd.length === 0) {
        yield delta('Missing required argument "cmd" for exec_command.');
        return { stopReason: "failed" };
      }
      // workdir defaults to workspaceDir; relative paths are resolved against workspaceDir.
      const rawWorkdir = args["workdir"];
      const workdir =
        typeof rawWorkdir === "string" && rawWorkdir.length > 0
          ? path.resolve(ctx.workspaceDir, rawWorkdir)
          : ctx.workspaceDir;
      const yieldMs = clampYield(
        args["yield_time_ms"],
        DEFAULT_EXEC_YIELD_MS,
        definition.timeoutMs,
      );

      // Caller already aborted: finish immediately with aborted.
      if (signal?.aborted) return { stopReason: "aborted" };

      let session;
      try {
        session = manager.spawn({ cmd, cwd: workdir });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield delta(`[spawn error: ${message}]`);
        return { stopReason: "failed" };
      }

      // On interruption, kill the whole process group (background children included) to
      // avoid orphans; once the process moves to background this listener is removed in finally.
      const onAbort = (): void => session.kill();
      let registered = false;
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const chunk of session.collect(yieldMs, signal)) yield delta(chunk);

        if (signal?.aborted) return { stopReason: "aborted" };
        if (session.running) {
          // Still running at the deadline: register as a background process, returning
          // process_id so input_command can continue accessing it.
          const id = manager.register(session);
          registered = true;
          return {
            stopReason: "completed",
            note: `[process running with process_id ${id}; use input_command to send input or poll for output]`,
          };
        }
        // Already exited: report exit status; process group cleanup (reaping any leftover
        // background children) is handled uniformly in finally.
        if (session.error) {
          return { stopReason: "failed", note: `[spawn error: ${session.error.message}]` };
        }
        return resultForExit(session.exit);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (!registered) session.kill();
      }
    },
  };
}
