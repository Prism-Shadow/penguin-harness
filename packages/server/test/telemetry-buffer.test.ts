/**
 * The telemetry sample buffer (PRFC-0008 "存储与上限"): count and byte caps evict the oldest
 * first, and the summaries the read route serves (per probe, per session) are computed over
 * what is left. The service's switch rule — no buffer while off — is covered here too, against
 * a settings stub, since it is the one guarantee the "zero cost when off" promise rests on.
 */
import { describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import type { TelemetrySample } from "../src/api/types.js";
import {
  SampleRing,
  selectSamples,
  summarizeProbes,
  summarizeSessions,
} from "../src/telemetry/buffer.js";
import { TELEMETRY_ENABLED_KEY, TelemetryService } from "../src/telemetry/service.js";

const sample = (probe: string, durMs?: number, extra: Partial<TelemetrySample> = {}) =>
  ({ ts: 0, probe, ...(durMs !== undefined ? { durMs } : {}), keys: {}, ...extra }) as TelemetrySample;

describe("SampleRing", () => {
  it("keeps at most maxSamples, dropping the oldest", () => {
    const ring = new SampleRing(3, 1_000_000);
    for (let i = 0; i < 5; i++) ring.push(sample(`p${i}`));
    expect(ring.size).toBe(3);
    expect(ring.list().map((s) => s.probe)).toEqual(["p2", "p3", "p4"]);
  });

  it("keeps the byte total under maxBytes, dropping the oldest", () => {
    const one = JSON.stringify(sample("p0")).length;
    const ring = new SampleRing(1000, one * 2 + 1);
    for (let i = 0; i < 4; i++) ring.push(sample(`p${i}`));
    expect(ring.list().map((s) => s.probe)).toEqual(["p2", "p3"]);
    expect(ring.bytes).toBeLessThanOrEqual(one * 2 + 1);
  });

  it("survives many evictions (the dead prefix is compacted) and clears", () => {
    const ring = new SampleRing(10, 1_000_000);
    for (let i = 0; i < 5000; i++) ring.push(sample(`p${i}`));
    expect(ring.list().map((s) => s.probe)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${4990 + i}`),
    );
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.bytes).toBe(0);
  });
});

describe("summaries", () => {
  const samples = [
    sample("http.request", 10, { bytes: 100, keys: { session: "s1" } }),
    sample("http.request", 30, { bytes: 50 }),
    sample("http.request", 20),
    sample("boot.module", 1),
    sample("session.messages", 40, { keys: { session: "s1" }, ts: 5 }),
    sample("trace.read", 25, { keys: { session: "s2" }, ts: 9 }),
  ];

  it("per probe: count, nearest-rank p50/p95, max and summed bytes", () => {
    const http = summarizeProbes(samples).find((p) => p.probe === "http.request")!;
    expect(http).toEqual({ probe: "http.request", count: 3, p50Ms: 20, p95Ms: 30, maxMs: 30, bytes: 150 });
    expect(summarizeProbes(samples).find((p) => p.probe === "boot.module")!.bytes).toBeNull();
  });

  it("per session: only samples with a session key, most recent first", () => {
    const sessions = summarizeSessions(samples);
    expect(sessions.map((s) => s.session)).toEqual(["s2", "s1"]);
    expect(sessions[1]!.probes).toEqual([
      { probe: "http.request", count: 1, totalMs: 10, maxMs: 10 },
      { probe: "session.messages", count: 1, totalMs: 40, maxMs: 40 },
    ]);
  });

  it("selects by probe and session, limit keeping the newest", () => {
    expect(selectSamples(samples, { probe: "http.request", limit: 2 }).map((s) => s.durMs)).toEqual([
      30, 20,
    ]);
    expect(selectSamples(samples, { session: "s1" })).toHaveLength(2);
  });
});

describe("TelemetryService switch", () => {
  const settingsStub = (initial: string | null) => {
    const store = new Map<string, string>();
    if (initial !== null) store.set(TELEMETRY_ENABLED_KEY, initial);
    return { get: (k: string) => store.get(k) ?? null, set: (k: string, v: string) => store.set(k, v), store };
  };
  const make = (initial: string | null) => {
    const settings = settingsStub(initial);
    const svc = wire(TelemetryService, { settings });
    svc.setup({ resources: { claim: () => undefined } } as never);
    return { svc, settings };
  };

  it("off by default: records nothing, holds no samples, runs a scope's body as is", async () => {
    const { svc } = make(null);
    expect(svc.on()).toBe(false);
    expect(svc.record({ probe: "http.request", durMs: 1 })).toBeNull();
    expect(svc.samples({})).toEqual([]);
    expect(await svc.within({ request: "r" }, async () => 7)).toBe(7);
  });

  it("setEnabled stores the switch and applies it at once; off drops the buffer", async () => {
    const { svc, settings } = make(null);
    svc.setEnabled(true);
    expect(settings.store.get(TELEMETRY_ENABLED_KEY)).toBe("true");
    await svc.within({ request: "r1" }, async () => {
      svc.record({ probe: "trace.read", durMs: 2, keys: { session: "s" } });
    });
    expect(svc.samples({})).toMatchObject([{ probe: "trace.read", keys: { request: "r1", session: "s" } }]);
    svc.setEnabled(false);
    expect(settings.store.get(TELEMETRY_ENABLED_KEY)).toBe("false");
    expect(svc.samples({})).toEqual([]);
    svc.setEnabled(true);
    expect(svc.samples({})).toEqual([]);
  });

  it("reads the stored switch once, at setup", () => {
    const { svc } = make("true");
    expect(svc.on()).toBe(true);
  });
});
