/**
 * The bot on its own, over fake harness mechanisms and a fake Discord connector: seeded from
 * the environment, configured and toggled through its API, opening a Session per chat on the
 * first message and reusing it, `/new` opening another, replies relayed into the chat
 * (threaded in a server channel), `/approve` deciding a waiting tool call, a redelivered
 * message running once, the chat table surviving a restart — and the manifest agreeing with
 * the code half. No test opens real network, and no real Session runs: the task runner is a
 * recorder and replies are published onto the Session's channel by hand.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  MessagingChannelConnector,
  MessagingConnectorHandlers,
  MessagingInboundMessage,
} from "@prismshadow/penguin-server/plugin";
import plugin, {
  APPROVAL_NOTICE,
  BotError,
  CHATS_KEY,
  CONFIG_KEY,
  DiscordBot,
  NEW_NOTICE,
  NOTHING_PENDING_NOTICE,
  NOT_CONFIGURED_NOTICE,
  ROUTES_ID,
  botIdOf,
  chunkReply,
  discordBotRoutes,
  envDefaults,
  safeFileName,
} from "../src/index.js";
import type { BotDeps } from "../src/index.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.test-secret-AAAA";
const DM = "900000000000000001";
const CHANNEL = "900000000000000002";

// ---------------------------------------------------------------------------
// Fakes: the connector seam as the harness would hand it over, and a tiny channel hub
// ---------------------------------------------------------------------------

interface Send {
  to: string;
  text: string;
  reply?: string;
  markdown?: boolean;
}

class FakeConnector implements MessagingChannelConnector {
  readonly channel = "discord" as const;
  readonly textChunkChars = 1900;
  readonly sends: Send[] = [];
  readonly connections: Array<{
    config: Record<string, unknown>;
    handlers: MessagingConnectorHandlers;
    closed: boolean;
  }> = [];
  /** A config the connector refuses (the real one refuses a token it cannot read). */
  refuse: string | null = null;
  async createClient(config: Record<string, unknown>) {
    if (
      typeof config.botToken !== "string" ||
      config.botToken === "" ||
      config.botToken === this.refuse
    ) {
      throw new Error("malformed discord binding config (botToken)");
    }
    return {
      checkCredentials: async () => ({ accountLabel: "@penguin_test" }),
      sendText: async (to: string, text: string, opts?: { markdown?: boolean }) => {
        this.sends.push({ to, text, ...(opts?.markdown ? { markdown: true } : {}) });
      },
      replyText: async (reply: string, text: string, opts?: { markdown?: boolean }) => {
        this.sends.push({
          to: reply.split(":")[0]!,
          text,
          reply,
          ...(opts?.markdown ? { markdown: true } : {}),
        });
      },
      sendImage: async () => {},
      sendFile: async () => {},
    };
  }
  async connect(config: Record<string, unknown>, handlers: MessagingConnectorHandlers) {
    const entry = { config, handlers, closed: false };
    this.connections.push(entry);
    handlers.onReady?.();
    return { close: () => void (entry.closed = true) };
  }
  last() {
    const c = this.connections.at(-1);
    if (!c) throw new Error("no connection opened");
    return c;
  }
  fire(msg: MessagingInboundMessage): Promise<void> {
    return Promise.resolve(this.last().handlers.onMessage(msg));
  }
}

type Listener = (evt: { id: string; event?: string; data: string }) => void;

/** One key → its listeners; `publish` is what the test uses to play a Session's events. */
class FakeHub {
  private readonly listeners = new Map<string, Set<Listener>>();
  private seq = 0;
  get(key: string) {
    return {
      subscribe: (fn: Listener) => {
        const set = this.listeners.get(key) ?? new Set<Listener>();
        set.add(fn);
        this.listeners.set(key, set);
        return () => void set.delete(fn);
      },
    };
  }
  publish(key: string, data: unknown, event?: string): void {
    const evt = {
      id: String(++this.seq),
      ...(event !== undefined ? { event } : {}),
      data: JSON.stringify(data),
    };
    for (const fn of this.listeners.get(key) ?? []) fn(evt);
  }
}

let nextId = 100;
function dm(
  text: string | null,
  extra: Partial<MessagingInboundMessage> = {},
): MessagingInboundMessage {
  const id = String(nextId++);
  return { chatId: DM, chatKind: "direct", messageId: `${DM}:${id}`, text, ...extra };
}
function inChannel(text: string): MessagingInboundMessage {
  const id = String(nextId++);
  return { chatId: CHANNEL, chatKind: "group", messageId: `${CHANNEL}:${id}`, text };
}

