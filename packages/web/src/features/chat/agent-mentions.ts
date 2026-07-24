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
 *   agent from the remaining text;
 * - `handoffMessage`: generates the first message for the @-mentioned agent's **new
 *   conversation** — an origin note (`[handoff_from]` block) carrying the source agent /
 *   Session / Workspace, followed by the user's text as a subsequent text part).
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";

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

/** Origin info for an @-handoff new conversation: source agent is always present; source Session is omitted while it's still a draft (not yet created). */
export interface HandoffOrigin {
  agentId: string;
  agentName?: string;
  sessionId?: string;
  sessionTitle?: string;
  workspace?: string;
}

/**
 * First message of an @-handoff new conversation (in English): the `[handoff_from]` block
 * states that this conversation was opened by an @ mention and carries the source agent /
 * Session / Workspace, so the @-mentioned agent knows its origin (e.g. defaulting to the
 * source agent as its working target, or reaching source files via the Workspace path);
 * the parenthetical label is omitted when the display name/title equals the id or is
 * absent. When rendering the message stream, `parseHandoffMessage` collapses this into a
 * one-line handoff notice — the raw text isn't shown (the model still sees it as usual).
 */
export function handoffMessage(origin: HandoffOrigin): string {
  const name =
    origin.agentName && origin.agentName !== origin.agentId ? ` (${origin.agentName})` : "";
  const lines = [`agent: ${origin.agentId}${name}`];
  if (origin.sessionId) {
    const title = origin.sessionTitle ? ` (${origin.sessionTitle})` : "";
    lines.push(`session: ${origin.sessionId}${title}`);
  }
  if (origin.workspace) lines.push(`workspace: ${origin.workspace}`);
  return [
    "[handoff_from]",
    "This conversation was opened by @-mentioning you from another conversation; its origin is listed below and the user's message, if any, follows. When the request refers to an agent, session, or files without naming them, it means this origin.",
    ...lines,
    "[/handoff_from]",
  ].join("\n");
}

/**
 * Inverse parse of `handoffMessage` (lets the message stream collapse the origin block into
 * a handoff notice): returns origin info when the whole message is strictly one
 * `[handoff_from]` block, otherwise returns null (a normal user message renders as-is).
 * Field lines are parsed as `key: id (label)`; non-field lines such as the explanation
 * sentence are ignored. The old `<handoff_from>` form is still recognized: messages
 * persisted in old Traces are re-rendered through this parser.
 */
export function parseHandoffMessage(text: string): HandoffOrigin | null {
  const block =
    /^\[handoff_from\]\n([\s\S]*)\n\[\/handoff_from\]$/.exec(text.trim()) ??
    /^<handoff_from>\n([\s\S]*)\n<\/handoff_from>$/.exec(text.trim());
  if (!block) return null;
  const origin: HandoffOrigin = { agentId: "" };
  for (const line of block[1]!.split("\n")) {
    const kv = /^(agent|session|workspace): (.+)$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = kv[2]!;
    if (key === "workspace") {
      origin.workspace = value;
      continue;
    }
    const labeled = /^([\w-]+) \((.*)\)$/.exec(value);
    const id = labeled ? labeled[1]! : value;
    const label = labeled?.[2];
    if (key === "agent") {
      origin.agentId = id;
      if (label !== undefined) origin.agentName = label;
    } else {
      origin.sessionId = id;
      if (label !== undefined) origin.sessionTitle = label;
    }
  }
  return origin.agentId ? origin : null;
}

/** Origin info for a scheduled-task trigger (the server's scheduledMessage `[scheduled_task]` block). */
export interface ScheduledOrigin {
  /** Task name (filename minus .toml). */
  name: string;
  /** Trigger timestamp (ISO 8601); empty string when absent from the block. */
  firedAt: string;
}

/**
 * Inverse parse of the server's scheduledMessage (lets the message stream collapse the
 * origin block into a scheduled-task notice): returns origin info and the remaining text
 * when the message **starts with** a `[scheduled_task]` block, otherwise returns null.
 * Unlike handoff, the block is followed by the task's Prompt body, which must be returned
 * alongside it for normal rendering (the raw block isn't shown; the Trace page shows it
 * as-is). The old `<scheduled_task>` form is still recognized: messages persisted in old
 * Traces are re-rendered through this parser.
 */
export function parseScheduledMessage(
  text: string,
): { origin: ScheduledOrigin; rest: string } | null {
  const m =
    /^\[scheduled_task\]\n([\s\S]*?)\n\[\/scheduled_task\]/.exec(text) ??
    /^<scheduled_task>\n([\s\S]*?)\n<\/scheduled_task>/.exec(text);
  if (!m) return null;
  const origin: ScheduledOrigin = { name: "", firedAt: "" };
  for (const line of m[1]!.split("\n")) {
    const kv = /^(schedule|fired_at): (.+)$/.exec(line);
    if (!kv) continue;
    if (kv[1] === "schedule") origin.name = kv[2]!;
    else origin.firedAt = kv[2]!;
  }
  if (!origin.name) return null;
  return { origin, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}
