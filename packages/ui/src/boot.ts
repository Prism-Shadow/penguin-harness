/**
 * Theme attributes on <html>, applied twice: once before the first paint by {@link BOOT_SCRIPT}
 * (inlined into the app's index.html), and from then on by the app's theme provider through
 * {@link applyThemeAttributes}.
 *
 * The pre-paint pass is what keeps a dark or non-default-theme page from flashing the light
 * default while the bundle loads, and what keeps the first frame from rendering at the browser's
 * 16px root and reflowing once React applies the stored font scale.
 *
 * The inline copy in index.html must equal {@link BOOT_SCRIPT} byte for byte; a test asserts it.
 * Change the constants here, then paste the regenerated string there.
 */
import { ACCENT_PRESET_IDS, DEFAULT_THEME_ID, THEME_IDS } from "./tokens";
import type { AccentPreset, ThemeId } from "./tokens";

/** localStorage keys. `penguin.theme` predates themes and stores the MODE (light / dark / system). */
export const THEME_STORAGE_KEYS = {
  mode: "penguin.theme",
  themeId: "penguin.themeId",
  accent: "penguin.accent",
  fontScale: "penguin.fontScale",
} as const;

export type FontScale = "sm" | "md" | "lg";

/** Font-scale tier → root font-size. Every type and density token is rem, so this scales them all. */
export const FONT_SCALE_PX: Readonly<Record<FontScale, string>> = {
  sm: "16px",
  md: "18px",
  lg: "20px",
};

export const DEFAULT_FONT_SCALE: FontScale = "md";

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
  fontScale: FontScale;
}

/**
 * Writes the given attributes onto `root`. Each field is optional so a provider can reconcile one
 * preference per effect; an absent field is left as it is.
 */
export function applyThemeAttributes(root: HTMLElement, attrs: Partial<ThemeAttributes>): void {
  if (attrs.dark !== undefined) root.classList.toggle("dark", attrs.dark);
  if (attrs.themeId !== undefined) {
    // The default theme's selectors match a bare <html>, so it carries no attribute at all.
    if (attrs.themeId === DEFAULT_THEME_ID) delete root.dataset.theme;
    else root.dataset.theme = attrs.themeId;
  }
  if (attrs.accent !== undefined) {
    if (attrs.accent === "neutral") delete root.dataset.accent;
    else root.dataset.accent = attrs.accent;
  }
  if (attrs.fontScale !== undefined) root.style.fontSize = FONT_SCALE_PX[attrs.fontScale];
}

const NON_DEFAULT_THEMES = THEME_IDS.filter((id) => id !== DEFAULT_THEME_ID);

/**
 * The pre-paint script: a classic, dependency-free IIFE (no globals leak) that mirrors
 * {@link applyThemeAttributes} for the stored preferences. It validates every stored value the
 * way the provider's initializers do, so an unknown value renders exactly as the provider will,
 * and it swallows everything — storage can throw (disabled cookies, sandboxed frames) and the
 * page must still render.
 */
export const BOOT_SCRIPT =
  "(function(){try{" +
  "var d=document.documentElement,s=localStorage," +
  `m=s.getItem(${JSON.stringify(THEME_STORAGE_KEYS.mode)});` +
  'if(m==="dark"||(m!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches))d.classList.add("dark");' +
  `var t=s.getItem(${JSON.stringify(THEME_STORAGE_KEYS.themeId)});` +
  `if(${JSON.stringify(NON_DEFAULT_THEMES)}.indexOf(t)>=0)d.dataset.theme=t;` +
  `var a=s.getItem(${JSON.stringify(THEME_STORAGE_KEYS.accent)});` +
  `if(${JSON.stringify(ACCENT_PRESET_IDS)}.indexOf(a)>=0)d.dataset.accent=a;` +
  `var f=${JSON.stringify(FONT_SCALE_PX)}[s.getItem(${JSON.stringify(THEME_STORAGE_KEYS.fontScale)})];` +
  `d.style.fontSize=typeof f==="string"?f:${JSON.stringify(FONT_SCALE_PX[DEFAULT_FONT_SCALE])}` +
  "}catch(e){}})()";
