/**
 * What one Trace record MEANS — the single place that decides, for a record, whether it is
 * something a person said, something the model said, something it thought, or a tool it ran,
 * and which file (if any) that tool acted on.
 *
 * Three readers need that judgement and must not disagree: the search indexer (what to index),
 * the turn timeline (where one turn ends and the next begins), and the activity rollup (what
 * counts as a turn, a tool call or a produced file). Three private copies of the rule would
 * drift, and the drift shows up as "the sidebar says 9 turns, the overview says 12".
 */
import type { OmniMessage } from "@prismshadow/penguin-core";

/** How a record reads in a list of things that happened. */
export type RecordKind = "user" | "assistant" | "thinking" | "tool";

/** One record, classified. */
export interface ClassifiedRecord {
  kind: RecordKind;
  /** The prose worth showing or indexing (empty for a tool call with no arguments). */
  text: string;
  /**
   * True when this prompt is one a person (or, in a subagent Session, the parent agent) sent —
   * i.e. it OPENS a turn. A background task's completion notice or a scheduled trigger does
   * not: nobody asked for it, and letting it open a turn invents a conversation step.
   */
  opensTurn: boolean;
  /** The sender behind a user-role text, as the Trace recorded it. */
  sender?: string;
  /** Tool calls only. */
  toolName?: string;
  /** The file a path-shaped argument named, tool calls only. */
  file?: string;
  /** The record's timestamp. */
  at: string;
}

/** Senders whose prompt is the human's (or the parent agent's) — the ones that open a turn. */
const HUMAN_SENDERS = new Set(["user", "parent_agent"]);

/** Argument names that carry the path a tool acted on, across the common tool shapes. */
const PATH_KEYS = ["file_path", "filePath", "path", "notebook_path", "target_file", "file"];

/** Argument names worth searching when a tool call has no path (what it was asked to do). */
const DETAIL_KEYS = ["command", "description", "question", "prompt", "url", "query", "content"];

/**
 * Tool names that PRODUCE a file rather than read one. Only these count towards "what did
 * this conversation deliver"; reading a file is activity, writing one is output.
 */
const PRODUCING_TOOLS = new Set([
  "write_file",
  "edit_file",
  "multi_edit",
  "apply_patch",
  "notebook_edit",
  "create_file",
  "write",
  "edit",
  "patch",
]);

/** True when this tool call's result is a file the Session produced. */
export function isProducingTool(name: string): boolean {
  return PRODUCING_TOOLS.has(name);
}

/** The tool calls of a Session that count as delivered output, for a summary line. */
export function isHumanPrompt(sender: string | undefined): boolean {
  return HUMAN_SENDERS.has(sender ?? "user");
}

/** The local (yyyy-mm-dd) date an ISO instant falls on, as the Trace tree's own date dirs read. */
export function localDate(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  // getTimezoneOffset is minutes to ADD to local to reach UTC, so local = UTC − offset.
  return new Date(at + new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/** The path a tool's arguments name, if any. */
export function fileOfArguments(args: Record<string, unknown>): string | undefined {
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

/** Parses a tool call's arguments; a streaming or truncated blob simply has none. */
export function parseArguments(argsJson: string | undefined): Record<string, unknown> {
  if (typeof argsJson !== "string" || argsJson === "") return {};
  try {
    const parsed: unknown = JSON.parse(argsJson);
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * One line saying what a tool was asked to do, cut from its arguments when it names one.
 * `keep` defaults to what an indexed tool call may carry; a display surface passes its own
 * shorter budget.
 */
export function toolSummary(name: string, args: Record<string, unknown>, keep = 600): string {
  const file = fileOfArguments(args);
  if (file !== undefined) return flat(`${name} ${file}`, keep);
  for (const key of DETAIL_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value) return flat(`${name} ${value}`, keep);
  }
  return name;
}

/** Collapses whitespace and clips, so one list row is one line. */
export function flat(text: string, keep = 600): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > keep ? `${oneLine.slice(0, keep)}…` : oneLine;
}

/**
 * Classifies one Trace record, or null when it is not something a person would call "something
 * that happened".
 *
 * Deliberately skipped: `session_meta` (it carries the whole assembled system prompt — the
 * largest text in the file, and a match in it means nothing to whoever is searching),
 * every `event_msg` (token counters and request spans), `tool_call_output` (a file's contents;
 * the reader wants the file, not the blob), and partials (their complete message is on disk).
 */
export function classifyRecord(record: OmniMessage): ClassifiedRecord | null {
  const at = record.timestamp ?? "";
  if (record.type !== "model_msg") return null;
  const payload = record.payload as unknown as Record<string, unknown>;
  switch (payload.type) {
    case "text": {
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) return null;
      const sender = typeof payload.sender === "string" ? payload.sender : undefined;
      const assistant = payload.role === "assistant";
      return {
        kind: assistant ? "assistant" : "user",
        text,
        opensTurn: !assistant && isHumanPrompt(sender),
        ...(sender !== undefined ? { sender } : {}),
        at,
      };
    }
    case "thinking": {
      const text = typeof payload.thinking === "string" ? payload.thinking.trim() : "";
      if (!text) return null;
      return { kind: "thinking", text, opensTurn: false, at };
    }
    case "tool_call": {
      const name = typeof payload.name === "string" ? payload.name : "";
      if (!name) return null;
      const args = parseArguments(
        typeof payload.arguments === "string" ? payload.arguments : undefined,
      );
      const file = fileOfArguments(args);
      return {
        kind: "tool",
        text: toolSummary(name, args),
        opensTurn: false,
        toolName: name,
        ...(file !== undefined ? { file } : {}),
        at,
      };
    }
    default:
      return null;
  }
}
