/**
 * The soft-yield deadline of `run --timeout` / `input --timeout` / `logs -f --timeout`:
 * waits longer than the 2^31-1 ms a single `setTimeout` can hold must still wait, not
 * end on the spot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SseFrame } from "@prismshadow/amsp";
import { nextFrameOrDeadline } from "../src/server-task.js";
import type { SessionStream } from "../src/server-task.js";

function neverStream(): SessionStream {
  return {
    next: () => new Promise<never>(() => {}),
  } as unknown as SessionStream;
}

describe("nextFrameOrDeadline past the setTimeout cap", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps waiting when the budget exceeds 2^31-1 ms instead of ending right away", async () => {
    const budget = 600 * 3_600_000; // 600h — over the cap (a bare "2147484" hits it too)
    const pending = nextFrameOrDeadline(neverStream(), Date.now() + budget);
    // The old code handed the whole budget to setTimeout, which Node clamps to 1 ms:
    // the wait ended before the first frame could arrive. Held under the cap, it must
    // still be waiting once the cap's worth of time has passed.
    await vi.advanceTimersByTimeAsync(2 ** 31 - 1);
    let settled: string | undefined;
    void pending.then((r) => void (settled = r as string));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(budget);
    await expect(pending).resolves.toBe("timeout");
  });

  it("times out at the deadline as before when the budget is small", async () => {
    const pending = nextFrameOrDeadline(neverStream(), Date.now() + 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    let settled: string | undefined;
    void pending.then((r) => void (settled = r as string));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("timeout");
  });

  it("returns the next frame when the stream produces one before the deadline", async () => {
    const stream = {
      next: () => Promise.resolve({ event: "task_state" } as SseFrame),
    } as unknown as SessionStream;
    await expect(nextFrameOrDeadline(stream, Date.now() + 5_000)).resolves.toMatchObject({
      event: "task_state",
    });
  });
});
