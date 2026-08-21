/**
 * Command policy — the project-level sandbox guardrail for shell commands.
 *
 * A deny-rule list the Session applies to the **injected approval callback**: `Session.run`
 * wraps `RunOptions.approve` with `withCommandPolicy`, so a matching `exec_command` launch
 * answers "deny" without the human being consulted, and the policy therefore outranks every
 * approval mode, allow-all included. Nothing about it reaches `context_engine`, which keeps
 * doing what it always did — ask the approval boundary, record the decision, feed a denied
 * call its terminal output.
 *
 * The config lives in `.project_config.toml` (`[command_policy]`) — Project-owned on purpose:
 * security policy belongs to the Project, not to Agent State the Agent itself can rewrite.
 * The Session receives a parsed snapshot at creation, so the running Session's policy cannot
 * be edited from inside the Session.
 *
 * The rules are **data, not code**: every rule (name / pattern / description / enabled) is
 * project-editable, and the factory set (state/command-policy-defaults.ts) is *seeded* into
 * new projects' config the same way model presets are — copied in at creation, never
 * rewritten afterward. A config without a `rules` list behaves as the factory set
 * (pre-seeding projects); the first saved edit materializes the list into the file.
 *
 * This is an **accident guardrail, not a security boundary**: matching is normalized-text
 * regex over the launch command (`exec_command`'s `cmd`), so it stops the classic
 * destructive one-liners typed verbatim and little else. A path (`/bin/rm -rf /`), a quoted
 * or `$IFS`-spliced spelling, `sh -c`, `xargs`, base64, a second command after `;`, or
 * typing into an already-running shell via `input_command` all walk straight past it — a
 * pattern matcher over shell syntax cannot be made to hold, and this one does not try.
 * Docs: /docs/configuration § "Command policy".
 */
import type { ApproveFn, CommandPolicyConfig, CommandPolicyRule } from "../interfaces.js";
import { effectiveCommandPolicyRules } from "../state/command-policy-defaults.js";
import { EXEC_COMMAND_NAME } from "../environment/tools/exec-command.js";

/** A command-policy hit: the matched rule's name plus the denial text fed back to the model. */
export interface CommandPolicyVeto {
  rule: string;
  message: string;
}

/** Collapses whitespace runs to single spaces (the only normalization rule patterns may assume). */
function normalizeCommand(cmd: string): string {
  return cmd.replace(/\s+/g, " ").trim();
}

/**
 * Compiles a rule's pattern, returning null for an invalid regex instead of throwing: a
 * broken rule must not take the whole policy (or the Session) down with it. Write paths
 * validate patterns up front (the server rejects an uncompilable rule), so this only fires
 * for hand-placed data.
 */
function compileRule(rule: CommandPolicyRule): RegExp | null {
  try {
    return new RegExp(rule.pattern);
  } catch {
    return null;
  }
}

/**
 * Evaluates one command against the policy: the first matching enabled rule wins, in list
 * order. Returns null when the policy is disabled or nothing matches. An absent config or
 * an absent `rules` list means the factory set (a project from before the block was
 * seeded, or an SDK embedder passing no policy).
 */
export function evaluateCommandPolicy(
  cmd: string,
  policy?: CommandPolicyConfig,
): CommandPolicyVeto | null {
  if (policy?.enabled === false) return null;
  const normalized = normalizeCommand(cmd);
  if (normalized === "") return null;
  for (const rule of effectiveCommandPolicyRules(policy)) {
    if (rule.enabled === false) continue;
    const re = compileRule(rule);
    if (re && re.test(normalized)) {
      return {
        rule: rule.name,
        message:
          `Command blocked by the project sandbox policy (rule: ${rule.name}). ` +
          "The policy outranks the approval mode, so approving cannot unblock it. " +
          "Do not retry the same command; take a safer approach, or ask the user to " +
          "adjust the policy in Project Settings.",
      };
    }
  }
  return null;
}

/**
 * Policy gate for one tool call, keyed by tool name: only `exec_command` launches carry a
 * command to evaluate (`cmd`). `input_command` keystrokes are deliberately out of scope —
 * the guardrail covers the spawn path, not interactive typing (see module header).
 * `argsJson` is the tool_call's raw argument JSON; malformed JSON or a malformed `cmd` is
 * the tool's own validation error, not a policy hit.
 */
export function vetoForToolCall(
  toolName: string,
  argsJson: string,
  policy?: CommandPolicyConfig,
): CommandPolicyVeto | null {
  if (toolName !== EXEC_COMMAND_NAME) return null;
  let args: unknown;
  try {
    args = JSON.parse(argsJson) as unknown;
  } catch {
    return null;
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const cmd = (args as Record<string, unknown>)["cmd"];
  if (typeof cmd !== "string") return null;
  return evaluateCommandPolicy(cmd, policy);
}

/**
 * Wraps an approval callback with the policy: a vetoed call is refused here and `approve`
 * is never reached, so no approval mode — and no Human implementation — can let it
 * through. The refusal carries its own reason, which is what keeps it distinguishable from
 * a person canceling the call: `failed` tells the model its request was rejected on its
 * merits and it should change course, where a human denial reports `aborted`.
 */
export function withCommandPolicy(approve: ApproveFn, policy?: CommandPolicyConfig): ApproveFn {
  return async (toolCall) => {
    const veto = vetoForToolCall(toolCall.payload.name, toolCall.payload.arguments, policy);
    if (veto) return { decision: "deny", message: veto.message, stopReason: "failed" };
    return approve(toolCall);
  };
}
