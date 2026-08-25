/**
 * collectWindow —— yield-window collector shared by run_subagent / input_subagent.
 *
 * Within the `yieldMs` window, emits child-session output in real time: buffered child-session
 * messages (already origin-tagged, passed through to the frontend) and subagent text deltas
 * (fed back to the LLM as this parent tool's own output delta). The window also hooks up an
 * approval outlet, forwarding the child session's queued approval requests one by one to the
 * Human via `approve`. The window ends on "run finished / signal abort / deadline reached", and
 * does a final drain right before ending (to catch the tail buffer at the moment the run
 * finishes). Deciding the end state and finalizing are the caller's responsibility.
 */
import { partialToolCallOutput } from "../../../omnimessage/index.js";
import type { OmniMessage } from "../../../omnimessage/index.js";
import type { ApproveFn } from "../../../interfaces/index.js";
import type { ManagedSubagentSession } from "./session.js";

export async function* collectWindow(
  session: ManagedSubagentSession,
  opts: {
    yieldMs: number;
    toolCallId: string;
    signal?: AbortSignal;
    approve?: ApproveFn;
    /**
     * Whether the child's text deltas mirror into this tool's own output (default true —
     * run_subagent's launch window streams the forming answer live). input_subagent passes
     * false: its model-facing output is the child's latest COMPLETE assistant text, emitted
     * once at the end, so every access reads as "what it last said" instead of an
     * incremental delta drain. The buffer still drains either way (bounded memory).
     */
    includeText?: boolean;
  },
): AsyncGenerator<OmniMessage> {
  const { yieldMs, toolCallId, signal, approve } = opts;
  const includeText = opts.includeText ?? true;
  const delta = (output: string): OmniMessage =>
    partialToolCallOutput({ eventType: "delta", output, toolCallId });
  const detach = approve ? session.attachApprovalSink(approve) : null;
  // abort only ends this window (whether to kill the child session is up to the caller);
  // wakes up a pending waitWake so it returns immediately.
  const onAbort = (): void => session.wakeup();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const start = Date.now();
    for (;;) {
      for (const m of session.drainMessages()) yield m;
      const text = session.drainText();
      if (text && includeText) yield delta(text);
      if (!session.running) break;
      if (signal?.aborted) break;
      const remaining = yieldMs - (Date.now() - start);
      if (remaining <= 0) break;
      // Re-check the predicate before sleeping: output arriving while `yield` is suspended
      // would fire its wakeup before this wait even starts, and get missed otherwise.
      if (session.hasPending) continue;
      await session.waitWake(remaining);
    }
    // Final drain: there may still be a tail buffer right when the run finishes/yields.
    for (const m of session.drainMessages()) yield m;
    const tail = session.drainText();
    if (tail && includeText) yield delta(tail);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    detach?.();
  }
}
