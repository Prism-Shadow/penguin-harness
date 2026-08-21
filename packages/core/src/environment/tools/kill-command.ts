/**
 * kill_command — terminates a background command session started by `exec_command` (BuiltinTool).
 *
 * Finds the session by `process_id`, disarms any pending completion report (the killer reads
 * the outcome right here — a trailing "task done" user message would only repeat it), drains
 * the yet-undelivered output as this tool's own output, then kills the whole process group
 * (SIGTERM, escalating to SIGKILL — see ManagedSession.kill) and drops the session from the
 * registry. Works on already-exited sessions too: those just report the recorded exit status
 * and are removed. Unknown process_id fails with an explanation.
 * Docs: /docs/tools § "Command sessions".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant. */
export const KILL_COMMAND_NAME = "kill_command";

export function createKillCommandTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const manager = services?.commandSessions;
  return {
    name: KILL_COMMAND_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      if (!manager) {
        yield delta("[kill_command unavailable: no command session manager configured]");
        return { stopReason: "failed" };
      }
      const processId = args["process_id"];
      if (typeof processId !== "string" || processId.length === 0) {
        yield delta('Missing required argument "process_id" for kill_command.');
        return { stopReason: "failed" };
      }
      const session = manager.get(processId);
      if (!session) {
        yield delta(
          `[kill_command error: unknown process_id ${processId} (the session may have exited and been cleared)]`,
        );
        return { stopReason: "failed" };
      }

      // Disarm before killing: the exit this kill causes must not fire a completion report.
      session.clearExitWatchers();
      const pending = session.drainPending();
      if (pending) yield delta(pending);
      const wasRunning = session.running;
      const exit = session.exit;
      manager.kill(processId);
      if (wasRunning) {
        return {
          stopReason: "completed",
          note: `[process ${processId} killed (SIGTERM to the process group, SIGKILL after a grace period)]`,
        };
      }
      const status = session.error
        ? `spawn error: ${session.error.message}`
        : exit?.signal != null
          ? `terminated by signal ${exit.signal}`
          : `exit code ${exit?.code ?? "unknown"}`;
      return {
        stopReason: "completed",
        note: `[process ${processId} had already exited (${status}); session removed]`,
      };
    },
  };
}
