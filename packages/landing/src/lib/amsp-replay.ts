/**
 * The /amsp player's two panes as functions of how many events have arrived: the events pane is
 * one `eventLine` per event, the assembled pane is `foldEvents` over the first `count`. Pure, so
 * the finished state, every step of the replay and the tests read the same code.
 *
 * The fold reads a run the way a client of the protocol does: fragments open an item and grow
 * it; the complete record closes it with its own content, never compared with the fragments
 * joined (they are two renderings of one message, and only the complete one is stored); a tool's
 * output belongs to its call's Request even when it completes after that Request's
 * `request_end`; `task_end` closes the run. Page-specific on purpose: SDK 1.0's `SessionReader`
 * and the Web App's view model do this for real, and neither is a dependency of the landing site.
 */
import type {
  AmspEvent,
  StopReason,
  StreamPhase,
  ThinkingLevel,
  TokenCounts,
} from "./amsp-protocol";
import { isStored } from "./amsp-vocabulary";

export type ItemKind = "text" | "thinking" | "tool_call" | "tool_call_output";

/** A tool call's approval: asked and unanswered, or the decision. */
export type Approval = "waiting" | "allow" | "deny" | "forbidden";

export interface ReplayItem {
  key: string;
  kind: ItemKind;
  role: "user" | "assistant";
  /** A tool call's name. */
  name?: string;
  /** The text, thinking, arguments or output: the fragments so far, then the complete record's own. */
  body: string;
  /** Fragments have arrived and the complete record has not. */
  open: boolean;
  /** The Request it belongs to (a tool's output: its call's); 0 before the run's first. */
  request: number;
  approval?: Approval;
}

export interface ReplayRequest {
  index: number;
  thinkingLevel: ThinkingLevel | null;
}

export interface ReplayState {
  items: ReplayItem[];
  requests: ReplayRequest[];
  /** `task_end`'s status, once it has arrived. */
  status: StopReason | null;
  /** The run's usage, summed over its `token_usage` records, once `task_end` has arrived. */
  usage: TokenCounts | null;
  /** From `task_begin` to `task_end`. */
  elapsedMs: number | null;
  done: boolean;
}

const ZERO: TokenCounts = { cache_read: 0, cache_write: 0, output: 0, total: 0 };

const sum = (a: TokenCounts, b: TokenCounts): TokenCounts => ({
  cache_read: a.cache_read + b.cache_read,
  cache_write: a.cache_write + b.cache_write,
  output: a.output + b.output,
  total: a.total + b.total,
});

