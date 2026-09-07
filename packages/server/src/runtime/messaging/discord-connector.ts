/**
 * Discord messaging connector — the fifth implementation of the MessagingChannelConnector
 * seam. It owns everything Discord-specific: the config document's shape (a single bot
 * token, whose first segment names the bot — see discordBotIdOf), the transport behind it
 * (injectable for tests — see discord-api.ts), the reduction of a `MESSAGE_CREATE`
 * dispatch to the bridge's normalized inbound shape, and the one rule the platform imposes
 * on a bot that has not been granted the privileged message-content intent: in a server
 * channel it hears only the messages that @-mention it.
 *
 * ## Which messages are read
 *
 * A direct message, always. In a server channel or thread, a message that @-mentions this
 * bot — the same rule QQ's group events impose, and here it is also what makes the content
 * arrive at all: without the `MESSAGE_CONTENT` intent Discord blanks `content` and
 * `attachments` on every guild message except those two kinds, and this connector
 * deliberately never asks for the intent (see discord-api.ts). A message from any bot —
 * this one included — is dropped: a bot answering bots is a loop with no user in it.
 * System messages (a member joining, a pin, a boost) are dropped too.
 *
 * ## Routing
 *
 * A thread is a channel of its own on this platform, so the channel id alone is the chat
 * id and a reply lands where the question was asked — no topic packing. Message ids are
 * globally unique snowflakes, but a reply needs the channel to post into, so the reply ref
 * packs `channelId:messageId`; that ref is also the bridge's dedupe key and it names the
 * message rather than the delivery, as the seam requires.
 *
 * ## Text size
 *
 * A message's `content` is capped at 2000 characters, half the shared chunk size the
 * bridge uses, so this connector declares its own `textChunkChars` (with headroom under
 * the cap for the escapes the Markdown renderer adds). A rendered body that still lands
 * past the cap — the pathological reply made of nothing but asterisks — is sent as plain
 * text in cap-sized pieces instead: formatting lost, message kept.
 *
 * ## Media
 *
 * Both ways. An inbound attachment is an image when the platform types it as one (or its
 * name says so), otherwise a file — except a voice message's recording, which carries a
 * duration and nothing downstream transcribes; that one keeps the not-supported notice, as
 * Telegram's voice does. Outbound, a picture and a file are the same upload: Discord shows
 * an image attachment inline on its own.
 */
import { Bind, Component, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Opaque } from "@prismshadow/penguin-core/kernel";
import { chunkMessagingText } from "./bridge.js";
import type {
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingConnectorHandlers,
  MessagingInboundFile,
  MessagingInboundImage,
  MessagingInboundMessage,
  MessagingSendNote,
  MessagingSendOptions,
} from "./connector.js";
import type {
  DiscordAttachment,
  DiscordBotClient,
  DiscordCredentials,
  DiscordMessage,
  DiscordTransport,
} from "./discord-api.js";
import { DISCORD_MAX_CONTENT_CHARS, createDiscordTransport } from "./discord-api.js";
import { discordMarkdownOf } from "./discord-markdown.js";
import { imageMimeOfName } from "./media.js";

/** The Discord binding's stored config document (`messaging_bindings.config_json`). */
export interface DiscordBindingConfig extends Record<string, unknown> {
  botToken: string;
}

/**
 * The chunk size the bridge cuts a reply at for this channel: under the platform's 2000
 * cap, with room for the backslashes the renderer puts in front of literal markers.
 */
export const DISCORD_TEXT_CHUNK_CHARS = 1900;

/** The two message types a person writes: DEFAULT and REPLY. Everything else is a system message. */
const USER_MESSAGE_TYPES: ReadonlySet<number> = new Set([0, 19]);

/**
 * The numeric bot id a token encodes, or null when the token is malformed.
 *
 * A bot token is three dot-separated segments, and the first is the bot's user id in
 * base64 — every client library reads it this way to learn its own id before connecting.
 * That makes it the channel-scoped account identity (`messaging_bindings.account_id`),
 * robust against a token reset in the developer portal: the id half never changes for a
 * bot. A `Bot ` prefix pasted in from a copied header is tolerated and stripped.
 */
export function discordBotIdOf(botToken: string): string | null {
  const bare = botToken.trim().replace(/^Bot\s+/i, "");
  const [head, ...rest] = bare.split(".");
  if (head === undefined || head === "" || rest.length !== 2 || rest.some((s) => s === "")) {
    return null;
  }
  const decoded = Buffer.from(head, "base64").toString("utf8");
  return /^\d{15,22}$/.test(decoded) ? decoded : null;
}

