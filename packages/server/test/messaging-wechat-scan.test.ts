/**
 * WeChat scan-to-connect — the only way this channel is ever bound, so these tests cover
 * more than QQ's equivalent: there is no typed fallback behind them.
 *
 * Three layers, each fake at a different depth on purpose. The protocol layer drives the
 * real transport against a stubbed `globalThis.fetch`, because the request shape and the
 * status vocabulary are exactly what a seam fake would stop testing. The service layer uses
 * a fake transport, because what it owns is a state machine — claims, the pairing code, the
 * IDC redirect, the TTL — that no wire can express. The route layer uses the same fake, and
 * asserts the one invariant that spans all three: the platform's poll handle, which is what
 * collects a bot token, never appears in anything the browser is given.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WeChatScanPollResponse, WeChatScanStartResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { WECHAT_API_BASE } from "../src/runtime/messaging/wechat-api.js";
import type {
  WeChatScanPollResult,
  WeChatScanTransport,
} from "../src/runtime/messaging/wechat-scan.js";
import {
  WECHAT_SCAN_TASK_TTL_MS,
  WeChatScanService,
  createWeChatScanTransport,
} from "../src/runtime/messaging/wechat-scan.js";
import type {
  WeChatBotClient,
  WeChatCredentials,
  WeChatTransport,
} from "../src/runtime/messaging/wechat-api.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-28-10-00-00-w9000001";
const SID2 = "session-2026-08-28-10-00-01-w9000002";
const PROJECT = "birder-default_project";
const SCAN = (sid: string) => `/api/sessions/${sid}/messaging/wechat/scan`;

const BOT_ID = "bot_9001";
const BOT_TOKEN = "scan-issued-token-XYZ";
const SCANNER = "ilink_user_aaa";
/** The platform's poll handle. It turns into a bot token, so no response may carry it. */
const QRCODE = "qrcode-handle-SECRET";

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
// The protocol, against a stubbed fetch
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withFetch<T>(
  answer: (url: string, init: RequestInit | undefined) => Response,
  body: (urls: string[]) => Promise<T>,
): Promise<T> {
  const urls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    urls.push(String(input));
    return answer(String(input), init);
  }) as typeof fetch;
  try {
    return await body(urls);
  } finally {
    globalThis.fetch = original;
  }
}

