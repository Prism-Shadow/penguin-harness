/**
 * Theme attributes on <html>, applied twice: once before the first paint by {@link BOOT_SCRIPT}
 * (inlined into the app's index.html), and from then on by the app's theme provider through
 * {@link applyThemeAttributes}.
 *
 * The pre-paint pass is what keeps a dark page, or one in any theme but the base's, from flashing
 * the base (Frost, what a bare root paints) while the bundle loads, keeps the first frame from
 * rendering at the browser's 16px root and reflowing once React applies the stored text size,
 * keeps a chosen font pairing from swapping in after the first paint, and lays a stored custom
 * background on the boot layer (wallpaper.css) until the first screen of the app mounts, so a
 * reload never shows the bare page colour where the image will be. A stored imported pack the
 * browser has cached is linked before the first paint too ({@link readCachedThemePack}).
 *
 * The inline copy in index.html must equal {@link BOOT_SCRIPT} byte for byte; a test asserts it.
 * Change the constants here, then paste the regenerated string there.
 */
import {
  ACCENT_PRESET_IDS,
  INITIAL_THEME_ID,
  THEME_API,
  THEME_IDS,
  builtinPack,
  isThemeId,
} from "./tokens";
import type { AccentPreset, ThemeBase, ThemeId } from "./tokens";

/**
 * localStorage keys. `penguin.theme` predates themes and stores the MODE (light / dark / system).
 * `penguin.fontScale` is the key of the retired three-step size: {@link readTextSize} reads it
 * once, maps it and removes it; nothing writes it. Drop it with the next minor version.
 * `penguin.themePacks` is the browser's copy of the server's imported packs, a JSON array of the
 * server's pack entries ({@link readCachedThemePack} reads what the first frame needs of one); it
 * is a cache of the server's list, never synced to the account.
 */
export const THEME_STORAGE_KEYS = {
  mode: "penguin.theme",
  themeId: "penguin.themeId",
  accent: "penguin.accent",
  textSize: "penguin.textSize",
  fontLatin: "penguin.fontLatin",
  fontCjk: "penguin.fontCjk",
  fontScale: "penguin.fontScale",
  themePacks: "penguin.themePacks",
} as const;

/** What the readers need of `localStorage`; a test passes a Map-backed stand-in. */
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ---------------------------------------------------------------------------
// Text size
// ---------------------------------------------------------------------------

