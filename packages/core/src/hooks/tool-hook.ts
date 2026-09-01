/**
 * Pre-tool-use hooks — consulted by `context_engine` once per complete tool call, BEFORE
 * the approval boundary. A hook is told which call is up (name, id, raw argument JSON) plus
 * where the Session's record is, and answers with a decision: `deny` refuses the call (the
 * model reads the hook's reason in the denied output), `allow` approves it without asking
 * the host, no answer leaves the call to the normal approval flow. The first decision wins;
 * every non-void answer is recorded as one `hook` event on the stream and in the Trace. A
 * hook that throws is recorded with the error as its reason and treated as having no
 * opinion.
 *
 * Two boundaries hold by construction: the project command policy outranks a hook `allow`
 * (the Session downgrades a policy-vetoed allow before the engine sees it — hook packages
 * live in agent-writable state and must not override Project-owned security config), and a
 * `deny` can only ever narrow what would have run.
 *
 * Hooks installed into an Agent's `agent_state/hooks/` are scripts run through
 * script-hook.ts; the in-process interface here is what SDK embedders and tests register
 * directly. Docs: /docs/agent-loop § "Hooks".
 */
import { hookEvent } from "../omnimessage/index.js";
import type { PreToolUseOutcome } from "../interfaces/index.js";

/** What a pre-tool-use hook is told: the call under decision, and where the Session's record is. */
export interface PreToolUseHookInput {
  sessionId: string;
  /** Absolute path of the Trace file being written (absent for a Trace-less Session). */
  tracePath?: string;
  toolName: string;
  toolCallId: string;
  /** The call's raw argument JSON, as the model wrote it. */
  argumentsJson: string;
  signal?: AbortSignal;
}

/** A pre-tool-use hook's answer; `undefined` (no answer) means "no opinion, nothing to record". */
export interface PreToolUseHookResult {
  /** `deny` refuses the call with `reason` in its output; `allow` approves without asking the host. Omitted: the hook only leaves a record. */
  decision?: "allow" | "deny";
  /** One line for people — the `hook` event carries it, and a deny puts it in the denied output. */
  reason?: string;
  /** The hook's own structured record, scalars only — the `hook` event carries it. */
  output?: Record<string, string | number | boolean>;
}

/** A named pre-tool-use hook. The name identifies its `hook` events and the denied output line. */
export interface PreToolUseHook {
  name: string;
  run(input: PreToolUseHookInput): Promise<PreToolUseHookResult | void>;
}

/**
 * Runs the pre-tool-use hooks in registration order and turns every non-void answer into a
 * `hook` event. The first decision wins; later answers are recorded but not honored. A
 * throwing hook is recorded with the error as its reason.
 */
export async function runPreToolUseHooks(
  hooks: readonly PreToolUseHook[],
  input: PreToolUseHookInput,
): Promise<PreToolUseOutcome> {
  const outcome: PreToolUseOutcome = { events: [], decision: null };
  for (const hook of hooks) {
    let result: PreToolUseHookResult | void;
    try {
      result = await hook.run(input);
    } catch (err) {
      result = { reason: `hook failed: ${errorMessage(err)}` };
    }
    if (!result) continue;
    if (outcome.decision === null && (result.decision === "allow" || result.decision === "deny")) {
      outcome.decision = result.decision;
      outcome.name = hook.name;
      if (result.reason !== undefined) outcome.reason = result.reason;
    }
    outcome.events.push(
      hookEvent({
        hook: "pre_tool_use",
        name: hook.name,
        ...(result.decision !== undefined ? { decision: result.decision } : {}),
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
        ...(result.output !== undefined ? { output: result.output } : {}),
      }),
    );
  }
  return outcome;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
