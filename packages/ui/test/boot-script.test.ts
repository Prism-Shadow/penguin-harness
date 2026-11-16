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
  BACKGROUND_STORAGE_KEYS,
  BOOT_SCRIPT,
  STATIC_BOOT_SCRIPT,
  BOOT_WALLPAPER_PROPERTIES,
  DEFAULT_TEXT_SIZE,
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  TEXT_SIZES,
  TEXT_SIZE_PX,
  THEME_STORAGE_KEYS,
  applyThemeAttributes,
  backgroundLayerStyle,
  isFontCjk,
  isFontLatin,
  readBackground,
  readCachedThemePack,
  readTextSize,
  releaseBootWallpaper,
  themePackHref,
} from "../src/boot";
import type { AccentChoice } from "../src/boot";
import {
  ACCENT_PRESET_IDS,
  INITIAL_THEME_ID,
  THEME_ACCENT_PRESETS,
  THEME_API,
  THEME_IDS,
  builtinPack,
  isThemeId,
} from "../src/tokens";
import type { ThemeId } from "../src/tokens";
import { WEB_DIR } from "./helpers/paths";

/** The attributes the script and the provider write, captured from a stand-in `<html>`. */
interface FakeRoot {
  classList: { add(name: string): void; toggle(name: string, on: boolean): void };
  dataset: Record<string, string | undefined>;
  style: {
    fontSize?: string;
    setProperty(name: string, value: string): void;
    removeProperty(name: string): void;
  };
  /** The custom properties written on the root (the boot wallpaper's). */
  properties: Map<string, string>;
  classes: Set<string>;
}

