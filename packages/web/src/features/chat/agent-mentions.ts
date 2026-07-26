/**
 * @-agent handoff for the chat input area (pure logic, shared by chat-input.tsx /
 * chat-page.tsx and unit tests). Only a **leading** @ is meaningful: a target picked from
 * the menu is pinned as a highlighted chip at the front of the input (the text itself
 * carries no @ marker); hand-typed/pasted text starting with `@<agentId>` takes effect the
 * same way on send. Any @ elsewhere in the text is plain text.
 * - `matchMention`: finds the `@` prefix currently being typed from the text before the
 *   caret, driving the agent-picker popup;
 * - `filterAgents`: filters candidates by prefix (agentId or display name, case-insensitive);
 * - `splitLeadingMention`: on send, parses a leading `@<agentId>`, splitting off the target
 *   agent from the remaining text.
 *
 * The origin **marker blocks** these flows produce and render — `[handoff_from]`,
 * `[scheduled_task]`, `[model_switch_from]` — are defined in core's marker module
 * (`@prismshadow/penguin-core/markers`) alongside every other message marker, and are
 * re-exported below under this feature's existing names.
 */
import { buildHandoffMessage, buildModelSwitchMessage } from "@prismshadow/penguin-core/markers";
import type { AgentSummary } from "@prismshadow/penguin-server/api";

export {
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
} from "@prismshadow/penguin-core/markers";
export type {
  HandoffOrigin,
  ModelSwitchOrigin,
  ScheduledOrigin,
} from "@prismshadow/penguin-core/markers";

/** First message of an @-handoff new conversation (core's `[handoff_from]` origin block). */
export const handoffMessage = buildHandoffMessage;
/** First message of a `/model` switch new conversation (core's `[model_switch_from]` origin block). */
export const modelSwitchMessage = buildModelSwitchMessage;

/** Id characters allowed between `@` and the caret (matches core's id convention: letters, digits, underscore, hyphen). */
const ID_PREFIX = /^[\w-]*$/;

/**
 * The @ mention currently being typed: `start` is the index of `@` in the full text,
 * `query` is the prefix between `@` and the caret, and `end` is the end position of the
 * same token to the right of the caret — selecting a candidate replaces the **entire**
 * `start..end` token (no leftover tail when the caret sits mid-token).
 */
export interface MentionMatch {
  start: number;
  end: number;
  query: string;
}

/**
 * Finds the @ mention currently being typed at the caret; returns null if none.
 * `@` must be at the start of the text or preceded by whitespace (to avoid treating
 * ordinary text like emails as mentions); only id characters are allowed between `@` and
 * the caret.
 */
export function matchMention(text: string, caret: number): MentionMatch | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null;
  const query = before.slice(at + 1);
  if (!ID_PREFIX.test(query)) return null;
  const rest = /^[\w-]*/.exec(text.slice(caret))![0];
  return { start: at, end: caret + rest.length, query };
}

/** Filters candidate agents by prefix (agentId or display name, case-insensitive); an empty prefix returns all. */
export function filterAgents(agents: AgentSummary[], query: string): AgentSummary[] {
  const q = query.toLowerCase();
  return agents.filter(
    (a) => a.agentId.toLowerCase().startsWith(q) || (a.name ?? "").toLowerCase().startsWith(q),
  );
}

/**
 * Parses a leading mention: when text (expected to already be trimmed) starts with
 * `@<existing agentId>`, splits off the target agent from the remaining text (the id is
 * the longest `[\w-]+` run after `@`, and must exactly match an existing agentId — `@foo2`
 * does not count as @-ing foo; leading whitespace in the remaining text is trimmed).
 * Returns null when the text doesn't start with an @ for an existing agent; an @ elsewhere
 * in the text is never parsed.
 */
export function splitLeadingMention(
  text: string,
  agents: AgentSummary[],
): { agent: AgentSummary; rest: string } | null {
  const m = /^@([\w-]+)([\s\S]*)$/.exec(text);
  if (!m) return null;
  const agent = agents.find((a) => a.agentId === m[1]);
  if (!agent) return null;
  return { agent, rest: m[2]!.trimStart() };
}
