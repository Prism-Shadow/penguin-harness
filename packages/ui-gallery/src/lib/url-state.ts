/**
 * The gallery's view state, which lives in the URL so any view can be quoted as a link.
 *
 *   /c/conversation?theme=geek&mode=dark&tier=md&lang=zh&accent=neutral&compare=conversation.approval&view=phone#approval
 *
 * `theme`, `mode`, `tier`, `lang` and `accent` are always written out — they are also the
 * preferences a fresh visit restores from the last one, so a copied link must pin them or it would
 * open on the reader's own — and a link keeps meaning the same thing if a default ever changes.
 * `compare`, `view`, `motion` and the picks appear only when set: `compare=1` frames every
 * variant on every page in the three themes, `compare=<module>` every variant of that module's
 * page and `compare=<module>.<variant>` only that one section; `view=phone` frames every
 * composition at phone width; a pick is `v.<part-id>=<key>` (`v.actions-button=danger.sm`), which
 * a part demo in a page's Parts section reads. Pure: parsing never throws, and an unknown or
 * missing value falls back to the caller's fallback (the last-used value) and then to the default.
 */
import { DEFAULT_THEME_ID, THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { FontScale } from "@prismshadow/penguin-ui/boot";
import { MODULE_IDS } from "../../../ui/src/module";
import type { ModuleId } from "../../../ui/src/module";
import { ACCENT_IDS, THEME_ACCENT } from "./accents";

export const MODE_PREFS = ["light", "dark", "system"] as const;
export type ModePref = (typeof MODE_PREFS)[number];

export const TIERS = ["sm", "md", "lg"] as const satisfies readonly FontScale[];

export const LANGS = ["en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

export const MOTIONS = ["full", "reduced"] as const;
export type Motion = (typeof MOTIONS)[number];

/** Desktop: a composition at the column's width. Phone: each composition in a 390 px frame. */
export const VIEWS = ["desktop", "phone"] as const;
export type View = (typeof VIEWS)[number];

/** The phone frame's width in CSS px: an iPhone-class viewport, and a plain frame, no device art. */
export const PHONE_WIDTH = 390;

/** One variant's section compared across the themes: `compare=<module>.<variant>`. */
export interface VariantCompare {
  module: ModuleId;
  variant: string;
}

/** `false`, every page (`true`), one module's page, or one variant of it. */
export type Compare = boolean | ModuleId | VariantCompare;

export interface GalleryState {
  theme: ThemeId;
  mode: ModePref;
  tier: FontScale;
  lang: Lang;
  /**
   * An accent preset id, or `neutral` for the theme's own accent (随主题). Kept as chosen even
   * when the active theme does not list it: it resolves to the theme's own accent for now and
   * comes back when the reader returns to a theme that lists it.
   */
  accent: string;
  compare: Compare;
  view: View;
  motion: Motion;
  /** Part id → the key its axis pills select. Only non-default picks are kept. */
  variants: Readonly<Record<string, string>>;
}

export const DEFAULT_STATE: GalleryState = {
  theme: DEFAULT_THEME_ID,
  mode: "light",
  tier: "md",
  lang: "en",
  accent: THEME_ACCENT,
  compare: false,
  view: "desktop",
  motion: "full",
  variants: {},
};

/** The five preferences a fresh visit restores from the last one when the URL omits them. */
export type RememberedPrefs = Partial<
  Pick<GalleryState, "theme" | "mode" | "tier" | "lang" | "accent">
>;
export const PREF_KEYS = ["theme", "mode", "tier", "lang", "accent"] as const;

const VARIANT_PREFIX = "v.";

/** Variant keys never hold a `.` (lib/modules.ts), so it separates a module from its variant. */
const COMPARE_SEPARATOR = ".";

function pick<T extends string>(
  allowed: readonly T[],
  ...candidates: (string | null | undefined)[]
): T | undefined {
  for (const value of candidates) {
    if (value != null && (allowed as readonly string[]).includes(value)) return value as T;
  }
  return undefined;
}

function parseCompare(value: string | null): Compare {
  if (value === null) return false;
  if (value === "1") return true;
  const whole = pick(MODULE_IDS, value);
  if (whole !== undefined) return whole;
  const dot = value.indexOf(COMPARE_SEPARATOR);
  if (dot === -1) return false;
  const module = pick(MODULE_IDS, value.slice(0, dot));
  const variant = value.slice(dot + 1);
  return module !== undefined && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(variant)
    ? { module, variant }
    : false;
}

function formatCompare(compare: Compare): string | null {
  if (compare === false) return null;
  if (compare === true) return "1";
  if (typeof compare === "string") return compare;
  return `${compare.module}${COMPARE_SEPARATOR}${compare.variant}`;
}

export function parseGalleryState(search: string, remembered: RememberedPrefs = {}): GalleryState {
  const params = new URLSearchParams(search);
  const variants: Record<string, string> = {};
  for (const [key, value] of params) {
    if (key.startsWith(VARIANT_PREFIX) && key.length > VARIANT_PREFIX.length && value !== "") {
      variants[key.slice(VARIANT_PREFIX.length)] = value;
    }
  }
  return {
    theme: pick(THEME_IDS, params.get("theme"), remembered.theme) ?? DEFAULT_STATE.theme,
    mode: pick(MODE_PREFS, params.get("mode"), remembered.mode) ?? DEFAULT_STATE.mode,
    tier: pick(TIERS, params.get("tier"), remembered.tier) ?? DEFAULT_STATE.tier,
    lang: pick(LANGS, params.get("lang"), remembered.lang) ?? DEFAULT_STATE.lang,
    accent: pick(ACCENT_IDS, params.get("accent"), remembered.accent) ?? DEFAULT_STATE.accent,
    compare: parseCompare(params.get("compare")),
    view: pick(VIEWS, params.get("view")) ?? DEFAULT_STATE.view,
    motion: pick(MOTIONS, params.get("motion")) ?? DEFAULT_STATE.motion,
    variants,
  };
}

/** A readable query component: `encodeURIComponent` keeps `-_.!~*'()` as they are. */
const enc = encodeURIComponent;

/**
 * The canonical query string (with its leading `?`) for a state. `extra` params (the embed
 * route's `module`, `demo` and `variant`) come right after the five preferences, in the order given.
 */
export function formatGalleryQuery(
  state: GalleryState,
  extra: Readonly<Record<string, string>> = {},
): string {
  const parts = [
    `theme=${enc(state.theme)}`,
    `mode=${enc(state.mode)}`,
    `tier=${enc(state.tier)}`,
    `lang=${enc(state.lang)}`,
    `accent=${enc(state.accent)}`,
  ];
  for (const [key, value] of Object.entries(extra)) parts.push(`${enc(key)}=${enc(value)}`);
  const compare = formatCompare(state.compare);
  if (compare !== null) parts.push(`compare=${enc(compare)}`);
  if (state.view !== DEFAULT_STATE.view) parts.push(`view=${enc(state.view)}`);
  if (state.motion !== DEFAULT_STATE.motion) parts.push(`motion=${enc(state.motion)}`);
  for (const id of Object.keys(state.variants).sort()) {
    parts.push(`${VARIANT_PREFIX}${enc(id)}=${enc(state.variants[id] ?? "")}`);
  }
  return `?${parts.join("&")}`;
}

/** `system` resolved against the OS preference; every other mode is itself. */
export function resolveMode(mode: ModePref, prefersDark: boolean): "light" | "dark" {
  return mode === "system" ? (prefersDark ? "dark" : "light") : mode;
}

/** Whether every variant of a module's page renders its three compare frames. */
export function comparesModule(state: GalleryState, id: string): boolean {
  return state.compare === true || state.compare === id;
}

/** Whether one variant's section renders its three compare frames. */
export function comparesVariant(state: GalleryState, id: string, variant: string): boolean {
  if (comparesModule(state, id)) return true;
  const { compare } = state;
  return typeof compare === "object" && compare.module === id && compare.variant === variant;
}

/**
 * The state with one variant's compare toggled: on, it pins that variant (`compare=<module>.<variant>`);
 * off, it clears whatever compare covered it, since a page-wide or site-wide compare cannot
 * except one section.
 */
export function withVariantCompare(
  state: GalleryState,
  id: ModuleId,
  variant: string,
  on: boolean,
): GalleryState {
  return { ...state, compare: on ? { module: id, variant } : false };
}

/** Sets (or, for the default key, clears) one part's pick. */
export function withVariant(state: GalleryState, id: string, key: string | null): GalleryState {
  const variants = { ...state.variants };
  if (key === null) delete variants[id];
  else variants[id] = key;
  return { ...state, variants };
}