/** The panes after the first `count` events of a run. */
export function foldEvents(events: readonly AmspEvent[], count: number): ReplayState {
  const items: ReplayItem[] = [];
  const requests: ReplayRequest[] = [];
  let usage = ZERO;
  let startedAt: number | null = null;
  let state: Pick<ReplayState, "status" | "usage" | "elapsedMs" | "done"> = {
    status: null,
    usage: null,
    elapsedMs: null,
    done: false,
  };

  const current = () => requests.length;
  const byKey = (key: string) => items.find((item) => item.key === key);
  /** The open text or thinking of this role, which a fragment grows and a complete record closes. */
  const openProse = (kind: ItemKind, role: ReplayItem["role"]) =>
    items.findLast((item) => item.open && item.kind === kind && item.role === role);
  const callRequest = (callId: string) => byKey(`call:${callId}`)?.request ?? current();

  /** A fragment: opens the item on its first piece, grows it with every delta. */
  const grow = (
    kind: ItemKind,
    role: ReplayItem["role"],
    key: string | null,
    piece: string,
    extra: { name?: string; callId?: string },
  ) => {
    const found = key === null ? openProse(kind, role) : byKey(key);
    if (found !== undefined) {
      // A fragment after its complete record adds nothing.
      if (!found.open) return;
      found.body += piece;
      if (extra.name) found.name = extra.name;
      return;
    }
    items.push({
      key: key ?? `${kind}:${role}:${items.length}`,
      kind,
      role,
      body: piece,
      open: true,
      request: extra.callId !== undefined ? callRequest(extra.callId) : current(),
      ...(extra.name ? { name: extra.name } : {}),
    });
  };

  /** A complete record: closes its open item with its own content, or stands as a new one. */
  const complete = (
    kind: ItemKind,
    role: ReplayItem["role"],
    key: string | null,
    body: string,
    extra: { name?: string; callId?: string },
  ) => {
    const found = key === null ? openProse(kind, role) : byKey(key);
    if (found !== undefined) {
      found.body = body;
      found.open = false;
      if (extra.name) found.name = extra.name;
      return;
    }
    items.push({
      key: key ?? `${kind}:${role}:${items.length}`,
      kind,
      role,
      body,
      open: false,
      request: extra.callId !== undefined ? callRequest(extra.callId) : current(),
      ...(extra.name ? { name: extra.name } : {}),
    });
  };

  for (const event of events.slice(0, count)) {
    if (event.type === "model_msg") {
      const p = event.payload;
      switch (p.type) {
        case "partial_text":
          if (p.event_type !== "stop") grow("text", p.role, null, p.text, {});
          break;
        case "partial_thinking":
          if (p.event_type !== "stop") grow("thinking", p.role, null, p.thinking, {});
          break;
        case "partial_tool_call":
          if (p.event_type !== "stop")
            grow("tool_call", p.role, `call:${p.tool_call_id}`, p.arguments, { name: p.name });
          break;
        case "partial_tool_call_output":
          if (p.event_type !== "stop")
            grow("tool_call_output", p.role, `output:${p.tool_call_id}`, p.output, {
              callId: p.tool_call_id,
            });
          break;
        case "text":
          complete("text", p.role, null, p.text, {});
          break;
        case "thinking":
          complete("thinking", p.role, null, p.thinking, {});
          break;
        case "tool_call":
          complete("tool_call", p.role, `call:${p.tool_call_id}`, p.arguments, { name: p.name });
          break;
        case "tool_call_output":
          complete("tool_call_output", p.role, `output:${p.tool_call_id}`, p.output, {
            callId: p.tool_call_id,
          });
          break;
      }
    } else if (event.type === "event_msg") {
      const p = event.payload;
      switch (p.type) {
        case "task_begin":
          startedAt = Date.parse(event.timestamp);
          break;
        case "request_begin":
          requests.push({ index: requests.length + 1, thinkingLevel: p.thinking_level ?? null });
          break;
        case "token_usage":
          usage = sum(usage, p.request);
          break;
        case "approval_decision": {
          const call = byKey(`call:${p.tool_call_id}`);
          if (call !== undefined) call.approval = p.decision;
          break;
        }
        case "task_end":
          for (const item of items) item.open = false;
          state = {
            status: p.status,
            usage,
            elapsedMs: startedAt === null ? null : Date.parse(event.timestamp) - startedAt,
            done: true,
          };
          break;
      }
    } else if (event.type === "server_event" && event.payload.type === "approval_request") {
      const call = byKey(`call:${event.payload.toolCall.payload.tool_call_id}`);
      if (call !== undefined && call.approval === undefined) call.approval = "waiting";
    }
  }
  return { items, requests, ...state };
}

export interface EventLine {
  envelope: AmspEvent["type"];
  /** `payload.type`; `session_meta`'s payload has none. */
  kind: string;
  /** A fragment's phase. */
  phase: StreamPhase | null;
  /** The Trace stores this event. */
  stored: boolean;
  /** One line of the event's content, cut short. */
  preview: string;
}

const PREVIEW_CHARS = 120;

