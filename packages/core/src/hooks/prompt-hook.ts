/**
 * User-prompt hooks — the prompt-expansion point. Core runs them (hooks never run anywhere
 * else); the host triggers the run through `Session.runUserPromptHook` when it accepts a
 * user prompt for the flow the hook's package owns — goal mode's start is the shipped use:
 * the server asks the Session to run the goal package's hook with the objective and budget,
 * and sends the answered `context` right behind the user's own message, stamped
 * `sender: "harness"`. The expansion message itself is the record; no `hook` event is
 * written for this point.
 */
export interface UserPromptHookInput {
  sessionId: string;
  /** The Session's scratchpad directory (where a hook keeps per-session state, e.g. GOAL.json). */
  scratchpadDir: string;
  /** The user's prompt text (for goal mode: the objective, leading marker blocks stripped). */
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
  run(input: UserPromptHookInput): Promise<UserPromptHookResult | void>;
}
