/**
 * The bot itself: one Discord account that starts agents from chat.
 *
 * Everything here is the plugin's own. The harness lends it the pieces it already has —
 * the Discord messaging connector (credential shape, Gateway, sends, Markdown, the 2000
 * cap), Session creation, the task runner, the Session event channel, the settings store —
 * and this file composes them into a bot: ONE Gateway connection on the bot's token, a
 * Session per chat (a direct message, a channel the bot is @-mentioned in, a thread) opened
 * on the first message and reused for the rest, replies relayed back into the same chat,
 * and a few slash-style commands (`/new`, `/approve`, `/deny`, `/status`).
 *
 * Configuration — the token, the target Project and Agent, the enabled flag — and the
 * chat → Session table live in the server settings store under `discord-bot:` keys, so both
 * survive a restart and a hot swap. A seed read from the environment applies where nothing
 * is stored yet (see index.ts); what an administrator saved wins, and a bot switched off
 * stays off.
 *
 * What the per-Session messaging binding has and this does not: delivery preferences, the
 * files a reply names sent after it, a rolling image budget. The per-image ceiling and the
 * per-message file caps still hold.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import {
  attachedFileLine,
  imageUrlMessage,
  modelVisiblePath,
  scratchpadDir,
  userText,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  AgentIndex,
  ChannelEvent,
  Channels,
  Errors,
  Log,
  Messaging,
  MessagingChannelConnector,
  MessagingClient,
  MessagingConnection,
  MessagingInboundFile,
  MessagingInboundImage,
  MessagingInboundMessage,
  MessagingTaskRunner,
  Paths,
  ScheduleSessionCreator,
  SessionIndex,
  Sessions,
  Settings,
} from "@prismshadow/penguin-server/plugin";

/** The settings-store keys this bot owns. */
export const CONFIG_KEY = "discord-bot:config";
export const CHATS_KEY = "discord-bot:chats";

/**
 * Where a reply is cut before it reaches the connector. Discord caps a message at 2000
 * characters and the connector renders Markdown on top of the text, adding escapes, so the
 * cut leaves room; a rendered piece that still overflows is sent plainly by the connector
 * rather than lost.
 */
export const REPLY_CHUNK_CHARS = 1900;

/** The largest inbound picture, in bytes — the server's own inline-image ceiling. */
const INLINE_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

/** The commands a chat may write instead of a message to the Agent. */
const COMMAND = /^[/!](new|approve|deny|status)\b\s*/i;

const RECENT_IDS = 64;

/** The notices the chat hears from the bot itself (bilingual, like the harness's own). */
export const NEW_NOTICE = "Started a new conversation. 已开始新的对话。";
export const APPROVAL_NOTICE =
  "A tool call is waiting for approval: reply /approve to allow it or /deny to refuse. 有工具调用等待审批：回复 /approve 允许，或 /deny 拒绝。";
export const NOTHING_PENDING_NOTICE =
  "Nothing is waiting for approval. 当前没有等待审批的工具调用。";
export const NOT_CONFIGURED_NOTICE =
  "This bot has no target Agent yet: an administrator has to finish its setup. 这个机器人尚未配置目标 Agent，请管理员完成设置。";
export const UNSUPPORTED_NOTICE =
  "Only text, pictures and files can be read here. 这里只能读取文本、图片与文件。";
export const IMAGE_FAILED_NOTICE = (reason: string): string =>
  `The picture could not be downloaded (${reason}), so the message was not run. 图片下载失败（${reason}），消息未执行。`;
export const FILE_FAILED_NOTICE = (fileName: string, reason: string): string =>
  `"${fileName}" could not be downloaded (${reason}), so the message was not run. 文件「${fileName}」下载失败（${reason}），消息未执行。`;

/** What is stored under CONFIG_KEY. */
export interface StoredConfig {
  botToken: string | null;
  projectId: string | null;
  agentId: string | null;
  enabled: boolean;
}

/** One chat's Session, stored under CHATS_KEY. */
interface StoredChat {
  sessionId: string;
  isDirect: boolean;
  /** The last inbound message this chat finished with — the redelivery watermark. */
  lastMessageId: string | null;
}

/** What the environment (or a test) may seed the bot with; a stored config wins. */
export interface BotDefaults {
  botToken?: string;
  projectId?: string;
  agentId?: string;
  enabled?: boolean;
}