/** Narrows a stored config document; throws a readable error on a malformed one. */
export function discordConfigOf(config: Record<string, unknown>): DiscordBindingConfig {
  const { botToken } = config;
  if (typeof botToken !== "string" || botToken === "") {
    throw new Error("malformed discord binding config (botToken)");
  }
  return { botToken };
}

/** The reply ref: the channel a reply posts into, and the message it quotes. */
export function discordReplyRefOf(channelId: string, messageId: string): string {
  return `${channelId}:${messageId}`;
}

function parseReplyRef(ref: string): { channelId: string; messageId: string } {
  const i = ref.indexOf(":");
  if (i <= 0 || i === ref.length - 1) throw new Error(`malformed discord reply ref "${ref}"`);
  return { channelId: ref.slice(0, i), messageId: ref.slice(i + 1) };
}

/**
 * Strips this bot's own mention off the FRONT of a message. Addressing a bot in a server
 * channel means naming it, so nearly every message this connector sees from one opens with
 * `@thisbot ` — a prefix that announces the channel the message came through, which the
 * model is deliberately not told. Only the addressing prefix goes; the bot named further
 * in is a word the user chose. Both mention spellings are matched (`<@id>` and the older
 * nickname form `<@!id>`).
 */
export function stripBotMention(content: string, botId: string): string {
  const lead = new RegExp(`^\\s*<@!?${botId}>\\s*`);
  return content.replace(lead, "").trim();
}

/** Whether the message's mention list names this bot. */
function mentionsBot(msg: DiscordMessage, botId: string): boolean {
  return (msg.mentions ?? []).some((m) => m.id === botId);
}

/** A voice message's recording: the platform marks it with a duration, and nothing else carries one. */
function isVoiceRecording(a: DiscordAttachment): boolean {
  return typeof a.duration_secs === "number";
}

/** An attachment that is a picture, by the platform's type or the name's extension. */
function isImageAttachment(a: DiscordAttachment): boolean {
  if (typeof a.content_type === "string" && a.content_type.startsWith("image/")) return true;
  return imageMimeOfName(a.filename) !== null;
}

/**
 * One dispatch reduced to the bridge's normalized shape; null for a message this binding
 * does not read (see the module doc). `bot` is captured by an attachment's `fetch`, so the
 * bytes are pulled only if the bridge asks for them.
 */
export function normalizeMessage(
  msg: DiscordMessage,
  botId: string,
  bot: DiscordBotClient,
): MessagingInboundMessage | null {
  if (msg.author.bot === true) return null;
  if (!USER_MESSAGE_TYPES.has(msg.type)) return null;
  const isGuild = msg.guild_id !== undefined;
  if (isGuild && !mentionsBot(msg, botId)) return null;
  const text = stripBotMention(msg.content, botId);
  const images: MessagingInboundImage[] = [];
  const files: MessagingInboundFile[] = [];
  for (const a of msg.attachments ?? []) {
    if (isVoiceRecording(a)) continue;
    if (isImageAttachment(a)) {
      images.push({
        fetch: async (maxBytes) => ({
          data: await bot.fetchAttachment({ url: a.url, maxBytes, what: "The image" }),
          mimeType:
            typeof a.content_type === "string" && a.content_type.startsWith("image/")
              ? a.content_type.split(";")[0]!
              : (imageMimeOfName(a.filename) ?? "image/png"),
        }),
      });
    } else {
      files.push({
        // The sender's own name, which the platform always carries; `file` only if it is
        // somehow blank — an obvious placeholder, never an invented extension.
        fileName: a.filename !== "" ? a.filename : "file",
        fetch: (maxBytes) => bot.fetchAttachment({ url: a.url, maxBytes, what: "The file" }),
      });
    }
  }
  const senderName =
    typeof msg.author.global_name === "string" && msg.author.global_name !== ""
      ? msg.author.global_name
      : msg.author.username;
  return {
    chatId: msg.channel_id,
    chatKind: isGuild ? "group" : "direct",
    messageId: discordReplyRefOf(msg.channel_id, msg.id),
    text: text !== "" ? text : null,
    ...(images.length > 0 ? { images } : {}),
    ...(files.length > 0 ? { files } : {}),
    ...(senderName !== "" ? { senderName } : {}),
  };
}

