/**
 * Live tail of a running Session's stream, in the two forms GET /messages serves it (see
 * `MessagesLiveTail` in api/types.ts for the client-facing contract):
 *
 * - **Open fragments**: the accumulated state of every OPEN streaming fragment
 *   (partial_text / partial_thinking / partial_tool_call / partial_tool_call_output), kept per
 *   origin chain. `partial_*` messages never reach the Trace (core's Writer filters them), so a
 *   client that joins mid-stream — a refresh during a long tool call — cannot rebuild the
 *   in-progress message from history alone, and its fresh EventSource carries no
 *   `Last-Event-ID` for the channel buffer to replay. `fragments()` gives one synthetic
 *   `partial_* start` AmspRecord per open fragment whose payload carries the full accumulated
 *   content so far (text/thinking prefix, tool-call name + accumulated arguments, tool-output
 *   prefix + images); the client seeds these into its stream model and live deltas keep
 *   appending on top.
 * - **The run's records** (the run form, `live=run`): everything the current run published, in
 *   publish order, each fragment's deltas folded into its `start` — the run's stream as a client
 *   that had watched it from the start would hold it, so a client that joins mid-run can show
 *   the run so far without reconciling the stream against history. A run is one
 *   `SessionManager.drive` (a Task, a goal loop, a compaction or a model switch): `begin` opens
 *   its log, `clear` drops it. The log is byte-capped; past the cap its oldest entries that are
 *   not open fragments go first and are counted.
 *
 * Fed by SessionManager.drive in the same synchronous tick as each channel publish, so a
 * "channel cursor + fragments + records" capture between two publishes is always a consistent
 * snapshot. A fragment is keyed by origin chain + payload type + tool_call_id; start reopens
 * it, delta accumulates its running prefix, stop closes it. A complete model message with the
 * same identity also closes the fragment (covers stop-less closures, e.g. interruption
 * cleanup); the whole session entry is dropped when the run ends (SessionManager.drive's
 * finally).
 */
import { createHash } from "node:crypto";
import { isPartialPayload } from "@prismshadow/penguin-core";
import type {
  CompleteModelPayload,
  AmspRecord,
  PartialModelPayload,
} from "@prismshadow/penguin-core";
import type { ChannelEvent } from "./channel.js";

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

/**
 * Byte cap of one run's log, measured in published event bytes (a folded fragment counts its
 * opening event plus the content folded into it). The channel buffer holds the same bytes up
 * to its own 8MB bound; a run's log outlives the buffer's window only as far as this cap.
 */
const RUN_LOG_CAP = 8 * 1024 * 1024;

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
  /** False once a stop, its complete message or a reopening start closed it. */
  open: boolean;
  /** The run-log entry that renders this fragment, while a run log is kept. */
  entry?: FragmentEntry;
}

/** A run-log entry kept as published: a complete message, a `stop`, an event, a `session_meta`. */
interface RecordEntry {
  record: AmspRecord;
  bytes: number;
}

/** A run-log entry for one streamed fragment: rendered as its start, carrying what was folded in. */
interface FragmentEntry {
  fragment: OpenFragment;
  /** The opening event's size. */
  base: number;
  bytes: number;
}

type RunEntry = RecordEntry | FragmentEntry;

/** One run's records, in publish order (see the module comment). */
interface RunLog {
  entries: RunEntry[];
  bytes: number;
  omitted: number;
  starts: RunStart[];
}

/**
 * A record of the run that a history read can hold first: the run's first record that can
 * reach the Trace (a `partial_*` never does), and each of its user inputs — a history window
 * (`tailLimit`) begins at a user input, so one that begins inside the run begins at one of
 * them (the input behind the run's `task_begin`, a goal round, a stop-hook continue). A read
 * is cut at the earliest of these it holds (services/session-history.ts `cutBeforeRun`).
 */
