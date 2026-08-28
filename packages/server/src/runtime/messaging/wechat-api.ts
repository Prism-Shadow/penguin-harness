/**
 * The WeChat half of the WeChat connector: the wire protocol of the official claw bot
 * channel, behind an injectable seam so tests substitute a fake and never open a socket
 * (the shape qq-api.ts and telegram-api.ts share).
 *
 * ## What this protocol is, and why it is reimplemented here
 *
 * Tencent publishes the channel as an OpenClaw plugin
 * (https://github.com/Tencent/openclaw-weixin, MIT) and there is an independent SDK derived
 * from it (https://github.com/wong2/weixin-agent-sdk, MIT, npm `weixin-agent-sdk`). Both are
 * readable, and both describe the SAME protocol: plain JSON over HTTPS, no proprietary
 * binary, no obfuscated dist. Neither is taken as a dependency, and the reason is shape
 * rather than licence: both own the process's message loop (`login()` then `start(agent)`),
 * carry ONE account, render the login QR to a TTY with `qrcode-terminal`, and persist their
 * state under `~/.openclaw`. This product needs many bindings side by side, each with its
 * own stored config document, and a QR that reaches a browser. So the protocol is
 * reimplemented against the same endpoints, the way qq-scan.ts reimplements Tencent's
 * bind-task protocol rather than taking its npm package.
 *
 * ## Inbound is a long poll, which is why this channel is possible at all
 *
 * `getupdates` is held open by the server until a message arrives or the window closes, and
 * the client passes back the opaque `get_updates_buf` cursor it was last given. There is no
 * webhook and no public URL anywhere in the flow — the same property that made QQ's gateway
 * usable and QQ's webhook mode not.
 *
 * ## Media rides a CDN, encrypted, and the encryption is not optional
 *
 * A picture or a file is never inline. Outbound: `getuploadurl` issues a pre-signed URL for
 * bytes the caller has already AES-128-ECB encrypted under a key it generates, and the CDN
 * answers with the `x-encrypted-param` handle that the message item then references.
 * Inbound: the item carries a URL and the key, and the bytes are ciphertext until decrypted.
 * ECB with a per-file random key is the platform's choice, not one made here — the framing
 * is what it is, and the alternative to implementing it is not carrying media at all.
 *
 * ## `context_token`
 *
 * Every inbound message carries one, and it is echoed on every outbound send to the same
 * user. It is a routing hint rather than an authorization anchor — the platform accepts a
 * send without one, which is what a first send after a restart does — so it is threaded
 * through where it is known and omitted where it is not, and never persisted: it is derived
 * from traffic, and traffic is what re-derives it.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { MessagingMediaTooLargeError, collectUnderCap } from "./media.js";

/** The platform's fixed entry host: the QR calls, and the default API base before a scan names one. */
export const WECHAT_API_BASE = "https://ilinkai.weixin.qq.com";

/**
 * `iLink-App-Id`. Not a per-integration credential — it names the KIND of client, and every
 * bot-channel client sends this same literal (it is the `ilink_appid` field of Tencent's own
 * plugin manifest). There is nothing to register and nothing to keep secret.
 */
const ILINK_APP_ID = "bot";

/**
 * `iLink-App-ClientVersion`: `major<<16 | minor<<8 | patch` in a uint32, which is the
 * encoding the header documents. Pinned rather than derived from the product version — this
 * names the PROTOCOL client, and it moves when the protocol handling moves, not when the
 * product ships a release.
 */
const ILINK_CLIENT_VERSION = (1 << 16) | (0 << 8) | 0;

/**
 * `base_info.bot_agent`: the self-declared identity, the protocol's own analogue of a
 * `User-Agent`. Observability only — it authenticates and routes nothing — and the grammar
 * is `Name/Version`, so a bare name would be dropped by the server's sanitizer.
 */
const BOT_AGENT = "PenguinHarness/1.0";