describe("the WeChat scan protocol", () => {
  it("asks for a code under the bot type and offers no local tokens", async () => {
    let sentBody = "";
    await withFetch(
      (_url, init) => {
        sentBody = String(init?.body ?? "");
        return jsonResponse({ qrcode: QRCODE, qrcode_img_content: "https://weixin.qq.com/q/abc" });
      },
      async (urls) => {
        const res = await createWeChatScanTransport().createQrCode();
        expect(urls[0]).toBe(`${WECHAT_API_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`);
        // Offering the tokens this server already holds would hand one binding's credential
        // to another binding's flow.
        expect(JSON.parse(sentBody)).toEqual({ local_token_list: [] });
        // The handle and the URL are different things: the URL goes into the QR, the handle
        // collects the token.
        expect(res.qrcode).toBe(QRCODE);
        expect(res.qrUrl).toBe("https://weixin.qq.com/q/abc");
      },
    );
  });

  it("maps every status the platform reports onto one the browser can render", async () => {
    const cases: Array<[string, WeChatScanPollResult["status"]]> = [
      ["wait", "pending"],
      ["scaned", "scanned"],
      ["scaned_but_redirect", "scanned"],
      ["need_verifycode", "need_verify_code"],
      ["verify_code_blocked", "blocked"],
      ["expired", "expired"],
      ["binded_redirect", "already_bound"],
      // A state this build has not heard of is not a reason to take a live code down.
      ["something_new_from_tencent", "pending"],
    ];
    for (const [wire, expected] of cases) {
      await withFetch(
        () => jsonResponse({ status: wire }),
        async () => {
          const res = await createWeChatScanTransport().pollQrStatus({
            baseUrl: WECHAT_API_BASE,
            qrcode: QRCODE,
          });
          expect(res.status).toBe(expected);
        },
      );
    }
  });

  it("puts the pairing code on the status query, which is where the platform takes it", async () => {
    await withFetch(
      () => jsonResponse({ status: "scaned" }),
      async (urls) => {
        await createWeChatScanTransport().pollQrStatus({
          baseUrl: WECHAT_API_BASE,
          qrcode: QRCODE,
          verifyCode: "8421",
        });
        expect(urls[0]).toContain("verify_code=8421");
        expect(urls[0]).toContain(`qrcode=${encodeURIComponent(QRCODE)}`);
      },
    );
  });

  it("reads a confirmed scan's credentials, and the API host it assigned", async () => {
    await withFetch(
      () =>
        jsonResponse({
          status: "confirmed",
          bot_token: BOT_TOKEN,
          ilink_bot_id: BOT_ID,
          ilink_user_id: SCANNER,
          baseurl: "https://idc-7.ilinkai.weixin.qq.com",
        }),
      async () => {
        const res = await createWeChatScanTransport().pollQrStatus({
          baseUrl: WECHAT_API_BASE,
          qrcode: QRCODE,
        });
        expect(res.bot).toEqual({
          botId: BOT_ID,
          botToken: BOT_TOKEN,
          baseUrl: "https://idc-7.ilinkai.weixin.qq.com",
          userId: SCANNER,
        });
      },
    );
  });

  it("falls back to the entry host when a confirmed scan names none", async () => {
    await withFetch(
      () => jsonResponse({ status: "confirmed", bot_token: BOT_TOKEN, ilink_bot_id: BOT_ID }),
      async () => {
        const res = await createWeChatScanTransport().pollQrStatus({
          baseUrl: WECHAT_API_BASE,
          qrcode: QRCODE,
        });
        expect(res.bot?.baseUrl).toBe(WECHAT_API_BASE);
      },
    );
  });

  it("refuses a confirmation that carried no credentials rather than storing a blank one", async () => {
    await withFetch(
      () => jsonResponse({ status: "confirmed", ilink_bot_id: BOT_ID }),
      async () => {
        await expect(
          createWeChatScanTransport().pollQrStatus({ baseUrl: WECHAT_API_BASE, qrcode: QRCODE }),
        ).rejects.toThrow(/no credentials/);
      },
    );
  });

  it("reads a long poll that closed with nothing to say as pending, not as a failure", async () => {
    // A window that expires and a client-side timeout are the same thing here: nothing
    // changed, ask again. Only that keeps a transient close from taking the code down.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      const err = new Error("aborted");
      err.name = "TimeoutError";
      throw err;
    }) as typeof fetch;
    try {
      const res = await createWeChatScanTransport().pollQrStatus({
        baseUrl: WECHAT_API_BASE,
        qrcode: QRCODE,
      });
      expect(res).toEqual({ status: "pending" });
    } finally {
      globalThis.fetch = original;
    }
  });
});

// ---------------------------------------------------------------------------
// The service, over a fake transport
// ---------------------------------------------------------------------------

/** Records what the service asked for, and answers whatever the test set. */
class FakeScanTransport implements WeChatScanTransport {
  /** The handles handed out, newest last. */
  readonly handles: string[] = [];
  /** Every poll the service made, in order. */
  readonly polls: Array<{ baseUrl: string; qrcode: string; verifyCode?: string }> = [];
  /** What the next poll answers. */
  next: WeChatScanPollResult = { status: "pending" };
  /** Resolves each poll only when the test says so, for the overlapping-poll case. */
  gate: (() => void) | null = null;
  createFailure: Error | null = null;

  async createQrCode(): Promise<{ qrcode: string; qrUrl: string }> {
    if (this.createFailure !== null) throw this.createFailure;
    const qrcode = `${QRCODE}-${this.handles.length}`;
    this.handles.push(qrcode);
    return { qrcode, qrUrl: `https://weixin.qq.com/q/${this.handles.length}` };
  }

  async pollQrStatus(args: {
    baseUrl: string;
    qrcode: string;
    verifyCode?: string;
  }): Promise<WeChatScanPollResult> {
    this.polls.push({ ...args });
    if (this.gate !== null) {
      await new Promise<void>((resolve) => {
        this.gate = resolve;
      });
    }
    return this.next;
  }

