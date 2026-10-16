/**
 * The machine connection probes on the Telemetry switch (PRFC-0008): the process-wide slot
 * (machines/transport/timings.ts) holds a sink exactly while the switch is on; what the probes
 * hand it lands in the App's buffer keyed by machine; and a generation that is going does not
 * empty a slot its successor already took.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TelemetryResponse } from "../src/api/types.js";
import { bindMachineTimings } from "../src/machines/telemetry-binding.js";
import { emit, setTimingsSink, timingsSink } from "../src/machines/transport/timings.js";
import type { Telemetry } from "../src/mechanisms/telemetry.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const LAB = "ssh:lab";

describe("machine probes on a test App", () => {
  let t: TestApp;
  beforeEach(async () => {
    setTimingsSink(null);
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
    setTimingsSink(null);
  });

  it("the slot holds a sink exactly while the switch is on, and samples land keyed by machine", async () => {
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect(timingsSink()).toBeNull();
    expect((await admin.put("/api/admin/settings", { telemetry: true })).status).toBe(200);
    emit({ ts: 0, probe: "machine.connect.stage", durMs: 12, keys: { machine: LAB } });
    const res = await admin.get("/api/telemetry?view=samples&probe=machine.connect.stage");
    expect(((await res.json()) as TelemetryResponse).samples).toMatchObject([
      { durMs: 12, keys: { machine: LAB, generation: 1 } },
    ]);
    expect((await admin.put("/api/admin/settings", { telemetry: false })).status).toBe(200);
    expect(timingsSink()).toBeNull();
  });
});

/** A switch with a buffer of its own: the part of Telemetry the binding uses. */
function fakeTelemetry(initially: boolean) {
  let on = initially;
  const listeners = new Set<(on: boolean) => void>();
  const recorded: unknown[] = [];
  const telemetry = {
    watch(listener: (on: boolean) => void) {
      listeners.add(listener);
      listener(on);
      return () => void listeners.delete(listener);
    },
    record(sample: unknown) {
      recorded.push(sample);
      return null;
    },
  } as unknown as Telemetry;
  const set = (next: boolean) => {
    on = next;
    for (const l of listeners) l(on);
  };
  return { telemetry, recorded, set, listeners };
}

describe("bindMachineTimings across a hand-over", () => {
  beforeEach(() => setTimingsSink(null));
  afterEach(() => setTimingsSink(null));

  it("the successor's sink survives the outgoing generation's dispose", () => {
    const old = fakeTelemetry(true);
    const disposeOld = bindMachineTimings(old.telemetry);
    const next = fakeTelemetry(true);
    const disposeNext = bindMachineTimings(next.telemetry);
    disposeOld();
    expect(old.listeners.size).toBe(0);
    emit({ ts: 1, probe: "machine.ssh.command", durMs: 5, keys: { machine: LAB } });
    // The buffer stamps its own time: the sink hands over the rest.
    expect(old.recorded).toHaveLength(0);
    expect(next.recorded).toEqual([
      { probe: "machine.ssh.command", durMs: 5, keys: { machine: LAB } },
    ]);
    disposeNext();
    expect(timingsSink()).toBeNull();
  });
});