class World {
  readonly store = new Map<string, string>();
  readonly connector = new FakeConnector();
  readonly hub = new FakeHub();
  readonly runs: Array<{ sessionId: string; input: OmniMessage[] }> = [];
  readonly created: Array<{ projectId: string; agentId: string }> = [];
  readonly decisions: Array<[string, string, string]> = [];
  readonly errors: Array<{ code?: string }> = [];
  readonly rows = new Set<string>();
  root = "";
  private nextSession = 0;

  deps(defaults?: BotDeps["defaults"]): BotDeps {
    return {
      messaging: {
        connectorFor: (channel: string) =>
          channel === "discord"
            ? this.connector
            : (() => {
                throw new Error(channel);
              })(),
      },
      runner: {
        startTask: async (sessionId: string, input: OmniMessage[]) => {
          this.runs.push({ sessionId, input });
          return { sessionId, queued: false };
        },
      },
      sessions: {
        decideApproval: (sessionId: string, toolCallId: string, decision: "allow" | "deny") => {
          this.decisions.push([sessionId, toolCallId, decision]);
          return true;
        },
      },
      sessionCreator: {
        createSession: async ({ projectId, agentId }: { projectId: string; agentId: string }) => {
          this.created.push({ projectId, agentId });
          const sessionId = `session-bot-${++this.nextSession}`;
          this.rows.add(sessionId);
          return { sessionId };
        },
      },
      sessionIndex: {
        findById: (id: string) => (this.rows.has(id) ? ({ sessionId: id } as never) : null),
      },
      agents: { exists: (p: string, a: string) => p === "proj" && a === "agent" },
      settings: {
        get: (key: string) => this.store.get(key) ?? null,
        set: (key: string, value: string) => void this.store.set(key, value),
        getAttachmentLimitsMb: () => ({ attachmentMaxMb: 10, attachmentTotalMb: 20 }),
      },
      channels: { get: (key: string) => this.hub.get(key) as never },
      errors: { record: (args: { code?: string }) => void this.errors.push(args) } as never,
      paths: { root: this.root },
      log: { line: () => {} },
      ...(defaults !== undefined ? { defaults } : {}),
    };
  }

  /** What a Session says as it runs: the state edges and the completed assistant messages. */
  publishRun(sessionId: string, texts: string[]): void {
    this.hub.publish(sessionId, { type: "task_state", state: "running" }, "server_event");
    for (const text of texts) {
      this.hub.publish(sessionId, {
        type: "model_msg",
        payload: { type: "text", role: "assistant", text },
      });
    }
    this.hub.publish(sessionId, { type: "task_state", state: "idle" }, "server_event");
  }
}

const SEED = { botToken: TOKEN, projectId: "proj", agentId: "agent", enabled: true };
const settle = () => new Promise((r) => setTimeout(r, 10));
async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await settle();
  }
}

describe("the manifest and the seed", () => {
  it("contributes the routes its manifest declares", async () => {
    const pkg = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8")) as {
      penguin: {
        modules: Array<{ name: string; contributes: Record<string, Array<{ id: string }>> }>;
      };
    };
    const [manifest] = pkg.penguin.modules;
    expect(manifest?.name).toBe("DiscordBot");
    expect(manifest?.contributes["HttpModule.routes"]?.[0]?.id).toBe(ROUTES_ID);
    expect(Object.keys(plugin.modules ?? {})).toEqual(["DiscordBot"]);
  });

  it("seeds the bot from the environment, enabled only when the seed is complete", () => {
    expect(envDefaults({})).toEqual({});
    expect(envDefaults({ PENGUIN_DISCORD_BOT_TOKEN: " tok " })).toEqual({ botToken: "tok" });
    expect(
      envDefaults({
        PENGUIN_DISCORD_BOT_TOKEN: "tok",
        PENGUIN_DISCORD_PROJECT: "p",
        PENGUIN_DISCORD_AGENT: "a",
      }),
    ).toEqual({ botToken: "tok", projectId: "p", agentId: "a", enabled: true });
    expect(envDefaults({ PENGUIN_DISCORD_PROJECT: "", PENGUIN_DISCORD_AGENT: "a" })).toEqual({
      agentId: "a",
    });
  });

  it("cuts a reply at paragraphs, then lines, then hard", () => {
    const paras = ["a".repeat(600), "b".repeat(600), "c".repeat(600)].join("\n\n");
    expect(chunkReply(paras, 1300)).toEqual([
      "a".repeat(600) + "\n\n" + "b".repeat(600),
      "c".repeat(600),
    ]);
    expect(chunkReply("x".repeat(2500), 1000).map((s) => s.length)).toEqual([1000, 1000, 500]);
    expect(safeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeFileName("")).toBe("file");
    expect(botIdOf(TOKEN)).toBe("123456789012345678");
    expect(botIdOf("Bot " + TOKEN)).toBe("123456789012345678");
    expect(botIdOf("not-a-token")).toBeNull();
  });
});

