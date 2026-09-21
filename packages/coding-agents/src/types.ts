/**
 * The coding-agents kernel's vocabulary, kept protocol-neutral on purpose: the server and
 * the Web App consume these types, never the ACP SDK's. The mapping from ACP happens once,
 * in connection.ts, so a protocol bump does not reach past this file.
 */

/** One configured external agent: a command that speaks ACP v1 over stdio. */
export interface AgentServerDefinition {
  /** Stable slug; session records and the credentials directory key off it. */
  id: string;
  title?: string;
  command: string;
  args?: string[];
  /** Extra environment merged over the sandboxed base env. */
  env?: Record<string, string>;
}

export type AgentToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AgentToolStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AgentToolLocation {
  path: string;
  line?: number;
}

/** A tool call as the UI renders it: one snapshot, complete each time it is sent. */
export interface AgentToolCall {
  toolCallId: string;
  title: string;
  kind?: AgentToolKind;
  status: AgentToolStatus;
  rawInput?: unknown;
  /** Text content produced by the tool, concatenated from the call's content blocks. */
  output?: string;
  locations: AgentToolLocation[];
}

export interface AgentPermissionOption {
  optionId: string;
  name: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

/** A permission ask surfaced to the human; `requestId` is assigned by the manager. */
export interface AgentPermissionRequest {
  requestId: string;
  sessionId: string;
  toolCall: AgentToolCall;
  options: AgentPermissionOption[];
}

export type AgentPermissionOutcome =
  { outcome: "selected"; optionId: string } | { outcome: "cancelled" };

export interface AgentModes {
  currentModeId: string | null;
  modes: { id: string; name: string }[];
}

/**
 * One session configuration option — model choice, reasoning level, toggles — as the UI
 * renders it. Options arrive with `session/new` and update live; `category` ("model",
 * "thought_level", ...) is the agent's UX hint only and may be absent or unknown.
 */
export interface AgentSessionConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: string;
  type: "select" | "boolean";
  currentValue: string | boolean;
  /** Selectable values, for `type: "select"` (value groups flattened). */
  options: { value: string; name: string }[];
}

export type AgentStopReason =
  "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | "failed";

/**
 * Everything a session can surface. The manager appends every event to the session's
 * bounded log, so a client that arrives late can rebuild the transcript from
 * `CodingAgentManager.sessionView`.
 */
export type AgentSessionEvent =
  | { type: "message_chunk"; sessionId: string; delta: string }
  | { type: "thought_chunk"; sessionId: string; delta: string }
  | { type: "tool_call"; sessionId: string; call: AgentToolCall }
  | { type: "tool_call_update"; sessionId: string; call: AgentToolCall }
  | { type: "modes"; sessionId: string; modes: AgentModes }
  | {
      type: "config_options";
      sessionId: string;
      options: AgentSessionConfigOption[];
    }
  | { type: "usage"; sessionId: string; used: number; size?: number }
  | { type: "permission_request"; sessionId: string; request: AgentPermissionRequest }
  | {
      type: "permission_resolved";
      sessionId: string;
      requestId: string;
      outcome: AgentPermissionOutcome;
    }
  | { type: "notice"; sessionId: string | null; message: string }
  | { type: "turn_end"; sessionId: string; stopReason: AgentStopReason }
  | { type: "state"; state: "connecting" | "ready" | "closed"; message?: string };

/** Error shape thrown by the kernel; `message` is safe to show, never a raw upstream payload. */
export class AcpAgentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AcpAgentError";
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Validate an untrusted definition (HTTP body) into an {@link AgentServerDefinition}. */
export function parseDefinition(input: unknown): AgentServerDefinition {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new AcpAgentError("definition must be an object.");
  }
  const raw = input as Record<string, unknown>;
  const id = raw.id;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    throw new AcpAgentError(
      'id must start with a letter or digit and use only letters, digits, "_" and "-" (max 64).',
    );
  }
  const command = raw.command;
  if (typeof command !== "string" || command.trim() === "") {
    throw new AcpAgentError("command must be a non-empty string.");
  }
  const args = raw.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new AcpAgentError("args must be an array of strings.");
  }
  const env = raw.env ?? {};
  if (
    env === null ||
    typeof env !== "object" ||
    Array.isArray(env) ||
    Object.values(env).some((v) => typeof v !== "string")
  ) {
    throw new AcpAgentError("env must be an object of string values.");
  }
  const title = raw.title;
  if (title !== undefined && typeof title !== "string") {
    throw new AcpAgentError("title must be a string.");
  }
  return {
    id,
    command,
    args: args as string[],
    env: env as Record<string, string>,
    ...(typeof title === "string" && title !== "" ? { title } : {}),
  };
}
