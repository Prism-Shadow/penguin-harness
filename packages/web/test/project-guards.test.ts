/**
 * combineChangeGuards (state/project.tsx): the pure aggregation behind
 * `registerProjectChangeGuard` — a switch/delete goes ahead only when every registered guard
 * says so. A guard with nothing to ask returns a plain boolean; one that needs to ask first
 * (e.g. discarding unsaved edits) returns a Promise that settles once answered. The whole
 * aggregation stays synchronous (returns a plain boolean, not a Promise) as long as every
 * guard answered synchronously — `setCurrentProjectId` relies on this to commit within the
 * same tick when nothing needed asking, since nothing awaits that call.
 */
import { describe, expect, it, vi } from "vitest";
import { combineChangeGuards } from "../src/state/project";

describe("combineChangeGuards", () => {
  it("allows the operation synchronously when there are no guards", () => {
    expect(combineChangeGuards([])).toBe(true);
  });

  it("allows the operation synchronously when every guard says yes synchronously", () => {
    expect(combineChangeGuards([() => true, () => true])).toBe(true);
  });

  it("blocks synchronously when a guard says no synchronously", () => {
    const declined = vi.fn(() => false);
    expect(combineChangeGuards([declined])).toBe(false);
    expect(declined).toHaveBeenCalledTimes(1);
  });

  it("short-circuits: a guard after a declining one is never asked", () => {
    const later = vi.fn(() => true);
    expect(combineChangeGuards([() => false, later])).toBe(false);
    expect(later).not.toHaveBeenCalled();
  });

  it("switches to a Promise once a guard asks, and awaits its eventual answer", async () => {
    let settle: ((answer: boolean) => void) | null = null;
    const guard = () =>
      new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    const result = combineChangeGuards([guard]);
    expect(result).toBeInstanceOf(Promise);
    let settled = false;
    void (result as Promise<boolean>).then(() => {
      settled = true;
    });
    await Promise.resolve();
    // The guard hasn't answered yet — nothing about combineChangeGuards should resolve early.
    expect(settled).toBe(false);
    settle!(true);
    await expect(result).resolves.toBe(true);
  });

  it("short-circuits even when the declining guard's answer arrives asynchronously", async () => {
    const later = vi.fn(() => true);
    const result = combineChangeGuards([() => Promise.resolve(false), later]);
    await expect(result).resolves.toBe(false);
    expect(later).not.toHaveBeenCalled();
  });
});
