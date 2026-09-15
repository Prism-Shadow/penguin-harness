/**
 * Discord messaging tests — the fifth channel's mirror of messaging-telegram.test.ts: the
 * /api/sessions/:id/messaging/discord routes (token masking + keep-on-blank, the bot id
 * decoded out of the token as the account identity and the enable-time 409 it collides on,
 * the save/enable split, the `GET /users/@me` probe surfacing the bot handle), and the
 * connector through a fake transport — a direct message as plain user input, the @-mention
 * gate on a server channel and the strip that follows it, bots and system messages dropped,
 * an inbound picture and an inbound file, the voice recording that keeps the notice, replies
 * threaded in a channel and plain in a DM, the 2000-character cap the chunking honours, the
 * plain-text fallback for a rendered reply that outgrows it, and the Markdown subset the
 * renderer emits. No test opens real network.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, matchAttachedFileLine } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  DiscordBindingResponse,
  DiscordTestResponse,
  MessagingBindingsResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { INLINE_IMAGE_MAX_BYTES } from "../src/services/attachment-limits.js";
import {
  MESSAGING_TEST_MESSAGE,
  MESSAGING_UNSUPPORTED_NOTICE,
} from "../src/runtime/messaging/bridge.js";
import { collectUnderCap } from "../src/runtime/messaging/media.js";
import type {
  DiscordBotClient,
  DiscordBotUser,
  DiscordCredentials,
  DiscordGatewayConnection,
  DiscordGatewayHandlers,
  DiscordMessage,
  DiscordSendArgs,
  DiscordTransport,
  DiscordUploadArgs,
} from "../src/runtime/messaging/discord-api.js";
import { DISCORD_MAX_CONTENT_CHARS } from "../src/runtime/messaging/discord-api.js";
import {
  DISCORD_TEXT_CHUNK_CHARS,
  discordBotIdOf,
  stripBotMention,
} from "../src/runtime/messaging/discord-connector.js";
import { discordMarkdownOf } from "../src/runtime/messaging/discord-markdown.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-09-07-10-00-00-d9000001";
const SID2 = "session-2026-09-07-10-00-01-d9000002";
const BASE = (sid: string) => `/api/sessions/${sid}/messaging/discord`;
const BOT_ID = "123456789012345678";
const BOT_ID2 = "223456789012345678";
/** A token whose first segment is the bot id in base64, as the developer portal issues them. */
const tokenFor = (botId: string, secret = "AAAA-1111") =>
  `${Buffer.from(botId).toString("base64")}.GaBcDe.test-secret-${secret}`;
const TOKEN = tokenFor(BOT_ID);
const DM_CHANNEL = "900000000000000001";
const GUILD_CHANNEL = "900000000000000002";
const GUILD = "800000000000000001";

const PHOTO_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);
const FILE_BYTES = Buffer.from("quarterly revenue: 42\n", "utf8");

async function* oneChunk(bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes;
}

// ---------------------------------------------------------------------------
// Fake transport: records sends and uploads, and hands each opened gateway back to the
// test so it can push dispatches. Never opens a socket or a fetch.
// ---------------------------------------------------------------------------

interface Upload {
  channelId: string;
  fileName: string;
  bytes: number;
}

class FakeDiscordClient implements DiscordBotClient {
  readonly sends: DiscordSendArgs[] = [];
  readonly uploads: Upload[] = [];
  readonly fetches: Array<{ url: string; maxBytes: number; what?: string }> = [];
  getMeCalls = 0;
  constructor(
    readonly creds: DiscordCredentials,
    private readonly t: FakeDiscordTransport,
  ) {}

  async getMe(): Promise<DiscordBotUser> {
    this.getMeCalls++;
    if (this.t.failGetMe !== null) throw new Error(this.t.failGetMe);
    return { id: BOT_ID, username: this.t.botUsername };
  }

  async sendMessage(args: DiscordSendArgs): Promise<void> {
    if (this.t.failSend !== null) throw new Error(this.t.failSend);
    this.sends.push(args);
  }

