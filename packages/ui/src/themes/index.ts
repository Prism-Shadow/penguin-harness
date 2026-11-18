/**
 * The theme-pack registry: the built-in packs' manifests, in the order every list offers them.
 *
 * A theme is a pack — a folder `themes/<id>/` holding its manifest (`pack.json`), its token rules
 * (`tokens.css`), its hook recipes (`recipes.css`, optional), its accent presets (`accents.css`)
 * and its faces (`fonts.css`), with an `index.css` that serves each file in its cascade layer.
 * Frost (`modern`) is the base: its values sit on the bare root and its recipes key on
 * `data-theme-base="modern"`, in `ui-base`, so every pack starts from Frost and declares what it
 * changes in `ui-theme`. A manifest's `base` says whether the pack also takes Frost's recipes
 * (`modern`) or starts from the foundation alone (`foundation`: Primer and Console).
 *
 * The manifest is the one source of what the tables in tokens.ts and boot.ts hold — the ids, the
 * accent presets and the theme's own accent, the faces — and of what a picker draws: nothing is
 * derived from CSS at run time. The contract test holds every manifest to its folder's CSS.
 */
import type { AccentPresetSpec, ThemeModeName } from "../tokens";
import doodle from "./doodle/pack.json" with { type: "json" };
import geek from "./geek/pack.json" with { type: "json" };
import github from "./github/pack.json" with { type: "json" };
import modern from "./modern/pack.json" with { type: "json" };

/**
 * The theme API a build implements: the token, hook, slot and attribute set a pack is written
 * against. It goes up when a name is removed or renamed, or when the attributes on `<html>`
 * change; an addition does not move it. A pack names the API it targets in `pack.json`.
 */
export const THEME_API = 1;

/**
 * What a pack builds on. `modern`: Frost's values and its hook recipes (the root carries
 * `data-theme-base="modern"`). `foundation`: Frost's values only, as the fallback for a name the
 * pack leaves out, and none of its recipes.
 */
export type ThemeBase = "modern" | "foundation";

/** The three colours a picker draws for a pack in one mode. */
export interface ThemePackSwatch {
  readonly canvas: string;
  readonly ink: string;
  readonly accent: string;
}

/**
 * A pack's manifest, `pack.json`. Colours are spelled as hex so a picker paints them without a
 * stylesheet probe; `fonts` names the family each stack puts first, as its `@font-face` declares
 * it (or the generic family where the stack starts with one).
 */
export interface ThemePackManifest {
  /** The theme API the pack targets ({@link THEME_API}). */
  readonly api: number;
  /** Lowercase, `^[a-z][a-z0-9-]{1,31}$`; the built-in ids are reserved. */
  readonly id: string;
  readonly names: { readonly zh: string; readonly en: string };
  /** The pack's own semver. */
  readonly version: string;
  readonly base: ThemeBase;
  /** The modes the pack declares; a mode it leaves out renders from the base. */
  readonly modes: readonly ThemeModeName[];
  readonly swatches: Readonly<Record<ThemeModeName, ThemePackSwatch>>;
  readonly accent: {
    /** The theme's own accent per mode: what `neutral` paints. */
    readonly own: Readonly<Record<ThemeModeName, string>>;
    /** The presets, in the picker's order; each id is declared in `accents.css`. */
    readonly presets: readonly AccentPresetSpec[];
  };
  readonly fonts: {
    readonly sans: string;
    readonly ui: string;
    readonly mono: string;
    readonly cjk: string;
    readonly display: string;
  };
  /** The built-in Agent-avatar variant the pack shows, when it shows its own. */
  readonly avatar?: string;
}

/*
 * The built-in packs, keyed by id in the picker's order — Frost, Console, Primer (user decision,
 * 2026-10-02), then Doodle. The keys are what `ThemeId` is; each folder's manifest names the same id, which the
 * contract test holds. The JSON is typed by the contract, not by inference: TypeScript widens a
 * JSON module's strings, and the test validates every field the type promises.
 */
const PACKS = {
  modern: modern as unknown as ThemePackManifest,
  geek: geek as unknown as ThemePackManifest,
  github: github as unknown as ThemePackManifest,
  doodle: doodle as unknown as ThemePackManifest,
};

/** A built-in pack's id: the theme ids the build ships. Display names are UI copy, not ids. */
export type ThemeId = keyof typeof PACKS;

/** The built-in ids, in the order every list offers them — Settings, the gallery. */
export const THEME_IDS: readonly ThemeId[] = /* @__PURE__ */ (() =>
  Object.keys(PACKS) as ThemeId[])();

/** The built-in manifests, in {@link THEME_IDS} order. */
export const BUILTIN_PACKS: readonly ThemePackManifest[] = /* @__PURE__ */ (() =>
  THEME_IDS.map((id) => PACKS[id]))();

/** One built-in pack's manifest. */
export function builtinPack(id: ThemeId): ThemePackManifest {
  return PACKS[id];
}

/** Whether a value names a built-in pack. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && Object.hasOwn(PACKS, value);
}
