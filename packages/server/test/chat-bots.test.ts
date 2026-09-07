/**
 * The chat-bot host on its own, over the Discord connector and a fake transport: a bot
 * seeded by a plugin, configured and toggled through the settings API, opening a Session per
 * chat on the first message and reusing it, `/new` opening another, replies relayed into the
 * chat (threaded in a server channel), `/approve` deciding a waiting tool call, a redelivered
 * message running once, and the chat table surviving a restart. No test opens real network,
 * and no real Session runs: the task runner is a recorder and replies are published onto the
 * Session's channel by hand, which is exactly what the host reads.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { AppEnv } from "../src/auth/middleware.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { HttpError } from "../src/http/errors.js";
import { ChannelHub } from "../src/runtime/channel.js";
import type { ErrorSink } from "../src/runtime/error-recorder.js";
import {
  CHAT_BOT_APPROVAL_NOTICE,
  CHAT_BOT_NEW_NOTICE,
  CHAT_BOT_NOT_CONFIGURED_NOTICE,
  CHAT_BOT_NOTHING_PENDING_NOTICE,
  ChatBotHost,
  chatBotRoutes,
} from "../src/runtime/messaging/chat-bots.js";
import type { ChatBotHostDeps } from "../src/runtime/messaging/chat-bots.js";
import { DiscordConnector } from "../src/runtime/messaging/discord-connector.js";
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
import { waitFor } from "./helpers.js";

const BOT_ID = "123456789012345678";
const TOKEN = `${Buffer.from(BOT_ID).toString("base64")}.GaBcDe.test-secret-AAAA`;
const DM = "900000000000000001";
const GUILD_CHANNEL = "900000000000000002";
const CONTRIB = { channel: "discord" as const, label: "Discord" };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeClient implements DiscordBotClient {
  readonly sends: DiscordSendArgs[] = [];
  constructor(
    readonly creds: DiscordCredentials,
    private readonly t: FakeTransport,
  ) {}
  async getMe(): Promise<DiscordBotUser> {
    if (this.t.failGetMe !== null) throw new Error(this.t.failGetMe);
    return { id: BOT_ID, username: "penguin_test" };
  }
  async sendMessage(args: DiscordSendArgs): Promise<void> {
    this.sends.push(args);
  }
  async sendFile(_args: DiscordUploadArgs): Promise<void> {}
  async fetchAttachment(): Promise<Buffer> {
    return Buffer.from("");
  }
}

class FakeGateway implements DiscordGatewayConnection {
  closed = false;
  constructor(
    readonly creds: DiscordCredentials,
    private readonly handlers: DiscordGatewayHandlers,
  ) {}
  close(): void {
    this.closed = true;
  }
  fire(msg: DiscordMessage): Promise<void> {
    return Promise.resolve(this.handlers.onMessage(msg));
  }
}

class FakeTransport implements DiscordTransport {
  readonly clients: FakeClient[] = [];
  readonly gateways: FakeGateway[] = [];
  failGetMe: string | null = null;
  createClient(creds: DiscordCredentials): FakeClient {
    const c = new FakeClient(creds, this);
    this.clients.push(c);
    return c;
  }
  async openGateway(creds: DiscordCredentials, handlers: DiscordGatewayHandlers) {
    const gw = new FakeGateway(creds, handlers);
    this.gateways.push(gw);
    handlers.onReady?.();
    return gw;
  }
  lastGateway(): FakeGateway {
    const gw = this.gateways.at(-1);
    if (!gw) throw new Error("no gateway opened");
    return gw;
  }
  allSends(): DiscordSendArgs[] {
    return this.clients.flatMap((c) => c.sends);
  }
}

let nextMessageId = 100;
function dm(content: string, extra: Partial<DiscordMessage> = {}): DiscordMessage {
  return {
    id: String(nextMessageId++),
    channel_id: DM,
    author: { id: "500000000000000001", username: "ada" },
    content,
    type: 0,
    ...extra,
  };
}
function guild(content: string): DiscordMessage {
  return dm(`<@${BOT_ID}> ${content}`, {
    channel_id: GUILD_CHANNEL,
    guild_id: "800000000000000001",
    mentions: [{ id: BOT_ID }],
  });
}

interface Run {
  sessionId: string;
  input: OmniMessage[];
}

/** Everything the host is built over, shared by the tests and inspectable by them. */
class World {
  readonly store = new Map<string, string>();
  readonly transport = new FakeTransport();
  readonly hub = new ChannelHub({ idleMs: 60_000 });
  readonly runs: Run[] = [];
  readonly created: Array<{ projectId: string; agentId: string }> = [];
  readonly decisions: Array<[string, string, string]> = [];
  readonly errors: Array<{ code?: string }> = [];
  readonly rows = new Map<string, SessionRow>();
  root = "";
  private nextSession = 0;