/** Overall deadline for the short calls (send, upload handle, credential probe). */
const CALL_TIMEOUT_MS = 15_000;

/**
 * How long ONE `getupdates` may be held. The protocol's own suggestion is 35s; this is
 * shorter on purpose, because the poll loop cannot see a closed connection while it is
 * parked in a request — a shorter window bounds how long a disable waits for its poll to
 * come back. The abort signal is what actually ends it promptly; this is the backstop for
 * a connection that is hung rather than closed.
 */
export const LONG_POLL_TIMEOUT_MS = 30_000;

/**
 * Deadline for a media transfer in either direction. Far longer than a method call: these
 * move megabytes over whatever link the server has, and a 15s ceiling would fail a picture
 * that was on its way perfectly well (the same number telegram-api.ts uses).
 */
const TRANSFER_TIMEOUT_MS = 60_000;

/**
 * How long the connection's FIRST poll may take. It is a drain, not a wait: it asks for
 * whatever the platform is already holding, and anything that has not arrived by here is a
 * live message the loop is about to read properly rather than backlog to discard. Parking it
 * for the full long-poll window would drop the first message a user sends after enabling.
 */
export const DRAIN_TIMEOUT_MS = 5_000;

/** The bot-channel `bot_type` the QR calls are made under. */
export const WECHAT_BOT_TYPE = "3";

// ---------------------------------------------------------------------------
// The wire's own vocabulary
// ---------------------------------------------------------------------------

/** `MessageItem.type` — the item kinds this channel carries. */
const ITEM_TEXT = 1;
const ITEM_IMAGE = 2;
const ITEM_VOICE = 3;
const ITEM_FILE = 4;
const ITEM_VIDEO = 5;

/** `WeixinMessage.message_type`: a message this bot is SENDING. */
const MESSAGE_TYPE_BOT = 2;

/** `WeixinMessage.message_state`: the message is complete (nothing is streamed from here). */
const MESSAGE_STATE_FINISH = 2;

/** `GetUploadUrlReq.media_type`. VOICE (4) exists on the wire and is never sent from here. */
const UPLOAD_MEDIA_IMAGE = 1;
const UPLOAD_MEDIA_FILE = 3;

/** AES-128 key length — what both the CDN framing and `getuploadurl`'s `aeskey` expect. */
const AES_KEY_BYTES = 16;

/** One file name for a video, which the wire never names (see the connector's inbound doc). */
export const WECHAT_VIDEO_FILE_NAME = "video.mp4";

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

export interface WeChatCredentials {
  /** `ilink_bot_id` — the channel-scoped account identity. Never secret. */
  botId: string;
  /** The bot token a completed scan issued. This is the credential. */
  botToken: string;
  /**
   * The API host this bot was assigned. A scan may hand back an IDC-specific one, and a bot
   * polled against the wrong host reads as an authentication failure, so it is stored per
   * binding rather than assumed.
   */
  baseUrl: string;
  /**
   * `ilink_user_id` of the person whose scan created the binding. It is what the credential
   * probe names — `getconfig` is per-user — and it is not otherwise used: an inbound message
   * carries its own sender.
   */
  userId: string;
}

/**
 * One media object on the wire: where the bytes are, and the key that opens them.
 *
 * A handle, deliberately — nothing here has fetched anything. The connector turns it into
 * the seam's lazy `fetch`, so a redelivered message costs no transfer at all.
 */
export interface WeChatMediaRef {
  /**
   * The ready-made download URL the server returns. Required: the alternative is rebuilding
   * it from a CDN host this protocol does not document, and a guessed host that resolves
   * would be worse than one that does not.
   */
  url: string;
  /**
   * The AES-128 key, in the wire's own base64. Absent for the one case the platform sends in
   * the clear (an image with no key at all), which then needs no decryption.
   */
  aesKey?: string;
}

/** A non-image attachment on an inbound message. */
export interface WeChatInboundFile {
  /** The sender's own name for it, or a plain fallback where the wire carries none. */
  fileName: string;
  media: WeChatMediaRef;
}