export interface BotStatus {
  state: "disconnected" | "connecting" | "connected" | "error";
  lastError?: string;
  changedAt?: string;
  lastInboundAt?: string;
  lastDeliveryError?: { at: string; stage: "inbound" | "send"; detail: string };
}

/** The bot as the settings API reads it: token masked, plus its live status. */
export interface BotInfo {
  configured: boolean;
  botTokenMasked?: string;
  projectId: string | null;
  agentId: string | null;
  enabled: boolean;
  status: BotStatus;
  /** How many chats currently hold a Session. */
  chats: number;
}

/** A refusal the routes answer with, carrying the status and code a client branches on. */
export class BotError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BotError";
  }
}

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

/** Everything the bot is built over — the harness's mechanisms, as the module requires them. */
export interface BotDeps {
  messaging: Pick<Messaging, "connectorFor">;
  runner: Pick<MessagingTaskRunner, "startTask">;
  sessions: Pick<Sessions, "decideApproval">;
  sessionCreator: Pick<ScheduleSessionCreator, "createSession">;
  sessionIndex: Pick<SessionIndex, "findById">;
  agents: Pick<AgentIndex, "exists">;
  settings: Pick<Settings, "get" | "set" | "getAttachmentLimitsMb">;
  channels: Pick<Channels, "get">;
  errors: Pick<Errors, "record">;
  paths: Pick<Paths, "root">;
  log: Pick<Log, "line">;
  defaults?: BotDefaults;
  now?: () => number;
}

export class DiscordBot {
  private connector: MessagingChannelConnector | null = null;
  private client: MessagingClient | null = null;
  private connection: MessagingConnection | null = null;
  private status: BotStatus = { state: "disconnected" };
  private readonly chats = new Map<string, ChatState>();
  /** Recent inbound message ids: the channel redelivers, and nothing downstream is idempotent. */
  private readonly recent: string[] = [];
  /** A connect superseded by a later one (a save, a toggle) must not report into the newer state. */
  private generation = 0;
  private started = false;
  private readonly now: () => number;

