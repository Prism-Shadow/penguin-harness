import { describe, expect, it } from "vitest";
import { feedUrlOverride, updateSupport } from "../src/update-support.js";

describe("updateSupport", () => {
  it("supports packaged macOS and Windows builds", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(updateSupport({ isPackaged: true, platform, env: {} })).toEqual({ supported: true });
    }
  });

  it("supports Linux only when running as an AppImage", () => {
    const env = { APPIMAGE: "/opt/PenguinHarness.AppImage" };
    expect(updateSupport({ isPackaged: true, platform: "linux", env })).toEqual({
      supported: true,
    });
    // A deb install has no APPIMAGE: updating around dpkg would desync the two.
    expect(updateSupport({ isPackaged: true, platform: "linux", env: {} })).toEqual({
      supported: false,
      reason: "linux-not-appimage",
    });
  });

  it("never updates a dev run, whatever the platform", () => {
    expect(
      updateSupport({ isPackaged: false, platform: "darwin", env: { APPIMAGE: "/x" } }),
    ).toEqual({ supported: false, reason: "dev" });
  });
});

describe("feedUrlOverride", () => {
  it("accepts http(s) URLs and normalizes them", () => {
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "http://127.0.0.1:8080/feed" })).toBe(
      "http://127.0.0.1:8080/feed",
    );
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: " https://example.com/u " })).toBe(
      "https://example.com/u",
    );
  });

  it("ignores unset, blank, non-http and unparseable values", () => {
    expect(feedUrlOverride({})).toBeNull();
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "   " })).toBeNull();
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "file:///etc/passwd" })).toBeNull();
    expect(feedUrlOverride({ PENGUIN_UPDATE_FEED_URL: "not a url" })).toBeNull();
  });
});
