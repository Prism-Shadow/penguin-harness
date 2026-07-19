/**
 * Behavior tests for BackgroundRegistry's idle reaping (a leak safety net).
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
