/**
 * The tab on screen, told to the server (features/builtin-browser/on-screen-report.ts), as the
 * `POST …/tabs/on-screen` requests the fetch fake records. The layer reports on every frame it
 * lays out (every 16 ms here, on fake timers).
 *
 * - The tab on screen is said once it has stayed put for the settle time, and not again while it
 *   stays.
 * - A quick run of switches says only where it ends; a switch that comes back before it settled
 *   says nothing new.
 * - After a resync the tab on screen is said again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ON_SCREEN_SETTLE_MS,
  forgetOnScreenReport,
  reportOnScreenTab,
} from "../src/features/builtin-browser/on-screen-report";
import { json, stubFetch } from "./helpers/fetch";
import type { FakeFetch } from "./helpers/fetch";

let fetch: FakeFetch;

beforeEach(() => {
  vi.useFakeTimers();
  forgetOnScreenReport();
  fetch = stubFetch(() => json({}));
});
afterEach(() => vi.useRealTimers());

const FRAME_MS = 16;
/** Enough frames for a choice to settle; a handful, well short of it. */
const SETTLED = Math.ceil(ON_SCREEN_SETTLE_MS / FRAME_MS) + 1;
const QUICK = 3;

/** The layer laying out `count` frames with `tabId` on screen. */
function frames(tabId: number | null, count: number): void {
  for (let i = 0; i < count; i++) {
    reportOnScreenTab(tabId);
    vi.advanceTimersByTime(FRAME_MS);
  }
}

/** The tab each on-screen report named, in order. */
const said = () =>
  fetch.requests
    .filter((r) => r.path.endsWith("/tabs/on-screen"))
    .map((r) => (r.body as { tabId: number | null }).tabId);

describe("reportOnScreenTab", () => {
  it("says the tab on screen once it has stayed a moment, and not again while it stays", () => {
    frames(4, QUICK);
    expect(said()).toEqual([]);
    frames(4, SETTLED * 2);
    expect(said()).toEqual([4]);
  });

  it("says only where a quick run of switches ends", () => {
    frames(4, QUICK);
    frames(7, QUICK);
    frames(null, SETTLED);
    expect(said()).toEqual([null]);
  });

  it("says nothing when the switch comes back before it settled", () => {
    frames(4, SETTLED);
    frames(7, QUICK);
    frames(4, SETTLED);
    expect(said()).toEqual([4]);
  });

  it("says it again after a resync", () => {
    frames(4, SETTLED);
    forgetOnScreenReport();
    frames(4, SETTLED);
    expect(said()).toEqual([4, 4]);
  });
});
