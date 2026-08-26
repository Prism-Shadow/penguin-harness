/**
 * Messaging bridge: a Web server runtime component connecting Sessions to external chat
 * platforms through channel connectors (Feishu and Telegram today — see
 * feishu-connector.ts / telegram-connector.ts). Started by the platform next to the
 * Scheduler, stopped when the
 * App is disposed — a hot swap hard-stops it like the scheduler. A Session may keep a
 * saved config per channel, but AT MOST ONE of them is enabled (the state route enforces
 * that), so the bridge holds at most one inbound event connection per Session — the
 * enabled binding's. `enabled` is stored intent the state toggle owns — saving
 * credentials never opens or closes a connection (with one deliberate exception:
 * re-saving an enabled binding restarts its connector with the new credentials, so the
 * stored config and the live connection never diverge).
 *
 * Inbound (channel → Session): every inbound message first records its chat as the
 * binding's reply target; a text message then starts a Task on the bound Session as an
 * ordinary user input — exactly as if typed into the web composer, no marker block and no
 * special sender (the model deliberately does not learn where the message came from) —
 * with `queueIfBusy`: a busy Session queues it as a follow-up, never 409. Any non-text
 * message gets a polite bilingual "text only" reply.
 *
 * Outbound (Session → channel): the bridge subscribes to the Session's in-process channel
 * and accumulates the main conversation's completed assistant text; when the run flips
 * idle, the concatenated reply is sent to the last known chat (reply-to-message in group
 * chats, plain send in direct chats), chunked under the channel's text-size limits. EVERY
 * completed task mirrors once a chat is known — web-initiated turns included; before the
 * first inbound message no chat is known and nothing is sent. Compaction output (the
 * summary the model streams between compaction events) is not a reply and is skipped, and
 * a connection joining mid-run skips that run's partial tail rather than mirroring half a
 * reply. An `approval_request` additionally sends a one-line notice that a tool call is
 * waiting in the web UI.
 */
import { userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagingRuntimeStatus } from "../../api/types.js";
import type {
  MessagingBindingRow,
  MessagingBindingsRepo,
} from "../../db/repos/messaging-bindings.js";
import type { ChannelEvent, ChannelHub } from "../channel.js";
import type { ErrorSink } from "../error-recorder.js";
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingInboundMessage,
} from "./connector.js";

/**
 * Max characters per outbound text message, shared by every channel: it must sit under
 * the tightest hard cap across them. Telegram rejects a `sendMessage` text over 4096
 * characters (counted as UTF-16 units, which is what a JS string length measures), and
 * Feishu caps a text message's `content` around 150KB — 4000 stays under both while
 * keeping replies in a handful of bubbles.
 */
export const MESSAGING_TEXT_CHUNK_CHARS = 4000;

// The three fixed outbound notices are user-facing chat content, deliberately bilingual
// like the rest of the product's user-facing copy (the server has no locale for an
// external chat, so both languages ride each notice).
export const MESSAGING_TEXT_ONLY_NOTICE =
  "Only text messages are supported for now. 目前仅支持文本消息。";
export const MESSAGING_APPROVAL_NOTICE =
  "A tool call is waiting for your approval in the PenguinHarness web UI. 有工具调用正在等待你在网页端审批。";
export const MESSAGING_TEST_MESSAGE =
  "PenguinHarness test message: this Session's messaging binding works. 测试消息：该会话的消息绑定工作正常。";

/**
 * Splits an outbound reply into channel-sized chunks, preferring newline boundaries so a
 * split lands between paragraphs rather than mid-sentence when it can.
 */
