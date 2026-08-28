/**
 * WeChat messaging tests — the fourth channel's mirror of messaging.test.ts, over a fake
 * transport (the wire itself is messaging-wechat-transport.test.ts's).
 *
 * Two halves. The ordinary one repeats what the other channels already pin, because the
 * route wiring is per-channel even where the behaviour is not: token masking, the bot id as
 * the account identity and the enable-time 409 it collides on, the save/enable split, the
 * channel-agnostic GET, the credential probe.
 *
 * The half that only exists here follows from this channel having NO typed credential. Its
 * PUT carries preferences alone and refuses to create a binding; its test endpoint takes no
 * body; and its inbound side is a long poll whose FIRST answer is a drain, so a binding
 * switched on after a week dark does not replay that week as a task flood. Media is the
 * other difference worth its own tests: pictures and files travel in both directions here,
 * which no other channel in this product manages.
 *
 * No test opens a socket.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  MessagingBindingsResponse,
  WeChatBindingResponse,
  WeChatTestResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import {
  MESSAGING_TEST_MESSAGE,
  MESSAGING_UNSUPPORTED_NOTICE,
} from "../src/runtime/messaging/bridge.js";
import { MessagingMediaTooLargeError } from "../src/runtime/messaging/media.js";
import type {
  WeChatBotClient,
  WeChatCredentials,
  WeChatInboundEvent,
  WeChatMediaRef,
  WeChatOutboundFile,
  WeChatSendArgs,
  WeChatTransport,
  WeChatUpdates,
} from "../src/runtime/messaging/wechat-api.js";
import { WECHAT_API_BASE } from "../src/runtime/messaging/wechat-api.js";
import {
  WeChatConnector,
  chatOfWeChatReplyRef,
  wechatConfigOf,
  wechatRetryDelayMs,
} from "../src/runtime/messaging/wechat-connector.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-28-11-00-00-w9100001";
const SID2 = "session-2026-08-28-11-00-01-w9100002";
const BASE = (sid: string) => `/api/sessions/${sid}/messaging/wechat`;
const PROJECT = "birder-default_project";

const BOT_ID = "bot_9001";
const BOT_TOKEN = "scan-issued-token-XYZ";
const SCANNER = "ilink_user_aaa";
const USER = "ilink_user_bbb";

/** A stored config exactly as a completed scan writes one. */
const SCANNED_CONFIG = {
  botId: BOT_ID,
  botToken: BOT_TOKEN,
  baseUrl: WECHAT_API_BASE,
  userId: SCANNER,
};

/** PNG magic bytes, so the connector's sniff answers `image/png` from the bytes alone. */
const IMAGE_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("pretend this is a chart"),
]);
const FILE_BYTES = Buffer.from("%PDF-1.7 a report");

// ---------------------------------------------------------------------------
// Fake transport: answers polls the test feeds it, and records every send.
// ---------------------------------------------------------------------------

type Send =
  | { kind: "text"; args: WeChatSendArgs }
  | { kind: "image"; args: WeChatSendArgs; file: WeChatOutboundFile }
  | { kind: "file"; args: WeChatSendArgs; file: WeChatOutboundFile };

class FakeWeChatClient implements WeChatBotClient {
  readonly sends: Send[] = [];
  readonly cursors: string[] = [];
  readonly fetches: Array<{ ref: WeChatMediaRef; maxBytes: number; what: string }> = [];
  /** Whether each poll asked for a drain, in order — the first should and no later one may. */
  readonly drains: boolean[] = [];
  credentialChecks = 0;
  polls = 0;
  /** Batches waiting to be served, oldest first. */
  private readonly queue: WeChatInboundEvent[][] = [];
  private wake: (() => void) | null = null;

  constructor(
    readonly creds: WeChatCredentials,
    private readonly t: FakeWeChatTransport,
  ) {}

  async checkCredentials(): Promise<void> {
    this.credentialChecks += 1;
    if (this.t.failAuth !== null) throw new Error(this.t.failAuth);
  }

