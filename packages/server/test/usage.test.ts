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
import { formatLocalDate } from "../src/internal/dates.js";
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
    tools: [],
    thinking_level: "default",
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

  it("token_usage → 一行记录（request 桶，只落 Token 不落成本）", async () => {
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

  it("子会话 session_meta 登记 origin→model 映射；token_usage 按映射归因", async () => {
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

  it("origin 映射缺失时回退主 Session Model", async () => {
    const rec = new UsageRecorder(repo);
    await rec.record(CTX, withOrigin(tokenUsage(counts(5), counts(5)), "session-unknown"));
    const row = db.prepare("SELECT model_id FROM usage_records").get()!;
    expect(row.model_id).toBe("main-model");
  });

  it("非 token_usage 消息为 no-op", async () => {
    const rec = new UsageRecorder(repo);
    await rec.record(CTX, sessionMeta(meta("session-main", "main-model")));
    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_records").get()!.n).toBe(0);
  });

  it("origin 映射有上限：超限淘汰最早登记项，被淘汰的回退主 Session Model", async () => {
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

describe("usage-service（成本实时折算）", () => {
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

  it("汇总卡片：今日 / 近 7 天 / 累计；无 pricing 的 Model 标记 hasUncosted", async () => {
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

  it("价格后补：插入时无 pricing，配置价格后再查询即计价", async () => {
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

  it("分组聚合：date 按日期倒序；agent/model/session 维度与 agentId 下钻；跨 Model 折叠", async () => {
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

  it("from/to 过滤分组；趋势固定近 30 天窗口", async () => {
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

  it("成功率：completed / 非 aborted 请求，失败细分随行带出", async () => {
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

  it("回归：aborted（用户点「停止」）不是模型失败——不进分母，成功率不因中断下降", async () => {
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

  it("成功率不受 model 过滤、仍受 agent 与日期过滤（图展示全部 Model）", async () => {
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
