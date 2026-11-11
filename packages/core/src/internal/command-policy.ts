/**
 * Command policy — the project-level sandbox guardrail for shell commands.
 *
 * A rule list the Session applies to the **injected approval callback**: `Session.run` wraps
 * `RunOptions.approve` with `withCommandPolicy`, and each rule says what a hit does. A `deny`
 * hit answers "forbidden" without the human being consulted; an `ask` hit is handed to
 * `approve` with a policy reason (`{ reason: { kind: "policy", rule } }`), which the host
 * answers by putting the call to a person whatever its approval mode. Either way the policy
 * outranks every approval mode, allow-all included. Nothing about it reaches
 * `context_engine`, which keeps doing what it always did — ask the approval boundary with the
 * call alone, record the decision, feed a denied call its terminal output — and never reads
 * the policy or the reason.
 *
 * A `deny` hit outranks an `ask` hit wherever the two sit in the list: the settings page puts a
 * new rule at the head of the list and offers no reordering, so letting list order decide
 * between the two would let an added `ask` rule turn a factory refusal into a question.
 * Within one action the first match in list order is the rule a decision names.
 *
 * A child Session wraps the callback it was forwarded the same way, and that callback is the
 * parent's own wrapper: the child's `ask` hit travels with its reason through the child's
 * approval queue to the parent's wrapper, which matches it again (or, matching nothing, passes
 * the reason on untouched) and hands it to the host's callback. The host's session-lifetime
 * fallback sink for child approvals is wrapped too (Session.setSubagentApprovalFallback), so a
 * call routed there cannot walk past an `ask` rule either.
 *
 * Both tools that reach a shell are checked: `exec_command`'s `cmd` (the launch, read through
 * the tool's own argument list so its `command` alias is screened the same) and
 * `input_command`'s `chars` (what gets typed into an already-running one). Guarding only the
 * first would have made the guardrail exactly one interpreter launch deep — start `bash`,
 * which matches nothing, then type. The one exemption is a lone `\u0003`, which the tool
 * turns into SIGINT rather than writing it to stdin.
 *
 * The config lives in `.project_config.toml` (`[command_policy]`) — Project-owned on purpose:
 * security policy belongs to the Project, not to Agent State the Agent itself can rewrite.
 * The Session receives a policy SOURCE — a getter answering with the policy of the model
 * context it is running, read from disk once when each context opens: command policy is
 * strict-tier, so an edit applies when the next context opens (rotation), never mid-file.
 * The getter is still consulted per decision, which is what hands the tool calls after a
 * mid-run rotation the new context's policy without any reload machinery.
 *
 * The rules are **data, not code**: every rule (name / pattern / description / enabled / action) is
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
import type {
  ApproveFn,
  CommandPolicyAction,
  CommandPolicyConfig,
  CommandPolicyRule,
} from "../interfaces/index.js";
import { effectiveCommandPolicyRules } from "../state/command-policy-defaults.js";
import { commandPolicyPatternError } from "./command-policy-pattern.js";
import {
  EXEC_COMMAND_NAME,
  EXEC_COMMAND_TEXT_ARGUMENTS,
} from "../environment/tools/exec-command.js";
import { INPUT_COMMAND_NAME, INTERRUPT } from "../environment/tools/input-command.js";
import { stringArgument } from "../environment/tools/tool-arguments.js";

/** A command-policy hit: the matched rule's name, and what the hit does. */
export interface CommandPolicyVeto {
  rule: string;
  action: CommandPolicyAction;
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

/** The rules already reported as skipped, by name and pattern: each is said once per process. */
const reportedSkips = new Set<string>();

/**
 * Compiles a rule's pattern, returning null for one this engine cannot compile instead of
 * throwing: a broken rule must not take the whole policy (or the Session) down with it. Write
 * paths validate patterns up front (the server refuses an uncompilable rule), so this fires
 * for hand-placed data, and for a pattern saved where one engine accepted it and read where
 * another does not.
 *
 * Such a rule is skipped, not counted as a hit: the policy is an accident guardrail, and a
 * broken `deny` rule that matched everything would refuse every shell command until someone
 * found it. Skipping is not silent, though — the process logs it once per rule and pattern
 * (the server's log, inside the server), naming the runtime, and the settings page marks the
 * rule from the server's own read of it.
 */
function compileRule(rule: CommandPolicyRule): RegExp | null {
  const reason = commandPolicyPatternError(rule.pattern);
  if (reason === null) return new RegExp(rule.pattern);
  const key = `${rule.name}\u0000${rule.pattern}`;
  if (!reportedSkips.has(key)) {
    reportedSkips.add(key);
    console.warn(
      `[command-policy] Rule "${rule.name}" is skipped: its pattern does not compile on Node ${process.version} (${reason}).`,
    );
  }
  return null;
}

/**
 * Evaluates one command against the policy: an enabled `deny` rule that matches wins over any
 * `ask` rule that matches, wherever the two sit in the list (see the header); within one
 * action the first match in list order is the one reported. Returns null when the policy is
 * disabled or nothing matches. An absent config or an absent `rules` list means the factory
 * set (a project from before the block was seeded, or an SDK embedder passing no policy).
 */
export function evaluateCommandPolicy(
  cmd: string,
  policy?: CommandPolicyConfig,
): CommandPolicyVeto | null {
  if (policy?.enabled === false) return null;
  const variants = commandVariants(cmd);
  if (variants[0] === "") return null;
  let ask: CommandPolicyVeto | null = null;
  for (const rule of effectiveCommandPolicyRules(policy)) {
    if (rule.enabled === false) continue;
    const action = rule.action ?? "deny";
    // An ask hit is already in hand: only a deny rule can still change the answer.
    if (ask !== null && action === "ask") continue;
    const re = compileRule(rule);
    if (re && variants.some((v) => re.test(v))) {
      if (action === "deny") return { rule: rule.name, action };
      ask = { rule: rule.name, action };
    }
  }
  return ask;
}

/**
 * The arguments that carry shell text, per tool, in the order the tool itself reads them:
 * `exec_command` launches one (`cmd`, or its alias `command`) and `input_command` types into
 * one already running (`chars`). Sharing the tool's own list is what keeps the screened text
 * and the executed text one value. Every other tool — MCP included — is not the policy's
 * business.
 */
const SHELL_TEXT_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  [EXEC_COMMAND_NAME]: EXEC_COMMAND_TEXT_ARGUMENTS,
  [INPUT_COMMAND_NAME]: ["chars"],
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
  const names = SHELL_TEXT_ARGUMENTS[toolName];
  if (names === undefined) return null;
  let args: unknown;
  try {
    args = JSON.parse(argsJson) as unknown;
  } catch {
    return null;
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
  const text = stringArgument(args as Record<string, unknown>, names)?.value;
  if (text === undefined) return null;
  if (text === INTERRUPT) return null;
  return evaluateCommandPolicy(text, policy);
}

/** Where the policy comes from at decision time: a getter answering with the running context's policy (see SessionConfig.commandPolicy) — consulted per approval, so a mid-run rotation swaps what later calls see. */
export type CommandPolicySource = () => CommandPolicyConfig | undefined;

/**
 * Wraps an approval callback with the policy. A call a `deny` rule matches answers
 * `"forbidden"` here and `approve` is never reached, so no approval mode — and no Human
 * implementation — can let it through. `"forbidden"` is the decision's own third value: the
 * engine renders it as the fixed aborted line "Tool call denied by policy." (a person's denial
 * reads "by user."), and the `approval_decision` event carries it — the model's text and the
 * Trace both name the decider. A call an `ask` rule matches goes to `approve` with
 * `{ reason: { kind: "policy", rule } }`, which tells the host the mode alone may not answer
 * it (allow-all would wave it through); a host callback that reads no second argument decides
 * it as for any call. Any other call goes to `approve` with the context it came with, so a
 * reason a child's wrapper attached survives the parent's. The `source` getter is consulted
 * at every decision (no source, or a source yielding nothing, applies the factory rule set); a
 * source that cannot be read fails toward the factory rules rather than waving the call
 * through.
 */
export function withCommandPolicy(approve: ApproveFn, source?: CommandPolicySource): ApproveFn {
  return async (toolCall, context) => {
    let policy: CommandPolicyConfig | undefined;
    try {
      policy = source?.();
    } catch {
      policy = undefined;
    }
    const veto = vetoForToolCall(toolCall.payload.name, toolCall.payload.arguments, policy);
    if (veto?.action === "deny") return "forbidden";
    if (veto?.action === "ask") {
      return approve(toolCall, { reason: { kind: "policy", rule: veto.rule } });
    }
    // Forwarded as it came: an ordinary call still reaches `approve` with the call alone.
    return context === undefined ? approve(toolCall) : approve(toolCall, context);
  };
}