  async getUpdates({
    cursor,
    signal,
    drain = false,
  }: {
    cursor: string;
    signal: AbortSignal;
    drain?: boolean;
  }): Promise<WeChatUpdates> {
    this.polls += 1;
    this.cursors.push(cursor);
    this.drains.push(drain);
    if (this.t.failPoll !== null) throw new Error(this.t.failPoll);
    const queued = this.queue.shift();
    if (queued !== undefined) return { messages: queued, cursor: `cursor-${this.polls}` };
    // A drain asks only for what the platform is already holding, so it comes back at once —
    // empty when there is nothing. A long poll PARKS, which is what production does and what
    // makes the readiness test below meaningful.
    if (drain && !this.t.stallPolls) return { messages: [], cursor: `cursor-${this.polls}` };
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    if (signal.aborted) throw new Error("connection closed");
    return { messages: this.queue.shift() ?? [], cursor: `cursor-${this.polls}` };
  }

  async sendText(args: WeChatSendArgs): Promise<void> {
    if (this.t.failSend !== null) throw new Error(this.t.failSend);
    this.sends.push({ kind: "text", args });
  }
  async sendImage(args: WeChatSendArgs & { file: WeChatOutboundFile }): Promise<void> {
    const { file, ...rest } = args;
    this.sends.push({ kind: "image", args: rest, file });
  }
  async sendFile(args: WeChatSendArgs & { file: WeChatOutboundFile }): Promise<void> {
    const { file, ...rest } = args;
    this.sends.push({ kind: "file", args: rest, file });
  }

  async fetchMedia(ref: WeChatMediaRef, maxBytes: number, what: string): Promise<Buffer> {
    this.fetches.push({ ref, maxBytes, what });
    if (this.t.oversizedMedia) throw new MessagingMediaTooLargeError(what, maxBytes);
    return what === "The image" ? IMAGE_BYTES : FILE_BYTES;
  }

  /**
   * Feeds one batch to the poll loop. With no arguments it queues an EMPTY batch, which is
   * how a test makes a parked poll return without delivering anything — the shape the
   * recovery half of the outage test needs.
   */
  push(...events: WeChatInboundEvent[]): void {
    this.queue.push(events);
    this.wake?.();
    this.wake = null;
  }
}

class FakeWeChatTransport implements WeChatTransport {
  readonly clients: FakeWeChatClient[] = [];
  failAuth: string | null = null;
  failSend: string | null = null;
  failPoll: string | null = null;
  /** Every poll parks, the drain included — an idle bot, which is the readiness case. */
  stallPolls = false;
  oversizedMedia = false;

  createClient(creds: WeChatCredentials): FakeWeChatClient {
    const client = new FakeWeChatClient(creds, this);
    this.clients.push(client);
    return client;
  }

  /** The client the poll loop is running on (the connection's, not a send's). */
  poller(): FakeWeChatClient {
    const client = this.clients.find((c) => c.polls > 0);
    if (client === undefined) throw new Error("no fake wechat poll started");
    return client;
  }

  allSends(): Send[] {
    return this.clients.flatMap((c) => c.sends);
  }
  texts(): WeChatSendArgs[] {
    return this.allSends()
      .filter((s) => s.kind === "text")
      .map((s) => s.args);
  }
}

/**
 * One input part as the fake Session records it. Deliberately a loose shape rather than
 * core's payload union: a run's input mixes composer text with `image_url` parts, and the
 * assertions read one field of whichever arrived (the shape messaging-telegram.test.ts uses).
 */
interface InputPayload {
  type?: string;
  role?: string;
  text?: string;
  image_url?: string;
}

