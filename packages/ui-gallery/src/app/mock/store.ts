/**
 * The in-memory demo store one framed app runs against: the fixtures as mutable state, the
 * two event channels the app subscribes to (the user channel and one per Session), and the
 * scripts that keep a running Session running — the executing command, the thinking that
 * keeps growing, the reply that streams on a loop, the command waiting for approval — and
 * stream a reply when a message is sent.
 *
 * One store per document (a frame is a document), created on first use for the frame's
 * language, and re-creatable for tests. Nothing here touches the DOM.
 */
import type { ServerEvent, SessionInfo } from "@prismshadow/penguin-server/api";
import { buildFixtures, DEFAULT_MODEL } from "./fixtures";
import type { DemoFixtures } from "./fixtures";
import { harnessTranscript, orgDeskTranscript } from "./harness-transcript";
import { IDS } from "./ids";
import { streamScript } from "./stream-script";
import {
  abortEvent,
  approvalDecision,
  approvalOutcome,
  approvalTranscript,
  assistantText,
  doneTranscript,
  partial,
  requestEnd,
  replyTitle,
  runningToolTranscript,
  scriptedReply,
  shortTranscript,
  streamingAnswer,
  streamingTranscript,
  thinkingBeats,
  thinkingTranscript,
  tokenUsage,
  toolOutput,
  TOOL_CALL_IDS,
  userText,
} from "./transcripts";
import type { Transcript } from "./transcripts";
import { payloadOf } from "./types";
import type { Lang, OmniMessage, StreamHandlers } from "./types";

// ---------------------------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------------------------

/** The one epoch every id of this store carries: a frame never reconnects to another server. */
const EPOCH = "g1";

/** The streaming Session's loop: the wait before a round's stream opens (after the rewind). */
export const REPLY_LEAD_MS = 700;
/** How long the settled reply stays up before the loop rewinds it. */
export const REPLY_HOLD_MS = 2600;
/** The wait between a round's last delta and the fragment's close. */
export const REPLY_CLOSE_MS = 160;

/** A channel: subscribers, and the running id the server stamps on every event. */
class Channel {
  private seq = 0;
  private readonly subscribers = new Set<StreamHandlers>();

  /** The id of the last event published — the live tail's cursor. */
  get cursor(): string {
    return `${EPOCH}-${this.seq}`;
  }

  subscribe(handlers: StreamHandlers): () => void {
    this.subscribers.add(handlers);
    return () => this.subscribers.delete(handlers);
  }

  private nextId(): string {
    this.seq += 1;
    return `${EPOCH}-${this.seq}`;
  }

  message(msg: OmniMessage, only?: StreamHandlers): void {
    const id = this.nextId();
    for (const s of only ? [only] : this.subscribers) s.onOmniMessage(msg, id);
  }

  event(ev: ServerEvent, only?: StreamHandlers): void {
    const id = this.nextId();
    for (const s of only ? [only] : this.subscribers) s.onServerEvent(ev, id);
  }
}

// ---------------------------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------------------------

/** What a Session's live state adds to its rows and history. */
interface Live {
  transcript: Transcript;
  channel: Channel;
  /** Timers of a running script, cleared on abort or dispose. */
  timers: number[];
  /** The history length the looping reply rewinds to (the streaming Session only). */
  loopFrom?: number;
}

export class DemoStore {
  readonly f: DemoFixtures;
  readonly lang: Lang;
  /** Signed in as the fixtures' admin, or nobody. */
  signedIn: boolean;
  readonly userChannel = new Channel();
  private readonly live = new Map<string, Live>();
  private created = 0;

  constructor(lang: Lang, now: number, signedIn: boolean) {
    this.lang = lang;
    this.signedIn = signedIn;
    this.f = buildFixtures(lang, now);
    const ref = DEFAULT_MODEL;
    const seeded: Record<string, Transcript> = {
      [IDS.sessions.done]: doneTranscript(lang, now, ref),
      [IDS.sessions.runningTool]: runningToolTranscript(lang, now, ref),
      [IDS.sessions.thinking]: thinkingTranscript(lang, now, ref),
      [IDS.sessions.streaming]: streamingTranscript(lang, now, ref),
      [IDS.sessions.approval]: approvalTranscript(lang, now, ref),
      [IDS.sessions.harness]: harnessTranscript(lang, now, ref),
      [IDS.sessions.orgDesk]: orgDeskTranscript(lang, now, ref),
    };
    for (const row of this.f.sessions) {
      const transcript =
        seeded[row.sessionId] ??
        shortTranscript(lang, row.sessionId, Date.parse(row.createdAt), ref);
      this.live.set(row.sessionId, { transcript, channel: new Channel(), timers: [] });
    }
    const streaming = this.live.get(IDS.sessions.streaming);
    if (streaming) streaming.loopFrom = streaming.transcript.history.length;
  }

