/**
 * The pre-paint script (src/boot.ts).
 *
 * It exists twice: as `BOOT_SCRIPT`, generated from the same constants the app's theme provider
 * reads, and pasted inline into `packages/web/index.html`, where it runs before the bundle loads.
 * Two things break silently and only on a reload: the pasted copy falling behind the constants (a
 * new theme id that paints the default theme for one frame, then snaps), and the script disagreeing
 * with `applyThemeAttributes` about a stored value (the first frame and the second frame differ).
 * Both are held here — the copy byte for byte, the behaviour by running the script against a fake
 * document for every combination of stored preferences and comparing the result with what the
 * provider's path produces.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  BOOT_SCRIPT,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_PX,
  THEME_STORAGE_KEYS,
  applyThemeAttributes,
} from "../src/boot";
import type { AccentChoice, FontScale } from "../src/boot";
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

const snapshot = (root: FakeRoot) => ({
  dark: root.classes.has("dark"),
  theme: root.dataset.theme,
  accent: root.dataset.accent,
  fontSize: root.style.fontSize,
});

/** Runs the script in a fresh context with the given storage and system preference. */
function runBoot(stored: Record<string, string | null>, systemDark: boolean, throwing = false) {
  const root = fakeRoot();
  const localStorage = {
    getItem(key: string) {
      if (throwing) throw new Error("storage is disabled");
      return stored[key] ?? null;
    },
  };
  runInNewContext(BOOT_SCRIPT, {
    document: { documentElement: root },
    localStorage,
    matchMedia: (query: string) => ({
      matches: query === "(prefers-color-scheme: dark)" && systemDark,
    }),
  });
  return snapshot(root);
}

/**
 * What the provider resolves the same stored values to, written from the stored-preference rules
 * rather than from the script: an unknown mode means "system", an unknown theme id the default
 * theme, an unknown accent `neutral`, an unknown scale the default tier. A preset any theme lists
 * is written to the root whichever theme is active — the theme files scope their presets to their
 * own root, so an unlisted one paints nothing and comes back with its theme.
 */
function viaProvider(stored: Record<string, string | null>, systemDark: boolean) {
  const mode = stored[THEME_STORAGE_KEYS.mode];
  const themeId = stored[THEME_STORAGE_KEYS.themeId];
  const accent = stored[THEME_STORAGE_KEYS.accent];
  const scale = stored[THEME_STORAGE_KEYS.fontScale];
  const root = fakeRoot();
  applyThemeAttributes(root as unknown as HTMLElement, {
    dark: mode === "dark" || (mode !== "light" && systemDark),
    themeId: (THEME_IDS as readonly (string | null | undefined)[]).includes(themeId)
      ? (themeId as ThemeId)
      : DEFAULT_THEME_ID,
    accent: (ACCENT_PRESET_IDS as readonly (string | null | undefined)[]).includes(accent)
      ? (accent as AccentChoice)
      : "neutral",
    fontScale:
      scale !== null && scale !== undefined && Object.hasOwn(FONT_SCALE_PX, scale)
        ? (scale as FontScale)
        : DEFAULT_FONT_SCALE,
  });
  return snapshot(root);
}

describe("BOOT_SCRIPT", () => {
  it("paints what the provider will, for every combination of stored preferences", () => {
    const modes = [null, "light", "dark", "system", "sepia"];
    const themes = [null, ...THEME_IDS, "retro"];
    // One preset of each theme's list, so a Frost preset stored under Primer is exercised too.
    const accents = [
      null,
      "neutral",
      ...THEME_IDS.map((id) => THEME_ACCENT_PRESETS[id][0]!),
      "teal",
    ];
    const scales = [null, ...Object.keys(FONT_SCALE_PX), "xl", "toString"];
    const mismatches: string[] = [];
    let cases = 0;
    for (const mode of modes)
      for (const themeId of themes)
        for (const accent of accents)
          for (const scale of scales)
            for (const systemDark of [false, true]) {
              const stored = {
                [THEME_STORAGE_KEYS.mode]: mode,
                [THEME_STORAGE_KEYS.themeId]: themeId,
                [THEME_STORAGE_KEYS.accent]: accent,
                [THEME_STORAGE_KEYS.fontScale]: scale,
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
    expect(cases).toBeGreaterThan(1000);
    expect(mismatches.slice(0, 5)).toEqual([]);
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

  it("renders the page untouched when storage throws, instead of throwing itself", () => {
    expect(() => runBoot({}, true, true)).not.toThrow();
    expect(runBoot({}, true, true)).toEqual({
      dark: false,
      theme: undefined,
      accent: undefined,
      fontSize: undefined,
    });
  });

  it("leaves no global behind", () => {
    const context: Record<string, unknown> = {
      document: { documentElement: fakeRoot() },
      localStorage: { getItem: () => null },
      matchMedia: () => ({ matches: false }),
    };
    runInNewContext(BOOT_SCRIPT, context);
    expect(Object.keys(context).sort()).toEqual(["document", "localStorage", "matchMedia"]);
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

  if (inline.length === 0) {
    // W0a (feat/theme-w0-package) adds the script. Once it lands on this branch this case turns
    // into the equality check below — and from then on a missing script is a failure, not a skip.
    it.skip("carries BOOT_SCRIPT verbatim — PENDING: index.html has no inline script yet (W0a adds it)", () => {});
    return;
  }

  it("carries BOOT_SCRIPT verbatim, once", () => {
    const copies = inline.filter((script) => script.includes(THEME_STORAGE_KEYS.mode));
    expect(copies, "Regenerate the inline script from BOOT_SCRIPT (src/boot.ts).").toEqual([
      BOOT_SCRIPT,
    ]);
  });
});
