/**
 * Consumption loop that drives a Task to completion (CLI side, shared by run and chat).
 *
 * New protocol: `session.run(prompt, { signal, approve })` runs the entire ReAct loop in one
 * call — within a turn, the engine invokes the `approve` callback for each tool_call, executing
 * it on allow, with execution possibly overlapping. The CLI only needs to consume the output
 * stream and supply `approve`. The approval strategy is determined by the permission mode
 * (allow-all / deny-all / read-only / always-ask per-call approval).
 */
import { isEventMessage } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage, Session } from "@prismshadow/penguin-core";
import type { StreamRenderer } from "./render.js";
import { makeApprove, promptApproval, type ApprovalMode } from "./approval.js";
import type { Messages } from "./i18n.js";

export interface RunTaskOptions {
  /** Approval mode (default allow-all). */
  mode?: ApprovalMode;
  /** Interrupt signal (Ctrl-C, etc.). */
  signal?: AbortSignal;
  renderer: StreamRenderer;
  /** The actual Q&A for interactive approval; defaults to the one-off `promptApproval`. */
  interactivePrompt?: ApproveFn;
  /** Message set. */
  t: Messages;
}

/** Result of one Task: `aborted` = the Task ended with an abort event (LLM failure/reconnect exhausted/user interrupt). */
export interface RunTaskResult {
  aborted: boolean;
}

export async function runTask(
  session: Session,
  prompt: OmniMessage[],
  opts: RunTaskOptions,
): Promise<RunTaskResult> {
  const basePrompt: ApproveFn = opts.interactivePrompt ?? (() => promptApproval({ t: opts.t }));
  // Lock the renderer while waiting for the user's approval input: messages from concurrent
  // tools/subsessions are queued and released together once the Q&A finishes, so the prompt
  // isn't scrambled by later output. The pending tool_call is passed in so its call line stays
  // right before the prompt; the approval result is rendered in place **before unlocking** —
  // "tool call → approval prompt → approval result" stays three consecutive lines, for both
  // the main Agent and subagents (messages arriving via the async pipeline may lag behind the
  // approval callback, hence render-in-place plus de-duplication of the copy).
  //
  // Serialization: the parent session and a run_subagent child session share this callback and
  // may request approval concurrently (the parent is waiting on one approval while an
  // already-approved child session starts its own). Concurrent prompts would clobber the same
  // Q&A state and fight over the same stdin (one answer resolving two questions, leaving the
  // other permanently stuck); a promise chain queues them so only one question is asked at a
  // time.
  let promptChain: Promise<unknown> = Promise.resolve();
  const interactivePrompt: ApproveFn = (tc) => {
    const result = promptChain.then(async () => {
      opts.renderer.beginUserPrompt(tc);
      try {
        const decision = await basePrompt(tc);
        opts.renderer.noteApprovalDecision(tc, decision);
        return decision;
      } finally {
        opts.renderer.endUserPrompt();
      }
    });
    promptChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const approveByMode = makeApprove({
    mode: opts.mode ?? "allow-all",
    toolPermission: (name) => session.toolPermission(name),
    interactivePrompt,
  });
  // The auto-approval path (allow-all / deny-all / read-only approvals) has no prompt: it
  // likewise renders the "call line → approval result" pair in place; the interactive path's
  // already-rendered copy is idempotently de-duplicated inside note.
  const approve: ApproveFn = async (tc) => {
    const decision = await approveByMode(tc);
    opts.renderer.noteApprovalDecision(tc, decision);
    return decision;
  };

  // A single run drives the whole ReAct loop (the engine requests approval per call and runs
  // tools concurrently within a turn). Once the task ends (including on error), endTask
  // prints this task's stats (context/Token/elapsed time). The engine collapses failures
  // (auth errors, reconnect exhausted, etc.) into a main-session abort event rather than
  // throwing; the result reported here reflects that, for `penguin run` to map to
  // an exit code.
  const startedAt = Date.now();
  let aborted = false;
  try {
    for await (const msg of session.run(prompt, {
      approve,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })) {
      if (isEventMessage(msg) && msg.payload.type === "abort" && (msg.origin?.length ?? 0) === 0) {
        aborted = true;
      }
      opts.renderer.handle(msg);
    }
  } finally {
    opts.renderer.endTask(Date.now() - startedAt);
  }
  return { aborted };
}
