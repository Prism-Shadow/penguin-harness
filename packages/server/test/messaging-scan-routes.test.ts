/**
 * The scan-to-connect registrar, driven over HTTP with a toy flow on channels that have no scan
 * of their own (Telegram, Feishu). Every route here is the registrar's, so what a channel gets
 * from contributing a ScanFlow shows without QQ's or WeChat's protocol in the way. The toy flow
 * is the one fake, standing where a platform would; the Session, the owner check, storage and
 * the binding's masked view are the real ones, from the test app.
 *
 * - A flow gives its channel a start, a poll and a cancel, and a `verify` only when it takes a
 *   pairing code.
 * - A start answers the flow's task, URL and interval; a platform failure on a start or a poll
 *   is a 502 `<channel>_scan_failed` carrying the platform's reason.
 * - A poll of a task the flow does not have in flight is a 404 `<channel>_scan_task_unknown`;
 *   one still in progress answers the flow's status word and nothing else.
 * - A completed poll stores the credential as the channel's binding — saved, not enabled — and
 *   answers the account id under the channel's own key with the binding's masked view, never
 *   the secret.
 * - A pairing code reaches the flow trimmed; a blank one is a 400, and one for a task the flow
 *   does not know is a 404.
 * - A cancelled task cannot be polled.
 * - A scan is refused while the channel's connection is enabled.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { UserRow } from "@prismshadow/penguin-library-auth/repos/users";
import { sessionMessagingRoutes } from "@prismshadow/penguin-library-messaging/routes";
import type {
  ScanCredential,
  ScanFlow,
  ScanFlowPoll,
  ScanFlowStart,
} from "@prismshadow/penguin-library-messaging/scan-flow";
import type { MessagingScanFlow } from "@prismshadow/penguin-library-messaging/scan-routes";
import type { AppEnv } from "../src/auth/middleware.js";
import { handleError } from "../src/http/errors.js";
import { sessionRow } from "./fixtures/session.js";
import { createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-11-26-10-00-00-s9300001";
const SID2 = "session-2026-11-26-10-00-01-s9300002";
const PROJECT = "birder-default_project";
const BOT_ID = "7300001";
const BOT_TOKEN = `${BOT_ID}:toy-scanned-token-SECRET`;
const scanPath = (channel: string, sid = SID) => `/api/sessions/${sid}/messaging/${channel}/scan`;

/** A platform that issues tasks, reports a status per task, and hands out one credential. */
class ToyFlow implements ScanFlow {
  readonly status = new Map<string, string>();
  protected readonly owners = new Map<string, string>();
  /** Non-null makes the next start or poll fail with this reason, as a platform outage would. */
  failWith: string | null = null;
  credential: ScanCredential = { accountId: BOT_ID, config: { botToken: BOT_TOKEN } };
  private issued = 0;

  async start(sessionId: string): Promise<ScanFlowStart> {
    if (this.failWith !== null) throw new Error(this.failWith);
    this.issued += 1;
    const taskId = `toy-task-${this.issued}`;
    this.owners.set(taskId, sessionId);
    this.status.set(taskId, "pending");
    return { taskId, qrUrl: `https://scan.example.com/qr/${taskId}`, pollMs: 1500 };
  }

  async poll(sessionId: string, taskId: string): Promise<ScanFlowPoll | null> {
    if (this.failWith !== null) throw new Error(this.failWith);
    if (this.owners.get(taskId) !== sessionId) return null;
    const status = this.status.get(taskId) ?? "pending";
    if (status !== "completed") return { status };
    this.owners.delete(taskId);
    return { status, credential: this.credential };
  }

  cancel(sessionId: string, taskId: string): void {
    if (this.owners.get(taskId) === sessionId) this.owners.delete(taskId);
  }

  cancelSession(sessionId: string): void {
    for (const [taskId, owner] of this.owners) if (owner === sessionId) this.owners.delete(taskId);
  }
}

/** The same platform, interposing a pairing code the way WeChat's does. */
class ToyFlowWithCode extends ToyFlow {
  readonly codes: string[] = [];
  submitVerifyCode(sessionId: string, taskId: string, verifyCode: string): boolean {
    if (this.owners.get(taskId) !== sessionId) return false;
    this.codes.push(verifyCode);
    return true;
  }
}