/**
 * One inbound message, reduced to what the connector consumes. Voice, video and quoted
 * messages have already been folded into these three fields — see `normalizeMessage`.
 */
export interface WeChatInboundEvent {
  /** `from_user_id`: the sender, the chat, and the send target, which are one id on this channel. */
  userId: string;
  /** `message_id`, as text. The dedupe key and the reply anchor. */
  messageId: string;
  /** The message's text, or `""` when it carries none. */
  text: string;
  /** Echoed on sends to this user while it is known (see the module doc). */
  contextToken?: string;
  images: WeChatMediaRef[];
  files: WeChatInboundFile[];
}

/** One outbound attachment: the bytes, and the name the chat should show. */
export interface WeChatOutboundFile {
  fileName: string;
  data: Buffer;
}

export interface WeChatSendArgs {
  /** `to_user_id` — the chat, which on this channel is the person. */
  userId: string;
  text: string;
  contextToken?: string;
}

/** What one `getupdates` returned: the messages, and the cursor for the next call. */
export interface WeChatUpdates {
  messages: WeChatInboundEvent[];
  /** Opaque `get_updates_buf`; pass it back verbatim. */
  cursor: string;
}

export interface WeChatBotClient {
  /**
   * Credential probe: resolves when the token AUTHENTICATES, and throws when it does not.
   *
   * What it deliberately does not prove is that the bot can deliver anything. No call on this
   * platform can prove both: every authenticated endpoint shares one auth layer and then does
   * something with a side condition a freshly-scanned binding cannot satisfy — `getconfig`
   * wants a live conversation to mint a typing ticket for, `getuploadurl` wants a peer and a
   * file, `sendtyping` wants a ticket, and `getupdates` is a long poll that would park for its
   * whole window. So the probe reads the layer that has no side conditions and reports only
   * that, which is the honest answer rather than a green light for something it did not test.
   */
  checkCredentials(): Promise<void>;
  /**
   * One poll. `signal` ends it at once, which is what a disable needs.
   *
   * A window that closes with nothing to report resolves EMPTY rather than throwing: on a long
   * poll that is the ordinary quiet case, and treating it as a failure would flap the
   * connection into `error` every time a conversation went quiet.
   *
   * `drain: true` asks for a short deadline instead of the long-poll window — see
   * DRAIN_TIMEOUT_MS.
   */
  getUpdates(args: {
    cursor: string;
    signal: AbortSignal;
    drain?: boolean;
  }): Promise<WeChatUpdates>;
  sendText(args: WeChatSendArgs): Promise<void>;
  /** Uploads the bytes to the CDN, then sends the item that references them. */
  sendImage(args: WeChatSendArgs & { file: WeChatOutboundFile }): Promise<void>;
  sendFile(args: WeChatSendArgs & { file: WeChatOutboundFile }): Promise<void>;
  /**
   * Downloads and decrypts one media handle, refusing at the byte that crosses `maxBytes`.
   * `what` names the transfer in a refusal and must never carry a URL: a CDN URL embeds the
   * signed parameter that authorizes the read.
   */
  fetchMedia(ref: WeChatMediaRef, maxBytes: number, what: string): Promise<Buffer>;
}

/** Factory the connector is built over: the production adapter, or a test fake. */
export interface WeChatTransport {
  createClient(creds: WeChatCredentials): WeChatBotClient;
}

/**
 * The code the platform answers with when the bot token is stale or revoked. It arrives with
 * an HTTP 200 and a non-zero envelope, so it is the one business-level code that has to be
 * read as an authentication failure rather than as one of the call behind it.
 */
export const WECHAT_STALE_TOKEN_CODE = -14;

/**
 * A call the platform answered with a failure of its own, as opposed to one that never
 * arrived. `ret` is the protocol's numeric code where it returned one.
 */