const cut = (text: string) =>
  text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1)}…` : text;

const quote = (text: string) => JSON.stringify(text);

/** A payload's fields beyond its `type`, as JSON: the preview of a kind this page does not read. */
function rest(payload: object): string {
  const { type: _type, ...fields } = payload as { type?: unknown };
  return Object.keys(fields).length > 0 ? JSON.stringify(fields) : "";
}

/** One row of the events pane. */
export function eventLine(event: AmspEvent): EventLine {
  const line = (kind: string, preview: string, phase: StreamPhase | null = null): EventLine => ({
    envelope: event.type,
    kind,
    phase,
    stored: isStored(event.type, event.type === "session_meta" ? undefined : kind),
    preview: cut(preview),
  });
  /** A fragment: its phase, then what it carries, if anything. */
  const fragment = (kind: string, phase: StreamPhase, head: string, piece: string) =>
    line(kind, [phase, head, piece === "" ? "" : quote(piece)].filter(Boolean).join(" "), phase);

  switch (event.type) {
    case "session_meta": {
      const p = event.payload;
      return line("", `${p.provider}/${p.model_id} · ${p.source}`);
    }
    case "model_msg": {
      const p = event.payload;
      switch (p.type) {
        case "partial_text":
          return fragment(p.type, p.event_type, "", p.text);
        case "partial_thinking":
          return fragment(p.type, p.event_type, "", p.thinking);
        case "partial_tool_call":
          return fragment(p.type, p.event_type, p.name, p.arguments);
        case "partial_tool_call_output":
          return fragment(p.type, p.event_type, "", p.output);
        case "text":
          return line(p.type, `${p.role} ${quote(p.text)}`);
        case "thinking":
          return line(p.type, quote(p.thinking));
        case "tool_call":
          return line(p.type, `${p.name} ${p.arguments}`);
        case "tool_call_output":
          return line(p.type, quote(p.output));
        default:
          return line(p.type, rest(p));
      }
    }
    case "event_msg": {
      const p = event.payload;
      switch (p.type) {
        case "request_begin":
          return line(p.type, p.thinking_level ? `thinking_level ${p.thinking_level}` : "");
        case "request_end":
          return line(p.type, p.status);
        case "token_usage":
          return line(p.type, `request ${p.request.total} · session ${p.session.total}`);
        case "task_end":
          return line(p.type, p.status);
        case "approval_decision":
          return line(p.type, `${p.decision} ${p.tool_call_id}`);
        case "tool_list_ready":
          return line(p.type, p.tools.map((tool) => tool.name).join(", "));
        default:
          return line(p.type, rest(p));
      }
    }
    case "server_event": {
      const p = event.payload;
      switch (p.type) {
        case "hello":
          return line(p.type, [p.session_id, p.agent].filter(Boolean).join(" "));
        case "task_state":
          return line(p.type, p.state);
        case "approval_request":
          return line(p.type, `${p.toolCall.payload.name} ${p.toolCall.payload.tool_call_id}`);
        default:
          return line(p.type, rest(p));
      }
    }
  }
}

/** The pace of the replay: the recorded gap between two events, held within these bounds. */
export const FIRST_STEP_MS = 300;
export const MIN_STEP_MS = 120;
export const MAX_STEP_MS = 900;

/** Milliseconds to wait before showing event i: its gap after event i − 1, clamped. */
export function stepDelays(events: readonly AmspEvent[]): number[] {
  return events.map((event, i) => {
    if (i === 0) return FIRST_STEP_MS;
    const gap = Date.parse(event.timestamp) - Date.parse(events[i - 1]!.timestamp);
    return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, gap));
  });
}

/** When a tool's output completed after its call's `request_end`: how long after, in ms. */
export function resultAfterRequestEnd(events: readonly AmspEvent[]): number | null {
  const kind = (event: AmspEvent) => (event.payload as { type?: string }).type;
  const output = events.findIndex((event) => kind(event) === "tool_call_output");
  if (output < 0) return null;
  const end = events.slice(0, output).findLastIndex((event) => kind(event) === "request_end");
  if (end < 0) return null;
  return Date.parse(events[output]!.timestamp) - Date.parse(events[end]!.timestamp);
}
