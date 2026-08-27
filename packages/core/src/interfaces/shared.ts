/**
 * Vocabulary both sides of the engine share.
 *
 * These are the types that resist the LLM/Environment split because both contracts genuinely
 * need them: the tool schema Environment produces and the LLM consumes, the thinking level a
 * Session sets and both a request and a spawned child carry, and the approval callback that
 * touches all three boundaries (Human answers it, the engine calls it, Environment forwards
 * it to derived sessions).
 *
 * Docs: packages/docs/content/interfaces.{zh,en}.md (site path /docs/interfaces).
 */
import type {
  ApprovalDecision,
  ErrorCode,
  OmniMessage,
  ToolCallPayload,
} from "../omnimessage/types.js";

// ToolDefinition is defined in omnimessage/types.ts (the tool_list_ready event carries the full tool schema); re-exported here to keep the original import path.
export type { ToolDefinition } from "../omnimessage/types.js";

/** Thinking level of one request. Shared: the LLM takes it per request and as a construction default, and a spawned child Session inherits or overrides it. */
export type ThinkingLevelName = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * How a run was cut off early, returned as the **return value** of the run generators
 * (`ContextEngine.run` / `Session.run` / `SubagentHandle.run`): `null` means the run ran
 * to completion. The engine knows which exit it took, so consumers that must not treat a
 * cut-off run as finished (the goal loop deciding whether to re-fire a round, a subagent
 * round reporting completion) read this instead of re-deriving it from the stream —
 * failures emit no abort event, only their terminal request_end / compaction_end records.
 * `abort` is a user interruption; `llm_failure` a terminal LLM request failure;
 * `compaction_failure` a compaction given up mid-task (at a Task boundary the same
 * failure is advisory and the run returns null). The error pair mirrors the terminal
 * record's `error_code` / `error_message`.
 */
export interface RunCutoff {
  kind: "abort" | "llm_failure" | "compaction_failure";
  errorCode?: ErrorCode;
  errorMessage?: string;
}

/**
 * Per-tool approval callback: the Human boundary gives allow/deny for each complete `tool_call`.
 * `context_engine` calls it once per tool call within a turn. Subagents forward the parent's
 * approval callback, so the child Agent **inherits the parent Agent's approval mode**.
 * The third decision, `"forbidden"`, is never a host's answer: `Session.run` wraps the
 * injected callback with the project sandbox command policy (see {@link CommandPolicyConfig}),
 * and a vetoed call answers `"forbidden"` without the wrapped callback being consulted.
 * Docs: /docs/interfaces § "ApproveFn".
 */
export type ApproveFn = (toolCall: OmniMessage<ToolCallPayload>) => Promise<ApprovalDecision>;

/**
 * One command-policy deny rule — plain project-editable data: a name (identifies the rule
 * in the settings UI), a regex source tested against the whitespace-normalized command, an
 * optional free-text description, and a per-rule switch.
 * Docs: /docs/configuration § "Command policy".
 */
export interface CommandPolicyRule {
  name: string;
  /** JavaScript regex source (no flags). */
  pattern: string;
  /** What the rule catches (free text, shown in the settings UI). */
  description?: string;
  /** Per-rule switch; absent = true. */
  enabled?: boolean;
}

/**
 * The project sandbox command policy (the `[command_policy]` block of
 * `.project_config.toml`, threaded into every Session the Agent creates). `Session.run`
 * wraps the injected approval callback with it, so a hit is denied without the human being
 * asked — under every approval mode. It is Project-owned security config, deliberately
 * outside Agent State so the Agent cannot rewrite it. The factory rule set is seeded into
 * new projects like model presets (copied at creation, never rewritten); an absent config
 * or an absent `rules` list means the factory set applies, and `enabled: false` switches
 * the whole policy off. An accident guardrail, not a security boundary — see
 * internal/command-policy.ts for what walks past it.
 * Docs: /docs/configuration § "Command policy".
 */
export interface CommandPolicyConfig {
  /** Master switch; absent = true. */
  enabled?: boolean;
  /** The deny-rule list, evaluated in order; absent = the factory set (a stored empty list means no rules). */
  rules?: CommandPolicyRule[];
}
