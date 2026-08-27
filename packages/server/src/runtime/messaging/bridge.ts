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
 * follow-up, never 409. A message carrying images becomes that same composer input with
 * the pictures attached: the caption's text (when there is one) plus one `image_url` part
 * per image, as a base64 `data:` URL, which is byte for byte the shape the web composer
 * submits. Anything else (sticker, voice, video, file) gets a polite bilingual "not
 * supported" reply. Only once that work is done is the binding row's watermark advanced,
 * so a process that dies mid-message has the channel replay it rather than find it already
 * marked.
 *
 * Outbound (Session → channel): the bridge subscribes to the Session's in-process channel
 * and relays the main conversation's completed assistant messages — by default each of them
 * on its own, the moment it completes: a run that writes working notes between tool calls
 * before its answer reaches the chat as that same sequence of messages, so the chat follows
 * the run as it happens. A binding with `finalReplyOnly` set holds them back instead and
 * delivers the run's LAST completed assistant text alone, at the run's end: the answer
 * without the working notes, at the cost of the chat hearing nothing while the run works.
 * Either way delivery is the same path — sent to the last known chat (a held reply to the chat
 * its run was ASKED in, captured at the run's start: it leaves late enough for another message
 * to have moved the conversation elsewhere), chunked under the channel's text-size limits, or,
 * when the binding's `linePerMessage` is set, split into one message per non-blank line first,
 * each of those chunked and the resulting burst paced (the two options compose: a binding with
 * both sends that final reply one message per line) — and the outbound traffic of one entry is
 * serialised through a promise chain:
 * several messages completing in quick succession must reach the chat in the order they
 * completed. In a group chat the run's FIRST outbound message threads onto the inbound
 * one and everything after it is a plain send — one reply-to anchors the exchange, where
 * repeating it per message would stack a quote header over each of them; a direct chat is
 * plain sends throughout. Mirroring needs a known chat — web-initiated turns included;
 * before the first inbound message no chat is known and nothing is sent. Compaction output
 * (the summary the model streams between compaction events) is not a reply and is skipped,
 * and a connection joining mid-run relays nothing from that run rather than mirroring half a
 * reply. An `approval_request` additionally sends a one-line notice that a tool call is
 * waiting in the web UI — on the same chain, so it lands between replies instead of inside
 * one. That notice is not an assistant message, so `finalReplyOnly` never holds it: a run
 * blocked on approval is exactly when the chat must hear something.
 *
 * When the run ends, the files ITS DELIVERED TEXT mentioned follow it into the chat (see
 * reply-files.ts): path-like tokens that resolve inside the Workspace and actually exist,
 * pictures sent as pictures and everything else as attachments. Not "every file the run
 * wrote": the Agent's own words are what say which output was the point, and a chat window
 * is a bad place to receive a directory. What the caps drop is named in the chat rather
 * than dropped quietly.
 */
import { imageUrlMessage, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagingDeliveryError, MessagingRuntimeStatus } from "../../api/types.js";
import type {
  MessagingBindingRow,
  MessagingBindingsRepo,
} from "../../db/repos/messaging-bindings.js";
import { INLINE_IMAGE_MAX_BYTES } from "../../services/attachment-limits.js";
import type { ChannelEvent, ChannelHub } from "../channel.js";
import type { ErrorSink } from "../error-recorder.js";
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingInboundImage,
  MessagingInboundMessage,
  MessagingSendNote,
} from "./connector.js";
import { messagingErrorKind } from "./error-kind.js";
import { MessagingMediaTooLargeError, MessagingPermissionError, isImageFileName } from "./media.js";
import { replyFileMentions } from "./reply-files.js";

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

// The fixed outbound notices are user-facing chat content, deliberately bilingual
// like the rest of the product's user-facing copy (the server has no locale for an
// external chat, so both languages ride each notice).
export const MESSAGING_TEXT_ONLY_NOTICE =
  "Only text and image messages are supported for now. 目前仅支持文本和图片消息。";
/**
 * The two ways an inbound image does not arrive, deliberately worded as two notices.
 *
 * One notice covering both ("too large, or the download failed") was the first version, and
 * it cost us: a Feishu app that had never been granted the resource-read scope refused
 * every image, and the report that came back was indistinguishable from a size complaint.
 * A message that names two causes names neither.
 */
export function messagingImageTooLargeNotice(): string {
  const mb = Math.floor(INLINE_IMAGE_MAX_BYTES / (1024 * 1024));
  return `That image is larger than the ${mb}MB limit, so it was not sent to the Agent. Try a smaller one. 该图片超过 ${mb}MB 上限，未发送给智能体，请改用更小的图片。`;
}

/** How much of a channel's own failure reason rides into the chat before it is cut. */
const MESSAGING_NOTICE_REASON_MAX = 200;

/** A channel's own reason, bounded — a chat bubble is not a log line. */
function noticeReason(reason: string): string {
  return reason.length > MESSAGING_NOTICE_REASON_MAX
    ? `${reason.slice(0, MESSAGING_NOTICE_REASON_MAX)}…`
    : reason;
}

/**
 * The actionable half of a permission refusal: the scopes that would satisfy the call, and
 * the channel's own console link to grant them. The link goes on its own line so both
 * clients keep it clickable, and NOTHING else off the channel's error travels with it —
 * the raw SDK error carries the request config, which is where credentials live.
 */
