/**
 * AMSP's vocabulary, as the /amsp page shows it: the Session stream's records grouped by their
 * envelope `type`, whether the Trace stores each, and the four control frames. The single place to
 * adjust when the spec (PRFC-0021, "AMSP: the Session stream") moves: the tables,
 * the replay's "stored in the Trace" tone and the protocol types in amsp-protocol.ts all read this
 * file. Each row's meaning is in the dictionaries under `amsp.vocabulary`, keyed by its `id`, so a
 * row added here without its words fails to typecheck.
 */

/** The envelope's outer `type`. */
export type Envelope = "session_meta" | "model_msg" | "event_msg";

export interface VocabularyRow {
  id: string;
  envelope: Envelope;
  /** The `payload.type` values of the row; `session_meta`'s payload has none. */
  kinds: readonly string[];
  /** Stored in the Trace on disk (a durable record), or live on the stream only. */
  stored: boolean;
  /** Sent only on a Session's first message (after `hello`), not repeated on later ones. */
  firstMessageOnly?: true;
}

export const VOCABULARY = [
  {
    id: "meta",
    envelope: "session_meta",
    kinds: [],
    stored: true,
    firstMessageOnly: true,
  },
  {
    id: "complete",
    envelope: "model_msg",
    kinds: [
      "text",
      "image_url",
      "inline_data",
      "thinking",
      "inline_thinking",
      "tool_call",
      "tool_call_output",
    ],
    stored: true,
  },
  {
    id: "partial",
    envelope: "model_msg",
    kinds: ["partial_text", "partial_thinking", "partial_tool_call", "partial_tool_call_output"],
    stored: false,
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
  },
] as const satisfies readonly VocabularyRow[];

type RowOf<E extends Envelope> = Extract<(typeof VOCABULARY)[number], { envelope: E }>;

/** Every `payload.type` a `model_msg` may carry. */
export type ModelKind = RowOf<"model_msg">["kinds"][number];
/** Every `payload.type` an `event_msg` may carry. */
export type EventKind = RowOf<"event_msg">["kinds"][number];

/**
 * The control frames: SSE events with a name and no id, which move no resume position and are
 * never replayed. `[DONE]` is the run stream's last line. What each says is in the dictionaries
 * under `amsp.vocabulary.frames`, keyed by `id`.
 */
export const CONTROL_FRAMES = [
  { id: "hello", wire: "event: hello", data: '{"session_id", "agent"}' },
  { id: "resync_required", wire: "event: resync_required", data: "{}" },
  { id: "ping", wire: "event: ping", data: "{}" },
  { id: "done", wire: "data: [DONE]", data: "" },
] as const;

/** Whether the Trace stores a record of this envelope and kind (an unlisted kind: not stored). */
export function isStored(envelope: Envelope, kind: string | undefined): boolean {
  const row = VOCABULARY.find(
    (candidate) =>
      candidate.envelope === envelope &&
      (candidate.kinds.length === 0 || (candidate.kinds as readonly string[]).includes(kind ?? "")),
  );
  return row?.stored ?? false;
}
