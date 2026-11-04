/**
 * Theme attributes on <html>, applied twice: once before the first paint by {@link BOOT_SCRIPT}
 * (inlined into the app's index.html), and from then on by the app's theme provider through
 * {@link applyThemeAttributes}.
 *
 * The pre-paint pass is what keeps a dark page, or one in any theme but the stylesheet's
 * fallback, from flashing that fallback while the bundle loads, keeps the first frame from
 * rendering at the browser's 16px root and reflowing once React applies the stored text size,
 * keeps a chosen font pairing from swapping in after the first paint, and lays a stored custom
 * background on the boot layer (wallpaper.css) until the first screen of the app mounts, so a
 * reload never shows the bare page colour where the image will be.
 *
 * The inline copy in index.html must equal {@link BOOT_SCRIPT} byte for byte; a test asserts it.
 * Change the constants here, then paste the regenerated string there.
 */
import { ACCENT_PRESET_IDS, DEFAULT_THEME_ID, INITIAL_THEME_ID, THEME_IDS } from "./tokens";
import type { AccentPreset, ThemeId } from "./tokens";

/**
 * localStorage keys. `penguin.theme` predates themes and stores the MODE (light / dark / system).
 * `penguin.fontScale` is the key of the retired three-step size: {@link readTextSize} reads it
 * once, maps it and removes it; nothing writes it. Drop it with the next minor version.
 */
export const THEME_STORAGE_KEYS = {
  mode: "penguin.theme",
  themeId: "penguin.themeId",
  accent: "penguin.accent",
  textSize: "penguin.textSize",
  fontLatin: "penguin.fontLatin",
  fontCjk: "penguin.fontCjk",
  fontScale: "penguin.fontScale",
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

/**
 * Each theme's own faces, as display names — what the Fonts page states as a theme's defaults
 * beside the user's choice. A test holds every entry to the family its theme file's stack names
 * first (`System` = a stack that names no bundled family).
 */
export const THEME_FONTS: Readonly<Record<ThemeId, ThemeFonts>> = {
  github: { latin: SYSTEM_FONT, cjk: SYSTEM_FONT, mono: "JetBrains Mono" },
  modern: { latin: "MiSans", cjk: "MiSans", mono: "JetBrains Mono" },
  geek: { latin: "IBM Plex Sans", cjk: "Noto Sans SC", mono: "JetBrains Mono" },
};

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
  themeId: ThemeId;
  accent: AccentChoice;
  textSize: TextSize;
  /** `theme` is the theme's own face and writes no attribute, like `neutral` for the accent. */
  fontLatin: FontLatin;
  fontCjk: FontCjk;
}

/**
 * The three `data-*` attributes share one rule: the value that means "the theme's own" (the
 * stylesheet's fallback theme, no preset, the theme's face) is the ABSENCE of the attribute, so a
 * theme file's plain selectors match it and nothing has to name a default.
 */
function setOrDrop(root: HTMLElement, key: string, value: string, own: string): void {
  if (value === own) delete root.dataset[key];
  else root.dataset[key] = value;
}

/**
 * Writes the given attributes onto `root`. Each field is optional so a provider can reconcile one
 * preference per effect; an absent field is left as it is.
 */
export function applyThemeAttributes(root: HTMLElement, attrs: Partial<ThemeAttributes>): void {
  if (attrs.dark !== undefined) root.classList.toggle("dark", attrs.dark);
  if (attrs.themeId !== undefined) setOrDrop(root, "theme", attrs.themeId, DEFAULT_THEME_ID);
  if (attrs.accent !== undefined) setOrDrop(root, "accent", attrs.accent, "neutral");
  if (attrs.fontLatin !== undefined) setOrDrop(root, "fontLatin", attrs.fontLatin, "theme");
  if (attrs.fontCjk !== undefined) setOrDrop(root, "fontCjk", attrs.fontCjk, "theme");
  if (attrs.textSize !== undefined) root.style.fontSize = TEXT_SIZE_PX[attrs.textSize];
}

// ---------------------------------------------------------------------------
// The pre-paint script
// ---------------------------------------------------------------------------

/** The ids that write an attribute: every option but `theme`, which is the attribute's absence. */
const chosenFaces = (options: readonly FontOption[]) =>
  optionIds(options).filter((id) => id !== "theme");
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
 */
export const BOOT_SCRIPT =
  "(function(){try{" +
  `var d=document.documentElement,s=localStorage,m=s.getItem(${j(K.mode)});` +
  'if(m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))d.classList.add("dark");' +
  `var t=s.getItem(${j(K.themeId)});if(${j(THEME_IDS)}.indexOf(t)<0)t=${j(INITIAL_THEME_ID)};if(t!==${j(DEFAULT_THEME_ID)})d.dataset.theme=t;` +
  `var a=s.getItem(${j(K.accent)});if(${j(ACCENT_PRESET_IDS)}.indexOf(a)>=0)d.dataset.accent=a;` +
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
  "}catch(e){}})()";
