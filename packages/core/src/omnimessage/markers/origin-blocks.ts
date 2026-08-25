/**
 * Origin blocks — marker blocks that **prefix a user message** to say where it came from or
 * what it should use, produced by the hosts (Web composer, server scheduler) and collapsed
 * into a banner by the render layers.
 *
 * Each marker gets a `build*` producer (canonical square form) and a `parse*` inverse that
 * also accepts the legacy angle form, so messages persisted in older Traces still render as
 * banners rather than raw markers. The block's field lines are `key: value`; free-text
 * explanation lines are ignored by the parsers.
 */
import { dualFormPatterns, markerBlock, matchDualForm } from "./block.js";
import { MARKER_TAGS, TITLE_NOISE_TAGS } from "./tags.js";

/**
 * Strips every **leading** machine-prefixed block (a skill invocation, a handoff /
 * scheduled-task / model-switch origin note — the TITLE_NOISE_TAGS set) plus separating
 * blank lines, returning the user's own text:
 *
 *     "[use_skills]\nskills: web-design\n[/use_skills]\n\nfix the layout"  →  "fix the layout"
 *
 * Used where a prefixed input doubles as user-facing content — e.g. the goal loop deriving
 * the objective (re-injected each round, recorded in GOAL.yaml) from the round-1 input.
 */
export function stripLeadingMarkerBlocks(text: string): string {
  let out = text;
  for (;;) {
    const before = out;
    for (const tag of TITLE_NOISE_TAGS) {
      const m = matchDualForm(dualFormPatterns(tag, "[\\s\\S]*?"), out);
      if (m && m.index === 0) out = out.slice(m[0].length).replace(/^\n+/, "");
    }
    if (out === before) return out;
  }
}

// ---------------------------------------------------------------------------
// [use_skills] — skill invocation prefixed to the user's message
// ---------------------------------------------------------------------------

/** Parsed `[use_skills]` block: the selected skill names plus the message body after it. */
export interface SkillsMessage {
  skills: string[];
  rest: string;
}

/** Builds a message body with a `[use_skills]` block: an empty list omits the block; with no body text only the block is returned (no trailing blank line). */
export function buildSkillsMessage(names: string[], text: string): string {
  if (names.length === 0) return text;
  const block = markerBlock(MARKER_TAGS.useSkills, `skills: ${names.join(", ")}`);
  return text ? `${block}\n\n${text}` : block;
}

const SKILLS_PATTERNS = dualFormPatterns(MARKER_TAGS.useSkills, "\\nskills: ([^\\n]+)\\n");

/**
 * Inverse of `buildSkillsMessage`: recognizes a block only at **the start of the message**,
 * returning the skill names and the remaining body (a block appearing mid-body is plain
 * text). The `skills:` line is split on commas and trimmed; an empty list is not a block.
 */