describe("the scan routes a contributed flow gets", () => {
  let t: TestApp;
  let app: Hono<AppEnv>;
  let telegram: ToyFlowWithCode;
  let feishu: ToyFlow;

  const post = (path: string, body: unknown = {}) =>
    app.request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const errorCode = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  beforeEach(async () => {
    t = await createTestApp();
    const { user } = await provisionUser(t.app, "birder");
    t.deps.sessionsRepo.insert(sessionRow(SID, { projectId: PROJECT }));
    telegram = new ToyFlowWithCode();
    feishu = new ToyFlow();
    const scanFlows: MessagingScanFlow[] = [
      { channel: "telegram", accountIdField: "botId", flow: telegram },
      { channel: "feishu", accountIdField: "appId", flow: feishu },
    ];
    // The session router as the messaging module builds it, with the toy flows in place of the
    // contributed ones, run as the Project's owner.
    app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use("*", async (c, next) => {
      c.set("user", { userId: user.userId, isAdmin: false } as UserRow);
      await next();
    });
    app.route(
      "/api/sessions",
      sessionMessagingRoutes({
        messaging: t.deps.messaging,
        messagingRepo: t.deps.messagingRepo,
        access: t.deps.access,
        sessionsRepo: t.deps.sessionsRepo,
        scanFlows,
      }),
    );
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("gives a flow's channel a start, a poll and a cancel, and a verify only when it takes a code", async () => {
    expect((await post(scanPath("feishu"))).status).toBe(200);
    expect((await post(`${scanPath("feishu")}/poll`, { taskId: "toy-task-1" })).status).toBe(200);
    expect((await post(`${scanPath("feishu")}/cancel`, { taskId: "toy-task-1" })).status).toBe(204);
    const noCode = await post(`${scanPath("feishu")}/verify`, {
      taskId: "toy-task-1",
      verifyCode: "1234",
    });
    expect(noCode.status).toBe(404);
    // A channel that contributed nothing has no scan at all.
    expect((await post(scanPath("qq"))).status).toBe(404);

    const started = (await (await post(scanPath("telegram"))).json()) as ScanFlowStart;
    const verify = await post(`${scanPath("telegram")}/verify`, {
      taskId: started.taskId,
      verifyCode: "1234",
    });
    expect(verify.status).toBe(204);
  });

  it("answers a start with the flow's task, URL and interval", async () => {
    const res = await post(scanPath("telegram"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      taskId: "toy-task-1",
      qrUrl: "https://scan.example.com/qr/toy-task-1",
      pollMs: 1500,
    });
  });

  it("turns a platform failure into a 502 carrying the platform's reason", async () => {
    const { taskId } = (await (await post(scanPath("telegram"))).json()) as ScanFlowStart;
    telegram.failWith = "service temporarily unavailable";
    for (const res of [
      await post(scanPath("telegram")),
      await post(`${scanPath("telegram")}/poll`, { taskId }),
    ]) {
      expect(res.status).toBe(502);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("telegram_scan_failed");
      expect(body.error.message).toBe("service temporarily unavailable");
    }
  });

  it("answers a task in progress with its status word, and an unknown one with a 404", async () => {
    const { taskId } = (await (await post(scanPath("telegram"))).json()) as ScanFlowStart;
    telegram.status.set(taskId, "scanned");
    const progress = await post(`${scanPath("telegram")}/poll`, { taskId });
    expect(await progress.json()).toEqual({ status: "scanned" });

    // Another Session's task, through that Session's own path, is as unknown as a made-up one.
    t.deps.sessionsRepo.insert(sessionRow(SID2, { projectId: PROJECT }));
    for (const res of [
      await post(`${scanPath("telegram", SID2)}/poll`, { taskId }),
      await post(`${scanPath("telegram")}/poll`, { taskId: "made-up" }),
    ]) {
      expect(res.status).toBe(404);
      expect(await errorCode(res)).toBe("telegram_scan_task_unknown");
    }
  });

  it("stores a completed scan as the channel's binding and answers with its masked view", async () => {
    const { taskId } = (await (await post(scanPath("telegram"))).json()) as ScanFlowStart;
    telegram.status.set(taskId, "completed");
    const res = await post(`${scanPath("telegram")}/poll`, { taskId });
    expect(res.status).toBe(200);
    const text = await res.text();
    // The credential went to storage without passing back through the browser.
    expect(text).not.toContain(BOT_TOKEN);
    const body = JSON.parse(text) as {
      status: string;
      botId: string;
      binding: { channel: string; botId: string; botTokenMasked?: string; enabled: boolean };
    };
    expect(body.status).toBe("completed");
    expect(body.botId).toBe(BOT_ID);
    expect(body.binding.channel).toBe("telegram");
    expect(body.binding.botId).toBe(BOT_ID);
    expect(body.binding.botTokenMasked).toBeDefined();

    const stored = t.deps.messagingRepo.find(SID, "telegram")!;
    expect(stored.accountId).toBe(BOT_ID);
    expect(stored.config).toEqual({ botToken: BOT_TOKEN });
    // Saving is all a scan does: enabling stays the separate, exclusive act.
    expect(stored.enabled).toBe(false);
    // The task is spent: a replay is unknown, not a second bind.
    expect((await post(`${scanPath("telegram")}/poll`, { taskId })).status).toBe(404);
  });

  it("hands the flow a pairing code trimmed, and refuses a blank one or an unknown task", async () => {
    const { taskId } = (await (await post(scanPath("telegram"))).json()) as ScanFlowStart;
    expect(
      (await post(`${scanPath("telegram")}/verify`, { taskId, verifyCode: " 8421 " })).status,
    ).toBe(204);
    expect(telegram.codes).toEqual(["8421"]);

    const blank = await post(`${scanPath("telegram")}/verify`, { taskId, verifyCode: "   " });
    expect(blank.status).toBe(400);
    const unknown = await post(`${scanPath("telegram")}/verify`, {
      taskId: "made-up",
      verifyCode: "8421",
    });
    expect(unknown.status).toBe(404);
    expect(await errorCode(unknown)).toBe("telegram_scan_task_unknown");
    expect(telegram.codes).toEqual(["8421"]);
  });

  it("cannot poll a task once it was cancelled", async () => {
    const { taskId } = (await (await post(scanPath("telegram"))).json()) as ScanFlowStart;
    expect((await post(`${scanPath("telegram")}/cancel`, { taskId })).status).toBe(204);
    const res = await post(`${scanPath("telegram")}/poll`, { taskId });
    expect(res.status).toBe(404);
  });

  it("refuses to start a scan while the channel's connection is enabled", async () => {
    t.deps.messagingRepo.upsert({
      sessionId: SID,
      channel: "telegram",
      accountId: BOT_ID,
      config: { botToken: BOT_TOKEN },
    });
    t.deps.messagingRepo.setEnabled(SID, "telegram", true);
    const res = await post(scanPath("telegram"));
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("messaging_disable_before_scan");
    // The refusal is the server's, before the platform is asked anything.
    expect(telegram.status.size).toBe(0);
  });
});
