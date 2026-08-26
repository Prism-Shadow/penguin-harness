/**
 * Messaging-binding tests (Feishu is the only channel): the repo's two uniqueness rules,
 * the /api/sessions/:id/messaging/feishu routes (masking, secret keep-on-blank, the
 * save/enable split — PUT persists credentials only, POST /state owns the connection —
 * 409s, authz split, cascade on session delete), and the bridge's routing through a fake
 * Feishu SDK — inbound text becomes an ordinary user task
 * exactly as if typed in the composer (no marker, no special sender; queueIfBusy),
 * non-text gets the bilingual text-only reply, a completed run mirrors its assistant text
 * to the last known chat (reply-to-message in groups), and an approval_request sends the
 * one-line notice. No test opens real network.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText, approvalDecision, toolCall } from "@prismshadow/penguin-core";
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
    const stored = t.deps.messagingRepo.find(SID)!;
    expect(stored.channel).toBe("feishu");
    expect(stored.accountId).toBe(PUT_BODY.appId);

    // Re-save with a blank secret: the stored one stays; still disabled, still dark.
    const resave = await api.put(BASE(SID), { appId: PUT_BODY.appId, appSecret: "" });
    expect(resave.status).toBe(200);
    expect(t.deps.messagingRepo.find(SID)?.config.appSecret).toBe(PUT_BODY.appSecret);
    expect(fake.connections).toHaveLength(0);

    // First-time bind without a secret is refused.
    t.deps.messagingRepo.delete(SID);
    const bare = await api.put(BASE(SID), { appId: "cli_other" });
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
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
    expect(t.deps.messagingRepo.find(SID2)).toBeNull();
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
    t.deps.messagingRepo.delete(SID);
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
    const row = t.deps.messagingRepo.find(SID)!;
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
    expect(t.deps.messagingRepo.find(SID)?.lastChatId).toBe("oc_chat_1");
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
    expect(t.deps.messagingRepo.find(SID)).toBeNull();
    expect(fake.connections[0]!.closed).toBe(true);
    expect(t.deps.messaging.statusOf(SID).state).toBe("disconnected");

    // Rebind + enable, then delete the Session itself: the binding goes with it.
    await bindEnabled(SID);
    expect((await api.delete(`/api/sessions/${SID}`)).status).toBe(204);
    expect(t.deps.messagingRepo.find(SID)).toBeNull();
    expect(fake.connections[1]!.closed).toBe(true);
  });

  it("the session list marks bound rows with messagingBound", async () => {
    await api.put(BASE(SID), PUT_BODY);
    const res = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const body = (await res.json()) as {
      sessions: Array<{ sessionId: string; messagingBound?: boolean }>;
    };
    expect(body.sessions.find((s) => s.sessionId === SID)?.messagingBound).toBe(true);
    // Unbound rows omit the field entirely rather than carrying false.
    const row2 = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row2);
    const again = await api.get(`/api/projects/${projectId}/agents/default_agent/sessions`);
    const list = (await again.json()) as {
      sessions: Array<{ sessionId: string; messagingBound?: boolean }>;
    };
    expect("messagingBound" in list.sessions.find((s) => s.sessionId === SID2)!).toBe(false);
  });

  it("start() connects only enabled bindings and reconciles away rows whose Session is gone", async () => {
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "feishu",
      accountId: "cli_boot",
      config: { appId: "cli_boot", appSecret: "boot-secret", baseDomain: "https://open.feishu.cn" },
    });
    t.deps.messagingRepo.setEnabled(SID, true);
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
    expect(t.deps.messagingRepo.find("session-2026-08-25-10-00-02-dead0001")).toBeNull();
    expect(t.deps.messagingRepo.find(SID2)?.enabled).toBe(false);
    t.deps.messaging.stop();
    expect(fake.connections[0]!.closed).toBe(true);
  });
});
