/**
 * Theme attributes on <html>, applied twice: once before the first paint by {@link BOOT_SCRIPT}
 * (inlined into the app's index.html), and from then on by the app's theme provider through
 * {@link applyThemeAttributes}.
 *
 * The pre-paint pass is what keeps a dark or non-default-theme page from flashing the light
 * default while the bundle loads, keeps the first frame from rendering at the browser's 16px
 * root and reflowing once React applies the stored text size, and keeps a chosen font pairing
 * from swapping in after the first paint.
 *
 * The inline copy in index.html must equal {@link BOOT_SCRIPT} byte for byte; a test asserts it.
 * Change the constants here, then paste the regenerated string there.
 */
import { ACCENT_PRESET_IDS, DEFAULT_THEME_ID, THEME_IDS } from "./tokens";
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
 * and chrome sans (`--ui-font-sans`, which `--ui-font-ui` follows in Primer and Frost); a
 * theme's mono face is never replaced — Console's chrome stays mono, its identity, and a
 * pairing only changes what Console reads in.
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
  "Commit Mono": "Commit Mono",
} as const;
export type BundledFontName = keyof typeof BUNDLED_FONT_FAMILIES;

/** A theme that names no bundled face names the platform's own; a consumer words this. */
export const SYSTEM_FONT = "System";
export type ThemeFontName = BundledFontName | typeof SYSTEM_FONT;

export interface ThemeFonts {
  /** The reading / UI sans (`--ui-font-sans`); Console's chrome is its mono face on top of it. */
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
  github: { latin: SYSTEM_FONT, cjk: SYSTEM_FONT, mono: SYSTEM_FONT },
  modern: { latin: "MiSans", cjk: "MiSans", mono: "JetBrains Mono" },
  geek: { latin: "IBM Plex Sans", cjk: "Noto Sans SC", mono: "Commit Mono" },
};

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
 * default theme, no preset, the theme's face) is the ABSENCE of the attribute, so a theme file's
 * plain selectors match it and nothing has to name a default.
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

const NON_DEFAULT_THEMES = THEME_IDS.filter((id) => id !== DEFAULT_THEME_ID);
/** The ids that write an attribute: every option but `theme`, which is the attribute's absence. */
const chosenFaces = (options: readonly FontOption[]) =>
  optionIds(options).filter((id) => id !== "theme");
const j = JSON.stringify;
const K = THEME_STORAGE_KEYS;

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
  `var t=s.getItem(${j(K.themeId)});if(${j(NON_DEFAULT_THEMES)}.indexOf(t)>=0)d.dataset.theme=t;` +
  `var a=s.getItem(${j(K.accent)});if(${j(ACCENT_PRESET_IDS)}.indexOf(a)>=0)d.dataset.accent=a;` +
  `var l=s.getItem(${j(K.fontLatin)});if(${j(chosenFaces(FONT_LATIN_OPTIONS))}.indexOf(l)>=0)d.dataset.fontLatin=l;` +
  `var c=s.getItem(${j(K.fontCjk)});if(${j(chosenFaces(FONT_CJK_OPTIONS))}.indexOf(c)>=0)d.dataset.fontCjk=c;` +
  `var z=s.getItem(${j(K.textSize)}),g=null,o=-1;` +
  `if(${j(TEXT_SIZES)}.indexOf(z)<0){g=s.getItem(${j(K.fontScale)});o=${j(LEGACY_FONT_SCALES)}.indexOf(g);z=o<0?${j(DEFAULT_TEXT_SIZE)}:${j(LEGACY_FONT_SCALE_SIZES)}[o]}` +
  `d.style.fontSize=${j(TEXT_SIZE_PX)}[z];` +
  `if(g!==null){try{if(o>=0)s.setItem(${j(K.textSize)},z);s.removeItem(${j(K.fontScale)})}catch(e){}}` +
  "}catch(e){}})()";
