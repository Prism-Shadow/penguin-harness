/**
 * Thinking-level control (pure logic, shared by chat's `/thinking`, the `--thinking`
 * startup flag on run/chat, and unit tests).
 *
 * The selectable levels are core's DEFAULT_CHAT_THINKING_LEVELS (low/medium/high/xhigh/max),
 * mirroring the web pickers: "none" stays a valid stored config value but is never offered
 * for selection (many models cannot disable thinking).
 *
 * Semantics (aligned with the web active-session picker; the thinking level is the
 * SOFT-limited runtime parameter):
 * - `--thinking <level>` pins the Session (a PATCH on it, so spawned subagent sessions
 *   follow it too). Core applies the pin from the Session's next LLM request, and every
 *   context opened from then on defaults to it.
 * - `/thinking <level>` re-pins the Session the same way; the reply advises `/compact`
 *   first, because a mid-context change invalidates the provider's cached context. It
 *   never writes back to the Agent config.
 * - `/thinking` bare shows the Session's pinned level, else the Agent's configured level.
 */
import { DEFAULT_CHAT_THINKING_LEVELS } from "@prismshadow/penguin-core";
import type { DefaultChatThinkingLevel, ThinkingLevelName } from "@prismshadow/penguin-core";
import type { Messages } from "./i18n.js";

/** Parses one level token (trimmed, case-insensitive); null when it is not a selectable level. */
export function parseThinkingLevel(text: string): DefaultChatThinkingLevel | null {
  const v = text.trim().toLowerCase();
  return (DEFAULT_CHAT_THINKING_LEVELS as readonly string[]).includes(v)
    ? (v as DefaultChatThinkingLevel)
    : null;
}

export type ThinkingCommandResult =
  /** `level` null = bare `/thinking`: show the current level. */
  { ok: true; level: DefaultChatThinkingLevel | null } | { ok: false; value: string };

/** Parses a full `/thinking…` chat line (the caller has already matched the `/thinking` prefix). */
export function parseThinkingCommand(line: string): ThinkingCommandResult {
  const rest = line.trim().slice("/thinking".length).trim();
  if (rest === "") return { ok: true, level: null };
  const level = parseThinkingLevel(rest);
  if (level === null) return { ok: false, value: rest };
  return { ok: true, level };
}

/**
 * Resolve the `--thinking` startup flag: absent -> undefined (follow the config chain);
 * print a message and exit if the value is invalid (same contract as resolveApprovalMode).
 */
export function resolveThinkingLevel(
  thinking: string | undefined,
  t: Messages,
): DefaultChatThinkingLevel | undefined {
  if (thinking === undefined) return undefined;
  const level = parseThinkingLevel(thinking);
  if (level !== null) return level;
  process.stderr.write(`${t.thinkingInvalid(thinking)}\n`);
  process.exit(1);
}

/** The slices of Agent the fallback chain reads (structurally satisfied by core's Agent; keeps test doubles small). */
export interface ThinkingConfigSource {
  state: { systemConfig: { model?: { thinking_level?: ThinkingLevelName } } };
  projectConfig: { default_chat?: { thinking_level?: DefaultChatThinkingLevel } };
}

/**
 * The level a Session created without an explicit `thinkingLevel` runs at — the SAME chain
 * core resolves at Session creation (core/src/agent.ts `configuredThinkingLevel`, the single
 * rule; the web draft picker mirrors it too in features/chat/thinking-level.ts — keep the
 * sites in sync): the Agent's explicit `model.thinking_level` > the Project's
 * `default_chat.thinking_level` > the built-in "medium". Used only for DISPLAY (`/thinking`
 * with no argument); runs without an override simply omit the parameter so core's own
 * fallback stays authoritative.
 */
export function configuredThinkingLevel(agent: ThinkingConfigSource): ThinkingLevelName {
  return (
    agent.state.systemConfig.model?.thinking_level ??
    agent.projectConfig.default_chat?.thinking_level ??
    "medium"
  );
}