  async sendFile(args: DiscordUploadArgs): Promise<void> {
    this.uploads.push({
      channelId: args.channelId,
      fileName: args.fileName,
      bytes: args.data.length,
    });
  }

  async fetchAttachment(args: { url: string; maxBytes: number; what?: string }): Promise<Buffer> {
    this.fetches.push(args);
    return collectUnderCap(
      oneChunk(this.t.attachmentBytes),
      args.maxBytes,
      args.what ?? "The file",
    );
  }
}

class FakeDiscordGateway implements DiscordGatewayConnection {
  closed = false;
  constructor(
    readonly creds: DiscordCredentials,
    private readonly handlers: DiscordGatewayHandlers,
  ) {}
  close(): void {
    this.closed = true;
  }
  /** Pushes one inbound message, as a MESSAGE_CREATE dispatch would. */
  fire(msg: DiscordMessage): Promise<void> {
    return Promise.resolve(this.handlers.onMessage(msg));
  }
}

class FakeDiscordTransport implements DiscordTransport {
  readonly clients: FakeDiscordClient[] = [];
  readonly gateways: FakeDiscordGateway[] = [];
  failGetMe: string | null = null;
  failSend: string | null = null;
  botUsername = "penguin_test";
  attachmentBytes: Buffer = PHOTO_BYTES;

  createClient(creds: DiscordCredentials): FakeDiscordClient {
    const client = new FakeDiscordClient(creds, this);
    this.clients.push(client);
    return client;
  }

  async openGateway(
    creds: DiscordCredentials,
    handlers: DiscordGatewayHandlers,
  ): Promise<DiscordGatewayConnection> {
    const gw = new FakeDiscordGateway(creds, handlers);
    this.gateways.push(gw);
    handlers.onReady?.();
    return gw;
  }

  lastGateway(): FakeDiscordGateway {
    const gw = this.gateways.at(-1);
    if (!gw) throw new Error("no fake discord gateway was opened");
    return gw;
  }

  lastClient(): FakeDiscordClient {
    const client = this.clients.at(-1);
    if (!client) throw new Error("no fake discord client was created");
    return client;
  }

  allSends(): DiscordSendArgs[] {
    return this.clients.flatMap((c) => c.sends);
  }

  allUploads(): Upload[] {
    return this.clients.flatMap((c) => c.uploads);
  }

  allFetches(): Array<{ url: string; maxBytes: number; what?: string }> {
    return this.clients.flatMap((c) => c.fetches);
  }
}

let nextMessageId = 700;

/** A direct message from a fixed user. */
function dm(content: string, extra: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: String(nextMessageId++),
    channel_id: DM_CHANNEL,
    author: { id: "500000000000000001", username: "ada", global_name: "Ada" },
    content,
    type: 0,
    ...extra,
  };
}

/** A message in a server channel; `mention` puts this bot in the mention list and the text. */
function guildMessage(content: string, mention: boolean, extra: Partial<DiscordMessage> = {}) {
  return dm(mention ? `<@${BOT_ID}> ${content}` : content, {
    channel_id: GUILD_CHANNEL,
    guild_id: GUILD,
    ...(mention ? { mentions: [{ id: BOT_ID }] } : {}),
    ...extra,
  });
}

interface InputPayload {
  type?: string;
  role?: string;
  text?: string;
  image_url?: string;
}

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

describe("discordBotIdOf", () => {
  it("decodes the bot id out of the token's first segment and tolerates a pasted `Bot ` prefix", () => {
    expect(discordBotIdOf(TOKEN)).toBe(BOT_ID);
    expect(discordBotIdOf(`Bot ${TOKEN}`)).toBe(BOT_ID);
    expect(discordBotIdOf(`  ${TOKEN}\n`)).toBe(BOT_ID);
  });

  it("rejects anything that is not three segments with a numeric id in front", () => {
    expect(discordBotIdOf("not-a-token")).toBeNull();
    expect(discordBotIdOf(BOT_ID)).toBeNull();
    expect(discordBotIdOf("aGVsbG8.GaBcDe.secret")).toBeNull(); // "hello", not digits
    expect(discordBotIdOf(`${Buffer.from(BOT_ID).toString("base64")}.only-two`)).toBeNull();
    expect(discordBotIdOf("")).toBeNull();
  });
});