  deps(): ChatBotHostDeps {
    return {
      settings: {
        get: (key) => this.store.get(key) ?? null,
        set: (key, value) => void this.store.set(key, value),
        getAttachmentLimitsMb: () => ({ attachmentMaxMb: 10, attachmentTotalMb: 20 }),
      },
      connectorFor: (channel) => {
        if (channel !== "discord") throw new Error(`no connector for ${channel}`);
        return new DiscordConnector(this.transport);
      },
      channels: this.hub,
      runner: {
        startTask: async (sessionId, input) => {
          this.runs.push({ sessionId, input });
          return { sessionId, queued: false };
        },
      },
      sessions: {
        decideApproval: (sessionId, toolCallId, decision) => {
          this.decisions.push([sessionId, toolCallId, decision]);
          return true;
        },
      },
      sessionCreator: {
        createSession: async ({ projectId, agentId }) => {
          this.created.push({ projectId, agentId });
          const sessionId = `session-bot-${++this.nextSession}`;
          this.rows.set(sessionId, {
            sessionId,
            projectId,
            agentId,
            provider: "custom",
            modelId: "m1",
            workspace: "/tmp/w",
            approvalMode: "allow-all",
            title: null,
            createdAt: new Date().toISOString(),
            lastActiveAt: new Date().toISOString(),
          });
          return { sessionId };
        },
      },
      sessionIndex: { findById: (id) => this.rows.get(id) ?? null },
      agents: { exists: (p, a) => p === "proj" && a === "agent" },
      errors: {
        record: (args: { code?: string }) => void this.errors.push(args),
      } as unknown as ErrorSink,
      root: this.root,
    };
  }

  /** What a Session says as it runs: the state edges and one completed assistant message. */
  publishRun(sessionId: string, texts: string[]): void {
    const ch = this.hub.get(sessionId);
    ch.publish({ type: "task_state", state: "running" }, "server_event");
    for (const text of texts) ch.publish(assistantText(text));
    ch.publish({ type: "task_state", state: "idle" }, "server_event");
  }
}

