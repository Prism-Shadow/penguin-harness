/**
 * Unit tests for usage persistence and statistics: origin→model attribution,
 * summary buckets / group aggregation / trend queries, cost computed **on the
 * fly** (only Tokens are persisted; cost is priced against current pricing at
 * query time, no pricing → NULL + hasUncosted; a later price update is
 * reflected immediately), and the status → success-rate pipeline (aborted
 * doesn't count as a model failure).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, tokenUsage, withOrigin } from "@prismshadow/penguin-core";
import type { SessionMetaPayload, TokenCounts } from "@prismshadow/penguin-core";
import { ORIGIN_MODELS_MAX, UsageRecorder } from "../src/runtime/usage-recorder.js";
import { ErrorsRepo } from "../src/db/repos/errors.js";
import { UsageRepo } from "../src/db/repos/usage.js";
import { UsageService } from "../src/services/usage-service.js";
import type { PricingRates } from "../src/services/usage-service.js";
import { openDatabase } from "../src/db/database.js";
import { enumerateBuckets, enumerateTsBuckets, formatLocalDate } from "../src/internal/dates.js";
import type { DatabaseSync } from "node:sqlite";

const CTX = {
  projectId: "project-x",
  agentId: "agent-x",
  sessionId: "session-main",
  modelId: "main-model",
  provider: "custom",
};

function counts(total: number): TokenCounts {
  return { cache_read: 100, cache_write: 10, output: 5, total };
}

function meta(sessionId: string, modelId: string, provider = "custom"): SessionMetaPayload {
  return {
    session_id: sessionId,
    provider,
    model_id: modelId,
    model_context_window: 100000,
    system_prompt: "",
    agent_state: "/tmp/x",
    workspace: "/tmp/w",
  };
}

describe("usage-recorder", () => {
  let db: DatabaseSync;
  let repo: UsageRepo;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new UsageRepo(db);
  });
  afterEach(() => db.close());

  it("token_usage → one row (the request bucket; only Tokens persisted, never cost)", async () => {
    const rec = new UsageRecorder(repo);
    await rec.record(CTX, tokenUsage(counts(1000), counts(115)));
    const rows = db.prepare("SELECT * FROM usage_records").all();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.session_id).toBe("session-main");
    expect(row.origin_session_id).toBeNull();
    expect(row.model_id).toBe("main-model");
    expect(row.total).toBe(115); // taken from request.total
    expect(row.cache_read).toBe(100);
  });

  it("a sub-session's session_meta registers the origin→model mapping; token_usage is attributed via it", async () => {
    const rec = new UsageRecorder(repo);
    const childMeta = withOrigin(
      sessionMeta(meta("session-child", "child-model")),
      "session-child",
    );
    await rec.record(CTX, childMeta);
    await rec.record(CTX, withOrigin(tokenUsage(counts(50), counts(50)), "session-child"));
    const row = db.prepare("SELECT * FROM usage_records").get()!;
    expect(row.session_id).toBe("session-main"); // attributed to its owning main Session
    expect(row.origin_session_id).toBe("session-child");
    expect(row.model_id).toBe("child-model");
  });

  it("falls back to the main Session's Model when the origin mapping is missing", async () => {
    const rec = new UsageRecorder(repo);
    await rec.record(CTX, withOrigin(tokenUsage(counts(5), counts(5)), "session-unknown"));
    const row = db.prepare("SELECT model_id FROM usage_records").get()!;
    expect(row.model_id).toBe("main-model");
  });

  it("non-token_usage messages are a no-op", async () => {
    const rec = new UsageRecorder(repo);
    await rec.record(CTX, sessionMeta(meta("session-main", "main-model")));
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_records").get()!.n).toBe(0);
  });

  it("the origin mapping is capped: past the limit the earliest entry is evicted and falls back to the main Session's Model", async () => {
    const rec = new UsageRecorder(repo);
    for (let i = 0; i <= ORIGIN_MODELS_MAX; i++) {
      // ORIGIN_MODELS_MAX + 1 entries total: the earliest, sub-0, gets evicted.
      await rec.record(CTX, withOrigin(sessionMeta(meta(`sub-${i}`, "sub-model")), `sub-${i}`));
    }
    await rec.record(CTX, withOrigin(tokenUsage(counts(5), counts(5)), "sub-0"));
    await rec.record(CTX, withOrigin(tokenUsage(counts(5), counts(5)), `sub-${ORIGIN_MODELS_MAX}`));
    const rows = db.prepare("SELECT model_id FROM usage_records ORDER BY id").all();
    expect(rows[0]!.model_id).toBe("main-model"); // evicted → falls back
    expect(rows[1]!.model_id).toBe("sub-model"); // still mapped
  });
});

describe("usage-service (cost computed on the fly)", () => {
  let db: DatabaseSync;
  let repo: UsageRepo;
  let service: (now: Date) => UsageService;
  /** Mutable pricing table: simulates a "price added later" — change the price after inserting a record, and the query reflects it immediately. */
  let pricing: Record<string, PricingRates | undefined>;

  // The pricing lookup callback takes three params (projectId, provider, modelId): locates the price via the paired reference.
  const lookup = async (_p: string, _provider: string, modelId: string) => pricing[modelId];

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new UsageRepo(db);
    const errors = new ErrorsRepo(db);
    service = (now: Date) => new UsageService(repo, errors, lookup, () => now);
    pricing = { m1: { cacheRead: 0.3, cacheWrite: 3.75, output: 15 } };
  });
  afterEach(() => db.close());

  // Fixed Tokens per row: cacheRead=10, cacheWrite=1, output=5 → the per-row cost for m1
  const ROW_COST = (10 * 0.3 + 1 * 3.75 + 5 * 15) / 1e6;

  function insert(date: string, opts: Partial<Parameters<UsageRepo["insert"]>[0]> = {}): void {
    repo.insert({
      ts: `${date}T00:00:00.000Z`,
      date,
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
      originSessionId: null,
      modelId: "m1",
      provider: "custom",
      cacheRead: 10,
      cacheWrite: 1,
      output: 5,
      total: 100,
      ...opts,
    });
  }

  it("summary cards: today / last 7 days / cumulative; Models without pricing flag hasUncosted", async () => {
    const now = new Date("2026-07-06T10:00:00");
    const today = formatLocalDate(now);
    insert(today);
    insert("2026-07-03"); // within the last 7 days
    insert("2026-06-01", { modelId: "m-unpriced" }); // only in the cumulative total; this Model has no pricing
    const svc = service(now);
    const res = await svc.query("p1", { groupBy: "date" });
    expect(res.summary.today.total).toBe(100);
    expect(res.summary.today.requests).toBe(1);
    expect(res.summary.last7d.total).toBe(200);
    expect(res.summary.total.total).toBe(300);
    expect(res.summary.total.cost).toBeCloseTo(ROW_COST * 2, 12);
    expect(res.summary.total.hasUncosted).toBe(true);
    expect(res.summary.last7d.hasUncosted).toBe(false);
  });

  it("price added later: no pricing at insert time; once configured, queries price it immediately", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-06", { modelId: "m-late" });
    const svc = service(now);

    const before = await svc.query("p1", { groupBy: "date" });
    expect(before.summary.total.cost).toBeNull();
    expect(before.summary.total.hasUncosted).toBe(true);

    pricing["m-late"] = { cacheRead: 1, cacheWrite: 1, output: 1 };
    const after = await svc.query("p1", { groupBy: "date" });
    expect(after.summary.total.cost).toBeCloseTo((10 + 1 + 5) / 1e6, 12);
    expect(after.summary.total.hasUncosted).toBe(false);
  });

  it("group aggregation: date sorted descending; agent/model/session dimensions with agentId drill-down; folded across Models", async () => {
    const now = new Date("2026-07-06T10:00:00");
    pricing.m2 = { cacheRead: 1, cacheWrite: 1, output: 1 };
    insert("2026-07-05", { agentId: "a1", sessionId: "s1", modelId: "m1" });
    insert("2026-07-06", { agentId: "a2", sessionId: "s2", modelId: "m2", total: 300 });
    insert("2026-07-06", { agentId: "a2", sessionId: "s3", modelId: "m1" });
    const svc = service(now);

    const byDate = await svc.query("p1", { groupBy: "date" });
    expect(byDate.groups.map((g) => g.key)).toEqual(["2026-07-06", "2026-07-05"]);
    expect(byDate.groups[0]!.total).toBe(400);
    expect(byDate.groups[0]!.requests).toBe(2);
    // Same date, folded across Models: one m2 row + one m1 row.
    expect(byDate.groups[0]!.cost).toBeCloseTo((10 + 1 + 5) / 1e6 + ROW_COST, 12);

    const byAgent = await svc.query("p1", { groupBy: "agent" });
    expect(byAgent.groups[0]!.key).toBe("a2"); // sorted by Token count descending

    const bySession = await svc.query("p1", { groupBy: "session", agentId: "a2" });
    expect(bySession.groups.map((g) => g.key).sort()).toEqual(["s2", "s3"]);

    // Not visible from another Project.
    const other = await svc.query("p-other", { groupBy: "date" });
    expect(other.groups).toEqual([]);
  });

  it("from/to filter the groups; the trend is a fixed 30-day window", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-06");
    insert("2026-06-20");
    insert("2026-05-01"); // outside the 30-day window
    const svc = service(now);
    const res = await svc.query("p1", {
      groupBy: "date",
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(res.groups.map((g) => g.key)).toEqual(["2026-07-06"]);
    expect(res.trend.map((p) => p.date)).toEqual(["2026-06-20", "2026-07-06"]);
    expect(res.trend[1]!.cost).toBeCloseTo(ROW_COST, 12);
  });

  // —— status → success-rate pipeline ——

  it("success rate: completed / non-aborted requests, with the failure breakdown carried along", async () => {
    const now = new Date("2026-07-06T10:00:00");
    for (let i = 0; i < 7; i++) insert("2026-07-06");
    insert("2026-07-06", { status: "failed", total: 0 });
    insert("2026-07-06", { status: "timeout", total: 0 });
    insert("2026-07-06", { status: "malformed", total: 0 });
    const res = await service(now).query("p1", { groupBy: "date" });

    const m1 = res.success.find((s) => s.modelId === "m1")!;
    expect(m1).toMatchObject({
      completed: 7,
      total: 10,
      aborted: 0,
      failed: 1,
      timeout: 1,
      malformed: 1,
    });
  });

  it('regression: aborted (the user clicked "Stop") is not a model failure — excluded from the denominator, so interrupts never drag the success rate down', async () => {
    const now = new Date("2026-07-06T10:00:00");
    for (let i = 0; i < 8; i++) insert("2026-07-06");
    // The user clicked "Stop" twice: under the old accounting, the success rate would drop to 8/10 = 80%.
    insert("2026-07-06", { status: "aborted", total: 0 });
    insert("2026-07-06", { status: "aborted", total: 0 });
    const res = await service(now).query("p1", { groupBy: "date" });

    const m1 = res.success.find((s) => s.modelId === "m1")!;
    expect(m1.completed).toBe(8);
    expect(m1.total).toBe(8); // denominator excludes aborted
    expect(m1.aborted).toBe(2); // but the info isn't lost
    expect(m1.completed / m1.total).toBe(1); // 100%, no longer dragged down by aborts

    // A real failure still counts: add one more failed → 8/9.
    insert("2026-07-06", { status: "failed", total: 0 });
    const after = await service(now).query("p1", { groupBy: "date" });
    expect(after.success.find((s) => s.modelId === "m1")!.total).toBe(9);
  });

  it("the success rate ignores the model filter but still honors agent and date filters (the chart shows all Models)", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-06", { modelId: "m1", agentId: "a1" });
    insert("2026-07-06", { modelId: "m2", agentId: "a2", status: "failed", total: 0 });
    const svc = service(now);

    // Filtering by m1: the success-rate chart still lists m2 (for comparison), unaffected by the filter.
    const filtered = await svc.query("p1", { groupBy: "date", modelId: "m1" });
    expect(filtered.success.map((s) => s.modelId).sort()).toEqual(["m1", "m2"]);

    // Filtering by a1: m2's requests belong to a2 and are excluded.
    const byAgent = await svc.query("p1", { groupBy: "date", agentId: "a1" });
    expect(byAgent.success.map((s) => s.modelId)).toEqual(["m1"]);
  });
});

