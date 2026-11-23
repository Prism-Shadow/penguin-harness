/**
 * Given a countdown, pausing preserves its remaining wait, even across repeated pause requests.
 * Given a paused clock, new work waits for resume, canceled work stays canceled and nested work runs.
 * Given pending work, disposing the clock prevents it from running after a later resume.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvolutionClock } from "../src/app/evolution-clock";

afterEach(() => vi.useRealTimers());

describe("walkthrough playback", () => {
  it("resumes with the time that remained when paused", () => {
    vi.useFakeTimers();
    const clock = new EvolutionClock();
    const run = vi.fn();
    clock.schedule(run, 1000);
    vi.advanceTimersByTime(400);
    clock.setPaused(true);
    vi.advanceTimersByTime(5000);
    clock.setPaused(true);
    expect(run).not.toHaveBeenCalled();
    clock.setPaused(false);
    clock.setPaused(false);
    vi.advanceTimersByTime(599);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledOnce();
    clock.dispose();
  });

  it("holds new work while paused and never resumes canceled work", () => {
    vi.useFakeTimers();
    const clock = new EvolutionClock();
    const events: string[] = [];
    clock.setPaused(true);
    clock.schedule(() => {
      events.push("first");
      clock.schedule(() => events.push("next"), 100);
    }, 600);
    const cancel = clock.schedule(() => events.push("canceled"), 200);
    cancel();
    vi.advanceTimersByTime(5000);
    expect(events).toEqual([]);
    clock.setPaused(false);
    vi.advanceTimersByTime(600);
    expect(events).toEqual(["first"]);
    vi.advanceTimersByTime(100);
    expect(events).toEqual(["first", "next"]);
    clock.dispose();
  });

  it("discards pending work on dispose", () => {
    vi.useFakeTimers();
    const clock = new EvolutionClock();
    const run = vi.fn();
    clock.schedule(run, 200);
    clock.setPaused(true);
    clock.dispose();
    clock.setPaused(false);
    vi.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
  });
});
