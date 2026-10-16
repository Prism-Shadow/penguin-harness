/**
 * The rescue surface (src/rescue/): what is left on screen when the shell's tree cannot be drawn.
 *
 * - The root boundary draws the rescue panel once a descendant has thrown, and the children
 *   otherwise; the panel names the error and offers a reload, a reload without contributions
 *   and the harness history, in both languages, and says so instead of offering the safe
 *   reload when the error happened in safe mode.
 * - A module tree that failed to boot mounts the same panel with the boot error.
 * - Safe mode: `?safe` enters it and leaves the address without the parameter; the switch is
 *   kept in sessionStorage and still works in memory when storage throws; the marker shows
 *   only while it is on.
 *
 * This package's vitest is node-only (no DOM), and the server renderer does not run error
 * boundaries, so the boundary is driven through its own static and render methods; the
 * palette opening over the panel is covered by the dispatcher test (the chord runs over an
 * open dialog) and end to end by e2e/rescue.spec.mjs.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../src/rescue/error-boundary";
import { bootFailedRoot, RescuePanel } from "../src/rescue/rescue-panel";
import { adoptSafeModeParam, isSafeMode, setSafeMode } from "../src/rescue/safe-mode";
import { SafeModeMarker } from "../src/rescue/safe-mode-marker";
import { setHostForTests, setPlatformForTests } from "../src/lib/shortcuts/platform";
import { configureKeybindingsStoreForTests } from "../src/lib/shortcuts/store";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { blockedStorage, memoryStorage } from "./helpers/storage";

const panel = (error: unknown): ReactNode => createElement(RescuePanel, { error });

/** What the boundary draws after `error` was thrown below it. */
function afterThrow(error: unknown): string {
  const boundary = new ErrorBoundary({ fallback: panel, children: createElement("p") });
  boundary.state = ErrorBoundary.getDerivedStateFromError(error);
  return renderToStaticMarkup(createElement("div", null, boundary.render()));
}

beforeEach(() => {
  setPlatformForTests("linux");
  setHostForTests("browser");
  configureKeybindingsStoreForTests({ storage: memoryStorage(), layout: null });
});

afterEach(() => {
  setSafeMode(false);
  setActiveStrings(zh);
  setPlatformForTests(null);
  setHostForTests(null);
  configureKeybindingsStoreForTests({ storage: null, layout: null });
});

describe("ErrorBoundary", () => {
  it("draws its children until something below it throws", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, { fallback: panel, children: createElement("p", null, "fine") }),
    );
    expect(html).toBe("<p>fine</p>");
  });

  it("draws the rescue panel for a throwing child, in both languages", () => {
    for (const dict of [zh, en]) {
      setActiveStrings(dict);
      const html = afterThrow(new Error("a page blew up"));
      expect(html).toContain('role="alert"');
      expect(html).toContain("a page blew up");
      expect(html).toContain(dict.rescue.title);
      expect(html).toContain(dict.rescue.reload);
      expect(html).toContain(dict.rescue.reloadSafe);
      expect(html).toContain(dict.commandPalette.harnessHistory);
      // The palette's chord is spelled out: it still opens over the panel.
      expect(html).toContain(dict.rescue.paletteHint("Ctrl+Shift+P"));
    }
  });

  it("names a thrown non-Error too", () => {
    expect(afterThrow("plain string")).toContain("plain string");
  });

  it("in safe mode says the error is the app's own instead of offering the safe reload", () => {
    setSafeMode(true);
    const html = afterThrow(new Error("boom"));
    expect(html).toContain(zh.rescue.safeNote);
    expect(html).not.toContain(zh.rescue.reloadSafe);
    expect(html).toContain(zh.rescue.reload);
  });
});

describe("bootFailedRoot", () => {
  it("draws the panel with the boot error", () => {
    const Root = bootFailedRoot(new Error("manifest mismatch"));
    const html = renderToStaticMarkup(createElement(Root));
    expect(html).toContain("manifest mismatch");
    expect(html).toContain(zh.rescue.reloadSafe);
  });
});

describe("safe mode", () => {
  it("?safe enters it and drops the parameter from the address, keeping the rest", () => {
    const replaceState = vi.fn();
    adoptSafeModeParam(
      { href: "http://localhost:5173/agents?safe&tab=2#top" },
      { state: { idx: 3 }, replaceState },
    );
    expect(isSafeMode()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({ idx: 3 }, "", "/agents?tab=2#top");
  });

  it("an address without ?safe changes nothing", () => {
    const replaceState = vi.fn();
    adoptSafeModeParam(
      { href: "http://localhost:5173/agents?tab=2" },
      { state: null, replaceState },
    );
    expect(isSafeMode()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("is kept in sessionStorage, so it survives a reload of the tab", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    setSafeMode(true);
    expect(storage.map.get("penguin.safeMode")).toBe("1");
    setSafeMode(false);
    expect(storage.map.has("penguin.safeMode")).toBe(false);
  });

  it("still switches in memory when storage throws", () => {
    vi.stubGlobal("sessionStorage", blockedStorage());
    setSafeMode(true);
    expect(isSafeMode()).toBe(true);
    setSafeMode(false);
    expect(isSafeMode()).toBe(false);
  });

  it("the marker shows only while it is on, with its way out", () => {
    expect(renderToStaticMarkup(createElement(SafeModeMarker))).toBe("");
    setSafeMode(true);
    const html = renderToStaticMarkup(createElement(SafeModeMarker));
    expect(html).toContain(zh.rescue.marker);
    expect(html).toContain(zh.rescue.leave);
  });
});