export class WeChatApiError extends Error {
  /**
   * The request was ACCEPTED — it authenticated, and the failure came from the call behind
   * the credential rather than from the credential.
   *
   * This distinction is the whole of the credential probe: every authenticated endpoint on
   * this platform shares one auth layer and then does something that needs state a
   * freshly-bound bot does not have, so the only thing a probe can honestly read is which of
   * the two layers refused it (see checkCredentials).
   */
  readonly authenticated: boolean;
  /**
   * The request was given up on at a deadline rather than answered or refused. On a long poll
   * that is the ordinary quiet case and not a failure at all, which is what `getUpdates` reads
   * it for; nothing else here distinguishes it from a network fault.
   */
  readonly timedOut: boolean;

  constructor(
    readonly ret: number | undefined,
    message: string,
    flags: { authenticated?: boolean; timedOut?: boolean } = {},
  ) {
    super(message);
    this.name = "WeChatApiError";
    this.authenticated = flags.authenticated ?? false;
    this.timedOut = flags.timedOut ?? false;
  }
}

// ---------------------------------------------------------------------------
// Production adapter over fetch
// ---------------------------------------------------------------------------

/** Whether a fetch rejection is a deadline or a cancellation rather than a transport fault. */
function isAbortLike(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** Readable failure text out of fetch's throw shapes. Never echoes a URL (see fetchMedia). */
export function wechatFetchErrorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") return "request timed out";
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message !== "") return cause.message;
    return err.message;
  }
  return String(err);
}

/**
 * `X-WECHAT-UIN`: a random uint32, rendered as its decimal digits and then base64'd. It
 * identifies nothing — the protocol wants the header present and the value fresh per
 * request, which is exactly what a random one is.
 */
function randomUin(): string {
  return Buffer.from(String(randomBytes(4).readUInt32BE(0)), "utf8").toString("base64");
}

function headersFor(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": randomUin(),
    "iLink-App-Id": ILINK_APP_ID,
    "iLink-App-ClientVersion": String(ILINK_CLIENT_VERSION),
  };
}

/** The `base_info` every request carries. */
function baseInfo(): Record<string, unknown> {
  return { channel_version: "1.0.0", bot_agent: BOT_AGENT };
}

/** Joins an endpoint onto a base whose trailing slash the caller may or may not have kept. */
function endpointUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

/** The response envelope the JSON calls share; `ret` is 0 or absent on success. */
interface WeChatEnvelope {
  ret?: number;
  errcode?: number;
  errmsg?: string;
}

/** Raises the platform's own failure, or returns the parsed body. */
function checkEnvelope(label: string, status: number, raw: string): Record<string, unknown> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new WeChatApiError(undefined, `${label} failed: HTTP ${status} (unparseable response)`);
  }
  const env = body as WeChatEnvelope;
  // `ret` and `errcode` are two spellings of the same thing across these endpoints; either
  // being non-zero is a failure, and neither being present is a success.
  const code = env.ret !== undefined && env.ret !== 0 ? env.ret : env.errcode;
  if (code !== undefined && code !== 0) {
    // The request reached the platform and got past its credential check — a stale token
    // being the one code that says otherwise.
    throw new WeChatApiError(code, `${label} failed: ${env.errmsg ?? `code ${code}`}`, {
      authenticated: code !== WECHAT_STALE_TOKEN_CODE,
    });
  }
  return body;
}

// ---------------------------------------------------------------------------
// AES-128-ECB, which is the CDN's framing
// ---------------------------------------------------------------------------

/** PKCS#7 is node's default for this cipher, so the padded length is always a full block longer. */
function paddedSize(plaintextSize: number): number {
  return Math.ceil((plaintextSize + 1) / 16) * 16;
}

function encryptEcb(plaintext: Buffer, key: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  return Buffer.concat([cipher.update(plaintext), cipher.final()]);
}

