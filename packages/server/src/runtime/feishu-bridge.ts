/**
 * Feishu (Lark) bridge: a Web server runtime component holding one long-connection event
 * stream per enabled Session binding (started by the platform next to the Scheduler,
 * stopped when the App is disposed — a hot swap hard-stops it like the scheduler).
 *
 * Inbound (Feishu → Session): every `im.message.receive_v1` on a bound app first records
 * the chat as the binding's reply target; a `text` message then starts a Task on the bound
 * Session as a `[feishu_message]`-prefixed server input (`queueIfBusy`: a busy Session
 * queues it as a follow-up, never 409), and any other message type gets a polite bilingual
 * "text only" reply.
 *
 * Outbound (Session → Feishu): the bridge subscribes to the Session's in-process channel
 * and accumulates the main conversation's completed assistant text; when the run flips
 * idle, the concatenated reply is sent to the last known chat (reply-to-message in group
 * chats, create-by-chat_id in p2p), chunked under Feishu's text-size limits. EVERY
 * completed task mirrors once a chat is known — web-initiated turns included; before the
 * first inbound message no chat is known and nothing is sent. Compaction output (the
 * summary the model streams between compaction events) is not a reply and is skipped, and
 * a connection joining mid-run skips that run's partial tail rather than mirroring half a
 * reply. An `approval_request` additionally sends a one-line notice that a tool call is
 * waiting in the web UI.
 *
 * The Lark SDK enters only through the injected `FeishuSdk` factory (see feishu-sdk.ts),
 * so unit tests substitute a fake and never open real network.
 */
