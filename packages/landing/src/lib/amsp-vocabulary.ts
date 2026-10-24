/**
 * AMSP's vocabulary, as the /amsp page shows it: every kind of record, grouped into the families
 * the record reference lists, with its envelope `type` and whether the Trace stores it, and the
 * control frames. The single place to adjust when the protocol moves: the record reference
 * (sections/amsp/records.tsx, with its examples and fields in amsp-records.ts), the replay's
 * "stored in the Trace" tone and the protocol types in amsp-protocol.ts all read this file. The
 * words for each family, record and frame are in the dictionaries under `amsp.records`, keyed by
 * id, so an entry added here without its words fails to typecheck.
 */

/** The envelope's outer `type`. */
export type Envelope = "session_meta" | "model_msg" | "event_msg";

interface KindEntry {
  /** The record's `payload.type`; `session_meta`, whose payload has none, by its envelope. */
  id: string;
  envelope: Envelope;
  /** Stored in the Trace on disk (a durable record), or live on the stream only. */
  stored: boolean;
}

const model = <Id extends string>(id: Id, stored: boolean) =>
  ({ id, envelope: "model_msg", stored }) as const;
const event = <Id extends string>(id: Id) => ({ id, envelope: "event_msg", stored: true }) as const;

export const FAMILIES = [
  {
    id: "session",
    records: [{ id: "session_meta", envelope: "session_meta", stored: true }],
  },
  {
    id: "complete",
    records: [
      model("text", true),
      model("thinking", true),
      model("tool_call", true),
      model("tool_call_output", true),
      model("image_url", true),
      model("inline_data", true),
      model("inline_thinking", true),
    ],
  },
  {
    id: "partial",
    records: [
      model("partial_text", false),
      model("partial_thinking", false),
      model("partial_tool_call", false),
      model("partial_tool_call_output", false),
    ],
  },
  {
    id: "boundaries",
    records: [
      event("task_begin"),
      event("task_end"),
      event("request_begin"),
      event("request_end"),
      event("token_usage"),
    ],
  },
  {
    id: "interventions",
    records: [event("abort"), event("approval_decision"), event("hook")],
  },
  {
    id: "context",
    records: [
      event("compaction_begin"),
      event("compaction_end"),
      event("tool_list_ready"),
      event("mcp_connect_begin"),
      event("mcp_connect_end"),
      event("subagent"),
    ],
  },
] as const satisfies readonly { id: string; records: readonly KindEntry[] }[];

type Entry = (typeof FAMILIES)[number]["records"][number];

/** Every kind of record, by its id. */
export type RecordKind = Entry["id"];
/** Every `payload.type` a `model_msg` may carry. */
export type ModelKind = Extract<Entry, { envelope: "model_msg" }>["id"];
/** Every `payload.type` an `event_msg` may carry. */
export type EventKind = Extract<Entry, { envelope: "event_msg" }>["id"];

const ENTRIES: readonly KindEntry[] = FAMILIES.flatMap(
  (family): readonly KindEntry[] => family.records,
);

/** A kind's envelope and storage, by id. */
export function kindEntry(id: RecordKind): KindEntry {
  return ENTRIES.find((entry) => entry.id === id)!;
}

/**
 * The control frames: `ping`, an SSE event with a name and no id, which moves no resume
 * position and is never replayed, opens a run stream and beats every 20 seconds; `[DONE]` is a
 * run stream's last line. One line each: a frame removed here leaves the page and the protocol
 * type.
 */
export const CONTROL_FRAMES = [
  { id: "ping", wire: "event: ping\ndata: {}" },
  { id: "done", wire: "data: [DONE]" },
] as const;

/** A named control frame's `event:` (the `[DONE]` line has none). */
export type ControlKind = Exclude<(typeof CONTROL_FRAMES)[number]["id"], "done">;

/** Whether the Trace stores a record of this envelope and kind (an unlisted kind: not stored). */
export function isStored(envelope: Envelope, kind: string | undefined): boolean {
  const entry = ENTRIES.find(
    (candidate) =>
      candidate.envelope === envelope &&
      (envelope === "session_meta" || candidate.id === (kind ?? "")),
  );
  return entry?.stored ?? false;
}
