/**
 * Chat bots: a bot account that STARTS agents from a chat, rather than one bound to a
 * Session somebody already opened in the Web App.
 *
 * The messaging bridge (bridge.ts) binds one bot to one Session: the operator opens a
 * conversation, pastes the bot's credential into it, and the bot relays that conversation.
 * A chat bot inverts the ownership. The bot is configured ONCE, at the deployment, with a
 * credential and a target Agent; every chat that then writes to it — a direct message, a
 * channel it is mentioned in, a thread — gets a Session of its own, created on the first
 * message and reused for the rest, and `/new` in that chat opens a fresh one. The person on
 * the other end never opens the Web App; the Sessions still appear there, under the target
 * Agent, like any other.
 *
 * Everything channel-specific is the connector's (connector.ts), which is why this host is
 * channel-neutral: it asks the bridge for the channel's connector, opens ONE inbound
 * connection on the bot's credential, routes each normalized message by its chat id, and
 * relays each Session's completed assistant messages back through the same connector's
 * client — Markdown rendered, chunked under the channel's cap, threaded onto the inbound
 * message in a group chat. A bot for another channel is a manifest entry naming the channel
 * and nothing more (see ChatBotsSlots); the first is the Discord plugin.
 *
 * What is deliberately simpler than the bridge: every completed assistant message is
 * relayed as it completes (no per-bot delivery preferences), the files a reply names are
 * not sent after it, and there is no rolling image budget — the per-image ceiling and the
 * per-message file caps still hold. A chat can approve a waiting tool call with `/approve`
 * (or refuse it with `/deny`) rather than opening the Web App, since the person asking has
 * no Web App in front of them.
 *
 * Configuration lives in the server settings store under `chatbot:<id>` (the credential
 * document, the target Project and Agent, the enabled flag) and the chat → Session table
 * under `chatbot:<id>:chats`, so both survive a restart and a hot swap. A plugin may seed
 * the configuration from its own source (the Discord plugin reads environment variables);
 * what is stored wins over the seed, and a seed never re-enables a bot the operator turned
 * off.
 */
import { imageUrlMessage, scratchpadDir, userText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import { Bind, Interface, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Slot } from "@prismshadow/penguin-core/kernel";
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  ChatBotInfo,
  ChatBotPutRequest,
  ChatBotStatus,
  ChatBotTestResponse,
  ChatBotsResponse,
} from "../../api/types.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { Channels, Clock, Log, Paths } from "../../hmr/capabilities.js";
import { HttpError } from "../../http/errors.js";
import { badRequest, optionalString, readJson } from "../../http/validate.js";
import type { AgentIndex } from "../../mechanisms/projects.js";
import type { Errors } from "../../mechanisms/observability.js";
import type { SessionIndex } from "../../mechanisms/sessions.js";
import type { Settings } from "../../mechanisms/settings.js";
import { INLINE_IMAGE_MAX_BYTES, toAttachmentLimits } from "../../services/attachment-limits.js";
import type { AttachmentLimits } from "../../services/attachment-limits.js";
import { maskApiKey } from "../../services/project-config-service.js";
import { attachFilesToInput, removeAttachments } from "../../services/task-attachments.js";
import type { TaskAttachment } from "../../services/task-attachments.js";
import type { ChannelEvent, ChannelHub } from "../channel.js";
import type { ErrorSink } from "../error-recorder.js";
import { ScheduleSessionCreator } from "../scheduler.js";
import { Sessions } from "../session-manager.js";
import {
  MESSAGING_TEXT_CHUNK_CHARS,
  MESSAGING_UNSUPPORTED_NOTICE,
  Messaging,
  MessagingTaskRunner,
  chunkMessagingText,
  messagingImageFailedNotice,
  messagingImagePermissionNotice,
  messagingImageTooLargeNotice,
  messagingInboundFileFailedNotice,
  messagingInboundFilePermissionNotice,
  messagingInboundFileTooLargeNotice,
  messagingInboundFilesTooLargeNotice,
} from "./bridge.js";
import type {
  MessagingChannel,
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingInboundFile,
  MessagingInboundImage,
  MessagingInboundMessage,
} from "./connector.js";
import { messagingErrorKind } from "./error-kind.js";
import { chunkMarkdown } from "./markdown.js";
import { MessagingMediaTooLargeError, MessagingPermissionError } from "./media.js";

// ---------------------------------------------------------------------------
// The vocabulary a plugin sees (re-exported through @prismshadow/penguin-server/plugin)
// ---------------------------------------------------------------------------

/**
 * One bot's manifest half: which channel it speaks, and how the settings page names it. The
 * contribution's own `id` is the bot's key — in the settings store and on the HTTP path
 * (`/api/chat-bots/:id`) — so a plugin names its bot by naming the contribution.
 */