  lastHandle(): string {
    const handle = this.handles.at(-1);
    if (handle === undefined) throw new Error("no fake wechat code was created");
    return handle;
  }
}

const completed: WeChatScanPollResult = {
  status: "completed",
  bot: { botId: BOT_ID, botToken: BOT_TOKEN, baseUrl: WECHAT_API_BASE, userId: SCANNER },
};

describe("the WeChat scan service", () => {
  it("hands out a handle of its own, never the one that collects the token", async () => {
    const transport = new FakeScanTransport();
    const service = new WeChatScanService(transport);
    const started = await service.start(SID);
    expect(started.taskId).not.toBe(transport.lastHandle());
    expect(started.qrUrl).toContain("https://weixin.qq.com/q/");
    expect(started.pollMs).toBeGreaterThan(0);
  });

  it("answers an overlapping poll `pending` instead of refusing it, the poll being long", async () => {
    // QQ's fast poll refuses an overlap because a second one could bind twice; here one
    // upstream call spans several of the client's intervals, and refusing would surface the
    // normal rhythm as an error.
    const transport = new FakeScanTransport();
    const service = new WeChatScanService(transport);
    const started = await service.start(SID);
    transport.gate = () => {};
    const inFlight = service.poll(SID, started.taskId);
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "pending" });
    // Exactly one upstream call was made for the two client polls.
    expect(transport.polls).toHaveLength(1);
    transport.gate!();
    await inFlight;
  });

  it("holds a pairing code for the next poll, then stops resending it once it is accepted", async () => {
    const transport = new FakeScanTransport();
    const service = new WeChatScanService(transport);
    const started = await service.start(SID);
    transport.next = { status: "need_verify_code" };
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "need_verify_code" });
    expect(transport.polls[0]!.verifyCode).toBeUndefined();

    expect(service.submitVerifyCode(SID, started.taskId, "8421")).toBe(true);
    transport.next = { status: "scanned" };
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "scanned" });
    expect(transport.polls[1]!.verifyCode).toBe("8421");
    // Accepted: resubmitting it would be rejected as a stale code on every later poll.
    await service.poll(SID, started.taskId);
    expect(transport.polls[2]!.verifyCode).toBeUndefined();
  });

  it("refuses a pairing code for a task this Session did not start", async () => {
    const service = new WeChatScanService(new FakeScanTransport());
    const started = await service.start(SID);
    expect(service.submitVerifyCode(SID2, started.taskId, "8421")).toBe(false);
    expect(service.submitVerifyCode(SID, "not-a-task", "8421")).toBe(false);
  });

  it("follows an IDC redirect without reporting it as a state of its own", async () => {
    const transport = new FakeScanTransport();
    const service = new WeChatScanService(transport);
    const started = await service.start(SID);
    transport.next = { status: "scanned", redirectHost: "idc-7.ilinkai.weixin.qq.com" };
    // What the browser hears is that the code was scanned; the host switch is internal.
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "scanned" });
    transport.next = { status: "pending" };
    await service.poll(SID, started.taskId);
    expect(transport.polls[0]!.baseUrl).toBe(WECHAT_API_BASE);
    expect(transport.polls[1]!.baseUrl).toBe("https://idc-7.ilinkai.weixin.qq.com");
  });

  it("spends the task on a completed scan, so a replay binds nothing", async () => {
    const transport = new FakeScanTransport();
    const service = new WeChatScanService(transport);
    const started = await service.start(SID);
    transport.next = completed;
    expect(await service.poll(SID, started.taskId)).toEqual({
      status: "completed",
      bot: completed.bot,
    });
    expect(await service.poll(SID, started.taskId)).toBeNull();
  });

  it("spends the task on every end the platform declares, not only on success", async () => {
    for (const status of ["expired", "blocked", "already_bound"] as const) {
      const transport = new FakeScanTransport();
      const service = new WeChatScanService(transport);
      const started = await service.start(SID);
      transport.next = { status };
      expect(await service.poll(SID, started.taskId)).toEqual({ status });
      // Nothing further can come of this handle: polling it again is not a way back.
      expect(await service.poll(SID, started.taskId)).toBeNull();
    }
  });

  it("keeps a task pollable when the request itself failed", async () => {
    const transport = new FakeScanTransport();
    const service = new WeChatScanService(transport);
    const started = await service.start(SID);
    transport.pollQrStatus = async () => {
      throw new Error("platform hiccup");
    };
    await expect(service.poll(SID, started.taskId)).rejects.toThrow("platform hiccup");
    // A failed request resolved nothing; the user's code is still on screen.
    transport.pollQrStatus = async () => ({ status: "pending" });
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "pending" });
  });

  it("keeps one Session's tasks out of another's reach", async () => {
    const service = new WeChatScanService(new FakeScanTransport());
    const started = await service.start(SID);
    expect(await service.poll(SID2, started.taskId)).toBeNull();
    service.cancel(SID2, started.taskId);
    expect(await service.poll(SID, started.taskId)).toEqual({ status: "pending" });
    service.cancel(SID, started.taskId);
    expect(await service.poll(SID, started.taskId)).toBeNull();
  });

  it("evicts only the caller's own oldest tasks when it fills its ceiling", async () => {
    const service = new WeChatScanService(new FakeScanTransport());
    const victim = await service.start(SID2);
    const own: string[] = [];
    for (let i = 0; i < 6; i += 1) own.push((await service.start(SID)).taskId);
    expect(await service.poll(SID, own[0]!)).toBeNull();
    expect(await service.poll(SID, own.at(-1)!)).toEqual({ status: "pending" });
    // Filling one Session's ceiling takes a code away from nobody else.
    expect(await service.poll(SID2, victim.taskId)).toEqual({ status: "pending" });
  });

  it("sweeps a task nobody came back for without waiting for the next scan", async () => {
    vi.useFakeTimers();
    try {
      let now = 1_000_000;
      const service = new WeChatScanService(new FakeScanTransport(), { now: () => now });
      const abandoned = await service.start(SID);
      now += WECHAT_SCAN_TASK_TTL_MS + 1;
      await vi.advanceTimersByTimeAsync(WECHAT_SCAN_TASK_TTL_MS + 1);
      // Gone, not merely lapsed: only a task the sweep already dropped reads as unknown.
      expect(await service.poll(SID, abandoned.taskId)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets a Session's tasks wholesale", async () => {
    const service = new WeChatScanService(new FakeScanTransport());
    const started = await service.start(SID);
    service.cancelSession(SID);
    expect(await service.poll(SID, started.taskId)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------

/**
 * A connector transport whose poll never returns: the scan-route suite enables a connection
 * once, and what it is testing is the enable's REFUSAL of a scan, not anything inbound.
 */
function silentTransport(): WeChatTransport {
  const client: WeChatBotClient = {
    checkCredentials: async () => {},
    getUpdates: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("closed")), { once: true });
      }),
    sendText: async () => {},
    sendImage: async () => {},
    sendFile: async () => {},
    fetchMedia: async () => Buffer.alloc(0),
  };
  return { createClient: (_creds: WeChatCredentials) => client };
}

describe("wechat scan routes", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let transport: FakeScanTransport;

  beforeEach(async () => {
    transport = new FakeScanTransport();
    // A fake connector transport too: one test enables the connection, and the poll loop
    // behind it would otherwise open a real request to the platform.
    t = await createTestApp({
      wechatScanTransport: transport,
      wechatTransport: silentTransport(),
      wechatRetryDelayMs: () => 0,
    });
    const { cookie } = await provisionUser(t.app, "birder");
    api = apiClient(t.app, cookie);
    t.deps.sessionsRepo.insert(sessionRowOf(SID, PROJECT));
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("hands the browser a task, a URL and an interval — never the handle behind them", async () => {
    const res = await api.post(SCAN(SID), {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as WeChatScanStartResponse;
    expect(body.qrUrl).toContain("https://weixin.qq.com/q/");
    expect(body.pollMs).toBeGreaterThan(0);
    // The handle polls a bot token out: nothing in this response may carry it.
    expect(JSON.stringify(body)).not.toContain(transport.lastHandle());
    expect(body.taskId).not.toBe(transport.lastHandle());
  });

  it("a completed poll saves the binding with the bot id as the account, and returns no token", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as WeChatScanStartResponse;
    const pending = (await (
      await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId })
    ).json()) as WeChatScanPollResponse;
    expect(pending).toEqual({ status: "pending" });

    transport.next = completed;
    const res = await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    expect(res.status).toBe(200);
    const done = (await res.json()) as WeChatScanPollResponse;
    expect(done.status).toBe("completed");
    expect(done.botId).toBe(BOT_ID);
    expect(done.binding?.channel).toBe("wechat");
    expect(done.binding?.botTokenMasked).toBe("scan…-XYZ");
    // The plaintext went to storage without passing back through the browser.
    expect(JSON.stringify(done)).not.toContain(BOT_TOKEN);

    const stored = t.deps.messagingRepo.find(SID, "wechat")!;
    expect(stored.accountId).toBe(BOT_ID);
    expect(stored.config).toEqual({
      botId: BOT_ID,
      botToken: BOT_TOKEN,
      baseUrl: WECHAT_API_BASE,
      // The scanner's id is stored too: the credential probe is made on its behalf.
      userId: SCANNER,
    });
    // Saving is all it does: enabling stays the separate, exclusive act.
    expect(stored.enabled).toBe(false);

    // The task is spent — a replay is a 404, not a second bind.
    const replay = await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    expect(replay.status).toBe(404);
    expect(((await replay.json()) as { error: { code: string } }).error.code).toBe(
      "wechat_scan_task_unknown",
    );
  });

  it("reports a pairing code, takes it, and 404s one for a task that is gone", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as WeChatScanStartResponse;
    transport.next = { status: "need_verify_code" };
    const asked = (await (
      await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId })
    ).json()) as WeChatScanPollResponse;
    expect(asked.status).toBe("need_verify_code");

    const ok = await api.post(`${SCAN(SID)}/verify`, { taskId: start.taskId, verifyCode: "8421" });
    expect(ok.status).toBe(204);
    transport.next = { status: "pending" };
    await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    expect(transport.polls.at(-1)!.verifyCode).toBe("8421");

    const gone = await api.post(`${SCAN(SID)}/verify`, { taskId: "nope", verifyCode: "1111" });
    expect(gone.status).toBe(404);
    const blank = await api.post(`${SCAN(SID)}/verify`, { taskId: start.taskId, verifyCode: "  " });
    expect(blank.status).toBe(400);
  });

  it("refuses to start a scan while the connection is live", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as WeChatScanStartResponse;
    transport.next = completed;
    await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId });
    expect(
      (await api.post(`/api/sessions/${SID}/messaging/wechat/state`, { enabled: true })).status,
    ).toBe(200);

    // A scan rewrites the whole credential and would point a live connector at whatever was
    // scanned: a server rule, not just a greyed-out button.
    const refused = await api.post(SCAN(SID), {});
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      "messaging_disable_before_scan",
    );
  });

  it("surfaces a platform failure as a 502 rather than an empty panel", async () => {
    transport.createFailure = new Error("WeChat scan request failed: HTTP 503");
    const res = await api.post(SCAN(SID), {});
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "wechat_scan_failed",
    );
  });

  it("cancels a scan the user walked away from", async () => {
    const start = (await (await api.post(SCAN(SID), {})).json()) as WeChatScanStartResponse;
    expect((await api.post(`${SCAN(SID)}/cancel`, { taskId: start.taskId })).status).toBe(204);
    expect((await api.post(`${SCAN(SID)}/poll`, { taskId: start.taskId })).status).toBe(404);
  });

  it("is owner-only throughout: the flow ends in a stored credential", async () => {
    const { cookie } = await provisionUser(t.app, "guest");
    const guest = apiClient(t.app, cookie);
    // A non-member cannot even see the Session, so the refusal is the 404 that leaks nothing.
    expect((await guest.post(SCAN(SID), {})).status).toBe(404);
    expect((await guest.post(`${SCAN(SID)}/poll`, { taskId: "x" })).status).toBe(404);
    expect((await guest.post(`${SCAN(SID)}/verify`, { taskId: "x", verifyCode: "1" })).status).toBe(
      404,
    );
    expect((await guest.post(`${SCAN(SID)}/cancel`, { taskId: "x" })).status).toBe(404);
  });
});