function permissionDetail(scopes: readonly string[], grantUrl: string | null): string {
  const list = scopes.join(", ");
  return grantUrl === null ? list : `${list}\n${grantUrl}`;
}

/**
 * An inbound image this bot's app is not permitted to download.
 *
 * Its own notice rather than a generic failure because it is the one transfer failure the
 * person in the chat can fix, in about ten seconds, provided they are told which permission
 * to grant and where — which the channel says in its refusal (see feishu-sdk's
 * scopeDenialDetail).
 */
export function messagingImagePermissionNotice(
  scopes: readonly string[],
  grantUrl: string | null,
): string {
  return `That image could not be downloaded: this bot's app is missing a permission. Grant it, then send the picture again. 无法下载该图片：机器人应用缺少所需权限，开通后重新发送即可。\n${permissionDetail(scopes, grantUrl)}`;
}

/**
 * An image the channel would not hand over, carrying the channel's OWN reason — "app has no
 * permission to access resource" is a scope to go and grant, and it reads nothing like a
 * timeout. The reason is machine text in parentheses after the bilingual sentence, so the
 * sentence stays readable in both languages whatever the channel says.
 *
 * The reason is safe to show: both adapters guarantee their error text names no URL and no
 * credential (see telegram-api's fetchErrorText — its file endpoint embeds the bot token).
 */
export function messagingImageFailedNotice(reason: string): string {
  return `That image could not be downloaded from the chat, so nothing was sent to the Agent. 无法从会话中下载该图片，未发送给智能体。(${noticeReason(reason)})`;
}

/**
 * Inbound imagery this binding's rolling budget refused (see
 * MESSAGING_INBOUND_IMAGE_BUDGET_BYTES). Deliberately not the size notice: nothing about
 * this picture is wrong, there have just been too many of them, and the fix is to wait
 * rather than to send a smaller one.
 */
export function messagingImageBudgetNotice(): string {
  return "Too many images from this chat just now, so this one was not sent to the Agent. Try again in a few minutes. 该会话短时间内发来的图片过多，本张未发送给智能体，请过几分钟再试。";
}
export const MESSAGING_APPROVAL_NOTICE =
  "A tool call is waiting for your approval in the PenguinHarness web UI. 有工具调用正在等待你在网页端审批。";
export const MESSAGING_TEST_MESSAGE =
  "PenguinHarness test message: this Session's messaging binding works. 测试消息：该会话的消息绑定工作正常。";

/**
 * Per-file ceilings for a mirrored file, and how many of them one run may send.
 *
 * The byte numbers are the tighter of each channel's own limit, because the file is read
 * once for whichever channel this Session happens to be bound to: Feishu accepts an image
 * up to 10MB and a file up to 30MB, Telegram's `sendPhoto` stops at 10MB and its
 * `sendDocument` at 50MB. 10MB for a picture and 30MB for anything else therefore hold
 * everywhere — better than the same reply succeeding on one channel and failing on the
 * other.
 *
 * The count is not anyone's API limit but a judgement about the medium: a reply naming more
 * than a handful of files is reporting on work rather than delivering it, and a chat is the
 * wrong place to receive twenty attachments. The remainder is counted in a notice, never
 * silently dropped — the Web App still has all of them.
 */
export const MESSAGING_OUTBOUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const MESSAGING_OUTBOUND_FILE_MAX_BYTES = 30 * 1024 * 1024;
export const MESSAGING_OUTBOUND_FILE_MAX_COUNT = 5;

/**
 * How far before a run's start a file may have been written and still count as its output.
 *
 * Not slack in the rule but in the clock: mtime granularity is a filesystem property (one
 * second on HFS+, two on FAT), so a file the run wrote in its first moments can report a
 * timestamp a second or so behind the event that said the run had started. Small enough
 * that a file from an earlier turn never rides along.
 */
const MESSAGING_OUTBOUND_MTIME_GRACE_MS = 2_000;

/** One file a ceiling refused, named so the user knows which one to go and fetch. */
export function messagingFileTooLargeNotice(fileName: string, maxBytes: number): string {
  const mb = Math.floor(maxBytes / (1024 * 1024));
  return `"${fileName}" is over this channel's ${mb}MB limit and was not sent. 文件“${fileName}”超过该渠道 ${mb}MB 的上限，未发送。`;
}

/**
 * One file the channel would not take, with its own reason.
 *
 * Every other way a file does not arrive is named in the chat — over the byte cap, past the
 * count cap, an inbound refusal. A failed upload reached `error_records` and nothing else,
 * which the person in the chat cannot open, so the feature simply looked broken.
 */
export function messagingFileFailedNotice(fileName: string, reason: string): string {
  return `"${fileName}" could not be sent to the chat. 文件“${fileName}”未能发送到会话。(${noticeReason(reason)})`;
}

/** One file this bot's app is not permitted to upload — the fixable half of the above. */
export function messagingFilePermissionNotice(
  fileName: string,
  scopes: readonly string[],
  grantUrl: string | null,
): string {
  return `"${fileName}" could not be sent: this bot's app is missing a permission. 文件“${fileName}”未能发送：机器人应用缺少所需权限。\n${permissionDetail(scopes, grantUrl)}`;
}

/** How many names one drop notice lists before it stops: a signal, not an inventory. */
const MESSAGING_NOTICE_NAMES_MAX = 5;

