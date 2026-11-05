/**
 * The suite's one Feishu SDK fake (the connector's FeishuSdk seam): every client call is
 * recorded, each opened connection is handed back so a test can push inbound events, and
 * each failure a test needs is a switch. Nothing here opens a network connection.
 */
import type { FeishuCard } from "../../src/runtime/messaging/feishu-card.js";
import { collectUnderCap } from "../../src/runtime/messaging/media.js";
import type {
  FeishuApiClient,
  FeishuCredentials,
  FeishuEventHandlers,
  FeishuImageData,
  FeishuInboundEvent,
  FeishuSdk,
} from "../../src/runtime/messaging/feishu-sdk.js";

export interface SentText {
  kind: "send" | "reply";
  target: string;
  text: string;
}

/**
 * One picture or attachment that reached the channel. Byte count rather than the bytes:
 * what the assertions care about is which file went where, in what order, and that the
 * caps let it through.
 */
export interface SentMedia {
  kind: "image" | "file";
  target: string;
  fileName: string;
  bytes: number;
}

/** Everything one client sent, in order — the ordering of text against media is the point. */
export type Sent = SentText | SentMedia;

/** One resource download the bridge asked for, cap included (the fake stands in for the SDK adapter). */
export interface ImageFetch {
  messageId: string;
  fileKey: string;
  maxBytes: number;
}

/** The rich-text content out of a card, which is the whole of what a card carries here. */
export function cardContent(card: FeishuCard): string {
  const element = card.body.elements[0];
  if (card.schema !== "2.0" || element?.tag !== "markdown") {
    throw new Error(`unexpected card envelope: ${JSON.stringify(card)}`);
  }
  return element.content;
}

/** The bytes as a stream, so the fakes read them through the real capped reader. */
export async function* oneChunk(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/** A PNG's magic bytes plus a little payload: enough for a data URL to be asserted verbatim. */
export const IMAGE_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03,
]);

/** An inbound file's contents — text, so a failed write shows up as the wrong bytes on disk. */
export const FILE_BYTES = Buffer.from("quarterly revenue: 42\n", "utf8");