describe("usage-service series (zero-filled time-series buckets)", () => {
  let db: DatabaseSync;
  let repo: UsageRepo;
  let service: (now: Date) => UsageService;
  let pricing: Record<string, PricingRates | undefined>;
  const lookup = async (_p: string, _provider: string, modelId: string) => pricing[modelId];

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new UsageRepo(db);
    const errors = new ErrorsRepo(db);
    service = (now: Date) => new UsageService(repo, errors, lookup, () => now);
    pricing = { m1: { cacheRead: 0.3, cacheWrite: 3.75, output: 15 } };
  });
  afterEach(() => db.close());

  const ROW_COST = (10 * 0.3 + 1 * 3.75 + 5 * 15) / 1e6;

  function insert(date: string, opts: Partial<Parameters<UsageRepo["insert"]>[0]> = {}): void {
    repo.insert({
      ts: `${date}T00:00:00.000Z`,
      date,
      projectId: "p1",
      agentId: "a1",
      sessionId: "s1",
      originSessionId: null,
      modelId: "m1",
      provider: "custom",
      cacheRead: 10,
      cacheWrite: 1,
      output: 5,
      total: 100,
      ...opts,
    });
  }

  it("daily series: every bucket in the range appears exactly once, gaps as zeros; sums, cost, and success counts ride per bucket", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-02");
    insert("2026-07-02", { status: "failed", total: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
    insert("2026-07-02", { status: "aborted", total: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
    insert("2026-07-04");
    const res = await service(now).query("p1", {
      groupBy: "date",
      from: "2026-07-01",
      to: "2026-07-05",
    });
    expect(res.granularity).toBe("day");
    expect(res.series.map((p) => p.bucket)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ]);
    const d2 = res.series[1]!;
    expect(d2).toMatchObject({ total: 100, requests: 3, completed: 1, denominator: 2 });
    expect(d2.cost).toBeCloseTo(ROW_COST, 12);
    // Zero-filled gap: nothing happened, but the bucket exists (a line must not bridge it silently).
    expect(res.series[2]).toMatchObject({
      total: 0,
      requests: 0,
      completed: 0,
      denominator: 0,
      cost: null,
    });
  });

  it("weekly buckets key on the ISO week's Monday and aggregate everything in the week; monthly on yyyy-mm", async () => {
    const now = new Date("2026-07-20T10:00:00");
    insert("2026-07-07"); // Tuesday → week of Monday 2026-07-06
    insert("2026-07-12"); // Sunday  → same week
    insert("2026-07-13"); // Monday  → next week
    const weekly = await service(now).query("p1", {
      groupBy: "date",
      from: "2026-07-06",
      to: "2026-07-19",
      granularity: "week",
    });
    expect(weekly.granularity).toBe("week");
    expect(weekly.series.map((p) => p.bucket)).toEqual(["2026-07-06", "2026-07-13"]);
    expect(weekly.series[0]!.requests).toBe(2);
    expect(weekly.series[1]!.requests).toBe(1);

    const monthly = await service(now).query("p1", {
      groupBy: "date",
      from: "2026-06-15",
      to: "2026-07-19",
      granularity: "month",
    });
    expect(monthly.series.map((p) => p.bucket)).toEqual(["2026-06", "2026-07"]);
    expect(monthly.series[1]!.requests).toBe(3);
  });

  it("hourly buckets follow the server's local clock (the same timezone the date column records)", async () => {
    // Build ts from a local wall-clock time so the expectation holds in any test timezone.
    const at = (h: number, m: number) => new Date(2026, 6, 6, h, m);
    const dateStr = formatLocalDate(at(9, 0));
    insert(dateStr, { ts: at(9, 15).toISOString() });
    insert(dateStr, { ts: at(9, 45).toISOString() });
    insert(dateStr, { ts: at(11, 5).toISOString() });
    const res = await service(at(12, 0)).query("p1", {
      groupBy: "date",
      from: dateStr,
      to: dateStr,
      granularity: "hour",
    });
    expect(res.series).toHaveLength(24);
    const byBucket = new Map(res.series.map((p) => [p.bucket, p.requests]));
    expect(byBucket.get(`${dateStr}T09:00`)).toBe(2);
    expect(byBucket.get(`${dateStr}T10:00`)).toBe(0);
    expect(byBucket.get(`${dateStr}T11:00`)).toBe(1);
  });

  it("byAgentSeries aligns index-for-index with series, sorts by total descending, and ignores the agent filter (all agents stay visible)", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-01", { agentId: "small" });
    insert("2026-07-02", { agentId: "big" });
    insert("2026-07-02", { agentId: "big", status: "failed", total: 0 });
    const res = await service(now).query("p1", {
      groupBy: "date",
      from: "2026-07-01",
      to: "2026-07-03",
      agentId: "small",
    });
    expect(res.byAgentSeries.map((s) => s.agentId)).toEqual(["big", "small"]);
    expect(res.byAgentSeries[0]!.requests).toEqual([0, 2, 0]);
    // Per-bucket success counts ride along, per entity (the failed request counts toward the denominator only).
    expect(res.byAgentSeries[0]!.completed).toEqual([0, 1, 0]);
    expect(res.byAgentSeries[0]!.denominator).toEqual([0, 2, 0]);
    expect(res.byAgentSeries[1]!.requests).toEqual([1, 0, 0]);
    // The main series does honor the agent filter, like every other aggregate.
    expect(res.series.map((p) => p.requests)).toEqual([1, 0, 0]);
  });

  it("byModelSeries mirrors byAgentSeries for the model dimension: aligned, sorted, model-filter-free but agent-filtered", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-01", { modelId: "m1", agentId: "a1" });
    insert("2026-07-02", { modelId: "m2", agentId: "a1" });
    insert("2026-07-02", { modelId: "m2", agentId: "a1", status: "aborted", total: 0 });
    insert("2026-07-02", { modelId: "m2", agentId: "other" });
    const res = await service(now).query("p1", {
      groupBy: "date",
      from: "2026-07-01",
      to: "2026-07-03",
      agentId: "a1",
      modelId: "m1",
      provider: "custom",
    });
    // The model filter does not narrow the list; the agent filter does.
    expect(res.byModelSeries.map((s) => s.modelId)).toEqual(["m2", "m1"]);
    const m2 = res.byModelSeries[0]!;
    expect(m2.provider).toBe("custom");
    expect(m2.requests).toEqual([0, 2, 0]);
    expect(m2.completed).toEqual([0, 1, 0]);
    // Aborted is excluded from the denominator, same as everywhere else.
    expect(m2.denominator).toEqual([0, 1, 0]);
  });

  it("minute buckets: a trailing timestamp window zero-fills by minute and bounds every range-scoped aggregate", async () => {
    // Build everything from local wall-clock times so expectations hold in any test timezone.
    const at = (h: number, m: number, s = 0) => new Date(2026, 6, 6, h, m, s);
    const dateStr = formatLocalDate(at(10, 0));
    insert(dateStr, { ts: at(9, 58, 30).toISOString() }); // inside the window
    insert(dateStr, { ts: at(10, 20, 0).toISOString() }); // inside
    insert(dateStr, { ts: at(8, 30, 0).toISOString() }); // before the window: excluded
    const res = await service(at(10, 30)).query("p1", {
      groupBy: "date",
      from: dateStr,
      to: dateStr,
      granularity: "minute",
      fromTs: at(9, 30).toISOString(),
      toTs: at(10, 30).toISOString(),
    });
    expect(res.granularity).toBe("minute");
    expect(res.series).toHaveLength(61);
    expect(res.series[0]!.bucket).toBe(`${dateStr}T09:30`);
    expect(res.series.at(-1)!.bucket).toBe(`${dateStr}T10:30`);
    const byBucket = new Map(res.series.map((p) => [p.bucket, p.requests]));
    expect(byBucket.get(`${dateStr}T09:58`)).toBe(1);
    expect(byBucket.get(`${dateStr}T10:20`)).toBe(1);
    // The pre-window row is outside the ts bounds everywhere the range applies.
    expect(res.summary.total.requests).toBe(2);
    expect(res.series.reduce((s, p) => s + p.requests, 0)).toBe(2);
  });

  it("minute granularity without a timestamp window is rejected", async () => {
    const now = new Date("2026-07-06T10:00:00");
    await expect(
      service(now).query("p1", { groupBy: "date", granularity: "minute" }),
    ).rejects.toThrow(/fromTs/);
  });

  it("defaults: no from/to serves the last 30 days; no granularity means day", async () => {
    const now = new Date("2026-07-06T10:00:00");
    insert("2026-07-06");
    const res = await service(now).query("p1", { groupBy: "date" });
    expect(res.granularity).toBe("day");
    expect(res.series).toHaveLength(30);
    expect(res.series[0]!.bucket).toBe("2026-06-07");
    expect(res.series.at(-1)!).toMatchObject({ bucket: "2026-07-06", requests: 1 });
  });

  it("rejects a range × precision that would materialize an oversized series", async () => {
    const now = new Date("2026-07-06T10:00:00");
    await expect(
      service(now).query("p1", {
        groupBy: "date",
        from: "2025-07-01",
        to: "2026-07-01",
        granularity: "hour",
      }),
    ).rejects.toThrow(/granularity/);
  });
});

