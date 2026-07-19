/**
 * input_subagent —— accesses a subagent session that `run_subagent` moved to the background
 * (BuiltinTool).
 *
 * Finds the session by `subagent_id`: when `prompt` is empty, nothing is written — it just
 * polls (collecting subagent messages and text deltas buffered during the background period,
 * or waiting for the run to end); when non-empty and the subagent is idle, it's fed in as a new
 * user message to continue on the same child Session (long-running subagent, multi-turn
 * conversation); when non-empty but the subagent is still running, it errors, suggesting to
 * poll first. Within the window, queued approval requests from the child session are also
 * passed through (see subagent/session.ts).
 *
 * Difference from `input_command`: once a round of work finishes, the session is **not
 * removed** (kept to receive a follow-up prompt) — it's only released when the parent Session
 * ends, or evicted as an idle session once concurrency is full. Interruption only aborts this
 * particular access, **it never kills the child session** (the subagent was launched
 * independently earlier; the user interrupting one poll shouldn't kill it along the way).
 * Docs: /docs/tools § "Subagents".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import {
  DEFAULT_SUBAGENT_POLL_YIELD_MS,
  DEFAULT_SUBAGENT_YIELD_MS,
  resultForSubagentExit,
} from "./subagent/index.js";
import { approvalHint } from "./run-subagent.js";
import { collectWindow } from "./subagent/collect.js";
import { clampYield } from "./background/index.js";

/** Tool name constant. */
export const INPUT_SUBAGENT_NAME = "input_subagent";

export function createInputSubagentTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const manager = services?.subagentSessions;
  return {
    name: INPUT_SUBAGENT_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal, approve } = ctx;
      const delta = (output: string): OmniMessage =>
        partialToolCallOutput({ eventType: "delta", output, toolCallId });

      if (!manager) {
        yield delta("[input_subagent unavailable: no subagent session manager configured]");
        return { stopReason: "failed" };
      }

      const subagentId = args["subagent_id"];
      if (typeof subagentId !== "string" || subagentId.length === 0) {
        yield delta('Missing required argument "subagent_id" for input_subagent.');
        return { stopReason: "failed" };
      }
      const session = manager.get(subagentId);
      if (!session) {
        yield delta(
          `[input_subagent error: unknown subagent_id ${subagentId} ` +
            `(the session may have finished and been cleared)]`,
        );
        return { stopReason: "failed" };
      }

      const prompt = typeof args["prompt"] === "string" ? (args["prompt"] as string) : "";
      const empty = prompt.trim().length === 0;
      const yieldMs = clampYield(
        args["yield_time_ms"],
        empty ? DEFAULT_SUBAGENT_POLL_YIELD_MS : DEFAULT_SUBAGENT_YIELD_MS,
        definition.timeoutMs,
      );

      if (signal?.aborted) return { stopReason: "aborted" };

      // Continue with a follow-up prompt (empty prompt just polls). New input is not accepted
      // while running: poll first to collect progress.
      if (!empty) {
        if (session.running) {
          yield delta(
            `[input_subagent error: subagent ${subagentId} is still running; ` +
              `poll with an empty prompt to collect progress first]`,
          );
          return { stopReason: "failed" };
        }
        // startRun expresses edge cases like already-disposed via throw, collapsed here into failed (the tool never throws outward).
        try {
          session.startRun(prompt);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          yield delta(`[input_subagent error: ${message}]`);
          return { stopReason: "failed" };
        }
      }

      yield* collectWindow(session, {
        yieldMs,
        toolCallId,
        ...(signal ? { signal } : {}),
        ...(approve ? { approve } : {}),
      });

      // Interruption only aborts this access, it doesn't kill the child session.
      if (signal?.aborted) return { stopReason: "aborted" };
      if (session.running) {
        return {
          stopReason: "completed",
          note: `[subagent still running with subagent_id ${subagentId}]` + approvalHint(session),
        };
      }
      // This round of work has ended: report the end state; the session is kept (can be resumed), not removed from the registry.
      const result = resultForSubagentExit(session.exit);
      const idleHint = `[subagent idle with subagent_id ${subagentId}; send a follow-up prompt to continue]`;
      return {
        ...result,
        note: result.note !== undefined ? `${result.note} ${idleHint}` : idleHint,
      };
    },
  };
}