/** A plain inbound text message from a fixed user. */
function inboundText(text: string, messageId: string, contextToken = "ctx-1"): WeChatInboundEvent {
  return { userId: USER, messageId, text, contextToken, images: [], files: [] };
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

// ---------------------------------------------------------------------------

describe("wechat config and reply refs", () => {
  it("narrows a stored document and rejects one missing a credential", () => {
    expect(wechatConfigOf({ ...SCANNED_CONFIG })).toEqual(SCANNED_CONFIG);
    expect(() => wechatConfigOf({ botId: BOT_ID })).toThrow(/malformed wechat binding config/);
    expect(() => wechatConfigOf({ botId: "", botToken: BOT_TOKEN })).toThrow();
  });

  it("polls the entry host for a document that names none", () => {
    // A bot with no IDC assignment lives there anyway, so this is the platform's own answer
    // rather than a guess.
    const cfg = wechatConfigOf({ botId: BOT_ID, botToken: BOT_TOKEN });
    expect(cfg.baseUrl).toBe(WECHAT_API_BASE);
    expect(cfg.userId).toBe("");
  });

  it("reads a reply anchor back to the chat it names", () => {
    expect(chatOfWeChatReplyRef(`${USER}:12345`)).toBe(USER);
    expect(() => chatOfWeChatReplyRef("nocolon")).toThrow(/malformed wechat reply ref/);
  });

  it("backs off further after each failure, up to a ceiling", () => {
    expect(wechatRetryDelayMs(1)).toBe(2_000);
    expect(wechatRetryDelayMs(2)).toBe(4_000);
    expect(wechatRetryDelayMs(20)).toBe(60_000);
  });
});

describe("the wechat connector's own seam", () => {
  it("carries text, images and files with no download until the bridge asks", async () => {
    // Handles, not bytes: a redelivery is dropped before anything is transferred.
    const transport = new FakeWeChatTransport();
    const connector = new WeChatConnector(transport, { retryDelayMs: () => 0 });
    const received: Array<{ chatId: string; text: string | null; images: number; files: number }> =
      [];
    const conn = await connector.connect(SCANNED_CONFIG, {
      onMessage: (msg) => {
        received.push({
          chatId: msg.chatId,
          text: msg.text,
          images: msg.images?.length ?? 0,
          files: msg.files?.length ?? 0,
        });
      },
    });
    const client = await waitForPoller(transport);
    client.push({
      userId: USER,
      messageId: "1",
      text: "look at this",
      images: [{ url: "https://cdn/i", aesKey: "a2V5" }],
      files: [{ fileName: "report.pdf", media: { url: "https://cdn/f" } }],
    });
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ chatId: USER, text: "look at this", images: 1, files: 1 });
    expect(client.fetches).toHaveLength(0);
    conn.close();
  });
});

/** Waits for the connector's poll loop to have made its first call. */
async function waitForPoller(transport: FakeWeChatTransport): Promise<FakeWeChatClient> {
  await waitFor(() => transport.clients.some((c) => c.polls > 0));
  return transport.poller();
}