describe("bucket enumeration across a DST transition", () => {
  // The zero-fill skeleton and SQLite's `strftime(..., 'localtime')` must agree key for key.
  // A fall-back replays a whole local hour, so two instants an hour apart share one key;
  // the enumeration has to emit that key once, or one of the two points it feeds stays empty.
  const realTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "America/New_York";
  });
  afterEach(() => {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  });

  /** 2026-11-01 01:00 EDT (UTC-4) — the hour after this one is replayed as EST (UTC-5). */
  const foldStart = new Date(Date.UTC(2026, 10, 1, 5, 0));
  const foldEnd = new Date(Date.UTC(2026, 10, 1, 7, 0)); // 02:00 EST, past the replay

  it("minute keys over a replayed hour are unique and stay ascending", () => {
    const keys = enumerateTsBuckets(foldStart, foldEnd, "minute");
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.filter((k) => k === "2026-11-01T01:30")).toEqual(["2026-11-01T01:30"]);
    expect(keys.at(0)).toBe("2026-11-01T01:00");
    expect(keys.at(-1)).toBe("2026-11-01T02:00");
  });

  it("hour keys over the same window collapse the replayed hour to one bucket", () => {
    expect(enumerateTsBuckets(foldStart, foldEnd, "hour")).toEqual([
      "2026-11-01T01:00",
      "2026-11-01T02:00",
    ]);
    // The date-driven path walks the same clock: a 25-hour local day still has 24 hour keys.
    const day = enumerateBuckets("2026-11-01", "2026-11-01", "hour");
    expect(new Set(day).size).toBe(day.length);
    expect(day).toHaveLength(24);
  });

  it("a spring-forward day is short a key rather than inventing the hour that never happened", () => {
    const day = enumerateBuckets("2026-03-08", "2026-03-08", "hour");
    expect(day).toHaveLength(23);
    expect(day).not.toContain("2026-03-08T02:00");
  });
});

