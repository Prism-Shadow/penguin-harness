/**
 * User-prompt hooks — the prompt-expansion point: consulted every time the user submits a
 * Prompt. A hook is told the prompt text plus where the Session's record and scratchpad
 * are, and answers with a `context`: text the Session sends right behind the user's own
 * message as a user text stamped `sender: "harness"`, in hook order. That message is the
 * record — a successful answer leaves no `hook` event; a hook that fails is recorded as one,
 * with the error as its reason, and treated as having nothing to add, so a broken hook
 * never takes the run down.
 *
 * The consult rides the engine's seam (`RunOptions.userPrompt`), which places the records
 * right behind the Prompt on the stream and in the Trace, and runs for a `run` whose input
 * carries text of the user's own: a harness, server or parent-agent input is not a Prompt
 * the user submitted, and neither is a stop hook's continuation.
 *
 * A hook marked `trigger: "host"` stays out of that consult. It belongs to a flow the host
 * starts by name through `Session.runUserPromptHook` — goal mode's start is the shipped use:
 * the server asks the Session to run the goal package's hook with the objective and budget,
 * and sends the answered `context` itself.
 *
 * Hooks installed into an Agent's `agent_state/hooks/` are scripts run through
 * script-hook.ts; the in-process interface here is what SDK embedders and tests register
 * directly. Docs: /docs/agent-loop § "User-prompt hooks".
 */
import { hookEvent, userText } from "../omnimessage/index.js";
import type { UserPromptOutcome } from "../interfaces/index.js";
import type { UserPromptTrigger } from "../plugins/index.js";
import { failedAnswer } from "./answer.js";

export interface UserPromptHookInput {
  sessionId: string;
  /** Absolute path of the Trace file being written (absent for a Trace-less Session). */
  tracePath?: string;
  /** The Session's scratchpad directory (where a hook keeps per-session state, e.g. GOAL.json). */
  scratchpadDir: string;
  /** The user's prompt text, leading marker blocks stripped (for goal mode: the objective). */
  prompt: string;
  /** Flow-specific scalar fields the host adds beside the fixed ones (goal mode: `budget`). */
  extras?: Record<string, string | number | boolean>;
  signal?: AbortSignal;
}

/** A user-prompt hook's answer: the text to send after the user's message; empty/absent = nothing to add. */
export interface UserPromptHookResult {
  context?: string;
}

/** A named user-prompt hook (the name is its package's). */
export interface UserPromptHook {
  name: string;
  /** When the hook runs; absent = `prompt`, on every Prompt the user submits. */
  trigger?: UserPromptTrigger;
  run(input: UserPromptHookInput): Promise<UserPromptHookResult | void>;
}

/**
 * Runs the user-prompt hooks in registration order and turns what they answered into
 * records: a harness-stamped user text for every non-empty `context`, a `hook` event for
 * every hook that threw. An aborted signal ends the pass — what a killed script reports is
 * the interruption, not a failure of the hook.
 */
export async function runUserPromptHooks(
  hooks: readonly UserPromptHook[],
  input: UserPromptHookInput,
): Promise<UserPromptOutcome> {
  const outcome: UserPromptOutcome = { records: [] };
  for (const hook of hooks) {
    if (input.signal?.aborted) break;
    let result: UserPromptHookResult | void;
    try {
      result = await hook.run(input);
    } catch (err) {
      if (input.signal?.aborted) break;
      outcome.records.push(
        hookEvent({ hook: "user_prompt", name: hook.name, ...failedAnswer(err) }),
      );
      continue;
    }
    const context = result?.context;
    if (typeof context === "string" && context.trim() !== "") {
      outcome.records.push(userText(context, "harness"));
    }
  }
  return outcome;
}
