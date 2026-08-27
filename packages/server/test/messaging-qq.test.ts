/**
 * QQ messaging tests — the third channel's mirror of messaging.test.ts, and the proof the
 * connector seam survives a platform that will not let a bot speak freely.
 *
 * Two halves. The ordinary one repeats what the other channels already pin, because the
 * route wiring is per-channel even where the behaviour is not: secret masking and
 * keep-on-blank, the App ID as the account identity and the enable-time 409 it collides
 * on, the save/enable split, the channel-agnostic GET, the credential probe.
 *
 * The half that only exists here is the PASSIVE REPLY BUDGET. QQ accepts a fixed, small
 * number of replies to one inbound message and has no push this product may use, so the
 * connector coalesces a run's messages to fit. These tests are the ones that matter:
 * exactly four sends for a run that completed six messages, the last carrying the
 * remainder; `msg_seq` increasing without repeating; the approval notice taking the
 * reserved slot rather than being lost behind it; one-message-per-line clamped to the
 * budget instead of the channel-neutral 20; and a send with nothing to reply to failing
 * loudly rather than pretending. No test opens a socket.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, OmniMessage, TextPayload } from "@prismshadow/penguin-core";
import type {
  MessagingBindingsResponse,
  QQBindingResponse,
  QQTestResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import {
  MESSAGING_APPROVAL_NOTICE,
  MESSAGING_TEST_MESSAGE,
  MESSAGING_TEXT_ONLY_NOTICE,
} from "../src/runtime/messaging/bridge.js";
import type { MessagingClient } from "../src/runtime/messaging/connector.js";
import type {
  QQBotClient,
  QQCredentials,
  QQGatewayConnection,
  QQGatewayHandlers,
  QQInboundEvent,
  QQSendArgs,
  QQTransport,
} from "../src/runtime/messaging/qq-api.js";
import { normalizeDispatch, qqSendErrorText } from "../src/runtime/messaging/qq-api.js";
import type { QQConnectorOpts } from "../src/runtime/messaging/qq-connector.js";
import {
  QQ_PASSIVE_WINDOW_MS,
  QQ_REPLY_BUDGET,
  QQConnector,
  parseQQChatId,
  qqChatIdOf,
  qqConfigOf,
} from "../src/runtime/messaging/qq-connector.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-27-10-00-00-q9000001";
const SID2 = "session-2026-08-27-10-00-01-q9000002";
const BASE = (sid: string) => `/api/sessions/${sid}/messaging/qq`;
const APP_ID = "102000001";
const APP_SECRET = "qq-app-secret-ABCD-1234";
const USER_OPENID = "user_openid_aaa";
const GROUP_OPENID = "group_openid_bbb";

/**
 * The tail's flush delay in tests. Non-zero on purpose: a zero timer would fire between two
 * relayed messages of the same run (the bridge awaits a repo read and a client build per
 * message), which would coalesce a different set than production does. Small enough that
 * every wait below still settles well inside waitFor's timeout.
 */
const TAIL_MS = 120;

// ---------------------------------------------------------------------------
// Fake transport: records sends, and hands each opened gateway back to the test so it can
// push events. Never constructs a socket or a fetch.
// ---------------------------------------------------------------------------

class FakeQQClient implements QQBotClient {
  readonly sends: QQSendArgs[] = [];
  credentialChecks = 0;
  constructor(
    readonly creds: QQCredentials,
    private readonly t: FakeQQTransport,
  ) {}

  async checkCredentials(): Promise<void> {
    this.credentialChecks++;
    if (this.t.failAuth !== null) throw new Error(this.t.failAuth);
  }

  async sendMessage(args: QQSendArgs): Promise<void> {
    if (this.t.failSend !== null) throw new Error(this.t.failSend);
    this.sends.push(args);
  }
}

class FakeQQGateway implements QQGatewayConnection {
  closed = false;
  constructor(
    readonly creds: QQCredentials,
    private readonly handlers: QQGatewayHandlers,
  ) {}
  close(): void {
    this.closed = true;
  }
  /** Pushes one inbound event, as the gateway's dispatch would. */
  fire(evt: QQInboundEvent): Promise<void> {
    return Promise.resolve(this.handlers.onMessage(evt));
  }
}