export interface ChatBotContribution {
  /** The messaging channel whose connector carries it (a channel the bridge has a connector for). */
  channel: MessagingChannel;
  label: string;
  labelZh?: string;
}

/**
 * What a plugin may seed a bot with. Every member is optional: what the settings store holds
 * wins, and `enabled` seeds only a bot with NO stored state — a bot the operator switched off
 * stays off however the plugin's environment reads.
 */
export interface ChatBotDefaults {
  /** The credential document, in the channel connector's own shape (Discord: `{ botToken }`). */
  config?: Record<string, unknown>;
  projectId?: string;
  agentId?: string;
  enabled?: boolean;
}

/** One bot's code half. */
export interface ChatBotBinding {
  defaults?: ChatBotDefaults;
}

export interface ChatBotsSlots {
  /** A chat bot: the channel it speaks (static), and its seed (code). */
  bots: Slot<ChatBotContribution, ChatBotBinding>;
}

// ---------------------------------------------------------------------------
// Stored shapes
// ---------------------------------------------------------------------------

/** `chatbot:<id>` in the settings store. */
interface StoredBot {
  config: Record<string, unknown>;
  projectId: string | null;
  agentId: string | null;
  enabled: boolean;
}

/** One chat's Session, `chatbot:<id>:chats` in the settings store. */
interface StoredChat {
  sessionId: string;
  isDirect: boolean;
  /** The last inbound message this chat finished with — the redelivery watermark. */
  lastMessageId: string | null;
}

/** The commands a chat may write instead of a message to the Agent. */
const COMMAND = /^[/!](new|approve|deny|status)\b\s*/i;

/** The notices a chat hears from the host itself (bilingual, like the bridge's). */
export const CHAT_BOT_NEW_NOTICE = "Started a new conversation. 已开始新的对话。";
export const CHAT_BOT_APPROVAL_NOTICE =
  "A tool call is waiting for approval: reply /approve to allow it or /deny to refuse. 有工具调用等待审批：回复 /approve 允许，或 /deny 拒绝。";
export const CHAT_BOT_NOTHING_PENDING_NOTICE =
  "Nothing is waiting for approval. 当前没有等待审批的工具调用。";
export const CHAT_BOT_NOT_CONFIGURED_NOTICE =
  "This bot has no target Agent yet: an administrator has to finish its setup. 这个机器人尚未配置目标 Agent，请管理员完成设置。";

/** A chat's live state, beside the stored one. */
interface ChatState {
  chatId: string;
  isDirect: boolean;
  sessionId: string;
  /** The inbound message a group reply threads onto (memory only; direct chats keep null). */
  lastInboundMessageId: string | null;
  threadedThisRun: boolean;
  active: string;
  inCompaction: boolean;
  /** Tool calls waiting for `/approve`, in arrival order. */
  pendingApprovals: string[];
  sendChain: Promise<void>;
  unsubscribe: () => void;
}

/** One registered bot, and whatever of it is live. */
interface BotEntry {
  id: string;
  contrib: ChatBotContribution;
  defaults: ChatBotDefaults;
  connector: MessagingChannelConnector | null;
  client: MessagingClient | null;
  connection: MessagingConnection | null;
  status: ChatBotStatus;
  chats: Map<string, ChatState>;
  /** Recent inbound message ids, newest last; a channel redelivers, and nothing downstream is idempotent. */
  recent: string[];
  /** A connect superseded by a later one (a save, a toggle) must not report into the newer entry. */
  generation: number;
}

const RECENT_IDS = 64;

/** The shared session-creator shape, narrowed to what a bot needs. */
interface SessionCreatorShape {
  createSession(args: { projectId: string; agentId: string }): Promise<{ sessionId: string }>;
}

export interface ChatBotHostDeps {
  settings: Pick<Settings, "get" | "set" | "getAttachmentLimitsMb">;
  connectorFor: (channel: string) => MessagingChannelConnector;
  channels: ChannelHub;
  runner: Pick<MessagingTaskRunner, "startTask">;
  sessions: Pick<Sessions, "decideApproval">;
  sessionCreator: SessionCreatorShape;
  sessionIndex: Pick<SessionIndex, "findById">;
  agents: Pick<AgentIndex, "exists">;
  errors: ErrorSink;
  root: string;
  log?: (line: string) => void;
  now?: () => number;
}

export class ChatBotHost {
  private readonly bots = new Map<string, BotEntry>();
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private started = false;

  constructor(private readonly deps: ChatBotHostDeps) {
    this.log = deps.log ?? (() => {});
    this.now = deps.now ?? (() => Date.now());
  }