export class FakeClient implements FeishuApiClient {
  readonly sends: Sent[] = [];
  /**
   * The card sends specifically, as the rich-text content they carried.
   *
   * A card is ALSO recorded in `sends` as an ordinary text send, so the routing, ordering
   * and threading assertions read the same whichever transport carried the message — those
   * are what they are about. This list is what separates the two, and it is what a test
   * asserting the plain path checks is empty.
   */
  readonly cards: SentText[] = [];
  /** When each send was recorded, parallel to `sends`: what the pacing test measures. */
  readonly sentAt: number[] = [];
  readonly imageFetches: ImageFetch[] = [];
  readonly fileFetches: ImageFetch[] = [];
  checks = 0;
  constructor(
    readonly creds: FeishuCredentials,
    private readonly sdk: FakeFeishuSdk,
  ) {}
  async checkCredentials(): Promise<null> {
    this.checks++;
    if (this.sdk.failCheck !== null) throw new Error(this.sdk.failCheck);
    return null;
  }
  async sendText(chatId: string, text: string): Promise<void> {
    if (this.sdk.failSendWith !== null) throw this.sdk.failSendWith;
    if (this.sdk.failSend !== null) throw new Error(this.sdk.failSend);
    this.sdk.noteSend();
    this.record({ kind: "send", target: chatId, text });
    await this.sdk.hold();
  }
  async replyText(messageId: string, text: string): Promise<void> {
    this.sdk.noteSend();
    this.record({ kind: "reply", target: messageId, text });
    await this.sdk.hold();
  }
  async sendCard(chatId: string, card: FeishuCard): Promise<void> {
    // The typed failures fire on a card exactly as they do on a text bubble: Feishu refuses a
    // missing scope on EVERY send, whatever the msg_type, so a fake that let a card through
    // would make the card path quietly immune to the failure the text path is asserted on.
    if (this.sdk.failSendWith !== null) throw this.sdk.failSendWith;
    if (this.sdk.failCard !== null) throw this.sdk.failCard;
    if (this.sdk.failSend !== null) throw new Error(this.sdk.failSend);
    this.sdk.noteSend();
    this.recordCard({ kind: "send", target: chatId, text: cardContent(card) });
    await this.sdk.hold();
  }
  async replyCard(messageId: string, card: FeishuCard): Promise<void> {
    if (this.sdk.failSendWith !== null) throw this.sdk.failSendWith;
    if (this.sdk.failCard !== null) throw this.sdk.failCard;
    this.sdk.noteSend();
    this.recordCard({ kind: "reply", target: messageId, text: cardContent(card) });
    await this.sdk.hold();
  }
  private recordCard(sent: SentText): void {
    this.cards.push(sent);
    this.record(sent);
  }
  private record(sent: SentText): void {
    this.sends.push(sent);
    this.sentAt.push(Date.now());
  }
  async botOpenId(): Promise<string | null> {
    this.sdk.botIdentityLookups++;
    // A stalled endpoint: the TCP connection is accepted and the answer never comes.
    if (this.sdk.stallBotOpenId) return new Promise<never>(() => {});
    return this.sdk.botOpenId;
  }
  async fetchMessageImage(args: ImageFetch): Promise<FeishuImageData> {
    this.imageFetches.push(args);
    if (this.sdk.failImageFetchWith !== null) throw this.sdk.failImageFetchWith;
    if (this.sdk.failImageFetch !== null) throw new Error(this.sdk.failImageFetch);
    // The cap is enforced through the REAL machinery the adapter uses, not a hand-written
    // imitation of it: a fake free to throw its own error shape is a fake free to disagree
    // with production about which failure this is (it did, once).
    const data = await collectUnderCap(oneChunk(this.sdk.imageBytes), args.maxBytes, "The image");
    return { data, mimeType: "image/png" };
  }
  async fetchMessageFile(args: ImageFetch): Promise<Buffer> {
    this.fileFetches.push(args);
    if (this.sdk.failFileFetchWith !== null) throw this.sdk.failFileFetchWith;
    if (this.sdk.failFileFetch !== null) throw new Error(this.sdk.failFileFetch);
    // Through the REAL capped reader, for the reason fetchMessageImage gives.
    return collectUnderCap(oneChunk(this.sdk.fileBytes), args.maxBytes, "The file");
  }
  async sendImage(chatId: string, file: { fileName: string; data: Buffer }): Promise<void> {
    this.sdk.failMediaSendOnce();
    this.sends.push({
      kind: "image",
      target: chatId,
      fileName: file.fileName,
      bytes: file.data.length,
    });
  }
  async sendFile(chatId: string, file: { fileName: string; data: Buffer }): Promise<void> {
    this.sdk.failMediaSendOnce();
    this.sends.push({
      kind: "file",
      target: chatId,
      fileName: file.fileName,
      bytes: file.data.length,
    });
  }
}

export class FakeConnection {
  closed = false;
  constructor(
    readonly creds: FeishuCredentials,
    readonly handlers: FeishuEventHandlers,
  ) {}
  close(): void {
    this.closed = true;
  }
  fire(evt: FeishuInboundEvent): Promise<void> {
    return Promise.resolve(this.handlers.onMessage(evt));
  }
}

