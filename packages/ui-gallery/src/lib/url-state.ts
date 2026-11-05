/**
 * The gallery's view state, which lives in the URL so any view can be quoted as a link.
 *
 *   /s/chat?theme=geek&mode=dark&size=l&latin=mona-sans&cjk=theme&lang=zh&accent=neutral&view=phone
 *
 * `theme`, `mode`, `size`, `latin`, `cjk`, `lang` and `accent` are always written out — they are
 * also the preferences a fresh visit restores from the last one, so a copied link must pin them
 * or it would open on the reader's own — and a link keeps meaning the same thing if a default
 * ever changes. `view` appears only when set: `view=phone` frames every surface at phone width.
 * Pure: parsing never throws, and an unknown or missing value falls back to the caller's
 * fallback (the last-used value) and then to the default.
 *
 * The preferences are the app's own: the frame writes them under the app's storage keys, and the
 * gallery's root applies them through the package's `applyThemeAttributes`, so a size or a font
 * pairing chosen here is what a user of the app would have chosen in its Settings.
 */
import { INITIAL_THEME_ID, THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import { DEFAULT_TEXT_SIZE, TEXT_SIZES } from "@prismshadow/penguin-ui/boot";
import type { TextSize } from "@prismshadow/penguin-ui/boot";
import { ACCENT_IDS, THEME_ACCENT } from "./accents";
import { CJK_FONTS, LATIN_FONTS, LEGACY_SIZES } from "./themes";
import type { FontCjk, FontLatin } from "./themes";

export const MODE_PREFS = ["light", "dark", "system"] as const;
export type ModePref = (typeof MODE_PREFS)[number];

export const LANGS = ["en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

/** Desktop: the app at its window width. Phone: the app in a 390 px frame. */
export const VIEWS = ["desktop", "phone"] as const;
export type View = (typeof VIEWS)[number];

export interface GalleryState {
  theme: ThemeId;
  mode: ModePref;
  size: TextSize;
  latin: FontLatin;
  cjk: FontCjk;
  lang: Lang;
  /**
   * An accent preset id, or `neutral` for the theme's own accent (随主题). Kept as chosen even
   * when the active theme does not list it: it resolves to the theme's own accent for now and
   * comes back when the reader returns to a theme that lists it.
   */
  accent: string;
  view: View;
}

export const DEFAULT_STATE: GalleryState = {
  theme: INITIAL_THEME_ID,
  mode: "light",
  size: DEFAULT_TEXT_SIZE,
  latin: "theme",
  cjk: "theme",
  lang: "en",
  accent: THEME_ACCENT,
  view: "desktop",
};

/** The seven preferences a fresh visit restores from the last one when the URL omits them. */
export const PREF_KEYS = ["theme", "mode", "size", "latin", "cjk", "lang", "accent"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type RememberedPrefs = Partial<Pick<GalleryState, PrefKey>>;

/**
 * The five the gallery stores under its own keys. The mode and the language are the site's: the
 * landing page and the docs keep them under shared keys, and the site navbar sets them here too.
 */
export const GALLERY_PREF_KEYS = ["theme", "size", "latin", "cjk", "accent"] as const;

/** The site's language preference: one of the two languages, or the device's. */
export const SITE_LANG_PREFS = ["zh", "en", "system"] as const;
export type SiteLangPref = (typeof SITE_LANG_PREFS)[number];

function pick<T extends string>(
  allowed: readonly T[],
  ...candidates: (string | null | undefined)[]
): T | undefined {
  for (const value of candidates) {
    if (value != null && (allowed as readonly string[]).includes(value)) return value as T;
  }
  return undefined;
}

/** A `size=` value, with the retired `tier=` scale (sm / md / lg) read the way the app migrates it. */
function parseSize(params: URLSearchParams): string | null {
  const size = params.get("size");
  if (size !== null) return LEGACY_SIZES[size] ?? size;
  const tier = params.get("tier");
  return tier === null ? null : (LEGACY_SIZES[tier] ?? null);
}

export function parseGalleryState(search: string, remembered: RememberedPrefs = {}): GalleryState {
  const params = new URLSearchParams(search);
  return {
    theme: pick(THEME_IDS, params.get("theme"), remembered.theme) ?? DEFAULT_STATE.theme,
    mode: pick(MODE_PREFS, params.get("mode"), remembered.mode) ?? DEFAULT_STATE.mode,
    size: pick(TEXT_SIZES, parseSize(params), remembered.size) ?? DEFAULT_STATE.size,
    latin: pick(LATIN_FONTS, params.get("latin"), remembered.latin) ?? DEFAULT_STATE.latin,
    cjk: pick(CJK_FONTS, params.get("cjk"), remembered.cjk) ?? DEFAULT_STATE.cjk,
    lang: pick(LANGS, params.get("lang"), remembered.lang) ?? DEFAULT_STATE.lang,
    accent: pick(ACCENT_IDS, params.get("accent"), remembered.accent) ?? DEFAULT_STATE.accent,
    view: pick(VIEWS, params.get("view")) ?? DEFAULT_STATE.view,
  };
}

/** A language preference as the site resolves it: `system` takes the device's, zh* is zh. */
export function resolveSiteLang(pref: SiteLangPref, deviceLanguage: string | undefined): Lang {
  if (pref !== "system") return pref;
  return deviceLanguage?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

/** What storage holds: the gallery's own keys (`penguin-gallery.<key>`) and the site's two. */
export interface StoredPrefs {
  gallery: Partial<Record<PrefKey, string>>;
  siteTheme: ModePref | null;
  siteLang: SiteLangPref | null;
}

/**
 * The preferences a visit restores when its URL omits them. The mode and the language follow the
 * site, defaulting as there to the system's. The gallery stored its own `mode` and `lang` before
 * the three sites shared them; those are read only while the site has no value of its own, so a
 * returning reader keeps the choice they made here. Whoever prepares the 0.3.0 release removes
 * that fallback and its test scenario; a reader with only the old keys then opens once in the
 * system's mode and language.
 */
export function rememberedPrefs(
  stored: StoredPrefs,
  deviceLanguage: string | undefined,
): RememberedPrefs {
  const { gallery, siteTheme, siteLang } = stored;
  const own: Record<string, string> = {};
  for (const key of GALLERY_PREF_KEYS) {
    const value = gallery[key];
    if (value) own[key] = value;
  }
  return {
    ...(own as RememberedPrefs),
    mode: siteTheme ?? pick(MODE_PREFS, gallery.mode) ?? "system",
    lang: resolveSiteLang(siteLang ?? pick(LANGS, gallery.lang) ?? "system", deviceLanguage),
  };
}

/** A readable query component: `encodeURIComponent` keeps `-_.!~*'()` as they are. */
const enc = encodeURIComponent;

/**
 * The canonical query string (with its leading `?`) for a state. `extra` params come right after
 * the preferences, in the order given.
 */
export function formatGalleryQuery(
  state: GalleryState,
  extra: Readonly<Record<string, string>> = {},
): string {
  const parts = PREF_KEYS.map((key) => `${key}=${enc(state[key])}`);
  for (const [key, value] of Object.entries(extra)) parts.push(`${enc(key)}=${enc(value)}`);
  if (state.view !== DEFAULT_STATE.view) parts.push(`view=${enc(state.view)}`);
  return `?${parts.join("&")}`;
}

/** `system` resolved against the OS preference; every other mode is itself. */
export function resolveMode(mode: ModePref, prefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}
