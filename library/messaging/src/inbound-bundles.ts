/**
 * Joins the events a platform splits ONE human message into, so the Session receives one input
 * the way the web composer would have sent it.
 *
 * Two kinds of split reach the bridge, and only two are joined:
 *
 * - A platform that says so. Telegram delivers an album as one update per item, every one of
 *   them carrying the same `media_group_id` (the seam's `groupId`): those are one message by the
 *   platform's own word, and they are collected until the chat has been quiet for a moment.
 * - An attachment sent on its own, followed AT ONCE by a text from the same person. Chat clients
 *   send a file or a forwarded picture with a "leave a message" note as two messages a moment
 *   apart, the attachment first, and nothing on the wire links them. The attachment waits for a
 *   short quiet period; a text arriving inside it rides the same input, and the wait ends there.
 *
 * Everything else goes through untouched and at once. A plain text is NEVER held: it either
 * completes the attachment waiting before it, or is processed the moment it arrives — a person
 * who types "status?" must not wait on a timer for an attachment that is not coming. So a text
 * sent BEFORE its picture still reaches the Agent as two inputs: joining that pair would mean
 * delaying every text. A message that is already whole (a captioned photo, a rich-text post)
 * starts its own input, and whatever was waiting before it goes first, so the order the person
 * sent things in is the order the Session receives them.
 *
 * The quiet period is short on purpose. It is what an attachment on its own waits before its
 * Task starts, and the client-side splits it exists for land within a second or so; a text the
 * person types after looking at the picture they just sent takes far longer and arrives as the
 * follow-up it always was.
 *
 * Memory only. What waits here has been accepted from the platform — its redelivery memory has
 * the ids — but not processed, so a process that ends inside the quiet period loses it unless
 * the platform replays it; the durable watermark is written only once an input is processed,
 * so a replay that does come runs normally.
 */
import type { MessagingInboundMessage } from "./connector.js";

/**
 * How long an attachment on its own waits for the rest of its message, measured from the last
 * part that arrived. Long enough for an album's updates and a client's attachment-then-note pair
 * to land — both are sent by the client in one go, not typed, yet an album's updates have been
 * seen a second apart — and short enough that a picture sent alone starts its Task with no
 * delay a person would notice next to the model's own.
 */
export const MESSAGING_INBOUND_QUIET_MS = 3_000;

/**
 * The longest one message may stay open however many parts keep arriving: a burst of pictures
 * sent one after another — a phone sends each as its own message once its upload completes —
 * must not hold the first of them indefinitely.
 */
export const MESSAGING_INBOUND_OPEN_MAX_MS = 15_000;

interface Pending {
  parts: MessagingInboundMessage[];
  /** The platform's grouping id when the message was opened by one (see MessagingInboundMessage.groupId). */
  groupId: string | undefined;
  /** One of the parts carries text: a text that follows starts its own input. */
  hasText: boolean;
  openedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

export interface InboundBundlesOptions {
  quietMs: number;
  openMaxMs: number;
  now: () => number;
  /** A message whose quiet period ended: its parts, in arrival order, as one input. */
  flush: (parts: MessagingInboundMessage[]) => void;
}

function hasTextOf(msg: MessagingInboundMessage): boolean {
  return msg.text !== null && msg.text.trim() !== "";
}

/**
 * Whether the event carries something that can reach the Agent. Media that cannot (a voice
 * recording on its own) does not wait for a text: joined to the note after it, it would stop
 * that note with it, since a message none of whose attachments arrives is not run on its words.
 */
function hasAttachmentsOf(msg: MessagingInboundMessage): boolean {
  return (msg.images?.length ?? 0) > 0 || (msg.files?.length ?? 0) > 0;
}

/**
 * Who a part belongs to, or null when the event cannot say. A direct chat is one person, so its
 * chat id is enough; in a group the sender has to be named, or two people's messages would be
 * joined into one.
 */
function personOf(msg: MessagingInboundMessage): string | null {
  if (msg.chatKind === "direct") return msg.chatId;
  return msg.senderId === undefined || msg.senderId === ""
    ? null
    : `${msg.chatId}\n${msg.senderId}`;
}

/** One binding's messages in waiting, keyed by the person they came from. */
export class InboundBundles {
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly opts: InboundBundlesOptions) {}

  /**
   * Takes one accepted event and answers what is ready to process NOW, in order — each entry
   * one input, as the parts it is made of. Empty when the event was kept to wait for the rest of
   * its message.
   */
  offer(msg: MessagingInboundMessage): MessagingInboundMessage[][] {
    const person = personOf(msg);
    const grouped = msg.groupId !== undefined && msg.groupId !== "";
    // A group event that names no sender can still be collected by its grouping id: the
    // platform has already said which events are one message.
    const key = person ?? (grouped ? `${msg.chatId}\n#${msg.groupId}` : null);
    if (key === null) return [[msg]];
    const waiting = this.pending.get(key);
    const text = hasTextOf(msg);
    const attachments = hasAttachmentsOf(msg);
    if (grouped) {
      if (waiting !== undefined && waiting.groupId === msg.groupId) {
        this.add(key, waiting, msg);
        return [];
      }
      const ready = this.takeIfAny(key);
      this.open(key, msg, msg.groupId);
      return ready;
    }
    if (attachments && !text) {
      if (waiting !== undefined && waiting.groupId === undefined && !waiting.hasText) {
        this.add(key, waiting, msg);
        return [];
      }
      const ready = this.takeIfAny(key);
      this.open(key, msg, undefined);
      return ready;
    }
    if (text && !attachments && waiting !== undefined && !waiting.hasText) {
      return [[...this.take(key), msg]];
    }
    // Whole already (text and attachments together), or nothing anyone can use: it is its own
    // input, after whatever was waiting.
    return [...this.takeIfAny(key), [msg]];
  }

  /** Drops everything waiting (the connection closed); answers how many parts were dropped. */
  close(): number {
    let dropped = 0;
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      dropped += waiting.parts.length;
    }
    this.pending.clear();
    return dropped;
  }

  private open(key: string, msg: MessagingInboundMessage, groupId: string | undefined): void {
    const now = this.opts.now();
    this.pending.set(key, {
      parts: [msg],
      groupId,
      hasText: hasTextOf(msg),
      openedAt: now,
      timer: this.arm(key, this.opts.quietMs),
    });
  }

  private add(key: string, waiting: Pending, msg: MessagingInboundMessage): void {
    waiting.parts.push(msg);
    if (hasTextOf(msg)) waiting.hasText = true;
    clearTimeout(waiting.timer);
    const left = waiting.openedAt + this.opts.openMaxMs - this.opts.now();
    waiting.timer = this.arm(key, Math.max(0, Math.min(this.opts.quietMs, left)));
  }

  private arm(key: string, ms: number): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      const parts = this.take(key);
      if (parts.length > 0) this.opts.flush(parts);
    }, ms);
  }

  private take(key: string): MessagingInboundMessage[] {
    const waiting = this.pending.get(key);
    if (waiting === undefined) return [];
    clearTimeout(waiting.timer);
    this.pending.delete(key);
    return waiting.parts;
  }

  private takeIfAny(key: string): MessagingInboundMessage[][] {
    const parts = this.take(key);
    return parts.length > 0 ? [parts] : [];
  }
}
