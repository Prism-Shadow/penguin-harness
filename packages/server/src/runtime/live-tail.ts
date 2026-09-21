/**
 * Live tail of a running Session's stream: the accumulated state of every OPEN
 * streaming fragment (partial_text / partial_thinking / partial_tool_call /
 * partial_tool_call_output), kept per origin chain.
 *
 * Why: `partial_*` messages never reach the Trace (core's Writer filters them), so a
 * client that joins mid-stream — a refresh during a long tool call — cannot rebuild the
 * in-progress message from `GET /messages` alone, and its fresh EventSource carries no
 * `Last-Event-ID` for the channel buffer to replay. This tracker lets the messages
 * endpoint attach, alongside history, one synthetic `partial_* start` OmniMessage per
 * open fragment whose payload carries the full accumulated content so far (text/thinking
 * prefix, tool-call name + accumulated arguments, tool-output prefix + images); the
 * client seeds these into its stream model and live deltas keep appending on top. See
 * `MessagesResponse.live` in api/types.ts for the client-facing contract.
 *
 * Fed by SessionManager.drive in the same synchronous tick as each channel publish, so a
 * "channel cursor + fragments" capture between two publishes is always a consistent
 * snapshot. Mirrors core PartialAggregator's merge semantics (fragment key = payload type
 * + tool_call_id; start reopens, delta accumulates, stop closes) with the origin chain
 * added to the key — the aggregator collapses fragments into complete messages, while
 * this keeps the running prefix instead. A complete model message with the same identity
 * also closes the fragment (covers stop-less closures, e.g. interruption cleanup); the
 * whole session entry is dropped when the run ends (SessionManager.drive's finally).
 */
import { isPartialPayload } from "@prismshadow/penguin-core";
import type {
  CompleteModelPayload,
  OmniMessage,
  PartialModelPayload,
} from "@prismshadow/penguin-core";

type PartialKind = PartialModelPayload["type"];

/**
 * Per-fragment accumulation cap. Environment already front-truncates tool output online
 * (default 16k chars), so tool fragments stay small by construction; text/thinking have
 * no upstream cap and a fast large-code reply can reach a few hundred KB (see the channel
 * buffer sizing note) — 512KB covers that comfortably while bounding a runaway fragment.
 * When the cap trips, the TAIL is kept (the prefix is dropped): the seeded content then
 * joins seamlessly with the live deltas that follow the capture, and the complete message
 * reconciles the full content at the end anyway. Trimming happens with slack so it costs
 * one copy per `FRAGMENT_CAP_SLACK` chars of growth, not one per delta. Tail-keeping is a
 * deliberate one-rule-for-all: it is seamless for text/thinking/tool output, and for
 * `partial_tool_call` arguments it yields a syntactically broken JSON prefix — accepted,
 * since arguments approaching 512KB are not reachable in practice and the complete
 * message reconciles either way.
 */
const FRAGMENT_CAP = 512 * 1024;
const FRAGMENT_CAP_SLACK = 64 * 1024;

interface OpenFragment {
  kind: PartialKind;
  /** Origin chain copied from the opening message (absent = main session). */
  origin?: string[];
  /** Timestamp of the fragment's original start (reused on the synthetic start). */
  timestamp: string;
  /** Accumulated text / thinking / tool-call arguments / tool output (tail-capped). */
  buffer: string;
  name?: string;
  toolCallId?: string;
  /** Tool-output images: not incremental — a single delta carries the whole set; a later one overwrites. */
  images?: string[];
}

/** The partial kind a complete payload closes out; null when it has no streamed counterpart. */
function partialKindFor(p: CompleteModelPayload): PartialKind | null {
  switch (p.type) {
    case "text":
      // Only assistant text streams; a user text mid-run (steering) must not close the model's open fragment.
      return p.role === "assistant" ? "partial_text" : null;
    case "thinking":
      return "partial_thinking";
    case "tool_call":
      return "partial_tool_call";
    case "tool_call_output":
      return "partial_tool_call_output";
    default:
      return null;
  }
}

/** Fragment key: origin chain + payload type + tool_call_id (same merge rule as core's PartialAggregator, origin added). */
function fragmentKey(origin: string[] | undefined, kind: PartialKind, toolCallId: string): string {
  // "\0" (the escape, not a raw byte -- a raw NUL makes git classify the file as binary)
  // separates the origin chain from the kind: session ids are [A-Za-z0-9_-], so the
  // separator can never occur inside a chain segment and keys cannot collide.
  return `${(origin ?? []).join("/")}\0${kind}::${toolCallId}`;
}