/** The note a send resolves when the rendered reply outgrew the cap and went out plainly instead. */
const FORMATTING_DROPPED_NOTE =
  "formatting dropped: the rendered reply exceeded Discord's message size, so it was sent as plain text";

export class DiscordConnector implements MessagingChannelConnector {
  readonly channel = "discord" as const;
  readonly textChunkChars = DISCORD_TEXT_CHUNK_CHARS;

  constructor(private readonly transport: DiscordTransport) {}

  private credsOf(config: Record<string, unknown>): DiscordCredentials {
    return discordConfigOf(config);
  }

  async createClient(config: Record<string, unknown>): Promise<MessagingClient> {
    const bot = this.transport.createClient(this.credsOf(config));
    const deliver = async (
      channelId: string,
      text: string,
      replyToMessageId: string | undefined,
      opts: MessagingSendOptions | undefined,
    ): Promise<MessagingSendNote | void> => {
      const content = opts?.markdown === true ? discordMarkdownOf(text) : text;
      if (content.length <= DISCORD_MAX_CONTENT_CHARS) {
        await bot.sendMessage({
          channelId,
          content,
          ...(replyToMessageId !== undefined ? { replyToMessageId } : {}),
        });
        return;
      }
      // The escapes pushed the rendered form past the cap: the source goes out plainly, in
      // pieces the platform accepts, with the reply relation on the first of them only.
      const pieces = chunkMessagingText(text, DISCORD_MAX_CONTENT_CHARS);
      for (const [i, piece] of pieces.entries()) {
        await bot.sendMessage({
          channelId,
          content: piece,
          ...(i === 0 && replyToMessageId !== undefined ? { replyToMessageId } : {}),
        });
      }
      return FORMATTING_DROPPED_NOTE;
    };
    return {
      async checkCredentials() {
        const me = await bot.getMe();
        return me.username !== "" ? { accountLabel: `@${me.username}` } : {};
      },
      sendText: (chatId, text, opts) => deliver(chatId, text, undefined, opts),
      replyText: (ref, text, opts) => {
        const { channelId, messageId } = parseReplyRef(ref);
        return deliver(channelId, text, messageId, opts);
      },
      // One upload for both: the platform shows an image attachment inline on its own.
      async sendImage(chatId, file) {
        await bot.sendFile({ channelId: chatId, fileName: file.fileName, data: file.data });
      },
      async sendFile(chatId, file) {
        await bot.sendFile({ channelId: chatId, fileName: file.fileName, data: file.data });
      },
    };
  }

  async connect(
    config: Record<string, unknown>,
    handlers: MessagingConnectorHandlers,
  ): Promise<MessagingConnection> {
    const creds = this.credsOf(config);
    // The bot's own id comes out of the token (see discordBotIdOf) — no `getMe` round trip
    // stands between enabling and listening, and a token this cannot be read from was
    // refused at the PUT.
    const botId = discordBotIdOf(creds.botToken);
    if (botId === null) throw new Error("malformed discord binding config (botToken)");
    const bot = this.transport.createClient(creds);
    return this.transport.openGateway(creds, {
      onMessage: async (msg) => {
        const normalized = normalizeMessage(msg, botId, bot);
        if (normalized !== null) await handlers.onMessage(normalized);
      },
      ...(handlers.onReady ? { onReady: handlers.onReady } : {}),
      ...(handlers.onError ? { onError: handlers.onError } : {}),
    });
  }
}

/** The discord connector, contributed to messaging.connectors like any third-party one would be. */
@Component({
  contributes: {
    "MessagingModule.connectors": [
      {
        id: "messaging-discord.connector",
        channel: "discord",
      },
    ],
  },
})
export class DiscordMessaging {
  @Use() private readonly discord!: DiscordTransportHandle;
  @Bind("messaging-discord.connector") connector!: MessagingChannelConnector;
  setup() {
    this.connector = new DiscordConnector(this.discord.transport);
  }
}

/** The REST + gateway transport as a node, so a test stands in a fake for the network. */
export abstract class DiscordTransportHandle extends Interface<{
  transport: Opaque<"DiscordTransport", DiscordTransport>;
}>() {}
@Module()
export class DiscordTransportProvider {
  @Provide() discordTransport!: DiscordTransportHandle;
  setup() {
    this.discordTransport = { transport: createDiscordTransport() };
  }
}
