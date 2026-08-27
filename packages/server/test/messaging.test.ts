/**
 * Messaging-binding tests, Feishu side (the Telegram connector's mirror suite is
 * messaging-telegram.test.ts): the repo's two uniqueness rules, the
 * /api/sessions/:id/messaging/feishu routes (masking, secret keep-on-blank, the
 * save/enable split — PUT persists credentials only, POST /state owns the connection —
 * 409s, authz split, cascade on session delete), and the bridge's routing through a fake
 * Feishu SDK — inbound text becomes an ordinary user task
 * exactly as if typed in the composer (no marker, no special sender; queueIfBusy),
 * non-text gets the bilingual text-only reply, each completed assistant message mirrors on
 * its own to the last known chat as soon as it completes (the run's first one threaded onto
 * the inbound message in groups), and an approval_request sends the one-line notice. No
 * test opens real network.
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
  MESSAGING_TEST_MESSAGE,
  MESSAGING_TEXT_ONLY_NOTICE,
  chunkMessagingText,
} from "../src/runtime/messaging/bridge.js";
import type {
  FeishuApiClient,
  FeishuCredentials,
  FeishuEventHandlers,
  FeishuInboundEvent,
  FeishuSdk,
} from "../src/runtime/messaging/feishu-sdk.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

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
    this.sends.push({ kind: "send", target: chatId, text });
  }
  async replyText(messageId: string, text: string): Promise<void> {
    this.sends.push({ kind: "reply", target: messageId, text });
  }
  async botOpenId(): Promise<string | null> {
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
  /** What `/open-apis/bot/v3/info` reports for this app; null = the identity is unavailable. */
  botOpenId: string | null = null;
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

  beforeEach(async () => {
    fake = new FakeSdk();
    t = await createTestApp({ feishuSdk: fake });
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

  it("one binding per app: a second Session on the same app_id gets 409 feishu_app_in_use", async () => {
    await api.put(BASE(SID), PUT_BODY);
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    const res = await api.put(BASE(SID2), PUT_BODY);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "feishu_app_in_use",
    );
    expect(t.deps.messagingRepo.find(SID2, "feishu")).toBeNull();
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

  it("resolves mention placeholders to names and drops this bot's own", async () => {
    fake.botOpenId = "ou_this_bot";
    await bindEnabled(SID);
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
    fake.botOpenId = "ou_this_bot";
    await bindEnabled(SID);
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
    fake.botOpenId = "ou_this_bot";
    await bindEnabled(SID);
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