  // ---- Sessions --------------------------------------------------------------------------

  session(sessionId: string): SessionInfo | undefined {
    return this.f.sessions.find((s) => s.sessionId === sessionId);
  }

  transcript(sessionId: string): Transcript | undefined {
    return this.live.get(sessionId)?.transcript;
  }

  channel(sessionId: string): Channel | undefined {
    return this.live.get(sessionId)?.channel;
  }

  /** The live tail of a running Session: the open fragments and the channel cursor they cover. */
  liveTail(sessionId: string): { cursor: string; fragments: OmniMessage[] } | undefined {
    const live = this.live.get(sessionId);
    if (!live || !live.transcript.running) return undefined;
    const fragments: OmniMessage[] = [];
    const thinking = live.transcript.openThinking;
    if (thinking)
      fragments.push(
        partial(thinking.startedAt, {
          type: "partial_thinking",
          role: "assistant",
          event_type: "start",
          thinking: thinking.text,
        }),
      );
    const text = live.transcript.openText;
    if (text)
      fragments.push(
        partial(text.startedAt, {
          type: "partial_text",
          role: "assistant",
          event_type: "start",
          text: text.text,
        }),
      );
    return { cursor: live.channel.cursor, fragments };
  }

  /**
   * A new Session (the draft's first send, a fork, a compaction's self-heal). Prepended to the
   * list, announced on the user channel, and given an empty transcript that the first Task
   * fills.
   */
  createSession(agentId: string, body: Partial<SessionInfo> & { title?: string }): SessionInfo {
    this.created += 1;
    const now = Date.now();
    const row: SessionInfo = {
      sessionId: `s-new-${this.created}`,
      projectId: IDS.project,
      agentId,
      provider: body.provider ?? DEFAULT_MODEL.provider,
      modelId: body.modelId ?? DEFAULT_MODEL.modelId,
      workspace: body.workspace ?? IDS.workspace,
      approvalMode: body.approvalMode ?? "allow-all",
      sandbox: body.sandbox ??
        this.f.chatDefaults.sandbox ?? { mode: "workspace-write", network: "open" },
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      createdAt: new Date(now).toISOString(),
      lastActiveAt: new Date(now).toISOString(),
      status: "idle",
      pendingApprovalCount: 0,
      pendingFollowUpCount: 0,
      hasTrace: false,
      archived: false,
      client: "web",
    };
    this.f.sessions.unshift(row);
    this.live.set(row.sessionId, {
      transcript: { history: [], running: false },
      channel: new Channel(),
      timers: [],
    });
    this.userChannel.event({
      type: "session_created",
      projectId: IDS.project,
      agentId,
      sessionId: row.sessionId,
    });
    return row;
  }

  deleteSession(sessionId: string): boolean {
    const index = this.f.sessions.findIndex((s) => s.sessionId === sessionId);
    if (index === -1) return false;
    this.stopScript(sessionId);
    this.f.sessions.splice(index, 1);
    this.live.delete(sessionId);
    return true;
  }

  patchSession(sessionId: string, patch: Partial<SessionInfo>): SessionInfo | undefined {
    const row = this.session(sessionId);
    if (!row) return undefined;
    Object.assign(row, patch);
    if (patch.title !== undefined) {
      this.userChannel.event({ type: "session_title", sessionId, title: patch.title });
    }
    return row;
  }

  // ---- Running state ---------------------------------------------------------------------