export interface RunStart {
  /** The channel event id the record went out as (`<epoch>-<seq>`). */
  id: string;
  timestamp: string;
  /** `envelopeDigest` of the record as published; the Trace holds the same bytes. */
  digest: string;
}

/**
 * The digest a record's envelope (its JSON) is compared by: a run's user inputs can carry
 * images of many megabytes, and a digest holds none of them for the run's length.
 */
export function envelopeDigest(envelope: string): string {
  return createHash("sha256").update(envelope).digest("base64");
}

/** The current run's log, as the run form of GET /messages reads it. */
export interface LiveRun {
  /** The run's records in publish order, each fragment rendered as its start with what was folded in. */
  records: AmspRecord[];
  /** How many of the run's oldest records the byte cap dropped. */
  omitted: number;
  starts: RunStart[];
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

/** Fragment key: origin chain + payload type + tool_call_id. */
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

/** The synthetic start record of a fragment: its original timestamp and origin chain. */
function startRecord(frag: OpenFragment): AmspRecord {
  return {
    timestamp: frag.timestamp,
    type: "model_msg",
    payload: startPayload(frag),
    ...(frag.origin !== undefined ? { origin: [...frag.origin] } : {}),
  };
}

/** What a fragment's accumulated content weighs in the run log. */
function contentBytes(frag: OpenFragment): number {
  let bytes = frag.buffer.length + (frag.name?.length ?? 0);
  for (const image of frag.images ?? []) bytes += image.length;
  return bytes;
}

function newFragment(kind: PartialKind, msg: AmspRecord): OpenFragment {
  return {
    kind,
    timestamp: msg.timestamp,
    buffer: "",
    open: true,
    ...(msg.origin && msg.origin.length > 0 ? { origin: [...msg.origin] } : {}),
  };
}

const isMain = (msg: AmspRecord): boolean => msg.origin === undefined || msg.origin.length === 0;

/** A user's text or image: where a history window can begin (tool outputs are role `user` too). */
function isUserInput(msg: AmspRecord): boolean {
  const p = msg.payload as { type?: string; role?: string };
  return (
    msg.type === "model_msg" && p.role === "user" && (p.type === "text" || p.type === "image_url")
  );
}

/** The live tail of running sessions, as their holder uses it — what {@link LiveTailTracker} implements. */
export interface LiveTail {
  /** A run starts on the Session: a fresh log of its records (nothing from before it continues). */
  begin(sessionId: string): void;
  /** Feed one published message with the channel event it went out as. */
  observe(sessionId: string, msg: AmspRecord, published: ChannelEvent): void;
  fragments(sessionId: string): AmspRecord[];
  /** The current run's log; null when no run is under way. */
  run(sessionId: string): LiveRun | null;
  clear(sessionId: string): void;
}

export class LiveTailTracker implements LiveTail {
  /** sessionId → open fragments keyed by fragmentKey, in the order they were opened. */
  private readonly sessions = new Map<string, Map<string, OpenFragment>>();
  /** sessionId → the current run's log (between `begin` and `clear`). */
  private readonly runs = new Map<string, RunLog>();

  begin(sessionId: string): void {
    this.clear(sessionId);
    this.runs.set(sessionId, { entries: [], bytes: 0, omitted: 0, starts: [] });
  }

  /** Feed one published message (call in the same synchronous tick as the channel publish). */
  observe(sessionId: string, msg: AmspRecord, published: ChannelEvent): void {
    const folded = this.track(sessionId, msg);
    const run = this.runs.get(sessionId);
    if (run !== undefined) logRecord(run, msg, published, folded);
  }

