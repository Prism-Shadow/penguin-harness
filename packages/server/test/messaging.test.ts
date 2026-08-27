/**
 * Messaging-binding tests, Feishu side (the Telegram connector's mirror suite is
 * messaging-telegram.test.ts): the bind-by-enable model (saving is never exclusive,
 * enabling is), the
 * /api/sessions/:id/messaging/feishu routes (masking, secret keep-on-blank, the
 * save/enable split — PUT persists credentials only, POST /state owns the connection —
 * 409s, authz split, cascade on session delete), and the bridge's routing through a fake
 * Feishu SDK — inbound text becomes an ordinary user task
 * exactly as if typed in the composer (no marker, no special sender; queueIfBusy),
 * non-text gets the bilingual text-only reply, each completed assistant message mirrors on
 * its own to the last known chat as soon as it completes (the run's first one threaded onto
 * the inbound message in groups), an approval_request sends the one-line notice behind
 * whatever is already going out, and a binding with `linePerMessage` set delivers a reply one
 * message per non-blank line — paced, and with a refused message costing only itself — while
 * an unset one is byte-for-byte the original single message. No test opens real network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  approvalDecision,
  compactionBegin,
  compactionEnd,
  toolCall,
} from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage, TextPayload } from "@prismshadow/penguin-core";
import type { FeishuBindingResponse, FeishuTestResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import {
  MESSAGING_APPROVAL_NOTICE,
  MESSAGING_MAX_LINE_MESSAGES,
  MESSAGING_TEST_MESSAGE,
  MESSAGING_TEXT_CHUNK_CHARS,
  MESSAGING_TEXT_ONLY_NOTICE,
  MessagingBridge,
  chunkMessagingText,
  splitReplyLines,
} from "../src/runtime/messaging/bridge.js";
import type { MessagingTaskRunner } from "../src/runtime/messaging/bridge.js";
import { FeishuConnector } from "../src/runtime/messaging/feishu-connector.js";
import type {
  FeishuApiClient,
  FeishuCredentials,
  FeishuEventHandlers,
  FeishuInboundEvent,
  FeishuSdk,
} from "../src/runtime/messaging/feishu-sdk.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp, TestAppOptions } from "./helpers.js";

const SID = "session-2026-08-25-10-00-00-fe15aa01";
const SID2 = "session-2026-08-25-10-00-01-fe15aa02";
const BASE = (sid: string) => `/api/sessions/${sid}/messaging/feishu`;

// ---------------------------------------------------------------------------
// Fake SDK: records every client call and hands inbound events back to the connector.
// ---------------------------------------------------------------------------

interface SentText {
  kind: "send" | "reply";
  target: string;
  text: string;
}

class FakeClient implements FeishuApiClient {
  readonly sends: SentText[] = [];
  /** When each send was recorded, parallel to `sends`: what the pacing test measures. */
  readonly sentAt: number[] = [];
  checks = 0;
  constructor(
    readonly creds: FeishuCredentials,
    private readonly sdk: FakeSdk,
  ) {}
  async checkCredentials(): Promise<null> {
    this.checks++;
    if (this.sdk.failCheck !== null) throw new Error(this.sdk.failCheck);
    return null;
  }
  async sendText(chatId: string, text: string): Promise<void> {
    this.sdk.noteSend();
    this.record({ kind: "send", target: chatId, text });
    await this.sdk.hold();
  }
  async replyText(messageId: string, text: string): Promise<void> {
    this.sdk.noteSend();
    this.record({ kind: "reply", target: messageId, text });
    await this.sdk.hold();
  }
  private record(sent: SentText): void {
    this.sends.push(sent);
    this.sentAt.push(Date.now());
  }
  async botOpenId(): Promise<string | null> {
    this.sdk.botIdentityLookups++;
    // A stalled endpoint: the TCP connection is accepted and the answer never comes.
    if (this.sdk.stallBotOpenId) return new Promise<never>(() => {});
    return this.sdk.botOpenId;
  }
}

class FakeConnection {
  closed = false;
  constructor(
    readonly creds: FeishuCredentials,
    readonly handlers: FeishuEventHandlers,
  ) {}
  close(): void {
    this.closed = true;
  }
  fire(evt: FeishuInboundEvent): Promise<void> {
    return Promise.resolve(this.handlers.onMessage(evt));
  }
}

class FakeSdk implements FeishuSdk {
  readonly clients: FakeClient[] = [];
  readonly connections: FakeConnection[] = [];
  /** Non-null makes checkCredentials throw with this message. */
  failCheck: string | null = null;
  /** Non-null makes the send with this 1-based number (counted across clients) throw. */
  failSendAt: number | null = null;
  /** Non-null parks every send on this promise, holding the bridge's send chain open. */
  heldSends: Promise<void> | null = null;
  private sendCount = 0;
  /** Every send passes here first: it counts, and throws for the one a test marked. */
  noteSend(): void {
    this.sendCount += 1;
    if (this.sendCount === this.failSendAt) throw new Error("Too Many Requests: retry after 5");
  }
  /** Awaited after each send: instant unless a test is holding sends open. */
  hold(): Promise<void> {
    return this.heldSends ?? Promise.resolve();
  }
  /** What `/open-apis/bot/v3/info` reports for this app; null = the identity is unavailable. */
  botOpenId: string | null = null;
  /** Makes that lookup never answer, so a test can prove connect() does not wait on it. */
  stallBotOpenId = false;
  /** Lookups the connector has started (one per connection, off the connect path). */
  botIdentityLookups = 0;
  async createClient(creds: FeishuCredentials): Promise<FeishuApiClient> {
    const client = new FakeClient(creds, this);
    this.clients.push(client);
    return client;
  }
  async connect(creds: FeishuCredentials, handlers: FeishuEventHandlers): Promise<FakeConnection> {
    const conn = new FakeConnection(creds, handlers);
    this.connections.push(conn);
    handlers.onReady?.();
    return conn;
  }
  /** All texts sent through any client, in order. */
  allSends(): SentText[] {
    return this.clients.flatMap((c) => c.sends);
  }
  /** Their timestamps, in the same order. */
  allSentAt(): number[] {
    return this.clients.flatMap((c) => c.sentAt);
  }
  lastConnection(): FakeConnection {
    const conn = this.connections.at(-1);
    if (!conn) throw new Error("no fake connection was opened");
    return conn;
  }
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
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-feishu" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-feishu");
      yield assistantText("after approval");
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

/**
 * Fake Session that completes one assistant message and then parks on an approval: the
 * window in which a notice could overtake the reply's still-unsent messages.
 */
function replyThenApprovalFakeSession(sessionId: string, text: string): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      yield assistantText(text);
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-lines" });
      yield tc;
      yield approvalDecision(await opts.approve(tc), "tc-lines");
    },
    async *compact() {},
  };
}

