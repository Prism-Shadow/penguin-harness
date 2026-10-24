/**
 * AMSP (Agent Message Stream Protocol): the wire types.
 *
 * AMSP is the stream of one Session: its records as the Trace holds them, plus the
 * `partial_*` fragments streamed while a message is produced, and control frames. A stream
 * is `text/event-stream`; every event is one of two kinds:
 *
 * - a **record**: no `event:` name, an `id:` (`<epoch>-<seq>`), and `data:` the record
 *   envelope `{timestamp, type, payload, origin?}` — {@link AmspRecord}, the payloads snake_case
 *   exactly as the Trace stores them;
 * - a **control frame**: a named event without an `id:` — `ping` ({@link AmspControl}) — or the
 *   run stream's last line, `data: [DONE]`.
 *
 * A reader dispatches on the SSE event name: unnamed is a record, a name it does not know is
 * ignored, and so is a `payload.type` it does not know. Within `/v1` the protocol only grows:
 * new records, new optional fields, new control frames.
 *
 * The record vocabulary lives in `./records/` and is re-exported here.
 * The rest of this file is the shape of the Agent API's requests and answers around the stream.
 */
import type { MessageOrigin, AmspRecord, ToolCallPayload } from "./records/index.js";

export * from "./records/index.js";

/**
 * A control frame. `ping` opens a run stream, follows any replay on a Session stream, and is the
 * 20-second heartbeat. No frame names a run's Session: a new Session's is its `session_meta`, the
 * run stream's first record, and a continued one's is the `session_id` the request sent. Nor
 * does a frame say a resume failed: a `Last-Event-ID` the server's buffer no longer holds is
 * refused before the stream starts, 409 `resync_required`.
 */
export type AmspControl = { kind: "ping" };

/** A Session's run state, as `GET …/sessions/:id` reports it. */
export type SessionStatus = "idle" | "running" | "compacting";

/** The one error shape: `code` snake_case and stable; `message` raw text. */
export interface AmspError {
  code: string;
  message: string;
}

// ---- requests / responses ----

export type InputItem =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: string /* data: URL or http(s) URL */ };

/** `POST …/agents/:projectId/:agentId/runs`: one run, streamed. */
export interface RunRequest {
  session_id?: string;
  input: string | InputItem[];
}

/** `POST …/sessions/:id/tasks`: a run on an API Session that does not hold the connection. */
export interface TaskRequest {
  input: string | InputItem[];
}

/** The `202` answer of `POST …/sessions/:id/tasks`. */
export interface TaskResponse {
  session_id: string;
}

export interface AgentInfo {
  id: string /* "<projectId>/<agentId>" */;
  name?: string;
  description?: string;
}

export interface AgentResponse {
  agent: AgentInfo;
}

export interface SessionInfo {
  id: string;
  agent: string;
  status: SessionStatus;
  provider: string;
  model_id: string;
  created_at: string;
  last_active_at: string;
}

export interface SessionResponse {
  session: SessionInfo;
}

/** One tool call the server holds for a decision: the `tool_call` record's payload, and the child Session chain for a subagent's call. */
export interface PendingApproval {
  tool_call: ToolCallPayload;
  origin?: MessageOrigin[];
}

/** `GET …/sessions/:id/approvals[?wait=<1–60>]`: the calls waiting for a decision now. */
export interface ApprovalsResponse {
  approvals: PendingApproval[];
}

/** `POST …/sessions/:id/approvals/:toolCallId`. */
export interface ApprovalRequest {
  decision: "allow" | "deny";
}

/** A history record: a record as the Trace holds it, with where it sits there (absent on a child's expanded records and on input not yet written). */
export type HistoryRecord = AmspRecord & { tracePosition?: { fileIndex: number; ordinal: number } };

/** A page of history: the newest `tailLimit` Tasks, or the `limit` Tasks before a `before` cursor. */
export type MessagesPage = { tailLimit: number } | { before: string; limit?: number };

/**
 * `GET …/sessions/:id/messages`. Without a page, the whole history, every file's `session_meta`
 * included. With one, a window of whole Tasks with `page` describing it, its images served by
 * reference to `…/sessions/:id/trace-image`. While the Session runs, `live` joins the history to
 * the stream: `cursor` is the stream's id at the read, and `fragments` the open `partial_*`
 * messages so far, each as one `start` carrying what has streamed.
 *
 * This answer is the Web App's history read, shared by both doors, so its own fields are camelCase.
 */
export interface MessagesResponse {
  messages: HistoryRecord[];
  live?: { cursor: string; fragments: AmspRecord[] };
  page?: {
    /** Pass back as `before` for the window before this one; absent at the beginning. */
    before?: string;
    earlierTurns: number;
    prior: Record<string, number>;
    /** The model of the context the window starts in. */
    contextModel?: { provider: string; modelId: string };
    agentState?: string;
  };
}

export interface ErrorResponse {
  error: AmspError;
}
