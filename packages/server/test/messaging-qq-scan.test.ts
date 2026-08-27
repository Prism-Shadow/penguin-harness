/**
 * QQ scan-to-connect tests: the three-call bind protocol, the AES-GCM framing that carries
 * the App Secret out of it, the in-memory task table, and the routes.
 *
 * The framing is what these tests exist for. `bot_encrypt_secret` is base64 with a 12-byte
 * IV in front and a 16-byte auth tag at the end, and nothing in the payload says so — a
 * wrong offset yields an authentication failure rather than a wrong-looking string, so the
 * round-trip here (encrypted by the test with the standard library, decrypted by the
 * module) is the only thing that can prove the layout is the one Tencent actually sends.
 *
 * The second thing pinned throughout: the AES key never leaves the server. Every route
 * assertion checks the whole response body for it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCipheriv, randomBytes } from "node:crypto";
import type {
  QQBindingResponse,
  QQScanPollResponse,
  QQScanStartResponse,
} from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import {
  QQScanService,
  createQQScanTransport,
  decryptQQBotSecret,
  newQQScanKey,
  qqScanQrUrl,
} from "../src/runtime/messaging/qq-scan.js";
import type { QQBindPollResult, QQScanTransport } from "../src/runtime/messaging/qq-scan.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-27-11-00-00-q9100001";
const SID2 = "session-2026-08-27-11-00-01-q9100002";
const SCAN = (sid: string) => `/api/sessions/${sid}/messaging/qq/scan`;
const APP_ID = "102000042";
const APP_SECRET = "scanned-app-secret-XYZ";

/**
 * Encrypts a secret the way the platform does: AES-256-GCM under the task's key, with the
 * IV prepended and the tag appended, base64. This is the mirror image of the module under
 * test, written against node's crypto rather than against it.
 */
