/**
 * input_subagent —— accesses a subagent session that `run_subagent` moved to the background
 * (BuiltinTool).
 *
 * A message here is the parent agent's input on the child, exactly like a user's input on any
 * agent: when `prompt` is empty it just polls; when non-empty and the subagent is idle, it
 * continues the same child Session with a new round; when non-empty and the subagent is still
 * RUNNING, it is queued as a steering message on the child's own steering queue — the same
 * mechanism a user steers the main session with, delivered as a `[user_steering]` message at
 * the child's next input assembly. The boolean `abort` argument aborts the child's CURRENT
 * run only; combined with a non-empty `prompt` it interrupts and redirects — the prompt
 * starts a fresh round once the aborted one settles. Within the window, queued approval
 * requests from the child session are also passed through (see subagent/session.ts).
 *
 * The model-facing output is the child's latest COMPLETE assistant text — every access reads
 * as "what it last said", not an incremental delta drain (live rendering still flows to the
 * frontend through the origin-tagged messages).
 *
 * Unlike a command's process, a subagent session is never destroyed: a released `subagent_id`
 * (idle eviction freed its slot) is resumed through the runner and continues — there is no
 * kill notion here, and interruption only aborts this particular access. The session leaves
 * for good only with the parent Session itself.
 * Docs: /docs/tools § "Subagents".
 */
import { partialToolCallOutput, userText } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import type { EnvironmentServices, ToolDefinitionConfig } from "../../interfaces/index.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import {
  DEFAULT_SUBAGENT_POLL_YIELD_MS,
  DEFAULT_SUBAGENT_YIELD_MS,
  ManagedSubagentSession,
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
        return { stopReason: "fatal" };
      }

      const subagentId = args["subagent_id"];
      if (typeof subagentId !== "string" || subagentId.length === 0) {
        yield delta('Missing required argument "subagent_id" for input_subagent.');
        return { stopReason: "fatal" };
      }
      let session = manager.get(subagentId);
      if (!session) {
        // A subagent session is never destroyed the way a process is: an id whose session
        // left the registry (idle release) resumes through the runner — the same revival the
        // panel gets. Only an id this parent never allocated, or a missing/failed resume,
        // still errors.
        const clue = manager.releasedInfo(subagentId);
        const runner = services?.subagentRunner;
        if (clue && runner?.resume && !manager.isDisposed && manager.makeRoom()) {
          try {
            const handle = await runner.resume({
              sessionId: clue.sessionId,
              ...(clue.agentId !== undefined ? { agentId: clue.agentId } : {}),
            });
            const revived = new ManagedSubagentSession(handle, {
              ...(clue.agentId !== undefined ? { resumeAgentId: clue.agentId } : {}),
            });
            manager.track(revived);
            manager.register(revived); // The id derives from the session tail: same handle as before.
            session = revived;
            yield delta(`[subagent ${subagentId} resumed]\n`);
          } catch {
            session = undefined;
          }
        }
      }
      if (!session) {
        yield delta(
          `[input_subagent error: unknown subagent_id ${subagentId} ` +
            `(not from this conversation, or its session could not be resumed)]`,
        );
        return { stopReason: "fatal" };
      }

      const prompt = typeof args["prompt"] === "string" ? (args["prompt"] as string) : "";
      const empty = prompt.trim().length === 0;
      const yieldMs = clampYield(
        args["yield_time_ms"],
        empty ? DEFAULT_SUBAGENT_POLL_YIELD_MS : DEFAULT_SUBAGENT_YIELD_MS,
        definition.timeoutMs,
      );

      if (signal?.aborted) return { stopReason: "aborted" };

      // Abort the child's CURRENT run (per-run scope; the session survives). Waiting for the
      // aborted round to settle keeps the follow-up prompt path below deterministic — the
      // wait is bounded by this call's own signal (timeout/interruption).
      if (args["abort"] === true) {
        if (session.abortRun()) {
          yield delta(`[aborting subagent ${subagentId}'s current run]\n`);
          while (session.running && signal?.aborted !== true) await session.waitWake(200);
        } else {
          yield delta(`[subagent ${subagentId} was already idle; nothing to abort]\n`);
        }
        if (signal?.aborted) return { stopReason: "aborted" };
      }

      // A non-empty prompt: steering while the child runs (the child's own steering queue —
      // the same mechanism a user steers the main session with; sender "parent_agent" like
      // the follow-up prompts), a follow-up run while it is idle. steer() itself answers
      // false on an idle child, so the running/idle race settles on whichever side is true
      // at delivery.
      if (!empty) {
        if (session.steer([userText(prompt, "parent_agent")])) {
          yield delta(`[steering message queued for subagent ${subagentId}]\n`);
        } else if (!session.running) {
          // startRun expresses edge cases like already-disposed via throw, collapsed here into failed (the tool never throws outward).
          try {
            session.startRun([userText(prompt, "parent_agent")]);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            yield delta(`[input_subagent error: ${message}]`);
            return { stopReason: "fatal" };
          }
        } else {
          // Running, but the handle predates steering (an older embedder's SubagentRunner).
          yield delta(
            `[input_subagent error: subagent ${subagentId} is still running; ` +
              `poll with an empty prompt to collect progress first]`,
          );
          return { stopReason: "fatal" };
        }
      }

      // Text deltas do not mirror into this tool's output (includeText: false): the model
      // reads the child's latest COMPLETE assistant text below — an idempotent "what it last
      // said" snapshot — instead of an incremental delta drain. Messages and approvals still
      // flow through the window as before.
      yield* collectWindow(session, {
        yieldMs,
        toolCallId,
        includeText: false,
        ...(signal ? { signal } : {}),
        ...(approve ? { approve } : {}),
      });

      // Interruption only aborts this access, it doesn't end the child session.
      if (signal?.aborted) return { stopReason: "aborted" };
      const latest = session.lastAssistantText;
      if (latest !== null) yield delta(latest);
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
