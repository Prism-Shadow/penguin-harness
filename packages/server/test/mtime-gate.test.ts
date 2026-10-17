/**
 * mtime-gate `cacheable()`: which timestamps a derived cache may record as clean.
 *
 * - Given an mtime older than FRESH_MS, the recorded value is that mtime, so a later
 *   stat of the same path matches and the cache stays.
 * - Given an mtime younger than FRESH_MS, the recorded value never matches a real
 *   stat, so the path is re-read until it has been quiet.
 * - Given an mtime in the future (clock skew, a restore, `rsync -t`), the recorded
 *   value is that mtime — not the never-matching sentinel — so a later stat of the
 *   same path matches. Treating a future mtime as "too young" would wedge the gate
 *   until the wall clock passed it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { FRESH_MS, cacheable } from "../src/internal/mtime-gate.js";

describe("cacheable", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an mtime older than FRESH_MS is recorded as itself", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T12:00:00.000Z") });
    const mtimeMs = Date.now() - FRESH_MS - 1;
    expect(cacheable(mtimeMs)).toBe(mtimeMs);
  });

  it("an mtime younger than FRESH_MS is recorded as a sentinel that never matches it", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T12:00:00.000Z") });
    const mtimeMs = Date.now() - FRESH_MS + 1;
    expect(cacheable(mtimeMs)).not.toBe(mtimeMs);
  });

  it("an mtime in the future is recorded as itself, so a later stat of the same path matches", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T12:00:00.000Z") });
    const mtimeMs = Date.now() + 60 * 60 * 1000;
    expect(cacheable(mtimeMs)).toBe(mtimeMs);
  });
});