  /**
   * What a fresh subscription is told first: the run state snapshot, then every approval still
   * pending — exactly what the server resends on connect — then a transcript's goal events.
   */
  onSubscribe(sessionId: string, handlers: StreamHandlers): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    const row = this.session(sessionId);
    live.channel.event({ type: "task_state", state: row?.status ?? "idle" }, handlers);
    const pending = live.transcript.pendingApproval;
    if (pending) live.channel.event({ type: "approval_request", toolCall: pending }, handlers);
    for (const goal of live.transcript.goalEvents ?? []) live.channel.event(goal, handlers);
    if (sessionId === IDS.sessions.thinking) this.keepThinking(live);
    if (sessionId === IDS.sessions.streaming) this.keepStreaming(sessionId, live);
  }

  private setStatus(sessionId: string, state: SessionInfo["status"]): void {
    const row = this.session(sessionId);
    const live = this.live.get(sessionId);
    if (!row || !live) return;
    row.status = state;
    row.lastActiveAt = new Date().toISOString();
    row.hasTrace = true;
    live.transcript.running = state !== "idle";
    live.channel.event({ type: "task_state", state });
    this.userChannel.event({
      type: "session_state",
      sessionId,
      state,
      lastActiveAt: row.lastActiveAt,
      hasTrace: true,
    });
  }

  private schedule(live: Live, at: number, run: () => void): void {
    live.timers.push(setTimeout(run, at) as unknown as number);
  }

  private stopScript(sessionId: string): void {
    const live = this.live.get(sessionId);
    if (!live) return;
    for (const timer of live.timers) clearTimeout(timer);
    live.timers = [];
  }

  /** Publishes a message on a Session's channel and records it as history, stamped now. */
  private emit(live: Live, msg: OmniMessage): void {
    const stamped: OmniMessage = { ...msg, timestamp: new Date().toISOString() };
    live.channel.message(stamped);
    const payload = payloadOf(stamped);
    if (payload === null || !payload.type.startsWith("partial_"))
      live.transcript.history.push(stamped);
  }

  /** The thinking Session's fragment keeps growing, one beat every 1.6 s, until it is opened elsewhere or aborted. */
  private keepThinking(live: Live): void {
    const open = live.transcript.openThinking;
    if (!open || live.timers.length > 0) return;
    const beats = thinkingBeats(this.lang);
    let index = 2;
    const tick = () => {
      const beat = beats[index % beats.length]!;
      index += 1;
      open.text += beat;
      live.channel.message(
        partial(Date.now(), {
          type: "partial_thinking",
          role: "assistant",
          event_type: "delta",
          thinking: beat,
        }),
      );
      if (index < 40) this.schedule(live, 1600, tick);
    };
    this.schedule(live, 1600, tick);
  }

  /**
   * The streaming Session's reply, on a loop while its Task runs. Each round opens the text
   * fragment, streams the answer in bursty deltas (stream-script.ts; the round number seeds it,
   * so no two rounds share a rhythm), closes the fragment with the complete message, and holds
   * it on screen. Then the round is rewound out of the history, and the channel says
   * `resync_required`, the server's own "refetch the history" signal, so the page rebuilds
   * without the old answer and the next round streams in its place. The transcript never grows.
   */
  private keepStreaming(sessionId: string, live: Live): void {
    const from = live.loopFrom;
    if (from === undefined || live.timers.length > 0) return;
    if (this.session(sessionId)?.status !== "running") return;
    const answer = streamingAnswer(this.lang);
    const text = (eventType: "start" | "delta" | "stop", delta: string) =>
      partial(0, { type: "partial_text", role: "assistant", event_type: eventType, text: delta });
    let round = 0;
    const play = () => {
      // Every timer of the previous round has fired; the array holds this round's alone.
      live.timers = [];
      round += 1;
      let at = REPLY_LEAD_MS;
      this.schedule(live, at, () => {
        live.transcript.openText = { startedAt: Date.now(), text: "" };
        this.emit(live, text("start", ""));
      });
      for (const chunk of streamScript(answer, round)) {
        at += chunk.gap;
        this.schedule(live, at, () => {
          if (live.transcript.openText) live.transcript.openText.text += chunk.text;
          this.emit(live, text("delta", chunk.text));
        });
      }
      at += REPLY_CLOSE_MS;
      this.schedule(live, at, () => {
        delete live.transcript.openText;
        this.emit(live, text("stop", ""));
        this.emit(live, assistantText(0, answer));
      });
      at += REPLY_HOLD_MS;
      this.schedule(live, at, () => {
        live.transcript.history.length = from;
        live.channel.event({ type: "resync_required" });
        play();
      });
    };
    play();
  }

  /**
   * A sent message: the Session runs, the prompt is echoed as the user's text, then the
   * scripted reply streams and the Session settles. The first turn of a new Session also
   * earns it a title.
   */
  startTask(sessionId: string, text: string): boolean {
    const live = this.live.get(sessionId);
    const row = this.session(sessionId);
    if (!live || !row) return false;
    if (row.status !== "idle") return false;
    const firstTurn = live.transcript.history.length === 0;
    this.stopScript(sessionId);
    this.setStatus(sessionId, "running");
    this.emit(live, userText(Date.now(), text));
    const callId = `call_${Date.now().toString(36)}`;
    const steps = scriptedReply(this.lang, callId);
    for (const step of steps) this.schedule(live, step.at, () => this.emit(live, step.msg));
    const last = steps[steps.length - 1]?.at ?? 0;
    this.schedule(live, last + 200, () => {
      if (firstTurn) this.patchSession(sessionId, { title: replyTitle(this.lang) });
      this.setStatus(sessionId, "idle");
      live.timers = [];
    });
    return true;
  }

  abort(sessionId: string): void {
    const live = this.live.get(sessionId);
    const row = this.session(sessionId);
    if (!live || !row || row.status === "idle") return;
    this.stopScript(sessionId);
    if (live.transcript.openThinking) delete live.transcript.openThinking;
    const open = live.transcript.openText;
    if (open) {
      // The streamed part stays, closed as aborted, as the engine records a cut-off reply.
      delete live.transcript.openText;
      this.emit(
        live,
        partial(0, {
          type: "partial_text",
          role: "assistant",
          event_type: "stop",
          text: "",
          stop_reason: "aborted",
        }),
      );
      if (open.text !== "") this.emit(live, assistantText(0, open.text, "aborted"));
    }
    if (live.transcript.pendingApproval) {
      delete live.transcript.pendingApproval;
      row.pendingApprovalCount = 0;
    }
    this.emit(live, abortEvent(Date.now()));
    this.setStatus(sessionId, "idle");
  }

  /** A decision on the pending command: the event, then the command's outcome and the answer. */
  decide(sessionId: string, toolCallId: string, decision: "allow" | "deny"): boolean {
    const live = this.live.get(sessionId);
    const row = this.session(sessionId);
    const pending = live?.transcript.pendingApproval;
    if (!live || !row || !pending || pending.payload.tool_call_id !== toolCallId) return false;
    delete live.transcript.pendingApproval;
    row.pendingApprovalCount = 0;
    const outcome = approvalOutcome(this.lang, decision);
    this.emit(live, approvalDecision(Date.now(), toolCallId, decision));
    this.schedule(live, decision === "allow" ? 1800 : 200, () => {
      this.emit(live, toolOutput(Date.now(), toolCallId, outcome.output));
      this.emit(live, requestEnd(Date.now()));
    });
    this.schedule(live, decision === "allow" ? 3200 : 1200, () => {
      this.emit(live, assistantText(Date.now(), outcome.text));
      this.emit(live, tokenUsage(Date.now(), 22_400, 6_100));
      this.emit(live, requestEnd(Date.now()));
      this.setStatus(sessionId, "idle");
      live.timers = [];
    });
    return true;
  }

  /** The executing command hands itself to the background: the turn closes, the command runs on. */
  detachToolCall(sessionId: string, toolCallId: string): boolean {
    const live = this.live.get(sessionId);
    const row = this.session(sessionId);
    if (!live || !row || toolCallId !== TOOL_CALL_IDS.runningCommand) return false;
    this.emit(
      live,
      toolOutput(
        Date.now(),
        toolCallId,
        this.lang === "zh"
          ? "[detached] 命令已转入后台继续运行。"
          : "[detached] The command keeps running in the background.",
      ),
    );
    this.emit(live, requestEnd(Date.now()));
    this.setStatus(sessionId, "idle");
    row.backgroundTasks = { processes: 1, subagents: 0 };
    this.userChannel.event({ type: "session_background", sessionId, processes: 1, subagents: 0 });
    return true;
  }

  dispose(): void {
    for (const id of this.live.keys()) this.stopScript(id);
  }
}

// ---------------------------------------------------------------------------------------------
// The one store of this document
// ---------------------------------------------------------------------------------------------

let current: DemoStore | null = null;

/** The store the frame's language and sign-in state ask for; created once per document. */
export function getStore(init?: { lang: Lang; signedIn: boolean }): DemoStore {
  if (current === null) {
    current = new DemoStore(init?.lang ?? "en", Date.now(), init?.signedIn ?? true);
  }
  return current;
}

/** A fresh store (tests, and a frame that re-seeds itself). */
export function resetStore(init: { lang: Lang; signedIn: boolean; now?: number }): DemoStore {
  current?.dispose();
  current = new DemoStore(init.lang, init.now ?? Date.now(), init.signedIn);
  return current;
}