export function chunkMessagingText(text: string, max = MESSAGING_TEXT_CHUNK_CHARS): string[] {
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
export interface MessagingTaskRunner {
  statusOf(sessionId: string): string;
  startTask(
    sessionId: string,
    input: OmniMessage[],
    opts: { queueIfBusy: boolean },
  ): Promise<{ sessionId: string; queued: boolean }>;
}

/** Minimal dependency on the sessions index (existence checks for reconcile/cascade). */
export interface MessagingSessionIndex {
  findById(sessionId: string): object | null;
}

export interface MessagingBridgeDeps {
  repo: MessagingBindingsRepo;
  sessions: MessagingSessionIndex;
  channels: ChannelHub;
  runner: MessagingTaskRunner;
  /** One connector per channel; a stored binding whose channel has no connector is skipped with an error record. */
  connectors: readonly MessagingChannelConnector[];
  errors: ErrorSink;
  log?: (line: string) => void;
  now?: () => number;
}

/** One connected (or connecting/errored) binding's in-memory state. */
interface BridgeEntry {
  sessionId: string;
  /** The connected binding's channel (a Session's OTHER saved channels read as disconnected). */
  channel: string;
  connector: MessagingChannelConnector;
  config: Record<string, unknown>;
  status: MessagingRuntimeStatus;
  connection: { close(): void } | null;
  unsubscribe: (() => void) | null;
  /** Cached outbound client (created lazily from `config`). */
  client: MessagingClient | null;
  /** Inbound group message to thread replies onto (memory only; direct chats clear it). */
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

export class MessagingBridge {
  private readonly entries = new Map<string, BridgeEntry>();
  private readonly connectors: ReadonlyMap<string, MessagingChannelConnector>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(private readonly deps: MessagingBridgeDeps) {
    this.connectors = new Map(deps.connectors.map((c) => [c.channel, c]));
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => {});
  }

  /**
   * Server startup: connect every ENABLED binding (disabled ones keep their credentials
   * and stay dark; at most one per Session is enabled). A binding whose Session no longer
   * exists (deleted while this server was down, or by a bulk Agent/Project delete that
   * bypassed the per-session cascade) is reconciled away instead of connected.
   */
  async start(): Promise<void> {
    for (const row of this.deps.repo.listAll()) {
      if (this.deps.sessions.findById(row.sessionId) === null) {
        this.deps.repo.delete(row.sessionId, row.channel);
        continue;
      }
      if (row.enabled) await this.connect(row);
    }
  }

  /** App dispose: close every connection; bindings persist for the successor's start(). */
  stop(): void {
    for (const sessionId of [...this.entries.keys()]) this.disconnect(sessionId);
  }

  /**
   * Align the live connection with the stored intent: an enabled binding exists →
   * (re)connect with its CURRENT config, none → disconnect. The state toggle calls this
   * after flipping intent, and a credential save calls it only while the saved binding is
   * enabled — the restart that keeps stored config and live connection from diverging.
   */
  async sync(sessionId: string): Promise<void> {
    const row = this.deps.repo.findEnabled(sessionId);
    if (row === null) {
      this.disconnect(sessionId);
      return;
    }
    await this.connect(row);
  }

  /** Route DELETE: disconnect (when this channel holds the connection) and drop the row. No-op when unbound. */
  unbind(sessionId: string, channel: string): void {
    if (this.entries.get(sessionId)?.channel === channel) this.disconnect(sessionId);
    this.deps.repo.delete(sessionId, channel);
  }

  /** Session-delete cascade: disconnect and drop every channel's config. */
  unbindSession(sessionId: string): void {
    this.disconnect(sessionId);
    this.deps.repo.deleteSession(sessionId);
  }

  /** One channel's runtime status (only the connected channel is ever anything but disconnected). */
  statusOf(sessionId: string, channel: string): MessagingRuntimeStatus {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.channel !== channel) return { state: "disconnected" };
    return entry.status;
  }

  /**
   * Credential probe for the test endpoints: ok/error with latency, never a throw. A
   * channel whose check identifies the account (Telegram: the bot's @username) passes
   * that label through for the route's success feedback.
   */
  async testCredentials(
    channel: string,
    config: Record<string, unknown>,
  ): Promise<{ ok: boolean; latencyMs?: number; accountLabel?: string; error?: string }> {
    const startedAt = this.now();
    try {
      const client = await this.connectorFor(channel).createClient(config);
      const info = await client.checkCredentials();
      return {
        ok: true,
        latencyMs: this.now() - startedAt,
        ...(info?.accountLabel !== undefined ? { accountLabel: info.accountLabel } : {}),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Test-message endpoints: a short fixed text to the binding's last known chat. The
   * route has already established that the binding and its chat exist; a race that
   * removed either since surfaces as the send failing.
   */
  async sendTestMessage(row: MessagingBindingRow): Promise<void> {
    if (row.lastChatId === null) throw new Error("no chat is known yet");
    const client = await this.clientFor(row.sessionId, row);
    await client.sendText(row.lastChatId, MESSAGING_TEST_MESSAGE);
  }

  // -------------------------------------------------------------------------

  private connectorFor(channel: string): MessagingChannelConnector {
    const connector = this.connectors.get(channel);
    if (!connector) throw new Error(`no messaging connector for channel "${channel}"`);
    return connector;
  }

  private async connect(row: MessagingBindingRow): Promise<void> {
    this.disconnect(row.sessionId);
    let connector: MessagingChannelConnector;
    try {
      connector = this.connectorFor(row.channel);
    } catch (err) {
      this.recordError(row.sessionId, err, "messaging_channel_unknown");
      return;
    }
    // Mirror arming: a connection made while the Session is mid-run must not mirror that
    // run's partial tail — it arms at the next idle flip instead.
    const runState = this.deps.runner.statusOf(row.sessionId);
    const entry: BridgeEntry = {
      sessionId: row.sessionId,
      channel: row.channel,
      connector,
      config: row.config,
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
      const connection = await connector.connect(row.config, {
        onMessage: (msg) => this.onInbound(entry, msg),
        onReady: () => this.setStatus(entry, { state: "connected" }),
        onError: (err) => {
          const detail = err instanceof Error ? err.message : String(err);
          this.setStatus(entry, { state: "error", lastError: detail });
          this.recordError(entry.sessionId, err, "messaging_connect_failed");
        },
      });
      if (this.entries.get(row.sessionId) !== entry) {
        // A concurrent sync/unbind replaced this attempt while the channel was loading.
        connection.close();
        return;
      }
      entry.connection = connection;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.setStatus(entry, { state: "error", lastError: detail });
      this.recordError(row.sessionId, err, "messaging_connect_failed");
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
      this.log(`[messaging] close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Status write, guarded against a stale entry (replaced by a newer connect). */
  private setStatus(entry: BridgeEntry, patch: Omit<MessagingRuntimeStatus, "changedAt">): void {
    if (this.entries.get(entry.sessionId) !== entry) return;
    entry.status = { ...patch, changedAt: new Date(this.now()).toISOString() };
  }

  private recordError(sessionId: string, err: unknown, code: string): void {
    this.deps.errors.record({ source: "messaging", err, code, ctx: { sessionId } });
  }

  private async clientFor(sessionId: string, row: MessagingBindingRow): Promise<MessagingClient> {
    // The cached client belongs to the CONNECTED channel; another channel's caller (a
    // test message on a saved-but-dark binding) gets a fresh client instead.
    const entry = this.entries.get(sessionId);
    const cacheable = entry !== undefined && entry.channel === row.channel;
    if (cacheable && entry.client) return entry.client;
    const client = await this.connectorFor(row.channel).createClient(row.config);
    if (cacheable) entry.client = client;
    return client;
  }

  // —— Inbound ——————————————————————————————————————————————————————————————

  private async onInbound(entry: BridgeEntry, msg: MessagingInboundMessage): Promise<void> {
    if (this.entries.get(entry.sessionId) !== entry) return; // stale connection
    try {
      const isDirect = msg.chatKind === "direct";
      // The chat becomes the reply target BEFORE any processing: even a rejected message
      // type teaches the bridge where the user is.
      this.deps.repo.recordChat(entry.sessionId, entry.channel, msg.chatId, isDirect);
      entry.lastInboundMessageId = isDirect ? null : msg.messageId;
      if (msg.text === null || msg.text.trim() === "") {
        await this.replyInbound(entry, msg, MESSAGING_TEXT_ONLY_NOTICE);
        return;
      }
      // An ordinary user input, exactly as if typed into the web composer: no marker
      // block, no special sender — the model deliberately does not learn the message
      // arrived through a messaging channel.
      await this.deps.runner.startTask(entry.sessionId, [userText(msg.text)], {
        queueIfBusy: true,
      });
    } catch (err) {
      this.recordError(entry.sessionId, err, "messaging_inbound_failed");
    }
  }

  /** Reply to the inbound message itself: threaded reply in groups, plain send in direct chats. */
  private async replyInbound(
    entry: BridgeEntry,
    msg: MessagingInboundMessage,
    text: string,
  ): Promise<void> {
    const row = this.deps.repo.find(entry.sessionId, entry.channel);
    if (!row) return;
    const client = await this.clientFor(entry.sessionId, row);
    if (msg.chatKind === "direct") await client.sendText(msg.chatId, text);
    else await client.replyText(msg.messageId, text);
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
        void this.deliverNotice(entry, MESSAGING_APPROVAL_NOTICE);
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
      const row = this.deps.repo.find(entry.sessionId, entry.channel);
      if (!row || row.lastChatId === null) return; // no chat known yet: nothing mirrors
      const client = await this.clientFor(entry.sessionId, row);
      for (const chunk of chunkMessagingText(text)) {
        if (!row.lastChatIsDirect && entry.lastInboundMessageId !== null) {
          await client.replyText(entry.lastInboundMessageId, chunk);
        } else {
          await client.sendText(row.lastChatId, chunk);
        }
      }
    } catch (err) {
      this.recordError(entry.sessionId, err, "messaging_send_failed");
    }
  }

  /** One-line notice (approval waiting) to the last known chat; silent before one exists. */
  private async deliverNotice(entry: BridgeEntry, text: string): Promise<void> {
    try {
      const row = this.deps.repo.find(entry.sessionId, entry.channel);
      if (!row || row.lastChatId === null) return;
      const client = await this.clientFor(entry.sessionId, row);
      await client.sendText(row.lastChatId, text);
    } catch (err) {
      this.recordError(entry.sessionId, err, "messaging_send_failed");
    }
  }
}
