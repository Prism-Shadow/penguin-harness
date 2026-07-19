/**
 * Aggregates streaming partial_* messages into a complete model_msg.
 *
 * When recording a Trace, streaming `partial_*` messages must first be joined into a complete
 * `model_msg` before writing. This module provides:
 *   - `PartialAggregator`: a stateful aggregator, pushed one message at a time, producing a
 *     complete message when a fragment ends with `stop`;
 *   - `aggregateAll`: a one-shot pass that collapses `partial_*` messages in an array into
 *     complete messages.
 *
 * Complete / event / session_meta messages pass through unchanged, preserving their original
 * order.
 * Docs: /docs/omni-message § "The streaming discipline".
 */
import { assistantText, thinkingMessage, toolCall, toolCallOutput } from "./builders.js";
import type { OmniMessage, PartialModelPayload, StopReason } from "./types.js";
import { isPartialPayload } from "./types.js";

type PartialKind = PartialModelPayload["type"];

interface OpenFragment {
  kind: PartialKind;
  /** Accumulation buffer for text / thinking / tool_call arguments / tool_call_output. */
  buffer: string;
  name?: string;
  toolCallId?: string;
  /** Images carried by tool_call_output (images aren't incremental — a single delta carries the whole set; a later one overwrites). */
  images?: string[];
  lastStopReason: StopReason;
}

/** Merge key for partial fragments: same type + same tool_call_id counts as the same fragment. */
function fragmentKey(p: PartialModelPayload): string {
  const id = "tool_call_id" in p ? p.tool_call_id : "";
  return `${p.type}::${id}`;
}

function finalize(frag: OpenFragment): OmniMessage {
  switch (frag.kind) {
    case "partial_text":
      return assistantText(frag.buffer, frag.lastStopReason);
    case "partial_thinking":
      return thinkingMessage(frag.buffer, frag.lastStopReason);
    case "partial_tool_call":
      return toolCall({
        name: frag.name ?? "",
        arguments: frag.buffer,
        toolCallId: frag.toolCallId ?? "",
        stopReason: frag.lastStopReason,
      });
    case "partial_tool_call_output":
      return toolCallOutput({
        output: frag.buffer,
        toolCallId: frag.toolCallId ?? "",
        stopReason: frag.lastStopReason,
        ...(frag.images !== undefined ? { images: frag.images } : {}),
      });
  }
}

function appendDelta(frag: OpenFragment, p: PartialModelPayload): void {
  switch (p.type) {
    case "partial_text":
      frag.buffer += p.text;
      break;
    case "partial_thinking":
      frag.buffer += p.thinking;
      break;
    case "partial_tool_call":
      frag.buffer += p.arguments;
      if (p.name) frag.name = p.name;
      frag.toolCallId = p.tool_call_id;
      break;
    case "partial_tool_call_output":
      frag.buffer += p.output;
      if (p.images && p.images.length > 0) frag.images = p.images;
      frag.toolCallId = p.tool_call_id;
      break;
  }
  if (p.stop_reason !== undefined) frag.lastStopReason = p.stop_reason;
}

function newFragment(p: PartialModelPayload): OpenFragment {
  const frag: OpenFragment = {
    kind: p.type,
    buffer: "",
    lastStopReason: "completed",
  };
  if (p.type === "partial_tool_call") {
    frag.name = p.name;
    frag.toolCallId = p.tool_call_id;
  } else if (p.type === "partial_tool_call_output") {
    frag.toolCallId = p.tool_call_id;
  }
  return frag;
}

/**
 * Stateful aggregator. Pushed one message at a time via `push`:
 *   - complete / event / session_meta messages are returned unchanged;
 *   - `partial_*` messages accumulate into an internal fragment, producing a complete message
 *     when `event_type === "stop"`;
 *   - `flush` forcibly emits any fragments that haven't yet received a stop.
 */
export class PartialAggregator {
  private open = new Map<string, OpenFragment>();

  push(msg: OmniMessage): OmniMessage[] {
    if (!isPartialPayload(msg.payload)) {
      return [msg];
    }
    const p = msg.payload;
    const key = fragmentKey(p);
    let frag = this.open.get(key);

    if (p.event_type === "start") {
      // start reopens a fragment; if a fragment with the same key already exists (out-of-order), finalize it first.
      const out: OmniMessage[] = [];
      if (frag) out.push(finalize(frag));
      frag = newFragment(p);
      appendDelta(frag, p);
      this.open.set(key, frag);
      return out;
    }

    if (!frag) {
      // delta/stop without a preceding start: handle leniently, creating a new fragment as needed.
      frag = newFragment(p);
      this.open.set(key, frag);
    }
    appendDelta(frag, p);

    if (p.event_type === "stop") {
      this.open.delete(key);
      return [finalize(frag)];
    }
    return [];
  }

  /** Finalizes: emits all still-open fragments (in the order they were opened). */
  flush(): OmniMessage[] {
    const out = [...this.open.values()].map(finalize);
    this.open.clear();
    return out;
  }
}

/** One-shot aggregation: keeps non-partial messages in their original order, collapsing partial ones into complete messages. */
export function aggregateAll(messages: OmniMessage[]): OmniMessage[] {
  const agg = new PartialAggregator();
  const out: OmniMessage[] = [];
  for (const msg of messages) out.push(...agg.push(msg));
  out.push(...agg.flush());
  return out;
}