export function parseSkillsMessage(text: string): SkillsMessage | null {
  const m = matchDualForm(SKILLS_PATTERNS, text);
  if (!m || m.index !== 0) return null;
  const skills = m[1]!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (skills.length === 0) return null;
  return { skills, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}

// ---------------------------------------------------------------------------
// Field-line helpers shared by the origin blocks below
// ---------------------------------------------------------------------------

/** Splits a `value` of the shape `id (label)` into its parts (label undefined when absent). */
function splitLabeled(value: string): { id: string; label?: string } {
  const m = /^([\w-]+) \((.*)\)$/.exec(value);
  return m ? { id: m[1]!, label: m[2]! } : { id: value };
}

/** Iterates the `key: value` field lines of a block body, ignoring prose lines. */
function fieldLines(body: string, keys: readonly string[]): Array<[string, string]> {
  const pattern = new RegExp(`^(${keys.join("|")}): (.+)$`);
  const out: Array<[string, string]> = [];
  for (const line of body.split("\n")) {
    const kv = pattern.exec(line);
    if (kv) out.push([kv[1]!, kv[2]!]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// [handoff_from] — handoff into a new conversation with another agent
// ---------------------------------------------------------------------------

/** Origin info for a handoff's new conversation: source agent is always present; the source Session is omitted while it's still a draft. */
export interface HandoffOrigin {
  agentId: string;
  agentName?: string;
  sessionId?: string;
  sessionTitle?: string;
  workspace?: string;
}

/**
 * First message of a handoff's new conversation (English): the `[handoff_from]` block states
 * that another conversation handed this one over (the Web composer's `/agent` command) and
 * carries the source agent / Session / Workspace, so the receiving agent knows its origin
 * (e.g. defaulting to the source agent as its working target, or reaching source files via the
 * Workspace path). The parenthetical label is omitted when the display name/title equals the id
 * or is absent.
 *
 * The prose is deliberately trigger-agnostic — the tag and the fields are a persisted format
 * (old Traces still render through this parser), so the wording must survive the composer
 * swapping how a handoff is started, as it did when `/agent` replaced the `@` mention.
 */
export function buildHandoffMessage(origin: HandoffOrigin): string {
  const name =
    origin.agentName && origin.agentName !== origin.agentId ? ` (${origin.agentName})` : "";
  const lines = [`agent: ${origin.agentId}${name}`];
  if (origin.sessionId) {
    const title = origin.sessionTitle ? ` (${origin.sessionTitle})` : "";
    lines.push(`session: ${origin.sessionId}${title}`);
  }
  if (origin.workspace) lines.push(`workspace: ${origin.workspace}`);
  return markerBlock(
    MARKER_TAGS.handoffFrom,
    [
      "The user handed this conversation to you from another one; its origin is listed below and the user's message, if any, follows. When the request refers to an agent, session, or files without naming them, it means this origin.",
      ...lines,
    ].join("\n"),
  );
}

const HANDOFF_PATTERNS = dualFormPatterns(MARKER_TAGS.handoffFrom, "\\n([\\s\\S]*)\\n", "");

/**
 * Inverse of `buildHandoffMessage`: returns origin info when the **whole** message is one
 * `[handoff_from]` block, otherwise null (a normal user message renders as-is).
 */
export function parseHandoffMessage(text: string): HandoffOrigin | null {
  const trimmed = text.trim();
  const block = matchDualForm(HANDOFF_PATTERNS, trimmed);
  if (!block || block.index !== 0 || block[0].length !== trimmed.length) return null;
  const origin: HandoffOrigin = { agentId: "" };
  for (const [key, value] of fieldLines(block[1]!, ["agent", "session", "workspace"])) {
    if (key === "workspace") {
      origin.workspace = value;
      continue;
    }
    const { id, label } = splitLabeled(value);
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

// ---------------------------------------------------------------------------
// [scheduled_task] — scheduled trigger, followed by the task's own Prompt body
// ---------------------------------------------------------------------------

/** Origin info for a scheduled-task trigger. */
export interface ScheduledOrigin {
  /** Task name (filename minus .toml). */
  name: string;
  /** Trigger timestamp (ISO 8601); empty string when absent from the block. */
  firedAt: string;
}

/**
 * Trigger input = a `[scheduled_task]` origin block (task name and fire time) + the prompt
 * body: tells the model this was fired by a schedule; the frontend collapses the origin block
 * into a one-line schedule hint (Trace shows it verbatim).
 */
export function buildScheduledMessage(name: string, firedAt: string, prompt: string): string {
  const block = markerBlock(
    MARKER_TAGS.scheduledTask,
    [
      "This message was sent automatically by a scheduled task; its origin is listed below and the task prompt follows.",
      `schedule: ${name}`,
      `fired_at: ${firedAt}`,
    ].join("\n"),
  );
  return `${block}\n\n${prompt}`;
}

const SCHEDULED_PATTERNS = dualFormPatterns(MARKER_TAGS.scheduledTask, "\\n([\\s\\S]*?)\\n");

/**
 * Inverse of `buildScheduledMessage`: returns origin info and the remaining text when the
 * message **starts with** a `[scheduled_task]` block, otherwise null. Unlike handoff, the
 * block is followed by the task's Prompt body, which is returned alongside it for normal
 * rendering (the raw block isn't shown; the Trace page shows it as-is).
 */
export function parseScheduledMessage(
  text: string,
): { origin: ScheduledOrigin; rest: string } | null {
  const m = matchDualForm(SCHEDULED_PATTERNS, text);
  if (!m || m.index !== 0) return null;
  const origin: ScheduledOrigin = { name: "", firedAt: "" };
  for (const [key, value] of fieldLines(m[1]!, ["schedule", "fired_at"])) {
    if (key === "schedule") origin.name = value;
    else origin.firedAt = value;
  }
  if (!origin.name) return null;
  return { origin, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}

// ---------------------------------------------------------------------------
// [feishu_message] — inbound Feishu (Lark) message relayed by the server bridge
// ---------------------------------------------------------------------------

/** Origin info for a Feishu-relayed message. */
export interface FeishuOrigin {
  /** Feishu chat kind: `p2p` (a direct chat with the bot) or `group`. */
  chatType: string;
  /** Sender display name, when the inbound event carried one. */
  senderName?: string;
}

/**
 * Inbound input = a `[feishu_message]` origin block (chat kind, sender when known) + the
 * sender's own text: tells the model the message arrived through the Feishu bridge and that
 * its reply is relayed back to the same chat as plain text (so it should answer in plain
 * text). The frontend collapses the origin block into a one-line Feishu hint (the Trace
 * shows it verbatim).
 */
export function buildFeishuMessage(origin: FeishuOrigin, text: string): string {
  const block = markerBlock(
    MARKER_TAGS.feishuMessage,
    [
      "This message was relayed from a Feishu (Lark) chat by the server's Feishu bridge; the sender's message follows. Your reply will be relayed back to the same Feishu chat as plain text, so answer in plain text without Markdown formatting.",
      `chat_type: ${origin.chatType}`,
      ...(origin.senderName !== undefined ? [`sender: ${origin.senderName}`] : []),
    ].join("\n"),
  );
  return `${block}\n\n${text}`;
}

const FEISHU_PATTERNS = dualFormPatterns(MARKER_TAGS.feishuMessage, "\\n([\\s\\S]*?)\\n");

/**
 * Inverse of `buildFeishuMessage`: returns origin info and the remaining text when the
 * message **starts with** a `[feishu_message]` block, otherwise null. Prefix-block semantics
 * like `[scheduled_task]`: the sender's text after the block is returned for normal
 * rendering (the Trace page shows the raw block).
 */
export function parseFeishuMessage(text: string): { origin: FeishuOrigin; rest: string } | null {
  const m = matchDualForm(FEISHU_PATTERNS, text);
  if (!m || m.index !== 0) return null;
  const origin: FeishuOrigin = { chatType: "" };
  for (const [key, value] of fieldLines(m[1]!, ["chat_type", "sender"])) {
    if (key === "chat_type") origin.chatType = value;
    else origin.senderName = value;
  }
  if (!origin.chatType) return null;
  return { origin, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}

// ---------------------------------------------------------------------------
// [model_switch_from] — the /model command's handoff-style conversation switch
// ---------------------------------------------------------------------------

/**
 * Origin info for a `/model` switch new conversation (modeled on HandoffOrigin): the source
 * Session, the absolute path of its latest Trace file (the model reads it for the earlier
 * history — nothing is injected into the new context), the shared Workspace, and the previous
 * model's paired reference.
 */
export interface ModelSwitchOrigin {
  sessionId: string;
  sessionTitle?: string;
  /** Absolute path of the source session's latest Trace file (JSONL of OmniMessage envelopes). */
  tracePath?: string;
  workspace?: string;
  /** The source session's model reference pair (never concatenated — two separate fields). */
  prevProvider?: string;
  prevModelId?: string;
}

/**
 * First message of a `/model` switch new conversation (English, mirroring the handoff block):
 * the `[model_switch_from]` block states that this conversation continues an earlier one on a
 * different model and carries the source Session / Trace path / Workspace / previous model
 * pair. The earlier history is deliberately NOT injected — some models require thinking
 * payloads and provider `fidelity` byte-for-byte when history is replayed, which cannot cross
 * models — so the model reads the Trace file itself when it needs the context.
 */
export function buildModelSwitchMessage(origin: ModelSwitchOrigin): string {
  const title = origin.sessionTitle ? ` (${origin.sessionTitle})` : "";
  const lines = [`session: ${origin.sessionId}${title}`];
  if (origin.tracePath) lines.push(`trace: ${origin.tracePath}`);
  if (origin.workspace) lines.push(`workspace: ${origin.workspace}`);
  if (origin.prevModelId) lines.push(`previous_model: ${origin.prevModelId}`);
  if (origin.prevProvider) lines.push(`previous_provider: ${origin.prevProvider}`);
  return markerBlock(
    MARKER_TAGS.modelSwitchFrom,
    [
      "The user switched models: this conversation continues an earlier conversation, now on a different model. Its origin is listed below and the user's message, if any, follows. The earlier history is NOT in your context — when you need it, read the trace file at the path below (JSONL, one message envelope per line: user/assistant text, tool calls and results).",
      ...lines,
    ].join("\n"),
  );
}

const MODEL_SWITCH_PATTERNS = dualFormPatterns(MARKER_TAGS.modelSwitchFrom, "\\n([\\s\\S]*)\\n");

/**
 * Inverse of `buildModelSwitchMessage`: returns origin info when the **whole** message is one
 * `[model_switch_from]` block, otherwise null. The session line's `(title)` label is split
 * off; prose lines are ignored.
 */
export function parseModelSwitchMessage(text: string): ModelSwitchOrigin | null {
  const trimmed = text.trim();
  const block = matchDualForm(MODEL_SWITCH_PATTERNS, trimmed);
  if (!block || block.index !== 0 || block[0].length !== trimmed.length) return null;
  const origin: ModelSwitchOrigin = { sessionId: "" };
  const keys = ["session", "trace", "workspace", "previous_model", "previous_provider"];
  for (const [key, value] of fieldLines(block[1]!, keys)) {
    if (key === "session") {
      const { id, label } = splitLabeled(value);
      origin.sessionId = id;
      if (label !== undefined) origin.sessionTitle = label;
    } else if (key === "trace") origin.tracePath = value;
    else if (key === "workspace") origin.workspace = value;
    else if (key === "previous_model") origin.prevModelId = value;
    else origin.prevProvider = value;
  }
  return origin.sessionId ? origin : null;
}

// ---------------------------------------------------------------------------
// [background_task_done] — completion report of a run_in_background task
// ---------------------------------------------------------------------------

/** Structured facts of one background-task completion (the block's field lines). */
export interface BackgroundTaskDone {
  /** Which background family finished. */
  kind: "command" | "subagent";
  /** The registry handle the model already holds: `process_id` or `subagent_id`. */
  id: string;
  /**
   * Terminal status of the run. `stopped` is a command somebody ended on purpose (a stop
   * signal from outside, a capacity eviction): settled, but nothing to react to — see the
   * block's leading sentence, which tells the model so in as many words.
   */
  status: "completed" | "failed" | "stopped";
  /** One-line terminal detail (exit code / signal / subagent note); empty when there is none. */
  detail: string;
  /**
   * How the notice reached the conversation. `"steering"` = the engine injected it into an
   * already-started Task at an input-assembly boundary (the steering delivery path — stamped
   * at delivery time, since a queued notice does not know yet which path will consume it);
   * absent = the notice IS a task's starting input (the host launched a task with it while
   * the session sat idle). The two deliveries are positionally identical in the Trace — both
   * sit between a `request_end` and the next `request_begin` — so this recorded field is the
   * only way render and stats layers can tell "same turn" from "independent turn".
   */
  delivery?: "steering";
}

/**
 * Harness-injected user message reporting that a background task finished (`exec_command` /
 * `run_subagent` launched with `run_in_background`): the `[background_task_done]` block carries
 * the structured facts, and the body after it is the display text — what the task was, followed
 * by the tail of its yet-undelivered output (already capped by the producer). The frontend
 * collapses the block into a one-line notice (the Trace page shows it verbatim); the model reads
 * the whole thing.
 */
export function buildBackgroundTaskDoneMessage(done: BackgroundTaskDone, body: string): string {
  const block = markerBlock(
    MARKER_TAGS.backgroundTaskDone,
    [
      done.status === "stopped"
        ? "Automatic notification from the harness, not the user: a background task you started was stopped on purpose — someone ended it, it did not crash. Do not restart it unless you are asked to."
        : "Automatic notification from the harness, not the user: a background task you started has finished.",
      `kind: ${done.kind}`,
      `id: ${done.id}`,
      `status: ${done.status}`,
      ...(done.detail ? [`detail: ${done.detail}`] : []),
      ...(done.delivery ? [`delivery: ${done.delivery}`] : []),
    ].join("\n"),
  );
  return body ? `${block}\n\n${body}` : block;
}

const BACKGROUND_DONE_PATTERNS = dualFormPatterns(
  MARKER_TAGS.backgroundTaskDone,
  "\\n([\\s\\S]*?)\\n",
);

/**
 * Inverse of `buildBackgroundTaskDoneMessage`: returns the completion facts and the body when
 * the message **starts with** a `[background_task_done]` block, otherwise null. Prefix-block
 * semantics like `[scheduled_task]`: the body after the block is returned for normal rendering.
 */
export function parseBackgroundTaskDoneMessage(
  text: string,
): { done: BackgroundTaskDone; rest: string } | null {
  const m = matchDualForm(BACKGROUND_DONE_PATTERNS, text);
  if (!m || m.index !== 0) return null;
  const done: BackgroundTaskDone = { kind: "command", id: "", status: "completed", detail: "" };
  for (const [key, value] of fieldLines(m[1]!, ["kind", "id", "status", "detail", "delivery"])) {
    if (key === "kind" && (value === "command" || value === "subagent")) done.kind = value;
    else if (key === "id") done.id = value;
    else if (
      key === "status" &&
      (value === "completed" || value === "failed" || value === "stopped")
    )
      done.status = value;
    else if (key === "detail") done.detail = value;
    else if (key === "delivery" && value === "steering") done.delivery = value;
  }
  if (!done.id) return null;
  return { done, rest: text.slice(m[0].length).replace(/^\n+/, "") };
}

/**
 * Whether a user text is a background completion notice that was steered into a running Task
 * (`delivery: steering` on its `[background_task_done]` block). The shared predicate behind
 * every "what is one turn" implementation — the Web stream reducer, the outline, the server's
 * message-window scanner and trace analysis — which all must treat such a notice like
 * steering: inside the current Task, never starting a new one. A notice without the field is
 * a task's own starting input and keeps its independent turn.
 */
export function isSteeredBackgroundNotice(text: string): boolean {
  return parseBackgroundTaskDoneMessage(text)?.done.delivery === "steering";
}

// ---------------------------------------------------------------------------
// Shared predicate over the whole-message origin blocks
// ---------------------------------------------------------------------------

/**
 * True when `text` is **entirely** one origin block whose parser demands a whole-message match:
 * `[handoff_from]` and `[model_switch_from]`, both of which compare the match length against the
 * trimmed message. Anything appended after such a block — not just prefixed to it — makes it
 * unparseable, and the raw marker then renders verbatim in a user bubble.
 *
 * Exported for the producers that append to an existing message (see core's
 * `appendAttachmentLines`): a message of this shape is a machine-written frame, not user text,
 * and must be left alone. Deliberately implemented by running the parsers rather than
 * re-testing their patterns, so the predicate cannot drift from what they accept.
 *
 * `[use_skills]`, `[scheduled_task]` and `[feishu_message]` are **not** included: they are prefix
 * blocks followed by the message's own body and are parsed at index 0 only, so appending after
 * that body is safe.
 */
export function isWholeOriginBlock(text: string): boolean {
  return parseHandoffMessage(text) !== null || parseModelSwitchMessage(text) !== null;
}
