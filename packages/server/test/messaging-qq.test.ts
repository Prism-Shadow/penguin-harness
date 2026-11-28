/**
 * QQ messaging — the third channel's mirror of messaging.test.ts over a fake transport, and
 * the proof the connector seam survives a platform that will not let a bot speak freely. No
 * test opens a socket.
 *
 * The ordinary half repeats what the other channels pin, because the route wiring is
 * per-channel even where the behaviour is not:
 * - A stored config narrows; a chat id round-trips its scene and openid; dispatches are read
 *   from the two subscribed events (the @bot prefix taken at the platform's word, everything
 *   else dropped).
 * - A PUT saves the pair only (secret masked, the App ID as the account, disabled); POST /state
 *   owns the gateway and a re-save while enabled restarts it; saving never collides, enabling
 *   does, and a save cannot carry an enabled connection onto another Session's bot; clearing
 *   the secret needs the connection off; the probe is the token exchange; GET /messaging lists
 *   qq beside the others.
 * - Inbound text starts an ordinary Task and is answered; a redelivered message is a no-op; a
 *   message with no text gets the notice as a reply to it. Formatting renders what QQ has,
 *   plain when renderMarkdown is off, falling back to plain at the cost of one slot when
 *   refused — but a refusal not about the body is not retried.
 *
 * The half that only exists here is the PASSIVE REPLY BUDGET: QQ accepts a small fixed number
 * of replies to one inbound message and has no push this product may use.
 * - A run of six messages reaches QQ as four, the last carrying the remainder, on one anchor
 *   with an increasing, never repeating msg_seq; a group gets its larger budget.
 * - The approval notice takes the reserved slot rather than being lost behind it;
 *   one-message-per-line is clamped to the budget.
 * - A reply's files, which QQ cannot take, are one expected error record and spend no slot.
 * - A send with nothing to reply to fails loudly; the test message needs a received message and
 *   rides its passive reply; the client refuses a file with a reason.
 * - The ledger: a redelivered msg_id is not fresh budget; closing the connection drops a
 *   withheld tail; a failed flush keeps its text for the next message's budget; a chat quiet
 *   past the reply window refuses rather than restarting its sequence.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalDecision, assistantText, toolCall } from "@prismshadow/penguin-core";
import type { ApproveFn, AmspRecord, TextPayload } from "@prismshadow/penguin-core";
import { wire } from "@prismshadow/penguin-core/kernel";
import type {
  MessagingBindingsResponse,
  QQBindingResponse,
  QQTestResponse,
} from "../src/api/types.js";
import { ProjectsRepo } from "@prismshadow/penguin-library-project/repos/projects";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import {
  MESSAGING_APPROVAL_NOTICE,
  MESSAGING_TEST_MESSAGE,
  MESSAGING_UNSUPPORTED_NOTICE,
} from "@prismshadow/penguin-library-messaging/bridge";
import type { MessagingClient } from "@prismshadow/penguin-library-messaging/connector";
import {
  MessagingMediaTooLargeError,
  MessagingUnsupportedError,
} from "@prismshadow/penguin-library-messaging/media";
import type {
  QQBotClient,
  QQCredentials,
  QQGatewayConnection,
  QQGatewayHandlers,
  QQInboundEvent,
  QQSendArgs,
  QQTransport,
  QQUploadFileArgs,
} from "@prismshadow/penguin-library-messaging/qq-api";
import {
  QQApiError,
  normalizeDispatch,
  qqSendErrorText,
} from "@prismshadow/penguin-library-messaging/qq-api";
import type { QQConnectorOpts } from "@prismshadow/penguin-library-messaging/qq-connector";
import {
  QQ_PASSIVE_WINDOW_MS,
  QQ_REPLY_BUDGET,
  QQConnector,
  parseQQChatId,
  qqChatIdOf,
  qqConfigOf,
} from "@prismshadow/penguin-library-messaging/qq-connector";
import { forwardingTo } from "./fixtures/forwarding.js";
import { fakeSession, sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

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
  readonly uploads: QQUploadFileArgs[] = [];
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
    // The platform refusing a `msg_type: 2` body while accepting the plain one behind it —
    // the shape the markdown-to-text fallback has to survive.
    if (args.markdown !== undefined && this.t.failMarkdownSend !== null) {
      throw this.t.failMarkdownSend;
    }
    if (this.t.failSend !== null) throw new Error(this.t.failSend);
    this.sends.push(args);
  }

  async uploadFile(args: QQUploadFileArgs): Promise<string> {
    const refusal = this.t.refuseUpload(args);
    if (refusal !== null) throw refusal;
    this.uploads.push(args);
    return `file_info_${this.uploads.length}`;
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
  /** Non-null makes only the `msg_type: 2` sends throw THIS, leaving the plain ones working. */
  failMarkdownSend: Error | null = null;
  /** Decides whether an upload is refused: a platform error to throw, or null to accept it. */
  refuseUpload: (args: QQUploadFileArgs) => Error | null = () => null;
  /** What each attachment URL serves, and every download asked for (URL is the test's own fake one). */
  readonly served = new Map<string, Buffer>();
  readonly downloads: Array<{ url: string; maxBytes: number; what: string }> = [];

  async fetchAttachment(url: string, maxBytes: number, what: string): Promise<Buffer> {
    this.downloads.push({ url, maxBytes, what });
    const bytes = this.served.get(url);
    if (bytes === undefined) throw new Error(`${what} could not be downloaded: HTTP 404`);
    if (bytes.length > maxBytes) throw new MessagingMediaTooLargeError(what, maxBytes);
    return bytes;
  }

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
  return fakeSession(sessionId, {
    async *run(input: AmspRecord[]) {
      runs.push(input.map((m) => m.payload as TextPayload));
      yield assistantText(reply);
    },
  });
}