/** Fake Session that streams a compaction summary mid-run, then the actual answer. */
function compactingFakeSession(sessionId: string): RuntimeSession {
  const bounds = { reason: "context", mode: "summarize" } as const;
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      yield compactionBegin({ ...bounds, context: 90, turns: 12 });
      yield assistantText("SUMMARY that is not a reply");
      yield compactionEnd({ ...bounds, status: "completed" });
      yield assistantText("the actual answer");
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

const PUT_BODY = {
  appId: "cli_test_app_0001",
  appSecret: "secret-value-abcdef-123456",
  baseDomain: "https://open.feishu.cn",
};

describe("chunkMessagingText", () => {
  it("returns short text whole and splits long text at newline boundaries under the cap", () => {
    expect(chunkMessagingText("short")).toEqual(["short"]);
    const chunks = chunkMessagingText(`${"a".repeat(30)}\n${"b".repeat(30)}`, 40);
    expect(chunks).toEqual(["a".repeat(30), "b".repeat(30)]);
    // No usable newline: a hard split at the cap.
    const hard = chunkMessagingText("x".repeat(90), 40);
    expect(hard.map((c) => c.length)).toEqual([40, 40, 10]);
    expect(hard.join("")).toBe("x".repeat(90));
  });
});

describe("splitReplyLines", () => {
  it("makes one message per non-blank line and leaves a single line alone", () => {
    // Trailing whitespace goes with the line break it followed; the indentation in front of
    // a line is content the reader asked for.
    expect(splitReplyLines("one\n\n  two  \nthree")).toEqual(["one", "  two", "three"]);
    expect(splitReplyLines("just one line")).toEqual(["just one line"]);
    // Literal on purpose, fenced code included: the option is worth having because a reader
    // can predict what arrives, and any "smart" grouping would trade that away.
    expect(splitReplyLines("```\ncode()\n```")).toEqual(["```", "code()", "```"]);
  });

  it("keeps the indentation inside a code block and reads a CRLF reply", () => {
    // Stripping the indent would hand the chat Python that does not run — the split is a
    // split, not an edit.
    expect(splitReplyLines("```python\ndef f():\n    return 1  \n```")).toEqual([
      "```python",
      "def f():",
      "    return 1",
      "```",
    ]);
    // A CRLF reply: the CR is trailing whitespace, and a CRLF blank line is still blank.
    expect(splitReplyLines("a\r\n\r\nb\r\n")).toEqual(["a", "b"]);
  });

  it("combines the tail past the cap rather than dropping it", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `l${i}`);
    const out = splitReplyLines(lines.join("\n"), 5);
    expect(out).toHaveLength(5);
    expect(out.slice(0, 4)).toEqual(["l0", "l1", "l2", "l3"]);
    // Everything from the cap on rides the last message, keeping its own line breaks — so
    // nothing is lost, which is the point of combining instead of truncating.
    expect(out[4]).toBe(lines.slice(4).join("\n"));
    expect(out.join("\n")).toBe(lines.join("\n"));
    // Exactly at the cap nothing is combined.
    expect(splitReplyLines(lines.slice(0, 5).join("\n"), 5)).toEqual(lines.slice(0, 5));
  });

  it("defaults to the documented per-reply message cap", () => {
    const lines = Array.from({ length: MESSAGING_MAX_LINE_MESSAGES + 5 }, (_, i) => `l${i}`);
    expect(splitReplyLines(lines.join("\n"))).toHaveLength(MESSAGING_MAX_LINE_MESSAGES);
  });

  it("spends the cap on outbound MESSAGES, chunking included", () => {
    // An ordinary long answer: every line sits well under the size cap, but the combined
    // tail does not, so counting bodies would promise 20 messages and send 25 — past the
    // rate limit the cap exists to hold.
    const lines = Array.from({ length: 60 }, (_, i) => `${i}`.padEnd(500, "x"));
    const bodies = splitReplyLines(lines.join("\n"));
    const messages = bodies.flatMap((body) => chunkMessagingText(body));
    expect(messages.length).toBeLessThanOrEqual(MESSAGING_MAX_LINE_MESSAGES);
    // And still the whole reply: the budget is spent by combining, never by dropping.
    expect(messages.join("\n")).toBe(lines.join("\n"));
  });
});

