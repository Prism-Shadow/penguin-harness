/**
 * The plugin on its own, over fake harness mechanisms and a fake Discord connector: a
 * Project's `[discord_bot]` table read and validated; the manager building one bot per
 * Project, restarting on a changed table and stopping on a removed one; the bot opening a
 * Session per chat on the first message and reusing it, `/new` opening another, replies
 * relayed into the chat (threaded in a server channel), `/approve` deciding a waiting tool
 * call, a redelivered message running once, the chat table surviving a restart — and the
 * manifest agreeing with the code half. No test opens real network, and no real Session
 * runs: the task runner is a recorder and replies are published onto the Session's channel
 * by hand.
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
  DiscordBot,
  DiscordBots,
  NEW_NOTICE,
  NOTHING_PENDING_NOTICE,
  PACKAGE_NAME,
  ROUTES_ID,
  botConfigOf,
  botIdOf,
  chatsKeyOf,
  chunkReply,
  discordBotRoutes,
  safeFileName,
} from "../src/index.js";
import type { BotDeps, BotTarget, ManagerDeps } from "../src/index.js";

const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN = "MTIzNDU2Nzg5MDEyMzQ1Njc4.GaBcDe.test-secret-AAAA";
const DM = "900000000000000001";
const CHANNEL = "900000000000000002";
const TARGET: BotTarget = { projectId: "proj", botToken: TOKEN, agentId: "agent", enabled: true };

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
  async createClient(config: Record<string, unknown>) {
    if (typeof config.botToken !== "string" || config.botToken === "") {
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
  open() {
    return this.connections.filter((c) => !c.closed);
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
  /** What the harness holds for this package, as the Plugins page saved it. */
  config: Record<string, unknown> = {};
  readonly watchers = new Set<(values: Record<string, unknown>) => void>();
  readonly agents = new Set<string>(["proj/agent", "proj/default_agent", "other/default_agent"]);
  root = "";
  private nextSession = 0;

  deps(): BotDeps {
    return {
      messaging: {
        connectorFor: (channel: string) => {
          if (channel !== "discord") throw new Error(channel);
          return this.connector;
        },
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
      settings: {
        get: (key: string) => this.store.get(key) ?? null,
        set: (key: string, value: string) => void this.store.set(key, value),
        getAttachmentLimitsMb: () => ({ attachmentMaxMb: 10, attachmentTotalMb: 20 }),
      },
      channels: { get: (key: string) => this.hub.get(key) as never },
      errors: { record: (args: { code?: string }) => void this.errors.push(args) } as never,
      paths: { root: this.root },
      log: { line: () => {} },
    };
  }

  managerDeps(): ManagerDeps {
    return {
      ...this.deps(),
      pluginConfig: {
        get: (name: string) => (name === PACKAGE_NAME ? this.config : {}),
        watch: (_name: string, cb: (values: Record<string, unknown>) => void) => {
          this.watchers.add(cb);
          return () => void this.watchers.delete(cb);
        },
      },
      agents: { exists: (p: string, a: string) => this.agents.has(`${p}/${a}`) },
    };
  }

  /** What the Plugins page's Save does: store, then fire the watch. */
  async saveConfig(values: Record<string, unknown>): Promise<void> {
    this.config = values;
    await Promise.all([...this.watchers].map((cb) => Promise.resolve(cb(values))));
    await settle();
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

const settle = () => new Promise((r) => setTimeout(r, 10));
async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out waiting");
    await settle();
  }
}

describe("the manifest, the config table and the helpers", () => {
  it("contributes the routes its manifest declares", () => {
    const pkg = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "package.json"), "utf8")) as {
      name: string;
      penguin: {
        configuration: { properties: Record<string, { type: string }> };
        modules: Array<{
          name: string;
          requires: Record<string, { from: string }>;
          contributes: Record<string, Array<{ id: string }>>;
        }>;
      };
    };
    const [manifest] = pkg.penguin.modules;
    expect(manifest?.name).toBe("DiscordBot");
    expect(manifest?.contributes["HttpModule.routes"]?.[0]?.id).toBe(ROUTES_ID);
    expect(manifest?.requires.pluginConfig?.from).toBe("PluginConfigModule");
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(Object.keys(pkg.penguin.configuration.properties)).toEqual([
      "bot_token",
      "project",
      "agent",
      "enabled",
    ]);
    expect(pkg.penguin.configuration.properties.bot_token?.type).toBe("secret");
    expect(pkg.penguin.configuration.properties.project?.type).toBe("project");
    expect(Object.keys(plugin.modules ?? {})).toEqual(["DiscordBot"]);
  });

  it("reads the bot out of the stored values, defaulting the Agent and the switch", () => {
    const agents = {
      exists: (p: string, a: string) => p === "proj" && (a === "agent" || a === "default_agent"),
    };
    expect(botConfigOf({}, agents)).toBeNull();
    expect(botConfigOf({ agent: "x", enabled: true }, agents)).toBeNull();
    expect(botConfigOf({ bot_token: TOKEN, project: "proj" }, agents)).toEqual({
      ok: true,
      projectId: "proj",
      botToken: TOKEN,
      agentId: "default_agent",
      enabled: true,
    });
    expect(
      botConfigOf(
        { bot_token: `Bot ${TOKEN}`, project: "proj", agent: "agent", enabled: false },
        agents,
      ),
    ).toEqual({ ok: true, projectId: "proj", botToken: TOKEN, agentId: "agent", enabled: false });
    // Each way the values can be wrong names itself rather than throwing.
    expect(botConfigOf({ project: "proj" }, agents)).toMatchObject({
      ok: false,
      error: expect.stringContaining("token is not set"),
    });
    expect(botConfigOf({ bot_token: "nope", project: "proj" }, agents)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not a Discord bot token"),
    });
    expect(botConfigOf({ bot_token: TOKEN }, agents)).toMatchObject({
      ok: false,
      error: expect.stringContaining("no Project"),
    });
    expect(
      botConfigOf({ bot_token: TOKEN, project: "proj", agent: "ghost" }, agents),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('"ghost"'),
    });
    expect(botIdOf(TOKEN)).toBe("123456789012345678");
    expect(botIdOf("not-a-token")).toBeNull();
  });

  it("cuts a reply at paragraphs, then lines, then hard, and keeps file names to one segment", () => {
    const paras = ["a".repeat(600), "b".repeat(600), "c".repeat(600)].join("\n\n");
    expect(chunkReply(paras, 1300)).toEqual([
      "a".repeat(600) + "\n\n" + "b".repeat(600),
      "c".repeat(600),
    ]);
    expect(chunkReply("x".repeat(2500), 1000).map((s) => s.length)).toEqual([1000, 1000, 500]);
    expect(safeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(safeFileName("")).toBe("file");
  });
});