describe("stripBotMention", () => {
  it("cuts the addressing prefix in either spelling and keeps a mention further in", () => {
    expect(stripBotMention(`<@${BOT_ID}> status?`, BOT_ID)).toBe("status?");
    expect(stripBotMention(`  <@!${BOT_ID}>   status?`, BOT_ID)).toBe("status?");
    expect(stripBotMention(`what does <@${BOT_ID}> think?`, BOT_ID)).toBe(
      `what does <@${BOT_ID}> think?`,
    );
    expect(stripBotMention(`<@${BOT_ID2}> not me`, BOT_ID)).toBe(`<@${BOT_ID2}> not me`);
  });
});

describe("discordMarkdownOf", () => {
  it("keeps what the client renders and reshapes what it does not", () => {
    const out = discordMarkdownOf(
      "## Result\n\nRan **2** tests, `all green`.\n\n- one\n- [ ] two\n\n#### Deep\n\n---\n\n| a | b |\n| - | - |\n| 1 | 2 |",
    );
    expect(out).toContain("## Result");
    expect(out).toContain("Ran **2** tests, `all green`.");
    expect(out).toContain("- one\n- ☐ two");
    // A fourth-level heading and a rule are shown as characters by the client.
    expect(out).toContain("**Deep**");
    expect(out).not.toContain("####");
    expect(out).toContain("———");
    // No table syntax: the rows ride a code block, where the pipes line up.
    expect(out).toContain("```\n| a | b |\n| 1 | 2 |\n```");
  });

  it("escapes the model's literal markers outside code, and never inside it", () => {
    expect(discordMarkdownOf("price is 5 * 3 and a_b")).toBe("price is 5 \\* 3 and a\\_b");
    expect(discordMarkdownOf("```js\nconst a = 5 * 3;\n```")).toBe("```js\nconst a = 5 * 3;\n```");
    expect(discordMarkdownOf("[docs](https://example.com/a(b))")).toBe(
      "[docs](https://example.com/a%28b%29)",
    );
    // An unsafe scheme keeps its label and loses the link.
    expect(discordMarkdownOf("[x](javascript:alert(1))")).toBe("x");
  });
});