  // —— Registration and configuration ————————————————————————————————————————

  /** Adds a bot the plugins contributed; connects it at start (or now, once started) when it is enabled. */
  register(id: string, contrib: ChatBotContribution, binding: ChatBotBinding): void {
    if (this.bots.has(id)) throw new Error(`chat bot "${id}" is contributed twice`);
    const entry: BotEntry = {
      id,
      contrib,
      defaults: binding.defaults ?? {},
      connector: null,
      client: null,
      connection: null,
      status: { state: "disconnected" },
      chats: new Map(),
      recent: [],
      generation: 0,
    };
    this.bots.set(id, entry);
    if (this.started) void this.sync(id);
  }

  list(): ChatBotInfo[] {
    return [...this.bots.keys()].map((id) => this.info(id));
  }

  info(id: string): ChatBotInfo {
    const entry = this.entryOf(id);
    const stored = this.storedOf(entry);
    return {
      id,
      channel: entry.contrib.channel,
      label: entry.contrib.label,
      ...(entry.contrib.labelZh !== undefined ? { labelZh: entry.contrib.labelZh } : {}),
      projectId: stored.projectId,
      agentId: stored.agentId,
      config: maskConfig(stored.config),
      configured: Object.keys(stored.config).length > 0,
      enabled: stored.enabled,
      status: entry.status,
      chats: this.storedChatsOf(entry).size,
    };
  }

  /**
   * Saves the credential document and the target. A save never flips the connection —
   * except that an ENABLED bot restarts on the new values, so what is stored and what is
   * live never diverge (the bridge's rule).
   */
  async save(id: string, patch: ChatBotPutRequest): Promise<ChatBotInfo> {
    const entry = this.entryOf(id);
    const stored = this.storedOf(entry);
    if (patch.projectId !== undefined || patch.agentId !== undefined) {
      const projectId = patch.projectId ?? stored.projectId;
      const agentId = patch.agentId ?? stored.agentId;
      if (projectId === null || agentId === null) {
        throw badRequest("projectId and agentId must be given together.");
      }
      if (!this.deps.agents.exists(projectId, agentId)) {
        throw new HttpError(404, "agent_not_found", "Agent does not exist.");
      }
      stored.projectId = projectId;
      stored.agentId = agentId;
    }
    if (patch.config !== undefined) {
      // The connector reads its own document: a malformed one is refused here rather than
      // at the next connect. A masked value round-tripped by a client that read it back
      // keeps the stored value, the same never-round-trip rule the bridge's PUTs follow.
      const merged = { ...stored.config };
      for (const [key, value] of Object.entries(patch.config)) {
        if (typeof value === "string" && value === maskConfig(stored.config)[key]) continue;
        if (value === "" || value === null) delete merged[key];
        else merged[key] = value;
      }
      try {
        await this.deps.connectorFor(entry.contrib.channel).createClient(merged);
      } catch (err) {
        throw new HttpError(
          400,
          "chat_bot_config_invalid",
          err instanceof Error ? err.message : String(err),
        );
      }
      stored.config = merged;
    }
    this.writeStored(entry, stored);
    if (stored.enabled) await this.sync(id);
    return this.info(id);
  }

  /** The connection toggle: enabling connects on the stored values, disabling closes. */
  async setEnabled(id: string, enabled: boolean): Promise<ChatBotInfo> {
    const entry = this.entryOf(id);
    const stored = this.storedOf(entry);
    if (enabled && Object.keys(stored.config).length === 0) {
      throw new HttpError(400, "chat_bot_config_required", "Save the bot's credential first.");
    }
    if (enabled && (stored.projectId === null || stored.agentId === null)) {
      throw new HttpError(400, "chat_bot_target_required", "Choose the Project and Agent first.");
    }
    stored.enabled = enabled;
    this.writeStored(entry, stored);
    await this.sync(id);
    return this.info(id);
  }

