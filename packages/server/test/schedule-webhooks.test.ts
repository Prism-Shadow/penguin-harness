/**
 * Schedule webhook triggers: the repo (triggers + deliveries as idempotency records),
 * the orchestration (HMAC verdicts, dedupe, gates, replay — the fire itself is a stub),
 * and the routes (owner-only management with the token redacted everywhere but creation,
 * and the public ingress 404/400/413/401/ignored paths). Accepted ingress through the
 * app would start a real Session run, so the firing paths are covered here with doubles.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { ScheduleWebhooksRepo, type WebhookTriggerRow } from "../src/db/repos/schedule-webhooks.js";
import {
  WebhookRateLimiter,
  dedupeKeyFor,
  handleWebhookDelivery,
  inferEvent,
  replayWebhookDelivery,
  selectedHeaders,
  verifySignature,
} from "../src/runtime/schedule-webhooks.js";
import { ScheduleFireError } from "../src/runtime/scheduler.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const P = "wh-proj";
const A = "default_agent";
const T0 = "2026-10-19T12:00:00.000Z";
const SECRET = "test-secret-123";
const BODY = '{"event":"push"}';
// HMAC-SHA256(SECRET, BODY), computed once with node:crypto — the implementation must
// reproduce it rather than agree with itself.
const BODY_SIG = "sha256=5a65b78e6f41a08fd3c09438bb735a77ec5b8935d914f7a751bd14d4f69d8aab";

function repo(): ScheduleWebhooksRepo {
  return new ScheduleWebhooksRepo(openDatabase(":memory:") as never);
}

function trigger(over: Partial<WebhookTriggerRow> = {}): WebhookTriggerRow {
  return {
    id: "wht_1",
    projectId: P,
    agentId: A,
    name: "nightly",
    token: "whk_testtoken",
    provider: "generic",
    secret: null,
    enabled: true,
    lastFiredAt: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

describe("schedule webhook repo", () => {
  it("creates a trigger and reads it back by name and by token", () => {
    const r = repo();
    r.createTrigger({
      id: "wht_1",
      projectId: P,
      agentId: A,
      name: "nightly",
      token: "whk_abc",
      provider: "github",
      secret: SECRET,
      nowIso: T0,
    });
    expect(r.getTrigger(P, A, "nightly")).toMatchObject({ token: "whk_abc", provider: "github" });
    expect(r.getTriggerByToken("whk_abc")).toMatchObject({ name: "nightly" });
    expect(r.getTrigger(P, A, "nope")).toBeNull();
    expect(r.getTriggerByToken("whk_nope")).toBeNull();
  });

  it("patches provider/secret/enabled, rotates the token, and deletes keeping deliveries", () => {
    const r = repo();
    r.createTrigger({
      id: "wht_1",
      projectId: P,
      agentId: A,
      name: "n",
      token: "whk_a",
      provider: "generic",
      secret: null,
      nowIso: T0,
    });
    r.insertDelivery({
      id: "whd_1",
      triggerId: "wht_1",
      dedupeKey: null,
      event: "",
      signatureStatus: "not_required",
      payload: "{}",
      headers: "{}",
      nowIso: T0,
    });
    r.updateTrigger("wht_1", { provider: "github", secret: SECRET, enabled: false }, T0);
    expect(r.getTrigger(P, A, "n")).toMatchObject({
      provider: "github",
      secret: SECRET,
      enabled: false,
    });
    r.rotateToken("wht_1", "whk_b", T0);
    expect(r.getTriggerByToken("whk_a")).toBeNull();
    expect(r.getTriggerByToken("whk_b")).toMatchObject({ id: "wht_1" });
    r.deleteTrigger("wht_1");
    expect(r.getTrigger(P, A, "n")).toBeNull();
    expect(r.getDelivery("whd_1")).not.toBeNull();
  });

  it("inserts once per dedupe key and answers the second insert from the first row", () => {
    const r = repo();
    const row = (id: string, key: string | null) => ({
      id,
      triggerId: "wht_1",
      dedupeKey: key,
      event: "",
      signatureStatus: "not_required" as const,
      payload: "{}",
      headers: "{}",
      nowIso: T0,
    });
    expect(r.insertDelivery(row("whd_1", "k1"))).toBe(true);
    expect(r.insertDelivery(row("whd_2", "k1"))).toBe(false);
    expect(r.getDeliveryByDedupe("wht_1", "k1")?.id).toBe("whd_1");
    // Keyless deliveries never collide with each other.
    expect(r.insertDelivery(row("whd_3", null))).toBe(true);
    expect(r.insertDelivery(row("whd_4", null))).toBe(true);
    // …nor across triggers.
    expect(r.insertDelivery({ ...row("whd_5", "k1"), triggerId: "wht_2" })).toBe(true);
  });

  it("bumps attempts, sets outcomes, lists newest first, and links firings", () => {
    const r = repo();
    r.insertDelivery({
      id: "whd_1",
      triggerId: "wht_1",
      dedupeKey: null,
      event: "push",
      signatureStatus: "verified",
      payload: "{}",
      headers: "{}",
      nowIso: T0,
    });
    r.bumpAttempt("whd_1");
    r.setDeliveryOutcome("whd_1", { status: "accepted", firingId: 7 });
    expect(r.getDelivery("whd_1")).toMatchObject({
      status: "accepted",
      firingId: 7,
      attemptCount: 2,
    });
    r.insertDelivery({
      id: "whd_2",
      triggerId: "wht_1",
      dedupeKey: null,
      event: "",
      signatureStatus: "not_required",
      payload: "{}",
      headers: "{}",
      nowIso: "2026-10-19T13:00:00.000Z",
    });
    expect(r.listDeliveries("wht_1", 10).map((d) => d.id)).toEqual(["whd_2", "whd_1"]);
    expect(r.listDeliveries("wht_1", 1).map((d) => d.id)).toEqual(["whd_2"]);
  });
});

describe("webhook signatures and keys", () => {
  it("reads the idempotency key per provider and drops blanks", () => {
    expect(dedupeKeyFor("generic", { "idempotency-key": "k-1" })).toBe("k-1");
    expect(dedupeKeyFor("github", { "x-github-delivery": "d-9" })).toBe("d-9");
    expect(dedupeKeyFor("generic", {})).toBeNull();
    expect(dedupeKeyFor("generic", { "idempotency-key": "  " })).toBeNull();
    // A github delivery id never stands in for a generic key.
    expect(dedupeKeyFor("generic", { "x-github-delivery": "d-9" })).toBeNull();
  });

  it("verifies the known HMAC vector on both providers' headers", () => {
    expect(
      verifySignature({
        provider: "generic",
        secret: SECRET,
        headers: { "x-webhook-signature": BODY_SIG },
        rawBody: BODY,
      }),
    ).toBe("verified");
    expect(
      verifySignature({
        provider: "github",
        secret: SECRET,
        headers: { "x-hub-signature-256": BODY_SIG },
        rawBody: BODY,
      }),
    ).toBe("verified");
  });

  it("fails closed: missing, malformed, wrong-secret, and cross-header signatures", () => {
    expect(
      verifySignature({ provider: "generic", secret: SECRET, headers: {}, rawBody: BODY }),
    ).toBe("missing");
    expect(
      verifySignature({
        provider: "generic",
        secret: SECRET,
        headers: { "x-webhook-signature": "nope" },
        rawBody: BODY,
      }),
    ).toBe("invalid");
    expect(
      verifySignature({
        provider: "generic",
        secret: "other-secret-456",
        headers: { "x-webhook-signature": BODY_SIG },
        rawBody: BODY,
      }),
    ).toBe("invalid");
    expect(
      verifySignature({
        provider: "generic",
        secret: SECRET,
        headers: { "x-webhook-signature": BODY_SIG },
        rawBody: '{"event":"pop"}',
      }),
    ).toBe("invalid");
    // Right signature, wrong header: a github signature does not authenticate generic.
    expect(
      verifySignature({
        provider: "generic",
        secret: SECRET,
        headers: { "x-hub-signature-256": BODY_SIG },
        rawBody: BODY,
      }),
    ).toBe("missing");
  });

  it("needs no signature without a secret, whatever the headers carry", () => {
    expect(verifySignature({ provider: "generic", secret: null, headers: {}, rawBody: BODY })).toBe(
      "not_required",
    );
    expect(
      verifySignature({
        provider: "github",
        secret: "",
        headers: { "x-hub-signature-256": "x" },
        rawBody: BODY,
      }),
    ).toBe("not_required");
  });

  it("infers the event per provider and keeps only webhook headers", () => {
    expect(inferEvent("github", { "x-github-event": "push" }, {})).toBe("push");
    expect(inferEvent("generic", {}, { event: "deploy" })).toBe("deploy");
    expect(inferEvent("generic", {}, { event: 7 })).toBe("");
    expect(
      selectedHeaders({
        "idempotency-key": "k",
        authorization: "Bearer x",
        "x-hub-signature-256": "s",
      }),
    ).toEqual({ "idempotency-key": "k", "x-hub-signature-256": "s" });
  });

  it("rate-limits per IP on a sliding window", () => {
    const limiter = new WebhookRateLimiter(2, 1000);
    expect(limiter.allow("1.2.3.4", 0)).toBe(true);
    expect(limiter.allow("1.2.3.4", 10)).toBe(true);
    expect(limiter.allow("1.2.3.4", 20)).toBe(false);
    expect(limiter.allow("9.9.9.9", 20)).toBe(true);
    expect(limiter.allow("1.2.3.4", 1001)).toBe(true);
  });
});

describe("webhook delivery orchestration", () => {
  function setup(secret: string | null = null, enabled = true) {
    const r = repo();
    r.createTrigger({
      id: "wht_1",
      projectId: P,
      agentId: A,
      name: "nightly",
      token: "whk_t",
      provider: "generic",
      secret,
      nowIso: T0,
    });
    const t = trigger({ secret, enabled });
    const fires: string[] = [];
    const fire = async (p: string, a: string, n: string) => {
      fires.push(`${p}/${a}/${n}`);
      return { sessionId: `sess-${fires.length}`, queued: false };
    };
    return { r, t, fire, fires };
  }

  it("accepts a keyless delivery and links the firing it caused", async () => {
    const { r, t, fire, fires } = setup();
    const out = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers: {},
      gate: { kind: "active" },
      fire,
      nowIso: T0,
    });
    expect(out).toMatchObject({ status: "accepted", runId: "sess-1", queued: false });
    expect(fires).toEqual(["wh-proj/default_agent/nightly"]);
    const id = (out as { deliveryId: string }).deliveryId;
    // The stub never wrote schedule_firings, so no link — but the row reads accepted.
    expect(r.getDelivery(id)).toMatchObject({
      status: "accepted",
      signatureStatus: "not_required",
    });
    expect(r.getTrigger(P, A, "nightly")?.lastFiredAt).toBe(T0);
  });

  it("answers a redelivery from the original row and fires only once", async () => {
    const { r, t, fire, fires } = setup();
    const headers = { "idempotency-key": "k-1" };
    const first = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers,
      gate: { kind: "active" },
      fire,
      nowIso: T0,
    });
    const second = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers,
      gate: { kind: "active" },
      fire,
      nowIso: T0,
    });
    expect(first.status).toBe("accepted");
    expect(second).toMatchObject({
      status: "duplicate",
      deliveryId: (first as { deliveryId: string }).deliveryId,
      attemptCount: 2,
    });
    expect(fires).toHaveLength(1);
  });

  it("rejects a bad signature without firing, and dedupes its retry too", async () => {
    const { r, t, fire, fires } = setup(SECRET);
    const headers = { "idempotency-key": "k-9", "x-webhook-signature": "sha256=00" };
    const first = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers,
      gate: { kind: "active" },
      fire,
      nowIso: T0,
    });
    expect(first).toMatchObject({ status: "rejected" });
    const id = (first as { deliveryId: string }).deliveryId;
    expect(r.getDelivery(id)?.signatureStatus).toBe("invalid");
    const second = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers,
      gate: { kind: "active" },
      fire,
      nowIso: T0,
    });
    expect(second).toMatchObject({ status: "duplicate", deliveryId: id });
    expect(fires).toHaveLength(0);
  });

  it("ignores disabled triggers and gated schedules without firing", async () => {
    const off = setup(null, false);
    const out = await handleWebhookDelivery({
      repo: off.r,
      trigger: off.t,
      rawBody: BODY,
      headers: {},
      gate: { kind: "active" },
      fire: off.fire,
      nowIso: T0,
    });
    expect(out).toMatchObject({ status: "ignored" });
    const { r, t, fire, fires } = setup();
    const gated = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers: {},
      gate: { kind: "ignored", reason: "schedule is auto-paused." },
      fire,
      nowIso: T0,
    });
    expect(gated).toMatchObject({ status: "ignored", reason: "schedule is auto-paused." });
    expect(fires).toHaveLength(0);
  });

  it("persists nothing for a gone schedule or an unparsable body", async () => {
    const { r, t, fire, fires } = setup();
    expect(
      await handleWebhookDelivery({
        repo: r,
        trigger: t,
        rawBody: BODY,
        headers: {},
        gate: { kind: "gone" },
        fire,
        nowIso: T0,
      }),
    ).toEqual({ status: "gone" });
    expect(
      await handleWebhookDelivery({
        repo: r,
        trigger: t,
        rawBody: "nope{",
        headers: {},
        gate: { kind: "active" },
        fire,
        nowIso: T0,
      }),
    ).toEqual({ status: "bad_json" });
    expect(
      await handleWebhookDelivery({
        repo: r,
        trigger: t,
        rawBody: "[1]",
        headers: {},
        gate: { kind: "active" },
        fire,
        nowIso: T0,
      }),
    ).toEqual({ status: "bad_json" });
    expect(r.listDeliveries("wht_1", 10)).toHaveLength(0);
    expect(fires).toHaveLength(0);
  });

  it("ignores a task that vanished mid-flight, and rethrows a failed fire as queued", async () => {
    const { r, t } = setup();
    const gone = () => Promise.reject(new ScheduleFireError("schedule_not_found", "gone"));
    const out = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers: {},
      gate: { kind: "active" },
      fire: gone,
      nowIso: T0,
    });
    expect(out).toMatchObject({ status: "ignored" });
    const failed = () =>
      Promise.reject(new ScheduleFireError("schedule_fire_failed", "no session"));
    await expect(
      handleWebhookDelivery({
        repo: r,
        trigger: t,
        rawBody: BODY,
        headers: {},
        gate: { kind: "active" },
        fire: failed,
        nowIso: T0,
      }),
    ).rejects.toThrow("no session");
    expect(
      r
        .listDeliveries("wht_1", 10)
        .map((d) => d.status)
        .sort(),
    ).toEqual(["ignored", "queued"]);
  });

  it("replays into a new delivery row with its own firing, pointing at the source", async () => {
    const { r, t, fire, fires } = setup();
    const first = await handleWebhookDelivery({
      repo: r,
      trigger: t,
      rawBody: BODY,
      headers: { "idempotency-key": "k-1" },
      gate: { kind: "active" },
      fire,
      nowIso: T0,
    });
    const sourceId = (first as { deliveryId: string }).deliveryId;
    const source = r.getDelivery(sourceId)!;
    const replayed = await replayWebhookDelivery({
      repo: r,
      trigger: t,
      delivery: source,
      fire,
      nowIso: T0,
    });
    expect(fires).toHaveLength(2);
    expect(replayed.deliveryId).not.toBe(sourceId);
    const row = r.getDelivery(replayed.deliveryId)!;
    expect(row).toMatchObject({ status: "accepted", dedupeKey: null });
    expect(JSON.parse(row.headers)).toEqual({ replayed_from: sourceId });
  });
});

describe("webhook routes", () => {
  const FUTURE = "2099-01-01T09:00:00Z";
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  // One boot for the four route cases: a full app per case kept tripping the 10s
  // hook budget under load, and schedules isolate cases by name anyway.
  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-wh", name: "webhook project" })
    ).json()) as { project: { projectId: string } };
    projectId = created.project.projectId;
    base = `/api/projects/${projectId}/agents/default_agent/schedules`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });

  afterAll(async () => {
    await t.cleanup();
  });

  const mkSchedule = async (name: string) => {
    const res = await owner.post(base, {
      name,
      prompt: "Do it",
      enabled: true,
      startAt: FUTURE,
      period: "30m",
    });
    expect(res.status).toBe(201);
  };

  const anonymous = (path: string, init?: RequestInit & { headers?: Record<string, string> }) =>
    t.app.request(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });

  it("manages a trigger owner-only and redacts the token everywhere but creation", async () => {
    await mkSchedule("wh-mgmt");
    expect((await member.post(`${base}/wh-mgmt/webhook`, {})).status).toBe(403);
    expect((await owner.get(`${base}/wh-mgmt/webhook`)).status).toBe(404);
    const createdRes = await owner.post(`${base}/wh-mgmt/webhook`, {
      provider: "github",
      secret: SECRET,
    });
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as {
      token: string;
      path: string;
      secretHint: string;
      hasSecret: boolean;
    };
    expect(created.token).toMatch(/^whk_[0-9a-f]{48}$/);
    expect(created.path).toBe(`/api/webhooks/schedules/${created.token}`);
    expect(created.secretHint).toBe("-123");
    expect((await owner.post(`${base}/wh-mgmt/webhook`, {})).status).toBe(409);

    const read = (await (await member.get(`${base}/wh-mgmt/webhook`)).json()) as Record<
      string,
      unknown
    >;
    expect(read).toMatchObject({
      provider: "github",
      enabled: true,
      path: "",
      hasSecret: true,
      secretHint: "-123",
    });
    expect("token" in read).toBe(false);
    expect("secret" in read).toBe(false);

    const rotated = (await (await owner.post(`${base}/wh-mgmt/webhook/rotate`, {})).json()) as {
      token: string;
    };
    expect(rotated.token).not.toBe(created.token);
    // The old URL dies with the rotation.
    expect(
      (await anonymous(`/api/webhooks/schedules/${created.token}`, { method: "POST", body: BODY }))
        .status,
    ).toBe(404);

    expect((await member.put(`${base}/wh-mgmt/webhook`, { enabled: false })).status).toBe(403);
    const updated = (await (
      await owner.put(`${base}/wh-mgmt/webhook`, { enabled: false, secret: null })
    ).json()) as Record<string, unknown>;
    expect(updated).toMatchObject({ enabled: false, hasSecret: false, secretHint: null });
    expect((await owner.put(`${base}/wh-mgmt/webhook`, { provider: "slack" })).status).toBe(400);

    expect((await member.delete(`${base}/wh-mgmt/webhook`)).status).toBe(403);
    expect((await owner.delete(`${base}/wh-mgmt/webhook`)).status).toBe(204);
    expect((await owner.get(`${base}/wh-mgmt/webhook`)).status).toBe(404);
  });

  it("ingresses anonymously: unknown tokens 404, bad JSON 400s, oversize 413s", async () => {
    await mkSchedule("wh-ingress");
    expect(
      (await anonymous("/api/webhooks/schedules/whk_nope", { method: "POST", body: BODY })).status,
    ).toBe(404);
    const created = (await (await owner.post(`${base}/wh-ingress/webhook`, {})).json()) as {
      token: string;
    };
    const url = `/api/webhooks/schedules/${created.token}`;
    expect((await anonymous(url, { method: "POST", body: "nope{" })).status).toBe(400);
    expect((await anonymous(url, { method: "POST", body: "[1]" })).status).toBe(400);
    const big = `{"pad":"${"x".repeat(300 * 1024)}"}`;
    expect((await anonymous(url, { method: "POST", body: big })).status).toBe(413);
  });

  it("rejects a bad signature and dedupes its retry; lists the audit trail", async () => {
    await mkSchedule("wh-sig");
    const created = (await (
      await owner.post(`${base}/wh-sig/webhook`, { secret: SECRET })
    ).json()) as { token: string };
    const url = `/api/webhooks/schedules/${created.token}`;
    const headers = { "Idempotency-Key": "k-1", "X-Webhook-Signature": "sha256=00" };
    const first = await anonymous(url, { method: "POST", headers, body: BODY });
    expect(first.status).toBe(401);
    expect(await first.json()).toMatchObject({ status: "rejected" });
    const second = await anonymous(url, { method: "POST", headers, body: BODY });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "duplicate" });
    const deliveries = (await (await member.get(`${base}/wh-sig/webhook/deliveries`)).json()) as {
      deliveries: Array<{ status: string; signatureStatus: string; attemptCount: number }>;
    };
    expect(deliveries.deliveries).toHaveLength(1);
    expect(deliveries.deliveries[0]).toMatchObject({
      status: "rejected",
      signatureStatus: "invalid",
      attemptCount: 2,
    });
    expect((await member.get(`${base}/wh-sig/webhook/deliveries?limit=no`)).status).toBe(400);
  });

  it("ignores a disabled trigger without firing, and 404s replay misses", async () => {
    await mkSchedule("wh-dis");
    const created = (await (await owner.post(`${base}/wh-dis/webhook`, {})).json()) as {
      token: string;
    };
    expect((await owner.put(`${base}/wh-dis/webhook`, { enabled: false })).status).toBe(200);
    const res = await anonymous(`/api/webhooks/schedules/${created.token}`, {
      method: "POST",
      body: BODY,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ignored" });
    // No trigger, no deliveries, no replay — each misses distinctly.
    expect((await owner.get(`${base}/wh-dis/webhook/deliveries`)).status).toBe(200);
    expect(
      (await member.post(`${base}/wh-dis/webhook/deliveries/whd_nope/replay`, {})).status,
    ).toBe(403);
    expect((await owner.post(`${base}/wh-dis/webhook/deliveries/whd_nope/replay`, {})).status).toBe(
      404,
    );
  });
});
