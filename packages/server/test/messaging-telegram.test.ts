/**
 * Telegram messaging tests — the mirror of messaging.test.ts for the second channel, and
 * the proof the connector seam holds: the /api/sessions/:id/messaging/telegram routes
 * (token masking + keep-on-blank, bot-id identity 409, the save/enable split, the getMe
 * probe surfacing the bot username), the channel-agnostic GET the channel-aware editor
 * reads, and the connector's long-poll loop through a fake Bot API transport — offset
 * advancement, the connect-time backlog drain, inbound routing as plain user input,
 * task-end mirroring with reply threading in groups, 4096-safe chunking, non-text
 * notices, and poll-failure status flips. No test opens real network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage, TextPayload } from "@prismshadow/penguin-core";
import type {
  FeishuBindingResponse,
  MessagingBindingsResponse,
  TelegramBindingResponse,
  TelegramTestResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import {
  MESSAGING_TEXT_ONLY_NOTICE,
  MESSAGING_TEST_MESSAGE,
} from "../src/runtime/messaging/bridge.js";
import type {
  TelegramBotClient,
  TelegramBotUser,
  TelegramCredentials,
  TelegramUpdate,
} from "../src/runtime/messaging/telegram-api.js";
import { telegramBotIdOf } from "../src/runtime/messaging/telegram-connector.js";
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
}

class FakeBotClient implements TelegramBotClient {
  readonly sends: SentMessage[] = [];
  getMeCalls = 0;
  /** A long poll is currently parked waiting for an update. */
  parked = false;
  /** A parked long poll was ended by the connection's abort (the close path ran). */
  sawAbort = false;
  constructor(
    readonly creds: TelegramCredentials,
    private readonly t: FakeTelegramTransport,
  ) {}

  async getMe(): Promise<TelegramBotUser> {
    this.getMeCalls++;
    if (this.t.failGetMe !== null) throw new Error(this.t.failGetMe);
    return {
      id: Number(telegramBotIdOf(this.creds.botToken) ?? "0"),
      first_name: "Penguin Test",
      username: "penguin_test_bot",
    };
  }

  async sendMessage(args: {
    chatId: string;
    text: string;
    replyToMessageId?: number;
  }): Promise<void> {
    if (this.t.failSend !== null) throw new Error(this.t.failSend);
    this.sends.push({
      chatId: args.chatId,
      text: args.text,
      ...(args.replyToMessageId !== undefined ? { replyTo: args.replyToMessageId } : {}),
    });
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
  /** Fails this many upcoming getUpdates calls. */
  failPolls = 0;
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

  allSends(): SentMessage[] {
    return this.clients.flatMap((c) => c.sends);
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

/** Fake Session: records each run's input payloads and replies with a fixed assistant text. */
function echoFakeSession(
  sessionId: string,
  runs: TextPayload[][],
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
      runs.push(input.map((m) => m.payload as TextPayload));
      yield assistantText(reply);
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
  let runs: TextPayload[][];

  /** Save the token, then flip the toggle on and wait for the poll loop's handshake. */
  const bindEnabled = async (sid: string, botToken = TOKEN) => {
    expect((await api.put(BASE(sid), { botToken })).status).toBe(200);
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sid, "telegram").state === "connected");
  };

  beforeEach(async () => {
    fake = new FakeTelegramTransport();
    t = await createTestApp({
      telegramTransport: fake,
      telegramRetryDelayMs: () => 1,
      feishuSdk: new FakeFeishuSdk(),
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

  it("one binding per bot: the same numeric id under a rotated secret still 409s", async () => {
    await api.put(BASE(SID), { botToken: TOKEN });
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    // Different secret half, same id half: the identity is the id, not the whole token.
    const res = await api.put(BASE(SID2), { botToken: "7000000001:other-secret-CCCC" });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "telegram_bot_in_use",
    );
    expect(t.deps.messagingRepo.find(SID2, "telegram")).toBeNull();
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

  it("non-text messages get the bilingual text-only reply and start no task", async () => {
    await bindEnabled(SID);
    // A photo message: a `message` update with no `text` field.
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

  it("chunks a long reply under the shared 4000-char cap (inside Telegram's 4096 limit)", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, echoFakeSession(SID2, runs, "x".repeat(9000)));
    await bindEnabled(SID2, "7000000002:test-secret-DDDD-4444");
    fake.push(privateText("long one"));
    await waitFor(() => fake.allSends().length >= 3);
    const sends = fake.allSends();
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

  it("the session list marks a telegram-ENABLED row with messagingChannel telegram", async () => {
    await bindEnabled(SID);
    const res = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; messagingChannel?: string }>;
    };
    expect(body.sessions.find((s) => s.sessionId === SID)?.messagingChannel).toBe("telegram");
  });
});
