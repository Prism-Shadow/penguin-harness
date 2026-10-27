import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ErrorBoundary } from "../src/rescue/error-boundary";
import { RescuePanel } from "../src/rescue/rescue-panel";
import { setSafeMode } from "../src/rescue/safe-mode";
import { setPlatformForTests } from "../src/lib/shortcuts/platform";
import { configureKeybindingsStoreForTests } from "../src/lib/shortcuts/store";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { memoryStorage } from "./helpers/storage";

beforeEach(() => {
  setPlatformForTests("linux");
  configureKeybindingsStoreForTests({ storage: memoryStorage(), layout: null });
});
afterEach(() => {
  setSafeMode(false);
  setActiveStrings(zh);
  setPlatformForTests(null);
  configureKeybindingsStoreForTests({ storage: null, layout: null });
});

describe("render recovery", () => {
  it("renders healthy children without the fallback", () => {
    const html = renderToStaticMarkup(
      createElement(ErrorBoundary, {
        fallback: () => createElement("p", null, "failed"),
        children: createElement("p", null, "healthy"),
      }),
    );
    expect(html).toBe("<p>healthy</p>");
  });
  it("renders reload and history with the safe-mode escape", () => {
    for (const dictionary of [zh, en]) {
      setActiveStrings(dictionary);
      const html = renderToStaticMarkup(
        createElement(RescuePanel, { error: new Error("render failed") }),
      );
      expect(html).toContain('role="alert"');
      expect(html).toContain("render failed");
      expect(html).toContain(dictionary.rescue.reload);
      expect(html).toContain(dictionary.commandPalette.harnessHistory);
      expect(html).toContain(dictionary.rescue.reloadSafe);
    }
  });
  it("records the thrown error for the client boundary fallback", () => {
    const error = new Error("client failure");
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ failed: true, error });
  });
});
