/**
 * The shape of main.ts's window-open handling, read from the source.
 *
 * main.ts imports Electron and cannot be loaded under vitest, and the rule it has to keep is
 * structural: every request to open a window, from the main window or from any window it
 * opened, is answered by the one function that applies classifyWindowOpen, and the one place
 * that allows a window pins what a page's feature string could hide (APP_WINDOW_OPTIONS).
 * The gap this guards was an exception in the main window's own handler — a hidden
 * `about:blank` window allowed before classification — which HTML previewed in the Files
 * panel could claim, because the handler is not told which frame asked. A second `allow`, or
 * a handler that does not delegate, is that exception coming back.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MAIN_TS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "main.ts");
const source = fs.readFileSync(MAIN_TS, "utf8");

/** Occurrences of a pattern in main.ts. */
function count(pattern: RegExp): number {
  return source.match(new RegExp(pattern.source, `${pattern.flags}g`))?.length ?? 0;
}

describe("main.ts window-open handling", () => {
  it("allows a window in exactly one place, and that place is openWindowFor", () => {
    expect(count(/action:\s*"allow"/)).toBe(1);
    const openWindowFor = /function openWindowFor\([\s\S]*?\n\}/.exec(source)?.[0];
    expect(openWindowFor).toBeDefined();
    expect(openWindowFor).toMatch(/action:\s*"allow"/);
    expect(openWindowFor).toMatch(/classifyWindowOpen\(target, appOrigin\)/);
  });

  it("answers every window's requests through openWindowFor — the main window's too", () => {
    // One handler for the main window, one for each window it opens (guardOpenedWindow).
    // Both delegate; neither decides anything of its own first.
    expect(count(/setWindowOpenHandler\(/)).toBe(2);
    expect(
      count(/setWindowOpenHandler\(\(\{ url: target \}\) => openWindowFor\(target, iconPath\)\)/),
    ).toBe(2);
  });

  it("pins the page-controllable window options in the one allow", () => {
    const override = /overrideBrowserWindowOptions:\s*\{[\s\S]*?\n\s*\},/.exec(source)?.[0];
    expect(override).toBeDefined();
    // Spread last, so nothing above it in the literal wins over the pinned keys.
    expect(override).toMatch(/\.\.\.APP_WINDOW_OPTIONS,\s*\},$/);
    // A feature-string key spelled out here would be one the constant no longer governs.
    for (const key of ["show", "skipTaskbar", "opacity", "width", "height"]) {
      expect(override, key).not.toMatch(new RegExp(`\\b${key}:`));
    }
  });

  it("keeps an opened window on screen: centered, and deaf to the page's moveTo/resizeTo", () => {
    const guard = /function guardOpenedWindow\([\s\S]*?\n\}/.exec(source)?.[0];
    expect(guard).toBeDefined();
    expect(guard).toMatch(/child\.center\(\)/);
    // A WebContents event, not a window one: the request comes from the page.
    expect(guard).toMatch(
      /child\.webContents\.on\("content-bounds-updated", \(event\) => event\.preventDefault\(\)\)/,
    );
  });
});
