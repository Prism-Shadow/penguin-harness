/**
 * Messaging bridge: a Web server runtime component connecting Sessions to external chat
 * platforms through channel connectors (Feishu, Telegram and QQ today — see
 * feishu-connector.ts / telegram-connector.ts / qq-connector.ts). Started by the platform next to the
 * Scheduler, stopped when the
 * App is disposed — a hot swap hard-stops it like the scheduler. A Session may keep a
 * saved config per channel, but AT MOST ONE of them is enabled (the state route enforces
 * that), so the bridge holds at most one inbound event connection per Session — the
 * enabled binding's. `enabled` is stored intent the state toggle owns — saving
 * credentials never opens or closes a connection (with one deliberate exception:
 * re-saving an enabled binding restarts its connector with the new credentials, so the
 * stored config and the live connection never diverge).
 *
 * Inbound (channel → Session): a message the binding has already processed is dropped
 * first (see RecentInboundIds, seeded from the binding row so a restart does not forget) —
 * channels redeliver, and nothing downstream of here is idempotent. Then every inbound
 * message records its chat as the binding's reply target; a text message then starts a
 * Task on the bound Session as an ordinary user input — exactly as if typed into the web
 * composer, no marker block and no special sender (the model deliberately does not learn
 * where the message came from) — with `queueIfBusy`: a busy Session queues it as a
 * follow-up, never 409. Any non-text message gets a polite bilingual "text only" reply.
 * Only once that work is done is the binding row's watermark advanced, so a process that
 * dies mid-message has the channel replay it rather than find it already marked.
 *
 * Outbound (Session → channel): the bridge subscribes to the Session's in-process channel
 * and relays each of the main conversation's completed assistant messages on its own, the
 * moment it completes — a run that writes working notes between tool calls before its
 * answer reaches the chat as that same sequence of messages, so the chat follows the run
 * as it happens. Each is sent to the last known chat, chunked under the channel's
 * text-size limits — or, when the binding's `linePerMessage` is set, split into one message
 * per non-blank line first, each of those chunked and the resulting burst paced — and the
 * outbound traffic of one entry is serialised through a promise chain:
 * several messages completing in quick succession must reach the chat in the order they
 * completed. In a group chat the run's FIRST outbound message threads onto the inbound
 * one and everything after it is a plain send — one reply-to anchors the exchange, where
 * repeating it per message would stack a quote header over each of them; a direct chat is
 * plain sends throughout. EVERY completed assistant message mirrors once a chat is known
 * — web-initiated turns included; before the first inbound message no chat is known and
 * nothing is sent. Compaction output (the summary the model streams between compaction
 * events) is not a reply and is skipped, and
 * a connection joining mid-run relays nothing from that run rather than mirroring half a
 * reply. An `approval_request` additionally sends a one-line notice that a tool call is
 * waiting in the web UI — on the same chain, so it lands between replies instead of inside
 * one.
 */
import { userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagingDeliveryError, MessagingRuntimeStatus } from "../../api/types.js";
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

/**
 * How many messages one reply may become under a binding's `linePerMessage`, and why this
 * particular number.
 *
 * The ceiling is a rate limit, not a size limit. Telegram's documented per-chat allowance is
 * about one message a second, with a burst to a single group tolerated up to roughly 20 a
 * minute before it starts answering 429; Feishu's IM send limit is counted per app and is far
 * looser, so Telegram sets the number. 20 spends the tightest channel's burst allowance for
 * one chat on a single reply — enough that an answer written as spoken lines arrives as spoken
 * lines, low enough that one long reply cannot spend several minutes of budget at once.
 *
 * It bounds OUTBOUND MESSAGES, not lines: the budget is spent in chunks, so a line over the
 * size cap costs as many messages as it chunks into (see splitReplyLines). Past it the
 * remaining lines are COMBINED into one final body rather than dropped: silently losing the
 * tail of a reply is the worst failure available here. The one reply that still exceeds the
 * ceiling is one long enough to need more messages than this unchunked — which it would have
 * needed with the option off too.
 *
 * A channel that declares its own `replyBudget` (QQ, whose platform accepts only a handful
 * of replies per inbound message) caps the split at that instead: 20 is sized for a channel
 * whose only limit is a rate, and asking a budgeted channel for more messages than it can
 * ever deliver would just move the combining downstream.
 */
