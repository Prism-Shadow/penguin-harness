/**
 * The text size is real, and only the framed app and the boards follow it.
 *
 * - Given a text size, the package's own `applyThemeAttributes` writes it onto `<html>` as that
 *   step's pixel size.
 * - Given a size and a font pairing, every framed app receives them as `size=`, `latin=` and
 *   `cjk=` in its own URL.
 * - Given a pairing, it is named as the app names it; the theme's and the platform's faces are
 *   named in the caller's words.
 * - Given the chrome's stylesheet, it sets no rem or em length, so a px-sized chrome cannot move
 *   when the root does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyThemeAttributes,
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  TEXT_SIZE_PX,
} from "@prismshadow/penguin-ui/boot";
import { appFrameSrc } from "../src/app/frame";
import { TEXT_SIZES, fontLabel } from "../src/lib/themes";
import { DEFAULT_STATE } from "../src/lib/url-state";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** A root as `applyThemeAttributes` sees it: a class list, a dataset and an inline style. */
function fakeRoot() {
  const classes = new Set<string>();
  return {
    classList: {
      toggle: (name: string, force?: boolean) => {
        if (force ?? !classes.has(name)) classes.add(name);
        else classes.delete(name);
        return classes.has(name);
      },
    },
    dataset: {} as Record<string, string | undefined>,
    style: {} as Record<string, string>,
  } as unknown as HTMLElement;
}

describe("the text size", () => {
  it("is written onto <html> by the package's own contract, per step", () => {
    const root = fakeRoot();
    for (const size of TEXT_SIZES) {
      applyThemeAttributes(root, { textSize: size });
      expect(root.style.fontSize).toBe(TEXT_SIZE_PX[size]);
    }
  });

  it("reaches every framed app through `size=`, `latin=` and `cjk=` in its own URL", () => {
    for (const size of TEXT_SIZES) {
      const src = appFrameSrc(
        "",
        { ...DEFAULT_STATE, size, latin: "misans", cjk: "noto-sans-sc" },
        { route: "/chat" },
      );
      expect(src).toContain(`size=${size}`);
      expect(src).toContain("latin=misans");
      expect(src).toContain("cjk=noto-sans-sc");
    }
  });

  it("names a pairing as the app names it, and the theme's and the platform's in the caller's words", () => {
    const words = { theme: "By theme", system: "Platform" };
    expect(fontLabel("theme", words)).toBe("By theme");
    expect(fontLabel("system", words)).toBe("Platform");
    for (const option of [...FONT_LATIN_OPTIONS, ...FONT_CJK_OPTIONS]) {
      if (option.id === "theme" || option.id === "system") continue;
      expect(fontLabel(option.id, words)).toBe(option.label);
    }
  });

  it("never moves the chrome: chrome.css sets no rem or em length", () => {
    const css = read("../src/chrome.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const relative = [...css.matchAll(/-?\d*\.?\d+r?em\b/g)].map((m) => m[0]);
    expect(relative).toEqual([]);
    // The boards are the one place on a gallery page the root size may show, and they read the
    // theme's own rem-based body size rather than a chrome value.
    expect(css).toMatch(/\.g-preview \{[^}]*font-size: var\(--ui-text-body-size/s);
  });
});
