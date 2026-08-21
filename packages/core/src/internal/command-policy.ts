/**
 * Command policy — the project-level sandbox guardrail for shell commands.
 *
 * A deny-rule list the Session applies to the **injected approval callback**: `Session.run`
 * wraps `RunOptions.approve` with `withCommandPolicy`, so a matching command answers "deny"
 * without the human being consulted, and the policy therefore outranks every approval mode,
 * allow-all included. Nothing about it reaches `context_engine`, which keeps doing what it
 * always did — ask the approval boundary, record the decision, feed a denied call its
 * terminal output.
 *
 * Both tools that reach a shell are checked: `exec_command`'s `cmd` (the launch) and
 * `input_command`'s `chars` (what gets typed into an already-running one). Guarding only the
 * first would have made the guardrail exactly one interpreter launch deep — start `bash`,
 * which matches nothing, then type. The one exemption is a lone `\u0003`, which the tool
 * turns into SIGINT rather than writing it to stdin.
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
 * This is an **accident guardrail, not a security boundary**, and the distinction is not
 * modesty: shell is a programming language, and deciding what a program will do by matching
 * its text before it runs is not a thing more rules get closer to. What the rules do cover is
 * ordinary typing — a path (`/bin/rm`), a wrapper (`sudo`, `env`, `xargs`), quoting or a
 * backslash escape of the command word, and a literal `sh -c '<payload>'` — because those are
 * spellings a model reaches for by habit, not evasion. What they deliberately do not cover is
 * anything that computes the command at run time: `$IFS` splicing, `X=rm; $X`, `eval`,
 * base64 into a shell, `python -c`, an interpreter reached through a pipe. Each of those
 * would take a pattern that costs maintenance and buys only the appearance of coverage.
 *
 * MCP tools are out of scope by design. The per-server `permission` level is what exists for
 * that surface, and it only fixes the level a Server's tools report to the approval mode — it
 * confines nothing. For an actual boundary rather than a speed bump, the
 * confinement interface (bubblewrap / dsh) is the mechanism; this policy is complementary to
 * it and no substitute.
 * Docs: /docs/configuration § "Command policy".
 */
import type { ApproveFn, CommandPolicyConfig, CommandPolicyRule } from "../interfaces.js";
import { effectiveCommandPolicyRules } from "../state/command-policy-defaults.js";
import { EXEC_COMMAND_NAME } from "../environment/tools/exec-command.js";
import { INPUT_COMMAND_NAME, INTERRUPT } from "../environment/tools/input-command.js";

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
 * The spellings a rule is tested against: the command as written, plus — when it differs —
 * the same text with shell quoting removed (`'` / `"` dropped, `\x` reduced to `x`). Quoting
 * is where the plain spellings hide: `"rm" -rf /`, `r''m -rf /`, `\rm -rf /`, and the literal
 * `sh -c 'rm -rf /'` are all the unquoted text once the marks come off. Both are tested, so
 * unquoting can only add matches, never drop one a rule would otherwise make.
 *
 * This is a normalization, not an evaluation: it does not expand a variable, run a
 * substitution, or decode anything, so a command assembled at run time still walks past.
 */
function commandVariants(cmd: string): string[] {
  const literal = normalizeCommand(cmd);
  const unquoted = normalizeCommand(cmd.replace(/\\(.)/g, "$1").replace(/['"]/g, ""));
  return unquoted === literal ? [literal] : [literal, unquoted];
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
  const variants = commandVariants(cmd);
  if (variants[0] === "") return null;
  for (const rule of effectiveCommandPolicyRules(policy)) {
    if (rule.enabled === false) continue;
    const re = compileRule(rule);
    if (re && variants.some((v) => re.test(v))) {
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
 * The argument that carries shell text, per tool: `exec_command` launches one (`cmd`) and
 * `input_command` types into one already running (`chars`). Every other tool — MCP included —
 * is not the policy's business.
 */
const SHELL_TEXT_ARGUMENT: Readonly<Record<string, string>> = {
  [EXEC_COMMAND_NAME]: "cmd",
  [INPUT_COMMAND_NAME]: "chars",
};

/**
 * Policy gate for one tool call, keyed by tool name: the tool's shell-text argument is
 * evaluated, and anything else passes. A lone `\u0003` is exempt — `input_command`
 * special-cases it into SIGINT rather than writing it to stdin, so it is a Ctrl-C, not a
 * command. `argsJson` is the tool_call's raw argument JSON; malformed JSON or a
 * malformed argument is the tool's own validation error, not a policy hit.
 */
export function vetoForToolCall(
  toolName: string,
  argsJson: string,
  policy?: CommandPolicyConfig,
): CommandPolicyVeto | null {
  const key = SHELL_TEXT_ARGUMENT[toolName];
  if (key === undefined) return null;
  let args: unknown;
  try {
    args = JSON.parse(argsJson) as unknown;
  } catch {
    return null;
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const text = (args as Record<string, unknown>)[key];
  if (typeof text !== "string") return null;
  if (text === INTERRUPT) return null;
  return evaluateCommandPolicy(text, policy);
}

/**
 * Wraps an approval callback with the policy: a vetoed call is refused here and `approve`
 * is never reached, so no approval mode — and no Human implementation — can let it
 * through. The refusal carries its own reason, which is what keeps it distinguishable from
 * a person canceling the call: `failed` tells the model its request was rejected on its
 * merits and it should change course, where a human denial reports `aborted`. It also tags
 * itself `source: "policy"`, which the engine stamps onto the `approval_decision` event, so
 * the Trace records who denied without anyone parsing output text.
 */
export function withCommandPolicy(approve: ApproveFn, policy?: CommandPolicyConfig): ApproveFn {
  return async (toolCall) => {
    const veto = vetoForToolCall(toolCall.payload.name, toolCall.payload.arguments, policy);
    if (veto)
      return { decision: "deny", message: veto.message, stopReason: "failed", source: "policy" };
    return approve(toolCall);
  };
}
