/**
 * Telegram messaging tests — the mirror of messaging.test.ts for the second channel, and
 * the proof the connector seam holds: the /api/sessions/:id/messaging/telegram routes
 * (token masking + keep-on-blank, the bot id as the account identity and the enable-time
 * 409 it collides on, the save/enable split, the getMe
 * probe surfacing the bot username), the channel-agnostic GET the channel-aware editor
 * reads, and the connector's long-poll loop through a fake Bot API transport — offset
 * advancement, the connect-time backlog drain, inbound routing as plain user input,
 * an inbound photo (largest variant, caption as the message text, a failed download
 * degrading to a notice), per-message mirroring with one reply thread per run in groups,
 * mentioned files leaving as a photo or a document, 4096-safe chunking,
 * non-text notices, poll-failure status flips, and the conflict path a second poller
 * produces (the 409 backoff, the connect-time webhook clear, and the actionable text the
 * transport maps a 409 to). No test opens real network.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type {
  FeishuBindingResponse,
  MessagingBindingsResponse,
  TelegramBindingResponse,
  TelegramTestResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { INLINE_IMAGE_MAX_BYTES } from "../src/services/attachment-limits.js";
import {
  MESSAGING_APPROVAL_NOTICE,
  MESSAGING_TEXT_ONLY_NOTICE,
  MESSAGING_TEST_MESSAGE,
  messagingImageFailedNotice,
} from "../src/runtime/messaging/bridge.js";
import { collectUnderCap } from "../src/runtime/messaging/media.js";
import type {
  TelegramBotClient,
  TelegramBotUser,
  TelegramCredentials,
  TelegramFileBytes,
  TelegramTransport,
  TelegramTransportOpts,
  TelegramUpdate,
  TelegramWebhookInfo,
} from "../src/runtime/messaging/telegram-api.js";
import {
  TelegramApiError,
  createTelegramTransport,
} from "../src/runtime/messaging/telegram-api.js";
import { TelegramConnector, telegramBotIdOf } from "../src/runtime/messaging/telegram-connector.js";
import type {
  FeishuApiClient,
  FeishuCredentials,
  FeishuEventHandlers,
  FeishuSdk,
} from "../src/runtime/messaging/feishu-sdk.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-26-10-00-00-t9000001";
const SID2 = "session-2026-08-26-10-00-01-t9000002";
const BASE = (sid: string) => `/api/sessions/${sid}/messaging/telegram`;
const TOKEN = "7000000001:test-secret-AAAA-1111";

// ---------------------------------------------------------------------------
// Fake transport: one shared server-side update queue (as Telegram holds one per bot),
// per-client send records, and parked long polls the tests resolve by pushing updates.
// ---------------------------------------------------------------------------

interface SentMessage {
  chatId: string;
  text: string;
  replyTo?: number;
  threadId?: number;
}

/**
 * One picture or attachment that reached the channel. Byte count rather than the bytes:
 * what the assertions care about is which file went where, in what order, and that the
 * caps let it through.
 */
interface SentMedia {
  kind: "photo" | "document";
  chatId: string;
  fileName: string;
  bytes: number;
}

/** Everything one client sent, in order — the ordering of text against media is the point. */
type Sent = SentMessage | SentMedia;

/** One file download the bridge asked for, cap included. */
interface FileFetch {
  fileId: string;
  maxBytes: number;
}

/** The bytes as a stream, so the fake reads them through the real capped reader. */
async function* oneChunk(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

/** A JPEG's magic bytes plus a little payload: enough for a data URL to be asserted verbatim. */
const PHOTO_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0x33]);

class FakeBotClient implements TelegramBotClient {
  readonly sends: Sent[] = [];
  readonly fileFetches: FileFetch[] = [];
  /** Every sendMessage ATTEMPT, failures included — `sends` records only what got through. */
  sendCalls = 0;
  getMeCalls = 0;
  /** A long poll is currently parked waiting for an update. */
  parked = false;
  /** A parked long poll was ended by the connection's abort (the close path ran). */
  sawAbort = false;
  constructor(
    readonly creds: TelegramCredentials,
    private readonly t: FakeTelegramTransport,
  ) {}

  webhookInfoCalls = 0;

  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    this.webhookInfoCalls++;
    return { url: this.t.webhookUrl };
  }

  async getMe(): Promise<TelegramBotUser> {
    this.getMeCalls++;
    if (this.t.failGetMe !== null) throw new Error(this.t.failGetMe);
    return {
      id: Number(telegramBotIdOf(this.creds.botToken) ?? "0"),
      first_name: "Penguin Test",
      ...(this.t.botUsername !== undefined ? { username: this.t.botUsername } : {}),
      ...(this.t.readsAllGroupMessages !== undefined
        ? { can_read_all_group_messages: this.t.readsAllGroupMessages }
        : {}),
    };
  }

  async sendMessage(args: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
    messageThreadId?: number;
  }): Promise<void> {
    this.sendCalls++;
    if (this.t.failSend !== null) {
      // A plain Error is a transport failure (no envelope, so no code); a TelegramApiError is
      // Telegram answering `ok: false`, and only its code may be branched on.
      throw this.t.failSendCode === null
        ? new Error(this.t.failSend)
        : new TelegramApiError(this.t.failSend, this.t.failSendCode);
    }
    // A topic deleted or closed under a live conversation: the threaded call fails and the
    // same call without a thread succeeds, which is the shape the fallback has to survive.
    if (args.messageThreadId !== undefined && this.t.failThreadedSend !== null) {
      throw new TelegramApiError(this.t.failThreadedSend, this.t.failThreadedSendCode);
    }
    this.sends.push({
      chatId: args.chatId,
      text: args.text,
      ...(args.replyToMessageId !== undefined ? { replyTo: args.replyToMessageId } : {}),
      ...(args.messageThreadId !== undefined ? { threadId: args.messageThreadId } : {}),
    });
  }

  async sendPhoto(args: { chatId: string; fileName: string; data: Buffer }): Promise<void> {
    if (this.t.failMediaSend !== null) throw new Error(this.t.failMediaSend);
    this.sends.push({
      kind: "photo",
      chatId: args.chatId,
      fileName: args.fileName,
      bytes: args.data.length,
    });
  }

  async sendDocument(args: { chatId: string; fileName: string; data: Buffer }): Promise<void> {
    if (this.t.failMediaSend !== null) throw new Error(this.t.failMediaSend);
    this.sends.push({
      kind: "document",
      chatId: args.chatId,
      fileName: args.fileName,
      bytes: args.data.length,
    });
  }

  async getFileBytes(args: FileFetch): Promise<TelegramFileBytes> {
    this.fileFetches.push(args);
    if (this.t.failFileFetch !== null) throw new Error(this.t.failFileFetch);
    // The cap is enforced through the REAL machinery the transport uses, not a hand-written
    // imitation of it (see the Feishu suite's note: an imitation is free to disagree with
    // production about which failure this is).
    const data = await collectUnderCap(oneChunk(this.t.fileBytes), args.maxBytes, "The image");
    return { data, filePath: this.t.filePath };
  }

  getUpdates(args: {
    offset?: number;
    timeoutSec: number;
    signal: AbortSignal;
  }): Promise<TelegramUpdate[]> {
    if (this.t.failPolls > 0) {
      this.t.failPolls--;
      return Promise.reject(new Error("poll failed"));
    }
    // Bot API semantics: a negative offset addresses updates from the end of the queue
    // (-1 = the newest one only) without confirming anything.
    if (args.offset === -1) {
      const newest = this.t.pending.at(-1);
      return Promise.resolve(newest !== undefined ? [newest] : []);
    }
    // A non-negative offset confirms (drops) everything before it; unconfirmed updates
    // are re-delivered, which is what makes the connector's offset bookkeeping visible.
    if (args.offset !== undefined) {
      this.t.pending = this.t.pending.filter((u) => u.update_id >= args.offset!);
    }
    if (this.t.pending.length > 0 || args.timeoutSec === 0) {
      return Promise.resolve([...this.t.pending]);
    }
    return new Promise((resolve, reject) => {
      const waiter = (updates: TelegramUpdate[]) => {
        args.signal.removeEventListener("abort", onAbort);
        this.parked = false;
        resolve(updates);
      };
      const onAbort = () => {
        this.t.waiters = this.t.waiters.filter((w) => w !== waiter);
        this.parked = false;
        this.sawAbort = true;
        reject(new Error("aborted"));
      };
      if (args.signal.aborted) {
        onAbort();
        return;
      }
      args.signal.addEventListener("abort", onAbort, { once: true });
      this.parked = true;
      this.t.waiters.push(waiter);
    });
  }
}