function encryptLikeQQ(keyBase64: string, plaintext: string): string {
  const key = Buffer.from(keyBase64, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64");
}

/** Fake bind-task transport: hands out task ids and replays whatever the test queued. */
class FakeScanTransport implements QQScanTransport {
  /** The key each task was created under, so a test can encrypt exactly as the platform would. */
  readonly keys = new Map<string, string>();
  /** What the next poll of a task returns; a task with nothing queued reads as pending. */
  readonly results = new Map<string, QQBindPollResult>();
  createCalls = 0;
  pollCalls = 0;
  /** Non-null makes createBindTask throw with this message. */
  failCreate: string | null = null;
  private next = 1;

  async createBindTask(key: string): Promise<string> {
    this.createCalls++;
    if (this.failCreate !== null) throw new Error(this.failCreate);
    const taskId = `task-${this.next++}`;
    this.keys.set(taskId, key);
    return taskId;
  }

  async pollBindResult(taskId: string): Promise<QQBindPollResult> {
    this.pollCalls++;
    return this.results.get(taskId) ?? { status: "pending", bots: [] };
  }

  /** Arms a task to report a completed scan carrying a properly encrypted secret. */
  complete(taskId: string, appId = APP_ID, secret = APP_SECRET): void {
    const key = this.keys.get(taskId);
    if (key === undefined) throw new Error(`no fake task ${taskId}`);
    this.results.set(taskId, {
      status: "completed",
      bots: [{ appId, encryptedSecret: encryptLikeQQ(key, secret), userOpenid: "user_open_x" }],
    });
  }

  lastTaskId(): string {
    const id = [...this.keys.keys()].at(-1);
    if (id === undefined) throw new Error("no fake task was created");
    return id;
  }
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

describe("decryptQQBotSecret", () => {
  it("round-trips the platform's framing: IV in front, tag at the end", () => {
    const key = newQQScanKey();
    expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(decryptQQBotSecret(key, encryptLikeQQ(key, APP_SECRET))).toBe(APP_SECRET);
    // A secret with multi-byte characters must survive as utf8, not as latin1.
    const unicode = "密钥-secret-✓";
    expect(decryptQQBotSecret(key, encryptLikeQQ(key, unicode))).toBe(unicode);
  });

  it("fails loudly on a wrong key, a tampered payload, or a truncated one", () => {
    const key = newQQScanKey();
    const payload = encryptLikeQQ(key, APP_SECRET);
    // GCM authenticates, so a wrong key cannot yield plausible-looking garbage — which is
    // what makes storing the result safe without a second check.
    expect(() => decryptQQBotSecret(newQQScanKey(), payload)).toThrow(/could not be decrypted/);

    const bytes = Buffer.from(payload, "base64");
    bytes[20] = (bytes[20]! + 1) % 256;
    expect(() => decryptQQBotSecret(key, bytes.toString("base64"))).toThrow(
      /could not be decrypted/,
    );

    // Shorter than IV + tag: rejected before crypto is asked anything.
    expect(() => decryptQQBotSecret(key, Buffer.alloc(20).toString("base64"))).toThrow(/too short/);
    // A key that is not 32 bytes is a programming error, not a crypto failure.
    expect(() => decryptQQBotSecret(Buffer.alloc(16).toString("base64"), payload)).toThrow(
      /32-byte AES key/,
    );
  });
});

describe("qqScanQrUrl", () => {
  it("builds the page URL the QQ app opens, with both values encoded", () => {
    expect(qqScanQrUrl("task/1 2")).toBe(
      "https://q.qq.com/qqbot/openclaw/connect.html?task_id=task%2F1%202&source=&_wv=2",
    );
    expect(qqScanQrUrl("t", "a b")).toContain("source=a%20b");
  });
});

describe("createQQScanTransport", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads the {retcode, msg, data} envelope and turns a non-zero retcode into a throw", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) as unknown });
      if (url.endsWith("/lite/create_bind_task")) {
        return new Response(JSON.stringify({ retcode: 0, data: { task_id: "T1" } }));
      }
      return new Response(JSON.stringify({ retcode: 42, msg: "task not found" }));
    }) as unknown as typeof globalThis.fetch;

    const transport = createQQScanTransport();
    expect(await transport.createBindTask("KEY")).toBe("T1");
    expect(calls[0]!.url).toBe("https://q.qq.com/lite/create_bind_task");
    expect(calls[0]!.body).toEqual({ key: "KEY" });

    await expect(transport.pollBindResult("T1")).rejects.toThrow(/task not found \(retcode 42\)/);
    expect(calls[1]!.body).toEqual({ task_id: "T1" });
  });

  it("normalizes the completed payload, which arrives as a bare object", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          retcode: 0,
          data: { status: 2, bot_appid: 102000042, bot_encrypt_secret: "AAAA", user_openid: "u1" },
        }),
      )) as unknown as typeof globalThis.fetch;
    const res = await createQQScanTransport().pollBindResult("T1");
    expect(res.status).toBe("completed");
    // The App ID arrives as a NUMBER on the wire and is stored as text everywhere else.
    expect(res.bots).toEqual([{ appId: "102000042", encryptedSecret: "AAAA", userOpenid: "u1" }]);
  });

  it("maps the status enum, treating an unknown value as still pending", async () => {
    for (const [wire, expected] of [
      [0, "none"],
      [1, "pending"],
      [2, "completed"],
      [3, "expired"],
      [99, "pending"],
    ] as const) {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({ retcode: 0, data: { status: wire } }),
        )) as unknown as typeof globalThis.fetch;
      expect((await createQQScanTransport().pollBindResult("T")).status).toBe(expected);
    }
  });
});

describe("QQScanService", () => {
  it("keeps the key to itself and consumes the task on the poll that resolves it", async () => {
    const transport = new FakeScanTransport();
    const service = new QQScanService(transport);
    const started = await service.start(SID);
    expect(started.qrUrl).toContain(encodeURIComponent(started.taskId));
    // The key exists and is 32 bytes — and is not in anything the caller was handed.
    const key = transport.keys.get(started.taskId)!;
    expect(Buffer.from(key, "base64")).toHaveLength(32);
    expect(JSON.stringify(started)).not.toContain(key);

    expect(await service.poll(SID, started.taskId)).toEqual({ status: "pending" });
    transport.complete(started.taskId);
    expect(await service.poll(SID, started.taskId)).toEqual({
      status: "completed",
      bot: { appId: APP_ID, appSecret: APP_SECRET },
    });
    // Consumed: a replayed poll must not re-authorize anything.
    expect(await service.poll(SID, started.taskId)).toBeNull();
  });

  it("refuses a task another Session started, and an id it never issued", async () => {
    const service = new QQScanService(new FakeScanTransport());
    const started = await service.start(SID);
    expect(await service.poll(SID2, started.taskId)).toBeNull();
    expect(await service.poll(SID, "made-up")).toBeNull();
  });

  it("expires a task by its own clock as well as by the platform's answer", async () => {
    let now = 1_000_000;
    const transport = new FakeScanTransport();
    const service = new QQScanService(transport, { now: () => now });
    const stale = await service.start(SID);
    now += 11 * 60_000;
    expect(await service.poll(SID, stale.taskId)).toEqual({ status: "expired" });
    // Expired locally means gone, without a request to the platform.
    expect(transport.pollCalls).toBe(0);
    expect(await service.poll(SID, stale.taskId)).toBeNull();

    const live = await service.start(SID);
    transport.results.set(live.taskId, { status: "expired", bots: [] });
    expect(await service.poll(SID, live.taskId)).toEqual({ status: "expired" });
    expect(await service.poll(SID, live.taskId)).toBeNull();
  });

  it("cancelling forgets the key immediately rather than waiting for the sweep", async () => {
    const service = new QQScanService(new FakeScanTransport());
    const started = await service.start(SID);
    // Another Session's cancel is not this task's business.
    service.cancel(SID2, started.taskId);
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "pending" });
    service.cancel(SID, started.taskId);
    expect(await service.poll(SID, started.taskId)).toBeNull();

    const second = await service.start(SID);
    service.cancelSession(SID);
    expect(await service.poll(SID, second.taskId)).toBeNull();
  });
});

