/**
 * A wait past the 2^31-1 ms a single `setTimeout` can hold must still wait, not fire
 * on the spot.
 *
 * - Given a budget past the cap, when the cap's worth of time has passed, the callback
 *   has not fired.
 * - Given a budget past the cap, when the deadline arrives, the callback fires once.
 * - Given a budget under the cap, when the deadline arrives, the callback fires.
 * - Given cancel before the deadline, the callback never fires.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { armDeadline } from "../src/internal/deadline-timer.js";

describe("armDeadline past the setTimeout cap", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps waiting when the budget exceeds 2^31-1 ms instead of firing right away", async () => {
    const budget = 600 * 3_600_000; // 600h — over the cap
    let fired = 0;
    armDeadline(budget, () => {
      fired += 1;
    });
    await vi.advanceTimersByTimeAsync(2 ** 31 - 1);
    expect(fired).toBe(0);
    await vi.advanceTimersByTimeAsync(budget - (2 ** 31 - 1));
    expect(fired).toBe(1);
  });

  it("fires at the deadline as before when the budget is small", async () => {
    let fired = 0;
    armDeadline(5_000, () => {
      fired += 1;
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fired).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(fired).toBe(1);
  });

  it("does not fire after cancel, even past the deadline", async () => {
    let fired = 0;
    const cancel = armDeadline(5_000, () => {
      fired += 1;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fired).toBe(0);
  });
});