export class FakeFeishuSdk implements FeishuSdk {
  readonly clients: FakeClient[] = [];
  readonly connections: FakeConnection[] = [];
  /** Non-null makes checkCredentials throw with this message. */
  failCheck: string | null = null;
  /** Non-null makes the send with this 1-based number (counted across clients) throw. */
  failSendAt: number | null = null;
  /** Non-null parks every send on this promise, holding the bridge's send chain open. */
  heldSends: Promise<void> | null = null;
  private sendCount = 0;
  /** Every send passes here first: it counts, and throws for the one a test marked. */
  noteSend(): void {
    this.sendCount += 1;
    if (this.sendCount === this.failSendAt) throw new Error("Too Many Requests: retry after 5");
  }
  /** Awaited after each send: instant unless a test is holding sends open. */
  hold(): Promise<void> {
    return this.heldSends ?? Promise.resolve();
  }
  /** What `/open-apis/bot/v3/info` reports for this app; null = the identity is unavailable. */
  botOpenId: string | null = null;
  /** Makes that lookup never answer, so a test can prove connect() does not wait on it. */
  stallBotOpenId = false;
  /** Lookups the connector has started (one per connection, off the connect path). */
  botIdentityLookups = 0;
  /** Non-null makes every outbound sendText throw with this message. */
  failSend: string | null = null;
  /** Non-null makes every outbound sendText throw THIS — for the failure shapes that carry data. */
  failSendWith: Error | null = null;
  /**
   * Non-null makes every CARD send throw this, leaving the plain text sends working — the
   * shape of a channel that refuses a rendering and accepts the message behind it.
   */
  failCard: Error | null = null;
  /**
   * Non-null holds every createClient until it resolves, which is what makes the bridge's
   * one await between reading the binding row and its first send observable to a test.
   */
  createClientGate: Promise<void> | null = null;
  /** How many createClient calls the gate has held. */
  gated = 0;
  /** Non-null makes fetchMessageImage throw with this message (a dead image_key, a network fault). */
  failImageFetch: string | null = null;
  /** Non-null makes it throw THIS — for the failure shapes that carry data, not just text. */
  failImageFetchWith: Error | null = null;
  /** What an image download resolves to; oversize bytes exercise the cap. */
  imageBytes: Buffer = IMAGE_BYTES;
  /** Non-null makes fetchMessageFile throw with this message (a dead file_key, a network fault). */
  failFileFetch: string | null = null;
  /** Non-null makes it throw THIS — for the failure shapes that carry data, not just text. */
  failFileFetchWith: Error | null = null;
  /** What a file download resolves to; oversize bytes exercise the cap. */
  fileBytes: Buffer = FILE_BYTES;
  /** Fails this many upcoming outbound image/file sends (the channel refusing an upload). */
  failMediaSends = 0;
  /** Non-null makes EVERY media send throw this — for the failure shapes that carry data. */
  failMediaSendWith: Error | null = null;
  /** Consumes one scheduled media-send failure, throwing when there is one. */
  failMediaSendOnce(): void {
    if (this.failMediaSendWith !== null) throw this.failMediaSendWith;
    if (this.failMediaSends > 0) {
      this.failMediaSends -= 1;
      throw new Error("upload rejected");
    }
  }
  async createClient(creds: FeishuCredentials): Promise<FeishuApiClient> {
    if (this.createClientGate !== null) {
      this.gated++;
      await this.createClientGate;
    }
    const client = new FakeClient(creds, this);
    this.clients.push(client);
    return client;
  }
  async connect(creds: FeishuCredentials, handlers: FeishuEventHandlers): Promise<FakeConnection> {
    const conn = new FakeConnection(creds, handlers);
    this.connections.push(conn);
    handlers.onReady?.();
    return conn;
  }
  /** Everything sent through any client, in order (texts and media interleaved). */
  allSends(): Sent[] {
    return this.clients.flatMap((c) => c.sends);
  }
  /** Their timestamps, in the same order. */
  allSentAt(): number[] {
    return this.clients.flatMap((c) => c.sentAt);
  }
  /** Just the text messages — for the assertions that read `.text`. */
  allTexts(): SentText[] {
    return this.allSends().filter((s): s is SentText => s.kind === "send" || s.kind === "reply");
  }
  /** Only the messages that went out as an interactive card, across every client. */
  allCards(): SentText[] {
    return this.clients.flatMap((c) => c.cards);
  }
  /** Every image download asked of any client, in order. */
  allImageFetches(): ImageFetch[] {
    return this.clients.flatMap((c) => c.imageFetches);
  }
  /** Every file download asked of any client, in order. */
  allFileFetches(): ImageFetch[] {
    return this.clients.flatMap((c) => c.fileFetches);
  }
  lastConnection(): FakeConnection {
    const conn = this.connections.at(-1);
    if (!conn) throw new Error("no fake connection was opened");
    return conn;
  }
}