describe("qq scan routes", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let transport: FakeScanTransport;

  beforeEach(async () => {
    transport = new FakeScanTransport();
    t = await createTestApp({ qqScanTransport: transport });
    const { cookie } = await provisionUser(t.app, "birder");
    api = apiClient(t.app, cookie);
    t.deps.sessionsRepo.insert(sessionRowOf(SID, "birder-default_project"));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("starts a scan and hands the browser a task, a URL and a poll interval — never the key", async () => {
    const res = await api.post(SCAN(SID), {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as QQScanStartResponse;
    expect(body.taskId).toBe(transport.lastTaskId());
    expect(body.qrUrl).toContain("https://q.qq.com/qqbot/openclaw/connect.html?task_id=");
    expect(body.pollMs).toBeGreaterThan(0);
    // The AES key decrypts the App Secret: nothing in this response may carry it.
    expect(JSON.stringify(body)).not.toContain(transport.keys.get(body.taskId)!);
  });

  it("a completed poll saves the binding with the App ID as the account, and returns no secret", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as QQScanStartResponse;
    const pending = (await (
      await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId })
    ).json()) as QQScanPollResponse;
    expect(pending).toEqual({ status: "pending" });

    transport.complete(start.taskId);
    const res = await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    expect(res.status).toBe(200);
    const done = (await res.json()) as QQScanPollResponse;
    expect(done.status).toBe("completed");
    expect(done.appId).toBe(APP_ID);
    expect(done.binding?.appSecretMasked).toBe("scan…-XYZ");
    // The plaintext went to storage without passing back through the browser.
    expect(JSON.stringify(done)).not.toContain(APP_SECRET);
    const stored = t.deps.messagingRepo.find(SID, "qq")!;
    expect(stored.accountId).toBe(APP_ID);
    expect(stored.config.appSecret).toBe(APP_SECRET);
    // Saving is all it does: enabling stays the separate, exclusive act.
    expect(stored.enabled).toBe(false);

    // The task is spent — a replay is a 404, not a second bind.
    const replay = await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    expect(replay.status).toBe(404);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe(
      "qq_scan_task_unknown",
    );
  });

  it("a scanned binding is editable afterwards exactly like a typed one", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as QQScanStartResponse;
    transport.complete(start.taskId);
    await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    // The delivery flag rides a normal PUT with the secret left blank, which keeps it.
    const put = await api.put(`/api/sessions/${SID}/messaging/qq`, {
      appId: APP_ID,
      linePerMessage: true,
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as QQBindingResponse).binding?.linePerMessage).toBe(true);
    expect(t.deps.messagingRepo.find(SID, "qq")?.config.appSecret).toBe(APP_SECRET);
  });

  it("surfaces a platform failure as a 502 rather than as a broken flow", async () => {
    transport.failCreate = "service temporarily unavailable";
    const res = await api.post(SCAN(SID), {});
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("qq_scan_failed");
    expect(body.error.message).toContain("service temporarily unavailable");
  });

  it("cancelling drops the task, and every scan route is owner-only", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as QQScanStartResponse;
    expect((await api.post(`${SCAN(SID)}/cancel`, { taskId: start.taskId })).status).toBe(204);
    expect((await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId })).status).toBe(404);

    // A Project member who is not its owner may read bindings and run the probes, but the
    // scan ends in a stored credential, so it sits on the owner-only side like PUT does.
    const { cookie: member } = await provisionUser(t.app, "guest");
    const memberApi = apiClient(t.app, member);
    // A different user's Session is not even visible: 404 without leaking its existence.
    expect((await memberApi.post(SCAN(SID), {})).status).toBe(404);
  });
});