describe("discord binding routes and connector", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let fake: FakeDiscordTransport;
  let projectId: string;
  let runs: InputPayload[][];

  const bindEnabled = async (sid: string, botToken = TOKEN) => {
    expect((await api.put(BASE(sid), { botToken })).status).toBe(200);
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sid, "discord").state === "connected");
  };

  beforeEach(async () => {
    fake = new FakeDiscordTransport();
    t = await createTestApp({ discordTransport: fake });
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

  it("PUT saves the token only (masked, bot id decoded, disabled, no gateway); blank keeps the stored token", async () => {
    const res = await api.put(BASE(SID), { botToken: TOKEN });
    expect(res.status).toBe(200);
    const body = (await res.json()) as DiscordBindingResponse;
    expect(body.binding?.channel).toBe("discord");
    expect(body.binding?.botId).toBe(BOT_ID);
    expect(body.binding?.botTokenMasked).toBe(`${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(body.binding?.enabled).toBe(false);
    expect(body.status.state).toBe("disconnected");
    expect(fake.gateways).toHaveLength(0);
    expect(t.deps.messagingRepo.find(SID, "discord")?.accountId).toBe(BOT_ID);

    const resave = await api.put(BASE(SID), { botToken: "" });
    expect(resave.status).toBe(200);
    expect(t.deps.messagingRepo.find(SID, "discord")?.config.botToken).toBe(TOKEN);

    t.deps.messagingRepo.delete(SID, "discord");
    const bare = await api.put(BASE(SID), {});
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "discord_token_required",
    );
    const malformed = await api.put(BASE(SID), { botToken: "not-a-token" });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as { error: { code: string } }).error.code).toBe(
      "discord_token_invalid",
    );
  });

  it("POST /state owns the connection: enable opens the gateway with the stored token, disable closes it", async () => {
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(404);
    await api.put(BASE(SID), { botToken: TOKEN });
    const on = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(on.status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID, "discord").state === "connected");
    expect(fake.lastGateway().creds.botToken).toBe(TOKEN);
    const off = await api.post(`${BASE(SID)}/state`, { enabled: false });
    expect(((await off.json()) as DiscordBindingResponse).status.state).toBe("disconnected");
    expect(fake.lastGateway().closed).toBe(true);
  });

  it("the account is the bot id: a reset token saves freely and collides only on enable", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    await bindEnabled(SID);
    const reset = tokenFor(BOT_ID, "BBBB-2222");
    expect((await api.put(BASE(SID2), { botToken: reset })).status).toBe(200);
    expect(t.deps.messagingRepo.find(SID2, "discord")?.accountId).toBe(BOT_ID);
    const blocked = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      "account_enabled_elsewhere",
    );
    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID2, "discord").state === "connected");
    expect(fake.lastGateway().creds.botToken).toBe(reset);
  });

  it("GET /messaging lists the discord config beside another channel's, and the clear flag needs the connection off", async () => {
    await bindEnabled(SID);
    expect(
      (
        await api.put(`/api/sessions/${SID}/messaging/telegram`, {
          botToken: "7000000001:test-secret-AAAA-1111",
        })
      ).status,
    ).toBe(200);
    const body = (await (
      await api.get(`/api/sessions/${SID}/messaging`)
    ).json()) as MessagingBindingsResponse;
    expect(body.bindings.map((b) => b.binding.channel).sort()).toEqual(["discord", "telegram"]);
    const discord = body.bindings.find((b) => b.binding.channel === "discord")!;
    expect(discord.binding.enabled).toBe(true);
    expect(discord.status.state).toBe("connected");

    const blocked = await api.put(BASE(SID), { clearBotToken: true });
    expect(blocked.status).toBe(409);
    await api.post(`${BASE(SID)}/state`, { enabled: false });
    const cleared = (await (
      await api.put(BASE(SID), { clearBotToken: true })
    ).json()) as DiscordBindingResponse;
    expect(cleared.binding?.botTokenMasked).toBeUndefined();
    expect(cleared.binding?.botId).toBe(BOT_ID);
    const on = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(on.status).toBe(400);
    expect(((await on.json()) as { error: { code: string } }).error.code).toBe(
      "discord_token_required",
    );
  });

  it("POST /test probes the bot's own account and surfaces its handle; failures are ok:false", async () => {
    const ok = (await (
      await api.post(`${BASE(SID)}/test`, { botToken: TOKEN })
    ).json()) as DiscordTestResponse;
    expect(ok.ok).toBe(true);
    expect(ok.botUsername).toBe("@penguin_test");
    expect(typeof ok.latencyMs).toBe("number");

    await api.put(BASE(SID), { botToken: TOKEN });
    const stored = (await (await api.post(`${BASE(SID)}/test`, {})).json()) as DiscordTestResponse;
    expect(stored.ok).toBe(true);
    expect(fake.lastClient().creds.botToken).toBe(TOKEN);

    fake.failGetMe = "GET /users/@me failed: 401: Unauthorized — the bot token was rejected";
    const bad = (await (await api.post(`${BASE(SID)}/test`, {})).json()) as DiscordTestResponse;
    expect(bad).toEqual({ ok: false, error: fake.failGetMe });

    t.deps.messagingRepo.delete(SID, "discord");
    const none = await api.post(`${BASE(SID)}/test`, {});
    expect(none.status).toBe(400);
  });

  it("POST /test-message: 404 unbound, 409 discord_no_chat before a chat is known, sends after one", async () => {
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(404);
    await bindEnabled(SID);
    const early = await api.post(`${BASE(SID)}/test-message`, {});
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe(
      "discord_no_chat",
    );
    await fake.lastGateway().fire(dm("hello"));
    await waitFor(() => t.deps.messagingRepo.find(SID, "discord")?.lastChatId === DM_CHANNEL);
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(200);
    expect(fake.allSends()).toContainEqual({
      channelId: DM_CHANNEL,
      content: MESSAGING_TEST_MESSAGE,
    });
  });

  it("a direct message starts an ordinary user task and the reply comes back plain, not threaded", async () => {
    await bindEnabled(SID);
    await fake.lastGateway().fire(dm("how is the build?"));
    await waitFor(() => runs.length === 1);
    const input = runs[0]![0]!;
    expect(input.text).toBe("how is the build?");
    expect(input.role).toBe("user");
    expect("sender" in input).toBe(false);
    const row = t.deps.messagingRepo.find(SID, "discord")!;
    expect(row.lastChatId).toBe(DM_CHANNEL);
    expect(row.lastChatIsDirect).toBe(true);
    await waitFor(() => fake.allSends().length > 0);
    // Rendered as Markdown by default — for a plain sentence that is the same text — and
    // with no reply relation: a direct chat is plain sends throughout.
    expect(fake.allSends()).toEqual([{ channelId: DM_CHANNEL, content: "Reply text" }]);
  });

  it("in a server channel only a message that @-mentions the bot is read, with the mention stripped and the reply threaded", async () => {
    await bindEnabled(SID);
    const gw = fake.lastGateway();
    await gw.fire(guildMessage("ignored chatter", false));
    await new Promise((r) => setTimeout(r, 30));
    expect(runs).toHaveLength(0);
    expect(fake.allSends()).toHaveLength(0);

    const asked = guildMessage("ping from the channel", true);
    await gw.fire(asked);
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("ping from the channel");
    const row = t.deps.messagingRepo.find(SID, "discord")!;
    expect(row.lastChatId).toBe(GUILD_CHANNEL);
    expect(row.lastChatIsDirect).toBe(false);
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toEqual([
      { channelId: GUILD_CHANNEL, content: "Reply text", replyToMessageId: asked.id },
    ]);
  });

  it("drops bots' messages and system messages, and answers a bare mention with the notice", async () => {
    await bindEnabled(SID);
    const gw = fake.lastGateway();
    await gw.fire(dm("from another bot", { author: { id: "1", username: "other", bot: true } }));
    await gw.fire(dm("pinned a message", { type: 6 }));
    await new Promise((r) => setTimeout(r, 30));
    expect(runs).toHaveLength(0);
    expect(fake.allSends()).toHaveLength(0);

    await gw.fire(guildMessage("", true));
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()[0]!.content).toBe(MESSAGING_UNSUPPORTED_NOTICE);
    expect(runs).toHaveLength(0);
  });

  it("an inbound picture becomes an image_url part, downloaded under the inline-image ceiling", async () => {
    await bindEnabled(SID);
    await fake.lastGateway().fire(
      dm("", {
        attachments: [
          {
            id: "a1",
            filename: "chart.png",
            size: PHOTO_BYTES.length,
            url: "https://cdn.example/chart.png?ex=1",
            content_type: "image/png",
          },
        ],
      }),
    );
    await waitFor(() => runs.length === 1);
    expect(runs[0]).toHaveLength(1);
    expect(runs[0]![0]!.type).toBe("image_url");
    expect(runs[0]![0]!.image_url).toBe(`data:image/png;base64,${PHOTO_BYTES.toString("base64")}`);
    expect(fake.allFetches()).toEqual([
      {
        url: "https://cdn.example/chart.png?ex=1",
        maxBytes: INLINE_IMAGE_MAX_BYTES,
        what: "The image",
      },
    ]);
  });

  it("an inbound file lands in the Session scratchpad behind its caption; a voice recording keeps the notice", async () => {
    await bindEnabled(SID);
    fake.attachmentBytes = FILE_BYTES;
    await fake.lastGateway().fire(
      dm("summarize this", {
        attachments: [
          {
            id: "a2",
            filename: "report.pdf",
            size: FILE_BYTES.length,
            url: "https://cdn.example/r.pdf",
          },
        ],
      }),
    );
    await waitFor(() => runs.length === 1);
    const text = runs[0]![0]!.text!;
    expect(text.startsWith("summarize this\n\n[attached file: ")).toBe(true);
    const written = matchAttachedFileLine(text.split("\n\n")[1]!.trim());
    expect(written).not.toBeNull();
    expect(path.basename(written!)).toBe("report.pdf");
    expect((await fs.readFile(written!)).equals(FILE_BYTES)).toBe(true);

    await fake.lastGateway().fire(
      dm("", {
        attachments: [
          {
            id: "a3",
            filename: "voice-message.ogg",
            size: 10,
            url: "https://cdn.example/v.ogg",
            content_type: "audio/ogg",
            duration_secs: 3.2,
          },
        ],
      }),
    );
    await waitFor(() => fake.allSends().some((s) => s.content === MESSAGING_UNSUPPORTED_NOTICE));
    expect(runs).toHaveLength(1);
    expect(fake.allFetches()).toHaveLength(1);
  });

  it("sends the files the reply mentions as uploads, after its text", async () => {
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
    await bindEnabled(SID2, tokenFor(BOT_ID2));
    await fake.lastGateway().fire(dm("go"));
    await waitFor(() => fake.allUploads().length === 2);
    expect(fake.allSends()).toEqual([
      { channelId: DM_CHANNEL, content: "Rendered `chart.png`, notes in `notes.md`." },
    ]);
    expect(fake.allUploads()).toEqual([
      { channelId: DM_CHANNEL, fileName: "chart.png", bytes: PHOTO_BYTES.length },
      { channelId: DM_CHANNEL, fileName: "notes.md", bytes: 5 },
    ]);
  });

  it("chunks a long reply under the channel's own cap, not the shared 4000", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    const lines = Array.from({ length: 120 }, (_, i) => `line ${i} ${"x".repeat(40)}`).join("\n");
    t.deps.manager.adopt(row2, echoFakeSession(SID2, runs, lines));
    await bindEnabled(SID2, tokenFor(BOT_ID2));
    await fake.lastGateway().fire(dm("long one"));
    await waitFor(() => fake.allSends().length >= 3);
    await new Promise((r) => setTimeout(r, 50));
    const sends = fake.allSends();
    expect(sends.every((s) => s.content.length <= DISCORD_TEXT_CHUNK_CHARS)).toBe(true);
    expect(sends.every((s) => s.content.length <= DISCORD_MAX_CONTENT_CHARS)).toBe(true);
    expect(sends.length).toBeGreaterThanOrEqual(3);
    // Cut at line boundaries, nothing lost.
    expect(sends.map((s) => s.content).join("\n")).toBe(lines);
  });

  it("a rendered reply that outgrows the cap goes out plainly in cap-sized pieces, never lost", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    // 750 intraword underscores in 1500 characters: under the chunk size as source, but every
    // one is escaped by the renderer, which lands the rendered form past the platform's 2000.
    const stars = "x_".repeat(750);
    t.deps.manager.adopt(row2, echoFakeSession(SID2, runs, stars));
    await bindEnabled(SID2, tokenFor(BOT_ID2));
    await fake.lastGateway().fire(dm("stars"));
    await waitFor(() => fake.allSends().length >= 1);
    await new Promise((r) => setTimeout(r, 50));
    const sends = fake.allSends();
    expect(sends.every((s) => s.content.length <= DISCORD_MAX_CONTENT_CHARS)).toBe(true);
    expect(sends.map((s) => s.content).join("")).toBe(stars);
  });

  it("renderMarkdown off sends the model's characters as written", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, echoFakeSession(SID2, runs, "#### Deep\n\n5 * 3"));
    expect(
      (await api.put(BASE(SID2), { botToken: tokenFor(BOT_ID2), renderMarkdown: false })).status,
    ).toBe(200);
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID2, "discord").state === "connected");
    await fake.lastGateway().fire(dm("raw"));
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allSends()[0]!.content).toBe("#### Deep\n\n5 * 3");
  });

  it("the session list marks a discord-ENABLED row with messagingChannel discord", async () => {
    await bindEnabled(SID);
    const res = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; messagingChannel?: string }>;
    };
    expect(body.sessions.find((s) => s.sessionId === SID)?.messagingChannel).toBe("discord");
  });
});
