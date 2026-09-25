/**
 * The Test browser page's model: the status line and its tone for each state the server
 * reports, the failure and its output, when Install is enabled, and when the page polls.
 */
import { describe, expect, it } from "vitest";
import type { TestBrowserStatus } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import { shouldPollTestBrowser, testBrowserView } from "../src/features/settings/test-browser";

const base: TestBrowserStatus = {
  available: true,
  installed: false,
  version: "149.0.7827.55",
  path: "/home/penguin/browsers",
  installing: false,
  error: null,
  log: null,
};

describe("test browser view", () => {
  it("says it is missing and offers the install", () => {
    expect(testBrowserView(base)).toEqual({
      tone: "attention",
      line: S.settings.testBrowser.missing,
      failure: null,
      log: null,
      canInstall: true,
    });
  });

  it("says it is unavailable and offers no install where Playwright is not shipped", () => {
    expect(testBrowserView({ ...base, available: false })).toEqual({
      tone: "muted",
      line: S.settings.testBrowser.unavailable,
      failure: null,
      log: null,
      canInstall: false,
    });
  });

  it("names the installed Chromium version", () => {
    const view = testBrowserView({ ...base, installed: true });
    expect(view.tone).toBe("success");
    expect(view.line).toBe("Installed, Chromium 149.0.7827.55");
    expect(testBrowserView({ ...base, installed: true, version: null }).line).toBe("Installed");
  });

  it("says an install is running and holds the button", () => {
    const view = testBrowserView({ ...base, installing: true, error: "failed", log: "old" });
    expect(view).toMatchObject({ tone: "busy", failure: null, log: null, canInstall: false });
    expect(view.line).toBe(S.settings.testBrowser.installing);
  });

  it("names why an install failed and shows the end of its output", () => {
    const view = testBrowserView({ ...base, error: "timed_out", log: "Downloading… 40%" });
    expect(view.failure).toBe(
      S.settings.testBrowser.failed(S.settings.testBrowser.reasons.timed_out),
    );
    expect(view.log).toBe("Downloading… 40%");
    expect(view.canInstall).toBe(true);
    for (const error of ["failed", "not_started", "incomplete"] as const) {
      expect(testBrowserView({ ...base, error }).failure).toContain(
        S.settings.testBrowser.reasons[error],
      );
    }
  });

  it("polls only while an install runs", () => {
    expect(shouldPollTestBrowser(null)).toBe(false);
    expect(shouldPollTestBrowser(base)).toBe(false);
    expect(shouldPollTestBrowser({ ...base, installing: true })).toBe(true);
  });
});
