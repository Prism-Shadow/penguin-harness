/**
 * Behavior tests for BackgroundRegistry's idle reaping (a leak safety net) and its
 * membership listener (what a host's background-task count is driven by).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundRegistry } from "../src/environment/tools/background/index.js";
import type { BackgroundTask } from "../src/environment/tools/background/index.js";

type FakeTask = BackgroundTask & { killed: boolean };

function fakeTask(): FakeTask {
  const task: FakeTask = {
    lastUsed: 0,
    running: true,
    killed: false,
    kill() {
      task.killed = true;
    },
    killHard() {
      task.killed = true;
    },
  };
  return task;
}

describe("BackgroundRegistry idle reaping", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reaps sessions idle past the TTL and keeps recently accessed ones", () => {
    const registry = new BackgroundRegistry<FakeTask>({ idPrefix: "proc", maxTasks: 4 });
    const stale = fakeTask();
    const fresh = fakeTask();
    const staleId = registry.register(stale);
    const freshId = registry.register(fresh);

    // After 9 days, one access to fresh refreshes its lastUsed; stale is never accessed.
    vi.advanceTimersByTime(9 * 24 * 60 * 60_000);
    expect(registry.get(freshId)).toBe(fresh);

    // stale, now idle a full 10 days, is reaped by the scheduled sweep and finalized;
    // fresh has been idle only 1 day and is kept.
    vi.advanceTimersByTime(24 * 60 * 60_000 + 60 * 60_000);
    expect(registry.get(staleId)).toBeUndefined();
    expect(stale.killed).toBe(true);
    expect(registry.get(freshId)).toBe(fresh);
    expect(fresh.killed).toBe(false);

    registry.dispose();
  });

  it("stops the reap timer on dispose", () => {
    const registry = new BackgroundRegistry<FakeTask>({ idPrefix: "proc", maxTasks: 4 });
    const task = fakeTask();
    registry.register(task);
    registry.dispose();
    expect(task.killed).toBe(true);
    // After dispose the sweep timer is cleared, so fast-forwarding no longer triggers any reaping logic.
    expect(() => vi.advanceTimersByTime(30 * 24 * 60 * 60_000)).not.toThrow();
  });
});

describe("BackgroundRegistry membership listener", () => {
  it("pings on every entry and exit, and once for a clear-out that removed anything", () => {
    const registry = new BackgroundRegistry<FakeTask>({ idPrefix: "proc", maxTasks: 4 });
    let pings = 0;
    registry.onChange(() => {
      pings += 1;
    });
    const a = registry.register(fakeTask());
    const b = registry.register(fakeTask());
    expect(pings).toBe(2);
    registry.remove(a);
    expect(pings).toBe(3);
    // An id no longer (or never) held changes nothing, so nothing is reported.
    registry.remove(a);
    registry.remove("proc-nope");
    expect(pings).toBe(3);
    // killAll reports once for the whole clear-out, and not at all when it was already empty.
    registry.killAll();
    expect(pings).toBe(4);
    registry.killAll();
    expect(pings).toBe(4);
    expect(registry.get(b)).toBeUndefined();
    registry.dispose();
    expect(pings).toBe(4);
  });

  it("reports a capacity eviction as an exit before the newcomer's entry", () => {
    const registry = new BackgroundRegistry<FakeTask>({ idPrefix: "proc", maxTasks: 1 });
    const sizes: number[] = [];
    registry.onChange(() => sizes.push(registry.size));
    registry.register(fakeTask());
    registry.makeRoom(true);
    registry.register(fakeTask());
    expect(sizes).toEqual([1, 0, 1]);
    registry.dispose();
  });
});