export const MESSAGING_MAX_LINE_MESSAGES = 20;

/**
 * The wait between the messages of one per-line reply. The cap above bounds a single reply's
 * burst; this paces it, because the tightest channel's per-chat allowance is about one message
 * a second and 20 sends fired back to back is exactly the shape that draws a 429. Only a
 * per-line reply is paced: with the option off a reply is one message (or the handful its size
 * chunks into), which was never a burst.
 */
export const MESSAGING_LINE_DELAY_MS = 1000;

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
 * How many recently processed inbound message ids one binding remembers.
 *
 * Count is the only bound. An unbounded set on a server that runs for months is a leak,
 * so the ring has to end somewhere — but nothing expires by age, because neither channel
 * ever reuses a message id (Feishu's `om_*` are globally unique; Telegram's key is
 * `chatId:message_id`, and that counter only climbs). With no reuse to guard against, an
 * age bound could only forget a redelivery still owed to us, and a channel resuming a
 * stream after a long outage replays whatever it never saw acknowledged — which can
 * arrive a great deal later than the message it repeats.
 */
const MESSAGING_INBOUND_DEDUPE_SIZE = 64;

/**
 * The ids one binding has already processed, bounded by count.
 *
 * Identity is the channel's own message id (Feishu's `message_id`, Telegram's
 * `chatId:message_id`), never the text: a user genuinely does send "status?" twice, and
 * swallowing the second one is a worse failure than the duplicate it would prevent.
 *
 * A `Set` iterates in insertion order, which is the ring: the oldest id is the first one
 * `values()` yields, so eviction is a `delete` of that. Re-adding an id already present
 * leaves that order alone, which is what makes re-seeding on every reconnect free.
 */
class RecentInboundIds {
  private readonly seen = new Set<string>();

  /** True when this id was already processed; records it otherwise. */
  check(messageId: string): boolean {
    if (this.seen.has(messageId)) return true;
    this.remember(messageId);
    return false;
  }

  /**
   * Records an id as processed without asking about it: how the binding row's persisted
   * watermark re-enters this memory when a connection opens (see MessagingBridge.connect).
   */
  remember(messageId: string): void {
    this.seen.add(messageId);
    while (this.seen.size > MESSAGING_INBOUND_DEDUPE_SIZE) {
      const oldest = this.seen.values().next();
      if (oldest.done === true) break;
      this.seen.delete(oldest.value);
    }
  }
}

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

/**
 * Splits a relayed reply into one message per non-blank line, for a binding that asked for it.
 *
 * Deliberately literal: every non-blank line becomes its own message — inside a fenced code
 * block included — with blank lines dropped. The whole value of the option is that its
 * behaviour is predictable, which any "smart" grouping (holding a code fence together, merging
 * short lines) would trade away. Only trailing whitespace goes (a CR from a CRLF reply with
 * it); leading indentation is content, and a code block that arrives unindented does not run.
 *
 * `max` bounds the outbound MESSAGES, not the lines: each body returned still goes through
 * chunkMessagingText, so the budget is spent in chunks — a line over the channel's cap costs
 * as many messages as it chunks into. Splitting therefore stops while what is left still fits
 * in the remaining budget, and everything from there rides one combined body (chunked like any
 * other), so the reply reaches the chat entire either way.
 */
export function splitReplyLines(text: string, max = MESSAGING_MAX_LINE_MESSAGES): string[] {
  const lines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "");
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineCost = chunkMessagingText(line).length;
    const rest = lines.slice(i + 1);
    const restCost = rest.length === 0 ? 0 : chunkMessagingText(rest.join("\n")).length;
    if (used + lineCost + restCost > max) {
      // Splitting this line off would put the reply over the budget. The rest rides one
      // combined body instead, keeping its own line breaks so the message reads as the lines
      // it was made of. (The loop cannot run past `max` rounds: every emitted line spends at
      // least one message.)
      out.push(lines.slice(i).join("\n"));
      return out;
    }
    out.push(line);
    used += lineCost;
  }
  return out;
}

