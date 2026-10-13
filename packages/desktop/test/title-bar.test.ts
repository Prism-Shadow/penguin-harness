/**
 * The main window's title bar: which system chrome it keeps, and the colour of the Windows and
 * Linux window controls drawn over the page's own top band.
 *
 * - Given macOS, when the window is built, the traffic lights stay, inset into the band, and no
 *   overlay colour is set (macOS draws its own).
 * - Given Windows or Linux, when the window is built, the controls are laid over the page with a
 *   transparent background, so the page's band shows through behind them.
 * - Given a page that reports a dark theme colour, the symbols are light; a light one, dark —
 *   whatever the system's own setting says, since the app may be set apart from it.
 * - Given a page that reports no colour, or one that cannot be read, the system's setting decides.
 */
import { describe, expect, it } from "vitest";
import { overlayColors, titleBarWindowOptions } from "../src/title-bar.js";

/** Whether a `#rrggbb` symbol colour is the light one of the pair. */
function isLight(hex: string): boolean {
  return parseInt(hex.slice(1, 3), 16) > 0x80;
}

describe("titleBarWindowOptions", () => {
  it("keeps the macOS traffic lights inset into the band and sets no overlay colour", () => {
    const options = titleBarWindowOptions("darwin", false);
    expect(options.titleBarStyle).toBe("hiddenInset");
    expect(options.titleBarOverlay.color).toBeUndefined();
    expect(options.titleBarOverlay.symbolColor).toBeUndefined();
  });

  it.each(["win32", "linux"] as const)(
    "lays the %s window controls over the page on a transparent background",
    (platform) => {
      const options = titleBarWindowOptions(platform, false);
      expect(options.titleBarStyle).toBe("hidden");
      expect(options.titleBarOverlay.color).toMatch(/^#[0-9a-f]{6}00$/i);
      expect(options.titleBarOverlay.height).toBeGreaterThan(0);
    },
  );

  it("starts the Windows and Linux symbols on the system's light/dark setting", () => {
    expect(isLight(titleBarWindowOptions("win32", true).titleBarOverlay.symbolColor!)).toBe(true);
    expect(isLight(titleBarWindowOptions("linux", false).titleBarOverlay.symbolColor!)).toBe(false);
  });
});

describe("overlayColors", () => {
  it.each([
    ["the Primer dark canvas", "#121212"],
    ["the Frost dark canvas", "#1B1C1E"],
    ["the Console dark canvas", "#131010"],
  ])("draws light symbols over %s, even on a light system", (_name, color) => {
    expect(isLight(overlayColors(color, false).symbolColor)).toBe(true);
  });

  it.each([
    ["the Primer light canvas", "#ffffff"],
    ["the Frost light canvas", "#FAFAFA"],
    ["the Console light canvas", "#fbfafa"],
  ])("draws dark symbols over %s, even on a dark system", (_name, color) => {
    expect(isLight(overlayColors(color, true).symbolColor)).toBe(false);
  });

  it("follows the system when the page reports no colour, or one it cannot read", () => {
    for (const color of [null, "rgb(0, 0, 0)", "#fff", ""]) {
      expect(isLight(overlayColors(color, true).symbolColor)).toBe(true);
      expect(isLight(overlayColors(color, false).symbolColor)).toBe(false);
    }
  });

  it("keeps the background transparent whatever the page reports", () => {
    expect(overlayColors("#000000", false).color).toMatch(/^#[0-9a-f]{6}00$/i);
    expect(overlayColors("#ffffff", true).color).toMatch(/^#[0-9a-f]{6}00$/i);
  });
});
