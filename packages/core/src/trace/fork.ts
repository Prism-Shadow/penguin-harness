/**
 * Trace sanitization for the model-switch fork (`Agent.forkSession`).
 *
 * A fork carries the source Session's conversation into a NEW Session running a different
 * model. Thinking payloads carry provider/model-bound fidelity (Claude thinking signatures,
 * GPT-5 encrypted reasoning) that must not be replayed into another model, and text/tool
 * fidelity is provider-specific too — so the source records are sanitized **always**, even
 * when the target model shares the source's provider:
 *   - `session_meta` records are dropped (the caller prepends the new Session's own meta);
 *   - `thinking` / `inline_thinking` model_msgs are dropped entirely;
 *   - `fidelity` is stripped from every remaining payload;
 *   - `token_usage` events are dropped (usage restarts at zero on the new model);
 *   - `subagent` pointer events are dropped (child sessions belong to the source Session;
 *     the run_subagent tool text remains part of the conversation).
 * Everything else — request_begin/request_end pairs, abort events, compaction events, and
 * all other complete model_msgs — is kept, so the forked record list stays a well-formed,
 * resumable, renderable Trace with correct task/turn attribution.
 */
import { isCompleteModelMessage, isEventMessage, isSessionMeta } from "../omnimessage/index.js";
import type { OmniMessage } from "../omnimessage/index.js";

/** Payload types dropped wholesale: thinking content never replays across models. */
const DROPPED_MODEL_TYPES = new Set(["thinking", "inline_thinking"]);

/** Event types dropped wholesale: usage restarts on the fork; subagent pointers stay with the source. */
const DROPPED_EVENT_TYPES = new Set(["token_usage", "subagent"]);

/**
 * Sanitizes a source Trace record list for a fork (see the module doc for the rules).
 * Pure: the input records are never mutated (stripping `fidelity` clones the message).
 */
export function sanitizeForkRecords(records: OmniMessage[]): OmniMessage[] {
  const out: OmniMessage[] = [];
  for (const msg of records) {
    if (isSessionMeta(msg)) continue;
    const type = (msg.payload as { type?: string }).type ?? "";
    if (isCompleteModelMessage(msg)) {
      if (DROPPED_MODEL_TYPES.has(type)) continue;
      if ((msg.payload as { fidelity?: unknown }).fidelity !== undefined) {
        const { fidelity: _stripped, ...payload } = msg.payload as unknown as Record<
          string,
          unknown
        >;
        out.push({ ...msg, payload: payload as unknown as OmniMessage["payload"] });
        continue;
      }
      out.push(msg);
      continue;
    }
    if (isEventMessage(msg) && DROPPED_EVENT_TYPES.has(type)) continue;
    out.push(msg);
  }
  return out;
}