class FakeTelegramTransport {
  readonly clients: FakeBotClient[] = [];
  /** The bot's server-side update queue (survives reconnects, seeds the drain). */
  pending: TelegramUpdate[] = [];
  waiters: Array<(updates: TelegramUpdate[]) => void> = [];
  /** Non-null makes getMe throw with this message. */
  failGetMe: string | null = null;
  /** Non-null makes sendMessage throw with this message. */
  failSend: string | null = null;
  /** `failSend`'s Bot API `error_code`; null makes it a transport failure, which carries none. */
  failSendCode: number | null = null;
  /** Non-null makes only the sends that carry a forum topic throw (a deleted/closed topic). */
  failThreadedSend: string | null = null;
  /** `failThreadedSend`'s `error_code`: 400 is the deleted-topic shape, 429 a flood wait. */
  failThreadedSendCode = 400;
  /** Fails this many upcoming getUpdates calls. */
  failPolls = 0;
  /** Non-null makes getFileBytes throw with this message (an expired file_id, a network fault). */
  failFileFetch: string | null = null;
  /** Non-null makes an outbound photo/document send throw (the channel refusing an upload). */
  failMediaSend: string | null = null;
  /** What a file download resolves to; oversize bytes exercise the cap. */
  fileBytes: Buffer = PHOTO_BYTES;
  /** The path the Bot API served the bytes from — its extension names the type. */
  filePath = "photos/file_7.jpg";
  /** The webhook registered on the bot; the empty string means none, as the Bot API encodes it. */
  webhookUrl = "";
  /** getMe's `can_read_all_group_messages` (true = privacy mode OFF); undefined = the field is absent. */
  readsAllGroupMessages: boolean | undefined = undefined;
  /** getMe's `username`; undefined = the field is absent, which the Bot API's User allows. */
  botUsername: string | undefined = "penguin_test_bot";
  private nextUpdateId = 100;

  createClient(creds: TelegramCredentials): FakeBotClient {
    const client = new FakeBotClient(creds, this);
    this.clients.push(client);
    return client;
  }

  /** A new inbound update: queued, and every parked long poll resolves with the queue. */
  push(message: TelegramUpdate["message"]): void {
    this.pending.push({ update_id: this.nextUpdateId++, message: message! });
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w([...this.pending]);
  }

  /** A non-message update (edited_message, chat-member change, …): no `message` field. */
  pushNonMessage(): void {
    this.pending.push({ update_id: this.nextUpdateId++ });
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w([...this.pending]);
  }

  lastClient(): FakeBotClient {
    const client = this.clients.at(-1);
    if (!client) throw new Error("no fake telegram client was created");
    return client;
  }

  /** Everything sent through any client, in order (texts and media interleaved). */
  allSends(): Sent[] {
    return this.clients.flatMap((c) => c.sends);
  }

  /** Every sendMessage attempt across every client: what tells one round trip from two. */
  allSendCalls(): number {
    return this.clients.reduce((n, c) => n + c.sendCalls, 0);
  }

  /** Just the text messages — for the assertions that read `.text`. */
  allTexts(): SentMessage[] {
    return this.allSends().filter((s): s is SentMessage => !("kind" in s));
  }

  /** Every file download asked of any client, in order. */
  allFileFetches(): FileFetch[] {
    return this.clients.flatMap((c) => c.fileFetches);
  }
}

/**
 * Minimal fake Feishu SDK for the cross-channel tests (enabling the feishu side must not
 * import the real Lark SDK or open network): connects instantly, records nothing.
 */
class FakeFeishuSdk implements FeishuSdk {
  async createClient(_creds: FeishuCredentials): Promise<FeishuApiClient> {
    return {
      async checkCredentials() {
        return null;
      },
      async sendText() {},
      async replyText() {},
      async botOpenId() {
        return null;
      },
      async fetchMessageImage(): Promise<never> {
        throw new Error("the feishu side of these tests never carries an image");
      },
      async sendImage() {},
      async sendFile() {},
    };
  }
  async connect(_creds: FeishuCredentials, handlers: FeishuEventHandlers) {
    handlers.onReady?.();
    return { close: () => {} };
  }
}

/** A private-chat text message from a fixed user. */
function privateText(text: string, messageId = 1): TelegramUpdate["message"] {
  return {
    message_id: messageId,
    chat: { id: 42424242, type: "private" },
    text,
    from: { first_name: "Ada" },
  };
}

/**
 * A private-chat photo message: the Bot API sends the same picture as several size
 * variants, thumbnails first, and `caption` carries whatever the user typed with it.
 */
function privatePhoto(caption?: string, messageId = 1): TelegramUpdate["message"] {
  return {
    message_id: messageId,
    chat: { id: 42424242, type: "private" },
    photo: [
      { file_id: "thumb-90", width: 90, height: 67, file_size: 1_200 },
      { file_id: "mid-320", width: 320, height: 240, file_size: 9_800 },
      { file_id: "full-1280", width: 1280, height: 960, file_size: 120_400 },
    ],
    ...(caption !== undefined ? { caption } : {}),
    from: { first_name: "Ada" },
  };
}

/**
 * One input part as the fake Sessions record it. Deliberately a loose shape rather than
 * core's payload union: a run's input mixes composer text with `image_url` parts, and the
 * assertions read one field of whichever arrived.
 */
interface InputPayload {
  type?: string;
  role?: string;
  text?: string;
  image_url?: string;
}

/** Fake Session: records each run's input payloads and replies with a fixed assistant text. */
function echoFakeSession(
  sessionId: string,
  runs: InputPayload[][],
  reply = "Reply text",
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(input: OmniMessage[]) {
      runs.push(input.map((m) => m.payload as InputPayload));
      yield assistantText(reply);
    },
    async *compact() {},
  };
}

/**
 * Fake Session that completes several assistant messages in ONE run. `gate`, when given,
 * holds the last message back: what lets a test observe the earlier ones already in the
 * chat while the run is still running.
 */
function multiMessageFakeSession(
  sessionId: string,
  texts: readonly string[],
  gate?: Promise<void>,
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      for (let i = 0; i < texts.length; i += 1) {
        if (gate !== undefined && i === texts.length - 1) await gate;
        yield assistantText(texts[i]!);
      }
    },
    async *compact() {},
  };
}

/** Fake Session that parks on one approval per run (drives an approval_request event). */
function parkingFakeSession(sessionId: string): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-forum" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-forum");
      yield assistantText("after approval");
    },
    async *compact() {},
  };
}

