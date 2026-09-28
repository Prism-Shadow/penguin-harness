/**
 * combineChangeGuards (state/project.tsx): the pure aggregation behind
 * `registerProjectChangeGuard` — a switch/delete goes ahead only when every registered guard
 * says so, and a guard that needs to ask first (e.g. discarding unsaved edits) declines now
 * and calls `retry` once answered.
 */
import { describe, expect, it, vi } from "vitest";
import { combineChangeGuards } from "../src/state/project";

describe("combineChangeGuards", () => {
  it("allows the operation when there are no guards", () => {
    expect(combineChangeGuards([], vi.fn())).toBe(true);
  });

  it("allows the operation when every guard says yes", () => {
    const retry = vi.fn();
    expect(combineChangeGuards([() => true, () => true], retry)).toBe(true);
    expect(retry).not.toHaveBeenCalled();
  });

  it("blocks on the first guard that says no, without calling `retry` itself", () => {
    const retry = vi.fn();
    const declined = vi.fn(() => false);
    expect(combineChangeGuards([declined], retry)).toBe(false);
    expect(declined).toHaveBeenCalledWith(retry);
    expect(retry).not.toHaveBeenCalled();
  });

  it("short-circuits: a guard after a declining one is never asked", () => {
    const later = vi.fn(() => true);
    expect(combineChangeGuards([() => false, later], vi.fn())).toBe(false);
    expect(later).not.toHaveBeenCalled();
  });

  it("passes `retry` through so a guard can call it once its own question is answered", () => {
    const saved: { current: (() => void) | null } = { current: null };
    const guard = (retry: () => void) => {
      saved.current = retry;
      return false;
    };
    const retry = vi.fn();
    expect(combineChangeGuards([guard], retry)).toBe(false);
    saved.current?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