/** Fake Session completing several assistant messages in ONE run — the budget's whole point. */
function multiMessageFakeSession(sessionId: string, texts: readonly string[]): RuntimeSession {
  return fakeSession(sessionId, {
    async *run() {
      for (const text of texts) yield assistantText(text);
    },
  });
}

/** Fake Session that completes `texts` and THEN parks on an approval (drives approval_request). */
function parkingAfterMessagesSession(sessionId: string, texts: readonly string[]): RuntimeSession {
  return fakeSession(sessionId, {
    async *run(_input: AmspRecord[], opts: { approve: ApproveFn; signal: AbortSignal }) {
      for (const text of texts) yield assistantText(text);
      const tc = toolCall({ name: "exec_command", arguments: "{}", toolCallId: "tc-qq" });
      yield tc;
      const decision = await opts.approve(tc);
      yield approvalDecision(decision, "tc-qq");
    },
  });
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

  it("reads attachments, giving a scheme-less URL https and dropping one it cannot fetch", () => {
    const evt = normalizeDispatch({
      op: 0,
      t: "C2C_MESSAGE_CREATE",
      d: {
        id: "m3",
        content: "",
        author: { user_openid: USER_OPENID },
        attachments: [
          { url: "//cdn.example/a.png", content_type: "image/png", filename: "a.png", size: 12 },
          { url: "https://cdn.example/v", content_type: "voice", asr_refer_text: " hi there " },
          { url: "ftp://cdn.example/x", content_type: "file" },
          { content_type: "file", filename: "no-url.txt" },
        ],
      },
    });
    expect(evt?.attachments).toEqual([
      { url: "https://cdn.example/a.png", contentType: "image/png", filename: "a.png", size: 12 },
      { url: "https://cdn.example/v", contentType: "voice", asrText: "hi there" },
    ]);
  });

  it("reads the quoted text of a quote message, and ignores msg_elements on any other type", () => {
    const d = {
      id: "m4",
      content: "thanks",
      author: { user_openid: USER_OPENID },
      msg_elements: [{ msg_idx: "REFIDX_a", message_type: 103, content: "read daily" }],
    };
    expect(
      normalizeDispatch({ op: 0, t: "C2C_MESSAGE_CREATE", d: { ...d, message_type: 103 } })?.quoted,
    ).toBe("read daily");
    expect(
      normalizeDispatch({ op: 0, t: "C2C_MESSAGE_CREATE", d: { ...d, message_type: 0 } })?.quoted,
    ).toBeUndefined();
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
  let runs: TextPayload[][];
  /**
   * The case's Project and its two Sessions, fresh per case: the app is the describe's, a
   * binding, a gateway and a status belong to their Session, and the error log dedupes and
   * reads per Project. The Project is birder's row alone — every Session here is a fake, so
   * nothing opens a default Agent's tree.
   */
  let projectId: string;
  let SID: string;
  let SID2: string;
  let cases = 0;

  /** Save the credentials, then flip the toggle on and wait for the gateway handshake. */
  const bindEnabled = async (sid: string, appId = APP_ID, put: Record<string, unknown> = {}) => {
    expect((await api.put(BASE(sid), { appId, appSecret: APP_SECRET, ...put })).status).toBe(200);
    expect((await api.post(`${BASE(sid)}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sid, "qq").state === "connected");
  };

  beforeAll(async () => {
    t = await createTestApp({ qqTransport: forwardingTo(() => fake), qqTailFlushMs: TAIL_MS });
    const { cookie } = await provisionUser(t.app, "birder");
    api = apiClient(t.app, cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    fake = new FakeQQTransport();
    runs = [];
    cases += 1;
    projectId = `birder-case-${cases}`;
    wire(ProjectsRepo, { db: t.deps.db }).insert({
      projectId,
      ownerUserId: "birder",
      createdAt: new Date().toISOString(),
    });
    SID = uniqueSessionId();
    SID2 = uniqueSessionId();
    const row = sessionRow(SID, { projectId });
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, echoFakeSession(SID, runs));
  });
  afterEach(() => {
    // What the case bound goes with it, gateway and all, and so does the error log it wrote.
    for (const row of t.deps.messagingRepo.listAll()) t.deps.messaging.unbindSession(row.sessionId);
    t.deps.db.prepare("DELETE FROM error_records").run();
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
    t.deps.sessionsRepo.insert(sessionRow(SID2, { projectId }));
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
    t.deps.sessionsRepo.insert(sessionRow(SID2, { projectId }));
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
      content: MESSAGING_UNSUPPORTED_NOTICE,
      msgId: "msg_img",
      msgSeq: 1,
    });
    expect(runs).toHaveLength(0);
  });

  // —— renderMarkdown: the per-binding formatting option ————————————————————————

  it("renders the constructs QQ has, and degrades the two it does not", async () => {
    const row = sessionRow(SID2, { projectId });
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(
      row,
      multiMessageFakeSession(SID2, [
        "## Result\n\nRan **2** tests, `all green`.\n\n```py\n# note\nx = a ** b\n```",
      ]),
    );
    await bindEnabled(SID2);
    await fake.lastGateway().fire(c2cText("go", "msg_md"));
    await waitFor(() => fake.allSends().length === 1);
    // The heading and the bold survive; inline code loses its backticks and the fenced block
    // becomes plain escaped lines, this channel having no code syntax at all. Nothing arrives
    // as a wall of literal backticks, and no character is lost — only backslashes added.
    expect(fake.allSends()[0]!.markdown).toBe(
      "## Result\n\nRan **2** tests, all green.\n\n\\# note\nx = a \\*\\* b",
    );
  });

  it("renderMarkdown off reproduces the plain msg_type 0 send, byte for byte", async () => {
    const raw = "## Result\n\nRan **2** tests.";
    const row = sessionRow(SID2, { projectId });
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, [raw]));
    await bindEnabled(SID2, APP_ID, { renderMarkdown: false });
    await fake.lastGateway().fire(c2cText("go", "msg_md_off"));
    await waitFor(() => fake.allSends().length === 1);
    const sent = fake.allSends()[0]!;
    // No markdown body at all, and the reply's own characters: what this channel sent
    // before the option existed.
    expect(sent.markdown).toBeUndefined();
    expect(sent.content).toBe(raw);
  });

  it("a markdown send the platform REFUSES falls back to plain text, at the cost of one slot", async () => {
    const raw = "**bold** and more";
    const row = sessionRow(SID2, { projectId });
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, [raw]));
    await bindEnabled(SID2);
    fake.failMarkdownSend = new QQApiError(
      "Message send failed: bad markdown (code 40054001)",
      40054001,
    );
    await fake.lastGateway().fire(c2cText("go", "msg_md_reject"));
    await waitFor(() => fake.allSends().length === 1);
    const sent = fake.allSends()[0]!;
    expect(sent.markdown).toBeUndefined();
    expect(sent.content).toBe(raw);
    // The retry needs a FRESH msg_seq — a repeated (msg_id, msg_seq) pair is refused rather
    // than deduplicated — so the fallback costs a second slot of the four this message funds.
    expect(sent.msgSeq).toBe(2);
  });

  it("a refusal that was not about the body is not retried, so the reserved slot is kept", async () => {
    const row = sessionRow(SID2, { projectId });
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["**bold**"]));
    await bindEnabled(SID2);
    // 40034128 is "the window closed, or the replies ran out". Plain text fails identically,
    // and the attempt would spend a slot to learn nothing.
    fake.failMarkdownSend = new QQApiError(
      "Message send failed: reply limit (code 40034128)",
      40034128,
    );
    await fake.lastGateway().fire(c2cText("go", "msg_md_nobody"));
    await waitFor(() =>
      t.deps.errorsRepo.recent(projectId).some((r) => r.code === "messaging_send_failed"),
    );
    expect(fake.allSends()).toEqual([]);
  });

  // —— The budget ——————————————————————————————————————————————————————————

  it("a run of six messages reaches QQ as four, the last carrying the remainder", async () => {
    const row = sessionRow(SID2, { projectId });
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
    const row = sessionRow(SID2, { projectId });
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
    const row = sessionRow(SID2, { projectId });
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
    const row = sessionRow(SID2, { projectId });
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

  // —— Inbound attachments ——————————————————————————————————————————————————

  /** What a run received, read as the loose union a composer submission is. */
  const receivedParts = (i = 0) =>
    runs[i]! as unknown as Array<{ type: string; text?: string; image_url?: string }>;

  it("an inbound picture becomes an image_url part, fetched under the shared inline-image cap", async () => {
    await bindEnabled(SID);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    fake.served.set("https://cdn.example/pic.png", png);
    await fake.lastGateway().fire({
      ...c2cText("", "msg_pic"),
      attachments: [
        { url: "https://cdn.example/pic.png", contentType: "image/png", filename: "pic.png" },
      ],
    });
    await waitFor(() => runs.length === 1);
    // No caption: the picture is the whole message, and no text is invented around it.
    expect(receivedParts()).toEqual([
      expect.objectContaining({
        type: "image_url",
        image_url: `data:image/png;base64,${png.toString("base64")}`,
      }),
    ]);
    expect(fake.downloads).toHaveLength(1);
    expect(fake.downloads[0]).toMatchObject({
      url: "https://cdn.example/pic.png",
      what: "The image",
    });
  });

  it("an inbound file lands in the scratchpad under the sender's own name and rides as a path line", async () => {
    await bindEnabled(SID);
    fake.served.set("https://cdn.example/f", Buffer.from("quarterly numbers"));
    await fake.lastGateway().fire({
      ...c2cText("summarize this", "msg_doc"),
      attachments: [{ url: "https://cdn.example/f", contentType: "file", filename: "q3.csv" }],
    });
    await waitFor(() => runs.length === 1);
    const text = receivedParts()[0]!.text!;
    expect(text.startsWith("summarize this\n\n[attached file: ")).toBe(true);
    const written = /\[attached file: (.+)\]/.exec(text)![1]!;
    expect(path.basename(written)).toBe("q3.csv");
    expect(await fs.readFile(written, "utf8")).toBe("quarterly numbers");
  });

  it("a voice message arrives as the platform's own transcript, and one without a transcript is refused", async () => {
    await bindEnabled(SID);
    await fake.lastGateway().fire({
      ...c2cText("", "msg_voice"),
      attachments: [
        {
          url: "https://cdn.example/v.silk",
          contentType: "voice",
          asrText: "what is on my calendar",
        },
      ],
    });
    await waitFor(() => runs.length === 1);
    expect(receivedParts().map((p) => p.text)).toEqual(["what is on my calendar"]);
    // The recording is never downloaded: nothing downstream could read it.
    expect(fake.downloads).toEqual([]);
    await fake.lastGateway().fire({
      ...c2cText("", "msg_mute"),
      attachments: [{ url: "https://cdn.example/w.silk", contentType: "voice" }],
    });
    await waitFor(() => fake.allSends().some((s) => s.content === MESSAGING_UNSUPPORTED_NOTICE));
    expect(runs).toHaveLength(1);
  });

  it("a quoted message's text rides above the reply as a blockquote", async () => {
    await bindEnabled(SID);
    await fake.lastGateway().fire({
      ...c2cText("make it shorter", "msg_quote"),
      quoted: "Read thirty minutes a day.\nIt compounds.",
    });
    await waitFor(() => runs.length === 1);
    expect(receivedParts()[0]!.text).toBe(
      "> Read thirty minutes a day.\n> It compounds.\n\nmake it shorter",
    );
  });

  // —— Outbound files ——————————————————————————————————————————————————————

  it("a file the reply mentions is uploaded and sent as a rich-media passive reply", async () => {
    const ws = await fs.mkdtemp(path.join(t.root, "ws-"));
    const row = sessionRow(SID2, { projectId });
    row.workspace = ws;
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["The notes are in xx.md."]));
    await bindEnabled(SID2, APP_ID, { renderMarkdown: false });
    // Written just before the run, so it counts as the run's own output.
    await fs.writeFile(path.join(ws, "xx.md"), "notes");
    await fake.lastGateway().fire(c2cText("write the notes", "msg_file"));
    await waitFor(() => fake.allSends().length === 2);
    // The reply in slot 1, the file in slot 2 — the upload itself spent nothing.
    expect(fake.allSends().map((s) => [s.content, s.fileInfo, s.msgId, s.msgSeq])).toEqual([
      ["The notes are in xx.md.", undefined, "msg_file", 1],
      ["", "file_info_1", "msg_file", 2],
    ]);
    const upload = fake.clients.flatMap((c) => c.uploads)[0]!;
    expect({ ...upload, data: upload.data.toString() }).toEqual({
      kind: "c2c",
      openid: USER_OPENID,
      // Not an image, not mp4 or silk: a downloadable file card.
      fileType: 4,
      fileName: "xx.md",
      data: "notes",
    });
    expect(t.deps.errorsRepo.recent(projectId)).toEqual([]);
  });

  it("a picture is registered as file_type 1, in a group as well as a single chat", async () => {
    const ws = await fs.mkdtemp(path.join(t.root, "ws-"));
    const row = sessionRow(SID2, { projectId });
    row.workspace = ws;
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["Chart saved as chart.png."]));
    await bindEnabled(SID2, APP_ID, { renderMarkdown: false });
    await fs.writeFile(path.join(ws, "chart.png"), "png-bytes");
    await fake.lastGateway().fire({
      kind: "group",
      openid: GROUP_OPENID,
      messageId: "grp_img",
      content: "draw it",
      senderOpenid: "member_1",
    });
    await waitFor(() => fake.allSends().length === 2);
    const upload = fake.clients.flatMap((c) => c.uploads)[0]!;
    expect([upload.kind, upload.openid, upload.fileType, upload.fileName]).toEqual([
      "group",
      GROUP_OPENID,
      1,
      "chart.png",
    ]);
    expect(fake.allSends()[1]).toMatchObject({ kind: "group", fileInfo: "file_info_1", msgSeq: 2 });
  });

  it("a picture format the platform will not show falls back to a file card instead of failing", async () => {
    const ws = await fs.mkdtemp(path.join(t.root, "ws-"));
    const row = sessionRow(SID2, { projectId });
    row.workspace = ws;
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["Saved anim.gif."]));
    fake.refuseUpload = (args) =>
      args.fileType === 1
        ? new QQApiError("Upload failed: 不支持的文件格式 (code 850019)", 850019)
        : null;
    await bindEnabled(SID2, APP_ID, { renderMarkdown: false });
    await fs.writeFile(path.join(ws, "anim.gif"), "gif-bytes");
    await fake.lastGateway().fire(c2cText("animate", "msg_gif"));
    await waitFor(() => fake.allSends().length === 2);
    expect(fake.clients.flatMap((c) => c.uploads).map((u) => u.fileType)).toEqual([4]);
    expect(fake.allSends()[1]).toMatchObject({ fileInfo: "file_info_1" });
    expect(t.deps.errorsRepo.recent(projectId)).toEqual([]);
  });

  it("a platform refusal leaves a note in the chat AND an error record, never a silent drop", async () => {
    const ws = await fs.mkdtemp(path.join(t.root, "ws-"));
    const row = sessionRow(SID2, { projectId });
    row.workspace = ws;
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, multiMessageFakeSession(SID2, ["Report is report.zip."]));
    fake.refuseUpload = () =>
      new QQApiError("Upload failed: 上传文件超过大小限制 (code 850031)", 850031);
    await bindEnabled(SID2, APP_ID, { renderMarkdown: false });
    await fs.writeFile(path.join(ws, "report.zip"), "zip");
    await fake.lastGateway().fire(c2cText("zip it", "msg_big"));
    await waitFor(() => fake.allSends().length === 2);
    // The note rides the tail's final slot, since nothing else is waiting for it.
    expect(fake.allSends()[1]!.content).toBe(
      "[File not sent 文件未发送: report.zip — Upload failed: 上传文件超过大小限制 (code 850031)]",
    );
    await waitFor(() =>
      t.deps.errorsRepo.recent(projectId).some((r) => r.code === "messaging_file_send_failed"),
    );
  });

  it("a file with no free reply slot is noted and filed as expected, and the text keeps its slot", async () => {
    const ws = await fs.mkdtemp(path.join(t.root, "ws-"));
    const row = sessionRow(SID2, { projectId });
    row.workspace = ws;
    t.deps.sessionsRepo.insert(row);
    // Five completed messages: three immediate, the rest withheld for the final slot — so the
    // tail is not empty when the file's turn comes, and the file must not take that slot.
    t.deps.manager.adopt(
      row,
      multiMessageFakeSession(SID2, ["one", "two", "three", "four", "five xx.md"]),
    );
    await bindEnabled(SID2, APP_ID, { renderMarkdown: false });
    await fs.writeFile(path.join(ws, "xx.md"), "notes");
    await fake.lastGateway().fire(c2cText("go", "msg_full"));
    await waitFor(() =>
      t.deps.errorsRepo.recent(projectId).some((r) => r.code === "messaging_file_send_failed"),
    );
    await waitFor(() => fake.allSends().length === 4);
    expect(fake.clients.flatMap((c) => c.uploads)).toEqual([]);
    expect(fake.allSends().every((s) => s.fileInfo === undefined)).toBe(true);
    // The last slot carries the withheld text and the note together.
    const last = fake.allSends()[3]!;
    expect(last.msgSeq).toBe(4);
    expect(last.content).toContain("five xx.md");
    expect(last.content).toContain("[File not sent 文件未发送: xx.md —");
    expect(t.deps.errorsRepo.recent(projectId).map(({ kind }) => kind)).toEqual(["expected"]);
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

describe("the QQ client's media half", () => {
  const file = { fileName: "chart.png", data: Buffer.from("x") };

  it("refuses a file before the bot has ever been messaged in that chat, without uploading", async () => {
    const transport = new FakeQQTransport();
    const connector = new QQConnector(transport);
    const client = await connector.createClient({ appId: APP_ID, appSecret: APP_SECRET });
    await expect(client.sendImage(qqChatIdOf("c2c", USER_OPENID), file)).rejects.toThrow(
      /only accepts replies/,
    );
    expect(transport.clients.flatMap((c) => c.uploads)).toEqual([]);
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

  // The tail's flush is a timer: the clock is the test's, so "nothing more arrives" is
  // proved by advancing past it rather than by waiting it out.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const pastTheTail = () => vi.advanceTimersByTimeAsync(TAIL_MS * 3);

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
    await pastTheTail();
    // The binding is off. A message arriving now lands in a chat the Session no longer
    // answers, and there is no route by which the user could have expected it.
    expect(fake.allSends().map((s) => s.content)).toEqual(["a", "b", "c"]);

    // ...and the next connection starts the chat over rather than inheriting that tail.
    const again = await connector.connect(CONFIG, { onMessage: () => {} });
    await fake.lastGateway().fire(c2cText("hello again", "msg_reenabled"));
    await client.sendText(CHAT, "fresh");
    await pastTheTail();
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
    await pastTheTail();
    expect(fake.allSends().map((s) => s.content)).toEqual(["a", "b", "c"]);

    fake.failSend = null;
    await gateway.fire(c2cText("still there?", "msg_next"));
    await pastTheTail();
    expect(fake.allSends()).toHaveLength(4);
    expect(fake.allSends().at(-1)).toMatchObject({
      content: "the end",
      msgId: "msg_next",
      msgSeq: 1,
    });
  });

  it("forgets a chat left quiet past the reply window: it refuses rather than restarting", async () => {
    let clock = Date.now();
    const { fake, client, gateway } = await connected({ now: () => clock });
    await gateway.fire(c2cText("go", "msg_old"));
    await client.sendText(CHAT, "answered");

    // Past the window this chat can never be replied to again.
    clock += QQ_PASSIVE_WINDOW_MS + 1;
    await gateway.fire({
      kind: "group",
      openid: GROUP_OPENID,
      messageId: "msg_new",
      content: "hi",
      senderOpenid: "member_1",
    });
    // The live chat still answers, and the expired one refuses rather than restarting a
    // sequence the platform still remembers.
    await client.sendText(qqChatIdOf("group", GROUP_OPENID), "answered too");
    expect(fake.allSends().at(-1)).toMatchObject({ msgId: "msg_new", msgSeq: 1 });
    await expect(client.sendText(CHAT, "too late")).rejects.toThrow(/only accepts replies/);
  });
});
