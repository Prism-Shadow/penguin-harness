/**
 * Whether a Trace file's context is closed, read back out of its records — the file-level rule
 * every reader that resumes, measures or windows a Session applies (the architecture spec's
 * replay rule 1).
 *
 * A file's context is closed in two ways, which can hold at once:
 *   - **by a compaction**: its last `compaction_end` is `completed` and no `request_begin`
 *     follows it (`closingCompaction`);
 *   - **by a pending switch**: its last `session_update` that names a model has no
 *     `request_begin` after it (`pendingModel`) — the switch completed and the next file was
 *     never opened.
 *
 * "No `request_begin` after it" is the test for both because, once a context is closed, the
 * first record the engine writes for the next one opens the next file. What stays behind in the
 * old file can only be records the Session writes itself — Task records, a stop hook's `hook`
 * record, `session_update`, and the input, connect pair and `abort` of a first run stopped
 * during its MCP connect — and none of them is a `request_begin`.
 *
 * Only the main Session's records count (a Trace holds no other; a stream relays its children's
 * with an `origin`). Browser-safe: the Web App reads the same records off the same envelopes.
 */
import { isEventMessage } from "./types.js";
import type { AmspRecord, CompactionEndPayload, SessionUpdatePayload } from "./types.js";

const eventType = (msg: AmspRecord): string | undefined =>
  isEventMessage(msg) && (msg.origin?.length ?? 0) === 0
    ? (msg.payload as { type?: string }).type
    : undefined;

/**
 * The `compaction_end` that closed this file's context: its last one, when it is `completed`
 * and no `request_begin` follows it; undefined otherwise.
 */
export function closingCompaction(
  messages: readonly AmspRecord[],
): AmspRecord<CompactionEndPayload> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const type = eventType(msg);
    if (type === "request_begin") return undefined;
    if (type === "compaction_end") {
      const end = msg as AmspRecord<CompactionEndPayload>;
      return end.payload.status === "completed" ? end : undefined;
    }
  }
  return undefined;
}

/** The model a `session_update` names, when `msg` is one that names a model. */
export function updatedModel(msg: AmspRecord): { provider: string; model_id: string } | undefined {
  if (eventType(msg) !== "session_update") return undefined;
  const { provider, model_id } = msg.payload as SessionUpdatePayload;
  if (typeof provider !== "string" || provider === "") return undefined;
  if (typeof model_id !== "string" || model_id === "") return undefined;
  return { provider, model_id };
}

/**
 * The model a completed switch left for the next context: the last `session_update` that names
 * one, when no `request_begin` follows it; undefined otherwise.
 */
export function pendingModel(
  messages: readonly AmspRecord[],
): { provider: string; model_id: string } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (eventType(msg) === "request_begin") return undefined;
    const model = updatedModel(msg);
    if (model !== undefined) return model;
  }
  return undefined;
}
