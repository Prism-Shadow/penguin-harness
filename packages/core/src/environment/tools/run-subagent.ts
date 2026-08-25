/**
 * run_subagent — delegates a subtask to a child Agent, supporting a switch to long-running
 * background execution.
 *
 * The tool itself doesn't depend on Agent/Session, only holding an injected `SubagentRunner`
 * (breaking the circular dependency). The model may freely choose the child Agent (`agent_id`),
 * model (`model_id`), and thinking level (`thinking_level`) via arguments; if omitted, it falls
 * back to reusing the current Agent and inheriting the parent session's model and thinking level
 * respectively. The spawned child session is managed by `ManagedSubagentSession` (sharing the
 * `SubagentSessionManager` injected by Environment with `input_subagent`).
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
 * access while a promoted session runs in the background. A `run_in_background` launch instead
 * attaches this call's own approval callback as a standing sink (see the branch below) — the
 * child never parks waiting for a poll. An interruption within the startup window kills the
 * child session per exec_command semantics; precheck errors such as exceeding the depth limit or
 * a nonexistent agent are expressed by the runner as a throw, and collapsed to failed.
 * Docs: /docs/tools § "Subagents".
 */
import { partialToolCallOutput } from "../../omnimessage/index.js";
import type { OmniMessage } from "../../omnimessage/index.js";
import { SUBAGENT_THINKING_LEVELS } from "../../interfaces.js";
import type {
  EnvironmentServices,
  ThinkingLevelName,
  ToolDefinitionConfig,
} from "../../interfaces.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "./types.js";
import {
  DEFAULT_SUBAGENT_YIELD_MS,
  ManagedSubagentSession,
  resultForSubagentExit,
} from "./subagent/index.js";
import { collectWindow } from "./subagent/collect.js";
import { clampYield, reportLabel, tailForReport } from "./background/index.js";

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
        return { stopReason: "fatal" };
      }
      if (!manager || manager.isDisposed) {
        yield* fail("[run_subagent unavailable: no subagent session manager available]");
        return { stopReason: "fatal" };
      }
      const prompt = typeof args.prompt === "string" ? args.prompt : "";
      if (prompt.trim().length === 0) {
        yield* fail("[run_subagent error: missing required string argument `prompt`]");
        return { stopReason: "fatal" };
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
        return { stopReason: "fatal" };
      }
      // Thinking-level override: an explicit value must be one of the selectable tiers — a typo
      // must fail loudly rather than silently running the child at an inherited level the caller
      // did not ask for. JSON `null` counts as omitted (= inherit), like a missing key.
      const rawThinkingLevel = args.thinking_level ?? undefined;
      if (
        rawThinkingLevel !== undefined &&
        !(SUBAGENT_THINKING_LEVELS as readonly unknown[]).includes(rawThinkingLevel)
      ) {
        yield* fail(
          `[run_subagent error: invalid \`thinking_level\` ${JSON.stringify(rawThinkingLevel)}; ` +
            `use one of ${SUBAGENT_THINKING_LEVELS.join(" / ")}, or omit it to inherit the parent session's level]`,
        );
        return { stopReason: "fatal" };
      }
      const thinkingLevel = rawThinkingLevel as ThinkingLevelName | undefined;
      const background = args.run_in_background === true;
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
        return { stopReason: "fatal" };
      }

      // Spawn the child Session (precheck errors such as exceeding the depth limit or a
      // nonexistent agent are expressed as a throw).
      let session: ManagedSubagentSession;
      try {
        const handle = await runner.spawn({
          ...(agentId !== undefined ? { agentId } : {}),
          ...(modelId !== undefined ? { modelId } : {}),
          ...(provider !== undefined ? { provider } : {}),
          ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        });
        session = new ManagedSubagentSession(handle, {
          // Spawn-time owner for the revival tombstone (undefined = a self-spawn of this Agent).
          ...(agentId !== undefined ? { resumeAgentId: agentId } : {}),
        });
        // Live index from the moment of spawn (before any registration): host paths — the
        // subagents panel's steer/abort — reach this child by its session id even while it
        // still runs inside this call's foreground collect window.
        manager.track(session);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        yield* fail(`[run_subagent error: ${message}]`);
        return { stopReason: "fatal" };
      }

      // run_in_background: no collect window — register immediately, arm the completion
      // report (fires at the end of every round until the session is killed), start the run,
      // and hand back the subagent_id. The completion reaches the conversation as a harness
      // user message; the model can still poll or follow up with input_subagent, or stop it
      // input_subagent (abort included). The child's messages stream to the host live through the
      // forwarding tap below (its own Trace stays the durable record).
      if (background) {
        const id = manager.register(session);
        armSubagentDoneReport(session, id, prompt, services);
        // Decouple the child's lifecycle from this call: a standing approval sink (this
        // call's own ctx.approve — without it the child's first read-write tool would park
        // at the approval queue forever, since no collect window ever attaches one) and a
        // live message tap, so the child streams to the frontend past this turn's end. The
        // child's abort signal is its own (ManagedSubagentSession.abortCtrl) — only
        // dispose or registry eviction ends it (and a released session can be revived).
        if (approve) session.setPersistentApprovalSink(approve);
        const forward = services?.backgroundForward;
        if (forward) session.setMessageTap(forward);
        // Forward the child's session_meta upfront (run skips its own copy): the frontend's
        // subagents panel and the server's subagent registry learn of the child at launch,
        // not at the first input_subagent access.
        const meta = session.takeMeta();
        if (meta) yield meta;
        session.startRun(prompt);
        return {
          stopReason: "completed",
          note:
            `[subagent running in background with subagent_id ${id}; its completion will arrive ` +
            `as a user message — no need to poll. Use input_subagent to interact (abort: true stops its current run)]`,
        };
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

/**
 * Arms the completion report of a background-launched subagent: at the end of every
 * MODEL-initiated round (the launch itself and input_subagent follow-ups) the report — id,
 * terminal status, tail of the yet-undelivered answer text — goes to
 * `services.backgroundDone`, which the Session turns into a harness user message. Rounds the
 * HOST starts (the panel's message on an idle child) stay silent: they are the user's own
 * conversation with the child, not dispatched work awaiting a result (see
 * ManagedSubagentSession.startRun's suppressDoneReport), and so does a round ended by an
 * explicit abort (input_subagent's `abort` / the panel's stop — the aborter sees the outcome
 * directly; see abortRun). A disposed session never fires (see ManagedSubagentSession.onSettled).
 */
export function armSubagentDoneReport(
  session: ManagedSubagentSession,
  subagentId: string,
  prompt: string,
  services?: EnvironmentServices,
): void {
  const notify = services?.backgroundDone;
  if (!notify) return;
  session.onSettled(() => {
    const exit = session.exit;
    // Drain the delta buffer regardless (bounded memory); the report itself carries the
    // child's latest complete utterance — the same snapshot input_subagent returns.
    session.drainText();
    notify({
      kind: "subagent",
      id: subagentId,
      label: reportLabel(prompt),
      status: exit?.status ?? "completed",
      detail: exit?.note ?? "",
      output: tailForReport(session.lastAssistantText ?? ""),
    });
  });
}
