/**
 * run_subagent — delegates a subtask to a child Agent, supporting a switch to long-running
 * background execution.
 *
 * The tool itself doesn't depend on Agent/Session, only holding an injected `SubagentRunner`
 * (breaking the circular dependency). The model may freely choose the child Agent (`agent_id`)
 * and model (`model_id`) via arguments; if omitted, it falls back to reusing the current Agent
 * and inheriting the parent session's model respectively. The spawned child session is managed by
 * `ManagedSubagentSession` (sharing the `SubagentSessionManager` injected by Environment with
 * `input_subagent`).
 *
 * The two-phase semantics mirror `exec_command`: within the `yield_time_ms` window, child-session
 * messages are forwarded live (tagged with origin, so the frontend can see the child Agent's tool
 * calls and token usage) and the child Agent's text deltas are copied as this tool's output; if
 * the child Agent finishes within the window, its terminal state is returned and the child
 * session is released; if it's still running once the window expires, it's registered as a
 * background session, returning `subagent_id` for subsequent access the same way as
 * `input_command` (polling / appending a Prompt, see input-subagent.ts).
 *
 * Approval: `run_subagent` itself is a read-write tool (`rw`), so its invocation requires Human
 * approval; the child session's tool approval requests are forwarded to the same Human within
 * the window via the session's approval queue (tagged with origin), and queued for the next
 * access while running in the background. An interruption within the startup window kills the
 * child session per exec_command semantics; precheck errors such as exceeding the depth limit or
 * a nonexistent agent are expressed by the runner as a throw, and collapsed to failed.
 * Docs: /docs/tools § "Subagents".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import {
  DEFAULT_SUBAGENT_YIELD_MS,
  ManagedSubagentSession,
  resultForSubagentExit,
} from "./subagent/index.js";
import { collectWindow } from "./subagent/collect.js";
import { clampYield } from "./background/index.js";

/** Tool name constant (used only within this tool module, never exposed to Environment). */
export const SUBAGENT_NAME = "run_subagent";

/** Pending-approval hint: lets the model know it should poll again to move the child Agent forward. */
export function approvalHint(session: ManagedSubagentSession): string {
  const n = session.pendingApprovals;
  return n > 0 ? ` [subagent is waiting for approval of ${n} tool call(s); poll to review]` : "";
}

/** Builds run_subagent's BuiltinTool from tool config + injected services. */
export function createSubagentTool(
  definition: ToolDefinitionConfig,
  services?: EnvironmentServices,
): BuiltinTool {
  const runner = services?.subagentRunner;
  const manager = services?.subagentSessions;
  return {
    name: SUBAGENT_NAME,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      const { toolCallId, signal, approve } = ctx;
      const fail = function* (msg: string): Generator<OmniMessage> {
        yield partialToolCallOutput({ eventType: "delta", output: msg, toolCallId });
      };

      // Missing arguments / unconfigured services both collapse to an explanatory output rather
      // than throwing (consistent with other tools).
      if (!runner) {
        yield* fail("[run_subagent unavailable: no subagent runner configured]");
        return { stopReason: "failed" };
      }
      if (!manager || manager.isDisposed) {
        yield* fail("[run_subagent unavailable: no subagent session manager available]");
        return { stopReason: "failed" };
      }
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (prompt.trim().length === 0) {
        yield* fail("[run_subagent error: missing required string argument `prompt`]");
        return { stopReason: "failed" };
      }
      const agentId = typeof args.agent_id === "string" ? args.agent_id : undefined;
      const modelId = typeof args.model_id === "string" ? args.model_id : undefined;
      const provider = typeof args.provider === "string" ? args.provider : undefined;
      // A model is referenced by the complete (provider, model_id) pair — never half of one.
      // Caught here rather than in createSession so the model is told which half it left out.
      if ((modelId === undefined) !== (provider === undefined)) {
        yield* fail(
          "[run_subagent error: `model_id` and `provider` must be given together (a model reference is the pair), or both omitted to inherit the parent session's model]",
        );
        return { stopReason: "failed" };
      }
      const yieldMs = clampYield(
        args.yield_time_ms,
        DEFAULT_SUBAGENT_YIELD_MS,
        definition.timeoutMs,
      );

      if (signal?.aborted) return { stopReason: "aborted" };

      // Concurrency cap (running child Agents are never evicted): reject spawning if there's no
      // room.
      if (!manager.makeRoom()) {
        yield* fail(
          "[run_subagent error: too many background subagents; poll or finish existing ones first]",
        );
        return { stopReason: "failed" };
      }

      // Spawn the child Session (precheck errors such as exceeding the depth limit or a
      // nonexistent agent are expressed as a throw).
      let session: ManagedSubagentSession;
      try {
        const handle = await runner.spawn({
          ...(agentId !== undefined ? { agentId } : {}),
          ...(modelId !== undefined ? { modelId } : {}),
          ...(provider !== undefined ? { provider } : {}),
        });
        session = new ManagedSubagentSession(handle);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield* fail(`[run_subagent error: ${message}]`);
        return { stopReason: "failed" };
      }

      // An interruption within the startup window kills the child session (consistent with
      // exec_command); once switched to background, this listener is removed in `finally`.
      const onAbort = (): void => session.kill();
      let registered = false;
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        session.startRun(prompt);
        yield* collectWindow(session, {
          yieldMs,
          toolCallId,
          ...(signal ? { signal } : {}),
          ...(approve ? { approve } : {}),
        });

        if (signal?.aborted) return { stopReason: "aborted" };
        if (session.running) {
          // Still running once the window expires: register as a background session, returning
          // subagent_id for input_subagent to continue accessing it.
          const id = manager.register(session);
          registered = true;
          return {
            stopReason: "completed",
            note:
              `[subagent running with subagent_id ${id}; use input_subagent to poll for progress ` +
              `or send a follow-up prompt]` +
              approvalHint(session),
          };
        }
        // Finished within the window: report the terminal state; releasing the child session is
        // handled uniformly in `finally` (never registered, so no subagent_id).
        return resultForSubagentExit(session.exit);
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (!registered) session.kill();
      }
    },
  };
}