/** Dedupe scope: one binding, i.e. a Session's config for one channel. */
function inboundKey(sessionId: string, channel: string): string {
  return `${sessionId}:${channel}`;
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

/**
 * Minimal dependency on the sessions index: existence checks for reconcile/cascade, and the
 * Session's Project/Agent so a messaging failure can be filed under them (see recordError).
 */
export interface MessagingSessionIndex {
  findById(sessionId: string): { projectId: string; agentId: string } | null;
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
  /** Test hook: the pace between a per-line reply's messages (default MESSAGING_LINE_DELAY_MS; tests collapse it to zero). */
  lineDelayMs?: number;
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
  /**
   * When this entry last ACCEPTED an inbound message, and the last failure that happened
   * after one was accepted. Both are reported through statusOf rather than folded into
   * `status`, because `status` is rebuilt on every connection-state flip and these two
   * outlive it: they describe the traffic, not the socket.
   */
  lastInboundAt: string | null;
  lastDeliveryError: MessagingDeliveryError | null;
  /**
   * The last connection failure, kept across recovery. `status.lastError` is wiped by the
   * next successful connect, which is exactly the case worth reporting: a connector that
   * flaps — a second program taking turns with this one on the same bot token — reads as
   * healthy in every snapshot taken between its failures.
   */
  lastConnectionError: { at: string; detail: string } | null;
  /** Last observed run state on the Session channel. */
  active: string;
  /** False while joined mid-run: that run's partial tail must not mirror as half a reply. */
  armed: boolean;
  /** Between compaction_begin/_end: the streamed summary is not a reply. */
  inCompaction: boolean;
  /** The run in progress already threaded its first outbound message onto the inbound one. */
  threadedThisRun: boolean;
  /**
   * Tail of this entry's outbound sends. Every relayed message AND every notice is appended
   * rather than started on its own, so outbound traffic completing in quick succession cannot
   * race into the chat out of order — an approval notice must not land between the messages of
   * a reply. It never rejects — deliverReply and deliverNotice record their own failures — so
   * one slow or failing send delays this Session's later messages and nothing else.
   */
  sendChain: Promise<void>;
}

export class MessagingBridge {
  private readonly entries = new Map<string, BridgeEntry>();
  /**
   * Processed inbound ids per BINDING (`sessionId:channel`), deliberately not per
   * connection: re-saving an enabled binding restarts its connector, and a message
   * already turned into a Task must not run again because the connector is new.
   *
   * This map dies with the process; `messaging_bindings.last_inbound_message_id` is the
   * half that does not, and `connect` folds it back in here so the two are one memory
   * rather than two guards. The row holds ONE id — the last message the bridge finished
   * with — which is what Feishu's WebSocket resume needs and all it needs: that stream
   * replays events it never saw acknowledged, and the SDK acknowledges each one only
   * after our handler returns, so at most the one in flight when the process ended is
   * still owed. Telegram redelivers nothing across a restart — its poller advances
   * `offset` past an update before handing it over, and a fresh connection drains with
   * `getUpdates({offset: -1})`, discarding whatever was sent while nobody was connected —
   * so on that channel the row is still written and still seeded, and simply never has a
   * replay to catch.
   */
  private readonly recentInbound = new Map<string, RecentInboundIds>();
  private readonly connectors: ReadonlyMap<string, MessagingChannelConnector>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly lineDelayMs: number;

  constructor(private readonly deps: MessagingBridgeDeps) {
    this.connectors = new Map(deps.connectors.map((c) => [c.channel, c]));
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => {});
    this.lineDelayMs = deps.lineDelayMs ?? MESSAGING_LINE_DELAY_MS;
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
    this.recentInbound.delete(inboundKey(sessionId, channel));
    this.deps.repo.delete(sessionId, channel);
  }

  /** Session-delete cascade: disconnect and drop every channel's config. */
  unbindSession(sessionId: string): void {
    this.disconnect(sessionId);
    for (const key of [...this.recentInbound.keys()]) {
      if (key.startsWith(`${sessionId}:`)) this.recentInbound.delete(key);
    }
    this.deps.repo.deleteSession(sessionId);
  }

  /**
   * One channel's runtime status (only the connected channel is ever anything but
   * disconnected), plus what this connection has actually seen: when a message last arrived
   * and what last failed after one did. A binding can be `connected` with nothing wrong and
   * still never receive anything, and that combination is invisible without these two.
   */
  statusOf(sessionId: string, channel: string): MessagingRuntimeStatus {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.channel !== channel) return { state: "disconnected" };
    return {
      ...entry.status,
      ...(entry.lastInboundAt !== null ? { lastInboundAt: entry.lastInboundAt } : {}),
      ...(entry.lastDeliveryError !== null ? { lastDeliveryError: entry.lastDeliveryError } : {}),
      ...(entry.lastConnectionError !== null
        ? { lastConnectionError: entry.lastConnectionError }
        : {}),
    };
  }

  /**
   * Credential probe for the test endpoints: ok/error with latency, never a throw. A
   * channel whose check identifies the account (Telegram: the bot's @username) passes
   * that label through for the route's success feedback, along with anything else the
   * probe learned that the user should act on (see MessagingAccountInfo).
   */
  async testCredentials(
    channel: string,
    config: Record<string, unknown>,
  ): Promise<{
    ok: boolean;
    latencyMs?: number;
    accountLabel?: string;
    readsGroupMessages?: boolean;
    error?: string;
  }> {
    const startedAt = this.now();
    try {
      const client = await this.connectorFor(channel).createClient(config);
      const info = await client.checkCredentials();
      return {
        ok: true,
        latencyMs: this.now() - startedAt,
        ...(info?.accountLabel !== undefined ? { accountLabel: info.accountLabel } : {}),
        ...(info?.readsGroupMessages !== undefined
          ? { readsGroupMessages: info.readsGroupMessages }
          : {}),
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
      lastInboundAt: null,
      lastDeliveryError: null,
      lastConnectionError: null,
      active: runState,
      armed: runState === "idle",
      inCompaction: false,
      threadedThisRun: false,
      sendChain: Promise.resolve(),
    };
    this.entries.set(row.sessionId, entry);
    // Before the stream can hand over its first event: the binding row's watermark is the
    // only thing that outlived the previous process, and a channel opening a connection is
    // exactly when it replays what it never saw acknowledged. Without this, the first
    // message of a re-enabled binding can be one the last server already ran.
    if (row.lastInboundMessageId !== null) {
      this.inboundMemoryOf(row.sessionId, row.channel).remember(row.lastInboundMessageId);
    }
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
          entry.lastConnectionError = { at: new Date(this.now()).toISOString(), detail };
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
      entry.lastConnectionError = { at: new Date(this.now()).toISOString(), detail };
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

  /**
   * One error record for a messaging failure, filed under the Session's Project and Agent.
   *
   * The attribution is load-bearing, not decoration: `GET /api/projects/:id/usage/errors`
   * selects by project, and a record with none is "unattributed" — served only to admins
   * (`includeGlobalErrors`), so an ordinary member could never see a failure of their own
   * binding anywhere. The lookup uses the sessions index the bridge already holds; a row
   * deleted since leaves the record unattributed rather than dropping it.
   */
  private recordError(sessionId: string, err: unknown, code: string): void {
    const row = this.deps.sessions.findById(sessionId);
    this.deps.errors.record({
      source: "messaging",
      err,
      code,
      ctx: {
        sessionId,
        ...(row !== null ? { projectId: row.projectId, agentId: row.agentId } : {}),
      },
    });
  }

  /**
   * A failure AFTER an inbound message was accepted: recorded like any other, and also put
   * on the binding's runtime status so the panel can say it. The error table is a Project-wide
   * dashboard nobody visits to debug one bot; the binding's own panel is where the question
   * is asked.
   */
  private recordDeliveryFailure(
    entry: BridgeEntry,
    err: unknown,
    stage: MessagingDeliveryError["stage"],
    code: string,
  ): void {
    entry.lastDeliveryError = {
      at: new Date(this.now()).toISOString(),
      stage,
      detail: err instanceof Error ? err.message : String(err),
    };
    this.recordError(entry.sessionId, err, code);
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

  /**
   * Has this binding already processed this message? A duplicate is a complete no-op —
   * ahead of the chat record and the text-only reply, not just the Task start, because a
   * replayed sticker would otherwise answer with the notice twice.
   *
   * Nothing downstream is idempotent: `startTask` with `queueIfBusy` appends to the
   * follow-up queue unconditionally, and a queued input is published to the Session
   * channel, so one redelivery becomes two runs in the chat AND two messages in the Web
   * App. A connector that mints no id opts out rather than having every message after the
   * first read as a duplicate.
   */
  private isRedelivery(entry: BridgeEntry, msg: MessagingInboundMessage): boolean {
    if (msg.messageId === "") return false;
    if (!this.inboundMemoryOf(entry.sessionId, entry.channel).check(msg.messageId)) return false;
    this.log(`[messaging] ${entry.channel} redelivered message ${msg.messageId}, ignored`);
    return true;
  }

  /** Get-or-create one binding's processed-id memory (see recentInbound). */
  private inboundMemoryOf(sessionId: string, channel: string): RecentInboundIds {
    const key = inboundKey(sessionId, channel);
    let recent = this.recentInbound.get(key);
    if (recent === undefined) {
      recent = new RecentInboundIds();
      this.recentInbound.set(key, recent);
    }
    return recent;
  }

  private async onInbound(entry: BridgeEntry, msg: MessagingInboundMessage): Promise<void> {
    if (this.entries.get(entry.sessionId) !== entry) return; // stale connection
    if (this.isRedelivery(entry, msg)) return;
    // Stamped on acceptance, before anything can go wrong with it: the panel's question is
    // "did the channel deliver anything", which a later failure does not un-answer.
    entry.lastInboundAt = new Date(this.now()).toISOString();
    try {
      const isDirect = msg.chatKind === "direct";
      // The chat becomes the reply target BEFORE any processing: even a rejected message
      // type teaches the bridge where the user is, and the run started below can emit its
      // first assistant message before this returns — the outbound relay reads the chat
      // off the row.
      this.deps.repo.recordChat(entry.sessionId, entry.channel, msg.chatId, isDirect);
      entry.lastInboundMessageId = isDirect ? null : msg.messageId;
      if (msg.text === null || msg.text.trim() === "") {
        await this.replyInbound(entry, msg, MESSAGING_TEXT_ONLY_NOTICE);
      } else {
        // An ordinary user input, exactly as if typed into the web composer: no marker
        // block, no special sender — the model deliberately does not learn the message
        // arrived through a messaging channel.
        await this.deps.runner.startTask(entry.sessionId, [userText(msg.text)], {
          queueIfBusy: true,
        });
      }
      // The durable watermark goes LAST, and its own UPDATE is the price of that. What it
      // marks is a message this process finished with: the follow-up a busy Session queues
      // lives in memory only, so a watermark written first would — for a process that died
      // in between — outlive the work it claims, and `connect`'s seeding would then make
      // the channel's replay of that message a complete no-op. Written here, a throw above
      // skips it and the replay runs the message instead: at-least-once rather than a
      // silent swallow.
      this.deps.repo.recordInboundWatermark(
        entry.sessionId,
        entry.channel,
        msg.messageId === "" ? null : msg.messageId,
      );
    } catch (err) {
      // The chat hears nothing when this fires — a Session that cannot load, a Workspace that
      // is gone — so the status line is the only place the user can find out it happened.
      this.recordDeliveryFailure(entry, err, "inbound", "messaging_inbound_failed");
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

  /** Channel tap: each main-conversation completed assistant message + the run-state flips. */
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
        // Queued behind whatever is already going out, like a reply: a reply the binding
        // splits per line holds the client for many sequential sends, and a notice started
        // beside that chain would land between two of its lines. deliverNotice never
        // throws, so it cannot break the chain.
        entry.sendChain = entry.sendChain.then(() =>
          this.deliverNotice(entry, MESSAGING_APPROVAL_NOTICE),
        );
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
      this.relay(entry, payload.text);
    }
  }

  /**
   * Queues one completed assistant message for the bound chat. Appended to the entry's
   * send chain rather than started here: a run can complete several messages within
   * milliseconds, and two sends racing would reach the chat in the wrong order. Returns
   * immediately either way, so a slow channel never blocks the Session's stream handling.
   */
  private relay(entry: BridgeEntry, text: string): void {
    if (!entry.armed) return; // joined mid-run: this run's messages are not a reply
    const body = text.trim();
    if (body === "") return;
    entry.sendChain = entry.sendChain.then(() => this.deliverReply(entry, body));
  }

  private onTaskState(entry: BridgeEntry, state: string): void {
    if (state === "running") {
      // A fresh run observed from its start gets one thread reply again. Only a real
      // idle -> running edge counts: task_state is re-published mid-run for queue and
      // steering changes, and re-arming there would thread every message of the run.
      if (entry.active !== "running") entry.threadedThisRun = false;
    } else if (state === "idle") {
      // A run joined midway ends here; from the next one on its messages mirror.
      entry.armed = true;
    }
    entry.active = state;
  }

  /**
   * Sends one completed assistant message to the last known chat, in chunks under the
   * channel's cap; a send failure is recorded, never thrown, so the chain behind it keeps
   * moving — and so do the messages behind it in THIS reply: one refused message (a 429 on
   * the third line of twelve) must not abandon the rest, which would leave a reply stopping
   * mid-sentence with nothing in the chat to say why. A binding with `linePerMessage` set
   * sends one message per non-blank line instead of one per reply (see splitReplyLines,
   * capped at the channel's own `replyBudget` where it declares one), paced
   * MESSAGING_LINE_DELAY_MS apart so the burst stays inside the channel's per-chat
   * allowance — chunking, threading and ordering are identical either way, and with the flag
   * off the send sequence is unchanged. In a group the run's
   * first outbound chunk threads onto the inbound message and
   * everything after it is a plain send: the reply-to relation names which message is being
   * answered, and one of them says it — repeating it per message and per chunk stacks quote
   * headers over the whole conversation.
   */
  private async deliverReply(entry: BridgeEntry, text: string): Promise<void> {
    const target = await this.sendTarget(entry);
    if (target === null) return;
    const { row, chatId, client } = target;
    // One body per outbound message: the whole reply, or one per non-blank line when the
    // binding asked for that. Everything below is untouched by the choice.
    const bodies = row.linePerMessage
      ? splitReplyLines(text, entry.connector.replyBudget ?? MESSAGING_MAX_LINE_MESSAGES)
      : [text];
    const messages = bodies.flatMap((body) => chunkMessagingText(body));
    for (const [i, chunk] of messages.entries()) {
      // The messages of a per-line reply are a burst; the channel's per-chat allowance is
      // about one a second, so they go out at that pace rather than back to back.
      if (i > 0 && row.linePerMessage) await this.pace();
      const threadOnto =
        !row.lastChatIsDirect && entry.lastInboundMessageId !== null && !entry.threadedThisRun
          ? entry.lastInboundMessageId
          : null;
      try {
        if (threadOnto !== null) {
          entry.threadedThisRun = true;
          await client.replyText(threadOnto, chunk);
        } else {
          await client.sendText(chatId, chunk);
        }
      } catch (err) {
        this.recordDeliveryFailure(entry, err, "send", "messaging_send_failed");
      }
    }
  }

  /** One-line notice (approval waiting) to the last known chat; silent before one exists. */
  private async deliverNotice(entry: BridgeEntry, text: string): Promise<void> {
    const target = await this.sendTarget(entry);
    if (target === null) return;
    try {
      await target.client.sendText(target.chatId, text);
    } catch (err) {
      this.recordDeliveryFailure(entry, err, "send", "messaging_send_failed");
    }
  }

  /**
   * Where this entry's outbound traffic goes, with a client for it: null when no chat is
   * known yet (nothing mirrors before the first inbound message) and null when the binding
   * or its client could not be read at all, which is recorded like the send it stands in for.
   */
  private async sendTarget(
    entry: BridgeEntry,
  ): Promise<{ row: MessagingBindingRow; chatId: string; client: MessagingClient } | null> {
    try {
      const row = this.deps.repo.find(entry.sessionId, entry.channel);
      if (!row || row.lastChatId === null) return null;
      const client = await this.clientFor(entry.sessionId, row);
      return { row, chatId: row.lastChatId, client };
    } catch (err) {
      this.recordError(entry.sessionId, err, "messaging_send_failed");
      return null;
    }
  }

  /** The pace between a per-line reply's messages; zero (tests) waits for nothing. */
  private pace(): Promise<void> {
    if (this.lineDelayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.lineDelayMs));
  }
}