  constructor(private readonly deps: BotDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  // —— Configuration ——————————————————————————————————————————————————————————

  info(): BotInfo {
    const stored = this.stored();
    return {
      configured: stored.botToken !== null,
      ...(stored.botToken !== null ? { botTokenMasked: mask(stored.botToken) } : {}),
      projectId: stored.projectId,
      agentId: stored.agentId,
      enabled: stored.enabled,
      status: this.status,
      chats: this.storedChats().size,
    };
  }

  /**
   * Saves the token and the target. A save never flips the connection — except that an
   * ENABLED bot restarts on the new values, so what is stored and what is live never diverge.
   */
  async save(patch: {
    botToken?: string;
    clearBotToken?: boolean;
    projectId?: string;
    agentId?: string;
  }): Promise<BotInfo> {
    const stored = this.stored();
    if (patch.projectId !== undefined || patch.agentId !== undefined) {
      const projectId = patch.projectId ?? stored.projectId;
      const agentId = patch.agentId ?? stored.agentId;
      if (projectId === null || agentId === null) {
        throw new BotError(400, "bad_request", "projectId and agentId must be given together.");
      }
      if (!this.deps.agents.exists(projectId, agentId)) {
        throw new BotError(404, "agent_not_found", "Agent does not exist.");
      }
      stored.projectId = projectId;
      stored.agentId = agentId;
    }
    const typed = patch.botToken?.trim();
    if (typed !== undefined && typed !== "" && typed !== mask(stored.botToken ?? "")) {
      // Refused here rather than at the next connect: the token's first segment must decode
      // to the bot's user id (see botIdOf), and the connector must read the document.
      if (botIdOf(typed) === null) {
        throw new BotError(
          400,
          "discord_token_invalid",
          "botToken must be a Discord bot token as issued in the developer portal (three dot-separated segments, the first naming the bot).",
        );
      }
      try {
        await this.deps.messaging.connectorFor("discord").createClient({ botToken: typed });
      } catch (err) {
        throw new BotError(
          400,
          "discord_token_invalid",
          err instanceof Error ? err.message : String(err),
        );
      }
      stored.botToken = typed;
    } else if (patch.clearBotToken === true) {
      if (stored.enabled) {
        throw new BotError(
          409,
          "disable_before_clear",
          "Disable the bot before clearing its token.",
        );
      }
      stored.botToken = null;
    }
    this.writeStored(stored);
    if (stored.enabled) await this.sync();
    return this.info();
  }

  /** The connection toggle: enabling connects on the stored values, disabling closes. */
  async setEnabled(enabled: boolean): Promise<BotInfo> {
    const stored = this.stored();
    if (enabled && stored.botToken === null) {
      throw new BotError(400, "discord_token_required", "Save the bot token first.");
    }
    if (enabled && (stored.projectId === null || stored.agentId === null)) {
      throw new BotError(400, "target_required", "Choose the Project and Agent first.");
    }
    stored.enabled = enabled;
    this.writeStored(stored);
    await this.sync();
    return this.info();
  }

  /** Credential probe on a draft token, or the stored one. */
  async test(
    botToken?: string,
  ): Promise<{ ok: boolean; latencyMs?: number; botUsername?: string; error?: string }> {
    const token = botToken?.trim() || this.stored().botToken;
    if (token === null || token === undefined || token === "") {
      throw new BotError(400, "discord_token_required", "botToken is required to test.");
    }
    const startedAt = this.now();
    try {
      const client = await this.deps.messaging
        .connectorFor("discord")
        .createClient({ botToken: token });
      const account = await client.checkCredentials();
      return {
        ok: true,
        latencyMs: this.now() - startedAt,
        ...(account?.accountLabel !== undefined ? { botUsername: account.accountLabel } : {}),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  statusOf(): BotStatus {
    return this.status;
  }

  // —— Lifecycle ——————————————————————————————————————————————————————————————

  async start(): Promise<void> {
    this.started = true;
    await this.sync();
  }

  stop(): void {
    this.started = false;
    this.disconnect();
  }

  /** Brings the live state in line with the stored intent. */
  async sync(): Promise<void> {
    this.disconnect();
    const stored = this.stored();
    if (!this.started || !stored.enabled || stored.botToken === null) return;
    const generation = ++this.generation;
    const config = { botToken: stored.botToken };
    this.status = { state: "connecting", changedAt: this.nowIso() };
    try {
      const connector = this.deps.messaging.connectorFor("discord");
      this.connector = connector;
      this.client = await connector.createClient(config);
      // Every chat known from before this connection is watched again: its Session may still
      // be running, and a reply completing after a restart belongs in that chat.
      for (const [chatId, chat] of this.storedChats()) this.watch(chatId, chat);
      const connection = await connector.connect(config, {
        onMessage: (msg) => this.onInbound(generation, msg),
        onReady: () => {
          if (this.generation !== generation) return;
          const { lastError: _dropped, ...rest } = this.status;
          this.status = { ...rest, state: "connected", changedAt: this.nowIso() };
        },
        onError: (err) => {
          if (this.generation !== generation) return;
          const detail = err instanceof Error ? err.message : String(err);
          this.status = {
            ...this.status,
            state: "error",
            lastError: detail,
            changedAt: this.nowIso(),
          };
          this.recordError(null, err, "discord_bot_connect_failed");
        },
      });
      if (this.generation !== generation) {
        connection.close();
        return;
      }
      this.connection = connection;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.status = { state: "error", lastError: detail, changedAt: this.nowIso() };
      this.recordError(null, err, "discord_bot_connect_failed");
    }
  }

  private disconnect(): void {
    this.generation += 1;
    try {
      this.connection?.close();
    } catch (err) {
      this.deps.log.line(
        `[discord-bot] close failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.connection = null;
    this.client = null;
    this.connector = null;
    for (const chat of this.chats.values()) chat.unsubscribe();
    this.chats.clear();
    this.status = { state: "disconnected", changedAt: this.nowIso() };
  }

  // —— Inbound ————————————————————————————————————————————————————————————————

  private async onInbound(generation: number, msg: MessagingInboundMessage): Promise<void> {
    if (this.generation !== generation) return;
    if (this.isRedelivery(msg)) return;
    this.status = { ...this.status, lastInboundAt: this.nowIso() };
    try {
      const stored = this.stored();
      if (stored.projectId === null || stored.agentId === null) {
        await this.replyInbound(msg, NOT_CONFIGURED_NOTICE);
        return;
      }
      const isDirect = msg.chatKind === "direct";
      let text = msg.text !== null && msg.text.trim() !== "" ? msg.text.trim() : null;
      const command = text !== null ? COMMAND.exec(text) : null;
      const verb = command?.[1]?.toLowerCase();
      if (command !== null && command !== undefined) {
        text = text!.slice(command[0].length).trim() || null;
      }
      let chat = this.chats.get(msg.chatId) ?? null;
      if (verb === "new" && chat !== null) {
        this.forgetChat(chat);
        chat = null;
      }
      if (verb === "approve" || verb === "deny") {
        await this.decide(msg, chat, verb);
        return;
      }
      if (verb === "status") {
        await this.replyInbound(msg, this.statusText(chat));
        return;
      }
      const images = msg.images ?? [];
      const files = msg.files ?? [];
      if (text === null && images.length === 0 && files.length === 0) {
        await this.replyInbound(msg, verb === "new" ? NEW_NOTICE : UNSUPPORTED_NOTICE);
        if (verb === "new") this.markWatermark(msg);
        return;
      }
      if (chat === null)
        chat = await this.openChat(stored.projectId, stored.agentId, msg.chatId, isDirect);
      chat.lastInboundMessageId = isDirect ? null : msg.messageId;
      const notice = await this.startTask(chat, stored, text, images, files);
      if (notice !== null) await this.replyInbound(msg, notice);
      this.markWatermark(msg);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.status = {
        ...this.status,
        lastDeliveryError: { at: this.nowIso(), stage: "inbound", detail },
      };
      this.recordError(
        this.chats.get(msg.chatId)?.sessionId ?? null,
        err,
        "discord_bot_inbound_failed",
      );
    }
  }

  private isRedelivery(msg: MessagingInboundMessage): boolean {
    if (msg.messageId === "") return false;
    if (this.recent.includes(msg.messageId)) return true;
    this.remember(msg.messageId);
    return false;
  }

  private remember(messageId: string): void {
    this.recent.push(messageId);
    if (this.recent.length > RECENT_IDS) this.recent.shift();
  }

  /** Records the chat's last finished message, so a replay after a restart is a no-op. */
  private markWatermark(msg: MessagingInboundMessage): void {
    const chats = this.storedChats();
    const stored = chats.get(msg.chatId);
    if (stored === undefined || msg.messageId === "") return;
    stored.lastMessageId = msg.messageId;
    this.writeChats(chats);
  }

  /** A new Session for a chat that has none, stored before anything can go wrong with it. */
  private async openChat(
    projectId: string,
    agentId: string,
    chatId: string,
    isDirect: boolean,
  ): Promise<ChatState> {
    const { sessionId } = await this.deps.sessionCreator.createSession({ projectId, agentId });
    const stored: StoredChat = { sessionId, isDirect, lastMessageId: null };
    const chats = this.storedChats();
    chats.set(chatId, stored);
    this.writeChats(chats);
    this.deps.log.line(`[discord-bot] chat ${chatId} → session ${sessionId}`);
    return this.watch(chatId, stored);
  }

  /** Forgets a chat's Session (the Session itself stays; `/new` is not a delete). */
  private forgetChat(chat: ChatState): void {
    chat.unsubscribe();
    this.chats.delete(chat.chatId);
    const chats = this.storedChats();
    chats.delete(chat.chatId);
    this.writeChats(chats);
  }

  /** Subscribes to a chat's Session, so its replies reach the chat. */
  private watch(chatId: string, stored: StoredChat): ChatState {
    const existing = this.chats.get(chatId);
    if (existing !== undefined) return existing;
    if (stored.lastMessageId !== null) this.remember(stored.lastMessageId);
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
      .subscribe((evt: ChannelEvent) => this.observe(chat, evt));
    this.chats.set(chatId, chat);
    return chat;
  }

  /**
   * One message into one Task, or the notice to answer with when it could not be made whole:
   * a picture or a file that could not be delivered stops the whole message, since a model
   * asked about an attachment it never received answers confidently about nothing.
   */
  private async startTask(
    chat: ChatState,
    stored: StoredConfig,
    text: string | null,
    images: readonly MessagingInboundImage[],
    files: readonly MessagingInboundFile[],
  ): Promise<string | null> {
    const parts: OmniMessage[] = [];
    for (const image of images) {
      try {
        const { data, mimeType } = await image.fetch(INLINE_IMAGE_MAX_BYTES);
        parts.push(imageUrlMessage(`data:${mimeType};base64,${data.toString("base64")}`));
      } catch (err) {
        return IMAGE_FAILED_NOTICE(err instanceof Error ? err.message : String(err));
      }
    }
    const written: string[] = [];
    if (files.length > 0) {
      const limits = this.deps.settings.getAttachmentLimitsMb();
      const maxBytes = limits.attachmentMaxMb * 1024 * 1024;
      let remaining = limits.attachmentTotalMb * 1024 * 1024;
      const dir = path.join(
        scratchpadDir(this.deps.paths.root, stored.projectId!, stored.agentId!),
        chat.sessionId,
      );
      for (const file of files) {
        try {
          const data = await file.fetch(Math.min(maxBytes, Math.max(remaining, 0)));
          remaining -= data.length;
          written.push(await writeAttachment(dir, file.fileName, data));
        } catch (err) {
          await Promise.all(written.map((p) => fsp.rm(p, { force: true })));
          return FILE_FAILED_NOTICE(
            file.fileName,
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
    // The composer's shape: the text (with the file lines under it), then the pictures.
    const lines = written.map((p) => attachedFileLine(modelVisiblePath(p)));
    const body = [text, ...lines].filter((s): s is string => s !== null && s !== "").join("\n\n");
    const input: OmniMessage[] = [...(body === "" ? [] : [userText(body)]), ...parts];
    try {
      await this.deps.runner.startTask(chat.sessionId, input, { queueIfBusy: true });
    } catch (err) {
      await Promise.all(written.map((p) => fsp.rm(p, { force: true })));
      throw err;
    }
    return null;
  }

  /** `/approve` or `/deny`: decides the oldest waiting tool call of the chat's Session. */
  private async decide(
    msg: MessagingInboundMessage,
    chat: ChatState | null,
    verb: "approve" | "deny",
  ): Promise<void> {
    const toolCallId = chat?.pendingApprovals.shift();
    if (chat === null || toolCallId === undefined) {
      await this.replyInbound(msg, NOTHING_PENDING_NOTICE);
      return;
    }
    const decided = this.deps.sessions.decideApproval(
      chat.sessionId,
      toolCallId,
      verb === "approve" ? "allow" : "deny",
    );
    if (!decided) await this.replyInbound(msg, NOTHING_PENDING_NOTICE);
    this.markWatermark(msg);
  }

  private statusText(chat: ChatState | null): string {
    if (chat === null) return "No conversation in this chat yet. 这个聊天还没有对话。";
    return `Session ${chat.sessionId} (${chat.active}), ${chat.pendingApprovals.length} approval(s) waiting.`;
  }

  /** Answers the inbound message itself: threaded in a server channel, plain in a direct chat. */
  private async replyInbound(msg: MessagingInboundMessage, text: string): Promise<void> {
    const client = this.client;
    if (client === null) return;
    try {
      if (msg.chatKind === "group" && msg.messageId !== "")
        await client.replyText(msg.messageId, text);
      else await client.sendText(msg.chatId, text);
    } catch (err) {
      this.noteSendFailure(this.chats.get(msg.chatId)?.sessionId ?? null, err);
    }
  }

  // —— Outbound ———————————————————————————————————————————————————————————————

  private observe(chat: ChatState, evt: ChannelEvent): void {
    if (this.chats.get(chat.chatId) !== chat) return;
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
        if (typeof id === "string" && !chat.pendingApprovals.includes(id))
          chat.pendingApprovals.push(id);
        chat.sendChain = chat.sendChain.then(() => this.deliver(chat, APPROVAL_NOTICE, false));
      }
      return;
    }
    const msg = data as OmniMessage;
    if (msg.origin !== undefined && msg.origin.length > 0) return; // subagent output is not the reply
    const payload = msg.payload as { type?: string; role?: string; text?: string };
    if (msg.type === "event_msg") {
      if (payload.type === "compaction_begin") chat.inCompaction = true;
      else if (payload.type === "compaction_end") chat.inCompaction = false;
      return;
    }
    if (msg.type !== "model_msg" || chat.inCompaction) return;
    // Completed assistant text only: partials, thinking and tool traffic never mirror.
    if (payload.type === "text" && payload.role === "assistant" && payload.text !== undefined) {
      const body = payload.text.trim();
      if (body === "") return;
      chat.sendChain = chat.sendChain.then(() => this.deliver(chat, body, true));
    }
  }

  /**
   * One reply into the chat, cut under the channel's cap; the run's first message in a
   * server channel threads onto the inbound one. Never throws — the chain behind it must keep
   * moving.
   */
  private async deliver(chat: ChatState, text: string, markdown: boolean): Promise<void> {
    const client = this.client;
    if (client === null) return;
    for (const chunk of chunkReply(text, REPLY_CHUNK_CHARS)) {
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
        this.noteSendFailure(chat.sessionId, err);
      }
    }
  }

  // —— Bookkeeping ————————————————————————————————————————————————————————————

  private stored(): StoredConfig {
    const raw = this.deps.settings.get(CONFIG_KEY);
    if (raw !== null) {
      try {
        const doc = JSON.parse(raw) as Partial<StoredConfig>;
        return {
          botToken: typeof doc.botToken === "string" && doc.botToken !== "" ? doc.botToken : null,
          projectId: typeof doc.projectId === "string" ? doc.projectId : null,
          agentId: typeof doc.agentId === "string" ? doc.agentId : null,
          enabled: doc.enabled === true,
        };
      } catch {
        // A document this build cannot read is treated as absent: the seed applies again.
      }
    }
    const d = this.deps.defaults ?? {};
    return {
      botToken: d.botToken ?? null,
      projectId: d.projectId ?? null,
      agentId: d.agentId ?? null,
      enabled: d.enabled === true && d.botToken !== undefined,
    };
  }

  private writeStored(stored: StoredConfig): void {
    this.deps.settings.set(CONFIG_KEY, JSON.stringify(stored));
  }

  private storedChats(): Map<string, StoredChat> {
    const raw = this.deps.settings.get(CHATS_KEY);
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

  private writeChats(chats: Map<string, StoredChat>): void {
    this.deps.settings.set(CHATS_KEY, JSON.stringify(Object.fromEntries(chats)));
  }

  private noteSendFailure(sessionId: string | null, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    this.status = {
      ...this.status,
      lastDeliveryError: { at: this.nowIso(), stage: "send", detail },
    };
    this.recordError(sessionId, err, "discord_bot_send_failed");
  }

  private recordError(sessionId: string | null, err: unknown, code: string): void {
    const stored = this.stored();
    // A close the connector itself recovers from (the platform cycling a socket) is filed as
    // routine, the way the messaging bridge files it; everything else needs a look.
    const routine = (err as { recovers?: unknown } | null)?.recovers === true;
    this.deps.errors.record({
      source: "messaging",
      err,
      code,
      kind: routine ? "expected" : "unexpected",
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

/**
 * The bot's user id a token encodes, or null when the token is malformed: three dot-separated
 * segments, the first the id in base64 — the same rule the harness's Discord connector applies
 * to a per-Session binding. A pasted `Bot ` prefix is tolerated.
 */
export function botIdOf(botToken: string): string | null {
  const bare = botToken.trim().replace(/^Bot\s+/i, "");
  const [head, ...rest] = bare.split(".");
  if (head === undefined || head === "" || rest.length !== 2 || rest.some((s) => s === ""))
    return null;
  const decoded = Buffer.from(head, "base64").toString("utf8");
  return /^\d{15,22}$/.test(decoded) ? decoded : null;
}

/** The site-wide mask rule: `first4…last4` for a long value, `***` otherwise. */
export function mask(value: string): string {
  return value.length > 12 ? `${value.slice(0, 4)}…${value.slice(-4)}` : "***";
}

/**
 * Cuts a reply at paragraph, then line, then hard boundaries under `max`. The connector
 * renders Markdown on the pieces afterwards, so a cut is not aware of constructs — a fence
 * split across two messages loses its formatting in the second, never its text.
 */
export function chunkReply(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const para = window.lastIndexOf("\n\n");
    const line = window.lastIndexOf("\n");
    const cut = para > max / 2 ? para : line > max / 2 ? line : max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * Lands one inbound file in the Session scratchpad under a name safe on disk, created
 * exclusively so a colliding name gets a numbered sibling rather than overwriting.
 */
export async function writeAttachment(
  dir: string,
  fileName: string,
  data: Buffer,
): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  const safe = safeFileName(fileName);
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  for (let i = 0; i < 100; i += 1) {
    const candidate = path.join(dir, i === 0 ? safe : `${stem} (${i})${ext}`);
    try {
      const handle = await fsp.open(candidate, "wx");
      try {
        await handle.writeFile(data);
      } finally {
        await handle.close();
      }
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`could not find a free name for "${fileName}"`);
}

/** A chat's file name as a single path segment: separators, traversal, NUL and RTL overrides replaced. */
export function safeFileName(fileName: string): string {
  const cleaned = fileName
    .replace(/[\\/\0‮‭]/g, "_")
    .replace(/^\.+$/, "_")
    .trim();
  return cleaned === "" ? "file" : cleaned.slice(0, 200);
}
