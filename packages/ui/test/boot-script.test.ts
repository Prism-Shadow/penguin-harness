/**
 * The pre-paint script (src/boot.ts).
 *
 * It exists twice: as `BOOT_SCRIPT`, generated from the same constants the app's theme provider
 * reads, and pasted inline into `packages/web/index.html`, where it runs before the bundle loads.
 * Two things break silently and only on a reload: the pasted copy falling behind the constants (a
 * new theme id that paints the default theme for one frame, then snaps), and the script disagreeing
 * with `applyThemeAttributes` / `readTextSize` about a stored value (the first frame and the second
 * frame differ, or the text-size migration writes something the provider would not). Both are held
 * here — the copy byte for byte, the behaviour by running the script against a fake document and a
 * fake store for every combination of stored preferences and comparing the root AND the store
 * afterwards with what the provider's path produces.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Script, createContext, runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  BOOT_SCRIPT,
  DEFAULT_TEXT_SIZE,
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  TEXT_SIZES,
  TEXT_SIZE_PX,
  THEME_STORAGE_KEYS,
  applyThemeAttributes,
  isFontCjk,
  isFontLatin,
  readTextSize,
} from "../src/boot";
import type { AccentChoice } from "../src/boot";
import {
  ACCENT_PRESET_IDS,
  DEFAULT_THEME_ID,
  THEME_ACCENT_PRESETS,
  THEME_IDS,
} from "../src/tokens";
import type { ThemeId } from "../src/tokens";
import { WEB_DIR } from "./helpers/paths";

/** The attributes the script and the provider write, captured from a stand-in `<html>`. */
interface FakeRoot {
  classList: { add(name: string): void; toggle(name: string, on: boolean): void };
  dataset: Record<string, string | undefined>;
  style: { fontSize?: string };
  classes: Set<string>;
}

function fakeRoot(): FakeRoot {
  const classes = new Set<string>();
  return {
    classes,
    classList: {
      add: (name) => void classes.add(name),
      toggle: (name, on) => void (on ? classes.add(name) : classes.delete(name)),
    },
    dataset: {},
    style: {},
  };
}

/** A `localStorage` stand-in over a Map, so what a run wrote or removed can be read back. */
function fakeStorage(stored: Record<string, string | null>, throwing = false) {
  const map = new Map(
    Object.entries(stored).filter((entry): entry is [string, string] => entry[1] !== null),
  );
  return {
    map,
    getItem(key: string) {
      if (throwing) throw new Error("storage is disabled");
      return map.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (throwing) throw new Error("storage is disabled");
      map.set(key, value);
    },
    removeItem(key: string) {
      if (throwing) throw new Error("storage is disabled");
      map.delete(key);
    },
  };
}

const snapshot = (root: FakeRoot, storage: { map: Map<string, string> }) => ({
  dark: root.classes.has("dark"),
  theme: root.dataset.theme,
  accent: root.dataset.accent,
  fontLatin: root.dataset.fontLatin,
  fontCjk: root.dataset.fontCjk,
  fontSize: root.style.fontSize,
  stored: Object.fromEntries([...storage.map].sort()),
});

/**
 * One compiled script in one context, re-pointed at a fresh root and store per run: the sweep
 * below runs it tens of thousands of times, and a new context per run would cost seconds. (The
 * script leaks no global — a case below holds that — so runs cannot see each other.)
 */
const compiled = new Script(BOOT_SCRIPT);
const context = createContext({ document: {}, localStorage: {}, matchMedia: () => ({}) });

/** Runs the script against the given storage and system preference. */
function runBoot(stored: Record<string, string | null>, systemDark: boolean, throwing = false) {
  const root = fakeRoot();
  const localStorage = fakeStorage(stored, throwing);
  context.document = { documentElement: root };
  context.localStorage = localStorage;
  context.matchMedia = (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && systemDark,
  });
  compiled.runInContext(context);
  return snapshot(root, localStorage);
}

/**
 * What the provider resolves the same stored values to, written from the stored-preference rules
 * rather than from the script: an unknown mode means "system", an unknown theme id the default
 * theme, an unknown accent `neutral`, an unknown face the theme's own, and the text size is what
 * `readTextSize` says (the legacy scale mapped and migrated on the way). A preset any theme lists
 * is written to the root whichever theme is active — the theme files scope their presets to
 * their own root, so an unlisted one paints nothing and comes back with its theme.
 */