function decryptEcb(ciphertext: Buffer, key: Buffer): Buffer {
  const decipher = createDecipheriv("aes-128-ecb", key, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Reads the wire's `aes_key` back to 16 raw bytes.
 *
 * Two encodings appear, and which one arrives depends on the item kind rather than on
 * anything a reader can see: an image's key is base64 of the raw bytes, while a file's and a
 * video's is base64 of the key's 32 HEX CHARACTERS. Both are accepted by length, because a
 * 32-byte decode that is entirely hex digits cannot be a 16-byte key under any reading.
 */
export function parseWeChatAesKey(aesKey: string): Buffer {
  const decoded = Buffer.from(aesKey, "base64");
  if (decoded.length === AES_KEY_BYTES) return decoded;
  const ascii = decoded.toString("ascii");
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(ascii)) return Buffer.from(ascii, "hex");
  throw new Error("wechat media key is neither 16 raw bytes nor 32 hex characters");
}

// ---------------------------------------------------------------------------
// Inbound normalization
// ---------------------------------------------------------------------------

/** One `MessageItem`, in the wire's own field names (only the parts read here). */
interface WireItem {
  type?: number;
  text_item?: { text?: string };
  image_item?: { media?: WireMedia; aeskey?: string };
  voice_item?: { media?: WireMedia; text?: string };
  file_item?: { media?: WireMedia; file_name?: string };
  video_item?: { media?: WireMedia };
  ref_msg?: { title?: string; message_item?: WireItem };
}

interface WireMedia {
  full_url?: string;
  aes_key?: string;
}

interface WireMessage {
  message_id?: number | string;
  from_user_id?: string;
  message_type?: number;
  context_token?: string;
  item_list?: WireItem[];
}

/** A media handle, or null when the item carries no usable URL. */
function mediaRefOf(media: WireMedia | undefined, aesKeyOverride?: string): WeChatMediaRef | null {
  const url = media?.full_url;
  if (typeof url !== "string" || url === "") return null;
  // `image_item.aeskey` is hex and takes precedence over `media.aes_key` where both are sent;
  // it is the one the platform's own client prefers for images.
  const aesKey =
    typeof aesKeyOverride === "string" && aesKeyOverride !== ""
      ? Buffer.from(aesKeyOverride, "hex").toString("base64")
      : media?.aes_key;
  return { url, ...(typeof aesKey === "string" && aesKey !== "" ? { aesKey } : {}) };
}

/**
 * The text a message contributes.
 *
 * A VOICE item's `text` is the platform's OWN transcription of the recording, so a voice
 * message that has one is a text message and is carried as one. There is no audio on the
 * connector seam — an inbound recording has nowhere to go — and dropping a transcription
 * that already exists would answer a spoken question with the not-supported notice.
 *
 * A quoted message contributes its summary in front of the reply, because the reply usually
 * does not repeat what it is answering and the model would otherwise read a bare "yes".
 */
function textOf(items: readonly WireItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.type === ITEM_TEXT && typeof item.text_item?.text === "string") {
      const quoted = item.ref_msg;
      const quotedText =
        quoted === undefined
          ? ""
          : [quoted.title, quoted.message_item ? textOf([quoted.message_item]) : ""]
              .filter((part): part is string => typeof part === "string" && part !== "")
              .join(" | ");
      parts.push(
        quotedText === "" ? item.text_item.text : `[quote: ${quotedText}]\n${item.text_item.text}`,
      );
      continue;
    }
    if (item.type === ITEM_VOICE && typeof item.voice_item?.text === "string") {
      parts.push(item.voice_item.text);
    }
  }
  return parts.join("\n").trim();
}

/**
 * One wire message as the connector's event, or null for anything it must not act on.
 *
 * The bot's OWN messages come back on this stream — `message_type` 2 is what this client
 * sent — and relaying them would answer every reply with another reply.
 */
