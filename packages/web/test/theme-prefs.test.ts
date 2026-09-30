/**
 * The appearance preferences: what a stored value reads back as (theme, accent, text size with
 * the legacy migration, font pairing), what they put on <html>, and the Appearance section's
 * shape. The web suite runs in node with no DOM, so the root is a small fake that answers both
 * the `dataset` and the attribute API, and the section is checked as source.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ACCENT_PRESET_IDS, THEME_IDS } from "@prismshadow/penguin-ui";
import {
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  TEXT_SIZES,
  THEME_STORAGE_KEYS,
  applyThemeAttributes,
} from "@prismshadow/penguin-ui/boot";
import { effectiveAccent, readThemePrefs } from "../src/state/theme-prefs";
import type { PrefStorage } from "../src/state/theme-prefs";
import { fontChoices } from "../src/features/settings/appearance-section";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(zh));

/** The three-step size of earlier releases, spelled out: it is on disk whatever the code calls it. */
const LEGACY_TEXT_SIZE_KEY = "penguin.fontScale";

function memStorage(entries: Record<string, string> = {}): PrefStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** An <html> stand-in: attributes behind both `dataset` and get/set/removeAttribute. */
function fakeRoot() {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const attrOf = (key: string) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
  const dataset = new Proxy({} as Record<string, string>, {
    get: (_, key) => (typeof key === "string" ? attrs.get(attrOf(key)) : undefined),
    set: (_, key, value) => {
      attrs.set(attrOf(String(key)), String(value));
      return true;
    },
    deleteProperty: (_, key) => {
      attrs.delete(attrOf(String(key)));
      return true;
    },
    has: (_, key) => attrs.has(attrOf(String(key))),
  });
  const style: Record<string, unknown> = {
    fontSize: "",
    setProperty: (name: string, value: string) => void (style[name] = value),
    removeProperty: (name: string) => void delete style[name],
  };
  const root = {
    dataset,
    style,
    classList: {
      toggle: (name: string, on?: boolean) => {
        const next = on ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
        return next;
      },
      add: (name: string) => void classes.add(name),
      remove: (name: string) => void classes.delete(name),
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
    removeAttribute: (name: string) => void attrs.delete(name),
    getAttribute: (name: string) => attrs.get(name) ?? null,
    hasAttribute: (name: string) => attrs.has(name),
  };
  return { root: root as unknown as HTMLElement, attrs, style };
}

describe("reading the stored appearance", () => {
  it("falls back to the defaults on an empty store: Primer, its own accent, 16px, its own faces", () => {
    expect(readThemePrefs(memStorage())).toEqual({
      themeId: "github",
      accent: "neutral",
      textSize: "m",
      fontLatin: "theme",
      fontCjk: "theme",
    });
  });

  it("migrates the three-step font scale by pixels, once, and drops the old key", () => {
    for (const [legacy, size] of [
      ["sm", "m"],
      ["md", "l"],
      ["lg", "xl"],
    ] as const) {
      const storage = memStorage({ [LEGACY_TEXT_SIZE_KEY]: legacy });
      expect(readThemePrefs(storage).textSize).toBe(size);
      expect(storage.map.get(THEME_STORAGE_KEYS.textSize)).toBe(size);
      expect(storage.map.has(LEGACY_TEXT_SIZE_KEY)).toBe(false);
      // The second read is a plain lookup of what the first one wrote.
      expect(readThemePrefs(storage).textSize).toBe(size);
    }
  });

  it("keeps a stored text size and reads anything unknown as the default", () => {
    for (const size of TEXT_SIZES) {
      expect(readThemePrefs(memStorage({ [THEME_STORAGE_KEYS.textSize]: size })).textSize).toBe(
        size,
      );
    }
    expect(readThemePrefs(memStorage({ [THEME_STORAGE_KEYS.textSize]: "huge" })).textSize).toBe(
      "m",
    );
  });

  it("validates the theme and the font faces against the package's lists", () => {
    const storage = memStorage({
      [THEME_STORAGE_KEYS.themeId]: "geek",
      [THEME_STORAGE_KEYS.fontLatin]: FONT_LATIN_OPTIONS.at(-1)!.id,
      [THEME_STORAGE_KEYS.fontCjk]: "comic-sans",
    });
    const prefs = readThemePrefs(storage);
    expect(prefs.themeId).toBe("geek");
    expect(prefs.fontLatin).toBe(FONT_LATIN_OPTIONS.at(-1)!.id);
    expect(prefs.fontCjk).toBe("theme");
    expect(readThemePrefs(memStorage({ [THEME_STORAGE_KEYS.themeId]: "neon" })).themeId).toBe(
      "github",
    );
  });

  it("keeps another theme's accent as stored, and marks the theme's own in effect", () => {
    const prefs = readThemePrefs(memStorage({ [THEME_STORAGE_KEYS.accent]: "ocean" }));
    expect(prefs.accent).toBe("ocean");
    expect(effectiveAccent("modern", prefs.accent)).toBe("ocean");
    expect(effectiveAccent("github", prefs.accent)).toBe("neutral");
    expect(effectiveAccent("github", "blue")).toBe("blue");
  });
});

describe("the attributes the preferences put on <html>", () => {
  it("names a chosen face on the root and leaves the theme's own as no attribute", () => {
    const { root, attrs, style } = fakeRoot();
    const latin = FONT_LATIN_OPTIONS.find((option) => option.id !== "theme")!.id;
    const cjk = FONT_CJK_OPTIONS.find((option) => option.id !== "theme")!.id;
    applyThemeAttributes(root, {
      ...readThemePrefs(memStorage()),
      fontLatin: latin,
      fontCjk: cjk,
      textSize: "xl",
    });
    expect(attrs.get("data-font-latin")).toBe(latin);
    expect(attrs.get("data-font-cjk")).toBe(cjk);
    expect(attrs.has("data-theme")).toBe(false);
    expect(style.fontSize).toBe("20px");

    applyThemeAttributes(root, { fontLatin: "theme", fontCjk: "theme", themeId: "modern" });
    expect(attrs.has("data-font-latin")).toBe(false);
    expect(attrs.has("data-font-cjk")).toBe(false);
    expect(attrs.get("data-theme")).toBe("modern");
  });
});

describe("the Appearance section", () => {
  const source = fs.readFileSync(
    fileURLToPath(new URL("../src/features/settings/appearance-section.tsx", import.meta.url)),
    "utf8",
  );

  it("offers theme, mode, accent, text size and fonts first, in that order", () => {
    const order = [
      "S.settings.theme}",
      "S.settings.colorMode}",
      "S.settings.accent}",
      "S.settings.fontSize}",
      "S.settings.fonts}",
      "S.settings.terminalTheme}",
    ].map((label) => source.indexOf(`label={${label}`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("builds every choice from the package's lists, and the swatches from the active theme", () => {
    expect(source).toContain("THEME_IDS.map");
    expect(source).toContain("TEXT_SIZES.map");
    expect(source).toContain("cols={5}");
    expect(source).toContain("fontChoices(FONT_LATIN_OPTIONS)");
    expect(source).toContain("fontChoices(FONT_CJK_OPTIONS)");
    expect(source).toContain("effectiveAccent(themeId, accent)");
  });

  it("names every theme, text size and accent preset in both languages", () => {
    for (const dict of [zh, en]) {
      for (const id of THEME_IDS) expect(dict.settings.themeNames[id]).toBeTruthy();
      for (const size of TEXT_SIZES) expect(dict.settings.textSizeNames[size]).toBeTruthy();
      for (const id of ["neutral", ...ACCENT_PRESET_IDS]) {
        expect(dict.settings.accentNames[id], id).toBeTruthy();
      }
    }
  });

  it("puts the theme's own face first, once, and words the non-names from the dictionary", () => {
    setActiveStrings(en);
    for (const options of [FONT_LATIN_OPTIONS, FONT_CJK_OPTIONS]) {
      const choices = fontChoices(options);
      expect(choices[0]).toEqual({ value: "theme", label: en.settings.fontFollowTheme });
      expect(choices.filter((choice) => choice.value === "theme")).toHaveLength(1);
      const system = choices.find((choice) => choice.value === "system");
      if (system !== undefined) expect(system.label).toBe(en.settings.fontSystem);
    }
  });
});
