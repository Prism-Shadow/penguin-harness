/**
 * The text size is real, and only the framed app and the boards follow it. The gallery's vitest
 * is node-only, so the proof is the source contract, each link of it: the size control writes
 * `<html style="font-size">` through the package's own `applyThemeAttributes` (which the app's
 * boot script and theme provider also use), the five sizes are 14 / 15 / 16 / 18 / 20 px and
 * the top bar names them, every frame takes the same `size=` (and the font pairing) in its own
 * URL, and the chrome's stylesheet has no rem or em in it — a px-sized chrome cannot move when
 * the root does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyThemeAttributes,
  DEFAULT_TEXT_SIZE,
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  TEXT_SIZE_PX,
} from "@prismshadow/penguin-ui/boot";
import { appFrameSrc } from "../src/app/frame";
import {
  CJK_FONTS,
  LATIN_FONTS,
  TEXT_SIZE_PX_NUMBER,
  TEXT_SIZES,
  fontLabel,
} from "../src/lib/themes";
import { DEFAULT_STATE } from "../src/lib/url-state";
import { zh } from "../src/strings";
import { en } from "../src/strings-en";

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
  it("has five real steps, 14 / 15 / 16 / 18 / 20 px, opening on 16", () => {
    expect(TEXT_SIZES).toEqual(["xs", "s", "m", "l", "xl"]);
    expect(TEXT_SIZES.map((size) => TEXT_SIZE_PX_NUMBER[size])).toEqual([14, 15, 16, 18, 20]);
    for (const size of TEXT_SIZES)
      expect(TEXT_SIZE_PX[size]).toBe(`${TEXT_SIZE_PX_NUMBER[size]}px`);
    expect(DEFAULT_STATE.size).toBe(DEFAULT_TEXT_SIZE);
    // Both dictionaries name every step.
    for (const size of TEXT_SIZES) {
      expect(zh.rail.sizeNames[size].trim()).not.toBe("");
      expect(en.rail.sizeNames[size].trim()).not.toBe("");
    }
  });

  it("is written onto <html> by the package's own contract, per step", () => {
    const root = fakeRoot();
    for (const size of TEXT_SIZES) {
      applyThemeAttributes(root, { textSize: size });
      expect(root.style.fontSize).toBe(TEXT_SIZE_PX[size]);
    }
    // The provider applies the state's size and pairing through that same function.
    const state = read("../src/state.tsx");
    expect(state).toMatch(/applyThemeAttributes\(root, \{[^}]*textSize: state\.size/s);
    expect(state).toMatch(/fontLatin: state\.latin/);
    expect(state).toMatch(/fontCjk: state\.cjk/);
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
    // The frames' src is built by that one function, never by hand.
    expect(read("../src/chrome/app-frame.tsx")).toMatch(/appFrameSrc\(/);
  });

  it("offers the app's own font pairings, named as the app names them", () => {
    expect(LATIN_FONTS).toEqual(FONT_LATIN_OPTIONS.map((option) => option.id));
    expect(CJK_FONTS).toEqual(FONT_CJK_OPTIONS.map((option) => option.id));
    expect(LATIN_FONTS[0]).toBe("theme");
    const words = { theme: zh.rail.fontTheme, system: zh.rail.fontSystem };
    expect(fontLabel("theme", words)).toBe("随主题");
    expect(fontLabel("system", words)).toBe("系统");
    expect(fontLabel("mona-sans", words)).toBe("Mona Sans");
    expect(fontLabel("noto-sans-sc", words)).toBe("Noto Sans SC");
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