class FakeQQTransport implements QQTransport {
  readonly clients: FakeQQClient[] = [];
  readonly gateways: FakeQQGateway[] = [];
  /** Non-null makes the credential probe throw with this message. */
  failAuth: string | null = null;
  /** Non-null makes every send throw with this message. */
  failSend: string | null = null;

  createClient(creds: QQCredentials): FakeQQClient {
    const client = new FakeQQClient(creds, this);
    this.clients.push(client);
    return client;
  }

  async openGateway(
    creds: QQCredentials,
    handlers: QQGatewayHandlers,
  ): Promise<QQGatewayConnection> {
    const gw = new FakeQQGateway(creds, handlers);
    this.gateways.push(gw);
    handlers.onReady?.();
    return gw;
  }

  lastGateway(): FakeQQGateway {
    const gw = this.gateways.at(-1);
    if (!gw) throw new Error("no fake qq gateway was opened");
    return gw;
  }

  /** Every send across every client, in the order the platform would have seen them. */
  allSends(): QQSendArgs[] {
    return this.clients.flatMap((c) => c.sends);
  }
}

/** A single-chat text message from a fixed user. */
function c2cText(content: string, messageId: string): QQInboundEvent {
  return { kind: "c2c", openid: USER_OPENID, messageId, content, senderOpenid: USER_OPENID };
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

/** Fake Session completing several assistant messages in ONE run — the budget's whole point. */
function multiMessageFakeSession(sessionId: string, texts: readonly string[]): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      for (const text of texts) yield assistantText(text);
    },
    async *compact() {},
  };
}

/** Fake Session that completes `texts` and THEN parks on an approval (drives approval_request). */
function parkingAfterMessagesSession(sessionId: string, texts: readonly string[]): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run(_input: OmniMessage[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      for (const text of texts) yield assistantText(text);
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-qq" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-qq");
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

describe("qq config and chat ids", () => {
  it("narrows a stored config and rejects a malformed one", () => {
    expect(qqConfigOf({ appId: APP_ID, appSecret: APP_SECRET })).toEqual({
      appId: APP_ID,
      appSecret: APP_SECRET,
    });
    expect(() => qqConfigOf({ appId: APP_ID })).toThrow(/malformed qq binding config/);
    expect(() => qqConfigOf({ appId: "", appSecret: APP_SECRET })).toThrow();
  });

  it("round-trips a chat id, which carries the scene as well as the openid", () => {
    // The same openid means different things on the two sides and is answered by different
    // endpoints, so the scene has to ride the id the bridge stores.
    expect(parseQQChatId(qqChatIdOf("c2c", USER_OPENID))).toEqual({
      kind: "c2c",
      openid: USER_OPENID,
    });
    expect(parseQQChatId(qqChatIdOf("group", GROUP_OPENID))).toEqual({
      kind: "group",
      openid: GROUP_OPENID,
    });
    expect(() => parseQQChatId("nonsense")).toThrow(/malformed qq chat id/);
    expect(() => parseQQChatId("c2c:")).toThrow();
  });
});

describe("normalizeDispatch", () => {
  it("reads the two subscribed events, each from its own author field", () => {
    // The group event's sender is member_openid; user_openid exists there too and is blank,
    // so reading the wrong one yields silent nonsense rather than an error.
    expect(
      normalizeDispatch({
        op: 0,
        t: "C2C_MESSAGE_CREATE",
        d: { id: "m1", content: "hello", author: { user_openid: USER_OPENID } },
      }),
    ).toEqual({
      kind: "c2c",
      openid: USER_OPENID,
      messageId: "m1",
      content: "hello",
      senderOpenid: USER_OPENID,
    });
    expect(
      normalizeDispatch({
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "m2",
          // The platform strips the @-mention but leaves the space it sat in.
          content: " status?",
          group_openid: GROUP_OPENID,
          author: { user_openid: "", member_openid: "member_1" },
        },
      }),
    ).toEqual({
      kind: "group",
      openid: GROUP_OPENID,
      messageId: "m2",
      content: "status?",
      senderOpenid: "member_1",
    });
  });

  it("takes the platform at its word on the @bot prefix and edits nothing else", () => {
    // The whole of this channel's mention handling: the platform removes the bot's own
    // mention from a group message's content and leaves the whitespace it sat in, and the
    // trim is this side's half of that contract. Pinned because it is the sibling of the
    // defect #497 fixed on the other two channels — where the placeholder or handle DOES
    // reach the connector and has to be resolved or cut.
    const mentioning = normalizeDispatch({
      op: 0,
      t: "GROUP_AT_MESSAGE_CREATE",
      d: {
        id: "m_at",
        content: "   summarize what <@!member_2> said\t",
        group_openid: GROUP_OPENID,
        author: { member_openid: "member_1" },
      },
    });
    // A mention of somebody ELSE is content. This connector has no identity to resolve it
    // against and makes no claim about its shape, so whatever the platform put there
    // reaches the model exactly as it arrived — the trim is the only edit.
    expect(mentioning?.content).toBe("summarize what <@!member_2> said");
    // ...and a group message left with nothing but the stripped mention reads as no text,
    // which the bridge answers with the text-only notice instead of starting a run on it.
    expect(
      normalizeDispatch({
        op: 0,
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "m_bare",
          content: "  ",
          group_openid: GROUP_OPENID,
          author: { member_openid: "member_1" },
        },
      })?.content,
    ).toBe("");
  });

  it("drops everything else the intent carries, including the un-mentioned group firehose", () => {
    for (const t of ["GROUP_MESSAGE_CREATE", "FRIEND_ADD", "READY", "RESUMED"]) {
      expect(normalizeDispatch({ op: 0, t, d: { id: "m", content: "x" } })).toBeNull();
    }
    // A message with no id cannot be replied to and is not a message this product can use.
    expect(normalizeDispatch({ op: 0, t: "C2C_MESSAGE_CREATE", d: { content: "x" } })).toBeNull();
  });
});