function toolCallIdOf(p: object): string {
  const id = (p as { tool_call_id?: unknown }).tool_call_id;
  return typeof id === "string" ? id : "";
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
  if (frag.buffer.length > FRAGMENT_CAP + FRAGMENT_CAP_SLACK) {
    frag.buffer = frag.buffer.slice(frag.buffer.length - FRAGMENT_CAP);
  }
}

/** The synthetic `partial_* start` payload carrying the fragment's full accumulated content. */
function startPayload(frag: OpenFragment): PartialModelPayload {
  switch (frag.kind) {
    case "partial_text":
      return { type: "partial_text", role: "assistant", event_type: "start", text: frag.buffer };
    case "partial_thinking":
      return {
        type: "partial_thinking",
        role: "assistant",
        event_type: "start",
        thinking: frag.buffer,
      };
    case "partial_tool_call":
      return {
        type: "partial_tool_call",
        role: "assistant",
        event_type: "start",
        name: frag.name ?? "",
        arguments: frag.buffer,
        tool_call_id: frag.toolCallId ?? "",
      };
    case "partial_tool_call_output":
      return {
        type: "partial_tool_call_output",
        role: "user",
        event_type: "start",
        output: frag.buffer,
        ...(frag.images !== undefined && frag.images.length > 0 ? { images: frag.images } : {}),
        tool_call_id: frag.toolCallId ?? "",
      };
  }
}

/** The open streaming fragments of running sessions, as their holder uses them — what {@link LiveTailTracker} implements. */
export interface LiveTail {
  observe(sessionId: string, msg: OmniMessage): void;
  fragments(sessionId: string): OmniMessage[];
  clear(sessionId: string): void;
}

export class LiveTailTracker implements LiveTail {
  /** sessionId → open fragments keyed by fragmentKey, in the order they were opened. */
  private readonly sessions = new Map<string, Map<string, OpenFragment>>();

  /** Feed one published message (call in the same synchronous tick as the channel publish). */
  observe(sessionId: string, msg: OmniMessage): void {
    if (msg.type !== "model_msg") return;
    const p = msg.payload;
    if (!isPartialPayload(p)) {
      // A complete message closes the matching open fragment (normally the stop already
      // did; this also covers stop-less closures such as interruption cleanup).
      const kind = partialKindFor(p as CompleteModelPayload);
      if (kind === null) return;
      const open = this.sessions.get(sessionId);
      if (!open) return;
      open.delete(fragmentKey(msg.origin, kind, toolCallIdOf(p)));
      if (open.size === 0) this.sessions.delete(sessionId);
      return;
    }
    const key = fragmentKey(msg.origin, p.type, toolCallIdOf(p));
    let open = this.sessions.get(sessionId);
    if (p.event_type === "start") {
      if (!open) {
        open = new Map();
        this.sessions.set(sessionId, open);
      }
      // start reopens the fragment: a previous same-key fragment (out-of-order) is replaced.
      const frag: OpenFragment = {
        kind: p.type,
        timestamp: msg.timestamp,
        buffer: "",
        ...(msg.origin && msg.origin.length > 0 ? { origin: [...msg.origin] } : {}),
      };
      open.delete(key); // re-insert so the emit order tracks the reopen
      open.set(key, frag);
      appendDelta(frag, p);
      return;
    }
    let frag = open?.get(key);
    if (!frag) {
      // delta/stop without a start: lenient, same as core's PartialAggregator.
      if (p.event_type === "stop") return; // nothing was open; nothing to keep or clear
      if (!open) {
        open = new Map();
        this.sessions.set(sessionId, open);
      }
      frag = {
        kind: p.type,
        timestamp: msg.timestamp,
        buffer: "",
        ...(msg.origin && msg.origin.length > 0 ? { origin: [...msg.origin] } : {}),
      };
      open.set(key, frag);
    }
    appendDelta(frag, p);
    if (p.event_type === "stop") {
      open!.delete(key);
      if (open!.size === 0) this.sessions.delete(sessionId);
    }
  }

  /**
   * Synthetic `partial_* start` messages for every open fragment (in open order), each
   * carrying the full accumulated content, the original origin chain, and the original
   * start timestamp. Empty when the session has no open fragments.
   */
  fragments(sessionId: string): OmniMessage[] {
    const open = this.sessions.get(sessionId);
    if (!open) return [];
    const out: OmniMessage[] = [];
    for (const frag of open.values()) {
      out.push({
        timestamp: frag.timestamp,
        type: "model_msg",
        payload: startPayload(frag),
        ...(frag.origin !== undefined ? { origin: [...frag.origin] } : {}),
      });
    }
    return out;
  }

  /** Drop all fragment state for a session (the run ended; nothing will continue these fragments). */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
