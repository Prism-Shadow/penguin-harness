/**
 * Feishu binding tests: the repo's two uniqueness rules, the /api/sessions/:id/feishu
 * routes (masking, secret keep-on-blank, 409s, authz split, cascade on session delete),
 * and the bridge's routing through a fake SDK — inbound text becomes a `[feishu_message]`
 * server task (queueIfBusy), non-text gets the bilingual text-only reply, a completed run
 * mirrors its assistant text to the last known chat (reply-to-message in groups), and an
 * approval_request sends the one-line notice. No test opens real network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, approvalDecision, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage } from "@prismshadow/penguin-core";
import type { FeishuBindingResponse, FeishuTestResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import {
  FEISHU_APPROVAL_NOTICE,
  FEISHU_TEST_MESSAGE,
  FEISHU_TEXT_ONLY_NOTICE,
  chunkFeishuText,
} from "../src/runtime/feishu-bridge.js";
import type {
  FeishuApiClient,
  FeishuCredentials,
  FeishuEventHandlers,
  FeishuInboundEvent,
  FeishuSdk,
} from "../src/runtime/feishu-sdk.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-25-10-00-00-fe15aa01";
const SID2 = "session-2026-08-25-10-00-01-fe15aa02";

// ---------------------------------------------------------------------------
// Fake SDK: records every client call and hands inbound events back to the bridge.
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
  async checkCredentials(): Promise<void> {
    this.checks++;
    if (this.sdk.failCheck !== null) throw new Error(this.sdk.failCheck);
  }
  async sendText(chatId: string, text: string): Promise<void> {
    this.sends.push({ kind: "send", target: chatId, text });
  }
  async replyText(messageId: string, text: string): Promise<void> {
    this.sends.push({ kind: "reply", target: messageId, text });
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

/** Fake Session: records each run's input texts and replies with a fixed assistant text. */
function echoFakeSession(
  sessionId: string,
  runs: string[][],
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
      runs.push(input.map((m) => (m.payload as { text?: string }).text ?? ""));
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
  enabled: true,
};

describe("chunkFeishuText", () => {
  it("returns short text whole and splits long text at newline boundaries under the cap", () => {
    expect(chunkFeishuText("short")).toEqual(["short"]);
    const chunks = chunkFeishuText(`${"a".repeat(30)}\n${"b".repeat(30)}`, 40);
    expect(chunks).toEqual(["a".repeat(30), "b".repeat(30)]);
    // No usable newline: a hard split at the cap.
    const hard = chunkFeishuText("x".repeat(90), 40);
    expect(hard.map((c) => c.length)).toEqual([40, 40, 10]);
    expect(hard.join("")).toBe("x".repeat(90));
  });
});

