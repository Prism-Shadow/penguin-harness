/**
 * The tab on screen, told to the server (features/builtin-browser/on-screen-report.ts): once the
 * choice has settled, once per change however many frames repeat it, and again after a resync.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/api/endpoints", () => ({
  setBuiltinBrowserOnScreen: vi.fn(() => Promise.resolve()),
}));

import * as api from "../src/api/endpoints";
import {
  ON_SCREEN_SETTLE_MS,
  forgetOnScreenReport,
  reportOnScreenTab,
} from "../src/features/builtin-browser/on-screen-report";

const sent = vi.mocked(api.setBuiltinBrowserOnScreen);

beforeEach(() => {
  vi.useFakeTimers();
  forgetOnScreenReport();
  sent.mockClear();
});
afterEach(() => vi.useRealTimers());

/** The layer lays out a frame every 16 ms. */
function frames(tabId: number | null, count: number): void {
  for (let i = 0; i < count; i++) {
    reportOnScreenTab(tabId);
    vi.advanceTimersByTime(16);
  }
}

describe("reportOnScreenTab", () => {
  it("says the tab on screen once it has stayed a moment, and not again while it stays", () => {
    frames(4, 5);
    expect(sent).not.toHaveBeenCalled();
    frames(4, 60);
    expect(sent.mock.calls).toEqual([[4]]);
  });

  it("says only where a quick run of switches ends", () => {
    frames(4, 3);
    frames(7, 3);
    frames(null, 40);
    expect(sent.mock.calls).toEqual([[null]]);
  });

  it("says nothing when the switch comes back before it settled", () => {
    frames(4, 40);
    frames(7, 3);
    frames(4, 40);
    expect(sent.mock.calls).toEqual([[4]]);
  });

  it("says it again after a resync", () => {
    frames(4, 40);
    forgetOnScreenReport();
    frames(4, 40);
    expect(sent.mock.calls).toEqual([[4], [4]]);
    expect(ON_SCREEN_SETTLE_MS).toBeLessThan(40 * 16);
  });
});