/**
 * Files the reply named that the Workspace has nothing to send for — a path that resolves
 * outside it, a `~` path, or one that simply is not there.
 *
 * One notice for the batch, quoting the reply's own spelling. The two causes share a
 * sentence because they share the user's next move (look at the path) and share one true
 * statement: there is no such file in this Session's Workspace.
 */
export function messagingFilesMissingNotice(names: readonly string[]): string {
  const shown = names.slice(0, MESSAGING_NOTICE_NAMES_MAX);
  const list = shown.join(", ") + (names.length > shown.length ? ", …" : "");
  return `Named in the reply but not sent — no such file inside this Session's Workspace: ${list}. 回复中提及但未发送——该会话 Workspace 内没有这些文件：${list}。`;
}

/** The tail of a batch the count cap cut off. */
export function messagingFilesSkippedNotice(skipped: number): string {
  return `${skipped} more mentioned file(s) were not sent — at most ${MESSAGING_OUTBOUND_FILE_MAX_COUNT} ride along with one reply. 另有 ${skipped} 个提及的文件未发送——每条回复最多附带 ${MESSAGING_OUTBOUND_FILE_MAX_COUNT} 个。`;
}

/**
 * How many bytes of inbound imagery one binding may hand its Session inside a rolling
 * window, and how long that window is.
 *
 * Per image, the ceiling is the server's inline-image limit. In aggregate there was
 * nothing: every accepted image is written into the conversation as a base64 data URL, and
 * services/attachment-limits.ts says what that costs — the Trace JSONL is read back whole,
 * into a single JS string, on every history page and every Session resume, so a large
 * enough pile of inline images is not a slow Session but one that never recovers. The web
 * composer reaches the same ceiling only through an authenticated user; anyone who can DM
 * the bot reaches this one.
 *
 * A burst bound, not a lifetime one: two full-size images per ten minutes is far above any
 * real conversation (both channels re-encode a chat photo to a fraction of the ceiling) and
 * far below the pile that breaks a Session. Sustained abuse still costs the attacker time
 * they cannot compress.
 */
export const MESSAGING_INBOUND_IMAGE_BUDGET_BYTES = 2 * INLINE_IMAGE_MAX_BYTES;
const MESSAGING_INBOUND_IMAGE_WINDOW_MS = 10 * 60_000;

/**
 * One binding's rolling image budget. A fixed window rather than a sliding one, and a
 * counter rather than a list of transfers: a sliding window has to remember every accepted
 * image, which a thousand one-byte images turn into a thousand entries. The point is a
 * bound; a window that resets on its own is bounded in both bytes and memory.
 */
class InboundImageBudget {
  private windowStart = 0;
  private spent = 0;

  /** Bytes still allowed right now (a window older than the span has already lapsed). */
  remaining(now: number, budget: number): number {
    if (now - this.windowStart > MESSAGING_INBOUND_IMAGE_WINDOW_MS) return budget;
    return Math.max(0, budget - this.spent);
  }

  /** Records bytes actually accepted, opening a new window when the last one has lapsed. */
  spend(now: number, bytes: number): void {
    if (now - this.windowStart > MESSAGING_INBOUND_IMAGE_WINDOW_MS) {
      this.windowStart = now;
      this.spent = 0;
    }
    this.spent += bytes;
  }
}

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
 * Minimal dependency on the sessions index: existence checks for reconcile/cascade, the
 * Session's Project/Agent so a messaging failure can be filed under them (see recordError),
 * and the one field an outbound file needs — the Workspace a mentioned path resolves against.
 */
export interface MessagingSessionIndex {
  findById(sessionId: string): { projectId: string; agentId: string; workspace: string } | null;
}

/**
 * Minimal dependency on the Workspace file service. Narrow, but deliberately NOT a
 * reimplementation: both methods carry that service's containment rules (a path that leaves
 * the Workspace — by `..`, by an absolute path, or through a symlink — is refused there,
 * and reads happen on the canonical path). A second resolver living in the bridge is
 * exactly the kind of thing that ends up one security fix behind.
 */
export interface MessagingWorkspaceFiles {
  /**
   * The subset of `rels` that exist as regular files inside the Workspace, each with the
   * time it was last written — which is what separates a file this run produced from one
   * the reply merely named (see deliverFiles).
   */
  statExistingWithMtime(
    workspace: string,
    rels: string[],
  ): Promise<{ rel: string; mtimeMs: number }[]>;
  /** Reads a file, at most `maxBytes` of it. */
  read(
    workspace: string,
    rel: string,
    options?: { maxBytes?: number },
  ): Promise<{ data: Buffer; fileName: string }>;
}

export interface MessagingBridgeDeps {
  repo: MessagingBindingsRepo;
  sessions: MessagingSessionIndex;
  files: MessagingWorkspaceFiles;
  channels: ChannelHub;
  runner: MessagingTaskRunner;
  /** One connector per channel; a stored binding whose channel has no connector is skipped with an error record. */
  connectors: readonly MessagingChannelConnector[];
  errors: ErrorSink;
  log?: (line: string) => void;
  now?: () => number;
  /** Test hook: the pace between a per-line reply's messages (default MESSAGING_LINE_DELAY_MS; tests collapse it to zero). */
  lineDelayMs?: number;
  /** Test hook: one binding's inbound image budget (default MESSAGING_INBOUND_IMAGE_BUDGET_BYTES). */
  inboundImageBudgetBytes?: number;
}

