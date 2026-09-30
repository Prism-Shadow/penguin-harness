/**
 * The package's own words (src/strings.ts): English fallbacks when no provider is mounted, the
 * app's words once it injects them, and nothing but accessibility strings in the interface.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { DEFAULT_UI_STRINGS, UiStringsProvider, useUiStrings } from "../src/strings";
import type { UiStrings } from "../src/strings";
import { renderStatic } from "../src/testing";

/** Renders every key the hook returns, so a test reads what a component would announce. */
function Probe() {
  const strings = useUiStrings();
  return createElement(
    "dl",
    null,
    Object.entries(strings).map(([key, value]) =>
      createElement("div", { key }, `${key}=${String(value)}`),
    ),
  );
}

describe("UiStrings", () => {
  it("holds the accessibility fallbacks, in English", () => {
    expect(Object.keys(DEFAULT_UI_STRINGS).sort()).toEqual([
      "clearSearch",
      "close",
      "copied",
      "hidePassword",
      "loading",
      "moreInfo",
      "moreInfoAbout",
      "showPassword",
    ]);
    expect(DEFAULT_UI_STRINGS).toMatchObject({
      close: "Close",
      copied: "Copied",
      loading: "Loading…",
      showPassword: "Show password",
      hidePassword: "Hide password",
      clearSearch: "Clear search",
      moreInfo: "More info",
    });
    // The one formatter: the subject folds into the name, keeping "More info" its prefix.
    expect(DEFAULT_UI_STRINGS.moreInfoAbout("Vault")).toBe("More info: Vault");
  });

  it("falls back to the defaults when no provider is mounted", () => {
    const html = renderStatic(createElement(Probe));
    expect(html).toContain("close=Close");
    expect(html).toContain("loading=Loading…");
  });

  it("reads the nearest provider's words", () => {
    const zh: UiStrings = {
      ...DEFAULT_UI_STRINGS,
      close: "关闭",
      copied: "已复制",
      loading: "加载中…",
    };
    const html = renderStatic(
      createElement(UiStringsProvider, { strings: zh }, createElement(Probe)),
    );
    expect(html).toContain("close=关闭");
    expect(html).toContain("copied=已复制");
    expect(html).not.toContain("Close");
  });
});