export function normalizeWeChatMessage(msg: WireMessage): WeChatInboundEvent | null {
  const userId = msg.from_user_id;
  if (typeof userId !== "string" || userId === "") return null;
  if (msg.message_type === MESSAGE_TYPE_BOT) return null;
  const items = Array.isArray(msg.item_list) ? msg.item_list : [];
  const images: WeChatMediaRef[] = [];
  const files: WeChatInboundFile[] = [];
  for (const item of items) {
    if (item.type === ITEM_IMAGE) {
      const ref = mediaRefOf(item.image_item?.media, item.image_item?.aeskey);
      if (ref !== null) images.push(ref);
    } else if (item.type === ITEM_FILE) {
      const ref = mediaRefOf(item.file_item?.media);
      const name = item.file_item?.file_name;
      // No name is a plain fallback rather than an invented extension: the name is the whole
      // of what tells the model what the bytes are (see connector.ts MessagingInboundFile).
      if (ref !== null)
        files.push({ fileName: name !== undefined && name !== "" ? name : "file", media: ref });
    } else if (item.type === ITEM_VIDEO) {
      const ref = mediaRefOf(item.video_item?.media);
      // `.mp4` is not a guess: the platform transcodes every video item to it, and its own
      // client asserts the type unconditionally. The wire carries no name to prefer over it.
      if (ref !== null) files.push({ fileName: WECHAT_VIDEO_FILE_NAME, media: ref });
    }
  }
  const messageId = msg.message_id;
  return {
    userId,
    messageId: messageId === undefined ? "" : String(messageId),
    text: textOf(items),
    ...(typeof msg.context_token === "string" && msg.context_token !== ""
      ? { contextToken: msg.context_token }
      : {}),
    images,
    files,
  };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export function createWeChatTransport(): WeChatTransport {
  return {
    createClient(creds: WeChatCredentials): WeChatBotClient {
      const post = async (
        path: string,
        payload: Record<string, unknown>,
        opts: { timeoutMs: number; signal?: AbortSignal; label: string },
      ): Promise<Record<string, unknown>> => {
        const url = endpointUrl(creds.baseUrl, path);
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: headersFor(creds.botToken),
            body: JSON.stringify({ ...payload, base_info: baseInfo() }),
            signal: opts.signal ?? AbortSignal.timeout(opts.timeoutMs),
          });
        } catch (err) {
          throw new WeChatApiError(
            undefined,
            `${opts.label} failed: ${wechatFetchErrorText(err)}`,
            {
              timedOut: isAbortLike(err),
            },
          );
        }
        const raw = await res.text().catch(() => "");
        if (!res.ok) {
          // The body is the platform's own diagnosis and is the only thing that distinguishes
          // a revoked token from a wrong host; it carries no credential of ours. Every status
          // here leaves `authenticated` false: a 401/403 IS the credential being refused, and
          // for anything else the request never got far enough to say the credential is good.
          throw new WeChatApiError(
            undefined,
            `${opts.label} failed: HTTP ${res.status}${raw === "" ? "" : ` ${raw.slice(0, 300)}`}`,
          );
        }
        return checkEnvelope(opts.label, res.status, raw);
      };

      /**
       * One message item on its way out. Every send is its own request with exactly one item:
       * the platform pairs a caption with its media as two consecutive messages rather than
       * one message with two items, and a two-item list is not a shape it accepts.
       */
      const sendItem = async (
        args: WeChatSendArgs,
        item: Record<string, unknown>,
        label: string,
      ): Promise<void> => {
        await post(
          "ilink/bot/sendmessage",
          {
            msg: {
              from_user_id: "",
              to_user_id: args.userId,
              client_id: randomBytes(16).toString("hex"),
              message_type: MESSAGE_TYPE_BOT,
              message_state: MESSAGE_STATE_FINISH,
              item_list: [item],
              ...(args.contextToken !== undefined ? { context_token: args.contextToken } : {}),
            },
          },
          { timeoutMs: CALL_TIMEOUT_MS, label },
        );
      };

      /**
       * The upload half of an outbound attachment: a fresh key, a pre-signed URL for the
       * ciphertext, and the CDN's handle for the message item to reference.
       *
       * `no_need_thumb` is set because nothing here has a thumbnail to make. The platform
       * requires thumbnail sizes for IMAGE and VIDEO only when one is being uploaded, and a
       * generated thumbnail would mean decoding every picture the Agent draws.
       */
      const upload = async (
        userId: string,
        file: WeChatOutboundFile,
        mediaType: number,
        label: string,
      ): Promise<{ param: string; aesKey: Buffer; rawSize: number; cipherSize: number }> => {
        const aesKey = randomBytes(AES_KEY_BYTES);
        const rawSize = file.data.length;
        const cipherSize = paddedSize(rawSize);
        const filekey = randomBytes(AES_KEY_BYTES).toString("hex");
        const handle = await post(
          "ilink/bot/getuploadurl",
          {
            filekey,
            media_type: mediaType,
            to_user_id: userId,
            rawsize: rawSize,
            rawfilemd5: createHash("md5").update(file.data).digest("hex"),
            filesize: cipherSize,
            no_need_thumb: true,
            aeskey: aesKey.toString("hex"),
          },
          { timeoutMs: CALL_TIMEOUT_MS, label: `${label} upload handle` },
        );
        const uploadUrl = handle.upload_full_url;
        if (typeof uploadUrl !== "string" || uploadUrl.trim() === "") {
          // The alternative is assembling a URL from a CDN host this protocol never
          // documents. A guessed host that happened to resolve would be worse than none.
          throw new WeChatApiError(undefined, `${label} failed: the upload URL was not returned`);
        }
        let res: Response;
        try {
          res = await fetch(uploadUrl.trim(), {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: new Uint8Array(encryptEcb(file.data, aesKey)),
            signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS),
          });
        } catch (err) {
          throw new WeChatApiError(undefined, `${label} failed: ${wechatFetchErrorText(err)}`);
        }
        if (!res.ok) {
          const detail = res.headers.get("x-error-message") ?? `HTTP ${res.status}`;
          throw new WeChatApiError(undefined, `${label} failed: ${detail}`);
        }
        const param = res.headers.get("x-encrypted-param");
        if (param === null || param === "") {
          throw new WeChatApiError(
            undefined,
            `${label} failed: the CDN returned no download handle`,
          );
        }
        return { param, aesKey, rawSize, cipherSize };
      };

      return {
        async checkCredentials(): Promise<void> {
          try {
            // The cheapest authenticated call that reads rather than writes, and the only one
            // that consumes nothing: `getupdates` would park for its window, and a probe that
            // advanced the cursor the poll loop is about to read would eat a user's message.
            await post(
              "ilink/bot/getconfig",
              { ilink_user_id: creds.userId },
              { timeoutMs: CALL_TIMEOUT_MS, label: "wechat credential check" },
            );
          } catch (err) {
            // The call behind the credential failed, which says nothing about the credential:
            // `getconfig` mints a typing ticket for a CONVERSATION, and a bot nobody has
            // messaged yet has none — so a binding whose sends work perfectly answers
            // "GetTypingTicket rpc failed" here. Reporting that as a bad credential sends the
            // user to re-scan a token that was never the problem.
            if (err instanceof WeChatApiError && err.authenticated) return;
            throw err;
          }
        },

        async getUpdates({ cursor, signal, drain = false }): Promise<WeChatUpdates> {
          // Two deadlines, combined: the caller's (a disable, which must end the poll now)
          // and this call's own window. Whichever fires first ends the request.
          const windowMs = drain ? DRAIN_TIMEOUT_MS : LONG_POLL_TIMEOUT_MS;
          let body: Record<string, unknown>;
          try {
            body = await post(
              "ilink/bot/getupdates",
              { get_updates_buf: cursor },
              {
                timeoutMs: windowMs,
                signal: AbortSignal.any([signal, AbortSignal.timeout(windowMs)]),
                label: "wechat getUpdates",
              },
            );
          } catch (err) {
            // A close is a close and must reach the loop; this window closing is not a
            // failure at all. A long poll that has nothing to say holds the request until it
            // expires, so treating that as an outage would put the connection into `error`
            // every quiet minute — and the cursor is unchanged, so the next call simply asks
            // again from where this one started.
            if (signal.aborted) throw err;
            if (err instanceof WeChatApiError && err.timedOut) return { messages: [], cursor };
            throw err;
          }
          const raw = Array.isArray(body.msgs) ? (body.msgs as WireMessage[]) : [];
          const messages: WeChatInboundEvent[] = [];
          for (const msg of raw) {
            const evt = normalizeWeChatMessage(msg);
            if (evt !== null) messages.push(evt);
          }
          // A response that carried no cursor leaves the old one in place: sending `""` back
          // means "start over", which would replay everything this poll just consumed.
          const next = body.get_updates_buf;
          return { messages, cursor: typeof next === "string" && next !== "" ? next : cursor };
        },

        sendText(args: WeChatSendArgs): Promise<void> {
          return sendItem(args, { type: ITEM_TEXT, text_item: { text: args.text } }, "wechat send");
        },

        async sendImage(args): Promise<void> {
          const { param, aesKey, cipherSize } = await upload(
            args.userId,
            args.file,
            UPLOAD_MEDIA_IMAGE,
            "wechat image send",
          );
          if (args.text !== "") await this.sendText(args);
          await sendItem(
            args,
            {
              type: ITEM_IMAGE,
              image_item: {
                media: {
                  encrypt_query_param: param,
                  aes_key: aesKey.toString("base64"),
                  encrypt_type: 1,
                },
                mid_size: cipherSize,
              },
            },
            "wechat image send",
          );
        },

        async sendFile(args): Promise<void> {
          const { param, aesKey, rawSize } = await upload(
            args.userId,
            args.file,
            UPLOAD_MEDIA_FILE,
            "wechat file send",
          );
          if (args.text !== "") await this.sendText(args);
          await sendItem(
            args,
            {
              type: ITEM_FILE,
              file_item: {
                media: {
                  encrypt_query_param: param,
                  aes_key: aesKey.toString("base64"),
                  encrypt_type: 1,
                },
                file_name: args.file.fileName,
                // Plaintext length: the receiving client shows it, and the ciphertext is
                // one padding block longer than what the user actually gets.
                len: String(rawSize),
              },
            },
            "wechat file send",
          );
        },

        async fetchMedia(ref: WeChatMediaRef, maxBytes: number, what: string): Promise<Buffer> {
          let res: Response;
          try {
            res = await fetch(ref.url, { signal: AbortSignal.timeout(TRANSFER_TIMEOUT_MS) });
          } catch (err) {
            // The URL never reaches this message: it carries the signed parameter that
            // authorizes the read.
            throw new Error(`${what} could not be downloaded: ${wechatFetchErrorText(err)}`);
          }
          if (!res.ok) throw new Error(`${what} could not be downloaded: HTTP ${res.status}`);
          if (res.body === null) throw new Error(`${what} could not be downloaded: empty response`);
          // The cap is applied to the CIPHERTEXT, which is within one 16-byte block of the
          // plaintext — so it still refuses at the byte that crosses, rather than buffering
          // a whole oversized transfer and measuring it afterwards.
          const bytes = await collectUnderCap(
            res.body as AsyncIterable<Uint8Array>,
            maxBytes,
            what,
          );
          if (ref.aesKey === undefined) return bytes;
          try {
            return decryptEcb(bytes, parseWeChatAesKey(ref.aesKey));
          } catch (err) {
            if (err instanceof MessagingMediaTooLargeError) throw err;
            // The cause is a crypto failure over a key the chat has no control of; what the
            // user can act on is that the transfer arrived and could not be opened.
            throw new Error(`${what} arrived but could not be decrypted`);
          }
        },
      };
    },
  };
}