/**
 * Where one outbound reply is addressed: the chat ref, whether that chat is direct, and the
 * inbound message its first chunk quotes (null in a direct chat, where nothing is quoted).
 * All three move together when a user writes from somewhere new, which is why they travel
 * as one value rather than being read from two places at delivery time.
 */
interface ReplyTarget {
  chatId: string;
  isDirect: boolean;
  inboundMessageId: string | null;
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
   *
   * They live no longer than the entry, though, which is one CONNECTION and not one server
   * run: `connect` builds a fresh entry, and `sync` calls it on the state toggle and on a
   * credential save made while the binding is enabled. Everything reading them has to say
   * "since this connection opened" — an empty `lastInboundAt` is not evidence that nothing
   * ever arrived. `lastDeliveryError` is never cleared within an entry either: a failure
   * that comes and goes would otherwise be wiped by the next ordinary message, so `at` is
   * what tells the reader how stale it is.
   */
  lastInboundAt: string | null;
  lastDeliveryError: MessagingDeliveryError | null;
  /**
   * The degradation the last outbound send reported (see MessagingSendNote), so a standing
   * one is logged once per episode: a deleted forum topic degrades every chunk of every
   * message, and a line per send would bury the fact that it started. Cleared by the first
   * send that lands as addressed, so a later episode says so again.
   */
  lastSendNote: MessagingSendNote | null;
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
   * When the run in progress started, as the bridge saw it (0 before it has seen one). The
   * cut-off for "a file this run produced" — see deliverFiles.
   */
  runStartedAt: number;
  /**
   * Where the run in progress was asked, captured on the same edge as `runStartedAt` and null
   * while no chat is known. Only the run's END delivers anything through it: a message relayed
   * as it completes is addressed live, because the chat it goes to is where the conversation
   * currently is, whereas a held reply is the whole answer to a question asked before another
   * user could move the row's chat and this entry's reply anchor (see deliverReply).
   */
  runTarget: ReplyTarget | null;
  /**
   * What this run has relayed so far, joined at the run's end to find the files the reply
   * mentions. Only text that actually mirrored is collected: a connection joined mid-run
   * relays none of that run's messages and must not send its files either, and a message
   * `finalReplyOnly` held back never arrives here — the one held reply joins it at the run's
   * end, in the same step that delivers it.
   */
  replyText: string[];
  /**
   * The run's last completed assistant text, held instead of sent, for a binding with
   * `finalReplyOnly` set. Each later message overwrites it: only the last one is the answer,
   * and everything before it is the working note the option exists to suppress. Null when
   * nothing is held — the option is off, or the run has produced no assistant text yet — and
   * cleared at the run's end by the delivery it feeds.
   *
   * Memory only, and only as long as the entry: a run whose idle edge this connection never
   * sees (the process ends, or a state toggle / credential save mid-run rebuilds the entry)
   * delivers nothing of what it held. The same event costs the every-message path only the
   * remainder of that run, which is the price of holding the answer back.
   */
  heldReply: string | null;
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
  /** Inbound image budgets, keyed like recentInbound: per BINDING, surviving a reconnect. */
  private readonly imageBudgets = new Map<string, InboundImageBudget>();
  private readonly connectors: ReadonlyMap<string, MessagingChannelConnector>;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly lineDelayMs: number;
  private readonly inboundImageBudgetBytes: number;

