/**
 * The telemetry buffer and service (PRFC-0008): caps evict the oldest, the summaries the read
 * route serves, and the switch — no buffer while off, which "zero cost when off" rests on.
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
  ({
    ts: 0,
    probe,
    ...(durMs !== undefined ? { durMs } : {}),
    keys: {},
    ...extra,
  }) as TelemetrySample;

describe("telemetry buffer", () => {
  it("drops the oldest past the count or the byte cap, compacts, and clears", () => {
    const byCount = new SampleRing(10, 1_000_000);
    for (let i = 0; i < 5000; i++) byCount.push(sample(`p${i}`));
    expect(byCount.list().map((s) => s.probe)).toEqual(
      Array.from({ length: 10 }, (_, i) => `p${4990 + i}`),
    );
    const one = JSON.stringify(sample("p0")).length;
    const byBytes = new SampleRing(1000, one * 2 + 1);
    for (let i = 0; i < 4; i++) byBytes.push(sample(`p${i}`));
    expect(byBytes.list().map((s) => s.probe)).toEqual(["p2", "p3"]);
    byCount.clear();
    expect([byCount.size, byCount.bytes]).toEqual([0, 0]);
  });

  it("summarizes per probe and per session, and selects with a newest-first limit", () => {
    const samples = [
      sample("http.request", 10, { bytes: 100, keys: { session: "s1" } }),
      sample("http.request", 30, { bytes: 50 }),
      sample("http.request", 20),
      sample("boot.module", 1),
      sample("session.messages", 40, { keys: { session: "s1" }, ts: 5 }),
      sample("trace.read", 25, { keys: { session: "s2" }, ts: 9 }),
    ];
    const probes = summarizeProbes(samples);
    expect(probes.find((p) => p.probe === "http.request")).toEqual({
      probe: "http.request",
      count: 3,
      p50Ms: 20,
      p95Ms: 30,
      maxMs: 30,
      bytes: 150,
    });
    expect(probes.find((p) => p.probe === "boot.module")!.bytes).toBeNull();
    const sessions = summarizeSessions(samples);
    expect(sessions.map((s) => s.session)).toEqual(["s2", "s1"]);
    expect(sessions[1]!.probes.map((p) => p.probe)).toEqual(["http.request", "session.messages"]);
    expect(selectSamples(samples, { probe: "http.request", limit: 2 }).map((s) => s.durMs)).toEqual(
      [30, 20],
    );
  });
});

describe("TelemetryService", () => {
  const make = (initial: string | null) => {
    const store = new Map<string, string>(
      initial !== null ? [[TELEMETRY_ENABLED_KEY, initial]] : [],
    );
    const svc = wire(TelemetryService, {
      settings: {
        get: (k: string) => store.get(k) ?? null,
        set: (k: string, v: string) => store.set(k, v),
      },
    });
    svc.setup({ resources: { claim: () => undefined } } as never);
    return { svc, store };
  };

  it("off: records nothing and runs scopes and spans as they are; the stored switch is read at setup", async () => {
    const { svc } = make(null);
    expect(svc.record({ probe: "http.request", durMs: 1 })).toBeNull();
    expect(await svc.within({ request: "r" }, async () => 7)).toBe(7);
    expect(await svc.span("trace.read", {}, async () => 8)).toBe(8);
    expect(svc.samples({})).toEqual([]);
    expect(make("true").svc.on()).toBe(true);
  });

  it("on: a span (and time, its synchronous twin) times its run, lends its keys to what is recorded inside, and records a throw as error", async () => {
    const { svc, store } = make(null);
    svc.setEnabled(true);
    expect(store.get(TELEMETRY_ENABLED_KEY)).toBe("true");
    await svc.within({ request: "r1" }, () =>
      svc.span(
        "session.messages",
        { session: "s" },
        async () => {
          svc.record({ probe: "trace.read", durMs: 2 });
          return [1, 2];
        },
        (r) => ({ attrs: { items: r.length } }),
      ),
    );
    await expect(
      svc.span("trace.read", {}, () => Promise.reject(new Error("x"))),
    ).rejects.toThrow();
    expect(svc.samples({})).toMatchObject([
      { probe: "trace.read", keys: { request: "r1", session: "s" } },
      {
        probe: "session.messages",
        attrs: { items: 2 },
        status: "ok",
        keys: { request: "r1", session: "s" },
      },
      { probe: "trace.read", status: "error" },
    ]);
    svc.clear();
    svc.time("sessions.list.sql", { session: "s" }, () => svc.record({ probe: "inner" }));
    expect(svc.samples({})).toMatchObject([
      { probe: "inner", keys: { session: "s" } },
      { probe: "sessions.list.sql", status: "ok", keys: { session: "s" } },
    ]);
    svc.setEnabled(false);
    expect(store.get(TELEMETRY_ENABLED_KEY)).toBe("false");
    svc.setEnabled(true);
    expect(svc.samples({})).toEqual([]);
  });
});