function sessionRowOf(sessionId: string, projectId: string): SessionRow {
  return {
    sessionId,
    projectId,
    agentId: "default_agent",
    provider: "custom",
    modelId: "m1",
    workspace: "/tmp/w",
    approvalMode: "allow-all",
    title: null,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
}

describe("telegramBotIdOf", () => {
  it("reads the numeric id in front of the colon and rejects malformed tokens", () => {
    expect(telegramBotIdOf(TOKEN)).toBe("7000000001");
    expect(telegramBotIdOf("no-colon")).toBeNull();
    expect(telegramBotIdOf("abc:def-ghi-jkl")).toBeNull();
    expect(telegramBotIdOf("123:")).toBeNull();
  });
});

describe("telegram binding routes and connector loop", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let fake: FakeTelegramTransport;
  let projectId: string;
  let runs: InputPayload[][];
  /** The server log, so a delivery that succeeded only in a degraded form is observable. */
  let logLines: string[];

  /** Save the token, then flip the toggle on and wait for the poll loop's handshake. */
  const bindEnabled = async (sid: string, botToken = TOKEN) => {
    expect((await api.put(BASE(sid), { botToken })).status).toBe(200);
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sid, "telegram").state === "connected");
  };

  beforeEach(async () => {
    fake = new FakeTelegramTransport();
    logLines = [];
    t = await createTestApp({
      telegramTransport: fake,
      telegramRetryDelayMs: () => 1,
      feishuSdk: new FakeFeishuSdk(),
      log: (line) => logLines.push(line),
    });
    const { cookie } = await provisionUser(t.app, "birder");
    api = apiClient(t.app, cookie);
    projectId = "birder-default_project";
    runs = [];
    const row = sessionRowOf(SID, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, echoFakeSession(SID, runs));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("PUT saves the token only (masked, bot id extracted, disabled, no poll); blank keeps the stored token", async () => {
    const res = await api.put(BASE(SID), { botToken: TOKEN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TelegramBindingResponse;
    expect(body.binding?.channel).toBe("telegram");
    expect(body.binding?.botId).toBe("7000000001");
    // Site-wide mask rule: first4…last4, never the plaintext.
    expect(body.binding?.botTokenMasked).toBe("7000…1111");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(body.binding?.enabled).toBe(false);
    expect(body.status.state).toBe("disconnected");
    expect(fake.clients).toHaveLength(0);
    const stored = t.deps.messagingRepo.find(SID, "telegram")!;
    expect(stored.channel).toBe("telegram");
    expect(stored.accountId).toBe("7000000001");

    // Re-save with a blank token: the stored one stays; still disabled, still dark.
    const resave = await api.put(BASE(SID), { botToken: "" });
    expect(resave.status).toBe(200);
    expect(t.deps.messagingRepo.find(SID, "telegram")?.config.botToken).toBe(TOKEN);
    expect(fake.clients).toHaveLength(0);

    // First-time bind without a token, and a token whose bot id cannot be read: refused.
    t.deps.messagingRepo.delete(SID, "telegram");
    const bare = await api.put(BASE(SID), {});
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "telegram_token_required",
    );
    const malformed = await api.put(BASE(SID), { botToken: "not-a-token" });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe(
      "telegram_token_invalid",
    );
  });

  it("POST /state owns the connection: enable probes getMe and polls, disable aborts the poll", async () => {
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(404);
    await api.put(BASE(SID), { botToken: TOKEN });

    const on = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as TelegramBindingResponse).binding?.enabled).toBe(true);
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "connected");
    // Connected with the STORED token — the toggle carries none of its own.
    expect(fake.lastClient().creds.botToken).toBe(TOKEN);
    expect(fake.lastClient().getMeCalls).toBeGreaterThan(0);
    await waitFor(() => fake.lastClient().parked);

    const off = await api.post(`${BASE(SID)}/state`, { enabled: false });
    const offBody = (await off.json()) as TelegramBindingResponse;
    expect(offBody.binding?.enabled).toBe(false);
    expect(offBody.status.state).toBe("disconnected");
    expect(fake.lastClient().sawAbort).toBe(true);
  });

  it("saving a new token while enabled restarts the poll loop with it (never-diverge rule)", async () => {
    await bindEnabled(SID);
    await waitFor(() => fake.lastClient().parked);
    const rotated = "7000000001:test-secret-BBBB-2222";
    const res = await api.put(BASE(SID), { botToken: rotated });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TelegramBindingResponse).binding?.enabled).toBe(true);
    // The old poll was aborted and a fresh client runs on the just-saved token.
    expect(fake.clients[0]!.sawAbort).toBe(true);
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "connected");
    expect(fake.lastClient().creds.botToken).toBe(rotated);
  });

  it("a token swap cannot re-point an ENABLED binding at a bot another Session has enabled", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    // Two Sessions, each polling its own bot.
    await bindEnabled(SID);
    await bindEnabled(SID2, "7000000002:test-secret-BBBB-2222");
    await waitFor(() => t.deps.messaging.statusOf(SID2, "telegram").state === "connected");

    // Saving the first Session's token here would carry this live poll onto its bot, which
    // is the enable gate bypassed by a different door: two getUpdates loops on one token.
    const stolen = await api.put(BASE(SID2), { botToken: TOKEN });
    expect(stolen.status).toBe(409);
    const refusal = (await stolen.json()) as { error: { code: string; message: string } };
    expect(refusal.error.code).toBe("account_enabled_elsewhere");
    expect(refusal.error.message).not.toContain(SID);

    // Refused means nothing moved: the row keeps its own bot id and its own connection.
    expect(t.deps.messagingRepo.find(SID2, "telegram")?.accountId).toBe("7000000002");
    expect(t.deps.messagingRepo.findEnabledByAccount("telegram", "7000000001")?.sessionId).toBe(
      SID,
    );
    expect(t.deps.messaging.statusOf(SID2, "telegram").state).toBe("connected");

    // Disabled first, the same save is allowed again — only the enable is exclusive.
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.put(BASE(SID2), { botToken: TOKEN })).status).toBe(200);
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(409);
  });

  it("the delivery flag rides the token PUT on this channel too, and defaults off", async () => {
    // The bridge's splitting is channel-agnostic (messaging.test.ts pins the behaviour); what
    // is per-channel is the route wiring, which is what this asserts.
    await api.put(BASE(SID), { botToken: TOKEN });
    expect(t.deps.messagingRepo.find(SID, "telegram")?.linePerMessage).toBe(false);
    const on = await api.put(BASE(SID), { linePerMessage: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as TelegramBindingResponse).binding?.linePerMessage).toBe(true);
    // The token was untouched by that save, and an omitted flag keeps the stored value.
    expect(t.deps.messagingRepo.find(SID, "telegram")?.config.botToken).toBe(TOKEN);
    await api.put(BASE(SID), {});
    expect(t.deps.messagingRepo.find(SID, "telegram")?.linePerMessage).toBe(true);
  });

  it("the final-reply-only flag rides the same PUT, defaults off, and is its own field", async () => {
    // Same split as the flag above: the bridge's holding back is channel-agnostic (pinned in
    // messaging.test.ts), and what is per-channel is the route wiring this asserts.
    await api.put(BASE(SID), { botToken: TOKEN });
    expect(t.deps.messagingRepo.find(SID, "telegram")?.finalReplyOnly).toBe(false);
    const on = await api.put(BASE(SID), { finalReplyOnly: true });
    expect(on.status).toBe(200);
    const saved = (await on.json()) as TelegramBindingResponse;
    expect(saved.binding?.finalReplyOnly).toBe(true);
    // Two independent columns: saving one never carries the other along.
    expect(saved.binding?.linePerMessage).toBe(false);
    expect(t.deps.messagingRepo.find(SID, "telegram")?.config.botToken).toBe(TOKEN);
    await api.put(BASE(SID), {});
    expect(t.deps.messagingRepo.find(SID, "telegram")?.finalReplyOnly).toBe(true);
  });

  it("the account is the bot id: a rotated secret saves freely and collides only on enable", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    await bindEnabled(SID);
    // Different secret half, same id half: the identity is the id, not the whole token. It
    // saves without a murmur — saving is never exclusive across Sessions...
    const rotated = "7000000001:other-secret-CCCC";
    expect((await api.put(BASE(SID2), { botToken: rotated })).status).toBe(200);
    expect(t.deps.messagingRepo.find(SID2, "telegram")?.accountId).toBe("7000000001");

    // ...and is refused only when it asks for the connection the first Session is holding.
    const blocked = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(blocked.status).toBe(409);
    const refusal = (await blocked.json()) as { error: { code: string; message: string } };
    expect(refusal.error.code).toBe("account_enabled_elsewhere");
    // Nothing about the holder travels in the refusal (it may sit in an invisible Project).
    expect(refusal.error.message).not.toContain(SID);
    expect(t.deps.messaging.statusOf(SID, "telegram").state).toBe("connected");

    // Disabling the first is the unbind: the second then polls on its own token.
    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID2, "telegram").state === "connected");
    expect(fake.lastClient().creds.botToken).toBe(rotated);
    expect(t.deps.messaging.statusOf(SID, "telegram").state).toBe("disconnected");
    // The released Session kept its token: the switch unbinds, it does not delete.
    expect(t.deps.messagingRepo.find(SID, "telegram")?.config.botToken).toBe(TOKEN);
  });

  it("GET /messaging lists every saved channel config; both channels sit saved side by side", async () => {
    // Nothing saved: an empty list.
    const before = await api.get(`/api/sessions/${SID}/messaging`);
    expect((await before.json()) as MessagingBindingsResponse).toEqual({ bindings: [] });

    // Save BOTH channels (telegram enabled, feishu dark): both configs coexist.
    await bindEnabled(SID);
    const feishuSave = await api.put(`/api/sessions/${SID}/messaging/feishu`, {
      appId: "cli_side_by_side",
      appSecret: "feishu-secret-000111",
    });
    expect(feishuSave.status).toBe(200);
    // Saving the second channel must not disturb the first one's live connection.
    expect(t.deps.messaging.statusOf(SID, "telegram").state).toBe("connected");

    const res = await api.get(`/api/sessions/${SID}/messaging`);
    const body = (await res.json()) as MessagingBindingsResponse;
    expect(body.bindings.map((b) => b.binding.channel)).toEqual(["feishu", "telegram"]);
    const feishu = body.bindings[0]!;
    const telegram = body.bindings[1]!;
    expect(feishu.binding.enabled).toBe(false);
    expect(feishu.status.state).toBe("disconnected");
    expect(telegram.binding.enabled).toBe(true);
    expect(telegram.binding.channel === "telegram" && telegram.binding.botId).toBe("7000000001");
    expect(telegram.status.state).toBe("connected");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain("feishu-secret-000111");

    // The feishu-scoped test-message probe still 409s on ITS channel's missing chat, not
    // the telegram one's.
    const probe = await api.post(`/api/sessions/${SID}/messaging/feishu/test-message`, {});
    expect(probe.status).toBe(409);
    expect(((await probe.json()) as { error: { code: string } }).error.code).toBe("feishu_no_chat");
  });

  it("enabling is mutually exclusive per Session: the second channel answers 409 another_channel_enabled", async () => {
    await bindEnabled(SID);
    await api.put(`/api/sessions/${SID}/messaging/feishu`, {
      appId: "cli_exclusive",
      appSecret: "feishu-secret-222333",
    });
    const refused = await api.post(`/api/sessions/${SID}/messaging/feishu/state`, {
      enabled: true,
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "another_channel_enabled",
    );
    // Turn telegram off, and the same enable goes through (the telegram poll is aborted).
    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    expect(fake.lastClient().sawAbort).toBe(true);
    const on = await api.post(`/api/sessions/${SID}/messaging/feishu/state`, { enabled: true });
    expect(on.status).toBe(200);
    expect(((await on.json()) as FeishuBindingResponse).binding?.enabled).toBe(true);
    expect(t.deps.messaging.statusOf(SID, "telegram").state).toBe("disconnected");
  });

  it("the clear flag drops the stored token after disabling, and re-enabling is refused until one is saved", async () => {
    await bindEnabled(SID);
    const blocked = await api.put(BASE(SID), { clearBotToken: true });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      "messaging_disable_before_clear",
    );
    await api.post(`${BASE(SID)}/state`, { enabled: false });
    const cleared = await api.put(BASE(SID), { clearBotToken: true });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as TelegramBindingResponse;
    // No stored token -> no mask; the row keeps its bot identity.
    expect(body.binding?.botTokenMasked).toBeUndefined();
    expect(body.binding?.botId).toBe("7000000001");
    expect(t.deps.messagingRepo.find(SID, "telegram")?.config.botToken).toBe("");
    const on = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(on.status).toBe(400);
    expect(((await on.json()) as { error: { code: string } }).error.code).toBe(
      "telegram_token_required",
    );
  });

  it("POST /test probes getMe and surfaces the bot username; failures are ok:false", async () => {
    const draft = await api.post(`${BASE(SID)}/test`, { botToken: TOKEN });
    expect(draft.status).toBe(200);
    const ok = (await draft.json()) as TelegramTestResponse;
    expect(ok.ok).toBe(true);
    expect(ok.botUsername).toBe("@penguin_test_bot");
    expect(typeof ok.latencyMs).toBe("number");

    // Stored fallback: an empty body tests the saved binding.
    await api.put(BASE(SID), { botToken: TOKEN });
    const stored = await api.post(`${BASE(SID)}/test`, {});
    expect(((await stored.json()) as TelegramTestResponse).ok).toBe(true);
    expect(fake.lastClient().creds.botToken).toBe(TOKEN);

    // A rejected token is ok:false with the reason, not an HTTP error.
    fake.failGetMe = "getMe failed: Unauthorized (code 401)";
    const bad = await api.post(`${BASE(SID)}/test`, {});
    expect(bad.status).toBe(200);
    expect((await bad.json()) as TelegramTestResponse).toEqual({
      ok: false,
      error: "getMe failed: Unauthorized (code 401)",
    });

    // No stored binding and no draft token: the telegram 400 shape.
    t.deps.messagingRepo.delete(SID, "telegram");
    const none = await api.post(`${BASE(SID)}/test`, {});
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: { code: string } }).error.code).toBe(
      "telegram_token_required",
    );
  });

  it("POST /test-message: 404 unbound, 409 telegram_no_chat before a chat is known, sends after one", async () => {
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(404);
    await bindEnabled(SID);
    const early = await api.post(`${BASE(SID)}/test-message`, {});
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe(
      "telegram_no_chat",
    );

    fake.push(privateText("hello"));
    await waitFor(() => t.deps.messagingRepo.find(SID, "telegram")?.lastChatId === "42424242");
    const res = await api.post(`${BASE(SID)}/test-message`, {});
    expect(res.status).toBe(200);
    expect(fake.allSends()).toContainEqual({
      chatId: "42424242",
      text: MESSAGING_TEST_MESSAGE,
    });
  });

  it("inbound text starts an ordinary user task (no marker, no sender), advances the offset, and mirrors the reply", async () => {
    await bindEnabled(SID);
    fake.push(privateText("how is the build?", 11));
    await waitFor(() => runs.length === 1);
    // Exactly as if typed into the web composer: the text verbatim, no marker block, and
    // the default human sender (no `sender` field at all).
    const input = runs[0]![0]!;
    expect(input.text).toBe("how is the build?");
    expect(input.role).toBe("user");
    expect("sender" in input).toBe(false);
    const row = t.deps.messagingRepo.find(SID, "telegram")!;
    expect(row.lastChatId).toBe("42424242");
    expect(row.lastChatIsDirect).toBe(true);
    // Task end mirrors the assistant text to that chat as a plain send (direct chat).
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({ chatId: "42424242", text: "Reply text" });

    // A second message is processed exactly once: the loop confirmed the first update
    // via its offset, so nothing re-delivers.
    fake.push(privateText("second", 12));
    await waitFor(() => runs.length === 2);
    expect(runs.map((r) => r[0]!.text)).toEqual(["how is the build?", "second"]);
  });

  it("POST /test reports @BotFather's Group Privacy, and reports nothing when getMe is silent about it", async () => {
    // Privacy mode ON is the Bot API default for every bot not added as a group admin. It is
    // never an error — the bot answers a direct chat perfectly — so the test result is the
    // only place the user learns why the same bot ignores a group.
    fake.readsAllGroupMessages = false;
    const on = (await (
      await api.post(`${BASE(SID)}/test`, { botToken: TOKEN })
    ).json()) as TelegramTestResponse;
    expect(on.ok).toBe(true);
    expect(on.groupPrivacy).toBe(true);

    // Turned off in @BotFather: the flag says so, and the response says there is nothing to do.
    fake.readsAllGroupMessages = true;
    const off = (await (
      await api.post(`${BASE(SID)}/test`, { botToken: TOKEN })
    ).json()) as TelegramTestResponse;
    expect(off.groupPrivacy).toBe(false);

    // The field is documented as "returned only in getMe" and could be missing from a
    // response this build did not anticipate. Unknown is reported as unknown: telling a user
    // their bot is muted in groups on the strength of an absent field sends them to
    // @BotFather for nothing.
    fake.readsAllGroupMessages = undefined;
    const silent = (await (
      await api.post(`${BASE(SID)}/test`, { botToken: TOKEN })
    ).json()) as TelegramTestResponse;
    expect(silent.ok).toBe(true);
    expect("groupPrivacy" in silent).toBe(false);
  });

  it("POST /test reports Group Privacy for a bot getMe names no username for", async () => {
    // `username` is optional on the Bot API's User, and checkCredentials answered `null` for
    // a response without one — which threw the privacy flag away along with the label. The
    // two are independent: an unnamed bot is exactly as mute in a group as a named one.
    fake.botUsername = undefined;
    fake.readsAllGroupMessages = false;
    const res = (await (
      await api.post(`${BASE(SID)}/test`, { botToken: TOKEN })
    ).json()) as TelegramTestResponse;
    expect(res.ok).toBe(true);
    expect(res.groupPrivacy).toBe(true);
    expect(typeof res.latencyMs).toBe("number");
    expect("botUsername" in res).toBe(false);
  });

  it("group messages thread the reply onto the inbound message; non-message updates are skipped", async () => {
    await bindEnabled(SID);
    // A non-message update (edited message, membership change, …): skipped entirely —
    // no task, no notice — but still confirmed by the advancing offset.
    fake.pushNonMessage();
    fake.push({
      message_id: 77,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "ping from the group",
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    const row = t.deps.messagingRepo.find(SID, "telegram")!;
    expect(row.lastChatId).toBe("-1002233445566");
    expect(row.lastChatIsDirect).toBe(false);
    await waitFor(() => fake.allSends().length > 0);
    // The reply names the chat AND the message: Telegram message ids are chat-scoped, so
    // the connector packs both into the reply ref.
    expect(fake.allSends()).toContainEqual({
      chatId: "-1002233445566",
      text: "Reply text",
      replyTo: 77,
    });
  });

  it("strips this bot's own @mention out of a group message, keeping everyone else's", async () => {
    await bindEnabled(SID);
    // What addressing a bot in a group looks like on the wire: the handle is part of the
    // text, and Telegram marks it with a `mention` entity. Offsets are UTF-16 code units,
    // which is what a JS string index already is.
    fake.push({
      message_id: 88,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "@penguin_test_bot ask @alice about the build",
      entities: [
        { type: "mention", offset: 0, length: 17 },
        { type: "mention", offset: 22, length: 6 },
      ],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    // Only the bot's own handle goes: the model is deliberately not told the message came
    // through a chat channel. @alice is a word the user chose and reads as itself.
    expect(runs[0]![0]!.text).toBe("ask @alice about the build");
  });

  it("matches the bot's handle case-insensitively and recognizes a text_mention by user id", async () => {
    await bindEnabled(SID);
    fake.push({
      message_id: 89,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "@Penguin_Test_Bot deploy",
      entities: [{ type: "mention", offset: 0, length: 17 }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("deploy");

    // A bot with no username, or a client that linked the mention rather than typing it:
    // Telegram sends a `text_mention` carrying the user object instead of an @handle.
    fake.push({
      message_id: 90,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "Penguin Test roll it back",
      entities: [{ type: "text_mention", offset: 0, length: 12, user: { id: 7000000001 } }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 2);
    expect(runs[1]![0]!.text).toBe("roll it back");
  });

  it("keeps a mention of this bot that is not the addressing prefix", async () => {
    await bindEnabled(SID);
    fake.push({
      message_id: 92,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "@penguin_test_bot summarize what @penguin_test_bot said yesterday",
      entities: [
        { type: "mention", offset: 0, length: 17 },
        { type: "mention", offset: 33, length: 17 },
      ],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    // The opening handle is how a group addresses the bot; the second one is a word inside
    // the user's sentence, and cutting it would leave the model a hole to guess at.
    expect(runs[0]![0]!.text).toBe("summarize what @penguin_test_bot said yesterday");

    // Nothing to cut here either: the sentence starts before the handle.
    fake.push({
      message_id: 93,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "what is @penguin_test_bot's status?",
      entities: [{ type: "mention", offset: 8, length: 17 }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 2);
    expect(runs[1]![0]!.text).toBe("what is @penguin_test_bot's status?");

    // What comes first need not be words. Only whitespace ahead of the handle makes it the
    // addressing prefix — and the offset that says so is in UTF-16 code units, which is what
    // a JS string index already is (the family emoji is 8 of them).
    fake.push({
      message_id: 94,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "👨‍👩‍👧 @penguin_test_bot deploy",
      entities: [{ type: "mention", offset: 9, length: 17 }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 3);
    expect(runs[2]![0]!.text).toBe("👨‍👩‍👧 @penguin_test_bot deploy");
  });

  it("cuts the addressing prefix by UTF-16 code units, not code points", async () => {
    await bindEnabled(SID);
    // A display name carrying an emoji, linked as a `text_mention` (matched by user id, so
    // the offsets are the only thing under test). The family emoji is 8 UTF-16 code units
    // but 5 code points: an implementation that indexed by code point would cut 21 of the
    // latter and hand the model "ploy".
    fake.push({
      message_id: 95,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "👨‍👩‍👧 Penguin Test deploy",
      entities: [{ type: "text_mention", offset: 0, length: 21, user: { id: 7000000001 } }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("deploy");
  });

  it("handles a real supergroup id end to end: routing, reply ref, and the mention strip", async () => {
    await bindEnabled(SID);
    // The shapes every fixture in this file used to avoid: a real supergroup chat id is
    // NEGATIVE and 14 digits, so it rides the reply ref in front of the `:` the parser splits
    // on, and it has to survive the string→number round trip the Bot API needs.
    const chatId = -1004475424385;
    fake.push({
      message_id: 4,
      chat: { id: chatId, type: "supergroup" },
      text: "@penguin_test_bot hi",
      entities: [{ type: "mention", offset: 0, length: 17 }],
      from: { first_name: "hiyouga", username: "hiyouga" },
    });
    await waitFor(() => runs.length === 1);
    // The handle is stripped and a real word remains, so this is a Task and not the
    // no-words branch — a one-word message is the shortest thing that could have been
    // emptied by mistake.
    expect(runs[0]![0]!.text).toBe("hi");
    const row = t.deps.messagingRepo.find(SID, "telegram")!;
    expect(row.lastChatId).toBe(String(chatId));
    expect(row.lastChatIsDirect).toBe(false);
    // The reply threads onto message 4 IN that chat: the ref packs both, and the leading
    // minus sign must not be mistaken for the separator.
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({
      chatId: String(chatId),
      text: "Reply text",
      replyTo: 4,
    });
  });

  // —— Forum supergroup topics ————————————————————————————————————————————————
  // A forum supergroup splits one chat into topics, and a message carries the topic it was
  // written in. A send that omits it lands in General — so the run's first reply threaded
  // correctly (Telegram infers a reply's topic from its target) while every message after
  // it, and the approval notice, walked out of the conversation.

  const FORUM_CHAT = -1004475424385;
  const TOPIC = 91;

  /**
   * A message in a forum topic, as Telegram sends it: the chat says it is a forum and the
   * message says it is in a topic. `null` is the same forum's General topic, which carries
   * neither the thread nor the flag.
   */
  const forumText = (text: string, messageId = 200, threadId: number | null = TOPIC) => ({
    message_id: messageId,
    chat: { id: FORUM_CHAT, type: "supergroup", is_forum: true },
    ...(threadId !== null ? { message_thread_id: threadId, is_topic_message: true } : {}),
    text,
    from: { first_name: "Ada" },
  });

  it("remembers the topic, and every later message of the run reaches it", async () => {
    // Three completed messages in ONE run: the first threads onto the inbound message, the
    // two after it are plain sends — which is precisely where the topic used to be lost.
    const row = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["first", "second", "third"]));
    await bindEnabled(SID2);

    fake.push(forumText("status?"));
    await waitFor(() => fake.allSends().length === 3, 5000);
    const sends = fake.allTexts();
    // Every one of them, not just the threaded first.
    expect(sends.map((x) => x.threadId)).toEqual([TOPIC, TOPIC, TOPIC]);
    expect(sends.map((x) => x.text)).toEqual(["first", "second", "third"]);
    // The first still quotes the inbound message; the rest are plain sends, as before.
    expect(sends[0]!.replyTo).toBe(200);
    expect(sends[1]!.replyTo).toBeUndefined();
    // The topic is on the stored chat, which is what carries it across a restart.
    expect(t.deps.messagingRepo.find(SID2, "telegram")?.lastChatId).toBe(`${FORUM_CHAT}:${TOPIC}`);
  });

  it("moves to the newest topic the user writes in, like the chat it already remembers", async () => {
    await bindEnabled(SID);
    fake.push(forumText("in the first topic", 201, TOPIC));
    await waitFor(() => runs.length === 1);
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allTexts()[0]!.threadId).toBe(TOPIC);

    fake.push(forumText("now over here", 202, 77));
    await waitFor(() => runs.length === 2);
    await waitFor(() => fake.allSends().length === 2);
    expect(fake.allTexts()[1]!.threadId).toBe(77);
    expect(t.deps.messagingRepo.find(SID, "telegram")?.lastChatId).toBe(`${FORUM_CHAT}:77`);
  });

  it("sends the approval notice and the test message into the remembered topic", async () => {
    const row = sessionRowOf(SID2, projectId);
    // The approval only becomes an event when something is actually asked.
    row.approvalMode = "always-ask";
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, parkingFakeSession(SID2));
    await bindEnabled(SID2);

    fake.push(forumText("do the thing", 203));
    // The notice is a bare send with no inbound message to thread onto — the shape that had
    // nothing at all to put it back in the topic.
    await waitFor(() => fake.allTexts().some((x) => x.text === MESSAGING_APPROVAL_NOTICE), 5000);
    const notice = fake.allTexts().find((x) => x.text === MESSAGING_APPROVAL_NOTICE)!;
    expect(notice.threadId).toBe(TOPIC);
    expect(notice.replyTo).toBeUndefined();

    // The test message reads the stored chat straight off the row, so it is the path that
    // would hand an encoded string to the API if the connector were not the one parsing it.
    expect((await api.post(`${BASE(SID2)}/test-message`, {})).status).toBe(200);
    const test = fake.allTexts().find((x) => x.text === MESSAGING_TEST_MESSAGE)!;
    expect(test.chatId).toBe(String(FORUM_CHAT));
    expect(test.threadId).toBe(TOPIC);

    t.deps.manager.decideApproval(SID2, "tc-forum", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
  });

  it("a topic that has been deleted degrades to a plain send instead of losing the reply", async () => {
    // Three completed messages in one run: the topic is gone for every one of them, which is
    // what the trace has to survive without turning into a line per send.
    const row = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["first", "second", "third"]));
    await bindEnabled(SID2);
    // No `allow_sending_without_thread` exists to match the reply flag, so the call simply
    // fails with a 400. Landing in General is worse than the right topic and far better than
    // dropping a reply the model has already produced.
    fake.failThreadedSend = "sendMessage failed: Bad Request: message thread not found (code 400)";
    fake.push(forumText("still there?", 204));
    await waitFor(() => fake.allSends().length === 3, 5000);
    const sends = fake.allTexts();
    expect(sends.map((x) => x.text)).toEqual(["first", "second", "third"]);
    expect(sends.map((x) => x.threadId)).toEqual([undefined, undefined, undefined]);
    expect(sends.every((x) => x.chatId === String(FORUM_CHAT))).toBe(true);
    // Two attempts per message and no more: the threaded one Telegram refused, then the
    // fallback that carried no topic.
    expect(fake.allSendCalls()).toBe(6);
    // The messages DID arrive, so this is not a delivery failure and must not read as one on
    // the panel; the log is where "the replies moved to General" is answerable, once for the
    // episode rather than once per send.
    expect(t.deps.messaging.statusOf(SID2, "telegram").lastDeliveryError).toBeUndefined();
    expect(logLines.filter((l) => l.includes("delivered degraded"))).toEqual([
      "[messaging] telegram delivered degraded: forum topic gone, the reply went to General instead",
    ]);
  });

  it("a flood wait is not retried: one refusal must not cost two requests", async () => {
    await bindEnabled(SID);
    // `Too Many Requests: retry after 5` against a per-chat allowance of about one message a
    // second. An immediate second request lengthens the flood wait and fails again, so only
    // the 400 that means "no such thread" may be retried.
    fake.failThreadedSend = "sendMessage failed: Too Many Requests: retry after 5 (code 429)";
    fake.failThreadedSendCode = 429;
    fake.push(forumText("under a flood wait", 206));
    await waitFor(() => runs.length === 1);
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").lastDeliveryError !== undefined);
    expect(fake.allSendCalls()).toBe(1);
    expect(fake.allSends()).toHaveLength(0);
    expect(t.deps.messaging.statusOf(SID, "telegram").lastDeliveryError?.detail).toContain(
      "retry after 5",
    );
  });

  it("a threaded send that fails both times surfaces the failure after exactly two attempts", async () => {
    await bindEnabled(SID);
    // `Bad Request: chat not found` is a 400 too, so the fallback fires — and then fails as
    // well. The reply is lost either way; what must not be lost is the report.
    fake.failSend = "sendMessage failed: Bad Request: chat not found (code 400)";
    fake.failSendCode = 400;
    fake.push(forumText("into a chat that is gone", 207));
    await waitFor(() => runs.length === 1);
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").lastDeliveryError !== undefined);
    expect(fake.allSendCalls()).toBe(2);
    expect(t.deps.messaging.statusOf(SID, "telegram").lastDeliveryError?.detail).toContain(
      "chat not found",
    );
    expect(t.deps.errorsRepo.recent(projectId).map((r) => r.code)).toContain(
      "messaging_send_failed",
    );
  });

  it("a forum's General topic is byte-identical: no topic minted, none sent, no retry", async () => {
    await bindEnabled(SID);
    // No `message_thread_id` on the way in means none on the way out — General and an
    // ordinary group are the same thing here, and both predate this encoding.
    fake.push(forumText("written in General", 205, null));
    await waitFor(() => runs.length === 1);
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allTexts()[0]!.threadId).toBeUndefined();
    // A send that carried no topic is never retried — one round trip, as before this existed.
    expect(fake.allSendCalls()).toBe(1);
    // The stored chat is the bare id every row written before this feature already holds, so
    // an existing row and a new one are the same string.
    expect(t.deps.messagingRepo.find(SID, "telegram")?.lastChatId).toBe(String(FORUM_CHAT));
  });

  // —— Threads that are not forum topics ——————————————————————————————————————
  // `Message.message_thread_id` is populated "for supergroups and private chats only", which
  // includes an ordinary reply chain; `sendMessage`'s parameter is "for forum supergroups
  // only". Minting one from the former and sending it back fails with `message thread not
  // found` on EVERY outbound message of that binding, permanently — the value is what gets
  // persisted — and the fallback then re-sends, doubling the request rate against Telegram's
  // roughly one-message-a-second per-chat allowance.

  it("mints no topic in a private chat, where a reply to the bot carries a thread id", async () => {
    await bindEnabled(SID);
    // Using Telegram's reply on one of the bot's own messages is the ordinary way to answer
    // it in a DM, and that update carries `message_thread_id`.
    fake.push({
      message_id: 1,
      chat: { id: 123456789, type: "private" },
      message_thread_id: 1,
      text: "reply in a DM",
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allTexts()[0]!.threadId).toBeUndefined();
    expect(fake.allSendCalls()).toBe(1);
    expect(t.deps.messagingRepo.find(SID, "telegram")?.lastChatId).toBe("123456789");
  });

  it("mints no topic in a supergroup that is not a forum", async () => {
    await bindEnabled(SID);
    // The common case under Group Privacy: with it on, the bot mostly sees replies to its own
    // messages — exactly the ones that carry a reply-chain `message_thread_id`.
    fake.push({
      message_id: 500,
      chat: { id: -1002233445566, type: "supergroup" },
      message_thread_id: 500,
      text: "reply in a plain supergroup",
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allTexts()[0]!.threadId).toBeUndefined();
    expect(fake.allSendCalls()).toBe(1);
    expect(t.deps.messagingRepo.find(SID, "telegram")?.lastChatId).toBe("-1002233445566");
  });

  it("mints no topic for a reply chain in a forum's General topic", async () => {
    await bindEnabled(SID);
    // A forum, so `is_forum` is set, but General is not a topic: `is_topic_message` is absent
    // and the thread id names the reply chain. Only both flags together mean "forum topic".
    fake.push({
      message_id: 208,
      chat: { id: FORUM_CHAT, type: "supergroup", is_forum: true },
      message_thread_id: 208,
      text: "reply in General",
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allTexts()[0]!.threadId).toBeUndefined();
    expect(fake.allSendCalls()).toBe(1);
    expect(t.deps.messagingRepo.find(SID, "telegram")?.lastChatId).toBe(String(FORUM_CHAT));
  });

  it("keeps sending to a chat id stored before topics existed", async () => {
    await bindEnabled(SID);
    // Every row on disk holds a bare chat id. The parse has to read it as "no topic" rather
    // than reject it, or a working binding breaks on upgrade. Written straight to the column
    // an older build would have written, rather than through the repo, so the fixture states
    // the stored shape and does not track the repo's current signature.
    t.deps.db
      .prepare(
        "UPDATE messaging_bindings SET last_chat_id = ? WHERE session_id = ? AND channel = ?",
      )
      .run(String(FORUM_CHAT), SID, "telegram");
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(200);
    const sent = fake.allTexts().find((x) => x.text === MESSAGING_TEST_MESSAGE)!;
    expect(sent.chatId).toBe(String(FORUM_CHAT));
    expect(sent.threadId).toBeUndefined();
  });

  it("a group message that is nothing but the bot's mention starts no task", async () => {
    await bindEnabled(SID);
    fake.push({
      message_id: 91,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "@penguin_test_bot",
      entities: [{ type: "mention", offset: 0, length: 17 }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allTexts()[0]!.text).toBe(MESSAGING_TEXT_ONLY_NOTICE);
    expect(runs).toHaveLength(0);
  });

  it("a message that is neither text nor photo gets the bilingual notice and starts no task", async () => {
    await bindEnabled(SID);
    // A sticker (or voice, or a document — inbound files stay out of scope): a `message`
    // update with neither `text` nor `photo`.
    fake.push({
      message_id: 21,
      chat: { id: 42424242, type: "private" },
      from: { first_name: "Ada" },
    });
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({
      chatId: "42424242",
      text: MESSAGING_TEXT_ONLY_NOTICE,
    });
    expect(runs).toHaveLength(0);
    // Even a rejected type teaches the bridge where the user is.
    expect(t.deps.messagingRepo.find(SID, "telegram")?.lastChatId).toBe("42424242");
  });

  it("a captioned document still gets the not-supported notice and starts no task", async () => {
    await bindEnabled(SID);
    // The common shape of this: a picture dragged into Telegram uncompressed arrives as a
    // `document`, caption and all, with no `photo` array. The caption is not this message
    // on its own — the file it describes is never downloaded — so falling back to it would
    // run the model on "summarize this for me" with nothing attached.
    fake.push({
      message_id: 22,
      chat: { id: 42424242, type: "private" },
      caption: "summarize this for me",
      from: { first_name: "Ada" },
    });
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({
      chatId: "42424242",
      text: MESSAGING_TEXT_ONLY_NOTICE,
    });
    expect(runs).toHaveLength(0);
  });

  it("an inbound photo becomes an image_url part, downloaded at its largest size", async () => {
    await bindEnabled(SID);
    fake.push(privatePhoto(undefined, 31));
    await waitFor(() => runs.length === 1);
    // No caption: the picture is the whole message, and no text is invented around it.
    expect(runs[0]).toHaveLength(1);
    const part = runs[0]![0]!;
    expect(part.type).toBe("image_url");
    expect(part.image_url).toBe(`data:image/jpeg;base64,${PHOTO_BYTES.toString("base64")}`);
    // The largest variant, not the thumbnails the Bot API lists first, and under the
    // shared inline-image ceiling (which is also Telegram's own bot download ceiling).
    expect(fake.allFileFetches()).toEqual([
      { fileId: "full-1280", maxBytes: INLINE_IMAGE_MAX_BYTES },
    ]);
  });

  it("a photo's caption rides along as the message's text, ahead of the image", async () => {
    await bindEnabled(SID);
    fake.push(privatePhoto("what is wrong with this chart?", 32));
    await waitFor(() => runs.length === 1);
    // Text first, then the image — the web composer's order for a message with an attachment.
    expect(runs[0]!.map((p) => p.type)).toEqual(["text", "image_url"]);
    expect(runs[0]![0]!.text).toBe("what is wrong with this chart?");
    expect(runs[0]![0]!.role).toBe("user");
    expect("sender" in runs[0]![0]!).toBe(false);
    expect(runs[0]![1]!.image_url).toBe(`data:image/jpeg;base64,${PHOTO_BYTES.toString("base64")}`);
  });

  it("strips this bot's own @mention off a photo's caption, as it does off a text message", async () => {
    await bindEnabled(SID);
    // Addressing a bot in a group means naming it, and a picture posted to a group is
    // addressed in its CAPTION — Telegram marks the span in `caption_entities`, the
    // caption's own copy of `entities`.
    fake.push({
      message_id: 34,
      chat: { id: -1002233445566, type: "supergroup" },
      photo: [{ file_id: "full-1280", width: 1280, height: 960 }],
      caption: "@penguin_test_bot what is wrong with this chart?",
      caption_entities: [{ type: "mention", offset: 0, length: 17 }],
      from: { first_name: "Ada" },
    });
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("what is wrong with this chart?");
  });

  it("a photo that cannot be downloaded degrades to a notice, caption and all", async () => {
    await bindEnabled(SID);
    fake.failFileFetch = "getFile failed: file is temporarily unavailable";
    fake.push(privatePhoto("have a look", 33));
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({
      chatId: "42424242",
      text: messagingImageFailedNotice("getFile failed: file is temporarily unavailable"),
    });
    // The caption does NOT run on its own: a question about a picture the model never
    // received would be answered confidently about nothing.
    expect(runs).toHaveLength(0);
  });

  it("sends the files the reply mentions as a photo and a document, after its text", async () => {
    // The Feishu suite carries the whole outbound-file rule (existence, caps, containment);
    // this is the channel half of it — a picture must reach Telegram as a photo, so it
    // renders in the chat, and everything else as a document.
    const ws = await fs.mkdtemp(path.join(t.root, "ws-"));
    await fs.writeFile(path.join(ws, "chart.png"), PHOTO_BYTES);
    await fs.writeFile(path.join(ws, "notes.md"), "hello");
    const row2 = sessionRowOf(SID2, projectId);
    row2.workspace = ws;
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(
      row2,
      echoFakeSession(SID2, runs, "Rendered `chart.png`, notes in `notes.md`."),
    );
    await bindEnabled(SID2, "7000000004:test-secret-FFFF-6666");
    fake.push(privateText("go"));
    await waitFor(() => fake.allSends().length === 3);
    expect(fake.allSends()).toEqual([
      { chatId: "42424242", text: "Rendered `chart.png`, notes in `notes.md`." },
      { kind: "photo", chatId: "42424242", fileName: "chart.png", bytes: PHOTO_BYTES.length },
      { kind: "document", chatId: "42424242", fileName: "notes.md", bytes: 5 },
    ]);
  });

  it("relays each completed assistant message separately, in order, as it completes", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t.deps.manager.adopt(row2, multiMessageFakeSession(SID2, ["step one", "step two"], gate));
    await bindEnabled(SID2, "7000000003:test-secret-EEEE-5555");
    fake.push(privateText("go"));
    // The first message is already in the chat while the run is still running.
    await waitFor(() => fake.allSends().length === 1);
    expect(t.deps.manager.statusOf(SID2)).toBe("running");
    expect(fake.allSends()).toEqual([{ chatId: "42424242", text: "step one" }]);
    release();
    await waitFor(() => fake.allSends().length === 2);
    expect(fake.allSends()).toEqual([
      { chatId: "42424242", text: "step one" },
      { chatId: "42424242", text: "step two" },
    ]);
  });

  it("in a group only the run's first message carries the reply ref", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, multiMessageFakeSession(SID2, ["first", "second"]));
    await bindEnabled(SID2, "7000000004:test-secret-FFFF-6666");
    fake.push({
      message_id: 91,
      chat: { id: -1002233445566, type: "supergroup" },
      text: "ping",
      from: { first_name: "Ada" },
    });
    await waitFor(() => fake.allSends().length === 2);
    // One reply-to anchors the exchange; the follow-up is a plain send into the same chat.
    expect(fake.allSends()).toEqual([
      { chatId: "-1002233445566", text: "first", replyTo: 91 },
      { chatId: "-1002233445566", text: "second" },
    ]);
  });

  it("chunks a long reply under the shared 4000-char cap (inside Telegram's 4096 limit)", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, echoFakeSession(SID2, runs, "x".repeat(9000)));
    await bindEnabled(SID2, "7000000002:test-secret-DDDD-4444");
    fake.push(privateText("long one"));
    await waitFor(() => fake.allSends().length >= 3);
    const sends = fake.allTexts();
    expect(sends.map((s) => s.text.length)).toEqual([4000, 4000, 1000]);
    expect(sends.every((s) => s.chatId === "42424242")).toBe(true);
    expect(sends.map((s) => s.text).join("")).toBe("x".repeat(9000));
  });

  it("connect drains the dark-period backlog: only messages after enabling reach the Session", async () => {
    await api.put(BASE(SID), { botToken: TOKEN });
    // Messages sent while the binding was saved-but-disabled pile up server-side …
    fake.push(privateText("sent while dark", 1));
    fake.push(privateText("also dark", 2));
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "connected");
    // … and are skipped by the connect-time drain; only live traffic starts tasks.
    fake.push(privateText("live", 3));
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("live");
  });

  it("poll failures flip the status to error once and recovery re-probes back to connected", async () => {
    await bindEnabled(SID);
    await waitFor(() => fake.lastClient().parked);
    // Break the loop: the parked poll resolves with a message, the next poll fails, and
    // the recovery probe keeps failing until the outage ends.
    fake.failPolls = 1;
    fake.failGetMe = "getUpdates failed: ECONNRESET";
    fake.push(privateText("before the outage", 5));
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "error");
    fake.failGetMe = null;
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "connected");
    // The message delivered ahead of the failure was processed; recovery kept the offset,
    // so it does not re-deliver.
    await waitFor(() => runs.length === 1);
    fake.push(privateText("after recovery", 6));
    await waitFor(() => runs.length === 2);
    expect(runs.map((r) => r[0]!.text)).toEqual(["before the outage", "after recovery"]);
  });

  it("start() connects an enabled telegram binding with the stored token", async () => {
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "telegram",
      accountId: "7000000001",
      config: { botToken: TOKEN },
    });
    t.deps.messagingRepo.setEnabled(SID, "telegram", true);
    await t.deps.messaging.start();
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "connected");
    expect(fake.lastClient().creds.botToken).toBe(TOKEN);
    await waitFor(() => fake.lastClient().parked);
    t.deps.messaging.stop();
    expect(fake.lastClient().sawAbort).toBe(true);
  });

  it("the same Telegram message delivered under two update ids starts one Task", async () => {
    // What two pollers on one token do: each carries its own offset, so the same chat
    // message reaches the bridge twice wrapped in different updates. The dedupe key is
    // Telegram's own `chatId:message_id`, which is identical across both.
    await bindEnabled(SID);
    fake.push(privateText("deploy the build", 11));
    await waitFor(() => runs.length === 1);
    fake.push(privateText("deploy the build", 11));
    await settle(80);
    expect(runs).toHaveLength(1);
    // A different message with the same text is a different message.
    fake.push(privateText("deploy the build", 12));
    await waitFor(() => runs.length === 2);
    expect(runs.map((r) => r[0]!.text)).toEqual(["deploy the build", "deploy the build"]);
  });

  it("two syncs racing leave exactly one live poller (a second one would 409 the first)", async () => {
    await api.put(BASE(SID), { botToken: TOKEN });
    t.deps.messagingRepo.setEnabled(SID, "telegram", true);
    // The state toggle and a credential save both call sync(); nothing serialises them.
    // Telegram allows one getUpdates per token, so a leftover poller does not merely waste
    // a socket — it takes the live one's polls away with a 409.
    await Promise.all([t.deps.messaging.sync(SID), t.deps.messaging.sync(SID)]);
    await waitFor(() => t.deps.messaging.statusOf(SID, "telegram").state === "connected");
    await waitFor(() => fake.clients.filter((c) => c.parked).length === 1);
    expect(fake.clients.length).toBeGreaterThan(1);
    expect(fake.clients.filter((c) => c.parked)).toHaveLength(1);
    // And an inbound message starts one Task, not one per surviving poller.
    fake.push(privateText("hello once", 7));
    await waitFor(() => runs.length === 1);
    await settle(40);
    expect(runs).toHaveLength(1);
  });

  it("the session list marks a telegram-ENABLED row with messagingChannel telegram", async () => {
    await bindEnabled(SID);
    const res = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; messagingChannel?: string }>;
    };
    expect(body.sessions.find((s) => s.sessionId === SID)?.messagingChannel).toBe("telegram");
  });
});

// ---------------------------------------------------------------------------
// The conflict path: what a second poller on the same bot token does to the loop.
// Driven against the connector directly (no app, no HTTP) so a whole outage runs in
// milliseconds and the backoff the loop *would* sleep is observable.
// ---------------------------------------------------------------------------

/** Telegram's 409, verbatim, as the Bot API sends it when a second getUpdates takes over. */
const CONFLICT_DESCRIPTION =
  "Conflict: terminated by other getUpdates request; make sure that only one bot instance is running";

/** A bot client whose getMe always answers and whose getUpdates can be made to conflict. */
class ConflictBotClient implements TelegramBotClient {
  getMeCalls = 0;
  webhookInfoCalls = 0;
  pollCalls = 0;
  /** getUpdates rejects with the 409 while this is true. */
  conflict = false;
  /** Rejects the parked long poll (what Telegram does to the loser of the conflict). */
  private parkedReject: ((err: Error) => void) | null = null;

  constructor(
    readonly creds: TelegramCredentials,
    private readonly t: ConflictTransport,
  ) {}

  async getMe(): Promise<TelegramBotUser> {
    this.getMeCalls++;
    return { id: 7000000001, first_name: "Penguin Test", username: "penguin_test_bot" };
  }
  async getWebhookInfo(): Promise<TelegramWebhookInfo> {
    this.webhookInfoCalls++;
    return { url: this.t.webhookUrl };
  }
  async sendMessage(): Promise<void> {}
  getFileBytes(): Promise<TelegramFileBytes> {
    throw new Error("this outage suite never downloads a file");
  }
  async sendPhoto(): Promise<void> {}
  async sendDocument(): Promise<void> {}
  getUpdates(args: {
    offset?: number;
    timeoutSec: number;
    signal: AbortSignal;
  }): Promise<TelegramUpdate[]> {
    this.pollCalls++;
    if (this.conflict)
      return Promise.reject(new Error(`getUpdates failed: ${CONFLICT_DESCRIPTION}`));
    if (args.timeoutSec === 0) return Promise.resolve([]);
    return new Promise((_resolve, reject) => {
      this.parkedReject = reject;
      args.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  }
  /** A second poller takes over: every poll from here on conflicts, parked one included. */
  startConflicting(): void {
    this.conflict = true;
    this.parkedReject?.(new Error(`getUpdates failed: ${CONFLICT_DESCRIPTION}`));
  }
}

class ConflictTransport implements TelegramTransport {
  readonly clients: ConflictBotClient[] = [];
  /** The webhook registered on the bot; the empty string means none, as the Bot API encodes it. */
  webhookUrl = "";
  createClient(creds: TelegramCredentials): ConflictBotClient {
    const client = new ConflictBotClient(creds, this);
    this.clients.push(client);
    return client;
  }
}

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("telegram poll loop under a persistent 409", () => {
  /**
   * Builds a connector whose backoff is instant but which records the delay the shipped
   * exponential curve would have slept, so a test can assert the curve without waiting on it.
   */
  function conflictConnector(): {
    connector: TelegramConnector;
    transport: ConflictTransport;
    backoff: number[];
  } {
    const transport = new ConflictTransport();
    const backoff: number[] = [];
    const connector = new TelegramConnector(transport, {
      retryDelayMs: (failures) => {
        backoff.push(Math.min(1000 * 2 ** (failures - 1), 60_000));
        return 1;
      },
    });
    return { connector, transport, backoff };
  }

  it("reports once and walks the backoff up, instead of re-polling every second forever", async () => {
    const { connector, transport, backoff } = conflictConnector();
    let errors = 0;
    let readies = 0;
    const conn = await connector.connect(
      { botToken: TOKEN },
      {
        onMessage: async () => {},
        onReady: () => {
          readies++;
        },
        onError: () => {
          errors++;
        },
      },
    );
    const bot = transport.clients[0]!;
    await waitFor(() => readies === 1);
    // A second program takes the token over. getMe keeps answering throughout — it is not
    // the call that conflicts — so nothing but a real getUpdates may end the outage.
    bot.startConflicting();
    await settle(150);
    conn.close();
    // One outage, one report, one error record. Before the fix this fired on every cycle.
    expect(errors).toBe(1);
    expect(readies).toBe(1);
    // The curve climbs to its ceiling. Before the fix the getMe-gated recovery reset the
    // counter every cycle, so this was [1000] and the loop hammered getUpdates at 1 Hz.
    expect(backoff.length).toBeGreaterThan(3);
    expect(backoff[0]).toBe(1000);
    expect(backoff.at(-1)).toBeGreaterThan(1000);
    expect(Math.max(...backoff)).toBeLessThanOrEqual(60_000);
  });

  it("recovers as soon as getUpdates stops conflicting, and fires onReady again", async () => {
    const { connector, transport } = conflictConnector();
    const inbound: string[] = [];
    let errors = 0;
    let readies = 0;
    const conn = await connector.connect(
      { botToken: TOKEN },
      {
        onMessage: async (msg) => {
          inbound.push(msg.text ?? "");
        },
        onReady: () => {
          readies++;
        },
        onError: () => {
          errors++;
        },
      },
    );
    const bot = transport.clients[0]!;
    await waitFor(() => readies === 1);
    bot.startConflicting();
    await waitFor(() => errors === 1);
    bot.conflict = false;
    await waitFor(() => readies === 2);
    expect(errors).toBe(1);
    conn.close();
    expect(inbound).toEqual([]);
  });

  it("probes for a webhook once per connection, before the first poll", async () => {
    const { connector, transport } = conflictConnector();
    let readies = 0;
    const conn = await connector.connect(
      { botToken: TOKEN },
      {
        onMessage: async () => {},
        onReady: () => {
          readies++;
        },
        onError: () => {},
      },
    );
    const bot = transport.clients[0]!;
    await waitFor(() => readies === 1);
    expect(bot.webhookInfoCalls).toBe(1);
    // A bot that answered "no webhook" is not asked again by a conflict-and-recover cycle.
    bot.startConflicting();
    await settle(30);
    bot.conflict = false;
    await waitFor(() => readies === 2);
    expect(bot.webhookInfoCalls).toBe(1);
    conn.close();
  });

  it("names the registered webhook and leaves the bot alone, then recovers once it is gone", async () => {
    const { connector, transport } = conflictConnector();
    const errors: string[] = [];
    let readies = 0;
    // The bot is pointed at a webhook before this connection is made.
    transport.webhookUrl = "https://hooks.example.test/telegram/abc123";
    const conn = await connector.connect(
      { botToken: TOKEN },
      {
        onMessage: async () => {},
        onReady: () => {
          readies++;
        },
        onError: (err) => {
          errors.push(err instanceof Error ? err.message : String(err));
        },
      },
    );
    await waitFor(() => errors.length === 1);
    // The URL is the whole point: "a webhook is set" does not say which one to go remove.
    expect(errors[0]).toContain("https://hooks.example.test/telegram/abc123");
    expect(errors[0]).toContain("recovers on its own");
    // Nothing was written to the bot, and the loop never got as far as polling.
    expect(transport.clients[0]!.pollCalls).toBe(0);
    expect(readies).toBe(0);

    // The user removes it elsewhere. No re-enable: the next probe passes and polling starts.
    transport.webhookUrl = "";
    await waitFor(() => readies === 1);
    expect(errors).toHaveLength(1);
    conn.close();
  });

  it("close() ends the poll: a closed connection issues no further calls", async () => {
    const { connector, transport } = conflictConnector();
    let readies = 0;
    const conn = await connector.connect(
      { botToken: TOKEN },
      {
        onMessage: async () => {},
        onReady: () => {
          readies++;
        },
        onError: () => {},
      },
    );
    const bot = transport.clients[0]!;
    await waitFor(() => readies === 1);
    conn.close();
    await settle(30);
    const pollsAtClose = bot.pollCalls;
    await settle(60);
    expect(bot.pollCalls).toBe(pollsAtClose);
  });
});

describe("telegram transport error mapping", () => {
  /** Runs one transport call against a stubbed fetch and returns the error it throws. */
  async function callWithBody(
    body: unknown,
    run: (bot: TelegramBotClient) => Promise<unknown>,
  ): Promise<string> {
    // Through the transport's own fetch seam, not the global: the production transport
    // calls undici's fetch on purpose (see telegram-api's TelegramFetch), so replacing
    // `globalThis.fetch` would leave it talking to the real Bot API.
    const stub = (async () =>
      new Response(JSON.stringify(body), {
        status: 409,
        headers: { "content-type": "application/json" },
      })) as unknown as TelegramTransportOpts["fetch"];
    try {
      const bot = createTelegramTransport({ fetch: stub }).createClient({ botToken: TOKEN });
      await run(bot);
      return "";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  it("leads a getUpdates conflict with the action, not with Telegram's wording", async () => {
    const message = await callWithBody(
      { ok: false, error_code: 409, description: CONFLICT_DESCRIPTION },
      (bot) => bot.getUpdates({ timeoutSec: 0, signal: new AbortController().signal }),
    );
    // The first words survive the status line's truncation, and they name what to do.
    expect(message).toContain("another program is already polling this bot");
    expect(message).toContain("(code 409)");
    expect(message).not.toContain("Conflict: terminated");
  });

  it("names a leftover webhook as the reason polling is blocked", async () => {
    const message = await callWithBody(
      {
        ok: false,
        error_code: 409,
        description: "Conflict: can't use getUpdates method while webhook is active",
      },
      (bot) => bot.getUpdates({ timeoutSec: 0, signal: new AbortController().signal }),
    );
    expect(message).toContain("a webhook is set on this bot");
  });

  it("passes any other Bot API description through unchanged", async () => {
    const message = await callWithBody(
      { ok: false, error_code: 401, description: "Unauthorized" },
      (bot) => bot.getMe(),
    );
    expect(message).toBe("getMe failed: Unauthorized (code 401)");
  });

  it("never echoes the bot token, which the request URL embeds", async () => {
    const message = await callWithBody(
      { ok: false, error_code: 409, description: CONFLICT_DESCRIPTION },
      (bot) => bot.getUpdates({ timeoutSec: 0, signal: new AbortController().signal }),
    );
    expect(message).not.toContain(TOKEN);
  });
});