describe("the manager over the plugin's configuration", () => {
  let w: World;
  let bots: DiscordBots;

  beforeEach(async () => {
    w = new World();
    w.root = await fs.mkdtemp(path.join(os.tmpdir(), "discord-bot-"));
  });
  afterEach(async () => {
    bots?.stop();
    await fs.rm(w.root, { recursive: true, force: true });
  });

  it("runs the bot the values describe, reports why there is none, and follows every save", async () => {
    bots = new DiscordBots(w.managerDeps());
    await bots.start();
    expect(bots.status()).toEqual({ bot: null, error: null, configured: false });
    expect(w.connector.connections).toHaveLength(0);

    await w.saveConfig({ bot_token: "nope", project: "proj" });
    expect(bots.status()).toMatchObject({
      bot: null,
      configured: true,
      error: expect.stringContaining("bot token"),
    });

    await w.saveConfig({ bot_token: TOKEN, project: "proj", agent: "agent", enabled: true });
    expect(bots.status().error).toBeNull();
    expect(bots.status().bot).toMatchObject({
      projectId: "proj",
      agentId: "agent",
      enabled: true,
      status: { state: "connected" },
    });
    expect(bots.status().bot!.botTokenMasked).toBe("MTIz…AAAA");
    expect(w.connector.open()).toHaveLength(1);

    // The same values again restart nothing; changed ones restart the bot on the new values.
    await w.saveConfig({ bot_token: TOKEN, project: "proj", agent: "agent", enabled: true });
    expect(w.connector.connections).toHaveLength(1);
    await w.saveConfig({
      bot_token: TOKEN,
      project: "proj",
      agent: "default_agent",
      enabled: true,
    });
    expect(w.connector.connections).toHaveLength(2);
    expect(w.connector.open()).toHaveLength(1);
    expect(bots.status().bot!.agentId).toBe("default_agent");

    // The switch keeps the bot and closes its connection; cleared values stop it.
    await w.saveConfig({ bot_token: TOKEN, project: "proj", enabled: false });
    expect(bots.status().bot).toMatchObject({ enabled: false, status: { state: "disconnected" } });
    expect(w.connector.open()).toHaveLength(0);
    await w.saveConfig({});
    expect(bots.status()).toEqual({ bot: null, error: null, configured: false });
  });

  it("serves its status to admins only, running a pass first", async () => {
    bots = new DiscordBots(w.managerDeps());
    await bots.start();
    const appFor = (isAdmin: boolean) => {
      const outer = new Hono();
      outer.use("*", async (c, next) => {
        c.set("user" as never, { isAdmin } as never);
        await next();
      });
      outer.route("/api/discord-bot", discordBotRoutes(bots));
      return outer;
    };
    expect((await appFor(false).request("/api/discord-bot")).status).toBe(403);
    w.config = { bot_token: TOKEN, project: "proj", agent: "agent" };
    const res = await appFor(true).request("/api/discord-bot");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { bot: { projectId: string } | null }).bot?.projectId).toBe(
      "proj",
    );
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

  it("opens a Session on a chat's first message, reuses it, and relays the reply", async () => {
    bot = new DiscordBot(TARGET, w.deps());
    await bot.start();
    expect(w.connector.last().config).toEqual({ botToken: TOKEN });
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
    bot = new DiscordBot(TARGET, w.deps());
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
    bot = new DiscordBot(TARGET, w.deps());
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
    bot = new DiscordBot(TARGET, w.deps());
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

  it("runs a redelivered message once", async () => {
    bot = new DiscordBot(TARGET, w.deps());
    await bot.start();
    const once = dm("only once");
    await w.connector.fire(once);
    await w.connector.fire(once);
    expect(w.runs).toHaveLength(1);
  });

  it("writes an attached file into the Session scratchpad and names it on the message", async () => {
    bot = new DiscordBot(TARGET, w.deps());
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
    bot = new DiscordBot(TARGET, w.deps());
    await bot.start();
    await w.connector.fire(dm("remember me"));
    const sessionId = w.runs[0]!.sessionId;
    bot.stop();

    bot = new DiscordBot(TARGET, w.deps());
    await bot.start();
    expect(bot.info().chats).toBe(1);
    w.publishRun(sessionId, ["still here"]);
    await waitFor(() => w.connector.sends.some((s) => s.text === "still here"));
    await w.connector.fire(dm("more"));
    expect(w.runs[1]!.sessionId).toBe(sessionId);
    expect(JSON.parse(w.store.get(chatsKeyOf("proj"))!)[DM].sessionId).toBe(sessionId);

    w.rows.delete(sessionId);
    expect(bot.info().chats).toBe(0);
  });
});