/** The five text sizes, smallest first: 特小 · 小 · 中 · 大 · 特大. */
export const TEXT_SIZES = ["xs", "s", "m", "l", "xl"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Text size → root font-size. Every type and density token is rem, so this scales them all. */
export const TEXT_SIZE_PX: Readonly<Record<TextSize, string>> = {
  xs: "14px",
  s: "15px",
  m: "16px",
  l: "18px",
  xl: "20px",
};

/** 16px — what the retired scale called its small step (user decision, 2026-09-29). */
export const DEFAULT_TEXT_SIZE: TextSize = "m";

/** The retired three-step scale and, by index, the size with the same pixels: 16 / 18 / 20px. */
const LEGACY_FONT_SCALES = ["sm", "md", "lg"] as const;
const LEGACY_FONT_SCALE_SIZES: readonly TextSize[] = ["m", "l", "xl"];

export function isTextSize(value: unknown): value is TextSize {
  return (TEXT_SIZES as readonly unknown[]).includes(value);
}

/**
 * The stored text size, or the default. A store that still holds the retired three-step scale
 * and no text size is migrated on this read: the step is mapped by its pixels, written under the
 * new key and the old key removed (an unrecognised old value is removed without a write), so the
 * next read is a plain lookup. The pre-paint script does the same before the first frame.
 */
export function readTextSize(storage: PreferenceStorage): TextSize {
  const stored = storage.getItem(THEME_STORAGE_KEYS.textSize);
  if (isTextSize(stored)) return stored;
  const legacy = storage.getItem(THEME_STORAGE_KEYS.fontScale);
  if (legacy === null) return DEFAULT_TEXT_SIZE;
  const size = LEGACY_FONT_SCALE_SIZES[(LEGACY_FONT_SCALES as readonly string[]).indexOf(legacy)];
  if (size !== undefined) storage.setItem(THEME_STORAGE_KEYS.textSize, size);
  storage.removeItem(THEME_STORAGE_KEYS.fontScale);
  return size ?? DEFAULT_TEXT_SIZE;
}

// ---------------------------------------------------------------------------
// Font pairing
// ---------------------------------------------------------------------------

/**
 * One face a user may pair: its id (the `data-font-latin` / `data-font-cjk` value, and what is
 * stored) and its display label — a proper name, the same in both languages. `theme` (the
 * theme's own face, no attribute) and `system` (the platform's face) are not names: a consumer
 * words those two from its own dictionary and shows the label of every other entry as it is.
 */
export interface FontOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The Latin faces, only those the app already bundles (`fonts/*.css`). They replace the reading
 * and chrome sans (`--ui-font-sans`, which every theme's `--ui-font-ui` follows); a theme's mono
 * face is never replaced — code and the marks a theme sets in mono keep it.
 */
export const FONT_LATIN_OPTIONS = [
  { id: "theme", label: "Theme default" },
  { id: "system", label: "System" },
  { id: "mona-sans", label: "Mona Sans" },
  { id: "ibm-plex-sans", label: "IBM Plex Sans" },
  { id: "misans", label: "MiSans" },
] as const satisfies readonly FontOption[];
export type FontLatin = (typeof FONT_LATIN_OPTIONS)[number]["id"];

/** The CJK faces, likewise; they replace `--ui-font-cjk`, which every theme's stacks read. */
export const FONT_CJK_OPTIONS = [
  { id: "theme", label: "Theme default" },
  { id: "system", label: "System" },
  { id: "noto-sans-sc", label: "Noto Sans SC" },
  { id: "misans", label: "MiSans" },
] as const satisfies readonly FontOption[];
export type FontCjk = (typeof FONT_CJK_OPTIONS)[number]["id"];

const optionIds = (options: readonly FontOption[]) => options.map((option) => option.id);

export function isFontLatin(value: unknown): value is FontLatin {
  return (optionIds(FONT_LATIN_OPTIONS) as readonly unknown[]).includes(value);
}

export function isFontCjk(value: unknown): value is FontCjk {
  return (optionIds(FONT_CJK_OPTIONS) as readonly unknown[]).includes(value);
}

// ---------------------------------------------------------------------------
// The themes' own faces
// ---------------------------------------------------------------------------

/**
 * The display name of every bundled family → the family its `@font-face` declares
 * (`fonts/*.css`). The pairing options and the themes' own faces are named by the display
 * names, which is also what the credits and the Fonts page print.
 */
export const BUNDLED_FONT_FAMILIES = {
  "Mona Sans": "Mona Sans Variable",
  "IBM Plex Sans": "IBM Plex Sans Variable",
  MiSans: "MiSans",
  "Noto Sans SC": "Noto Sans SC Variable",
  "JetBrains Mono": "JetBrains Mono Variable",
  "Shantell Sans": "Shantell Sans Variable",
  "LXGW WenKai GB Screen": "LXGW WenKai GB Screen",
} as const;
export type BundledFontName = keyof typeof BUNDLED_FONT_FAMILIES;

/** A theme that names no bundled face names the platform's own; a consumer words this. */
export const SYSTEM_FONT = "System";
export type ThemeFontName = BundledFontName | typeof SYSTEM_FONT;

export interface ThemeFonts {
  /** The reading and chrome sans (`--ui-font-sans`, which `--ui-font-ui` follows). */
  readonly latin: ThemeFontName;
  /** `--ui-font-cjk`. */
  readonly cjk: ThemeFontName;
  /** `--ui-font-mono`. */
  readonly mono: ThemeFontName;
}

/** The display name of the family a stack names first: a bundled face's, or {@link SYSTEM_FONT}. */
function fontName(family: string): ThemeFontName {
  const bundled = Object.entries(BUNDLED_FONT_FAMILIES).find(([, declared]) => declared === family);
  return bundled === undefined ? SYSTEM_FONT : (bundled[0] as BundledFontName);
}

/**
 * Each theme's own faces, as display names — what the Fonts page states as a theme's defaults
 * beside the user's choice. Read from each pack's manifest (`fonts`, the family each stack names
 * first), which a test holds to the pack's stacks; `System` = a stack that names no bundled family.
 */
export const THEME_FONTS: Readonly<Record<ThemeId, ThemeFonts>> = /* @__PURE__ */ (() =>
  Object.fromEntries(
    THEME_IDS.map((id) => {
      const { sans, cjk, mono } = builtinPack(id).fonts;
      return [id, { latin: fontName(sans), cjk: fontName(cjk), mono: fontName(mono) }];
    }),
  ) as Record<ThemeId, ThemeFonts>)();

// ---------------------------------------------------------------------------
// The custom background
// ---------------------------------------------------------------------------

/**
 * The browser-scoped keys of the custom background: the image bytes and the display settings,
 * apart so a slider never rewrites the image. The app's background provider reads and writes
 * them; the pre-paint script reads them so a reload paints the image from the first frame.
 */
export const BACKGROUND_STORAGE_KEYS = {
  image: "penguin.background.image",
  settings: "penguin.background.settings",
} as const;

export const BACKGROUND_MODES = ["cover", "contain", "tile", "original"] as const;
export const BACKGROUND_POSITIONS = [
  "left top",
  "center top",
  "right top",
  "left center",
  "center center",
  "right center",
  "left bottom",
  "center bottom",
  "right bottom",
] as const;
export type BackgroundMode = (typeof BACKGROUND_MODES)[number];
export type BackgroundPosition = (typeof BACKGROUND_POSITIONS)[number];

export interface BackgroundSettings {
  /** 0–100: how much of the page colour shows through the image. */
  transparency: number;
  mode: BackgroundMode;
  position: BackgroundPosition;
}

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  transparency: 80,
  mode: "cover",
  position: "center center",
};

/** Only locally encoded raster data is allowed into a CSS image value. */
const BACKGROUND_IMAGE_PATTERN = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export function isBackgroundImage(value: unknown): value is string {
  return typeof value === "string" && BACKGROUND_IMAGE_PATTERN.test(value);
}

/**
 * The stored background: the image when it is a valid one, and the settings with every field the
 * store lacks or garbles taken from the defaults. Storage that throws, or settings that do not
 * parse, never keep the app from opening.
 */
export function readBackground(storage: Pick<Storage, "getItem">): {
  image: string | null;
  settings: BackgroundSettings;
} {
  let image: string | null = null;
  let settings = DEFAULT_BACKGROUND_SETTINGS;
  try {
    const storedImage = storage.getItem(BACKGROUND_STORAGE_KEYS.image);
    if (isBackgroundImage(storedImage)) image = storedImage;
    const stored: unknown = JSON.parse(storage.getItem(BACKGROUND_STORAGE_KEYS.settings) ?? "null");
    if (stored && typeof stored === "object") {
      const value = stored as Partial<BackgroundSettings>;
      settings = {
        transparency:
          typeof value.transparency === "number" && Number.isFinite(value.transparency)
            ? Math.min(100, Math.max(0, value.transparency))
            : DEFAULT_BACKGROUND_SETTINGS.transparency,
        mode:
          BACKGROUND_MODES.find((mode) => mode === value.mode) ?? DEFAULT_BACKGROUND_SETTINGS.mode,
        position:
          BACKGROUND_POSITIONS.find((position) => position === value.position) ??
          DEFAULT_BACKGROUND_SETTINGS.position,
      };
    }
  } catch {
    // Blocked storage or an incomplete settings value must not prevent the app from opening.
  }
  return { image, settings };
}

/** How the image is laid over the window: its CSS background and its opacity. */
export interface BackgroundLayerStyle {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: string;
  backgroundPosition: string;
  opacity: number;
}

export function backgroundLayerStyle(
  image: string | null,
  settings: BackgroundSettings,
): BackgroundLayerStyle {
  return {
    backgroundImage: image === null ? "none" : `url("${image}")`,
    backgroundSize:
      settings.mode === "tile" || settings.mode === "original" ? "auto" : settings.mode,
    backgroundRepeat: settings.mode === "tile" ? "repeat" : "no-repeat",
    backgroundPosition: settings.position,
    opacity: 1 - settings.transparency / 100,
  };
}

/**
 * The custom properties the pre-paint script writes on `<html>` for a stored image, read by the
 * boot layer (`:root[data-boot-wallpaper]::before`, wallpaper.css): the layer that stands in for
 * the shell's own wallpaper until a screen of the app has mounted.
 */
export const BOOT_WALLPAPER_PROPERTIES = {
  image: "--boot-wallpaper-image",
  size: "--boot-wallpaper-size",
  repeat: "--boot-wallpaper-repeat",
  position: "--boot-wallpaper-position",
  opacity: "--boot-wallpaper-opacity",
} as const;

/**
 * Ends the boot layer: called once the first screen of the app has mounted — the shell, which
 * paints its own wallpaper in the same frame, or a screen outside it (sign-in, a standalone
 * terminal), which shows none. Idempotent.
 */
export function releaseBootWallpaper(root: HTMLElement): void {
  delete root.dataset.bootWallpaper;
  for (const property of Object.values(BOOT_WALLPAPER_PROPERTIES)) {
    root.style.removeProperty(property);
  }
}

// ---------------------------------------------------------------------------
// Applying the attributes
// ---------------------------------------------------------------------------

/**
 * `neutral` is the stored value for "no preset": the theme's own accent, no `data-accent`. Any
 * other known id is written to the root as it is, whichever theme is active: a theme's preset
 * rules match only their own theme, so an id the active theme does not list paints nothing (the
 * theme's own accent shows) and takes effect again when the user returns to a theme that lists
 * it. The resolution lives in the CSS, and `resolveAccent` (tokens.ts) only mirrors it for a
 * picker.
 */
export type AccentChoice = "neutral" | AccentPreset;

export interface ThemeAttributes {
  /** The resolved mode (a `system` preference already resolved against the media query). */
  dark: boolean;
  /** A built-in pack's id ({@link ThemeId}) or an imported pack's: either is written as it is. */
  themeId: string;
  /**
   * What the pack builds on, written beside the id as `data-theme-base`. Left out, a built-in
   * pack's manifest says, and any other pack builds on Frost (`modern`), as a manifest does that
   * names no base.
   */
  themeBase?: ThemeBase;
  accent: AccentChoice;
  textSize: TextSize;
  /** `theme` is the theme's own face and writes no attribute, like `neutral` for the accent. */
  fontLatin: FontLatin;
  fontCjk: FontCjk;
}

/**
 * The accent and the two faces share one rule: the value that means "the theme's own" (no
 * preset, the theme's face) is the ABSENCE of the attribute, so a pack's plain selectors match it
 * and nothing has to name a default. The theme itself is always named: `data-theme` is written
 * for every pack, the base included.
 */
function setOrDrop(root: HTMLElement, key: string, value: string, own: string): void {
  if (value === own) delete root.dataset[key];
  else root.dataset[key] = value;
}

/** The base a pack's root carries: the given one, a built-in's own, or Frost for any other. */
function baseOf(themeId: string, themeBase: ThemeBase | undefined): ThemeBase {
  return themeBase ?? (isThemeId(themeId) ? builtinPack(themeId).base : "modern");
}

/**
 * Writes the given attributes onto `root`. Each field is optional so a provider can reconcile one
 * preference per effect; an absent field is left as it is. A theme id writes `data-theme` and,
 * for a pack built on Frost, `data-theme-base="modern"` (absent for one on the foundation alone).
 */
export function applyThemeAttributes(root: HTMLElement, attrs: Partial<ThemeAttributes>): void {
  if (attrs.dark !== undefined) root.classList.toggle("dark", attrs.dark);
  if (attrs.themeId !== undefined) {
    root.dataset.theme = attrs.themeId;
    setOrDrop(root, "themeBase", baseOf(attrs.themeId, attrs.themeBase), "foundation");
  }
  if (attrs.accent !== undefined) setOrDrop(root, "accent", attrs.accent, "neutral");
  if (attrs.fontLatin !== undefined) setOrDrop(root, "fontLatin", attrs.fontLatin, "theme");
  if (attrs.fontCjk !== undefined) setOrDrop(root, "fontCjk", attrs.fontCjk, "theme");
  if (attrs.textSize !== undefined) root.style.fontSize = TEXT_SIZE_PX[attrs.textSize];
}

// ---------------------------------------------------------------------------
// An imported pack the browser has cached
// ---------------------------------------------------------------------------

/** An imported pack's id, as the manifest allows it; built-in ids are reserved (never imported). */
const PACK_ID = /^[a-z][a-z0-9-]{1,31}$/;
/** The version a pack's stylesheet is served at: a hex digest of the installed pack. */
const PACK_VERSION = /^[0-9a-f]{8,64}$/;
/** An accent preset id an imported pack may list. */
const PRESET_ID = /^[a-z][a-z0-9-]{0,31}$/;

/** What the first frame needs of a cached imported pack. */
export interface CachedThemePack {
  readonly id: string;
  /** `foundation` when the entry says so, otherwise Frost (`modern`), a manifest's default. */
  readonly base: ThemeBase;
  /** The version its stylesheet is served at ({@link themePackHref}). */
  readonly v: string;
  /** The accent preset ids it lists, in its order. */
  readonly presets: readonly string[];
}

/** Where the server serves an installed pack's stylesheet, at one version. */
export function themePackHref(id: string, v: string): string {
  return `/api/themes/${id}/files/index.css?v=${v}`;
}

/**
 * The cached imported pack a stored theme id names, or null: an id the build does not ship, found
 * in {@link THEME_STORAGE_KEYS.themePacks} (the first entry with that id), whose theme API this
 * build implements and whose version is a digest. Anything else — no cache, a cache that does not
 * parse, an entry that fails a check — is null, and the id reads as the theme a browser starts
 * in. The stylesheet's address is built from the id and the version, never read from the cache,
 * so a cache entry cannot point the page anywhere else. The pre-paint script mirrors this.
 */
export function readCachedThemePack(
  storage: Pick<Storage, "getItem">,
  id: string | null,
): CachedThemePack | null {
  if (id === null || isThemeId(id) || !PACK_ID.test(id)) return null;
  let list: unknown;
  try {
    list = JSON.parse(storage.getItem(THEME_STORAGE_KEYS.themePacks) ?? "null");
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  for (const entry of list as unknown[]) {
    if (entry === null || typeof entry !== "object") continue;
    const pack = entry as Record<string, unknown>;
    if (pack.id !== id || typeof pack.api !== "number" || !(pack.api <= THEME_API)) continue;
    if (typeof pack.v !== "string" || !PACK_VERSION.test(pack.v)) continue;
    const accent = pack.accent as { presets?: unknown } | null | undefined;
    const listed = accent !== null && typeof accent === "object" ? accent.presets : undefined;
    return {
      id,
      base: pack.base === "foundation" ? "foundation" : "modern",
      v: pack.v,
      presets: (Array.isArray(listed) ? (listed as unknown[]) : [])
        .map((preset) =>
          preset !== null && typeof preset === "object" ? (preset as { id?: unknown }).id : null,
        )
        .filter((preset): preset is string => typeof preset === "string" && PRESET_ID.test(preset)),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The pre-paint script
// ---------------------------------------------------------------------------

/** The ids that write an attribute: every option but `theme`, which is the attribute's absence. */
const chosenFaces = (options: readonly FontOption[]) =>
  optionIds(options).filter((id) => id !== "theme");
/** The built-in packs a `data-theme-base="modern"` goes beside. */
const onFrost = () => THEME_IDS.filter((id) => builtinPack(id).base === "modern");
const j = JSON.stringify;
const K = THEME_STORAGE_KEYS;
const B = BACKGROUND_STORAGE_KEYS;
const P = BOOT_WALLPAPER_PROPERTIES;

/**
 * The pre-paint script: a classic, dependency-free IIFE (no globals leak) that mirrors
 * {@link applyThemeAttributes} and {@link readTextSize} for the stored preferences. It validates
 * every stored value the way the provider's initializers do, so an unknown value renders exactly
 * as the provider will, and it swallows everything — storage can throw (disabled cookies,
 * sandboxed frames) and the page must still render. The text-size migration writes storage last
 * and in its own try, so a store that reads but refuses writes still paints the migrated size.
 *
 * A stored id the build does not ship is looked up among the cached imported packs
 * ({@link readCachedThemePack}); when found, the script writes the pack's stylesheet link with
 * `document.write`, which during parsing blocks the first paint as the bundled sheet does (an
 * appended link would not), and the pack's presets join the accents it accepts. A browser that has
 * never seen the server's list paints the base for one frame, and the app switches once the list
 * arrives.
 */
export const BOOT_SCRIPT = /* @__PURE__ */ prePaint(servedTheme());

/**
 * The pre-paint script for a page no theme server stands behind — the gallery's static frames:
 * {@link BOOT_SCRIPT} without the cached-pack branch. Such a page has no `/api/themes` to link a
 * pack from, so a stored id the build does not ship reads as the theme a browser starts in, and
 * only a built-in theme's presets are accepted; everything else it paints the same.
 */
export const STATIC_BOOT_SCRIPT = /* @__PURE__ */ prePaint(staticTheme());

/** The theme and accent part for a page behind a server: built-in ids, then a cached imported pack. */
function servedTheme(): string {
  return (
    `var t=s.getItem(${j(K.themeId)}),k=null,i,x;` +
    `if(${j(THEME_IDS)}.indexOf(t)<0){if(t!==null&&${PACK_ID.toString()}.test(t)){try{var q=JSON.parse(s.getItem(${j(K.themePacks)}));` +
    `if(Array.isArray(q))for(i=0;i<q.length&&!k;i++){x=q[i];if(x&&typeof x==="object"&&x.id===t&&typeof x.api==="number"&&x.api<=${THEME_API}&&typeof x.v==="string"&&${PACK_VERSION.toString()}.test(x.v))k=x}}catch(e){}}` +
    `if(!k)t=${j(INITIAL_THEME_ID)}}` +
    `d.dataset.theme=t;if(k?k.base!=="foundation":${j(onFrost())}.indexOf(t)>=0)d.dataset.themeBase="modern";` +
    `if(k){try{document.write('<link rel="stylesheet" data-theme-pack="'+t+'" href="/api/themes/'+t+'/files/index.css?v='+k.v+'">')}catch(e){}}` +
    `var a=s.getItem(${j(K.accent)}),n=${j(ACCENT_PRESET_IDS)}.indexOf(a)>=0;` +
    `if(!n&&k&&k.accent&&typeof k.accent==="object"&&Array.isArray(k.accent.presets)&&a!==null&&${PRESET_ID.toString()}.test(a))` +
    `for(i=0;i<k.accent.presets.length;i++){x=k.accent.presets[i];if(x&&typeof x==="object"&&x.id===a)n=true}` +
    "if(n)d.dataset.accent=a;"
  );
}

/** The theme and accent part for a page with no theme server: built-in ids and presets only. */
function staticTheme(): string {
  return (
    `var t=s.getItem(${j(K.themeId)});if(${j(THEME_IDS)}.indexOf(t)<0)t=${j(INITIAL_THEME_ID)};` +
    `d.dataset.theme=t;if(${j(onFrost())}.indexOf(t)>=0)d.dataset.themeBase="modern";` +
    `var a=s.getItem(${j(K.accent)});if(${j(ACCENT_PRESET_IDS)}.indexOf(a)>=0)d.dataset.accent=a;`
  );
}

/** The whole script around one theme part: the mode first, then the theme, the faces, the size, the background. */
function prePaint(theme: string): string {
  return (
    "(function(){try{" +
    `var d=document.documentElement,s=localStorage,m=s.getItem(${j(K.mode)});` +
    'if(m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))d.classList.add("dark");' +
    theme +
    `var l=s.getItem(${j(K.fontLatin)});if(${j(chosenFaces(FONT_LATIN_OPTIONS))}.indexOf(l)>=0)d.dataset.fontLatin=l;` +
    `var c=s.getItem(${j(K.fontCjk)});if(${j(chosenFaces(FONT_CJK_OPTIONS))}.indexOf(c)>=0)d.dataset.fontCjk=c;` +
    `var z=s.getItem(${j(K.textSize)}),g=null,o=-1;` +
    `if(${j(TEXT_SIZES)}.indexOf(z)<0){g=s.getItem(${j(K.fontScale)});o=${j(LEGACY_FONT_SCALES)}.indexOf(g);z=o<0?${j(DEFAULT_TEXT_SIZE)}:${j(LEGACY_FONT_SCALE_SIZES)}[o]}` +
    `d.style.fontSize=${j(TEXT_SIZE_PX)}[z];` +
    `if(g!==null){try{if(o>=0)s.setItem(${j(K.textSize)},z);s.removeItem(${j(K.fontScale)})}catch(e){}}` +
    // The stored background, as `readBackground` and `backgroundLayerStyle` read it, on the boot
    // layer's properties. Settings that do not parse fall back as a whole, as the reader's do.
    `var w=s.getItem(${j(B.image)});` +
    `if(typeof w==="string"&&${BACKGROUND_IMAGE_PATTERN.toString()}.test(w)){` +
    `var b=null;try{b=JSON.parse(s.getItem(${j(B.settings)}))}catch(e){}if(!b||typeof b!=="object")b={};` +
    `var r=b.transparency;r=typeof r==="number"&&isFinite(r)?Math.min(100,Math.max(0,r)):${j(DEFAULT_BACKGROUND_SETTINGS.transparency)};` +
    `var u=${j(BACKGROUND_MODES)}.indexOf(b.mode)<0?${j(DEFAULT_BACKGROUND_SETTINGS.mode)}:b.mode;` +
    `var p=${j(BACKGROUND_POSITIONS)}.indexOf(b.position)<0?${j(DEFAULT_BACKGROUND_SETTINGS.position)}:b.position;` +
    `var y=d.style;y.setProperty(${j(P.image)},'url("'+w+'")');` +
    `y.setProperty(${j(P.size)},u==="tile"||u==="original"?"auto":u);` +
    `y.setProperty(${j(P.repeat)},u==="tile"?"repeat":"no-repeat");` +
    `y.setProperty(${j(P.position)},p);y.setProperty(${j(P.opacity)},String(1-r/100));` +
    'd.dataset.bootWallpaper=""}' +
    "}catch(e){}})()"
  );
}
