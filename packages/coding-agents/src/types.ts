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
  /**
   * Set on a definition Penguin manages itself (Models → Built-in), naming which built-in it
   * is; such a definition is written only by that service, never through the Local CLI routes.
   */
  builtin?: string;
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

/**
 * How an agent can reopen an earlier session, as it advertised at `initialize`: `resume`
 * continues without replaying history, `load` replays the conversation first, `none`
 * means a session ends with its process.
 */
export type AgentResumeSupport = "resume" | "load" | "none";

/** Tokens one turn consumed, as the agent reported them (ACP PromptResponse.usage). */
export interface AgentTurnUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedReadTokens: number;
  cachedWriteTokens: number;
  thoughtTokens: number;
}

export type AgentStopReason =
  "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled" | "failed";

/**
 * Everything a session can surface. The manager appends every event to the session's
 * bounded log, so a client that arrives late can rebuild the transcript from
 * `CodingAgentManager.sessionView`.
 */
export type AgentSessionEvent =
  /** The user's prompt, logged when a turn starts so a transcript can show both sides. */
  | { type: "user_message"; sessionId: string; text: string }
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
  /**
   * Context occupancy, and the session's running cost when the agent prices its own work
   * (cumulative over the session, in the agent's currency).
   */
  | {
      type: "usage";
      sessionId: string;
      used: number;
      size?: number;
      cost?: { amount: number; currency: string };
    }
  | { type: "permission_request"; sessionId: string; request: AgentPermissionRequest }
  | {
      type: "permission_resolved";
      sessionId: string;
      requestId: string;
      outcome: AgentPermissionOutcome;
    }
  | { type: "notice"; sessionId: string | null; message: string }
  /** A turn's end; `usage` is what the agent said the turn consumed, when it said. */
  | { type: "turn_end"; sessionId: string; stopReason: AgentStopReason; usage?: AgentTurnUsage }
  | { type: "state"; state: "connecting" | "ready" | "closed"; message?: string };

/** Error shape thrown by the kernel; `message` is safe to show, never a raw upstream payload. */
export class AcpAgentError extends Error {
  /**
   * The agent's own words for why it failed, with the values it was started with masked.
   * Unlike `message` it is third-party text, so the host decides who may read it.
   */
  readonly reason: string | undefined;
  /** The agent said it failed for want of a sign-in (an expired login, a missing key). */
  readonly signInFailed: boolean;

  constructor(
    message: string,
    options?: { cause?: unknown; reason?: string; signInFailed?: boolean },
  ) {
    super(message, options);
    this.name = "AcpAgentError";
    this.reason = options?.reason;
    this.signInFailed = options?.signInFailed ?? false;
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
  const builtin = raw.builtin;
  if (builtin !== undefined && (typeof builtin !== "string" || !ID_PATTERN.test(builtin))) {
    throw new AcpAgentError("builtin must be a short identifier.");
  }
  return {
    id,
    command,
    args: args as string[],
    env: env as Record<string, string>,
    ...(typeof title === "string" && title !== "" ? { title } : {}),
    ...(typeof builtin === "string" ? { builtin } : {}),
  };
}
