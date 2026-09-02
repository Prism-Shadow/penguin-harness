/**
 * The Machines page's re-probe schedule: how far apart the ssh round trips get when nothing
 * is changing, and what counts as a change worth resetting for.
 *
 * The fingerprint deliberately excludes `checkedAt`. Every probe moves that timestamp, so
 * including it would make every round look like a change and pin the interval at its
 * shortest step forever — an ssh child per machine every 15 seconds, indefinitely.
 */
import { describe, expect, it } from "vitest";
import {
  PROBE_STEPS_MS,
  probeDelayMs,
  probeFingerprint,
} from "../src/features/machines/probe-schedule";

const machine = (
  id: string,
  state: string | null,
  extra: { port?: number; version?: string; checkedAt?: string } = {},
) => ({
  id,
  installed: { version: extra.version ?? "9.9.9" },
  status:
    state === null ? null : { state, ...(extra.port === undefined ? {} : { port: extra.port }) },
});

describe("probeDelayMs", () => {
  it("starts at 15s and widens through a minute to a ten-minute ceiling", () => {
    expect(probeDelayMs(0)).toBe(15_000);
    expect(probeDelayMs(1)).toBe(30_000);
    expect(probeDelayMs(2)).toBe(45_000);
    expect(probeDelayMs(3)).toBe(60_000);
    expect(probeDelayMs(4)).toBe(120_000);
    expect(probeDelayMs(PROBE_STEPS_MS.length - 1)).toBe(600_000);
  });

  it("never exceeds ten minutes, however long everything has been quiet", () => {
    for (const rounds of [20, 100, 10_000]) expect(probeDelayMs(rounds)).toBe(600_000);
  });

  it("is monotonic — a longer quiet spell never probes sooner", () => {
    const delays = PROBE_STEPS_MS.map((_, i) => probeDelayMs(i));
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });

  it("treats a nonsensical round count as the first step rather than throwing", () => {
    expect(probeDelayMs(-1)).toBe(15_000);
  });
});

describe("probeFingerprint", () => {
  it("ignores checkedAt, so an unchanged round really reads as unchanged", () => {
    const before = probeFingerprint([machine("ssh:a", "running", { port: 7364 })]);
    const after = probeFingerprint([machine("ssh:a", "running", { port: 7364 })]);
    expect(after).toBe(before);
  });

  it("changes when a server goes down, comes up, or moves port", () => {
    const running = probeFingerprint([machine("ssh:a", "running", { port: 7364 })]);
    expect(probeFingerprint([machine("ssh:a", "stopped")])).not.toBe(running);
    expect(probeFingerprint([machine("ssh:a", "unreachable")])).not.toBe(running);
    expect(probeFingerprint([machine("ssh:a", "running", { port: 7365 })])).not.toBe(running);
  });

  it("changes when a machine is installed, reinstalled at a new version, or appears", () => {
    const one = probeFingerprint([machine("ssh:a", "running", { port: 7364 })]);
    expect(
      probeFingerprint([machine("ssh:a", "running", { port: 7364, version: "10.0.0" })]),
    ).not.toBe(one);
    expect(
      probeFingerprint([machine("ssh:a", "running", { port: 7364 }), machine("ssh:b", "stopped")]),
    ).not.toBe(one);
  });

  it("distinguishes 'not probed yet' from every real state", () => {
    const unprobed = probeFingerprint([machine("ssh:a", null)]);
    for (const state of ["running", "stopped", "unreachable"]) {
      expect(probeFingerprint([machine("ssh:a", state)])).not.toBe(unprobed);
    }
  });
});
