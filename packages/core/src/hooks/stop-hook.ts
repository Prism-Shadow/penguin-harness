/**
 * Stop hooks — functions the Session runs after every Task of one `run` call, at the one
 * hook point the agent loop has today: **stop**, the moment a Task ends (the model's final
 * reply with no tool call, or a cutoff — user abort, LLM failure, the max_turns cap).
 *
 * A hook reads what it needs from its input (the current Trace file, how the Task ended,
 * the run's counters) and answers with a decision: `continue` keeps the run going — the
 * hook's `input` becomes the next Task's user message, inside the same `run` call — while
 * `stop` (or no answer at all) lets the run end. Every non-void answer is recorded as one
 * `hook` event message, streamed and written to the Trace; the injected input is not in
 * the event, it is the user message that follows it. The first `continue` wins; the
 * Session refuses to continue after a cutoff or once its signal is aborted (the answer is
 * still recorded). A hook that throws is recorded with the error as its reason and treated
 * as having no opinion, so a broken hook never takes the run down.
 *
 * Goal mode is one such hook (goal/goal-hook.ts); the skill-summary hook is another
 * (skill-summary-hook.ts). The loop that consults them is `Session.run`.
 * Docs: /docs/agent-loop § "Hooks".
 */
import { hookEvent, isEventMessage } from "../omnimessage/index.js";
import type { HookPayload, OmniMessage, StopReason } from "../omnimessage/index.js";
import type { ApproveFn } from "../interfaces/index.js";

/** What a stop hook is told about the Task that just ended and the run it belongs to. */
export interface StopHookInput {
  sessionId: string;
  /**
   * Absolute path of the Trace file the Session is writing right now — the current context
   * segment (compaction rotates to a new file). Absent for a Session without a Trace.
   * Hooks read the conversation, token usage and turn counts from it themselves.
   */
  tracePath?: string;
  /**
   * How the Task ended: `completed`, or a cutoff — `aborted` (user interruption) or `fatal`
   * (an LLM failure the run gave up on, a mid-task compaction failure, or the max_turns
   * cap). `retryable` never appears here: an exhausted reconnect ends the Task as `fatal`.
   */
  stopReason: StopReason;
  /** Tasks this `run` call has driven so far: 1 for the first, one more per hook-continued Task. */
  tasks: number;
  /**
   * Uncached input + output tokens this `run` call has consumed so far — every
   * `token_usage` on the stream counts `request.total − cache_read`, subagent sessions
   * included. A spend estimate, not a bill.
   */
  tokensUsed: number;
  /** Session cumulative LLM turns (completed requests, carried across compactions and resumes). */
  turns: number;
  /** The run's approval callback, for hooks that start work of their own (a spawned child Session inherits it). */
  approve?: ApproveFn;
  /** The run's abort signal. */
  signal?: AbortSignal;
}

/** A stop hook's answer; `undefined` (no answer) means "no opinion, nothing to record". */
export interface StopHookResult {
  /** `continue` keeps the run going with `input` as the next Task's user text; `stop` lets it end. Omitted: the hook only leaves a record. */
  decision?: "continue" | "stop";
  /** With `continue`: the next Task's user input text (a `continue` without one cannot continue and is recorded as-is). */
  input?: string;
  /** One line for people — the `hook` event carries it (hosts render it). */
  reason?: string;
  /** The hook's own structured record, scalars only — the `hook` event carries it for hosts and the Trace. */
  output?: Record<string, string | number | boolean>;
}

/** A named stop hook. The name identifies its `hook` events (e.g. `goal`, `skill_summary`). */
export interface StopHook {
  name: string;
  run(input: StopHookInput): Promise<StopHookResult | void>;
}

/** The hooks a Session is built with (`SessionConfig.hooks`); one list per hook point. */
export interface SessionHooks {
  stop?: StopHook[];
}

/**
 * A message's contribution to a run's token accounting: uncached input + output of one
 * request (`request.total − cache_read`), from any session — origin-marked subagent usage is
 * part of the run's cost. Cache reads cost money too, just a small fraction of the
 * uncached-input price, so leaving them out keeps the number an honest estimate without
 * per-model price tables. Hosts mirroring the number count exactly the same way.
 */
export function uncachedTokens(msg: OmniMessage): number {
  if (!isEventMessage(msg) || msg.payload.type !== "token_usage") return 0;
  const { total, cache_read } = msg.payload.request;
  return Math.max(0, total - cache_read);
}

/** What one pass over the stop hooks produced: the events to record, in hook order, and the first `continue`'s input (null = the run ends). */
export interface StopHooksOutcome {
  events: OmniMessage<HookPayload>[];
  next: string | null;
}

/**
 * Runs the stop hooks in registration order and turns every non-void answer into a `hook`
 * event. The first `continue` that carries an input decides the continuation; later ones
 * are recorded but not honored. A throwing hook is recorded with the error as its reason.
 */
export async function runStopHooks(
  hooks: readonly StopHook[],
  input: StopHookInput,
): Promise<StopHooksOutcome> {
  const events: OmniMessage<HookPayload>[] = [];
  let next: string | null = null;
  for (const hook of hooks) {
    let result: StopHookResult | void;
    try {
      result = await hook.run(input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { reason: `hook failed: ${message}` };
    }
    if (!result) continue;
    if (result.decision === "continue" && next === null && result.input) next = result.input;
    events.push(
      hookEvent({
        hook: "stop",
        name: hook.name,
        ...(result.decision !== undefined ? { decision: result.decision } : {}),
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(result.output !== undefined ? { output: result.output } : {}),
      }),
    );
  }
  return { events, next };
}