function viaProvider(stored: Record<string, string | null>, systemDark: boolean) {
  const mode = stored[THEME_STORAGE_KEYS.mode];
  const themeId = stored[THEME_STORAGE_KEYS.themeId];
  const accent = stored[THEME_STORAGE_KEYS.accent];
  const latin = stored[THEME_STORAGE_KEYS.fontLatin];
  const cjk = stored[THEME_STORAGE_KEYS.fontCjk];
  const storage = fakeStorage(stored);
  const root = fakeRoot();
  applyThemeAttributes(root as unknown as HTMLElement, {
    dark: mode === "dark" || (mode !== "light" && systemDark),
    themeId: (THEME_IDS as readonly (string | null | undefined)[]).includes(themeId)
      ? (themeId as ThemeId)
      : DEFAULT_THEME_ID,
    accent: (ACCENT_PRESET_IDS as readonly (string | null | undefined)[]).includes(accent)
      ? (accent as AccentChoice)
      : "neutral",
    textSize: readTextSize(storage),
    fontLatin: isFontLatin(latin) ? latin : "theme",
    fontCjk: isFontCjk(cjk) ? cjk : "theme",
  });
  return snapshot(root, storage);
}

describe("BOOT_SCRIPT", () => {
  it("paints what the provider will, and leaves the store as the provider does, for every combination", () => {
    const modes = [null, "light", "dark", "sepia"];
    const themes = [null, ...THEME_IDS, "retro"];
    // One preset of each theme's list, so a Frost preset stored under Primer is exercised too.
    const accents = [null, "neutral", ...THEME_IDS.map((id) => THEME_ACCENT_PRESETS[id][0]!)];
    // Stored sizes and the retired scale beside them: absent, valid, junk, and the names of
    // Object.prototype members, which a map lookup would find and an array lookup does not.
    const sizes = [null, "xs", "m", "huge", "toString"];
    const legacy = [null, "sm", "md", "lg", "xl", "hasOwnProperty"];
    const latins = [null, "theme", "misans", "comic-sans"];
    const cjks = [null, "noto-sans-sc", "valueOf"];
    const mismatches: string[] = [];
    let cases = 0;
    for (const mode of modes)
      for (const themeId of themes)
        for (const accent of accents)
          for (const size of sizes)
            for (const scale of legacy)
              for (const latin of latins)
                for (const cjk of cjks)
                  for (const systemDark of [false, true]) {
                    const stored = {
                      [THEME_STORAGE_KEYS.mode]: mode,
                      [THEME_STORAGE_KEYS.themeId]: themeId,
                      [THEME_STORAGE_KEYS.accent]: accent,
                      [THEME_STORAGE_KEYS.textSize]: size,
                      [THEME_STORAGE_KEYS.fontScale]: scale,
                      [THEME_STORAGE_KEYS.fontLatin]: latin,
                      [THEME_STORAGE_KEYS.fontCjk]: cjk,
                    };
                    cases++;
                    const boot = runBoot(stored, systemDark);
                    const provider = viaProvider(stored, systemDark);
                    if (JSON.stringify(boot) !== JSON.stringify(provider)) {
                      mismatches.push(
                        `${JSON.stringify(stored)} system=${systemDark ? "dark" : "light"}: ` +
                          `boot ${JSON.stringify(boot)} vs provider ${JSON.stringify(provider)}`,
                      );
                    }
                  }
    expect(cases).toBeGreaterThan(10_000);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("migrates the retired three-step scale by pixels, once, and drops its key", () => {
    // sm was 16px, md 18px, lg 20px: the size with the same pixels, written under the new key so
    // the next load is a plain read; a step the scale never had is dropped without a write.
    for (const [scale, size] of [
      ["sm", "m"],
      ["md", "l"],
      ["lg", "xl"],
    ] as const) {
      const painted = runBoot({ [THEME_STORAGE_KEYS.fontScale]: scale }, false);
      expect(painted.fontSize).toBe(TEXT_SIZE_PX[size]);
      expect(painted.stored).toEqual({ [THEME_STORAGE_KEYS.textSize]: size });
    }
    expect(runBoot({ [THEME_STORAGE_KEYS.fontScale]: "huge" }, false)).toMatchObject({
      fontSize: TEXT_SIZE_PX[DEFAULT_TEXT_SIZE],
      stored: {},
    });
    // A stored text size wins over a lingering old key, which is then left alone: nothing reads
    // it any more.
    const both = runBoot(
      { [THEME_STORAGE_KEYS.textSize]: "xs", [THEME_STORAGE_KEYS.fontScale]: "lg" },
      false,
    );
    expect(both.fontSize).toBe("14px");
    expect(both.stored).toEqual({
      [THEME_STORAGE_KEYS.textSize]: "xs",
      [THEME_STORAGE_KEYS.fontScale]: "lg",
    });
  });

  it("still paints the migrated size when the store reads but refuses writes", () => {
    const root = fakeRoot();
    const storage = fakeStorage({ [THEME_STORAGE_KEYS.fontScale]: "md" });
    storage.setItem = () => {
      throw new Error("quota");
    };
    context.document = { documentElement: root };
    context.localStorage = storage;
    context.matchMedia = () => ({ matches: false });
    compiled.runInContext(context);
    expect(root.style.fontSize).toBe("18px");
  });

  it("knows every preset every theme lists, and writes one under any theme", () => {
    // The script paints the first frame; a preset it did not know would snap in when the provider
    // mounts. And a preset stays on the root under a theme that does not list it: the theme
    // files, not the script, decide what it paints.
    for (const themeId of THEME_IDS) {
      for (const accent of THEME_ACCENT_PRESETS[themeId]) {
        for (const under of THEME_IDS) {
          const painted = runBoot(
            { [THEME_STORAGE_KEYS.themeId]: under, [THEME_STORAGE_KEYS.accent]: accent },
            false,
          );
          expect(painted.accent, `${accent} (${themeId}) under ${under}`).toBe(accent);
        }
      }
    }
    expect(ACCENT_PRESET_IDS.length).toBe(new Set(ACCENT_PRESET_IDS).size);
  });

  it("knows every face the pairing offers, and writes no attribute for the theme's own", () => {
    for (const option of FONT_LATIN_OPTIONS) {
      const painted = runBoot({ [THEME_STORAGE_KEYS.fontLatin]: option.id }, false);
      expect(painted.fontLatin).toBe(option.id === "theme" ? undefined : option.id);
    }
    for (const option of FONT_CJK_OPTIONS) {
      const painted = runBoot({ [THEME_STORAGE_KEYS.fontCjk]: option.id }, false);
      expect(painted.fontCjk).toBe(option.id === "theme" ? undefined : option.id);
    }
    // The lists open with the theme's own face and name only faces the app bundles.
    expect(FONT_LATIN_OPTIONS[0].id).toBe("theme");
    expect(FONT_CJK_OPTIONS[0].id).toBe("theme");
    for (const options of [FONT_LATIN_OPTIONS, FONT_CJK_OPTIONS]) {
      const ids = options.map((option) => option.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const option of options) expect(option.label).not.toBe("");
    }
  });

  it("renders the page untouched when storage throws, instead of throwing itself", () => {
    expect(() => runBoot({}, true, true)).not.toThrow();
    expect(runBoot({}, true, true)).toEqual({
      dark: false,
      theme: undefined,
      accent: undefined,
      fontLatin: undefined,
      fontCjk: undefined,
      fontSize: undefined,
      stored: {},
    });
  });

  it("leaves no global behind", () => {
    const context: Record<string, unknown> = {
      document: { documentElement: fakeRoot() },
      localStorage: fakeStorage({}),
      matchMedia: () => ({ matches: false }),
    };
    runInNewContext(BOOT_SCRIPT, context);
    expect(Object.keys(context).sort()).toEqual(["document", "localStorage", "matchMedia"]);
  });
});

describe("readTextSize", () => {
  it("reads a stored size, maps the retired scale once, and defaults otherwise", () => {
    for (const size of TEXT_SIZES) {
      expect(readTextSize(fakeStorage({ [THEME_STORAGE_KEYS.textSize]: size }))).toBe(size);
    }
    const migrated = fakeStorage({ [THEME_STORAGE_KEYS.fontScale]: "sm" });
    expect(readTextSize(migrated)).toBe("m");
    expect(migrated.map.get(THEME_STORAGE_KEYS.textSize)).toBe("m");
    expect(migrated.map.has(THEME_STORAGE_KEYS.fontScale)).toBe(false);
    expect(readTextSize(migrated)).toBe("m");
    expect(readTextSize(fakeStorage({}))).toBe(DEFAULT_TEXT_SIZE);
    expect(readTextSize(fakeStorage({ [THEME_STORAGE_KEYS.textSize]: "constructor" }))).toBe(
      DEFAULT_TEXT_SIZE,
    );
  });
});

describe("the inline copy in packages/web/index.html", () => {
  const indexHtml = join(WEB_DIR, "index.html");
  const html = readFileSync(indexHtml, "utf8");
  /** Inline classic scripts: no `src`, no `type="module"`. */
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type\s*=\s*["']module["']/.test(m[1]!))
    .map((m) => m[2]!.trim());

  it("reads the web app's index.html", () => {
    expect(existsSync(indexHtml)).toBe(true);
  });

  it("carries BOOT_SCRIPT verbatim, once", () => {
    const copies = inline.filter((script) => script.includes(THEME_STORAGE_KEYS.mode));
    expect(copies, "Regenerate the inline script from BOOT_SCRIPT (src/boot.ts).").toEqual([
      BOOT_SCRIPT,
    ]);
  });
});
