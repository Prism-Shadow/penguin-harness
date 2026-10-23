/**
 * AMSP v2's vocabulary and surface, as the /amsp page shows them: every record and event grouped
 * by its envelope `type`, whether the Trace stores it, which stream carries it, and the two doors
 * a reader comes in by. The single place to adjust when the spec (PRFC-0021, "AMSP v2: OmniMessage
 * is the wire protocol") moves: the vocabulary table, the hero's counts, the replay's "stored in
 * the Trace" tone and the protocol types in amsp-protocol.ts all read this file. Each row's
 * meaning is in the dictionaries under `amsp.vocabulary.meaning`, keyed by the row's `id`, so a
 * row added here without its words fails to typecheck.
 */

/** The envelope's outer `type`: three record categories, plus the host's live notifications. */
export type Envelope = "session_meta" | "model_msg" | "event_msg" | "server_event";

/** Which stream carries a row: one Session's, one signed-in user's, or both (transport control). */
export type StreamScope = "session" | "user" | "both";

export interface VocabularyRow {
  id: string;
  envelope: Envelope;
  /** The `payload.type` values of the row; `session_meta`'s payload has none. */
  kinds: readonly string[];
  /** Stored in the Trace on disk (a durable record), or live on the wire only. */
  stored: boolean;
  stream: StreamScope;
}

export const VOCABULARY = [
  { id: "meta", envelope: "session_meta", kinds: [], stored: true, stream: "session" },
  {
    id: "complete",
    envelope: "model_msg",
    kinds: [
      "text",
      "thinking",
      "tool_call",
      "tool_call_output",
      "image_url",
      "inline_data",
      "inline_thinking",
    ],
    stored: true,
    stream: "session",
  },
  {
    id: "partial",
    envelope: "model_msg",
    kinds: ["partial_text", "partial_thinking", "partial_tool_call", "partial_tool_call_output"],
    stored: false,
    stream: "session",
  },
  {
    id: "engine",
    envelope: "event_msg",
    kinds: [
      "task_begin",
      "task_end",
      "request_begin",
      "request_end",
      "token_usage",
      "compaction_begin",
      "compaction_end",
      "mcp_connect_begin",
      "mcp_connect_end",
      "tool_list_ready",
      "approval_decision",
      "hook",
      "abort",
      "subagent",
    ],
    stored: true,
    stream: "session",
  },
  {
    id: "host",
    envelope: "server_event",
    kinds: [
      "task_state",
      "approval_request",
      "session_title",
      "session_created",
      "credentials_updated",
      "goal_started",
      "goal_round",
      "goal_finished",
    ],
    stored: false,
    stream: "session",
  },
  {
    id: "user",
    envelope: "server_event",
    kinds: [
      "session_state",
      "session_created",
      "session_archived",
      "session_deleted",
      "session_title",
      "session_background",
      "session_approvals",
      "schedule_fired",
      "schedule_queued",
      "workbench_updated",
      "workbench_removed",
      "web_updated",
    ],
    stored: false,
    stream: "user",
  },
  {
    id: "transport",
    envelope: "server_event",
    kinds: ["hello", "heartbeat", "resync_required", "error"],
    stored: false,
    stream: "both",
  },
] as const satisfies readonly VocabularyRow[];

export type VocabularyId = (typeof VOCABULARY)[number]["id"];

type RowOf<E extends Envelope> = Extract<(typeof VOCABULARY)[number], { envelope: E }>;

/** Every `payload.type` a `model_msg` may carry. */
export type ModelKind = RowOf<"model_msg">["kinds"][number];
/** Every `payload.type` an `event_msg` may carry. */
export type EventKind = RowOf<"event_msg">["kinds"][number];
/** Every `payload.type` a `server_event` may carry (a server's own extensions aside). */
export type ServerEventKind = RowOf<"server_event">["kinds"][number];

/** The distinct envelope types. */
export const ENVELOPE_COUNT = new Set(VOCABULARY.map((row) => row.envelope)).size;

/** The record kinds the Trace stores: `session_meta` counts once, every other stored row per kind. */
export const STORED_KIND_COUNT = VOCABULARY.filter((row) => row.stored).reduce(
  (sum, row) => sum + Math.max(1, row.kinds.length),
  0,
);

/** The streams a reader can open: one per Session, one per signed-in user. */
export const STREAM_COUNT = new Set(
  VOCABULARY.map((row) => row.stream).filter((stream) => stream !== "both"),
).size;

/** Whether the Trace stores an event of this envelope and kind (an unlisted kind: not stored). */
export function isStored(envelope: Envelope, kind: string | undefined): boolean {
  const row = VOCABULARY.find(
    (candidate) =>
      candidate.envelope === envelope &&
      (candidate.kinds.length === 0 || (candidate.kinds as readonly string[]).includes(kind ?? "")),
  );
  return row?.stored ?? false;
}

/**
 * The two doors into the same handlers: an external program comes in with an Agent's key, a
 * signed-in person (the Web App, the CLI, a Workbench page) with their session. Same envelopes
 * behind both. Who uses a door and what it asks for are words, in the dictionaries.
 */
export const DOORS = [
  {
    id: "key",
    routes: [
      "POST /api/amsp/v2/agents/:project/:agent/runs",
      "GET  /api/amsp/v2/sessions/:id/stream",
      "GET  /api/amsp/v2/sessions/:id/messages",
    ],
  },
  {
    id: "session",
    routes: [
      "GET  /api/sessions/:id/stream",
      "GET  /api/sessions/:id/messages",
      "GET  /api/events",
    ],
  },
] as const;

/** The header the key door reads. */
export const KEY_HEADER = "Authorization: Bearer penguin_…";

export type DoorId = (typeof DOORS)[number]["id"];

/** The routes of the two streams, as the streams list names them. */
export const STREAM_ROUTES = {
  session: "GET …/sessions/:id/stream",
  user: "GET /api/events",
} as const;

/** The SDK's two readers, by their exported names. */
export const SDK_READERS = ["AgentClient", "SessionReader"] as const;

export type SdkReader = (typeof SDK_READERS)[number];

/** The SDK release that speaks v2, and the retired version's prefix and refusal code. */
export const SDK_VERSION = "1.0";
export const RETIRED = { prefix: "/api/amsp/v1", code: "410 amsp_v1_retired" } as const;