describe("usage-service.queryErrors (error table paging)", () => {
  let db: DatabaseSync;
  let errors: ErrorsRepo;
  let service: UsageService;

  beforeEach(() => {
    db = openDatabase(":memory:");
    errors = new ErrorsRepo(db);
    service = new UsageService(new UsageRepo(db), errors, async () => undefined);
    // 25 rows, oldest first — so "newest first" ordering is observable across a page boundary.
    for (let i = 0; i < 25; i += 1) {
      errors.insert({
        ts: `2026-07-27T00:00:${String(i).padStart(2, "0")}.000Z`,
        date: "2026-07-27",
        projectId: "p1",
        agentId: "a1",
        sessionId: "s1",
        source: "http",
        kind: "expected",
        code: `code_${i}`,
        status: 400,
        message: `m${i}`,
      });
    }
  });
  afterEach(() => db.close());

  it("pages newest-first and reports the filtered total, so the caller knows where the end is", () => {
    const first = service.queryErrors("p1", { offset: 0, limit: 20 });
    expect(first.total).toBe(25);
    expect(first.items).toHaveLength(20);
    expect(first.items[0]!.code).toBe("code_24"); // newest
    const second = service.queryErrors("p1", { offset: 20, limit: 20 });
    expect(second.total).toBe(25);
    // The tail is the five oldest, still descending, with no overlap against page one.
    expect(second.items.map((e) => e.code)).toEqual([
      "code_4",
      "code_3",
      "code_2",
      "code_1",
      "code_0",
    ]);
  });

  it("past the end is empty rather than an error, and total stays the full count", () => {
    const page = service.queryErrors("p1", { offset: 100, limit: 20 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(25);
  });

  it("filters before it offsets, so a later page never slides onto rows the summary excluded", () => {
    // Five newer rows from another Agent, i.e. sitting at the head of the unfiltered table. If
    // the offset were counted over that table and the filter applied afterwards, both pages
    // below would come back shifted (and page two short); filtering first is what makes the
    // 25-row filtered set page cleanly as 20 + 5.
    for (let i = 0; i < 5; i += 1) {
      errors.insert({
        ts: `2026-07-28T00:00:0${i}.000Z`,
        date: "2026-07-28",
        projectId: "p1",
        agentId: "other",
        sessionId: "s2",
        source: "http",
        kind: "expected",
        code: `other_${i}`,
        status: 400,
        message: "m",
      });
    }
    const scoped = { offset: 0, limit: 20, agentId: "a1" };
    const first = service.queryErrors("p1", scoped);
    expect(first.total).toBe(25); // the other Agent's five are outside the count, not just the page
    expect(first.items[0]!.code).toBe("code_24");
    expect(first.items.at(-1)!.code).toBe("code_5");
    const second = service.queryErrors("p1", { ...scoped, offset: 20 });
    expect(second.items.map((e) => e.code)).toEqual([
      "code_4",
      "code_3",
      "code_2",
      "code_1",
      "code_0",
    ]);
    // Unfiltered, the same offset lands on entirely different rows — the filter is doing work.
    const unscoped = service.queryErrors("p1", { offset: 20, limit: 20 });
    expect(unscoped.total).toBe(30);
    expect(unscoped.items.map((e) => e.code)).toEqual([
      "code_9",
      "code_8",
      "code_7",
      "code_6",
      "code_5",
      "code_4",
      "code_3",
      "code_2",
      "code_1",
      "code_0",
    ]);
  });
});
