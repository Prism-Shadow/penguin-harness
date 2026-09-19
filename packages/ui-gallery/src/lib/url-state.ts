/**
 * The gallery's view state, which lives in the URL so any view can be quoted as a link.
 *
 *   /?theme=geek&mode=dark&tier=md&lang=zh&compare=conversation&v.conversation=approval#conversation
 *
 * `theme`, `mode`, `tier` and `lang` are always written out, so a copied link keeps meaning the
 * same thing if a default ever changes. `compare`, `motion` and the picks appear only when set:
 * `compare=1` puts every module in three frames and `compare=<module>` only that one; a pick is
 * `v.<id>=<key>`, where the id is a module's (`v.conversation=approval`) or, inside a Parts drawer,
 * a part's (`v.actions-button=danger.sm`) — module ids have no `-` and part ids always do, so the two
 * never collide. Pure: parsing never throws, and an unknown or missing value falls back to the
 * caller's fallback (the last-used value) and then to the default.
 */
import { DEFAULT_THEME_ID, THEME_IDS } from "@prismshadow/penguin-ui";
import type { ThemeId } from "@prismshadow/penguin-ui";
import type { FontScale } from "@prismshadow/penguin-ui/boot";
import { MODULE_IDS } from "../../../ui/src/module";
import type { ModuleId } from "../../../ui/src/module";

export const MODE_PREFS = ["light", "dark", "system"] as const;
export type ModePref = (typeof MODE_PREFS)[number];

export const TIERS = ["sm", "md", "lg"] as const satisfies readonly FontScale[];

export const LANGS = ["en", "zh"] as const;
export type Lang = (typeof LANGS)[number];

export const MOTIONS = ["full", "reduced"] as const;
export type Motion = (typeof MOTIONS)[number];

export interface GalleryState {
  theme: ThemeId;
  mode: ModePref;
  tier: FontScale;
  lang: Lang;
  /** `true`: every module renders one frame per theme; a module id: only that module does. */
  compare: boolean | ModuleId;
  motion: Motion;
  /** Module or part id → the key its pills select. Only non-default picks are kept. */
  variants: Readonly<Record<string, string>>;
}

export const DEFAULT_STATE: GalleryState = {
  theme: DEFAULT_THEME_ID,
  mode: "light",
  tier: "md",
  lang: "en",
  compare: false,
  motion: "full",
  variants: {},
};

/** The four preferences a fresh visit restores from the last one when the URL omits them. */
export type RememberedPrefs = Partial<Pick<GalleryState, "theme" | "mode" | "tier" | "lang">>;

const VARIANT_PREFIX = "v.";

function pick<T extends string>(
  allowed: readonly T[],
  ...candidates: (string | null | undefined)[]
): T | undefined {
  for (const value of candidates) {
    if (value != null && (allowed as readonly string[]).includes(value)) return value as T;
  }
  return undefined;
}

function parseCompare(value: string | null): GalleryState["compare"] {
  if (value === "1") return true;
  return pick(MODULE_IDS, value) ?? false;
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
    compare: parseCompare(params.get("compare")),
    motion: pick(MOTIONS, params.get("motion")) ?? DEFAULT_STATE.motion,
    variants,
  };
}

/** A readable query component: `encodeURIComponent` keeps `-_.!~*'()` as they are. */
const enc = encodeURIComponent;

/**
 * The canonical query string (with its leading `?`) for a state. `extra` params (the embed
 * route's `module`, `demo` and `variant`) come right after the four preferences, in the order given.
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
  ];
  for (const [key, value] of Object.entries(extra)) parts.push(`${enc(key)}=${enc(value)}`);
  if (state.compare !== false)
    parts.push(`compare=${state.compare === true ? "1" : state.compare}`);
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

/** Whether a module renders its three compare frames. */
export function comparesModule(state: GalleryState, id: string): boolean {
  return state.compare === true || state.compare === id;
}

/** Sets (or, for the default key, clears) one module's or part's pick. */
export function withVariant(state: GalleryState, id: string, key: string | null): GalleryState {
  const variants = { ...state.variants };
  if (key === null) delete variants[id];
  else variants[id] = key;
  return { ...state, variants };
}