describe("feishu binding routes and bridge", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let fake: FakeSdk;
  let projectId: string;
  let runs: string[][];

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
    const res = await api.get(`/api/sessions/${SID}/feishu`);
    expect(res.status).toBe(200);
    expect((await res.json()) as FeishuBindingResponse).toEqual({
      binding: null,
      status: { state: "disconnected" },
    });
  });

  it("PUT binds (masked secret, connected status), blank secret keeps the stored one", async () => {
    const res = await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    expect(res.status).toBe(200);
    const body = (await res.json()) as FeishuBindingResponse;
    expect(body.binding?.appId).toBe(PUT_BODY.appId);
    // Site-wide mask rule: first4…last4, never the plaintext.
    expect(body.binding?.appSecretMasked).toBe("secr…3456");
    expect(JSON.stringify(body)).not.toContain(PUT_BODY.appSecret);
    expect(body.binding?.lastChatKnown).toBe(false);
    expect(body.status.state).toBe("connected");
    expect(fake.connections).toHaveLength(1);
    expect(fake.connections[0]!.creds.appId).toBe(PUT_BODY.appId);

    // Re-save with a blank secret: the stored one stays, and the save reconnects.
    const resave = await api.put(`/api/sessions/${SID}/feishu`, {
      appId: PUT_BODY.appId,
      appSecret: "",
      enabled: true,
    });
    expect(resave.status).toBe(200);
    expect(t.deps.feishuRepo.find(SID)?.appSecret).toBe(PUT_BODY.appSecret);
    expect(fake.connections).toHaveLength(2);
    expect(fake.connections[0]!.closed).toBe(true);

    // First-time bind without a secret is refused.
    t.deps.feishuRepo.delete(SID);
    const bare = await api.put(`/api/sessions/${SID}/feishu`, { appId: "cli_other" });
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "feishu_secret_required",
    );
  });

  it("PUT with enabled:false stores the binding without connecting; re-enable connects", async () => {
    const res = await api.put(`/api/sessions/${SID}/feishu`, { ...PUT_BODY, enabled: false });
    expect(((await res.json()) as FeishuBindingResponse).status.state).toBe("disconnected");
    expect(fake.connections).toHaveLength(0);
    await api.put(`/api/sessions/${SID}/feishu`, { appId: PUT_BODY.appId, enabled: true });
    expect(fake.connections).toHaveLength(1);
  });

  it("one binding per app: a second Session on the same app_id gets 409 feishu_app_in_use", async () => {
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    const res = await api.put(`/api/sessions/${SID2}/feishu`, PUT_BODY);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "feishu_app_in_use",
    );
    expect(t.deps.feishuRepo.find(SID2)).toBeNull();
  });

  it("authz: non-members get 404; a member reads but cannot write (owner-only)", async () => {
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    const outsider = apiClient(t.app, (await provisionUser(t.app, "outsider")).cookie);
    expect((await outsider.get(`/api/sessions/${SID}/feishu`)).status).toBe(404);

    const mate = await provisionUser(t.app, "mate");
    await api.post(`/api/projects/${projectId}/members`, { userId: "mate" });
    const member = apiClient(t.app, mate.cookie);
    const read = await member.get(`/api/sessions/${SID}/feishu`);
    expect(read.status).toBe(200);
    const write = await member.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    expect(write.status).toBe(403);
    expect((await member.delete(`/api/sessions/${SID}/feishu`)).status).toBe(403);
  });

  it("POST /test probes draft values falling back to stored ones, reporting ok/error", async () => {
    // Draft-only test (nothing stored yet).
    const draft = await api.post(`/api/sessions/${SID}/feishu/test`, {
      appId: "cli_draft",
      appSecret: "draft-secret",
    });
    expect(draft.status).toBe(200);
    expect(((await draft.json()) as FeishuTestResponse).ok).toBe(true);
    expect(fake.clients.at(-1)?.creds.appId).toBe("cli_draft");

    // Stored fallback: an empty body tests the saved binding.
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    const stored = await api.post(`/api/sessions/${SID}/feishu/test`, {});
    expect(((await stored.json()) as FeishuTestResponse).ok).toBe(true);
    expect(fake.clients.at(-1)?.creds.appId).toBe(PUT_BODY.appId);
    expect(fake.clients.at(-1)?.creds.appSecret).toBe(PUT_BODY.appSecret);

    // A rejected credential is ok:false with the reason, not an HTTP error.
    fake.failCheck = "app not found";
    const bad = await api.post(`/api/sessions/${SID}/feishu/test`, {});
    expect(bad.status).toBe(200);
    expect((await bad.json()) as FeishuTestResponse).toEqual({
      ok: false,
      error: "app not found",
    });

    // No stored binding and no draft appId: a plain 400.
    t.deps.feishuRepo.delete(SID);
    expect((await api.post(`/api/sessions/${SID}/feishu/test`, {})).status).toBe(400);
  });

  it("POST /test-message: 404 unbound, 409 before a chat is known, sends after one", async () => {
    expect((await api.post(`/api/sessions/${SID}/feishu/test-message`, {})).status).toBe(404);
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    const early = await api.post(`/api/sessions/${SID}/feishu/test-message`, {});
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe("feishu_no_chat");

    await fake.lastConnection().fire({
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_1",
      messageType: "text",
      content: JSON.stringify({ text: "hello" }),
    });
    const res = await api.post(`/api/sessions/${SID}/feishu/test-message`, {});
    expect(res.status).toBe(200);
    expect(fake.allSends()).toContainEqual({
      kind: "send",
      target: "oc_chat_1",
      text: FEISHU_TEST_MESSAGE,
    });
  });

  it("inbound text starts a [feishu_message] server task and the reply mirrors back (p2p)", async () => {
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    await fake.lastConnection().fire({
      chatId: "oc_chat_1",
      chatType: "p2p",
      messageId: "om_1",
      messageType: "text",
      content: JSON.stringify({ text: "how is the build?" }),
    });
    await waitFor(() => runs.length === 1);
    const input = runs[0]![0]!;
    expect(input.startsWith("[feishu_message]\n")).toBe(true);
    expect(input).toContain("chat_type: p2p");
    expect(input.endsWith("how is the build?")).toBe(true);
    // The inbound chat became the reply target.
    const row = t.deps.feishuRepo.find(SID)!;
    expect(row.lastChatId).toBe("oc_chat_1");
    expect(row.lastChatIsP2p).toBe(true);
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
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
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

  it("non-text messages get the bilingual text-only reply and start no task", async () => {
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
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
      text: FEISHU_TEXT_ONLY_NOTICE,
    });
    expect(runs).toHaveLength(0);
    // Even a rejected type teaches the bridge where the user is.
    expect(t.deps.feishuRepo.find(SID)?.lastChatId).toBe("oc_chat_1");
  });

  it("an approval_request sends the waiting-for-approval notice", async () => {
    const row2 = sessionRowOf(SID2, projectId);
    row2.approvalMode = "always-ask";
    t.deps.sessionsRepo.insert(row2);
    t.deps.manager.adopt(row2, parkingFakeSession(SID2));
    await api.put(`/api/sessions/${SID2}/feishu`, { ...PUT_BODY, appId: "cli_approver" });
    await fake.lastConnection().fire({
      chatId: "oc_chat_2",
      chatType: "p2p",
      messageId: "om_3",
      messageType: "text",
      content: JSON.stringify({ text: "do something risky" }),
    });
    await waitFor(() =>
      fake.allSends().some((s) => s.text === FEISHU_APPROVAL_NOTICE && s.target === "oc_chat_2"),
    );
    t.deps.manager.decideApproval(SID2, "tc-feishu", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
  });

  it("DELETE unbinds + disconnects, and deleting the Session cascades the binding away", async () => {
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    expect((await api.delete(`/api/sessions/${SID}/feishu`)).status).toBe(204);
    expect(t.deps.feishuRepo.find(SID)).toBeNull();
    expect(fake.connections[0]!.closed).toBe(true);
    expect(t.deps.feishu.statusOf(SID).state).toBe("disconnected");

    // Rebind, then delete the Session itself: the binding goes with it.
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    expect((await api.delete(`/api/sessions/${SID}`)).status).toBe(204);
    expect(t.deps.feishuRepo.find(SID)).toBeNull();
    expect(fake.connections[1]!.closed).toBe(true);
  });

  it("the session list marks bound rows with feishuBound", async () => {
    await api.put(`/api/sessions/${SID}/feishu`, PUT_BODY);
    const res = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; feishuBound?: boolean }>;
    };
    expect(body.sessions.find((s) => s.sessionId === SID)?.feishuBound).toBe(true);
    // Unbound rows omit the field entirely rather than carrying false.
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    const again = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const list = (await again.json()) as {
      sessions: Array<{ sessionId: string; feishuBound?: boolean }>;
    };
    expect("feishuBound" in list.sessions.find((s) => s.sessionId === SID2)!).toBe(false);
  });

  it("start() connects enabled bindings and reconciles away rows whose Session is gone", async () => {
    t.deps.feishuRepo.upsert({
      sessionId: SID,
      appId: "cli_boot",
      appSecret: "boot-secret",
      baseDomain: "https://open.feishu.cn",
      enabled: true,
    });
    t.deps.feishuRepo.upsert({
      sessionId: "session-2026-08-25-10-00-02-dead0001",
      appId: "cli_orphan",
      appSecret: "orphan-secret",
      baseDomain: "https://open.feishu.cn",
      enabled: true,
    });
    await t.deps.feishu.start();
    expect(fake.connections.map((c) => c.creds.appId)).toEqual(["cli_boot"]);
    expect(t.deps.feishuRepo.find("session-2026-08-25-10-00-02-dead0001")).toBeNull();
    t.deps.feishu.stop();
    expect(fake.connections[0]!.closed).toBe(true);
  });
});