  /** Credential probe on the stored document, or a draft. */
  async test(id: string, config?: Record<string, unknown>): Promise<ChatBotTestResponse> {
    const entry = this.entryOf(id);
    const doc = config ?? this.storedOf(entry).config;
    const startedAt = this.now();
    try {
      const client = await this.deps.connectorFor(entry.contrib.channel).createClient(doc);
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

  statusOf(id: string): ChatBotStatus {
    return this.entryOf(id).status;
  }

  // —— Lifecycle ——————————————————————————————————————————————————————————————

  /** Connects every enabled bot. Failures are per bot: one bad credential must not hold the boot. */
  async start(): Promise<void> {
    this.started = true;
    for (const id of this.bots.keys()) await this.sync(id);
  }

  stop(): void {
    this.started = false;
    for (const entry of this.bots.values()) this.disconnect(entry);
  }

  /** Brings one bot's live state in line with its stored intent. */
  async sync(id: string): Promise<void> {
    const entry = this.entryOf(id);
    this.disconnect(entry);
    const stored = this.storedOf(entry);
    if (!stored.enabled || !this.started) return;
    const generation = ++entry.generation;
    entry.status = { state: "connecting", changedAt: this.nowIso() };
    try {
      const connector = this.deps.connectorFor(entry.contrib.channel);
      entry.connector = connector;
      entry.client = await connector.createClient(stored.config);
      // Every chat known from before this connection is watched again: its Session may
      // still be running, and a reply completing after a restart belongs in that chat.
      for (const [chatId, chat] of this.storedChatsOf(entry)) this.watch(entry, chatId, chat);
      const connection = await connector.connect(stored.config, {
        onMessage: (msg) => this.onInbound(entry, generation, msg),
        onReady: () => {
          if (entry.generation !== generation) return;
          entry.status = { ...entry.status, state: "connected", changedAt: this.nowIso() };
          delete entry.status.lastError;
        },
        onError: (err) => {
          if (entry.generation !== generation) return;
          const detail = err instanceof Error ? err.message : String(err);
          entry.status = {
            ...entry.status,
            state: "error",
            lastError: detail,
            changedAt: this.nowIso(),
          };
          this.recordError(entry, null, err, "chat_bot_connect_failed");
        },
      });
      if (entry.generation !== generation) {
        connection.close();
        return;
      }
      entry.connection = connection;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      entry.status = { state: "error", lastError: detail, changedAt: this.nowIso() };
      this.recordError(entry, null, err, "chat_bot_connect_failed");
    }
  }

  private disconnect(entry: BotEntry): void {
    entry.generation += 1;
    try {
      entry.connection?.close();
    } catch (err) {
      this.log(`[chat-bot] close failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    entry.connection = null;
    entry.client = null;
    entry.connector = null;
    for (const chat of entry.chats.values()) chat.unsubscribe();
    entry.chats.clear();
    entry.status = { state: "disconnected", changedAt: this.nowIso() };
  }

  // —— Inbound ————————————————————————————————————————————————————————————————

  private async onInbound(
    entry: BotEntry,
    generation: number,
    msg: MessagingInboundMessage,
  ): Promise<void> {
    if (entry.generation !== generation) return;
    if (this.isRedelivery(entry, msg)) return;
    entry.status = { ...entry.status, lastInboundAt: this.nowIso() };
    try {
      const stored = this.storedOf(entry);
      if (stored.projectId === null || stored.agentId === null) {
        await this.replyInbound(entry, msg, CHAT_BOT_NOT_CONFIGURED_NOTICE);
        return;
      }
      const isDirect = msg.chatKind === "direct";
      let text = msg.text !== null && msg.text.trim() !== "" ? msg.text.trim() : null;
      const command = text !== null ? COMMAND.exec(text) : null;
      const verb = command?.[1]?.toLowerCase();
      if (command !== null && command !== undefined) {
        text = text!.slice(command[0].length).trim() || null;
      }
      let chat = entry.chats.get(msg.chatId) ?? null;
      if (verb === "new" && chat !== null) {
        this.forgetChat(entry, chat);
        chat = null;
      }
      if (verb === "approve" || verb === "deny") {
        await this.decide(entry, msg, chat, verb);
        return;
      }
      if (verb === "status") {
        await this.replyInbound(entry, msg, this.statusText(entry, chat));
        return;
      }
      const images = msg.images ?? [];
      const files = msg.files ?? [];
      if (text === null && images.length === 0 && files.length === 0) {
        await this.replyInbound(
          entry,
          msg,
          verb === "new" ? CHAT_BOT_NEW_NOTICE : MESSAGING_UNSUPPORTED_NOTICE,
        );
        if (verb === "new") this.markWatermark(entry, msg);
        return;
      }
      if (chat === null) {
        chat = await this.openChat(entry, stored.projectId, stored.agentId, msg.chatId, isDirect);
      }
      chat.lastInboundMessageId = isDirect ? null : msg.messageId;
      const notice = await this.startTask(entry, chat, text, images, files);
      if (notice !== null) await this.replyInbound(entry, msg, notice);
      this.markWatermark(entry, msg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      entry.status = {
        ...entry.status,
        lastDeliveryError: { at: this.nowIso(), stage: "inbound", detail },
      };
      this.recordError(
        entry,
        entry.chats.get(msg.chatId)?.sessionId ?? null,
        err,
        "chat_bot_inbound_failed",
      );
    }
  }

  private isRedelivery(entry: BotEntry, msg: MessagingInboundMessage): boolean {
    if (msg.messageId === "") return false;
    if (entry.recent.includes(msg.messageId)) return true;
    entry.recent.push(msg.messageId);
    if (entry.recent.length > RECENT_IDS) entry.recent.shift();
    return false;
  }

  /** Records the chat's last finished message, so a replay after a restart is a no-op. */
  private markWatermark(entry: BotEntry, msg: MessagingInboundMessage): void {
    const chats = this.storedChatsOf(entry);
    const stored = chats.get(msg.chatId);
    if (stored === undefined || msg.messageId === "") return;
    stored.lastMessageId = msg.messageId;
    this.writeChats(entry, chats);
  }

  /** A new Session for a chat that has none, stored before anything can go wrong with it. */
  private async openChat(
    entry: BotEntry,
    projectId: string,
    agentId: string,
    chatId: string,
    isDirect: boolean,
  ): Promise<ChatState> {
    const { sessionId } = await this.deps.sessionCreator.createSession({ projectId, agentId });
    const stored: StoredChat = { sessionId, isDirect, lastMessageId: null };
    const chats = this.storedChatsOf(entry);
    chats.set(chatId, stored);
    this.writeChats(entry, chats);
    this.log(`[chat-bot] ${entry.id}: chat ${chatId} → session ${sessionId}`);
    return this.watch(entry, chatId, stored);
  }

  /** Forgets a chat's Session (the Session itself stays; `/new` is not a delete). */
  private forgetChat(entry: BotEntry, chat: ChatState): void {
    chat.unsubscribe();
    entry.chats.delete(chat.chatId);
    const chats = this.storedChatsOf(entry);
    chats.delete(chat.chatId);
    this.writeChats(entry, chats);
  }

  /** Subscribes to a chat's Session, so its replies reach the chat. */
  private watch(entry: BotEntry, chatId: string, stored: StoredChat): ChatState {
    const existing = entry.chats.get(chatId);
    if (existing !== undefined) return existing;
    if (stored.lastMessageId !== null) {
      entry.recent.push(stored.lastMessageId);
      if (entry.recent.length > RECENT_IDS) entry.recent.shift();
    }
    const chat: ChatState = {
      chatId,
      isDirect: stored.isDirect,
      sessionId: stored.sessionId,
      lastInboundMessageId: null,
      threadedThisRun: false,
      active: "idle",
      inCompaction: false,
      pendingApprovals: [],
      sendChain: Promise.resolve(),
      unsubscribe: () => {},
    };
    chat.unsubscribe = this.deps.channels
      .get(stored.sessionId)
      .subscribe((evt) => this.observe(entry, chat, evt));
    entry.chats.set(chatId, chat);
    return chat;
  }

  /**
   * One message into one Task, or the notice to answer with when it could not be made
   * whole (an image or a file that could not be delivered stops the whole message — the
   * bridge's rule, for the bridge's reason).
   */
  private async startTask(
    entry: BotEntry,
    chat: ChatState,
    text: string | null,
    images: readonly MessagingInboundImage[],
    files: readonly MessagingInboundFile[],
  ): Promise<string | null> {
    const parts = await this.imageParts(entry, chat, images);
    if ("notice" in parts) return parts.notice;
    const attachments = await this.fileAttachments(entry, chat, files);
    if ("notice" in attachments) return attachments.notice;
    const input: OmniMessage[] = [...(text === null ? [] : [userText(text)]), ...parts.parts];
    let withFiles = input;
    let written: string[] = [];
    if (attachments.attachments.length > 0) {
      const row = this.deps.sessionIndex.findById(chat.sessionId);
      if (row === null) throw new Error(`session ${chat.sessionId} no longer exists`);
      const landed = await attachFilesToInput(
        input,
        attachments.attachments,
        scratchpadDir(this.deps.root, row.projectId, row.agentId),
        chat.sessionId,
      );
      withFiles = landed.input;
      written = landed.written;
    }
    try {
      // An ordinary user input, exactly as if typed into the web composer: the model does
      // not learn the message arrived through a chat.
      await this.deps.runner.startTask(chat.sessionId, withFiles, { queueIfBusy: true });
    } catch (err) {
      await removeAttachments(written);
      throw err;
    }
    return null;
  }

  private async imageParts(
    entry: BotEntry,
    chat: ChatState,
    images: readonly MessagingInboundImage[],
  ): Promise<{ parts: OmniMessage[] } | { notice: string }> {
    const parts: OmniMessage[] = [];
    for (const image of images) {
      try {
        const { data, mimeType } = await image.fetch(INLINE_IMAGE_MAX_BYTES);
        parts.push(imageUrlMessage(`data:${mimeType};base64,${data.toString("base64")}`));
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (err instanceof MessagingMediaTooLargeError)
          return { notice: messagingImageTooLargeNotice() };
        this.recordError(entry, chat.sessionId, err, "messaging_image_fetch_failed");
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

  private async fileAttachments(
    entry: BotEntry,
    chat: ChatState,
    files: readonly MessagingInboundFile[],
  ): Promise<{ attachments: TaskAttachment[] } | { notice: string }> {
    if (files.length === 0) return { attachments: [] };
    const limits: AttachmentLimits = toAttachmentLimits(this.deps.settings.getAttachmentLimitsMb());
    const attachments: TaskAttachment[] = [];
    let spent = 0;
    for (const file of files) {
      const remaining = limits.totalBytes - spent;
      if (remaining <= 0) return { notice: messagingInboundFilesTooLargeNotice(limits.totalBytes) };
      const cap = Math.min(limits.maxBytes, remaining);
      try {
        const data = await file.fetch(cap);
        spent += data.length;
        attachments.push({ fileName: file.fileName, bytes: data, mime: "" });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (err instanceof MessagingMediaTooLargeError) {
          const spentTheMessage = err.maxBytes === remaining && remaining < limits.maxBytes;
          return {
            notice: spentTheMessage
              ? messagingInboundFilesTooLargeNotice(limits.totalBytes)
              : messagingInboundFileTooLargeNotice(file.fileName, err.maxBytes),
          };
        }
        this.recordError(entry, chat.sessionId, err, "messaging_file_fetch_failed");
        return {
          notice:
            err instanceof MessagingPermissionError
              ? messagingInboundFilePermissionNotice(file.fileName, err.scopes, err.grantUrl)
              : messagingInboundFileFailedNotice(file.fileName, reason),
        };
      }
    }
    return { attachments };
  }

  /** `/approve` or `/deny`: decides the oldest waiting tool call of the chat's Session. */
  private async decide(
    entry: BotEntry,
    msg: MessagingInboundMessage,
    chat: ChatState | null,
    verb: "approve" | "deny",
  ): Promise<void> {
    const toolCallId = chat?.pendingApprovals.shift();
    if (chat === null || toolCallId === undefined) {
      await this.replyInbound(entry, msg, CHAT_BOT_NOTHING_PENDING_NOTICE);
      return;
    }
    const decided = this.deps.sessions.decideApproval(
      chat.sessionId,
      toolCallId,
      verb === "approve" ? "allow" : "deny",
    );
    if (!decided) await this.replyInbound(entry, msg, CHAT_BOT_NOTHING_PENDING_NOTICE);
    this.markWatermark(entry, msg);
  }

  private statusText(entry: BotEntry, chat: ChatState | null): string {
    if (chat === null) return "No conversation in this chat yet. 这个聊天还没有对话。";
    return `Session ${chat.sessionId} (${chat.active}), ${chat.pendingApprovals.length} approval(s) waiting.`;
  }

  /** Answers the inbound message itself: threaded in a group, plain in a direct chat. */
  private async replyInbound(
    entry: BotEntry,
    msg: MessagingInboundMessage,
    text: string,
  ): Promise<void> {
    const client = entry.client;
    if (client === null) return;
    try {
      if (msg.chatKind === "group" && msg.messageId !== "")
        await client.replyText(msg.messageId, text);
      else await client.sendText(msg.chatId, text);
    } catch (err) {
      this.noteSendFailure(entry, entry.chats.get(msg.chatId)?.sessionId ?? null, err);
    }
  }

  // —— Outbound ———————————————————————————————————————————————————————————————

  private observe(entry: BotEntry, chat: ChatState, evt: ChannelEvent): void {
    if (entry.chats.get(chat.chatId) !== chat) return;
    let data: unknown;
    try {
      data = JSON.parse(evt.data);
    } catch {
      return;
    }
    if (evt.event === "server_event") {
      const event = data as { type?: string; state?: string; toolCall?: { toolCallId?: string } };
      if (event.type === "task_state" && typeof event.state === "string") {
        if (event.state === "running" && chat.active !== "running") chat.threadedThisRun = false;
        chat.active = event.state;
        if (event.state === "idle") chat.pendingApprovals = [];
      } else if (event.type === "approval_request") {
        const id = event.toolCall?.toolCallId;
        if (typeof id === "string" && !chat.pendingApprovals.includes(id)) {
          chat.pendingApprovals.push(id);
        }
        chat.sendChain = chat.sendChain.then(() =>
          this.deliver(entry, chat, CHAT_BOT_APPROVAL_NOTICE, false),
        );
      }
      return;
    }
    const msg = data as OmniMessage;
    if (msg.origin !== undefined && msg.origin.length > 0) return;
    const payload = msg.payload as { type?: string; role?: string; text?: string };
    if (msg.type === "event_msg") {
      if (payload.type === "compaction_begin") chat.inCompaction = true;
      else if (payload.type === "compaction_end") chat.inCompaction = false;
      return;
    }
    if (msg.type !== "model_msg" || chat.inCompaction) return;
    if (payload.type === "text" && payload.role === "assistant" && payload.text !== undefined) {
      const body = payload.text.trim();
      if (body === "") return;
      chat.sendChain = chat.sendChain.then(() => this.deliver(entry, chat, body, true));
    }
  }

  /**
   * One reply into the chat, chunked under the channel's cap; the run's first message in a
   * group threads onto the inbound one. Never throws — the chain behind it must keep moving.
   */
  private async deliver(
    entry: BotEntry,
    chat: ChatState,
    text: string,
    markdown: boolean,
  ): Promise<void> {
    const client = entry.client;
    const connector = entry.connector;
    if (client === null || connector === null) return;
    const cap = Math.min(
      MESSAGING_TEXT_CHUNK_CHARS,
      connector.textChunkChars ?? MESSAGING_TEXT_CHUNK_CHARS,
    );
    const chunks = markdown ? chunkMarkdown(text, cap) : chunkMessagingText(text, cap);
    for (const chunk of chunks) {
      const threadOnto =
        !chat.isDirect && chat.lastInboundMessageId !== null && !chat.threadedThisRun
          ? chat.lastInboundMessageId
          : null;
      try {
        if (threadOnto !== null) {
          await client.replyText(threadOnto, chunk, { markdown });
          chat.threadedThisRun = true;
        } else {
          await client.sendText(chat.chatId, chunk, { markdown });
        }
      } catch (err) {
        this.noteSendFailure(entry, chat.sessionId, err);
      }
    }
  }

  // —— Bookkeeping ————————————————————————————————————————————————————————————

  private entryOf(id: string): BotEntry {
    const entry = this.bots.get(id);
    if (entry === undefined) throw new HttpError(404, "chat_bot_not_found", "No such chat bot.");
    return entry;
  }

  private storedOf(entry: BotEntry): StoredBot {
    const raw = this.deps.settings.get(`chatbot:${entry.id}`);
    if (raw !== null) {
      try {
        const doc = JSON.parse(raw) as Partial<StoredBot>;
        return {
          config: doc.config !== null && typeof doc.config === "object" ? doc.config : {},
          projectId: typeof doc.projectId === "string" ? doc.projectId : null,
          agentId: typeof doc.agentId === "string" ? doc.agentId : null,
          enabled: doc.enabled === true,
        };
      } catch {
        // A document this build cannot read is treated as absent: the seed applies again.
      }
    }
    const d = entry.defaults;
    return {
      config: d.config ?? {},
      projectId: d.projectId ?? null,
      agentId: d.agentId ?? null,
      enabled: d.enabled === true && d.config !== undefined,
    };
  }

  private writeStored(entry: BotEntry, stored: StoredBot): void {
    this.deps.settings.set(`chatbot:${entry.id}`, JSON.stringify(stored));
  }

  private storedChatsOf(entry: BotEntry): Map<string, StoredChat> {
    const raw = this.deps.settings.get(`chatbot:${entry.id}:chats`);
    const out = new Map<string, StoredChat>();
    if (raw === null) return out;
    try {
      const doc = JSON.parse(raw) as Record<string, Partial<StoredChat>>;
      for (const [chatId, chat] of Object.entries(doc)) {
        if (typeof chat.sessionId !== "string") continue;
        // A Session deleted in the Web App releases its chat: the next message opens a new one.
        if (this.deps.sessionIndex.findById(chat.sessionId) === null) continue;
        out.set(chatId, {
          sessionId: chat.sessionId,
          isDirect: chat.isDirect === true,
          lastMessageId: typeof chat.lastMessageId === "string" ? chat.lastMessageId : null,
        });
      }
    } catch {
      // Unreadable: start from no chats rather than refuse to run.
    }
    return out;
  }

  private writeChats(entry: BotEntry, chats: Map<string, StoredChat>): void {
    this.deps.settings.set(`chatbot:${entry.id}:chats`, JSON.stringify(Object.fromEntries(chats)));
  }

  private noteSendFailure(entry: BotEntry, sessionId: string | null, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    entry.status = {
      ...entry.status,
      lastDeliveryError: { at: this.nowIso(), stage: "send", detail },
    };
    this.recordError(entry, sessionId, err, "chat_bot_send_failed");
  }

  private recordError(entry: BotEntry, sessionId: string | null, err: unknown, code: string): void {
    const stored = this.storedOf(entry);
    this.deps.errors.record({
      source: "messaging",
      err,
      code,
      kind: messagingErrorKind(err, code),
      ctx: {
        ...(sessionId !== null ? { sessionId } : {}),
        ...(stored.projectId !== null ? { projectId: stored.projectId } : {}),
        ...(stored.agentId !== null ? { agentId: stored.agentId } : {}),
      },
    });
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}

/** A stored credential document as it may leave the server: every string masked. */
function maskConfig(config: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === "string" && value !== "") out[key] = maskApiKey(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Routes (/api/chat-bots, admin only)
// ---------------------------------------------------------------------------

export function chatBotRoutes(host: ChatBotHost): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const idOf = (c: Context<AppEnv>): string => c.req.param("id") ?? "";
  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can configure chat bots.");
    }
    await next();
  });
  app.get("/", (c) => c.json({ bots: host.list() } satisfies ChatBotsResponse));
  app.get("/:id", (c) => c.json(host.info(idOf(c))));
  app.put("/:id", async (c) => {
    const body = await readJson(c);
    const rawConfig = (body as { config?: unknown }).config;
    if (rawConfig !== undefined && (rawConfig === null || typeof rawConfig !== "object")) {
      throw badRequest("config must be an object.");
    }
    return c.json(
      await host.save(idOf(c), {
        ...(rawConfig !== undefined ? { config: rawConfig as Record<string, unknown> } : {}),
        ...(optionalString(body, "projectId", { maxLen: 200 }) !== undefined
          ? { projectId: optionalString(body, "projectId", { maxLen: 200 })! }
          : {}),
        ...(optionalString(body, "agentId", { maxLen: 200 }) !== undefined
          ? { agentId: optionalString(body, "agentId", { maxLen: 200 })! }
          : {}),
      }),
    );
  });
  app.post("/:id/state", async (c) => {
    const body = await readJson(c);
    const enabled = (body as { enabled?: unknown }).enabled;
    if (typeof enabled !== "boolean") throw badRequest("enabled must be a boolean.");
    return c.json(await host.setEnabled(idOf(c), enabled));
  });
  app.post("/:id/test", async (c: Context<AppEnv>) => {
    const body = await readJson(c);
    const rawConfig = (body as { config?: unknown }).config;
    const draft =
      rawConfig !== null && typeof rawConfig === "object"
        ? (rawConfig as Record<string, unknown>)
        : undefined;
    return c.json(await host.test(idOf(c), draft));
  });
  return app;
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

/** The chat-bot host: registration, configuration, status. */
export abstract class ChatBots extends Interface<
  Pick<
    ChatBotHost,
    "register" | "list" | "info" | "save" | "setEnabled" | "test" | "statusOf" | "sync"
  >
>() {}

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "chat-bots.routes",
        prefix: "/api/chat-bots",
        auth: "user",
        order: 285,
      },
    ],
  },
})
export class ChatBotsModule {
  @Use() private readonly paths!: Paths;
  @Use() private readonly channels!: Channels;
  @Use() private readonly clock!: Clock;
  @Use() private readonly log!: Log;
  @Use() private readonly settings!: Settings;
  @Use() private readonly messaging!: Messaging;
  @Use() private readonly runner!: MessagingTaskRunner;
  @Use() private readonly sessions!: Sessions;
  @Use() private readonly sessionCreator!: ScheduleSessionCreator;
  @Use() private readonly sessionIndex!: SessionIndex;
  @Use() private readonly agents!: AgentIndex;
  @Use() private readonly errors!: Errors;
  @Provide() chatBots!: ChatBots;
  @Bind("chat-bots.routes") routes!: Hono<AppEnv>;
  async setup({ contributions, effect }: ClassCtx) {
    const host = new ChatBotHost({
      settings: this.settings,
      connectorFor: (channel) => this.messaging.connectorFor(channel),
      channels: this.channels as ChannelHub,
      runner: this.runner,
      sessions: this.sessions,
      sessionCreator: this.sessionCreator,
      sessionIndex: this.sessionIndex,
      agents: this.agents,
      errors: this.errors,
      root: this.paths.root,
      log: (line) => this.log.line(line),
      now: () => this.clock.now().getTime(),
    });
    for (const c of contributions.bots ?? []) {
      host.register(
        c.id,
        c.data as unknown as ChatBotContribution,
        (c.code ?? {}) as ChatBotBinding,
      );
    }
    await host.start();
    effect(() => host.stop());
    this.chatBots = host;
    this.routes = chatBotRoutes(host);
  }
}