describe("messaging binding routes and bridge", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let fake: FakeSdk;
  let projectId: string;
  let runs: TextPayload[][];

  /** Save credentials, then flip the toggle on — the two-step flow the flow tests need. */
  const bindEnabled = async (sid: string, body: Record<string, unknown> = PUT_BODY) => {
    expect((await api.put(BASE(sid), body)).status).toBe(200);
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
  };

  /**
   * A second bridge over the SAME database with an empty in-memory ring: what a
   * desktop-app relaunch — or a runtime hot swap, which stops the bridge and starts a
   * fresh one — leaves behind. The caller stops the app's own bridge first.
   */
  const restartBridge = (runner: MessagingTaskRunner = t.deps.manager) =>
    new MessagingBridge({
      repo: t.deps.messagingRepo,
      sessions: t.deps.sessionsRepo,
      channels: t.deps.channels,
      runner,
      connectors: [new FeishuConnector(fake)],
      errors: t.deps.errors,
    });

  /** The suite's app, rebuildable: the pacing test needs one whose per-line wait is not zero. */
  const boot = async (opts: TestAppOptions = {}) => {
    fake = new FakeSdk();
    t = await createTestApp({ feishuSdk: fake, ...opts });
    const { cookie } = await provisionUser(t.app, "birder");
    api = apiClient(t.app, cookie);
    projectId = "birder-default_project";
    runs = [];
    const row = sessionRowOf(SID, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, echoFakeSession(SID, runs));
  };

  beforeEach(() => boot());
  afterEach(async () => {
    await t.cleanup();
  });

  it("GET reports unbound + disconnected before any PUT", async () => {
    const res = await api.get(BASE(SID));
    expect(res.status).toBe(200);
    expect((await res.json()) as FeishuBindingResponse).toEqual({
      binding: null,
      status: { state: "disconnected" },
    });
  });

  it("PUT saves credentials only (masked, disabled, no connection); blank secret keeps the stored one", async () => {
    const res = await api.put(BASE(SID), PUT_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeishuBindingResponse;
    expect(body.binding?.channel).toBe("feishu");
    expect(body.binding?.appId).toBe(PUT_BODY.appId);
    // Site-wide mask rule: first4…last4, never the plaintext.
    expect(body.binding?.appSecretMasked).toBe("secr…3456");
    expect(JSON.stringify(body)).not.toContain(PUT_BODY.appSecret);
    expect(body.binding?.lastChatKnown).toBe(false);
    // Saving is not connecting: the binding starts disabled and nothing was opened.
    expect(body.binding?.enabled).toBe(false);
    expect(body.status.state).toBe("disconnected");
    expect(fake.connections).toHaveLength(0);
    // The stored row carries the channel discriminator and the account identity.
    const stored = t.deps.messagingRepo.find(SID, "feishu")!;
    expect(stored.channel).toBe("feishu");
    expect(stored.accountId).toBe(PUT_BODY.appId);

    // Re-save with a blank secret: the stored one stays; still disabled, still dark.
    const resave = await api.put(BASE(SID), { appId: PUT_BODY.appId, appSecret: "" });
    expect(resave.status).toBe(200);
    expect(t.deps.messagingRepo.find(SID, "feishu")?.config.appSecret).toBe(PUT_BODY.appSecret);
    expect(fake.connections).toHaveLength(0);

    // First-time bind without a secret is refused.
    t.deps.messagingRepo.delete(SID, "feishu");
    const bare = await api.put(BASE(SID), { appId: "cli_other" });
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "feishu_secret_required",
    );
  });

  it("the clear flag drops the stored secret (disable first), and enabling without one is refused", async () => {
    await api.put(BASE(SID), PUT_BODY);
    await api.post(`${BASE(SID)}/state`, { enabled: true });
    // Clearing while enabled is refused: a live connection must never outrun its stored credential.
    const blocked = await api.put(BASE(SID), { appId: PUT_BODY.appId, clearAppSecret: true });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      "messaging_disable_before_clear",
    );
    await api.post(`${BASE(SID)}/state`, { enabled: false });
    const cleared = await api.put(BASE(SID), { appId: PUT_BODY.appId, clearAppSecret: true });
    expect(cleared.status).toBe(200);
    const body = (await cleared.json()) as FeishuBindingResponse;
    // No stored secret -> no mask; the row and its non-secret fields stay.
    expect(body.binding?.appSecretMasked).toBeUndefined();
    expect(body.binding?.appId).toBe(PUT_BODY.appId);
    expect(t.deps.messagingRepo.find(SID, "feishu")?.config.appSecret).toBe("");
    // A typed secret wins over a stale clear flag (the models idiom).
    const typed = await api.put(BASE(SID), {
      appId: PUT_BODY.appId,
      appSecret: "fresh-secret-123456",
      clearAppSecret: true,
    });
    expect(((await typed.json()) as FeishuBindingResponse).binding?.appSecretMasked).toBe(
      "fres…3456",
    );
    // Clear again, then try to enable: the state toggle refuses a credential-less config.
    await api.put(BASE(SID), { appId: PUT_BODY.appId, clearAppSecret: true });
    const on = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(on.status).toBe(400);
    expect(((await on.json()) as { error: { code: string } }).error.code).toBe(
      "feishu_secret_required",
    );
  });

  it("POST /state owns the connection: enable connects with stored credentials, disable terminates", async () => {
    // Unbound: nothing to toggle.
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(404);
    await api.put(BASE(SID), PUT_BODY);

    const on = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(on.status).toBe(200);
    const onBody = (await on.json()) as FeishuBindingResponse;
    expect(onBody.binding?.enabled).toBe(true);
    expect(onBody.status.state).toBe("connected");
    expect(fake.connections).toHaveLength(1);
    // Connected with the STORED credentials — the toggle carries none of its own.
    expect(fake.connections[0]!.creds.appId).toBe(PUT_BODY.appId);
    expect(fake.connections[0]!.creds.appSecret).toBe(PUT_BODY.appSecret);

    const off = await api.post(`${BASE(SID)}/state`, { enabled: false });
    const offBody = (await off.json()) as FeishuBindingResponse;
    expect(offBody.binding?.enabled).toBe(false);
    expect(offBody.status.state).toBe("disconnected");
    expect(fake.connections[0]!.closed).toBe(true);
    expect((await api.post(`${BASE(SID)}/state`, { enabled: "yes" })).status).toBe(400);
  });

  it("saving new credentials while enabled restarts the connector with them (never-diverge rule)", async () => {
    await bindEnabled(SID);
    expect(fake.connections).toHaveLength(1);
    const res = await api.put(BASE(SID), { ...PUT_BODY, appSecret: "rotated-secret-9999" });
    expect(res.status).toBe(200);
    // The old connection is torn down and a new one runs on the just-saved secret.
    expect(fake.connections).toHaveLength(2);
    expect(fake.connections[0]!.closed).toBe(true);
    expect(fake.connections[1]!.creds.appSecret).toBe("rotated-secret-9999");
    expect(((await res.json()) as FeishuBindingResponse).binding?.enabled).toBe(true);
  });

  it("enabling is the binding: two Sessions may save one app, only one may have it enabled", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    // Saving the same app on a second Session is not a conflict at all — each keeps its own
    // stored config, and neither of them is connected by a save.
    expect((await api.put(BASE(SID), PUT_BODY)).status).toBe(200);
    expect((await api.put(BASE(SID2), PUT_BODY)).status).toBe(200);
    expect(t.deps.messagingRepo.find(SID2, "feishu")?.accountId).toBe(PUT_BODY.appId);
    expect(fake.connections).toHaveLength(0);

    // The first enable takes the app; the second is refused while it holds it.
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(200);
    const blocked = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(blocked.status).toBe(409);
    const refusal = (await blocked.json()) as { error: { code: string; message: string } };
    expect(refusal.error.code).toBe("account_enabled_elsewhere");
    // The refusal identifies nothing about the holder: it may sit in a Project this caller
    // cannot see, so its id must not travel in the message.
    expect(refusal.error.message).not.toContain(SID);
    // Refused means nothing moved: the second stays dark, the first keeps its connection.
    expect(t.deps.messagingRepo.find(SID2, "feishu")?.enabled).toBe(false);
    expect(fake.connections).toHaveLength(1);

    // And a save on the dark Session is still just a save, connection or no connection
    // elsewhere: only the enabled binding's own connector ever restarts.
    const resave = await api.put(BASE(SID2), { ...PUT_BODY, appSecret: "second-secret-7777" });
    expect(resave.status).toBe(200);
    expect(fake.connections).toHaveLength(1);
    expect(t.deps.messaging.statusOf(SID, "feishu").state).toBe("connected");

    // Turning the first one off releases the app, and the second takes it.
    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    const moved = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(moved.status).toBe(200);
    expect(((await moved.json()) as FeishuBindingResponse).binding?.enabled).toBe(true);
    expect(fake.connections).toHaveLength(2);
    expect(fake.connections[0]!.closed).toBe(true);
    // Disabling released the account without touching the credentials: the first Session
    // keeps its saved config, ready to take the app back.
    expect(t.deps.messagingRepo.find(SID, "feishu")?.config.appSecret).toBe(PUT_BODY.appSecret);
  });

  it("a save cannot re-point an ENABLED binding at an app another Session has enabled", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    // Two Sessions, each connected to its own app. Exclusivity holds so far.
    await bindEnabled(SID);
    await bindEnabled(SID2, { appId: "cli_app_second", appSecret: PUT_BODY.appSecret });
    expect(fake.connections).toHaveLength(2);

    // The save path is the way around the enable gate: this binding is already enabled, so
    // the write would carry its live connection onto the first Session's app and leave two
    // rows enabled on one account — the state the whole model rests on being unreachable.
    const stolen = await api.put(BASE(SID2), {
      appId: PUT_BODY.appId,
      appSecret: PUT_BODY.appSecret,
    });
    expect(stolen.status).toBe(409);
    const refusal = (await stolen.json()) as { error: { code: string; message: string } };
    expect(refusal.error.code).toBe("account_enabled_elsewhere");
    expect(refusal.error.message).not.toContain(SID);

    // Refused means nothing moved: no third connection, and the row keeps its own app.
    expect(fake.connections).toHaveLength(2);
    expect(t.deps.messagingRepo.find(SID2, "feishu")?.accountId).toBe("cli_app_second");
    expect(t.deps.messagingRepo.findEnabledByAccount("feishu", PUT_BODY.appId)?.sessionId).toBe(
      SID,
    );

    // A DISABLED binding is still free to save the same app — that is what "enabling is the
    // binding" means, and its own enable is still gated.
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.put(BASE(SID2), PUT_BODY)).status).toBe(200);
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(409);
  });

  it("an enabled binding whose Session is gone releases its app to the next enable", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    await bindEnabled(SID);
    // Deleting a Project or an Agent removes its Sessions without sweeping their bindings,
    // so the row stays behind holding the app. Until boot reconciles it, the refusal it
    // produces names no Session — by design — and points at a connection nobody can reach.
    t.deps.sessionsRepo.deleteById(SID);

    expect((await api.put(BASE(SID2), PUT_BODY)).status).toBe(200);
    const taken = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(taken.status).toBe(200);
    expect(((await taken.json()) as FeishuBindingResponse).binding?.enabled).toBe(true);
    // The orphan is gone rather than merely stepped over.
    expect(t.deps.messagingRepo.find(SID, "feishu")).toBeNull();
    expect(t.deps.messagingRepo.findEnabledByAccount("feishu", PUT_BODY.appId)?.sessionId).toBe(
      SID2,
    );
  });

  it("authz: non-members get 404; a member reads but cannot write or toggle (owner-only)", async () => {
    await api.put(BASE(SID), PUT_BODY);
    const outsider = apiClient(t.app, (await provisionUser(t.app, "outsider")).cookie);
    expect((await outsider.get(BASE(SID))).status).toBe(404);

    const mate = await provisionUser(t.app, "mate");
    await api.post(`/api/projects/${projectId}/members`, { userId: "mate" });
    const member = apiClient(t.app, mate.cookie);
    expect((await member.get(BASE(SID))).status).toBe(200);
    expect((await member.put(BASE(SID), PUT_BODY)).status).toBe(403);
    expect((await member.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(403);
    expect((await member.delete(BASE(SID))).status).toBe(403);
  });

  it("POST /test probes draft values falling back to stored ones, reporting ok/error", async () => {
    // Draft-only test (nothing stored yet).
    const draft = await api.post(`${BASE(SID)}/test`, {
      appId: "cli_draft",
      appSecret: "draft-secret",
    });
    expect(draft.status).toBe(200);
    expect(((await draft.json()) as FeishuTestResponse).ok).toBe(true);
    expect(fake.clients.at(-1)?.creds.appId).toBe("cli_draft");

    // Stored fallback: an empty body tests the saved binding — enabling is not required.
    await api.put(BASE(SID), PUT_BODY);
    const stored = await api.post(`${BASE(SID)}/test`, {});
    expect(((await stored.json()) as FeishuTestResponse).ok).toBe(true);
    expect(fake.clients.at(-1)?.creds.appId).toBe(PUT_BODY.appId);
    expect(fake.clients.at(-1)?.creds.appSecret).toBe(PUT_BODY.appSecret);

    // A rejected credential is ok:false with the reason, not an HTTP error.
    fake.failCheck = "app not found";
    const bad = await api.post(`${BASE(SID)}/test`, {});
    expect(bad.status).toBe(200);
    expect((await bad.json()) as FeishuTestResponse).toEqual({
      ok: false,
      error: "app not found",
    });

    // No stored binding and no draft appId: a plain 400.
    t.deps.messagingRepo.delete(SID, "feishu");
    expect((await api.post(`${BASE(SID)}/test`, {})).status).toBe(400);
  });

  it("POST /test-message: 404 unbound, 409 before a chat is known, sends after one", async () => {
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(404);
    await bindEnabled(SID);
    const early = await api.post(`${BASE(SID)}/test-message`, {});
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe("feishu_no_chat");

    await fake.lastConnection().fire({
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_1",
      messageType: "text",
      content: JSON.stringify({ text: "hello" }),
    });
    const res = await api.post(`${BASE(SID)}/test-message`, {});
    expect(res.status).toBe(200);
    expect(fake.allSends()).toContainEqual({
      kind: "send",
      target: "oc_chat_1",
      text: MESSAGING_TEST_MESSAGE,
    });
  });

  it("inbound text starts an ordinary user task (no marker, no sender) and the reply mirrors back (direct chat)", async () => {
    await bindEnabled(SID);
    await fake.lastConnection().fire({
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_1",
      messageType: "text",
      content: JSON.stringify({ text: "how is the build?" }),
    });
    await waitFor(() => runs.length === 1);
    // Exactly as if typed into the web composer: the text verbatim, no marker block, and
    // the default human sender (no `sender` field at all).
    const input = runs[0]![0]!;
    expect(input.text).toBe("how is the build?");
    expect(input.role).toBe("user");
    expect("sender" in input).toBe(false);
    // The inbound chat became the reply target.
    const row = t.deps.messagingRepo.find(SID, "feishu")!;
    expect(row.lastChatId).toBe("oc_chat_1");
    expect(row.lastChatIsDirect).toBe(true);
    // Task end mirrors the assistant text to that chat.
    await waitFor(() => fake.allSends().some((s) => s.kind === "send" && s.target === "oc_chat_1"));
    expect(fake.allSends()).toContainEqual({
      kind: "send",
      target: "oc_chat_1",
      text: "Reply text",
    });
    // The queue path (busy sessions) is exercised end to end by followup.test.ts; here the
    // idle path must have started immediately.
    expect(t.deps.manager.pendingFollowUpCount(SID)).toBe(0);
  });

  it("group chats reply to the inbound message; web-initiated turns mirror too", async () => {
    await bindEnabled(SID);
    await fake.lastConnection().fire({
      chatId: "oc_group_9",
      chatType: "group",
      messageId: "om_group_1",
      messageType: "text",
      content: JSON.stringify({ text: "ping" }),
    });
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({
      kind: "reply",
      target: "om_group_1",
      text: "Reply text",
    });

    // A turn started from the web mirrors to the same chat once it completes.
    const sent = fake.allSends().length;
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "from the web" }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => fake.allSends().length > sent);
    expect(fake.allSends().at(-1)).toEqual({
      kind: "reply",
      target: "om_group_1",
      text: "Reply text",
    });
  });

  it("relays every completed assistant message on its own, as it completes, never joined", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    t.deps.manager.adopt(
      row2,
      multiMessageFakeSession(SID2, ["working on it", "still going", "here is the answer"], gate),
    );
    await bindEnabled(SID2, { ...PUT_BODY, appId: "cli_streamer" });
    await fake.lastConnection().fire({
      chatId: "oc_chat_5",
      chatType: "p2p",
      messageId: "om_5",
      messageType: "text",
      content: JSON.stringify({ text: "go" }),
    });
    // The first two are in the chat while the run is still running — the whole point:
    // the chat follows the run instead of receiving it as one block at the end.
    await waitFor(() => fake.allSends().length === 2);
    expect(t.deps.manager.statusOf(SID2)).toBe("running");
    expect(fake.allSends().map((s) => s.text)).toEqual(["working on it", "still going"]);
    release();
    await waitFor(() => fake.allSends().length === 3);
    // Order preserved, and no message carries another one's text: nothing was joined.
    expect(fake.allSends().map((s) => s.text)).toEqual([
      "working on it",
      "still going",
      "here is the answer",
    ]);
    expect(fake.allSends().every((s) => !s.text.includes("\n\n"))).toBe(true);
    expect(fake.allSends().every((s) => s.kind === "send" && s.target === "oc_chat_5")).toBe(true);
  });

  it("in a group only the run's first message threads onto the inbound one", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, multiMessageFakeSession(SID2, ["first", "second", "third"]));
    await bindEnabled(SID2, { ...PUT_BODY, appId: "cli_grouped" });
    await fake.lastConnection().fire({
      chatId: "oc_group_7",
      chatType: "group",
      messageId: "om_group_7",
      messageType: "text",
      content: JSON.stringify({ text: "ping" }),
    });
    await waitFor(() => fake.allSends().length === 3);
    // One reply-to anchors the exchange; the rest are plain sends into the same chat, so
    // the group does not get a stack of quote headers.
    expect(fake.allSends()).toEqual([
      { kind: "reply", target: "om_group_7", text: "first" },
      { kind: "send", target: "oc_group_7", text: "second" },
      { kind: "send", target: "oc_group_7", text: "third" },
    ]);
  });

  // —— linePerMessage: the per-binding delivery option ————————————————————————

  /**
   * A reply written as spoken lines: a blank line between the first two, and a middle line
   * both indented and trailing-padded — the split keeps the indent and drops the padding, so
   * every expectation below spells the middle line with its two leading spaces.
   */
  const SPOKEN = "Line one.\n\n  Line two.  \nLine three.";

  /** SID2 replying with one fixed text, bound and connected, ready to be messaged. */
  const bindReplying = async (text: string, put: Record<string, unknown>) => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, multiMessageFakeSession(SID2, [text]));
    await bindEnabled(SID2, { ...PUT_BODY, ...put });
  };

  /** One inbound text into a direct chat, which becomes the reply target. */
  const messageBot = async (chatId: string, chatType: "p2p" | "group" = "p2p") =>
    fake.lastConnection().fire({
      chatId,
      chatType,
      messageId: `om_${chatId}`,
      messageType: "text",
      content: JSON.stringify({ text: "ping" }),
    });

  it("linePerMessage off (the default) delivers a multi-line reply as ONE message", async () => {
    await bindReplying(SPOKEN, { appId: "cli_lines_off" });
    // The default is off, on a binding whose PUT never mentioned the field.
    expect(t.deps.messagingRepo.find(SID2, "feishu")?.linePerMessage).toBe(false);
    await messageBot("oc_off");
    await waitFor(() => fake.allSends().length > 0);
    // Byte for byte what the bridge sent before the option existed: the trimmed reply, whole.
    expect(fake.allSends()).toEqual([{ kind: "send", target: "oc_off", text: SPOKEN.trim() }]);
  });

  it("linePerMessage on delivers one message per non-blank line, in order", async () => {
    await bindReplying(SPOKEN, { appId: "cli_lines_on", linePerMessage: true });
    expect(t.deps.messagingRepo.find(SID2, "feishu")?.linePerMessage).toBe(true);
    await messageBot("oc_on");
    await waitFor(() => fake.allSends().length === 3);
    // Order is the send chain's guarantee, so the whole array is asserted, not its contents:
    // three messages arriving out of order would be a different bug with the same members.
    expect(fake.allSends()).toEqual([
      { kind: "send", target: "oc_on", text: "Line one." },
      { kind: "send", target: "oc_on", text: "  Line two." },
      { kind: "send", target: "oc_on", text: "Line three." },
    ]);
  });

  it("a line over the channel's size cap is still chunked rather than rejected", async () => {
    const long = "x".repeat(MESSAGING_TEXT_CHUNK_CHARS + 500);
    await bindReplying(`head\n${long}`, { appId: "cli_lines_long", linePerMessage: true });
    await messageBot("oc_long");
    await waitFor(() => fake.allSends().length === 3);
    // Splitting happens first, chunking after: the long line becomes two messages, and the
    // pieces reassemble into exactly the line that was sent.
    expect(fake.allSends().map((s) => s.text)).toEqual([
      "head",
      long.slice(0, MESSAGING_TEXT_CHUNK_CHARS),
      long.slice(MESSAGING_TEXT_CHUNK_CHARS),
    ]);
  });

  it("past the cap the remaining lines arrive combined, not dropped", async () => {
    const lines = Array.from({ length: MESSAGING_MAX_LINE_MESSAGES + 4 }, (_, i) => `l${i}`);
    await bindReplying(lines.join("\n"), { appId: "cli_lines_cap", linePerMessage: true });
    await messageBot("oc_cap");
    await waitFor(() => fake.allSends().length === MESSAGING_MAX_LINE_MESSAGES);
    const texts = fake.allSends().map((s) => s.text);
    expect(texts.slice(0, -1)).toEqual(lines.slice(0, MESSAGING_MAX_LINE_MESSAGES - 1));
    // The tail rides the last message: the reply reaches the chat entire either way.
    expect(texts.at(-1)).toBe(lines.slice(MESSAGING_MAX_LINE_MESSAGES - 1).join("\n"));
    expect(texts.join("\n")).toBe(lines.join("\n"));
  });

  it("a refused message costs only itself: the rest of the reply still arrives", async () => {
    const lines = Array.from({ length: 6 }, (_, i) => `l${i}`);
    await bindReplying(lines.join("\n"), { appId: "cli_lines_429", linePerMessage: true });
    // What a 429 looks like from here. The reply used to stop at the first one, leaving the
    // chat with an answer cut off mid-sentence and nothing saying why.
    fake.failSendAt = 3;
    await messageBot("oc_429");
    await waitFor(() => fake.allSends().length === 5);
    expect(fake.allSends().map((s) => s.text)).toEqual(["l0", "l1", "l3", "l4", "l5"]);
    // The loss is recorded rather than swallowed (one row: the recorder dedupes a repeat of
    // the same code within its window).
    const errors = t.deps.db
      .prepare("SELECT code FROM error_records WHERE source = 'messaging'")
      .all() as Array<{ code: string }>;
    expect(errors).toEqual([{ code: "messaging_send_failed" }]);
  });

  it("paces the messages of a per-line reply instead of firing them back to back", async () => {
    // The pace is a real wait, so this one test runs on an app with a short one; the rest of
    // the suite collapses it to zero.
    await t.cleanup();
    await boot({ messagingLineDelayMs: 40 });
    await bindReplying(SPOKEN, { appId: "cli_lines_paced", linePerMessage: true });
    await messageBot("oc_paced");
    await waitFor(() => fake.allSends().length === 3);
    // Two waits between three messages. The burst is what draws the channel's 429, so the
    // reply is spread over the per-chat allowance instead of spending it at once.
    const at = fake.allSentAt();
    expect(at[2]! - at[0]!).toBeGreaterThanOrEqual(60);
  });

  it("the approval notice waits behind the reply rather than landing between its lines", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    row2.approvalMode = "always-ask";
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, replyThenApprovalFakeSession(SID2, SPOKEN));
    await bindEnabled(SID2, { ...PUT_BODY, appId: "cli_lines_approve", linePerMessage: true });
    // Hold every send open: the whole reply is then still in flight when the approval fires.
    let release = () => {};
    fake.heldSends = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requested = false;
    const off = t.deps.channels.get(SID2).subscribe((evt) => {
      const data = JSON.parse(evt.data) as { type?: string };
      if (evt.event === "server_event" && data.type === "approval_request") requested = true;
    });
    await messageBot("oc_approve");
    // The bridge subscribed to this channel first, so once this listener has seen the
    // request the bridge has already handled it; the timer then drains the microtasks a
    // notice sent beside the chain would have taken.
    await waitFor(() => requested);
    off();
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    await waitFor(() => fake.allSends().length === 4);
    expect(fake.allSends().map((s) => s.text)).toEqual([
      "Line one.",
      "  Line two.",
      "Line three.",
      MESSAGING_APPROVAL_NOTICE,
    ]);
    t.deps.manager.decideApproval(SID2, "tc-lines", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
  });

  it("the notices are not replies: linePerMessage never reaches them", async () => {
    await bindReplying(SPOKEN, { appId: "cli_lines_notice", linePerMessage: true });
    await fake.lastConnection().fire({
      chatId: "oc_notice",
      chatType: "p2p",
      messageId: "om_notice",
      messageType: "image",
      content: JSON.stringify({ image_key: "img_1" }),
    });
    await waitFor(() => fake.allSends().length > 0);
    // One send carrying the notice whole. The notices are single-line by construction, so
    // this is asserted from both ends: the text has no line break to split on, and it
    // arrives as one message — a notice routed through the reply path would break the pair.
    expect(MESSAGING_TEXT_ONLY_NOTICE).not.toContain("\n");
    expect(fake.allSends()).toEqual([
      { kind: "send", target: "oc_notice", text: MESSAGING_TEXT_ONLY_NOTICE },
    ]);
    // And the test message, sent through its own path, is one message too.
    const sent = fake.allSends().length;
    expect((await api.post(`/api/sessions/${SID2}/messaging/feishu/test-message`, {})).status).toBe(
      200,
    );
    expect(fake.allSends().slice(sent)).toEqual([
      { kind: "send", target: "oc_notice", text: MESSAGING_TEST_MESSAGE },
    ]);
  });

  it("in a group, split lines still thread only once", async () => {
    await bindReplying(SPOKEN, { appId: "cli_lines_group", linePerMessage: true });
    await messageBot("oc_lines_group", "group");
    await waitFor(() => fake.allSends().length === 3);
    // The rule the option must not disturb: one reply-to anchors the exchange, and many
    // lines must not become many quote headers.
    expect(fake.allSends()).toEqual([
      { kind: "reply", target: "om_oc_lines_group", text: "Line one." },
      { kind: "send", target: "oc_lines_group", text: "  Line two." },
      { kind: "send", target: "oc_lines_group", text: "Line three." },
    ]);
  });

  it("PUT saves the flag and an omitted one keeps the stored value", async () => {
    await api.put(BASE(SID), { ...PUT_BODY, linePerMessage: true });
    expect(t.deps.messagingRepo.find(SID, "feishu")?.linePerMessage).toBe(true);
    // The masked read carries it, so the editor can render the switch from the GET.
    const read = (await (await api.get(BASE(SID))).json()) as FeishuBindingResponse;
    expect(read.binding?.linePerMessage).toBe(true);
    // A credentials-only save says nothing about it, and it stays where it was.
    await api.put(BASE(SID), { appId: PUT_BODY.appId });
    expect(t.deps.messagingRepo.find(SID, "feishu")?.linePerMessage).toBe(true);
    // Turning it off is an ordinary save.
    await api.put(BASE(SID), { ...PUT_BODY, linePerMessage: false });
    expect(t.deps.messagingRepo.find(SID, "feishu")?.linePerMessage).toBe(false);
  });

  it("the streamed compaction summary is not a reply and never reaches the chat", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, compactingFakeSession(SID2));
    await bindEnabled(SID2, { ...PUT_BODY, appId: "cli_compactor" });
    await fake.lastConnection().fire({
      chatId: "oc_chat_6",
      chatType: "p2p",
      messageId: "om_6",
      messageType: "text",
      content: JSON.stringify({ text: "summarize" }),
    });
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
    expect(fake.allSends().map((s) => s.text)).toEqual(["the actual answer"]);
  });

  it("non-text messages get the bilingual text-only reply and start no task", async () => {
    await bindEnabled(SID);
    await fake.lastConnection().fire({
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_2",
      messageType: "image",
      content: JSON.stringify({ image_key: "img_1" }),
    });
    await waitFor(() => fake.allSends().length > 0);
    expect(fake.allSends()).toContainEqual({
      kind: "send",
      target: "oc_chat_1",
      text: MESSAGING_TEXT_ONLY_NOTICE,
    });
    expect(runs).toHaveLength(0);
    // Even a rejected type teaches the bridge where the user is.
    expect(t.deps.messagingRepo.find(SID, "feishu")?.lastChatId).toBe("oc_chat_1");
  });

  it("an approval_request sends the waiting-for-approval notice", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    row2.approvalMode = "always-ask";
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, parkingFakeSession(SID2));
    await bindEnabled(SID2, { ...PUT_BODY, appId: "cli_approver" });
    await fake.lastConnection().fire({
      chatId: "oc_chat_2",
      chatType: "p2p",
      messageId: "om_3",
      messageType: "text",
      content: JSON.stringify({ text: "do something risky" }),
    });
    await waitFor(() =>
      fake.allSends().some((s) => s.text === MESSAGING_APPROVAL_NOTICE && s.target === "oc_chat_2"),
    );
    t.deps.manager.decideApproval(SID2, "tc-feishu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
  });

  it("DELETE unbinds + disconnects, and deleting the Session cascades the binding away", async () => {
    await bindEnabled(SID);
    expect((await api.delete(BASE(SID))).status).toBe(204);
    expect(t.deps.messagingRepo.find(SID, "feishu")).toBeNull();
    expect(fake.connections[0]!.closed).toBe(true);
    expect(t.deps.messaging.statusOf(SID, "feishu").state).toBe("disconnected");

    // Rebind + enable, then delete the Session itself: the binding goes with it.
    await bindEnabled(SID);
    expect((await api.delete(`/api/sessions/${SID}`)).status).toBe(204);
    expect(t.deps.messagingRepo.find(SID, "feishu")).toBeNull();
    expect(fake.connections[1]!.closed).toBe(true);
  });

  it("the session list marks rows with the ENABLED channel only", async () => {
    // Saved but disabled: no indicator — the row marks live connections, not stored configs.
    await api.put(BASE(SID), PUT_BODY);
    const saved = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const savedBody = (await saved.json()) as {
      sessions: Array<{ sessionId: string; messagingChannel?: string }>;
    };
    expect("messagingChannel" in savedBody.sessions.find((s) => s.sessionId === SID)!).toBe(false);

    await api.post(`${BASE(SID)}/state`, { enabled: true });
    const res = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; messagingChannel?: string }>;
    };
    expect(body.sessions.find((s) => s.sessionId === SID)?.messagingChannel).toBe("feishu");
  });

  it("start() connects only enabled bindings and reconciles away rows whose Session is gone", async () => {
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "feishu",
      accountId: "cli_boot",
      config: { appId: "cli_boot", appSecret: "boot-secret", baseDomain: "https://open.feishu.cn" },
    });
    t.deps.messagingRepo.setEnabled(SID, "feishu", true);
    // A saved-but-disabled binding keeps its credentials and stays dark across restarts.
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    t.deps.messagingRepo.upsert({
      sessionId: SID2,
      channel: "feishu",
      accountId: "cli_dark",
      config: { appId: "cli_dark", appSecret: "dark-secret", baseDomain: "https://open.feishu.cn" },
    });
    t.deps.messagingRepo.upsert({
      sessionId: "session-2026-08-25-10-00-02-dead0001",
      channel: "feishu",
      accountId: "cli_orphan",
      config: {
        appId: "cli_orphan",
        appSecret: "orphan-secret",
        baseDomain: "https://open.feishu.cn",
      },
    });
    await t.deps.messaging.start();
    expect(fake.connections.map((c) => c.creds.appId)).toEqual(["cli_boot"]);
    expect(t.deps.messagingRepo.find("session-2026-08-25-10-00-02-dead0001", "feishu")).toBeNull();
    expect(t.deps.messagingRepo.find(SID2, "feishu")?.enabled).toBe(false);
    t.deps.messaging.stop();
    expect(fake.connections[0]!.closed).toBe(true);
  });

  // —— Group mentions ————————————————————————————————————————————————————————
  // Feishu never puts a mention in the message text: it writes a placeholder (`@_user_1`)
  // and carries who it refers to alongside. Handed over raw, the model gets a token nothing
  // in the conversation can resolve — and every group message carries one, because
  // addressing a bot in a group means mentioning it.

  const groupMention = (
    text: string,
    mentions: { key: string; name: string; id?: { open_id?: string } }[],
    messageId = "om_mention",
  ) => ({
    chatId: "oc_group_1",
    chatType: "group",
    messageId,
    messageType: "text",
    content: JSON.stringify({ text }),
    mentions: mentions.map((m) => ({
      key: m.key,
      name: m.name,
      ...(m.id?.open_id !== undefined ? { openId: m.id.open_id } : {}),
    })),
  });

  /** The identity lookup rides a background promise, so a test that needs its answer waits for it. */
  const bindWithIdentity = async (sid: string) => {
    fake.botOpenId = "ou_this_bot";
    await bindEnabled(sid);
    await waitFor(() => fake.botIdentityLookups === 1);
  };

  it("resolves mention placeholders to names and drops this bot's own", async () => {
    await bindWithIdentity(SID);
    await fake.lastConnection().fire(
      groupMention("@_user_1 @_user_2 check the build", [
        { key: "@_user_1", name: "PenguinHarness", id: { open_id: "ou_this_bot" } },
        { key: "@_user_2", name: "Alice", id: { open_id: "ou_alice" } },
      ]),
    );
    await waitFor(() => runs.length === 1);
    // The bot's own mention is gone (the model is deliberately not told the message arrived
    // through a chat channel); Alice's is a name the model can actually use.
    expect(runs[0]![0]!.text).toBe("@Alice check the build");
  });

  it("names this bot's mention like any other when its identity is unavailable", async () => {
    // botOpenId stays null: the app cannot report one (bot capability off, or the call
    // failed). Naming beats a raw placeholder, and the connection is never refused over it.
    await bindEnabled(SID);
    await fake
      .lastConnection()
      .fire(
        groupMention("@_user_1 status?", [
          { key: "@_user_1", name: "PenguinHarness", id: { open_id: "ou_this_bot" } },
        ]),
      );
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("@PenguinHarness status?");
  });

  it("replaces the longest placeholder first, so a tenth mention is not corrupted by the first", async () => {
    await bindWithIdentity(SID);
    // Feishu numbers placeholders from 1 up, so @_user_1 is a literal prefix of @_user_10.
    await fake.lastConnection().fire(
      groupMention("@_user_10 and @_user_1 ship it", [
        { key: "@_user_1", name: "Alice", id: { open_id: "ou_alice" } },
        { key: "@_user_10", name: "Jules", id: { open_id: "ou_jules" } },
      ]),
    );
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("@Jules and @Alice ship it");
  });

  it("a message that is nothing but a mention starts no Task", async () => {
    await bindWithIdentity(SID);
    await fake
      .lastConnection()
      .fire(
        groupMention("@_user_1 ", [
          { key: "@_user_1", name: "PenguinHarness", id: { open_id: "ou_this_bot" } },
        ]),
      );
    // Nothing but the mention: no words to run a Task on, so it takes the same branch a
    // sticker does rather than spending a turn on a bare placeholder.
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allSends()[0]!.text).toBe(MESSAGING_TEXT_ONLY_NOTICE);
    expect(runs).toHaveLength(0);
  });

  it("a direct chat with no mentions is untouched", async () => {
    await bindEnabled(SID);
    await fake.lastConnection().fire({
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_plain",
      messageType: "text",
      content: JSON.stringify({ text: "@_user_1 is not a placeholder here" }),
    });
    await waitFor(() => runs.length === 1);
    // No mentions array means nothing to resolve: the text is whatever the user typed,
    // even when it happens to look like a placeholder.
    expect(runs[0]![0]!.text).toBe("@_user_1 is not a placeholder here");
  });

  it("names this bot's mention when it is not the addressing prefix", async () => {
    await bindWithIdentity(SID);
    await fake
      .lastConnection()
      .fire(
        groupMention("why did @_user_1 stop replying?", [
          { key: "@_user_1", name: "PenguinHarness", id: { open_id: "ou_this_bot" } },
        ]),
      );
    await waitFor(() => runs.length === 1);
    // Only the addressing prefix is dropped. Named mid-sentence, this bot is a word the user
    // chose — cutting it would hand the model a sentence with a hole (and a double space) in it.
    expect(runs[0]![0]!.text).toBe("why did @PenguinHarness stop replying?");
  });

  it("substitutes over the original text, never over its own output", async () => {
    await bindWithIdentity(SID);
    // A display name that reads like another key: substituting key by key would let the
    // `@_user_10` round rewrite what the `@_user_1` round had just written.
    await fake.lastConnection().fire(
      groupMention("@_user_1 and @_user_10 ship it", [
        { key: "@_user_1", name: "Alice", id: { open_id: "ou_alice" } },
        { key: "@_user_10", name: "_user_1", id: { open_id: "ou_weird" } },
      ]),
    );
    await waitFor(() => runs.length === 1);
    expect(runs[0]![0]!.text).toBe("@Alice and @_user_1 ship it");
  });

  it("leaves a repeat of a key alone: Feishu emits each one once, so the rest is typed text", async () => {
    await bindWithIdentity(SID);
    await fake
      .lastConnection()
      .fire(
        groupMention("@_user_1 why did you say @_user_1 to me?", [
          { key: "@_user_1", name: "PenguinHarness", id: { open_id: "ou_this_bot" } },
        ]),
      );
    await waitFor(() => runs.length === 1);
    // The head placeholder is this bot's own mention; the second is eight characters the user
    // typed by hand, and they reach the model as typed.
    expect(runs[0]![0]!.text).toBe("why did you say @_user_1 to me?");
  });

  it("connects without waiting for the bot-identity lookup to answer", async () => {
    // The lookup is an HTTP round trip with no timeout under it, and every enabled binding
    // connects on the server's boot path: an endpoint that accepts TCP and then says nothing
    // must not keep the HTTP listener from ever binding.
    fake.stallBotOpenId = true;
    fake.botOpenId = "ou_this_bot";
    await bindEnabled(SID);
    await waitFor(() => fake.botIdentityLookups === 1);
    await fake
      .lastConnection()
      .fire(
        groupMention("@_user_1 status?", [
          { key: "@_user_1", name: "PenguinHarness", id: { open_id: "ou_this_bot" } },
        ]),
      );
    await waitFor(() => runs.length === 1);
    // The connection is live with the identity still outstanding, so this bot's mention is
    // named like anyone else's — the degraded mode an app that cannot report one already has.
    expect(runs[0]![0]!.text).toBe("@PenguinHarness status?");
  });

  // —— Inbound deduplication ————————————————————————————————————————————————
  // A channel can hand the bridge the same message twice: a Feishu long connection
  // replays across a reconnect, and any connector that resumes an unconfirmed stream can
  // do the same. Nothing about `queueIfBusy` is idempotent, so both copies used to queue
  // and both used to run — reaching the chat AND the Web App, since a follow-up's input
  // is published to the Session channel.

  it("a redelivered message starts one Task, not two", async () => {
    await bindEnabled(SID);
    const replay = {
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_replayed",
      messageType: "text",
      content: JSON.stringify({ text: "deploy the build" }),
    };
    await fake.lastConnection().fire(replay);
    await waitFor(() => runs.length === 1);
    // The channel replays the identical event — same message id, same text.
    await fake.lastConnection().fire(replay);
    await settle(80);
    expect(runs).toHaveLength(1);
    expect(runs[0]![0]!.text).toBe("deploy the build");
  });

  it("does not swallow a genuine repeat: the same text sent twice runs twice", async () => {
    await bindEnabled(SID);
    const send = (messageId: string) =>
      fake.lastConnection().fire({
        chatId: "oc_chat_1",
        chatType: "p2p",
        messageId,
        messageType: "text",
        content: JSON.stringify({ text: "status?" }),
      });
    // Identity is the channel's message id, never the text — a user really does ask the
    // same question twice, and swallowing that is worse than the duplicate it prevents.
    await send("om_first");
    await waitFor(() => runs.length === 1);
    await send("om_second");
    await waitFor(() => runs.length === 2);
    expect(runs.map((r) => r[0]!.text)).toEqual(["status?", "status?"]);
  });

  it("dedupes a replayed non-text message too, so the text-only notice is sent once", async () => {
    await bindEnabled(SID);
    const sticker = {
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_sticker",
      messageType: "sticker",
      content: JSON.stringify({}),
    };
    await fake.lastConnection().fire(sticker);
    await waitFor(() => fake.allSends().length === 1);
    await fake.lastConnection().fire(sticker);
    await settle(80);
    expect(fake.allSends().filter((x) => x.text === MESSAGING_TEXT_ONLY_NOTICE)).toHaveLength(1);
  });

  it("bounds what it remembers: an id far enough back is forgotten rather than kept forever", async () => {
    await bindEnabled(SID);
    const fire = (messageId: string) =>
      fake.lastConnection().fire({
        chatId: "oc_chat_1",
        chatType: "p2p",
        messageId,
        messageType: "text",
        content: JSON.stringify({ text: messageId }),
      });
    // 65 distinct messages: one past the per-binding cap, so the first is evicted. The
    // cap is the point — a server that runs for months must not accumulate every id it
    // has ever seen — and forgetting the oldest is the price it buys.
    for (let i = 0; i < 65; i += 1) await fire(`om_bound_${i}`);
    await waitFor(() => runs.length === 65, 10_000);
    await fire("om_bound_0");
    await waitFor(() => runs.length === 66, 10_000);
    // The most recent ids are still remembered.
    await fire("om_bound_64");
    await settle(80);
    expect(runs).toHaveLength(66);
  });

  it("a message with no channel id leaves the binding's watermark where it was", async () => {
    await bindEnabled(SID);
    const fire = (messageId: string, text: string) =>
      fake.lastConnection().fire({
        chatId: "oc_chat_1",
        chatType: "p2p",
        messageId,
        messageType: "text",
        content: JSON.stringify({ text }),
      });
    await fire("om_identified", "deploy the build");
    await waitFor(() => runs.length === 1);
    // A connector that mints no message identity opts out of the dedupe entirely (see
    // isRedelivery), so it has nothing to say about the last message that did carry one —
    // and must not wipe the restart guard on its way past.
    await fire("", "and again");
    await waitFor(() => runs.length === 2);
    expect(t.deps.messagingRepo.find(SID, "feishu")?.lastInboundMessageId).toBe("om_identified");
  });

  it("remembers across a SERVER restart: the binding row's watermark survives the process", async () => {
    await bindEnabled(SID);
    const evt = {
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_across_restart_process",
      messageType: "text",
      content: JSON.stringify({ text: "deploy the build" }),
    };
    await fake.lastConnection().fire(evt);
    await waitFor(() => runs.length === 1);
    // The id of the message just processed is on the row, written by the same statement
    // that recorded its chat.
    expect(t.deps.messagingRepo.find(SID, "feishu")?.lastInboundMessageId).toBe(
      "om_across_restart_process",
    );

    // Feishu then replays, on the connection the successor has just opened, the event it
    // never saw acknowledged.
    t.deps.messaging.stop();
    const successor = restartBridge();
    try {
      await successor.start();
      await fake.lastConnection().fire(evt);
      await settle(80);
      expect(runs).toHaveLength(1);
      // Control: the successor is not merely deaf. Seeding the ring has to silence the one
      // replayed id and nothing else — a bridge that never wired onMessage, or one whose
      // seeding poisoned the ring wholesale, passes the assertion above identically.
      await fake.lastConnection().fire({
        ...evt,
        messageId: "om_after_restart",
        content: JSON.stringify({ text: "and now this" }),
      });
      await waitFor(() => runs.length === 2);
      expect(runs[1]![0]!.text).toBe("and now this");
    } finally {
      successor.stop();
    }
  });

  it("a replayed non-text message does not re-send the text-only notice across a restart", async () => {
    await bindEnabled(SID);
    const sticker = {
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_sticker_restart",
      messageType: "sticker",
      content: JSON.stringify({}),
    };
    await fake.lastConnection().fire(sticker);
    await waitFor(() => fake.allSends().length === 1);
    // Sending the notice IS the work for a non-text message, so finishing it carries the
    // binding's watermark forward exactly as a started Task does.
    expect(t.deps.messagingRepo.find(SID, "feishu")?.lastInboundMessageId).toBe(
      "om_sticker_restart",
    );

    t.deps.messaging.stop();
    const successor = restartBridge();
    try {
      await successor.start();
      await fake.lastConnection().fire(sticker);
      await settle(80);
      expect(fake.allSends().filter((x) => x.text === MESSAGING_TEXT_ONLY_NOTICE)).toHaveLength(1);
      // Control: a sticker the binding has never seen still gets its notice.
      await fake.lastConnection().fire({ ...sticker, messageId: "om_sticker_after_restart" });
      await waitFor(
        () => fake.allSends().filter((x) => x.text === MESSAGING_TEXT_ONLY_NOTICE).length === 2,
      );
    } finally {
      successor.stop();
    }
  });

  it("a message whose Task never started is left unwatermarked, so the replay runs it", async () => {
    await bindEnabled(SID);
    const evt = {
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_start_threw",
      messageType: "text",
      content: JSON.stringify({ text: "deploy the build" }),
    };
    // The window the ordering guards. A message becomes a Task, and a busy Session's
    // queued follow-up lives in memory only — so a watermark written ahead of the work
    // would outlive it, and the successor's seeding would turn the channel's replay into a
    // no-op: the message never runs and nothing ever answers. A runner that throws stands
    // in for the process that died before the Task existed.
    t.deps.messaging.stop();
    const stillborn = restartBridge({
      statusOf: () => "idle",
      startTask: () => Promise.reject(new Error("the Session went away")),
    });
    try {
      await stillborn.start();
      await fake.lastConnection().fire(evt);
      const row = t.deps.messagingRepo.find(SID, "feishu");
      // The chat is remembered either way — the outbound relay reads it, and even a
      // rejected message teaches the bridge where the user is.
      expect(row?.lastChatId).toBe("oc_chat_1");
      expect(row?.lastInboundMessageId).toBeNull();
    } finally {
      stillborn.stop();
    }

    const successor = restartBridge();
    try {
      await successor.start();
      await fake.lastConnection().fire(evt);
      await waitFor(() => runs.length === 1);
      expect(runs[0]![0]!.text).toBe("deploy the build");
    } finally {
      successor.stop();
    }
  });

  it("re-saving a binding onto a different bot account drops the watermark with the chat", () => {
    const repo = t.deps.messagingRepo;
    const save = (accountId: string) =>
      repo.upsert({ sessionId: SID, channel: "feishu", accountId, config: { appId: accountId } });
    expect(save("cli_before").accountId).toBe("cli_before");
    repo.recordChat(SID, "feishu", "oc_group_1", false);
    repo.recordInboundWatermark(SID, "feishu", "om_before_resave");
    // Re-saving the SAME account is an ordinary settings edit — a rotated secret, say —
    // and this bot's chat and its message ids still belong to this binding.
    expect(save("cli_before").accountId).toBe("cli_before");
    expect(repo.find(SID, "feishu")).toMatchObject({
      lastChatId: "oc_group_1",
      lastChatIsDirect: false,
      lastInboundMessageId: "om_before_resave",
    });
    // A DIFFERENT account: a reply must never land in the old bot's conversation, and the
    // old bot's message ids would only silence themselves.
    expect(save("cli_after").accountId).toBe("cli_after");
    expect(repo.find(SID, "feishu")).toMatchObject({
      lastChatId: null,
      lastChatIsDirect: true,
      lastInboundMessageId: null,
    });
  });

  it("remembers across a connector restart, so a re-enable does not replay a message", async () => {
    await bindEnabled(SID);
    const evt = {
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_across_restart",
      messageType: "text",
      content: JSON.stringify({ text: "once only" }),
    };
    await fake.lastConnection().fire(evt);
    await waitFor(() => runs.length === 1);
    // Save-while-enabled restarts the connector with a fresh entry; the memory of what has
    // already been processed belongs to the binding, not to one connection.
    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(200);
    await fake.lastConnection().fire(evt);
    await settle(80);
    expect(runs).toHaveLength(1);
  });
});

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