import { buildFeishuMessage, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { FeishuRuntimeStatus } from "../api/types.js";
import type { FeishuBindingRow, FeishuBindingsRepo } from "../db/repos/feishu-bindings.js";
import type { ChannelEvent, ChannelHub } from "./channel.js";
import type { ErrorSink } from "./error-recorder.js";
import type {
  FeishuApiClient,
  FeishuCredentials,
  FeishuInboundEvent,
  FeishuSdk,
} from "./feishu-sdk.js";

/**
 * Max characters per outbound text message. Feishu caps a text message's `content` around
 * 150KB, but a chat bubble that long is unreadable anyway; 4000 chars stays far under the
 * cap in any UTF-8 width while keeping replies in a handful of bubbles.
 */
export const FEISHU_TEXT_CHUNK_CHARS = 4000;

// The three fixed outbound notices are user-facing Feishu chat content, deliberately
// bilingual like the rest of the product's user-facing copy (the server has no locale for
// a Feishu chat, so both languages ride each notice).
export const FEISHU_TEXT_ONLY_NOTICE =
  "Only text messages are supported for now. 目前仅支持文本消息。";
export const FEISHU_APPROVAL_NOTICE =
  "A tool call is waiting for your approval in the PenguinHarness web UI. 有工具调用正在等待你在网页端审批。";
export const FEISHU_TEST_MESSAGE =
  "PenguinHarness test message: this Session's Feishu binding works. 测试消息：该会话的飞书绑定工作正常。";

/**
 * Splits an outbound reply into Feishu-sized chunks, preferring newline boundaries so a
 * split lands between paragraphs rather than mid-sentence when it can.
 */
export function chunkFeishuText(text: string, max = FEISHU_TEXT_CHUNK_CHARS): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const nl = window.lastIndexOf("\n");
    // Only a newline in the window's back half is worth splitting at — an early one would
    // produce a tiny fragment and many more messages.
    const cut = nl > max / 2 ? nl : max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/** Minimal dependency on SessionManager (eases test doubles; mirrors ScheduleTaskRunner). */
export interface FeishuTaskRunner {
  statusOf(sessionId: string): string;
  startTask(
    sessionId: string,
    input: OmniMessage[],
    opts: { queueIfBusy: boolean },
  ): Promise<{ sessionId: string; queued: boolean }>;
}

/** Minimal dependency on the sessions index (existence checks for reconcile/cascade). */
export interface FeishuSessionIndex {
  findById(sessionId: string): object | null;
}

export interface FeishuBridgeDeps {
  repo: FeishuBindingsRepo;
  sessions: FeishuSessionIndex;
  channels: ChannelHub;
  runner: FeishuTaskRunner;
  sdk: FeishuSdk;
  errors: ErrorSink;
  log?: (line: string) => void;
  now?: () => number;
}

/** One connected (or connecting/errored) binding's in-memory state. */
interface BridgeEntry {
  sessionId: string;
  creds: FeishuCredentials;
  status: FeishuRuntimeStatus;
  connection: { close(): void } | null;
  unsubscribe: (() => void) | null;
  /** Cached OpenAPI client for outbound sends (created lazily from `creds`). */
  client: FeishuApiClient | null;
  /** Inbound group message to thread replies onto (memory only; p2p chats clear it). */
  lastInboundMessageId: string | null;
  /** Last observed run state on the Session channel. */
  active: string;
  /** False while joined mid-run: that run's partial tail must not mirror as half a reply. */
  armed: boolean;
  /** Between compaction_begin/_end: the streamed summary is not a reply. */
  inCompaction: boolean;
  /** Completed assistant text of the run in progress, flushed at the idle flip. */
  buffer: string[];
}

export class FeishuBridge {
  private readonly entries = new Map<string, BridgeEntry>();
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: FeishuBridgeDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => {});
  }

  /**
   * Server startup: connect every enabled binding. A binding whose Session no longer
   * exists (deleted while this server was down, or by a bulk Agent/Project delete that
   * bypassed the per-session cascade) is reconciled away instead of connected.
   */
  async start(): Promise<void> {
    for (const row of this.deps.repo.listAll()) {
      if (this.deps.sessions.findById(row.sessionId) === null) {
        this.deps.repo.delete(row.sessionId);
        continue;
      }
      if (row.enabled) await this.connect(row);
    }
  }

  /** App dispose: close every connection; bindings persist for the successor's start(). */
  stop(): void {
    for (const sessionId of [...this.entries.keys()]) this.disconnect(sessionId);
  }

  /** After a binding write: bring the connection in line with the stored row. */
  async sync(sessionId: string): Promise<void> {
    const row = this.deps.repo.find(sessionId);
    if (row === null || !row.enabled) {
      this.disconnect(sessionId);
      return;
    }
    // Always reconnect on save: the credentials or domain may have changed.
    await this.connect(row);
  }

  /** Unbind (route DELETE + session-delete cascade): disconnect and drop the row. No-op when unbound. */
  unbind(sessionId: string): void {
    this.disconnect(sessionId);
    this.deps.repo.delete(sessionId);
  }

  /** Runtime status for the API (a binding never connected reads as disconnected). */
  statusOf(sessionId: string): FeishuRuntimeStatus {
    return this.entries.get(sessionId)?.status ?? { state: "disconnected" };
  }

  /** Credential probe for POST …/feishu/test: ok/error with latency, never a throw. */
  async testCredentials(
    creds: FeishuCredentials,
  ): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
    const startedAt = this.now();
    try {
      const client = await this.deps.sdk.createClient(creds);
      await client.checkCredentials();
      return { ok: true, latencyMs: this.now() - startedAt };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * POST …/feishu/test-message: a short fixed text to the binding's last known chat.
   * The route has already established that the binding and its chat exist; a race that
   * removed either since surfaces as the send failing.
   */
  async sendTestMessage(row: FeishuBindingRow): Promise<void> {
    if (row.lastChatId === null) throw new Error("no Feishu chat is known yet");
    const client = await this.clientFor(row.sessionId, row);
    await client.sendText(row.lastChatId, FEISHU_TEST_MESSAGE);
  }

  // -------------------------------------------------------------------------

  private async connect(row: FeishuBindingRow): Promise<void> {
    this.disconnect(row.sessionId);
    const creds: FeishuCredentials = {
      appId: row.appId,
      appSecret: row.appSecret,
      baseDomain: row.baseDomain,
    };
    // Mirror arming: a connection made while the Session is mid-run must not mirror that
    // run's partial tail — it arms at the next idle flip instead.
    const runState = this.deps.runner.statusOf(row.sessionId);
    const entry: BridgeEntry = {
      sessionId: row.sessionId,
      creds,
      status: { state: "connecting", changedAt: new Date(this.now()).toISOString() },
      connection: null,
      unsubscribe: null,
      client: null,
      lastInboundMessageId: null,
      active: runState,
      armed: runState === "idle",
      inCompaction: false,
      buffer: [],
    };
    this.entries.set(row.sessionId, entry);
    entry.unsubscribe = this.deps.channels
      .get(row.sessionId)
      .subscribe((evt) => this.observe(entry, evt));
    try {
      const connection = await this.deps.sdk.connect(creds, {
        onMessage: (evt) => this.onInbound(entry, evt),
        onReady: () => this.setStatus(entry, { state: "connected" }),
        onError: (err) => {
          const detail = err instanceof Error ? err.message : String(err);
          this.setStatus(entry, { state: "error", lastError: detail });
          this.recordError(entry.sessionId, err, "feishu_connect_failed");
        },
      });
      if (this.entries.get(row.sessionId) !== entry) {
        // A concurrent sync/unbind replaced this attempt while the SDK was loading.
        connection.close();
        return;
      }
      entry.connection = connection;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.setStatus(entry, { state: "error", lastError: detail });
      this.recordError(row.sessionId, err, "feishu_connect_failed");
    }
  }

  private disconnect(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    entry.unsubscribe?.();
    try {
      entry.connection?.close();
    } catch (err) {
      this.log(`[feishu] close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Status write, guarded against a stale entry (replaced by a newer connect). */
  private setStatus(entry: BridgeEntry, patch: Omit<FeishuRuntimeStatus, "changedAt">): void {
    if (this.entries.get(entry.sessionId) !== entry) return;
    entry.status = { ...patch, changedAt: new Date(this.now()).toISOString() };
  }

  private recordError(sessionId: string, err: unknown, code: string): void {
    this.deps.errors.record({ source: "feishu", err, code, ctx: { sessionId } });
  }

  private async clientFor(sessionId: string, row: FeishuBindingRow): Promise<FeishuApiClient> {
    const entry = this.entries.get(sessionId);
    if (entry?.client) return entry.client;
    const client = await this.deps.sdk.createClient({
      appId: row.appId,
      appSecret: row.appSecret,
      baseDomain: row.baseDomain,
    });
    if (entry) entry.client = client;
    return client;
  }

  // —— Inbound ——————————————————————————————————————————————————————————————

  private async onInbound(entry: BridgeEntry, evt: FeishuInboundEvent): Promise<void> {
    if (this.entries.get(entry.sessionId) !== entry) return; // stale connection
    try {
      const isP2p = evt.chatType === "p2p";
      // The chat becomes the reply target BEFORE any processing: even a rejected message
      // type teaches the bridge where the user is.
      this.deps.repo.recordChat(entry.sessionId, evt.chatId, isP2p);
      entry.lastInboundMessageId = isP2p ? null : evt.messageId;
      const text = evt.messageType === "text" ? textOfContent(evt.content) : null;
      if (text === null || text.trim() === "") {
        await this.replyInbound(entry, evt, FEISHU_TEXT_ONLY_NOTICE);
        return;
      }
      const origin = {
        chatType: evt.chatType,
        ...(evt.senderName !== undefined ? { senderName: evt.senderName } : {}),
      };
      // sender "server": in the Trace this user turn was injected by the server's bridge,
      // not typed into the composer (the scheduler's convention).
      await this.deps.runner.startTask(
        entry.sessionId,
        [userText(buildFeishuMessage(origin, text), "server")],
        { queueIfBusy: true },
      );
    } catch (err) {
      this.recordError(entry.sessionId, err, "feishu_inbound_failed");
    }
  }

  /** Reply to the inbound message itself: threaded reply in groups, plain send in p2p. */
  private async replyInbound(
    entry: BridgeEntry,
    evt: FeishuInboundEvent,
    text: string,
  ): Promise<void> {
    const row = this.deps.repo.find(entry.sessionId);
    if (!row) return;
    const client = await this.clientFor(entry.sessionId, row);
    if (evt.chatType === "p2p") await client.sendText(evt.chatId, text);
    else await client.replyText(evt.messageId, text);
  }

  // —— Outbound ——————————————————————————————————————————————————————————————

  /** Channel tap: main-conversation completed assistant text + the run-state flips. */
  private observe(entry: BridgeEntry, evt: ChannelEvent): void {
    if (this.entries.get(entry.sessionId) !== entry) return;
    let data: unknown;
    try {
      data = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (evt.event === "server_event") {
      const event = data as { type?: string; state?: string };
      if (event.type === "task_state" && typeof event.state === "string") {
        this.onTaskState(entry, event.state);
      } else if (event.type === "approval_request") {
        void this.deliverNotice(entry, FEISHU_APPROVAL_NOTICE);
      }
      return;
    }
    const msg = data as OmniMessage;
    if (msg.origin !== undefined && msg.origin.length > 0) return; // subagent output is not the reply
    const payload = msg.payload as { type?: string; role?: string; text?: string };
    if (msg.type === "event_msg") {
      if (payload.type === "compaction_begin") entry.inCompaction = true;
      else if (payload.type === "compaction_end") entry.inCompaction = false;
      return;
    }
    if (msg.type !== "model_msg" || entry.inCompaction) return;
    // Completed assistant text only: partials, thinking and tool traffic never mirror.
    if (payload.type === "text" && payload.role === "assistant" && payload.text !== undefined) {
      entry.buffer.push(payload.text);
    }
  }

  private onTaskState(entry: BridgeEntry, state: string): void {
    if (state === "running") {
      // A fresh run observed from its start: reset the accumulator once (task_state is
      // re-published mid-run for queue/steering changes and must not clear it then).
      if (entry.armed && entry.active !== "running") entry.buffer = [];
    } else if (state === "idle") {
      const finishedRun = entry.armed && entry.active === "running";
      const text = entry.buffer.join("\n\n").trim();
      entry.buffer = [];
      // Joined mid-run: drop that run's partial tail and arm for the next one.
      entry.armed = true;
      if (finishedRun && text !== "") void this.flush(entry, text);
    }
    entry.active = state;
  }

  /** Sends one completed reply to the last known chat; a send failure is recorded, never thrown. */
  private async flush(entry: BridgeEntry, text: string): Promise<void> {
    try {
      const row = this.deps.repo.find(entry.sessionId);
      if (!row || row.lastChatId === null) return; // no chat known yet: nothing mirrors
      const client = await this.clientFor(entry.sessionId, row);
      for (const chunk of chunkFeishuText(text)) {
        if (!row.lastChatIsP2p && entry.lastInboundMessageId !== null) {
          await client.replyText(entry.lastInboundMessageId, chunk);
        } else {
          await client.sendText(row.lastChatId, chunk);
        }
      }
    } catch (err) {
      this.recordError(entry.sessionId, err, "feishu_send_failed");
    }
  }

  /** One-line notice (approval waiting) to the last known chat; silent before one exists. */
  private async deliverNotice(entry: BridgeEntry, text: string): Promise<void> {
    try {
      const row = this.deps.repo.find(entry.sessionId);
      if (!row || row.lastChatId === null) return;
      const client = await this.clientFor(entry.sessionId, row);
      await client.sendText(row.lastChatId, text);
    } catch (err) {
      this.recordError(entry.sessionId, err, "feishu_send_failed");
    }
  }
}

/** The `text` field of a Feishu text message's content JSON (null when unparseable). */
function textOfContent(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    return typeof parsed.text === "string" ? parsed.text : null;
  } catch {
    return null;
  }
}