  constructor(private readonly deps: MessagingBridgeDeps) {
    this.connectors = new Map(deps.connectors.map((c) => [c.channel, c]));
    this.now = deps.now ?? (() => Date.now());
    this.log = deps.log ?? (() => {});
    this.lineDelayMs = deps.lineDelayMs ?? MESSAGING_LINE_DELAY_MS;
    this.inboundImageBudgetBytes =
      deps.inboundImageBudgetBytes ?? MESSAGING_INBOUND_IMAGE_BUDGET_BYTES;
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
   * disconnected), plus what this connection has actually seen: when a message last arrived,
   * what last failed after one did, and the last connection failure even after it recovered.
   * A binding can be `connected` with nothing wrong and still never receive anything, and
   * that combination is invisible without them.
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
      status: { state: "connecting", changedAt: this.nowIso() },
      connection: null,
      unsubscribe: null,
      client: null,
      lastInboundMessageId: null,
      lastInboundAt: null,
      lastDeliveryError: null,
      lastSendNote: null,
      lastConnectionError: null,
      active: runState,
      armed: runState === "idle",
      inCompaction: false,
      threadedThisRun: false,
      runStartedAt: 0,
      runTarget: null,
      replyText: [],
      heldReply: null,
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
        onError: (err) => this.recordConnectionFailure(entry, err),
      });
      if (this.entries.get(row.sessionId) !== entry) {
        // A concurrent sync/unbind replaced this attempt while the channel was loading.
        connection.close();
        return;
      }
      entry.connection = connection;
    } catch (err) {
      this.recordConnectionFailure(entry, err);
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

  /** Every timestamp this bridge writes comes from the injected clock, never from `Date` directly. */
  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  /** Status write, guarded against a stale entry (replaced by a newer connect). */
  private setStatus(entry: BridgeEntry, patch: Omit<MessagingRuntimeStatus, "changedAt">): void {
    if (this.entries.get(entry.sessionId) !== entry) return;
    entry.status = { ...patch, changedAt: this.nowIso() };
  }

  /**
   * A connection failure, put in the three places one belongs: the live `error` state, the
   * copy kept across recovery, and the error table.
   *
   * Behind the same stale-entry guard `setStatus` uses, applied to all three — a connector
   * callback firing after a newer connect replaced this entry is reporting an attempt that was
   * already abandoned, and neither its status writes (which nothing reads) nor its record
   * (which would be filed against a binding since reconfigured) belong to the binding as it
   * now stands.
   */
  private recordConnectionFailure(entry: BridgeEntry, err: unknown): void {
    if (this.entries.get(entry.sessionId) !== entry) return;
    const detail = err instanceof Error ? err.message : String(err);
    this.setStatus(entry, { state: "error", lastError: detail });
    entry.lastConnectionError = { at: this.nowIso(), detail };
    this.recordError(entry.sessionId, err, "messaging_connect_failed");
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
      // Classified here rather than left to the recorder's default: its fallback for a
      // non-HTTP source is `unexpected`, which files a scope the app was never granted and a
      // file the platform cannot carry as defects (see error-kind.ts for the rule).
      kind: messagingErrorKind(err),
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
   *
   * A later success does not clear it. An intermittent failure — a group admin who revokes
   * send rights for a minute, a rate limit — would otherwise be erased by the next ordinary
   * message and never be seen at all, which is the same blind spot `lastConnectionError`
   * exists to close. The panel states `at` so a stale one reads as stale.
   */
  private recordDeliveryFailure(
    entry: BridgeEntry,
    err: unknown,
    stage: MessagingDeliveryError["stage"],
    code: string,
  ): void {
    entry.lastDeliveryError = {
      at: this.nowIso(),
      stage,
      detail: err instanceof Error ? err.message : String(err),
    };
    this.recordError(entry.sessionId, err, code);
  }

  /**
   * A send that landed somewhere less right than it was addressed to. Not a failure — the
   * message arrived — so it stays out of `lastDeliveryError` and off the panel, and goes to
   * the log, which is where "the replies moved to General a while ago" is answerable at all.
   */
  private noteSend(entry: BridgeEntry, note: MessagingSendNote | void): void {
    const seen = typeof note === "string" ? note : null;
    if (seen === entry.lastSendNote) return;
    entry.lastSendNote = seen;
    if (seen !== null) this.log(`[messaging] ${entry.channel} delivered degraded: ${seen}`);
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
    entry.lastInboundAt = this.nowIso();
    try {
      const isDirect = msg.chatKind === "direct";
      // The chat becomes the reply target BEFORE any processing: even a rejected message
      // type teaches the bridge where the user is, and the run started below can emit its
      // first assistant message before this returns — the outbound relay reads the chat
      // off the row.
      this.deps.repo.recordChat(entry.sessionId, entry.channel, msg.chatId, isDirect);
      entry.lastInboundMessageId = isDirect ? null : msg.messageId;
      // A caption is this message's text; an image with none carries no text at all.
      const text = msg.text !== null && msg.text.trim() !== "" ? msg.text : null;
      const images = msg.images ?? [];
      if (images.length === 0) {
        if (text === null) {
          await this.replyInbound(entry, msg, MESSAGING_TEXT_ONLY_NOTICE);
        } else {
          // An ordinary user input, exactly as if typed into the web composer: no marker
          // block, no special sender — the model deliberately does not learn the message
          // arrived through a messaging channel.
          await this.deps.runner.startTask(entry.sessionId, [userText(text)], {
            queueIfBusy: true,
          });
        }
      } else {
        const result = await this.inboundImageParts(entry, images);
        if ("notice" in result) {
          // The whole message stops here rather than running on the caption alone: a model
          // asked "what is wrong with this?" about a picture it never received answers
          // confidently about nothing, which is worse than a notice saying so.
          await this.replyInbound(entry, msg, result.notice);
        } else {
          // Text first, then the images — the same order and the same parts the web composer
          // submits, so a chat message with a picture is indistinguishable from a pasted one.
          await this.deps.runner.startTask(
            entry.sessionId,
            [...(text === null ? [] : [userText(text)]), ...result.parts],
            { queueIfBusy: true },
          );
        }
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

  /**
   * Downloads the message's images into `image_url` input parts, or the notice to answer
   * with when one of them could not be delivered.
   *
   * All-or-nothing on purpose: a message is one thing the user sent, and half of it
   * reaching the Agent is not a partial success but a misleading one. The cap is the
   * server's inline-image ceiling — the same number the web composer's uploads answer to,
   * because these images land in exactly the same place (the conversation, and from there
   * the Trace, which is read back whole on every resume). It happens to match Telegram's
   * own 20MB download ceiling for bots.
   *
   * A refusal for size is the user's to fix and is not an error record — they sent
   * something too big and the chat says so. A failure is somebody's fault (a scope the bot
   * was never granted, most likely) and lands in the error log with the channel's reason,
   * so it is diagnosable from the dashboard and not only from a chat bubble.
   */
  private async inboundImageParts(
    entry: BridgeEntry,
    images: readonly MessagingInboundImage[],
  ): Promise<{ parts: OmniMessage[] } | { notice: string }> {
    const budget = this.imageBudgetFor(entry);
    const parts: OmniMessage[] = [];
    for (const image of images) {
      const remaining = budget.remaining(this.now(), this.inboundImageBudgetBytes);
      if (remaining <= 0) return { notice: messagingImageBudgetNotice() };
      // The window's remainder rides into the fetch exactly as the ceiling does, so an
      // image that would overspend is refused at the byte that crosses rather than
      // buffered whole and measured afterwards.
      const cap = Math.min(INLINE_IMAGE_MAX_BYTES, remaining);
      try {
        const { data, mimeType } = await image.fetch(cap);
        budget.spend(this.now(), data.length);
        parts.push(imageUrlMessage(`data:${mimeType};base64,${data.toString("base64")}`));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        this.log(`[messaging] ${entry.channel} image fetch failed: ${reason}`);
        if (err instanceof MessagingMediaTooLargeError) {
          // Which ceiling stopped it decides what the chat is told: the server's limit is
          // fixed by sending a smaller picture, the window's budget only by waiting.
          return {
            notice:
              cap < INLINE_IMAGE_MAX_BYTES
                ? messagingImageBudgetNotice()
                : messagingImageTooLargeNotice(),
          };
        }
        this.recordError(entry.sessionId, err, "messaging_image_fetch_failed");
        return {
          notice:
            err instanceof MessagingPermissionError
              ? messagingImagePermissionNotice(err.scopes, err.grantUrl)
              : messagingImageFailedNotice(reason),
        };
      }
    }
    return { parts };
  }

  /** This binding's rolling image budget, created on first use (see InboundImageBudget). */
  private imageBudgetFor(entry: BridgeEntry): InboundImageBudget {
    const key = inboundKey(entry.sessionId, entry.channel);
    let budget = this.imageBudgets.get(key);
    if (budget === undefined) {
      budget = new InboundImageBudget();
      this.imageBudgets.set(key, budget);
    }
    return budget;
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
    this.noteSend(
      entry,
      msg.chatKind === "direct"
        ? await client.sendText(msg.chatId, text)
        : await client.replyText(msg.messageId, text),
    );
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
   * Queues one completed assistant message for the bound chat — or holds it back.
   *
   * Appended to the entry's send chain rather than started here: a run can complete several
   * messages within milliseconds, and two sends racing would reach the chat in the wrong
   * order. Returns immediately either way, so a slow channel never blocks the Session's
   * stream handling.
   *
   * A binding with `finalReplyOnly` set sends nothing from here: the message replaces
   * whatever this run was already holding, and the last one standing is delivered at the
   * run's idle edge (see onTaskState). The preference is read per message off the stored row,
   * as every delivery preference is, and no run ever sees it change: each of the three PUT
   * handlers calls `sync` on an enabled binding, `sync` reconnects, and `connect` opens with a
   * disconnect and a fresh entry — so a save made mid-run discards whatever was held at that
   * moment along with the rest of this entry's memory (see heldReply).
   */
  private relay(entry: BridgeEntry, text: string): void {
    if (!entry.armed) return; // joined mid-run: this run's messages are not a reply
    const body = text.trim();
    if (body === "") return;
    if (this.finalReplyOnly(entry)) {
      entry.heldReply = body;
      return;
    }
    entry.replyText.push(body);
    entry.sendChain = entry.sendChain.then(() => this.deliverReply(entry, body));
  }

  /**
   * Whether this binding holds a run's intermediate messages back. A row that cannot be read
   * at all is deliberately not decided here: relaying is the default, and the same read
   * inside deliverReply then records the failure rather than letting it pass as a preference.
   */
  private finalReplyOnly(entry: BridgeEntry): boolean {
    try {
      return this.deps.repo.find(entry.sessionId, entry.channel)?.finalReplyOnly === true;
    } catch {
      return false;
    }
  }

  /**
   * Where this entry's traffic would go right now: null before any chat is known, and null
   * when the row cannot be read at all — a caller holding null falls back to reading it again
   * at delivery time, which is where a failure to read is recorded rather than swallowed.
   */
  private replyTargetOf(entry: BridgeEntry): ReplyTarget | null {
    try {
      const row = this.deps.repo.find(entry.sessionId, entry.channel);
      if (!row || row.lastChatId === null) return null;
      return {
        chatId: row.lastChatId,
        isDirect: row.lastChatIsDirect,
        inboundMessageId: entry.lastInboundMessageId,
      };
    } catch {
      return null;
    }
  }

  private onTaskState(entry: BridgeEntry, state: string): void {
    if (state === "running") {
      // A fresh run observed from its start gets one thread reply again. Only a real
      // idle -> running edge counts: task_state is re-published mid-run for queue and
      // steering changes, and re-arming there would thread every message of the run.
      if (entry.active !== "running") {
        entry.threadedThisRun = false;
        // The cut-off the run's own output is judged against. Taken on the same edge, so a
        // task_state republished mid-run cannot move it forward past files already written.
        entry.runStartedAt = this.now();
        // Where this run was asked, for what it delivers at its END. Taken here for the same
        // reason: a task_state republished mid-run must not move it either.
        entry.runTarget = this.replyTargetOf(entry);
      }
    } else if (state === "idle") {
      // A run joined midway ends here; from the next one on its messages mirror.
      entry.armed = true;
      // The run's text and then its files ride the same chain, in that order. Both sources
      // are taken and cleared here, so a task_state republished at idle cannot send either
      // twice and the next run starts from nothing.
      const relayed = entry.replyText;
      const held = entry.heldReply;
      const since = entry.runStartedAt;
      // Read on this edge with the rest, before the next run's `running` edge can replace it.
      const askedAt = entry.runTarget;
      entry.replyText = [];
      entry.heldReply = null;
      if (held !== null) {
        // All of `finalReplyOnly`, in one place: the run's last completed assistant text, and
        // only it, goes out at the end — through the same deliverReply as any relayed
        // message, so chunking, the per-line split, pacing, group threading and the chain's
        // ordering are the ones the other path already has. Addressed where the run was
        // ASKED: this is the one delivery whose whole text was written before an inbound
        // message from someone else could move the chat out from under it.
        relayed.push(held);
        entry.sendChain = entry.sendChain.then(() => this.deliverReply(entry, held, askedAt));
      }
      // The files follow the words that actually REACHED THE CHAT, not everything the run
      // said. With `finalReplyOnly` on, the messages this run held back were never delivered,
      // and a file named only in one of them would land in a chat with nothing there naming
      // it — so `relayed` carries exactly the texts deliverReply was handed, the held one
      // included, and never the ones that were dropped.
      const replyText = relayed.join("\n\n");
      if (replyText !== "") {
        // ...and the files go wherever those words went, which is the held reply's chat when
        // there was one and the live chat otherwise — the every-message path's texts left as
        // they completed, so the live chat is the only answer that fits all of them.
        entry.sendChain = entry.sendChain.then(() =>
          this.deliverFiles(entry, replyText, since, held !== null ? askedAt : null),
        );
      }
    }
    entry.active = state;
  }

  /**
   * Sends one relayed assistant message to the bound chat, in chunks under the channel's cap.
   * Which messages arrive here is the caller's business — every completed message of the run,
   * or its last one alone when the binding holds the rest (`finalReplyOnly`) — and nothing
   * below is affected by the difference.
   *
   * `at` is where to put it. A message relayed as it completes passes none and goes to the
   * chat the row names now, which is where the conversation is. A held reply passes the target
   * captured when its run started (see onTaskState), because it leaves at the run's END: a
   * second user writing in another forum topic meanwhile would otherwise take delivery of a
   * whole answer to a question they never asked, quoted onto their own message.
   *
   * A send failure is recorded, never thrown, so the chain behind it keeps
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
  private async deliverReply(
    entry: BridgeEntry,
    text: string,
    at: ReplyTarget | null = null,
  ): Promise<void> {
    // Both halves of the LIVE target are snapshotted together, ahead of every await: this line
    // runs before sendTarget, which reads the chat ref off the row synchronously before its
    // own. An inbound message arriving mid-delivery moves them independently, and a reply whose
    // first chunk threaded onto the new message while the rest went to the chat the row
    // still named would be split across two places — two forum topics, on a channel that
    // packs one into the chat ref.
    const liveInboundMessageId = entry.lastInboundMessageId;
    const target = await this.sendTarget(entry);
    if (target === null) return;
    const { row, client } = target;
    // The caller's target when it named one, the live one otherwise. The ROW is read fresh
    // either way: WHERE a reply goes belongs to the run, HOW it is split to the binding.
    const to: ReplyTarget = at ?? {
      chatId: target.chatId,
      isDirect: row.lastChatIsDirect,
      inboundMessageId: liveInboundMessageId,
    };
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
        !to.isDirect && to.inboundMessageId !== null && !entry.threadedThisRun
          ? to.inboundMessageId
          : null;
      try {
        if (threadOnto !== null) {
          entry.threadedThisRun = true;
          this.noteSend(entry, await client.replyText(threadOnto, chunk));
        } else {
          this.noteSend(entry, await client.sendText(to.chatId, chunk));
        }
      } catch (err) {
        this.recordDeliveryFailure(entry, err, "send", "messaging_send_failed");
      }
    }
  }

  /**
   * Sends the files THIS RUN produced and its reply mentioned, after its text.
   *
   * `replyText` is what the run actually SENT, not everything it said: a binding with
   * `finalReplyOnly` set delivered one message, so that message is the whole of what this
   * scans (see onTaskState). A file named only in a held-back working note has nothing in
   * the chat to explain its arrival.
   *
   * `at` is where those words went, for the one caller whose text is not addressed to the live
   * chat (again the held reply). Files follow their words: a picture landing in a forum topic
   * where nothing named it is the same defect as one arriving unmentioned.
   *
   * Two filters, and both are load-bearing. The reply having said the name is what picks
   * the one output that was the point out of the dozen a run writes. The file being newer
   * than the run's start is what keeps that from becoming an exfiltration primitive: the
   * reply is steerable by whoever is in the chat, and on a mention-only rule a group member
   * who asks "what is in secrets.json?" gets the file uploaded by the very refusal that
   * declined to paste it. Containment (the Workspace and nothing narrower) lives in the
   * file service either way — see MessagingWorkspaceFiles.
   *
   * A file the run did not write is dropped SILENTLY: a reply that mentions the config it
   * read is the ordinary case, and announcing every one of those would bury the notices
   * that matter. A file that could not be delivered at all is named, because a mention the
   * chat never receives with nothing to say why is how this feature reads as broken.
   *
   * Always plain sends, never a threaded reply: a run that mentions a file has by
   * definition already sent the text that mentions it, and that message took the group's
   * one reply-to. Nothing here throws — a batch that fails is recorded, and a single file
   * that fails does not stop the ones behind it.
   */
  private async deliverFiles(
    entry: BridgeEntry,
    replyText: string,
    since: number,
    at: ReplyTarget | null = null,
  ): Promise<void> {
    try {
      const row = this.deps.repo.find(entry.sessionId, entry.channel);
      if (!row || row.lastChatId === null) return; // no chat known yet: nothing mirrors
      const chatId = at?.chatId ?? row.lastChatId;
      const session = this.deps.sessions.findById(entry.sessionId);
      if (session === null) return; // deleted mid-run
      const mentions = replyFileMentions(replyText, session.workspace);
      if (mentions.length === 0) return; // the reply named no file at all: nothing to say
      const stats = await this.deps.files.statExistingWithMtime(
        session.workspace,
        mentions.flatMap((m) => (m.rel === null ? [] : [m.rel])),
      );
      const mtimeByRel = new Map(stats.map((f) => [f.rel, f.mtimeMs]));
      const produced: string[] = [];
      const missing: string[] = [];
      for (const mention of mentions) {
        const mtime = mention.rel === null ? undefined : mtimeByRel.get(mention.rel);
        if (mtime === undefined) missing.push(mention.mentioned);
        else if (mtime >= since - MESSAGING_OUTBOUND_MTIME_GRACE_MS) produced.push(mention.rel!);
      }
      if (produced.length === 0 && missing.length === 0) return;
      const client = await this.clientFor(entry.sessionId, row);
      for (const rel of produced.slice(0, MESSAGING_OUTBOUND_FILE_MAX_COUNT)) {
        try {
          await this.deliverOneFile(client, chatId, session.workspace, rel);
        } catch (err) {
          this.recordError(entry.sessionId, err, "messaging_file_send_failed");
          await this.noteFileFailure(client, chatId, rel, err);
        }
      }
      const skipped = produced.length - MESSAGING_OUTBOUND_FILE_MAX_COUNT;
      if (skipped > 0) {
        await client.sendText(chatId, messagingFilesSkippedNotice(skipped));
      }
      if (missing.length > 0) {
        await client.sendText(chatId, messagingFilesMissingNotice(missing));
      }
    } catch (err) {
      this.recordError(entry.sessionId, err, "messaging_send_failed");
    }
  }

  /**
   * Names one file that did not make it, in the chat.
   *
   * Every other way a file does not arrive is already visible there — over the byte cap,
   * past the count cap, an inbound refusal. A failed upload reached `error_records` alone,
   * which the person in the chat cannot open, so the feature just looked broken. A missing
   * permission gets its own wording: it is the one failure they can fix themselves, in
   * about ten seconds, given the scope name and the console link.
   *
   * Its own try/catch: a chat that will not take the notice must not take the rest of the
   * batch down with it, and the upload failure behind it is already recorded.
   */
  private async noteFileFailure(
    client: MessagingClient,
    chatId: string,
    rel: string,
    err: unknown,
  ): Promise<void> {
    // `rel` is always "/"-joined (see toWorkspaceRelative), so its base name is its tail.
    const fileName = rel.slice(rel.lastIndexOf("/") + 1);
    const text =
      err instanceof MessagingPermissionError
        ? messagingFilePermissionNotice(fileName, err.scopes, err.grantUrl)
        : messagingFileFailedNotice(fileName, err instanceof Error ? err.message : String(err));
    try {
      await client.sendText(chatId, text);
    } catch {
      // A channel that will not take the notice either is one problem, not two.
    }
  }

  /** One mirrored file: read under the outer ceiling, then sent as a picture or an attachment. */
  private async deliverOneFile(
    client: MessagingClient,
    chatId: string,
    workspace: string,
    rel: string,
  ): Promise<void> {
    // Read first, classify second. `rel` is the path the REPLY spelled, and the canonical
    // file behind it may not share its extension: an in-Workspace `report.png -> report.pdf`
    // (the everyday "latest" symlink) classified by the mention would go to the image
    // endpoint under the image ceiling and arrive named report.pdf, which Telegram refuses.
    // The read is bounded by the larger of the two ceilings either way.
    const file = await this.deps.files.read(workspace, rel, {
      // One byte past the ceiling is enough to know the file is over it — reading the whole
      // of a 2GB log to measure it would be the same mistake in the other direction.
      maxBytes: MESSAGING_OUTBOUND_FILE_MAX_BYTES + 1,
    });
    const asImage = isImageFileName(file.fileName);
    const maxBytes = asImage
      ? MESSAGING_OUTBOUND_IMAGE_MAX_BYTES
      : MESSAGING_OUTBOUND_FILE_MAX_BYTES;
    if (file.data.length > maxBytes) {
      await client.sendText(chatId, messagingFileTooLargeNotice(file.fileName, maxBytes));
      return;
    }
    const outbound = { fileName: file.fileName, data: file.data };
    if (asImage) await client.sendImage(chatId, outbound);
    else await client.sendFile(chatId, outbound);
  }

  /** One-line notice (approval waiting) to the last known chat; silent before one exists. */
  private async deliverNotice(entry: BridgeEntry, text: string): Promise<void> {
    const target = await this.sendTarget(entry);
    if (target === null) return;
    try {
      this.noteSend(entry, await target.client.sendText(target.chatId, text));
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
      this.recordDeliveryFailure(entry, err, "send", "messaging_send_failed");
      return null;
    }
  }

  /** The pace between a per-line reply's messages; zero (tests) waits for nothing. */
  private pace(): Promise<void> {
    if (this.lineDelayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.lineDelayMs));
  }
}
