/**
 * kill_subagent — terminates a background subagent session started by `run_subagent`
 * (BuiltinTool).
 *
 * Finds the session by `subagent_id`, disarms any pending completion report (the killer reads
 * the outcome right here), drains the yet-undelivered answer text as this tool's own output,
 * then aborts the run (denying pending approvals, releasing the child Session — see
 * ManagedSubagentSession.kill) and drops it from the registry. An idle background subagent is
 * removed the same way, freeing its concurrency slot. Unknown subagent_id fails with an
 * explanation. The child Session's own Trace keeps everything it produced before the kill.
 * Docs: /docs/tools § "Subagents".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";

/** Tool name constant. */
export const KILL_SUBAGENT_NAME = "kill_subagent";

export function createKillSubagentTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const manager = services?.subagentSessions;
  return {
    name: KILL_SUBAGENT_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      if (!manager) {
        yield delta("[kill_subagent unavailable: no subagent session manager configured]");
        return { stopReason: "failed" };
      }
      const subagentId = args["subagent_id"];
      if (typeof subagentId !== "string" || subagentId.length === 0) {
        yield delta('Missing required argument "subagent_id" for kill_subagent.');
        return { stopReason: "failed" };
      }
      const session = manager.get(subagentId);
      if (!session) {
        yield delta(
          `[kill_subagent error: unknown subagent_id ${subagentId} (the session may have finished and been cleared)]`,
        );
        return { stopReason: "failed" };
      }

      // Disarm before killing: the settle this kill causes must not fire a completion report.
      session.clearSettleWatcher();
      const pending = session.drainText();
      if (pending) yield delta(pending);
      const wasRunning = session.running;
      manager.kill(subagentId);
      return {
        stopReason: "completed",
        note: wasRunning
          ? `[subagent ${subagentId} aborted and removed; its own trace keeps the work done so far]`
          : `[subagent ${subagentId} was idle; session removed]`,
      };
    },
  };
}