describe("qqSendErrorText", () => {
  it("names the rule behind the one failure this product can provoke", () => {
    expect(qqSendErrorText(40034128, "msg over limit")).toContain("only a few replies");
    expect(qqSendErrorText(40034005, "invalid msg_id")).toContain("expired");
    // Anything else is the platform's own wording, untouched.
    expect(qqSendErrorText(12345, "something else")).toBe("something else");
    expect(qqSendErrorText(undefined, "HTTP 500")).toBe("HTTP 500");
  });
});

describe("qq binding routes and the passive reply budget", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let fake: FakeQQTransport;
  let projectId: string;
  let runs: TextPayload[][];

  /** Save the credentials, then flip the toggle on and wait for the gateway handshake. */
  const bindEnabled = async (sid: string, appId = APP_ID) => {
    expect((await api.put(BASE(sid), { appId, appSecret: APP_SECRET })).status).toBe(200);
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sid, "qq").state === "connected");
  };

  beforeEach(async () => {
    fake = new FakeQQTransport();
    t = await createTestApp({ qqTransport: fake, qqTailFlushMs: TAIL_MS });
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

  // —— Routes ——————————————————————————————————————————————————————————————

  it("PUT saves the pair only (secret masked, App ID as the account, disabled, no gateway)", async () => {
    const res = await api.put(BASE(SID), { appId: APP_ID, appSecret: APP_SECRET });
    expect(res.status).toBe(200);
    const body = (await res.json()) as QQBindingResponse;
    expect(body.binding?.channel).toBe("qq");
    expect(body.binding?.appId).toBe(APP_ID);
    expect(body.binding?.appSecretMasked).toBe("qq-a…1234");
    expect(JSON.stringify(body)).not.toContain(APP_SECRET);
    expect(body.binding?.enabled).toBe(false);
    expect(body.status.state).toBe("disconnected");
    expect(fake.gateways).toHaveLength(0);
    // The App ID is the account identity, exactly as the Feishu app id is.
    expect(t.deps.messagingRepo.find(SID, "qq")?.accountId).toBe(APP_ID);

    // Blank secret keeps the stored one; still dark.
    expect((await api.put(BASE(SID), { appId: APP_ID })).status).toBe(200);
    expect(t.deps.messagingRepo.find(SID, "qq")?.config.appSecret).toBe(APP_SECRET);
    expect(fake.gateways).toHaveLength(0);

    // A first bind with no secret at all is refused.
    t.deps.messagingRepo.delete(SID, "qq");
    const bare = await api.put(BASE(SID), { appId: APP_ID });
    expect(bare.status).toBe(400);
    expect(((await bare.json()) as { error: { code: string } }).error.code).toBe(
      "qq_secret_required",
    );
  });

  it("POST /state owns the connection, and a re-save while enabled restarts the gateway", async () => {
    expect((await api.post(`${BASE(SID)}/state`, { enabled: true })).status).toBe(404);
    await bindEnabled(SID);
    expect(fake.lastGateway().creds).toEqual({ appId: APP_ID, appSecret: APP_SECRET });

    const rotated = "qq-app-secret-EFGH-5678";
    expect((await api.put(BASE(SID), { appId: APP_ID, appSecret: rotated })).status).toBe(200);
    expect(fake.gateways[0]!.closed).toBe(true);
    await waitFor(() => t.deps.messaging.statusOf(SID, "qq").state === "connected");
    expect(fake.lastGateway().creds.appSecret).toBe(rotated);

    const off = await api.post(`${BASE(SID)}/state`, { enabled: false });
    expect(((await off.json()) as QQBindingResponse).status.state).toBe("disconnected");
    expect(fake.lastGateway().closed).toBe(true);
  });

  it("the account is the App ID: saving never collides, enabling does", async () => {
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    await bindEnabled(SID);
    expect(
      (await api.put(BASE(SID2), { appId: APP_ID, appSecret: "other-secret-9999" })).status,
    ).toBe(200);

    const blocked = await api.post(`${BASE(SID2)}/state`, { enabled: true });
    expect(blocked.status).toBe(409);
    const refusal = (await blocked.json()) as { error: { code: string; message: string } };
    expect(refusal.error.code).toBe("account_enabled_elsewhere");
    expect(refusal.error.message).not.toContain(SID);

    expect((await api.post(`${BASE(SID)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID2, "qq").state === "connected");
  });

  it("...and a save cannot carry an enabled connection onto another Session's bot either", async () => {
    // The enable gate's other half. A binding that is already ON keeps its connection
    // across a save and restarts it with the new credentials, so a PUT re-pointing it at
    // an App ID somebody else has enabled would stand two gateways on one bot's single
    // event stream without ever passing the gate above.
    const other = "102000002";
    t.deps.sessionsRepo.insert(sessionRowOf(SID2, projectId));
    await bindEnabled(SID, other);
    await bindEnabled(SID2, APP_ID);

    const collide = await api.put(BASE(SID2), { appId: other, appSecret: APP_SECRET });
    expect(collide.status).toBe(409);
    const refusal = (await collide.json()) as { error: { code: string; message: string } };
    expect(refusal.error.code).toBe("account_enabled_elsewhere");
    expect(refusal.error.message).not.toContain(SID);
    // Nothing was written and nothing was restarted.
    expect(t.deps.messagingRepo.find(SID2, "qq")?.accountId).toBe(APP_ID);

    // A DISABLED binding stays free to be saved onto that App ID: only the enable binds.
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: false })).status).toBe(200);
    expect((await api.put(BASE(SID2), { appId: other, appSecret: APP_SECRET })).status).toBe(200);
    expect(t.deps.messagingRepo.find(SID2, "qq")?.accountId).toBe(other);
  });

  it("clearing the stored secret is gated on the connection being off", async () => {
    await bindEnabled(SID);
    const blocked = await api.put(BASE(SID), { appId: APP_ID, clearAppSecret: true });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      "messaging_disable_before_clear",
    );
    await api.post(`${BASE(SID)}/state`, { enabled: false });
    expect((await api.put(BASE(SID), { appId: APP_ID, clearAppSecret: true })).status).toBe(200);
    const cleared = (await (await api.get(BASE(SID))).json()) as QQBindingResponse;
    // The row and its account identity survive; only the secret is gone.
    expect(cleared.binding?.appSecretMasked).toBeUndefined();
    expect(cleared.binding?.appId).toBe(APP_ID);
    // ...and a config with no secret cannot be enabled.
    const enable = await api.post(`${BASE(SID)}/state`, { enabled: true });
    expect(enable.status).toBe(400);
    expect(((await enable.json()) as { error: { code: string } }).error.code).toBe(
      "qq_secret_required",
    );
  });

  it("the credential probe is the token exchange, and names no account", async () => {
    await api.put(BASE(SID), { appId: APP_ID, appSecret: APP_SECRET });
    const ok = (await (await api.post(`${BASE(SID)}/test`, {})).json()) as QQTestResponse;
    expect(ok.ok).toBe(true);
    // The platform has no call that identifies the bot, so success carries no label.
    expect(Object.keys(ok)).not.toContain("accountLabel");

    fake.failAuth = "invalid appid or secret";
    const bad = (await (await api.post(`${BASE(SID)}/test`, {})).json()) as QQTestResponse;
    expect(bad.ok).toBe(false);
    expect(bad.error).toContain("invalid appid");
  });

  it("GET /messaging lists qq beside the other channels", async () => {
    await bindEnabled(SID);
    const body = (await (
      await api.get(`/api/sessions/${SID}/messaging`)
    ).json()) as MessagingBindingsResponse;
    const qq = body.bindings.find((b) => b.binding.channel === "qq");
    expect(qq?.binding.enabled).toBe(true);
    expect(qq?.status.state).toBe("connected");
    expect(qq?.binding.channel === "qq" && qq.binding.appId).toBe(APP_ID);
  });

  // —— Inbound ————————————————————————————————————————————————————————————

  it("an inbound single-chat message starts a Task as ordinary user input and is answered", async () => {
    await bindEnabled(SID);
    await fake.lastGateway().fire(c2cText("what is the status?", "msg_1"));
    await waitFor(() => runs.length === 1);
    // No marker block and no special sender: the model does not learn where this came from.
    expect(runs[0]!.map((p) => p.text)).toEqual(["what is the status?"]);
    await waitFor(() => fake.allSends().length === 1);
    const sent = fake.allSends()[0]!;
    expect(sent).toMatchObject({
      kind: "c2c",
      openid: USER_OPENID,
      content: "Reply text",
      msgId: "msg_1",
    });
    // The chat is remembered with its scene, so a later send knows which endpoint to use.
    expect(t.deps.messagingRepo.find(SID, "qq")?.lastChatId).toBe(qqChatIdOf("c2c", USER_OPENID));
  });

  it("a redelivered message is a complete no-op (the platform repeats a msg_id on purpose)", async () => {
    await bindEnabled(SID);
    await fake.lastGateway().fire(c2cText("hello", "msg_dup"));
    await waitFor(() => runs.length === 1);
    await fake.lastGateway().fire(c2cText("hello", "msg_dup"));
    await new Promise((r) => setTimeout(r, 30));
    expect(runs).toHaveLength(1);
  });

  it("a message with no text gets the text-only notice, as a reply to that same message", async () => {
    await bindEnabled(SID);
    await fake
      .lastGateway()
      .fire({ kind: "c2c", openid: USER_OPENID, messageId: "msg_img", content: "" });
    await waitFor(() => fake.allSends().length === 1);
    expect(fake.allSends()[0]).toMatchObject({
      content: MESSAGING_TEXT_ONLY_NOTICE,
      msgId: "msg_img",
      msgSeq: 1,
    });
    expect(runs).toHaveLength(0);
  });

  // —— The budget ——————————————————————————————————————————————————————————

  it("a run of six messages reaches QQ as four, the last carrying the remainder", async () => {
    const row = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["m1", "m2", "m3", "m4", "m5", "m6"]));
    await bindEnabled(SID2);
    await fake.lastGateway().fire(c2cText("go", "msg_budget"));

    await waitFor(() => fake.allSends().length === QQ_REPLY_BUDGET.c2c);
    // Nothing arrives after the reserved slot is spent, however long the test waits.
    await new Promise((r) => setTimeout(r, TAIL_MS * 3));
    const sends = fake.allSends();
    expect(sends).toHaveLength(4);
    expect(sends.map((s) => s.content)).toEqual(["m1", "m2", "m3", "m4\n\nm5\n\nm6"]);
    // One anchor message, and a sequence that increases without ever repeating: a repeated
    // (msg_id, msg_seq) pair is refused by the platform, not deduplicated away.
    expect(new Set(sends.map((s) => s.msgId))).toEqual(new Set(["msg_budget"]));
    expect(sends.map((s) => s.msgSeq)).toEqual([1, 2, 3, 4]);
  });

  it("a group chat gets the platform's larger budget", async () => {
    const row = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["g1", "g2", "g3", "g4", "g5", "g6"]));
    await bindEnabled(SID2);
    await fake.lastGateway().fire({
      kind: "group",
      openid: GROUP_OPENID,
      messageId: "msg_group",
      content: "go",
      senderOpenid: "member_1",
    });
    await waitFor(() => fake.allSends().length === QQ_REPLY_BUDGET.group);
    await new Promise((r) => setTimeout(r, TAIL_MS * 3));
    const sends = fake.allSends();
    expect(sends).toHaveLength(5);
    expect(sends.map((s) => s.content)).toEqual(["g1", "g2", "g3", "g4", "g5\n\ng6"]);
    expect(sends.every((s) => s.kind === "group" && s.openid === GROUP_OPENID)).toBe(true);
  });

  it("the approval notice takes the reserved slot rather than being lost behind it", async () => {
    // Three messages spend every immediate slot; the notice then has only the reserved one
    // left — and it must not wait for the run, which is parked until a human acts.
    const row = sessionRowOf(SID2, projectId);
    row.approvalMode = "always-ask";
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, parkingAfterMessagesSession(SID2, ["a1", "a2", "a3"]));
    await bindEnabled(SID2);
    await fake.lastGateway().fire(c2cText("do something risky", "msg_approval"));

    await waitFor(() => fake.allSends().length === QQ_REPLY_BUDGET.c2c);
    await new Promise((r) => setTimeout(r, TAIL_MS * 3));
    const sends = fake.allSends();
    // Four sends, and nothing lost inside them. Which slot the notice lands in is not
    // pinned on purpose: the bridge sends a notice outside the relay chain, so it may
    // overtake a relayed message or ride the reserved slot with it. What must hold is that
    // it arrives at all — the run is parked until a human acts on it, so a notice that
    // waited for the run to finish would wait forever.
    expect(sends).toHaveLength(4);
    expect(sends.map((s) => s.msgSeq)).toEqual([1, 2, 3, 4]);
    const everything = sends.map((s) => s.content).join("\n");
    for (const part of ["a1", "a2", "a3", MESSAGING_APPROVAL_NOTICE]) {
      expect(everything).toContain(part);
    }
    t.deps.manager.decideApproval(SID2, "tc-qq", "allow");
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
  });

  it("one-message-per-line is clamped to the budget, not to the channel-neutral 20", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
    const row = sessionRowOf(SID2, projectId);
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, [lines.join("\n")]));
    await api.put(BASE(SID2), { appId: APP_ID, appSecret: APP_SECRET, linePerMessage: true });
    expect((await api.post(`${BASE(SID2)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(SID2, "qq").state === "connected");
    await fake.lastGateway().fire(c2cText("go", "msg_lines"));

    await waitFor(() => fake.allSends().length === 4);
    await new Promise((r) => setTimeout(r, TAIL_MS * 3));
    const sends = fake.allSends();
    // Four messages, not ten and not twenty: the first three lines, then the rest combined
    // with their own line breaks intact.
    expect(sends.map((s) => s.content)).toEqual([
      "line 1",
      "line 2",
      "line 3",
      lines.slice(3).join("\n"),
    ]);
  });

  // —— Nothing to reply to ——————————————————————————————————————————————————

  it("a send with no repliable message fails loudly instead of pretending", async () => {
    await bindEnabled(SID);
    // A chat the bridge knows about but the platform gives nothing to reply to: the state a
    // conversation is in whenever it was driven from the web app, or simply left for a while.
    t.deps.messagingRepo.recordChat(SID, "qq", qqChatIdOf("c2c", USER_OPENID), true);
    const res = await api.post(`${BASE(SID)}/test-message`, {});
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("qq_send_failed");
    expect(body.error.message).toContain("only accepts replies");
    expect(fake.allSends()).toHaveLength(0);
  });

  it("before any inbound message the test-message endpoint refuses ahead of the send", async () => {
    await bindEnabled(SID);
    const res = await api.post(`${BASE(SID)}/test-message`, {});
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("qq_no_chat");
  });

  it("a test message rides the passive reply of a message just received", async () => {
    await bindEnabled(SID);
    await fake
      .lastGateway()
      .fire({ kind: "c2c", openid: USER_OPENID, messageId: "msg_test", content: "" });
    await waitFor(() => fake.allSends().length === 1);
    expect((await api.post(`${BASE(SID)}/test-message`, {})).status).toBe(200);
    await waitFor(() => fake.allSends().some((s) => s.content === MESSAGING_TEST_MESSAGE));
    expect(fake.allSends().at(-1)).toMatchObject({ msgId: "msg_test", msgSeq: 2 });
  });
});

/**
 * The seam's media half, as THIS branch sees it. `MessagingClient` grows `sendImage` /
 * `sendFile` in the media change, which is a sibling of this stack rather than something
 * below it, so the two methods are reached through their own structural type here instead
 * of through the seam. When the two land together, this local type is what disappears.
 */
interface MediaHalf {
  sendImage(chatId: string, file: { fileName: string; data: Buffer }): Promise<void>;
  sendFile(chatId: string, file: { fileName: string; data: Buffer }): Promise<void>;
}

describe("the QQ client's media half", () => {
  it("refuses an outbound file with a reason rather than silently succeeding", async () => {
    // Nothing about this needs a server: the seam's media methods are refusals, and the
    // reason has to reach whoever reads the error record the bridge writes.
    const connector = new QQConnector(new FakeQQTransport());
    const client = await connector.createClient({ appId: APP_ID, appSecret: APP_SECRET });
    const media = client as unknown as MediaHalf;
    const file = { fileName: "chart.png", data: Buffer.from("x") };
    await expect(media.sendImage(qqChatIdOf("c2c", USER_OPENID), file)).rejects.toThrow(
      /chart\.png/,
    );
    await expect(media.sendFile(qqChatIdOf("c2c", USER_OPENID), file)).rejects.toThrow(
      /publicly reachable URL/,
    );
  });

  it("refuses a text send before the bot has ever been messaged in that chat", async () => {
    const connector = new QQConnector(new FakeQQTransport());
    const client = await connector.createClient({ appId: APP_ID, appSecret: APP_SECRET });
    await expect(client.sendText(qqChatIdOf("c2c", USER_OPENID), "unprompted")).rejects.toThrow(
      /only accepts replies/,
    );
  });
});

/**
 * The ledger's LIFETIME, driven through the connector's two halves directly.
 *
 * The route tests above always see the same shape: one run, inside the window, on a live
 * connection. What is left is when the passive-reply accounting is reset, kept and
 * forgotten — a redelivered anchor, a connection that goes away with text still withheld, a
 * send that fails carrying the withheld text, and a chat nobody has spoken in for longer
 * than the platform will accept a reply. Each of those is a message that silently never
 * arrives, or one that arrives where it no longer should.
 */
describe("the passive-reply ledger's lifetime", () => {
  const CONFIG = { appId: APP_ID, appSecret: APP_SECRET };
  const CHAT = qqChatIdOf("c2c", USER_OPENID);
  const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * The ledger map is private and, for the eviction below, has no behavioural surface at
   * all: nothing past the window can be replied to whether it is held or not, so how many
   * are held is the only question there is to ask.
   */
  const ledgerCount = (c: QQConnector): number =>
    (c as unknown as { ledgers: Map<string, unknown> }).ledgers.size;

  /** A connector on a fake transport with its gateway open and its client built. */
  async function connected(opts: QQConnectorOpts = {}) {
    const fake = new FakeQQTransport();
    const connector = new QQConnector(fake, { tailFlushMs: TAIL_MS, ...opts });
    const client = await connector.createClient(CONFIG);
    const connection = await connector.connect(CONFIG, { onMessage: () => {} });
    return { fake, connector, client, connection, gateway: fake.lastGateway() };
  }

  /** Spends every immediate slot of a single chat's budget, leaving only the reserved one. */
  async function spendImmediate(client: Pick<MessagingClient, "sendText">) {
    for (const text of ["a", "b", "c"]) await client.sendText(CHAT, text);
  }

  it("a redelivered msg_id is not fresh budget", async () => {
    const { fake, client, gateway } = await connected();
    await gateway.fire(c2cText("go", "msg_1"));
    await client.sendText(CHAT, "first");
    await client.sendText(CHAT, "second");
    // The platform repeats a msg_id to guarantee delivery, and the bridge's redelivery
    // guard runs downstream of the connector — so a repeat lands here mid-run, between two
    // replies to the same message.
    await gateway.fire(c2cText("go", "msg_1"));
    await client.sendText(CHAT, "third");
    // A (msg_id, msg_seq) pair the platform has already accepted is REFUSED (40054005),
    // not deduplicated: a sequence that restarts here is the rest of the answer never
    // arriving, and the chat going quiet halfway through it.
    expect(fake.allSends().map((s) => s.msgSeq)).toEqual([1, 2, 3]);
    expect(new Set(fake.allSends().map((s) => s.msgId))).toEqual(new Set(["msg_1"]));
  });

  it("closing the connection drops a withheld tail instead of delivering it after the unbind", async () => {
    const { fake, client, connector, connection, gateway } = await connected();
    await gateway.fire(c2cText("go", "msg_close"));
    await spendImmediate(client);
    await client.sendText(CHAT, "withheld"); // no immediate slot left: waits for the reserved one
    connection.close();
    await settle(TAIL_MS * 3);
    // The binding is off. A message arriving now lands in a chat the Session no longer
    // answers, and there is no route by which the user could have expected it.
    expect(fake.allSends().map((s) => s.content)).toEqual(["a", "b", "c"]);

    // ...and the next connection starts the chat over rather than inheriting that tail.
    const again = await connector.connect(CONFIG, { onMessage: () => {} });
    await fake.lastGateway().fire(c2cText("hello again", "msg_reenabled"));
    await client.sendText(CHAT, "fresh");
    await settle(TAIL_MS * 3);
    expect(fake.allSends().map((s) => s.content)).toEqual(["a", "b", "c", "fresh"]);
    expect(fake.allSends().at(-1)).toMatchObject({ msgId: "msg_reenabled", msgSeq: 1 });
    again.close();
  });

  it("a flush that fails keeps its text for the next inbound message's budget", async () => {
    const { fake, client, gateway } = await connected();
    await gateway.fire(c2cText("go", "msg_fail"));
    await spendImmediate(client);
    await client.sendText(CHAT, "the end");
    // The one send carrying a long answer's coalesced end, lost to a transient 5xx.
    fake.failSend = "503 Service Unavailable";
    await settle(TAIL_MS * 3);
    expect(fake.allSends().map((s) => s.content)).toEqual(["a", "b", "c"]);

    fake.failSend = null;
    await gateway.fire(c2cText("still there?", "msg_next"));
    await waitFor(() => fake.allSends().length === 4);
    expect(fake.allSends().at(-1)).toMatchObject({
      content: "the end",
      msgId: "msg_next",
      msgSeq: 1,
    });
  });

  it("forgets a chat left quiet past the reply window", async () => {
    let clock = Date.now();
    const { fake, client, connector, gateway } = await connected({ now: () => clock });
    await gateway.fire(c2cText("go", "msg_old"));
    await client.sendText(CHAT, "answered");
    expect(ledgerCount(connector)).toBe(1);

    // Past the window this chat can never be replied to again, so its accounting is dead
    // weight — one entry per chat the bot is ever messaged in, each able to hold a tail.
    clock += QQ_PASSIVE_WINDOW_MS + 1;
    await gateway.fire({
      kind: "group",
      openid: GROUP_OPENID,
      messageId: "msg_new",
      content: "hi",
      senderOpenid: "member_1",
    });
    expect(ledgerCount(connector)).toBe(1);
    // The live chat still answers, and the expired one refuses rather than restarting a
    // sequence the platform still remembers.
    await client.sendText(qqChatIdOf("group", GROUP_OPENID), "answered too");
    expect(fake.allSends().at(-1)).toMatchObject({ msgId: "msg_new", msgSeq: 1 });
    await expect(client.sendText(CHAT, "too late")).rejects.toThrow(/only accepts replies/);
  });
});
