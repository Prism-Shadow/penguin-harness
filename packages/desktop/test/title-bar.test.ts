/**
 * The main window's title bar: which system chrome each platform keeps, and the band the shell
 * gives a page that draws none of its own.
 *
 * - Given macOS, when the window is built, the traffic lights stay, inset into the band, and the
 *   Window Controls Overlay is on at the band's height, so the page can read the band from it.
 * - Given Windows or Linux, when the window is built, the system draws no control and no overlay:
 *   the page draws minimize, maximize and close itself.
 * - Given Windows or Linux, a page whose root lacks `data-window-controls` is moved down by the
 *   band's height under a band that drags the window, with minimize, maximize and close at its
 *   right end that do not drag it; a page that declares the attribute is left alone.
 * - Given macOS, the fallback band draws no button (the traffic lights are the system's), and it
 *   also leaves alone a page that reserves the overlay's band itself (`data-titlebar-area`) —
 *   which it must not do on Windows or Linux, where that band no longer exists.
 */
import { describe, expect, it } from "vitest";
import {
  FALLBACK_BAND_ATTRIBUTE,
  TITLE_BAR_HEIGHT,
  fallbackBand,
  titleBarWindowOptions,
} from "../src/title-bar.js";

/** The fallback stylesheet's rules, as selector → declarations. */
function rules(css: string): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
    selector: m[1]!.trim(),
    body: m[2]!,
  }));
}

/** The rules that change what the page looks like: anything but the hidden default. */
function visibleRules(css: string) {
  return rules(css).filter((rule) => !/^\s*display:\s*none;\s*$/.test(rule.body));
}

describe("titleBarWindowOptions", () => {
  it("keeps the macOS traffic lights inset into the band, with the overlay at its height", () => {
    expect(titleBarWindowOptions("darwin")).toEqual({
      titleBarStyle: "hiddenInset",
      titleBarOverlay: { height: TITLE_BAR_HEIGHT },
    });
  });

  it.each(["win32", "linux"] as const)(
    "leaves %s with no system control and no overlay: the page draws them",
    (platform) => {
      const options = titleBarWindowOptions(platform);
      expect(options.titleBarStyle).toBe("hidden");
      expect(options).not.toHaveProperty("titleBarOverlay");
    },
  );
});

describe("fallbackBand", () => {
  it.each(["win32", "linux"] as const)(
    "on %s, moves a page without its own band down and draws one that drags the window",
    (platform) => {
      const { css } = fallbackBand(platform);
      const visible = visibleRules(css);
      // Nothing shows on a page that draws its own band, nor on one that is already laid out
      // below the overlay — every rule that paints is scoped to a root without the attribute.
      for (const rule of visible.filter((r) => !r.selector.includes("> button"))) {
        expect(rule.selector).toMatch(/^:root:not\(\[data-window-controls\]\)/);
        expect(rule.selector).not.toContain("data-titlebar-area");
      }
      const body = visible.find((r) => r.selector.endsWith(" body"));
      expect(body?.body).toContain(`padding-top: ${TITLE_BAR_HEIGHT}px`);
      const band = visible.find((r) => r.selector.endsWith(`> [${FALLBACK_BAND_ATTRIBUTE}]`));
      expect(band?.body).toContain(`height: ${TITLE_BAR_HEIGHT}px`);
      expect(band?.body).toMatch(/(?:^|\s)app-region: drag/);
      const buttons = rules(css).find(
        (r) => r.selector === `[${FALLBACK_BAND_ATTRIBUTE}] > button`,
      );
      expect(buttons?.body).toMatch(/(?:^|\s)app-region: no-drag/);
    },
  );

  it.each(["win32", "linux"] as const)(
    "on %s, puts minimize, maximize and close at the band's right end, each named",
    (platform) => {
      const { buttons } = fallbackBand(platform);
      expect(buttons.map((b) => b.action)).toEqual(["minimize", "toggleMaximize", "close"]);
      for (const button of buttons) {
        expect(button.label).not.toBe("");
        expect(button.path).not.toBe("");
      }
    },
  );

  it("on macOS, draws no button and leaves a page that reserves the overlay's band alone", () => {
    const { css, buttons } = fallbackBand("darwin");
    expect(buttons).toEqual([]);
    for (const rule of visibleRules(css).filter((r) => !r.selector.includes("> button"))) {
      expect(rule.selector).toMatch(
        /^:root:not\(\[data-window-controls\]\):not\(\[data-titlebar-area\]\)/,
      );
    }
  });
});