describe("the chat-bot host", () => {
  let w: World;
  let host: ChatBotHost;

  beforeEach(async () => {
    w = new World();
    w.root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-bots-"));
    host = new ChatBotHost(w.deps());
  });
  afterEach(async () => {
    host.stop();
    w.hub.dispose();
    await fs.rm(w.root, { recursive: true, force: true });
  });

  const seeded = () => {
    host.register("discord", CONTRIB, {
      defaults: { config: { botToken: TOKEN }, projectId: "proj", agentId: "agent", enabled: true },
    });
  };

  it("starts a bot the plugin seeded, and lists it masked", async () => {
    seeded();
    await host.start();
    await waitFor(() => host.statusOf("discord").state === "connected");
    const [info] = host.list();
    expect(info).toMatchObject({
      id: "discord",
      channel: "discord",
      label: "Discord",
      projectId: "proj",
      agentId: "agent",
      configured: true,
      enabled: true,
      chats: 0,
    });
    expect(info!.config.botToken).toBe(`${TOKEN.slice(0, 4)}…${TOKEN.slice(-4)}`);
    expect(JSON.stringify(info)).not.toContain(TOKEN);
    expect(w.transport.lastGateway().creds.botToken).toBe(TOKEN);
  });

  it("never re-enables a bot the operator switched off, whatever the seed says", async () => {
    w.store.set(
      "chatbot:discord",
      JSON.stringify({
        config: { botToken: TOKEN },
        projectId: "proj",
        agentId: "agent",
        enabled: false,
      }),
    );
    seeded();
    await host.start();
    expect(w.transport.gateways).toHaveLength(0);
    expect(host.info("discord").enabled).toBe(false);
  });

  it("saves a credential the connector can read, refuses one it cannot, and gates the toggle", async () => {
    host.register("discord", CONTRIB, {});
    await host.start();
    await expect(host.setEnabled("discord", true)).rejects.toMatchObject({
      code: "chat_bot_config_required",
    });
    await expect(host.save("discord", { config: { botToken: "" } })).rejects.toBeInstanceOf(
      HttpError,
    );
    await expect(
      host.save("discord", { projectId: "proj", agentId: "nope" }),
    ).rejects.toMatchObject({
      code: "agent_not_found",
    });
    const saved = await host.save("discord", { config: { botToken: TOKEN } });
    expect(saved.configured).toBe(true);
    await expect(host.setEnabled("discord", true)).rejects.toMatchObject({
      code: "chat_bot_target_required",
    });
    await host.save("discord", { projectId: "proj", agentId: "agent" });
    // The masked value read back and sent again keeps the stored token.
    await host.save("discord", { config: { botToken: saved.config.botToken } });
    expect(JSON.parse(w.store.get("chatbot:discord")!).config.botToken).toBe(TOKEN);
    const on = await host.setEnabled("discord", true);
    expect(on.enabled).toBe(true);
    await waitFor(() => host.statusOf("discord").state === "connected");
    const off = await host.setEnabled("discord", false);
    expect(off.status.state).toBe("disconnected");
    expect(w.transport.lastGateway().closed).toBe(true);
  });

  it("opens a Session on a chat's first message, reuses it, and relays the reply", async () => {
    seeded();
    await host.start();
    await w.transport.lastGateway().fire(dm("hello"));
    await waitFor(() => w.runs.length === 1);
    expect(w.created).toEqual([{ projectId: "proj", agentId: "agent" }]);
    const sessionId = w.runs[0]!.sessionId;
    expect((w.runs[0]!.input[0]!.payload as { text: string }).text).toBe("hello");
    expect(host.info("discord").chats).toBe(1);

    w.publishRun(sessionId, ["Hi **there**"]);
    await waitFor(() => w.transport.allSends().length === 1);
    // A direct chat: a plain send, Markdown rendered (the same text for a plain sentence).
    expect(w.transport.allSends()).toEqual([{ channelId: DM, content: "Hi **there**" }]);

    await w.transport.lastGateway().fire(dm("and again"));
    await waitFor(() => w.runs.length === 2);
    expect(w.runs[1]!.sessionId).toBe(sessionId);
    expect(w.created).toHaveLength(1);
  });

  it("/new opens a fresh Session for the chat, with or without a message behind it", async () => {
    seeded();
    await host.start();
    const gw = w.transport.lastGateway();
    await gw.fire(dm("first"));
    await waitFor(() => w.runs.length === 1);
    await gw.fire(dm("/new start over"));
    await waitFor(() => w.runs.length === 2);
    expect(w.created).toHaveLength(2);
    expect(w.runs[1]!.sessionId).not.toBe(w.runs[0]!.sessionId);
    expect((w.runs[1]!.input[0]!.payload as { text: string }).text).toBe("start over");

    await gw.fire(dm("/new"));
    await waitFor(() => w.transport.allSends().some((s) => s.content === CHAT_BOT_NEW_NOTICE));
    expect(host.info("discord").chats).toBe(0);
    await gw.fire(dm("third"));
    await waitFor(() => w.runs.length === 3);
    expect(w.created).toHaveLength(3);
  });

  it("threads a run's first reply onto the inbound message in a server channel, then sends plainly", async () => {
    seeded();
    await host.start();
    const asked = guild("what now?");
    await w.transport.lastGateway().fire(asked);
    await waitFor(() => w.runs.length === 1);
    expect((w.runs[0]!.input[0]!.payload as { text: string }).text).toBe("what now?");
    w.publishRun(w.runs[0]!.sessionId, ["first", "second"]);
    await waitFor(() => w.transport.allSends().length === 2);
    expect(w.transport.allSends()).toEqual([
      { channelId: GUILD_CHANNEL, content: "first", replyToMessageId: asked.id },
      { channelId: GUILD_CHANNEL, content: "second" },
    ]);
  });

  it("tells the chat about a waiting tool call and decides it on /approve or /deny", async () => {
    seeded();
    await host.start();
    const gw = w.transport.lastGateway();
    await gw.fire(dm("run it"));
    await waitFor(() => w.runs.length === 1);
    const sessionId = w.runs[0]!.sessionId;
    const ch = w.hub.get(sessionId);
    ch.publish({ type: "task_state", state: "running" }, "server_event");
    ch.publish({ type: "approval_request", toolCall: { toolCallId: "tc-1" } }, "server_event");
    await waitFor(() => w.transport.allSends().some((s) => s.content === CHAT_BOT_APPROVAL_NOTICE));
    await gw.fire(dm("/approve"));
    await waitFor(() => w.decisions.length === 1);
    expect(w.decisions[0]).toEqual([sessionId, "tc-1", "allow"]);
    // Nothing left waiting: the chat is told rather than left guessing.
    await gw.fire(dm("/deny"));
    await waitFor(() =>
      w.transport.allSends().some((s) => s.content === CHAT_BOT_NOTHING_PENDING_NOTICE),
    );
    expect(w.decisions).toHaveLength(1);
    expect(w.runs).toHaveLength(1);
  });

  it("runs a redelivered message once, and answers a bot with no target with the setup notice", async () => {
    seeded();
    await host.start();
    const gw = w.transport.lastGateway();
    const once = dm("only once");
    await gw.fire(once);
    await gw.fire(once);
    await waitFor(() => w.runs.length === 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(w.runs).toHaveLength(1);

    const bare = new World();
    bare.root = w.root;
    const other = new ChatBotHost(bare.deps());
    other.register("discord", CONTRIB, {
      defaults: { config: { botToken: TOKEN }, enabled: true },
    });
    await other.start();
    try {
      // `enabled` in the seed only counts with a config; a target is still needed to answer,
      // and the toggle is what refuses that — so switch it on the way an operator would.
      await bare.store.set(
        "chatbot:discord",
        JSON.stringify({
          config: { botToken: TOKEN },
          projectId: null,
          agentId: null,
          enabled: true,
        }),
      );
      await other.sync("discord");
      await bare.transport.lastGateway().fire(dm("anyone?"));
      await waitFor(() =>
        bare.transport.allSends().some((s) => s.content === CHAT_BOT_NOT_CONFIGURED_NOTICE),
      );
      expect(bare.created).toHaveLength(0);
    } finally {
      other.stop();
      bare.hub.dispose();
    }
  });

  it("keeps the chat table across a restart, and drops a chat whose Session was deleted", async () => {
    seeded();
    await host.start();
    await w.transport.lastGateway().fire(dm("remember me"));
    await waitFor(() => w.runs.length === 1);
    const sessionId = w.runs[0]!.sessionId;
    host.stop();

    // The plugin seeds the same defaults on every boot; what changed is only the store.
    const again = new ChatBotHost(w.deps());
    again.register("discord", CONTRIB, {
      defaults: { config: { botToken: TOKEN }, projectId: "proj", agentId: "agent", enabled: true },
    });
    await again.start();
    try {
      expect(again.info("discord").chats).toBe(1);
      // A reply completing after the restart still reaches the chat.
      w.publishRun(sessionId, ["still here"]);
      await waitFor(() => w.transport.allSends().some((s) => s.content === "still here"));
      // And the next message reuses the Session rather than opening another.
      await w.transport.lastGateway().fire(dm("more"));
      await waitFor(() => w.runs.length === 2);
      expect(w.runs[1]!.sessionId).toBe(sessionId);

      w.rows.delete(sessionId);
      expect(again.info("discord").chats).toBe(0);
    } finally {
      again.stop();
    }
  });
});

describe("the chat-bot routes", () => {
  let w: World;
  let host: ChatBotHost;

  const appFor = (isAdmin: boolean) => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("user", { userId: "u", isAdmin } as never);
      await next();
    });
    app.onError((err, c) =>
      err instanceof HttpError
        ? c.json({ error: { code: err.code, message: err.message } }, err.status as 400)
        : c.json({ error: { code: "internal", message: String(err) } }, 500),
    );
    app.route("/api/chat-bots", chatBotRoutes(host));
    return app;
  };

  beforeEach(async () => {
    w = new World();
    w.root = await fs.mkdtemp(path.join(os.tmpdir(), "chat-bots-"));
    host = new ChatBotHost(w.deps());
    host.register("discord", CONTRIB, {});
    await host.start();
  });
  afterEach(async () => {
    host.stop();
    w.hub.dispose();
    await fs.rm(w.root, { recursive: true, force: true });
  });

  it("is admin-only, and drives the same host the plugins register into", async () => {
    const member = appFor(false);
    expect((await member.request("/api/chat-bots")).status).toBe(403);

    const admin = appFor(true);
    const list = (await (await admin.request("/api/chat-bots")).json()) as {
      bots: Array<{ id: string }>;
    };
    expect(list.bots.map((b) => b.id)).toEqual(["discord"]);

    const json = (body: unknown) => ({
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const bad = await admin.request("/api/chat-bots/discord", json({ config: { botToken: "" } }));
    expect(bad.status).toBe(400);
    const saved = await admin.request(
      "/api/chat-bots/discord",
      json({ config: { botToken: TOKEN }, projectId: "proj", agentId: "agent" }),
    );
    expect(saved.status).toBe(200);
    const probe = await admin.request("/api/chat-bots/discord/test", {
      ...json({}),
      method: "POST",
    });
    expect((await probe.json()) as { ok: boolean; accountLabel?: string }).toMatchObject({
      ok: true,
      accountLabel: "@penguin_test",
    });
    const on = await admin.request("/api/chat-bots/discord/state", {
      ...json({ enabled: true }),
      method: "POST",
    });
    expect(((await on.json()) as { enabled: boolean }).enabled).toBe(true);
    await waitFor(() => host.statusOf("discord").state === "connected");
    expect((await admin.request("/api/chat-bots/nope")).status).toBe(404);
  });
});