describe("wechat binding routes and the long poll", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let fake: FakeWeChatTransport;
  let runs: InputPayload[][];

  /** Store a scanned config as the scan route would, then flip the toggle on. */
  const bindEnabled = async (sid: string, config: Record<string, unknown> = SCANNED_CONFIG) => {
    t.deps.messagingRepo.upsert({
      sessionId: sid,
      channel: "wechat",
      accountId: String(config.botId),
      config,
    });
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sid, "wechat").state === "connected");
  };

  beforeEach(async () => {
    fake = new FakeWeChatTransport();
    runs = [];
    // A small non-zero backoff rather than zero: the loop retries in a tight cycle during
    // the outage test, and a zero delay would spin without yielding.
    t = await createTestApp({ wechatTransport: fake, wechatRetryDelayMs: () => 5 });
    const { cookie } = await provisionUser(t.app, "birder");
    api = apiClient(t.app, cookie);
    const row = sessionRowOf(SID, PROJECT);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, echoFakeSession(SID, runs));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  // —— Routes ——————————————————————————————————————————————————————————————

  it("the GET masks the token and names the bot id as the account", async () => {
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    const body = (await (await api.get(BASE(SID))).json()) as WeChatBindingResponse;
    expect(body.binding?.channel).toBe("wechat");
    expect(body.binding?.botId).toBe(BOT_ID);
    expect(body.binding?.botTokenMasked).toBe("scan…-XYZ");
    expect(JSON.stringify(body)).not.toContain(BOT_TOKEN);
    // Neither the API host nor the scanner's id is projected: one is infrastructure, the
    // other identifies a person, and the editor renders neither.
    expect(JSON.stringify(body)).not.toContain(SCANNER);
    expect(body.binding?.enabled).toBe(false);
  });

  it("the PUT saves preferences only, and refuses to create a binding at all", async () => {
    // There is no credential to carry, so a PUT before a scan has nothing it could store.
    const bare = await api.put(BASE(SID), { renderMarkdown: false });
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "wechat_token_required",
    );

    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    const res = await api.put(BASE(SID), { renderMarkdown: false, linePerMessage: true });
    expect(res.status).toBe(200);
    const saved = t.deps.messagingRepo.find(SID, "wechat")!;
    expect(saved.renderMarkdown).toBe(false);
    expect(saved.linePerMessage).toBe(true);
    // The rest of the stored document survives a preferences save untouched — the connector
    // needs the host and the scanner's id, and this request knows neither.
    expect(saved.config).toEqual(SCANNED_CONFIG);
  });

  it("the clear flag drops the token, and is refused while the connection is live", async () => {
    await bindEnabled(SID);
    const live = await api.put(BASE(SID), { clearBotToken: true });
    expect(live.status).toBe(409);
    expect(((await live.json()) as { error: { code: string } }).error.code).toBe(
      "messaging_disable_before_clear",
    );

    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.put(BASE(SID), { clearBotToken: true })).status).toBe(200);
    const cleared = t.deps.messagingRepo.find(SID, "wechat")!;
    expect(cleared.config.botToken).toBe("");
    // The row and its identity stay: only a fresh scan can make it connectable again.
    expect(cleared.accountId).toBe(BOT_ID);
    const gate = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(gate.status).toBe(400);
    expect(((await gate.json()) as { error: { code: string } }).error.code).toBe(
      "wechat_token_required",
    );
  });

  it("the bot id is the account: saving never collides, enabling does", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, PROJECT));
    t.deps.manager.adopt(sessionRowOf(SID2, PROJECT), echoFakeSession(SID2, []));
    await bindEnabled(SID);
    // The same bot saved on a second Session is fine; only the connection is exclusive.
    t.deps.messagingRepo.upsert({
      sessionId: SID2,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    const clash = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(clash.status).toBe(409);
    expect(((await clash.json()) as { error: { code: string } }).error.code).toBe(
      "account_enabled_elsewhere",
    );
  });

  it("the credential probe takes no body and reads the stored binding", async () => {
    const bare = await api.post(`${BASE(SID)}/test`, {});
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "wechat_token_required",
    );

    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    const ok = (await (await api.post(`${BASE(SID)}/test`, {})).json()) as WeChatTestResponse;
    expect(ok.ok).toBe(true);
    // The platform names no account, so success carries no label.
    expect("botUsername" in ok).toBe(false);

    fake.failAuth = "invalid bot token";
    const bad = (await (await api.post(`${BASE(SID)}/test`, {})).json()) as WeChatTestResponse;
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("invalid bot token");
  });

  it("joins the channel-agnostic read beside the others", async () => {
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "telegram",
      accountId: "42",
      config: { botToken: "42:tele" },
    });
    const body = (await (
      await api.get(`/api/sessions/${SID}/messaging`)
    ).json()) as MessagingBindingsResponse;
    expect(body.bindings.map((b) => b.binding.channel).sort()).toEqual(["telegram", "wechat"]);
  });

  // —— The long poll ————————————————————————————————————————————————————————

  it("reports the connection ready before any poll has answered", async () => {
    // The reported bug: a long poll is a request held open until something arrives, so a
    // connection reported ready only when one came back sat at `connecting` for the whole
    // window on an idle bot — usable throughout, and saying so nowhere.
    fake.stallPolls = true;
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID, "wechat").state === "connected");
    // Ready on the probe, with the poll behind it still parked and having returned nothing.
    const client = fake.poller();
    expect(client.credentialChecks).toBeGreaterThan(0);
    expect(client.polls).toBeGreaterThan(0);
  });

  it("asks for a drain on the first poll of a connection and on no later one", async () => {
    await bindEnabled(SID);
    const client = fake.poller();
    client.push(inboundText("hello", "m-0"));
    await waitFor(() => client.drains.length >= 2);
    expect(client.drains[0]).toBe(true);
    expect(client.drains.slice(1).every((d) => d === false)).toBe(true);
  });

  it("stops with the credential's own reason when the token is refused", async () => {
    // The probe runs ahead of the poll, so a revoked token reports what is actually wrong
    // instead of an endless poll failure.
    fake.failAuth = "invalid bot token";
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "wechat",
      accountId: BOT_ID,
      config: SCANNED_CONFIG,
    });
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID, "wechat").state === "error");
    expect(t.deps.messaging.statusOf(SID, "wechat").lastError).toContain("invalid bot token");
  });

  it("drops the first poll's backlog and keeps only its cursor", async () => {
    // A binding switched on after a week dark must not replay that week as a task flood.
    fake.createClient = ((creds: WeChatCredentials) => {
      const client = new FakeWeChatClient(creds, fake);
      fake.clients.push(client);
      // Queued before the loop starts, so it is what the FIRST poll returns.
      client.push(inboundText("sent while nothing was connected", "old-1"));
      return client;
    }) as FakeWeChatTransport["createClient"];

    await bindEnabled(SID);
    const client = fake.poller();
    // The drain's cursor is carried into the next poll rather than starting over.
    await waitFor(() => client.cursors.length >= 2);
    expect(client.cursors[0]).toBe("");
    expect(client.cursors[1]).toBe("cursor-1");

    client.push(inboundText("hello", "new-1"));
    await waitFor(() => runs.length === 1);
    // Only the message that arrived after the drain ever became a task.
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]!.text).toBe("hello");
  });

  it("relays an inbound message to the Agent and its reply back, carrying the conversation token", async () => {
    await bindEnabled(SID);
    const client = fake.poller();
    client.push(inboundText("what is the weather?", "m-1", "ctx-42"));
    await waitFor(() => fake.texts().length > 0);
    expect(runs[0]![0]!.text).toBe("what is the weather?");
    expect(fake.texts()[0]).toEqual({ userId: USER, text: "Reply text", contextToken: "ctx-42" });
    // The chat is remembered, which is what the test-message button needs.
    expect(t.deps.messagingRepo.find(SID, "wechat")?.lastChatId).toBe(USER);
  });

  it("sends the fixed test message to the remembered chat", async () => {
    await bindEnabled(SID);
    const noChat = await api.post(`${BASE(SID)}/test-message`, {});
    expect(noChat.status).toBe(409);
    expect(((await noChat.json()) as { error: { code: string } }).error.code).toBe(
      "wechat_no_chat",
    );

    fake.poller().push(inboundText("hi", "m-2"));
    await waitFor(() => fake.texts().length > 0);
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(200);
    expect(fake.texts().at(-1)!.text).toBe(MESSAGING_TEST_MESSAGE);
  });

  it("answers a message carrying nothing at all with the shared not-supported notice", async () => {
    // The one inbound shape this channel cannot read: a recording WeChat could not
    // transcribe. It arrives with no text and no attachment, and the bridge's own notice is
    // what the chat gets — no channel-specific refusal says more than that one already does.
    await bindEnabled(SID);
    fake.poller().push({ userId: USER, messageId: "m-3", text: "", images: [], files: [] });
    await waitFor(() => fake.texts().length > 0);
    expect(fake.texts()[0]!.text).toBe(MESSAGING_UNSUPPORTED_NOTICE);
    expect(runs).toHaveLength(0);
  });

  it("forgets a conversation token when the connection closes", async () => {
    // A token from before a disable would otherwise address a conversation the user ended.
    await bindEnabled(SID);
    fake.poller().push(inboundText("hi", "m-4", "ctx-99"));
    await waitFor(() => fake.texts().length > 0);
    expect(fake.texts()[0]!.contextToken).toBe("ctx-99");

    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    await bindEnabled(SID);
    // The remembered chat survives in the DB; the token does not, so the send goes without.
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(200);
    expect(fake.texts().at(-1)!.contextToken).toBeUndefined();
  });

  it("reports a poll failure as an outage, and recovers on its own when it clears", async () => {
    await bindEnabled(SID);
    const client = fake.poller();
    fake.failPoll = "connection reset";
    // The loop is parked on a long poll, so waking it is what makes it call again and fail.
    client.push();
    await waitFor(() => t.deps.messaging.statusOf(SID, "wechat").state === "error");
    // Recovery needs nothing to arrive: the probe at the top of the cycle reports it, so the
    // connection comes back while the poll behind it is still parked.
    fake.failPoll = null;
    await waitFor(() => t.deps.messaging.statusOf(SID, "wechat").state === "connected");
  });

  // —— Media, in both directions ————————————————————————————————————————————

  it("an inbound picture reaches the model as an image part, typed from its bytes", async () => {
    await bindEnabled(SID);
    fake.poller().push({
      userId: USER,
      messageId: "m-5",
      text: "",
      images: [{ url: "https://cdn/i", aesKey: "a2V5" }],
      files: [],
    });
    await waitFor(() => runs.length === 1);
    expect(runs[0]).toHaveLength(1);
    expect(runs[0]![0]!.type).toBe("image_url");
    // The wire names no type for an image; the bytes are the only source, and conclusive.
    expect(runs[0]![0]!.image_url).toBe(`data:image/png;base64,${IMAGE_BYTES.toString("base64")}`);
    expect(fake.poller().fetches[0]!.what).toBe("The image");
  });

  it("an inbound file reaches the model as a path, keeping the sender's own name", async () => {
    await bindEnabled(SID);
    fake.poller().push({
      userId: USER,
      messageId: "m-6",
      text: "summarize this",
      images: [],
      files: [{ fileName: "report.pdf", media: { url: "https://cdn/f" } }],
    });
    await waitFor(() => runs.length === 1);
    const text = runs[0]![0]!.text!;
    expect(text.startsWith("summarize this\n\n[attached file: ")).toBe(true);
    expect(text).toContain("report.pdf");
  });

  it("refuses an oversized inbound transfer as a size problem the sender can fix", async () => {
    await bindEnabled(SID);
    fake.oversizedMedia = true;
    fake.poller().push({
      userId: USER,
      messageId: "m-7",
      text: "",
      images: [{ url: "https://cdn/i" }],
      files: [],
    });
    await waitFor(() => fake.texts().length > 0);
    expect(fake.texts()[0]!.text).toContain("limit");
    expect(runs).toHaveLength(0);
  });

  it("sends a picture as a picture and any other file as an attachment", async () => {
    // The capability QQ has to refuse outright: outbound media, both kinds, no public URL.
    const connector = new WeChatConnector(fake, { retryDelayMs: () => 0 });
    const outbound = await connector.createClient(SCANNED_CONFIG);
    await outbound.sendImage(USER, { fileName: "chart.png", data: IMAGE_BYTES });
    await outbound.sendFile(USER, { fileName: "report.pdf", data: FILE_BYTES });
    const sends = fake.clients.at(-1)!.sends;
    expect(sends.map((s) => s.kind)).toEqual(["image", "file"]);
    expect(sends[0]!.kind === "image" && sends[0]!.file.data.equals(IMAGE_BYTES)).toBe(true);
    expect(sends[0]!.kind === "image" && sends[0]!.file.fileName).toBe("chart.png");
    expect(sends[1]!.kind === "file" && sends[1]!.file.fileName).toBe("report.pdf");
  });

  it("renders a reply's Markdown when the binding asks, and sends the source when it does not", async () => {
    const connector = new WeChatConnector(fake, { retryDelayMs: () => 0 });
    const outbound = await connector.createClient(SCANNED_CONFIG);
    await outbound.sendText(USER, "# Title\n\n**bold**", { markdown: true });
    await outbound.sendText(USER, "# Title\n\n**bold**");
    const sends = fake.clients.at(-1)!.sends;
    // WeChat reads Markdown itself, so a rendered heading stays a heading.
    expect(sends[0]!.args.text).toBe("# Title\n\n**bold**");
    expect(sends[1]!.args.text).toBe("# Title\n\n**bold**");
    // …and the case where rendering actually changes something: a fifth-level heading has no
    // scale here, so its markers go rather than arriving as five literal `#`.
    await outbound.sendText(USER, "##### Deep", { markdown: true });
    expect(fake.clients.at(-1)!.sends.at(-1)!.args.text).toBe("Deep");
  });
});