describe("the Discord bot", () => {
  let w: World;
  let bot: DiscordBot;

  beforeEach(async () => {
    w = new World();
    w.root = await fs.mkdtemp(path.join(os.tmpdir(), "discord-bot-"));
  });
  afterEach(async () => {
    bot?.stop();
    await fs.rm(w.root, { recursive: true, force: true });
  });

  it("starts from the seed, lists itself masked, and never re-enables a bot switched off", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    expect(bot.info()).toMatchObject({
      configured: true,
      projectId: "proj",
      agentId: "agent",
      enabled: true,
      chats: 0,
    });
    expect(bot.info().botTokenMasked).toBe("MTIz…AAAA");
    expect(bot.statusOf().state).toBe("connected");
    expect(w.connector.last().config).toEqual({ botToken: TOKEN });
    bot.stop();

    w.store.set(
      CONFIG_KEY,
      JSON.stringify({ botToken: TOKEN, projectId: "proj", agentId: "agent", enabled: false }),
    );
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    expect(w.connector.connections).toHaveLength(1);
    expect(bot.info().enabled).toBe(false);
  });

  it("saves a token the connector can read, refuses one it cannot, and gates the toggle", async () => {
    bot = new DiscordBot(w.deps());
    await bot.start();
    await expect(bot.setEnabled(true)).rejects.toMatchObject({ code: "discord_token_required" });
    await expect(bot.save({ botToken: "bad-token" })).rejects.toMatchObject({
      code: "discord_token_invalid",
    });
    w.connector.refuse = TOKEN.replace("AAAA", "BBBB");
    await expect(bot.save({ botToken: TOKEN.replace("AAAA", "BBBB") })).rejects.toMatchObject({
      code: "discord_token_invalid",
    });
    await expect(bot.save({ projectId: "proj", agentId: "nope" })).rejects.toMatchObject({
      code: "agent_not_found",
    });
    const saved = await bot.save({ botToken: TOKEN });
    expect(saved.configured).toBe(true);
    await expect(bot.setEnabled(true)).rejects.toMatchObject({ code: "target_required" });
    await bot.save({ projectId: "proj", agentId: "agent" });
    // The masked value read back and sent again keeps the stored token.
    await bot.save({ botToken: saved.botTokenMasked! });
    expect(JSON.parse(w.store.get(CONFIG_KEY)!).botToken).toBe(TOKEN);
    expect((await bot.setEnabled(true)).enabled).toBe(true);
    expect(bot.statusOf().state).toBe("connected");
    await expect(bot.save({ clearBotToken: true })).rejects.toBeInstanceOf(BotError);
    expect((await bot.setEnabled(false)).status.state).toBe("disconnected");
    expect(w.connector.last().closed).toBe(true);
    expect((await bot.test(TOKEN)).botUsername).toBe("@penguin_test");
  });

  it("opens a Session on a chat's first message, reuses it, and relays the reply", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    await w.connector.fire(dm("hello"));
    expect(w.created).toEqual([{ projectId: "proj", agentId: "agent" }]);
    const sessionId = w.runs[0]!.sessionId;
    expect((w.runs[0]!.input[0]!.payload as { text: string }).text).toBe("hello");
    expect(bot.info().chats).toBe(1);

    w.publishRun(sessionId, ["Hi **there**"]);
    await waitFor(() => w.connector.sends.length === 1);
    expect(w.connector.sends).toEqual([{ to: DM, text: "Hi **there**", markdown: true }]);

    await w.connector.fire(dm("and again"));
    expect(w.runs[1]!.sessionId).toBe(sessionId);
    expect(w.created).toHaveLength(1);
  });

  it("/new opens a fresh Session, with or without a message behind it", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    await w.connector.fire(dm("first"));
    await w.connector.fire(dm("/new start over"));
    expect(w.created).toHaveLength(2);
    expect(w.runs[1]!.sessionId).not.toBe(w.runs[0]!.sessionId);
    expect((w.runs[1]!.input[0]!.payload as { text: string }).text).toBe("start over");
    await w.connector.fire(dm("/new"));
    expect(w.connector.sends.at(-1)?.text).toBe(NEW_NOTICE);
    expect(bot.info().chats).toBe(0);
    await w.connector.fire(dm("third"));
    expect(w.created).toHaveLength(3);
  });

  it("threads a run's first reply onto the inbound message in a server channel, then sends plainly", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    const asked = inChannel("what now?");
    await w.connector.fire(asked);
    w.publishRun(w.runs[0]!.sessionId, ["first", "second"]);
    await waitFor(() => w.connector.sends.length === 2);
    expect(w.connector.sends).toEqual([
      { to: CHANNEL, text: "first", reply: asked.messageId, markdown: true },
      { to: CHANNEL, text: "second", markdown: true },
    ]);
  });

  it("tells the chat about a waiting tool call and decides it on /approve or /deny", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    await w.connector.fire(dm("run it"));
    const sessionId = w.runs[0]!.sessionId;
    w.hub.publish(sessionId, { type: "task_state", state: "running" }, "server_event");
    w.hub.publish(
      sessionId,
      { type: "approval_request", toolCall: { toolCallId: "tc-1" } },
      "server_event",
    );
    await waitFor(() => w.connector.sends.some((s) => s.text === APPROVAL_NOTICE));
    await w.connector.fire(dm("/approve"));
    expect(w.decisions).toEqual([[sessionId, "tc-1", "allow"]]);
    await w.connector.fire(dm("/deny"));
    expect(w.connector.sends.at(-1)?.text).toBe(NOTHING_PENDING_NOTICE);
    expect(w.runs).toHaveLength(1);
  });

  it("runs a redelivered message once, and answers without a target with the setup notice", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    const once = dm("only once");
    await w.connector.fire(once);
    await w.connector.fire(once);
    expect(w.runs).toHaveLength(1);
    bot.stop();

    w.store.set(
      CONFIG_KEY,
      JSON.stringify({ botToken: TOKEN, projectId: null, agentId: null, enabled: true }),
    );
    bot = new DiscordBot(w.deps());
    await bot.start();
    await w.connector.fire(dm("anyone?"));
    expect(w.connector.sends.at(-1)?.text).toBe(NOT_CONFIGURED_NOTICE);
    expect(w.created).toHaveLength(1);
  });

  it("writes an attached file into the Session scratchpad and names it on the message", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    const bytes = Buffer.from("quarterly revenue: 42\n");
    await w.connector.fire(
      dm("summarize this", { files: [{ fileName: "report.pdf", fetch: async () => bytes }] }),
    );
    const text = (w.runs[0]!.input[0]!.payload as { text: string }).text;
    expect(text.startsWith("summarize this\n\n[attached file: ")).toBe(true);
    const written = /\[attached file: (.+)\]/.exec(text)![1]!;
    expect(path.basename(written)).toBe("report.pdf");
    expect((await fs.readFile(written)).equals(bytes)).toBe(true);
    expect(written.startsWith(w.root)).toBe(true);
  });

  it("keeps the chat table across a restart, and drops a chat whose Session was deleted", async () => {
    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    await w.connector.fire(dm("remember me"));
    const sessionId = w.runs[0]!.sessionId;
    bot.stop();

    bot = new DiscordBot(w.deps(SEED));
    await bot.start();
    expect(bot.info().chats).toBe(1);
    w.publishRun(sessionId, ["still here"]);
    await waitFor(() => w.connector.sends.some((s) => s.text === "still here"));
    await w.connector.fire(dm("more"));
    expect(w.runs[1]!.sessionId).toBe(sessionId);
    expect(JSON.parse(w.store.get(CHATS_KEY)!)[DM].sessionId).toBe(sessionId);

    w.rows.delete(sessionId);
    expect(bot.info().chats).toBe(0);
  });

  it("serves its settings API to admins only", async () => {
    bot = new DiscordBot(w.deps());
    await bot.start();
    // The harness sets the signed-in user on the context before the sub-app's handlers run;
    // a wrapper app stands in for that gate here.
    const appFor = (isAdmin: boolean) => {
      const outer = new Hono();
      outer.use("*", async (c, next) => {
        c.set("user" as never, { isAdmin } as never);
        await next();
      });
      outer.route("/api/discord-bot", discordBotRoutes(bot));
      return outer;
    };
    expect((await appFor(false).request("/api/discord-bot")).status).toBe(403);
    const admin = appFor(true);
    const json = (body: unknown, method = "PUT") => ({
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect((await admin.request("/api/discord-bot")).status).toBe(200);
    expect((await admin.request("/api/discord-bot", json({ botToken: "bad" }))).status).toBe(400);
    expect(
      (
        await admin.request(
          "/api/discord-bot",
          json({ botToken: TOKEN, projectId: "proj", agentId: "agent" }),
        )
      ).status,
    ).toBe(200);
    const probe = await admin.request("/api/discord-bot/test", json({}, "POST"));
    expect(await probe.json()).toMatchObject({ ok: true, botUsername: "@penguin_test" });
    const on = await admin.request("/api/discord-bot/state", json({ enabled: true }, "POST"));
    expect(((await on.json()) as { enabled: boolean }).enabled).toBe(true);
    expect(bot.statusOf().state).toBe("connected");
  });
});