  /**
   * Fragment bookkeeping for one message. Returns the fragment its content folded into (a
   * start or a delta), or null for anything kept as published (a stop, a complete message, a
   * non-model record).
   */
  private track(sessionId: string, msg: AmspRecord): OpenFragment | null {
    if (msg.type !== "model_msg") return null;
    const p = msg.payload;
    if (!isPartialPayload(p)) {
      // A complete message closes the matching open fragment (normally the stop already
      // did; this also covers stop-less closures such as interruption cleanup).
      const kind = partialKindFor(p as CompleteModelPayload);
      if (kind === null) return null;
      this.close(sessionId, fragmentKey(msg.origin, kind, toolCallIdOf(p)));
      return null;
    }
    const key = fragmentKey(msg.origin, p.type, toolCallIdOf(p));
    if (p.event_type === "stop") {
      // A bare stop with nothing open is a no-op.
      this.close(sessionId, key);
      return null;
    }
    let open = this.sessions.get(sessionId);
    if (!open) {
      open = new Map();
      this.sessions.set(sessionId, open);
    }
    let frag = p.event_type === "start" ? undefined : open.get(key);
    if (!frag) {
      // start reopens the fragment: a previous same-key fragment (out-of-order) is replaced.
      // A delta without a start is lenient: it opens the fragment.
      const previous = open.get(key);
      if (previous) previous.open = false;
      frag = newFragment(p.type, msg);
      open.delete(key); // re-insert so the emit order tracks the reopen
      open.set(key, frag);
    }
    appendDelta(frag, p);
    return frag;
  }

  private close(sessionId: string, key: string): void {
    const open = this.sessions.get(sessionId);
    const frag = open?.get(key);
    if (!open || !frag) return;
    frag.open = false;
    open.delete(key);
    if (open.size === 0) this.sessions.delete(sessionId);
  }

  /**
   * Synthetic `partial_* start` messages for every open fragment (in open order), each
   * carrying the full accumulated content, the original origin chain, and the original
   * start timestamp. Empty when the session has no open fragments.
   */
  fragments(sessionId: string): AmspRecord[] {
    const open = this.sessions.get(sessionId);
    if (!open) return [];
    return [...open.values()].map(startRecord);
  }

  run(sessionId: string): LiveRun | null {
    const run = this.runs.get(sessionId);
    if (run === undefined) return null;
    return {
      records: run.entries.map((e) => ("record" in e ? e.record : startRecord(e.fragment))),
      omitted: run.omitted,
      starts: [...run.starts],
    };
  }

  /** Drop all state for a session (the run ended; nothing will continue its fragments). */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.runs.delete(sessionId);
  }
}

/** Appends one published message to the run's log (folding a fragment's content into its entry), then holds the log to its cap. */
function logRecord(
  run: RunLog,
  msg: AmspRecord,
  published: ChannelEvent,
  folded: OpenFragment | null,
): void {
  if (folded === null) {
    run.entries.push({ record: msg, bytes: published.data.length });
    run.bytes += published.data.length;
    // A stop is a `partial_*` too: never in the Trace, so never where a read is cut.
    const streamed = msg.type === "model_msg" && isPartialPayload(msg.payload);
    if (isMain(msg) && !streamed && (run.starts.length === 0 || isUserInput(msg))) {
      run.starts.push({
        id: published.id,
        timestamp: msg.timestamp,
        digest: envelopeDigest(published.data),
      });
    }
  } else if (folded.entry === undefined) {
    const entry: FragmentEntry = { fragment: folded, base: published.data.length, bytes: 0 };
    entry.bytes = entry.base + contentBytes(folded);
    folded.entry = entry;
    run.entries.push(entry);
    run.bytes += entry.bytes;
  } else {
    const entry = folded.entry;
    const bytes = entry.base + contentBytes(folded);
    run.bytes += bytes - entry.bytes;
    entry.bytes = bytes;
  }
  while (run.bytes > RUN_LOG_CAP) {
    const i = run.entries.findIndex((e) => !("fragment" in e && e.fragment.open));
    if (i < 0) break; // only open fragments are left; each is capped on its own
    const [dropped] = run.entries.splice(i, 1);
    run.bytes -= dropped!.bytes;
    run.omitted += 1;
  }
}