function fakeRoot(): FakeRoot {
  const classes = new Set<string>();
  const properties = new Map<string, string>();
  return {
    classes,
    properties,
    classList: {
      add: (name) => void classes.add(name),
      toggle: (name, on) => void (on ? classes.add(name) : classes.delete(name)),
    },
    dataset: {},
    style: {
      setProperty: (name, value) => void properties.set(name, value),
      removeProperty: (name) => void properties.delete(name),
    },
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
  themeBase: root.dataset.themeBase,
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
/** The static sites' variant, with no cached-pack branch. */
const compiledStatic = new Script(STATIC_BOOT_SCRIPT);
const context = createContext({ document: {}, localStorage: {}, matchMedia: () => ({}) });

/** Runs the script against the given storage and system preference. */
function runBoot(
  stored: Record<string, string | null>,
  systemDark: boolean,
  throwing = false,
  script = compiled,
) {
  const root = fakeRoot();
  const localStorage = fakeStorage(stored, throwing);
  context.document = { documentElement: root };
  context.localStorage = localStorage;
  context.matchMedia = (query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && systemDark,
  });
  script.runInContext(context);
  return snapshot(root, localStorage);
}

/**
 * What the provider resolves the same stored values to, written from the stored-preference rules
 * rather than from the script: an unknown mode means "system", an absent or unknown theme id the
 * theme a browser starts in, an unknown accent `neutral`, an unknown face the theme's own, and
 * the text size is what `readTextSize` says (the legacy scale mapped and migrated on the way). A
 * preset any theme lists is written to the root whichever theme is active — the theme files
 * scope their presets to their own root, so an unlisted one paints nothing and comes back with
 * its theme.
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
      : INITIAL_THEME_ID,
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
                    const provider = JSON.stringify(viaProvider(stored, systemDark));
                    // The static sites' variant paints the same wherever no pack is cached.
                    for (const [name, script] of [
                      ["BOOT_SCRIPT", compiled],
                      ["STATIC_BOOT_SCRIPT", compiledStatic],
                    ] as const) {
                      const boot = JSON.stringify(runBoot(stored, systemDark, false, script));
                      if (boot !== provider) {
                        mismatches.push(
                          `${name} ${JSON.stringify(stored)} system=${systemDark ? "dark" : "light"}: ` +
                            `boot ${boot} vs provider ${provider}`,
                        );
                      }
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

  it("opens a browser that stores no theme, or an unknown one, in the initial theme, and names every theme with its base", () => {
    // The theme a fresh browser starts in is written to the root like a chosen one, and every
    // stored theme is named, Primer included: a bare root paints the base, Frost. A pack built
    // on Frost carries the base attribute its recipes key on; one on the foundation alone none.
    for (const stored of [null, "retro"]) {
      expect(runBoot({ [THEME_STORAGE_KEYS.themeId]: stored }, false), `${stored}`).toMatchObject({
        theme: INITIAL_THEME_ID,
        themeBase: "modern",
      });
    }
    for (const id of THEME_IDS) {
      const painted = runBoot({ [THEME_STORAGE_KEYS.themeId]: id }, false);
      expect(painted.theme, id).toBe(id);
      expect(painted.themeBase, id).toBe(builtinPack(id).base === "modern" ? "modern" : undefined);
    }
    expect(runBoot({ [THEME_STORAGE_KEYS.themeId]: "github" }, false).themeBase).toBeUndefined();
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
  });

  it("renders the page untouched when storage throws, instead of throwing itself", () => {
    expect(() => runBoot({}, true, true)).not.toThrow();
    expect(runBoot({}, true, true)).toEqual({
      dark: false,
      theme: undefined,
      themeBase: undefined,
      accent: undefined,
      fontLatin: undefined,
      fontCjk: undefined,
      fontSize: undefined,
      stored: {},
    });
  });

  it("leaves no global behind, nor does the static sites' variant", () => {
    for (const script of [BOOT_SCRIPT, STATIC_BOOT_SCRIPT]) {
      const context: Record<string, unknown> = {
        document: { documentElement: fakeRoot() },
        localStorage: fakeStorage({}),
        matchMedia: () => ({ matches: false }),
      };
      runInNewContext(script, context);
      expect(Object.keys(context).sort()).toEqual(["document", "localStorage", "matchMedia"]);
    }
  });
});

describe("a cached imported pack", () => {
  // An imported pack the server lists, as the browser caches its entry: an id the build does not
  // ship, the theme API it targets, the version its stylesheet is served at, its base and its
  // presets. The script links its stylesheet during parsing and names it on the root; everything
  // the cache holds is checked first, and the address is built, never read.
  const PACK = {
    id: "sakura",
    names: { zh: "樱", en: "Sakura" },
    api: THEME_API,
    v: "0123abcd",
    base: "modern",
    accent: { own: { light: "#2b2521", dark: "#ece4d6" }, presets: [{ id: "petal" }] },
  };
  const lists: (string | null)[] = [
    null,
    "{not json",
    "{}",
    JSON.stringify([PACK]),
    JSON.stringify([{ ...PACK, base: "foundation" }]),
    JSON.stringify([{ ...PACK, base: undefined }]),
    JSON.stringify([{ ...PACK, api: THEME_API + 1 }]),
    JSON.stringify([{ ...PACK, api: "1" }]),
    JSON.stringify([{ ...PACK, v: "../../x" }]),
    JSON.stringify([{ ...PACK, accent: { presets: [{ id: "Petal!" }, null, "petal"] } }]),
    JSON.stringify([{ ...PACK, accent: null }]),
    JSON.stringify([null, 3, [], { ...PACK, id: "maple" }, PACK, { ...PACK, v: "ffffffff" }]),
    JSON.stringify([{ ...PACK, id: "modern" }]),
  ];
  const themes = [null, "sakura", "maple", "modern", "github", "toString", 'x" onload="y', "null"];
  const accents = [null, "petal", "forest", "Petal!"];

  /** Runs the script with a document that records what it writes into the head. */
  function bootWithPacks(stored: Record<string, string | null>) {
    const root = fakeRoot();
    const writes: string[] = [];
    const localStorage = fakeStorage(stored);
    context.document = { documentElement: root, write: (html: string) => void writes.push(html) };
    context.localStorage = localStorage;
    context.matchMedia = () => ({ matches: false });
    compiled.runInContext(context);
    return { ...snapshot(root, localStorage), writes };
  }

  /** The same stored values through the readers the provider uses. */
  function viaReaders(stored: Record<string, string | null>) {
    const storage = fakeStorage(stored);
    const themeId = stored[THEME_STORAGE_KEYS.themeId] ?? null;
    const accent = stored[THEME_STORAGE_KEYS.accent] ?? null;
    const pack = readCachedThemePack(storage, themeId);
    const root = fakeRoot();
    const id = isThemeId(themeId) ? themeId : (pack?.id ?? INITIAL_THEME_ID);
    const listed =
      (ACCENT_PRESET_IDS as readonly (string | null)[]).includes(accent) ||
      (pack !== null && pack.presets.includes(accent ?? ""));
    applyThemeAttributes(root as unknown as HTMLElement, {
      dark: false,
      themeId: id as ThemeId,
      ...(pack === null ? {} : { themeBase: pack.base }),
      accent: listed ? (accent as AccentChoice) : "neutral",
      textSize: readTextSize(storage),
      fontLatin: "theme",
      fontCjk: "theme",
    });
    const writes =
      pack === null
        ? []
        : [
            `<link rel="stylesheet" data-theme-pack="${pack.id}" href="${themePackHref(pack.id, pack.v)}">`,
          ];
    return { ...snapshot(root, storage), writes };
  }

  it("paints what the provider's readers say, and links the stylesheet they name, for every combination", () => {
    const mismatches: string[] = [];
    for (const list of lists)
      for (const themeId of themes)
        for (const accent of accents) {
          const stored = {
            [THEME_STORAGE_KEYS.themePacks]: list,
            [THEME_STORAGE_KEYS.themeId]: themeId,
            [THEME_STORAGE_KEYS.accent]: accent,
          };
          const boot = bootWithPacks(stored);
          const readers = viaReaders(stored);
          if (JSON.stringify(boot) !== JSON.stringify(readers)) {
            mismatches.push(
              `${JSON.stringify(stored)}: ${JSON.stringify(boot)} vs ${JSON.stringify(readers)}`,
            );
          }
        }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("names a cached pack with its base, links its stylesheet, and takes its presets", () => {
    const painted = bootWithPacks({
      [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([PACK]),
      [THEME_STORAGE_KEYS.themeId]: "sakura",
      [THEME_STORAGE_KEYS.accent]: "petal",
    });
    expect(painted).toMatchObject({ theme: "sakura", themeBase: "modern", accent: "petal" });
    expect(painted.writes).toEqual([
      '<link rel="stylesheet" data-theme-pack="sakura" href="/api/themes/sakura/files/index.css?v=0123abcd">',
    ]);
  });

  it("paints the initial theme for a pack the cache lacks, or one this build cannot load", () => {
    for (const list of [null, JSON.stringify([{ ...PACK, api: THEME_API + 1 }])]) {
      const painted = bootWithPacks({
        [THEME_STORAGE_KEYS.themePacks]: list,
        [THEME_STORAGE_KEYS.themeId]: "sakura",
      });
      expect(painted).toMatchObject({ theme: INITIAL_THEME_ID, themeBase: "modern", writes: [] });
      // The stored choice is left as it is: the reader never writes it back.
      expect(painted.stored[THEME_STORAGE_KEYS.themeId]).toBe("sakura");
    }
  });

  it("is never linked by the static sites' script, which has no theme server to link from", () => {
    // The gallery's frames are a static site: a cached pack there would point at an /api/themes
    // the site does not have. The static script paints the initial theme, takes only built-in
    // presets, and writes nothing into the head.
    for (const list of lists) {
      const root = fakeRoot();
      const writes: string[] = [];
      context.document = { documentElement: root, write: (html: string) => void writes.push(html) };
      context.localStorage = fakeStorage({
        [THEME_STORAGE_KEYS.themePacks]: list,
        [THEME_STORAGE_KEYS.themeId]: "sakura",
        [THEME_STORAGE_KEYS.accent]: "petal",
      });
      context.matchMedia = () => ({ matches: false });
      compiledStatic.runInContext(context);
      expect(writes, `${list}`).toEqual([]);
      expect(root.dataset.theme, `${list}`).toBe(INITIAL_THEME_ID);
      expect(root.dataset.accent, `${list}`).toBeUndefined();
    }
  });

  it("still applies the other preferences when the document refuses the link", () => {
    const root = fakeRoot();
    context.document = {
      documentElement: root,
      write: () => {
        throw new Error("document.write is blocked");
      },
    };
    context.localStorage = fakeStorage({
      [THEME_STORAGE_KEYS.themePacks]: JSON.stringify([PACK]),
      [THEME_STORAGE_KEYS.themeId]: "sakura",
      [THEME_STORAGE_KEYS.textSize]: "l",
    });
    context.matchMedia = () => ({ matches: false });
    compiled.runInContext(context);
    expect(root.dataset.theme).toBe("sakura");
    expect(root.style.fontSize).toBe(TEXT_SIZE_PX.l);
  });
});

describe("the boot wallpaper", () => {
  const IMAGE = "data:image/png;base64,aW1hZ2U=";
  const P = BOOT_WALLPAPER_PROPERTIES;

  /** Runs the script over a stored background and returns the root it painted. */
  function bootWith(image: string | null, settings: string | null) {
    const root = fakeRoot();
    context.document = { documentElement: root };
    context.localStorage = fakeStorage({
      [BACKGROUND_STORAGE_KEYS.image]: image,
      [BACKGROUND_STORAGE_KEYS.settings]: settings,
    });
    context.matchMedia = () => ({ matches: false });
    compiled.runInContext(context);
    return root;
  }

  it("lays a stored image on the first frame exactly as the shell's wallpaper will, for every stored setting", () => {
    const transparencies = [undefined, 0, 37, 100, -20, 140, "40", null];
    const modes = [undefined, "cover", "contain", "tile", "original", "stretch"];
    const positions = [undefined, "left top", "right bottom", "center center", "middle"];
    const raw = ["{not json", "null", "[]", "42"];
    const settingsCases: (string | null)[] = [null, ...raw];
    for (const transparency of transparencies)
      for (const mode of modes)
        for (const position of positions)
          settingsCases.push(JSON.stringify({ transparency, mode, position }));
    const mismatches: string[] = [];
    for (const settings of settingsCases) {
      const root = bootWith(IMAGE, settings);
      const store = fakeStorage({
        [BACKGROUND_STORAGE_KEYS.image]: IMAGE,
        [BACKGROUND_STORAGE_KEYS.settings]: settings,
      });
      const { image, settings: read } = readBackground(store);
      const shell = backgroundLayerStyle(image, read);
      const painted = {
        attribute: root.dataset.bootWallpaper,
        image: root.properties.get(P.image),
        size: root.properties.get(P.size),
        repeat: root.properties.get(P.repeat),
        position: root.properties.get(P.position),
        opacity: Number(root.properties.get(P.opacity)),
      };
      const expected = {
        attribute: "",
        image: shell.backgroundImage,
        size: shell.backgroundSize,
        repeat: shell.backgroundRepeat,
        position: shell.backgroundPosition,
        opacity: shell.opacity,
      };
      if (JSON.stringify(painted) !== JSON.stringify(expected)) {
        mismatches.push(`${settings}: ${JSON.stringify(painted)} vs ${JSON.stringify(expected)}`);
      }
    }
    expect(settingsCases.length).toBeGreaterThan(200);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it("paints nothing for no image, or for anything that is not locally encoded raster data", () => {
    for (const image of [
      null,
      "https://example.com/tracker.png",
      "data:image/svg+xml;base64,PHN2Zz4=",
      'data:image/png;base64,aW1h") , url("https://example.com/x.png',
    ]) {
      const root = bootWith(image, null);
      expect(root.dataset.bootWallpaper, `${image}`).toBeUndefined();
      expect(root.properties.size, `${image}`).toBe(0);
    }
  });

  it("ends when the first screen mounts, leaving nothing of itself on the root", () => {
    const root = bootWith(IMAGE, JSON.stringify({ transparency: 30, mode: "tile" }));
    expect(root.dataset.bootWallpaper).toBe("");
    releaseBootWallpaper(root as unknown as HTMLElement);
    expect(root.dataset.bootWallpaper).toBeUndefined();
    expect(root.properties.size).toBe(0);
    // A second release, or one with nothing painted, is a no-op.
    expect(() => releaseBootWallpaper(root as unknown as HTMLElement)).not.toThrow();
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
