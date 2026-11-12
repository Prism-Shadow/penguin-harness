/**
 * The token contract: every CSS custom property a theme must define, grouped the way the
 * gallery's Foundations pages present them.
 *
 * One name set for every theme. The base pack, Frost (`themes/modern/tokens.css`), gives **every**
 * name below a value in **both** modes (light and dark) on the bare root, so every `<html>` has
 * one; so does each built-in pack on its own root (`themes/<id>/tokens.css`): its base rule
 * declares all of them with the light values, and its dark rule declares only the names whose
 * value dark changes — a group that does not vary by mode (shape, families, type scale, density,
 * motion, streaming, the icons' stroke) lives once, in the base rule. A pack built on Frost
 * (`base: "modern"`) may declare only what it changes; the rest is Frost's. The contract test
 * parses every pack folder and diffs each mode (the base rule plus that mode's own) against
 * {@link TOKEN_NAMES}. Components
 * read these names only — through the semantic Tailwind utilities `theme.css` bridges
 * (`bg-surface`, `text-fg-muted`, `border-line`, …) or through `var(--ui-*)` directly — and never
 * branch on which theme is active.
 *
 * Adding, renaming or removing a name is a contract change: every complete pack changes in the
 * same commit, and so does the bridge in `theme.css` when the name has a utility alias. Removing
 * or renaming one also moves {@link THEME_API}, the version a pack is written against.
 *
 * Nothing about size is shared between themes any more. Each theme sets its own space unit
 * (`--ui-space-unit`, which `theme.css` bridges to Tailwind's `--spacing`, so every `h-8`, `px-2`,
 * `gap-3` and `w-64` scales with it), its own type rungs and line-heights, and its own control,
 * row and menu-row padding; switching themes reflows a layout, by design (user decision,
 * 2026-09-19). What every theme still shares is the NAMES, the markup they act on and the
 * anatomy the style hooks rely on — a component never asks which theme is active. All type and
 * density lengths are rem, so the 16 / 18 / 20 px root tiers keep scaling them within a theme.
 *
 * Two faces, not one: `--ui-font-ui` is the chrome's face (navigation, controls, labels, headings,
 * badges, tables — `body` reads it), `--ui-font-sans` the reading face (message text, prose, the
 * composer's input, which opt in with `font-sans`). Every theme points the chrome at its sans
 * today (Console's chrome was monospaced until 2026-09-30); the two names stay so a theme can
 * set them apart. Every sans stack reads `--ui-font-cjk` for Han, so the user's font pairing
 * (boot.ts, `data-font-latin` / `data-font-cjk`, resolved in `theme.css`'s `ui-font` layer)
 * replaces the sans and the CJK face under any theme and leaves the mono face alone.
 *
 * Dark mode is calmer than a white-on-black inversion, but not dim: `--ui-fg` is the body ink
 * at roughly 84% white (about 12:1 on the page surfaces, never under 11:1 — the owner found a
 * first, 9:1 pass too dim), `--ui-fg-emphasis` the near-white kept for headings and emphasis
 * (the two are one value in light), and the muted and subtle inks step down from the body ink
 * (muted never under 6:1, subtle — timestamps, placeholders, meta — never under 4.5:1).
 * Surfaces sit a step off pure black.
 *
 * Motion is three languages behind one set of names: the presence tokens (`--ui-dur-enter`,
 * `--ui-enter-shift`, `--ui-enter-scale`, `--ui-enter-blur`, …) drive the theme-independent
 * rules in `theme.css` for `data-presence`, `data-backdrop`, `data-reveal` and
 * `data-layout-motion`; a theme picks a quick fade, a soft spring or a `steps()` jump by value
 * alone. `--ui-dur-fast` / `base` / `slow` stay the state-change durations a component may name.
 * A reply that is still streaming is paced by the two streaming tokens (`--ui-stream-reveal`,
 * `--ui-stream-rate`) and dressed by the `ui-stream` hook: Primer shows it as it lands, Frost
 * fades it in word by word under a soft veil, Console types it out behind a block cursor.
 */

import { THEME_IDS, builtinPack } from "./themes";
import type { ThemeId } from "./themes";

/*
 * The theme ids and the pack registry live in `themes/index.ts`, beside the manifests; the
 * contract re-exports them so a consumer reads one module.
 */
export { BUILTIN_PACKS, THEME_API, THEME_IDS, builtinPack, isThemeId } from "./themes";
export type { ThemeBase, ThemeId, ThemePackManifest, ThemePackSwatch } from "./themes";

/**
 * Frost: the base pack — the one whose values a bare root paints and whose recipes every pack
 * built on it draws — and the theme a browser starts in when it stores no choice, or an unknown
 * one (user decision, 2026-10-02; Primer before). It is written to the root like any chosen theme
 * (`data-theme` is always present), so the boot script, the provider and the gallery read this
 * one and nothing else names a default.
 */
export const INITIAL_THEME_ID: ThemeId = "modern";

/** The two modes every theme file defines. `system` is a preference, not a mode. */
export const THEME_MODES = ["light", "dark"] as const;
export type ThemeModeName = (typeof THEME_MODES)[number];

/**
 * One accent preset a theme lists: its id (the `data-accent` value, lowercase, the same in both
 * languages) and its swatch — the `--ui-accent` its light rule sets, spelled exactly as the pack's
 * `accents.css` spells it, so a picker can paint the swatch without a stylesheet probe. A theme's
 * dark rule may lift the preset (a dark theme wants a lighter fill with dark ink); the swatch is
 * the light one, and a test holds it equal to the CSS.
 */
export interface AccentPresetSpec {
  readonly id: string;
  readonly swatch: string;
}

/**
 * The user's accent presets, per theme (user decision, 2026-09-19), as each pack's manifest lists
 * them (`accent.presets`). Each theme declares its values in its own `accents.css`, served in
 * `@layer ui-accent`, on `:root[data-accent="<id>"]` scoped to that theme. A preset sets
 * `--ui-accent` — and `--ui-accent-fg` where its label's ink differs
 * from the theme's — and nothing outside the accent group: Frost and Console derive the hover
 * and active fills and the muted and line washes from `--ui-accent` in their base rules, so a
 * preset is one value per mode and carries no second copy of the family. Primer's five keep all
 * six values literal, byte for byte what the Web App has always rendered. `neutral` is the
 * absence of a preset — no `data-accent` attribute — and resolves to the active theme's accent.
 *
 * A stored choice outlives the theme that listed it: the root carries `data-accent` for any known
 * id, a theme's preset rules match only their own theme, so a preset the active theme does not
 * list paints nothing (the theme's own accent shows, as `neutral` would) and comes back when the
 * user returns to a theme that lists it. Primer keeps the five ids and values the Web App has
 * always had, so nothing there moves; Frost's six are its former forest green and five warm,
 * muted hues (its own accent went black and white on 2026-10-02, as Console's had); Console's six
 * are the orange it shipped with and five terminal hues — its own accent went black and white
 * (2026-09-30), so the orange became a preset.
 */
export const ACCENT_PRESETS: Readonly<Record<ThemeId, readonly AccentPresetSpec[]>> =
  /* @__PURE__ */ (() => byTheme((id) => builtinPack(id).accent.presets))();

/**
 * A preset id. Ids come from the manifests, so the type is a string; what a stored value may be is
 * {@link ACCENT_PRESET_IDS}.
 */
export type AccentPreset = string;

/*
 * The values below are computed when the module loads. Each computation is marked pure so a
 * bundle that never reads it drops it: a public site imports this module through the boot
 * script's storage keys and would otherwise carry every preset and token name.
 */

/** A table over the built-in packs, one entry per id. */
function byTheme<T>(entry: (id: ThemeId) => T): Readonly<Record<ThemeId, T>> {
  return Object.fromEntries(THEME_IDS.map((id) => [id, entry(id)])) as Record<ThemeId, T>;
}

/** The preset ids each theme lists, in the theme's own order — what a picker offers. */
export const THEME_ACCENT_PRESETS: Readonly<Record<ThemeId, readonly AccentPreset[]>> =
  /* @__PURE__ */ (() => byTheme((id) => ACCENT_PRESETS[id].map((preset) => preset.id)))();

/** Every id once, across the themes — what a stored value is validated against. */
export const ACCENT_PRESET_IDS: readonly AccentPreset[] = /* @__PURE__ */ (() => [
  ...new Set(THEME_IDS.flatMap((id) => THEME_ACCENT_PRESETS[id])),
])();

/**
 * The accent a theme paints when no preset is chosen (`neutral`): its own `--ui-accent` per
 * mode, as the manifest spells it (`accent.own`), so a picker can paint the "theme's own" swatch
 * without a stylesheet probe (a test holds each value equal to the CSS). All three are
 * monochrome (user decision, 2026-10-02): the theme's ink in light, a near-white in dark, so that
 * swatch shows black or white rather than a hue. Primer's are Tailwind's stock gray-900 /
 * gray-100, as v0.2.13 drew them.
 */
export const THEME_OWN_ACCENTS: Readonly<Record<ThemeId, Readonly<Record<ThemeModeName, string>>>> =
  /* @__PURE__ */ (() => byTheme((id) => builtinPack(id).accent.own))();

/**
 * What a stored choice paints under a theme: the preset when the theme lists it, otherwise
 * `null` — the theme's own accent, exactly as `neutral`. The CSS resolves the same way on its
 * own; this is for a picker that must show which swatch is in effect.
 */
export function resolveAccent(
  themeId: ThemeId,
  choice: string | null | undefined,
): AccentPreset | null {
  const listed = THEME_ACCENT_PRESETS[themeId];
  return (listed as readonly string[]).includes(choice ?? "") ? (choice as AccentPreset) : null;
}

/** Semantic tones. `busy` is a JS alias of `success` (see the web app's `tone.ts`), not a token. */
export const TONES = ["success", "attention", "danger", "done", "neutral", "info"] as const;
export type ToneName = (typeof TONES)[number];

/** The five parts every tone defines. */
export const TONE_PARTS = ["fg", "bg", "line", "emphasis", "emphasis-fg"] as const;
export type TonePart = (typeof TONE_PARTS)[number];

/** Token groups, in the order the Foundations pages and the theme files list them. */
export const TOKEN_GROUPS = [
  {
    id: "color-surfaces",
    title: "Colour — surfaces",
    names: [
      "--ui-canvas",
      "--ui-surface",
      "--ui-surface-muted",
      // The filled neutral surface a message bubble or a chip sits on: a surface, not a tone —
      // Console empties its tone fills, and a bubble must keep its fill there.
      "--ui-fill-neutral",
      "--ui-inset",
      "--ui-overlay",
      "--ui-overlay-backdrop",
    ],
  },
  {
    id: "color-text",
    title: "Colour — text",
    // `fg` is the body ink; `fg-emphasis` the strong ink of headings and emphasis (the same
    // value in light, near-white in dark where the body ink is calmer). `link-decoration` is a
    // link-style control's line at rest: `none` where the link ink already stands apart from
    // the body's, `underline` where the link is the body's own ink and the line is what marks it.
    names: [
      "--ui-fg",
      "--ui-fg-emphasis",
      "--ui-fg-muted",
      "--ui-fg-subtle",
      "--ui-fg-link",
      "--ui-fg-link-hover",
      "--ui-link-decoration",
    ],
  },
  {
    id: "color-lines",
    title: "Colour — lines",
    names: ["--ui-line", "--ui-line-muted", "--ui-line-emphasis", "--ui-divider"],
  },
  {
    id: "color-accent",
    title: "Colour — accent",
    names: [
      "--ui-accent",
      "--ui-accent-hover",
      "--ui-accent-active",
      "--ui-accent-fg",
      "--ui-accent-muted",
      // The accent's wash laid on the canvas: the opaque twin of `accent-muted`, at the same
      // strength, which a surface holding the person's own words sits on (the user bubble).
      "--ui-accent-tint",
      "--ui-accent-line",
    ],
  },
  {
    id: "color-tones",
    title: "Colour — semantic tones",
    names: [
      "--ui-tone-success-fg",
      "--ui-tone-success-bg",
      "--ui-tone-success-line",
      "--ui-tone-success-emphasis",
      "--ui-tone-success-emphasis-fg",
      "--ui-tone-attention-fg",
      "--ui-tone-attention-bg",
      "--ui-tone-attention-line",
      "--ui-tone-attention-emphasis",
      "--ui-tone-attention-emphasis-fg",
      "--ui-tone-danger-fg",
      "--ui-tone-danger-bg",
      "--ui-tone-danger-line",
      "--ui-tone-danger-emphasis",
      "--ui-tone-danger-emphasis-fg",
      "--ui-tone-done-fg",
      "--ui-tone-done-bg",
      "--ui-tone-done-line",
      "--ui-tone-done-emphasis",
      "--ui-tone-done-emphasis-fg",
      "--ui-tone-neutral-fg",
      "--ui-tone-neutral-bg",
      "--ui-tone-neutral-line",
      "--ui-tone-neutral-emphasis",
      "--ui-tone-neutral-emphasis-fg",
      "--ui-tone-info-fg",
      "--ui-tone-info-bg",
      "--ui-tone-info-line",
      "--ui-tone-info-emphasis",
      "--ui-tone-info-emphasis-fg",
    ],
  },
  {
    id: "color-marks",
    title: "Colour — marks",
    // A mark that is deliberately not a tone: `new` is the update dot's fill — "there is something
    // new down this path", neither a fault nor unfinished work. It never carries the meaning alone
    // (its anchor names what is new), so it has no contrast floor and a theme may keep it pale.
    names: ["--ui-mark-new"],
  },
  {
    id: "chart",
    title: "Charts — series colours and geometry",
    // The categorical palette has fixed roles across themes — 1 violet, 2 amber, 3 sky, 4 rose,
    // 5 emerald, 6 fuchsia, 7 teal, 8 orange in Primer's hues, each theme picking its own hue
    // for the role — and the usage charts take entity series from 1–4 in order, the Trace
    // timeline its phases from 1, 3, 2, 4 and 5. `ref` is a reference line (a hit-rate or
    // success-rate curve); the three token-kind blues stay their own. The geometry is what a
    // chart draws with, read once per theme through the app's chart-style hook: the share of
    // its band a bar fills (0–1), a bar's top radius, the series stroke, the point radius, how
    // a line joins its points (`linear` | `smooth` | `step`), the fill under a line (0–1), and a
    // bar's outline — its width, its colour (a colour, or the exact keyword `series` for the
    // bar's own series colour) — and the bar's fill opacity (0–1): a theme may draw a bar pale
    // and edge it in the full series colour. Lengths are px: the charts draw in SVG user units.
    names: [
      "--ui-chart-1",
      "--ui-chart-2",
      "--ui-chart-3",
      "--ui-chart-4",
      "--ui-chart-5",
      "--ui-chart-6",
      "--ui-chart-7",
      "--ui-chart-8",
      "--ui-chart-ref",
      "--ui-chart-cache-read",
      "--ui-chart-cache-write",
      "--ui-chart-output",
      "--ui-chart-grid",
      "--ui-chart-axis",
      "--ui-chart-bar-fill",
      "--ui-chart-bar-radius",
      "--ui-chart-line-width",
      "--ui-chart-point-radius",
      "--ui-chart-curve",
      "--ui-chart-area-opacity",
      "--ui-chart-bar-stroke",
      "--ui-chart-bar-stroke-color",
      "--ui-chart-bar-opacity",
    ],
  },
  {
    id: "color-code",
    title: "Colour — code",
    names: [
      "--ui-code-bg",
      "--ui-code-line",
      "--ui-code-gutter",
      "--ui-code-selection",
      "--ui-diff-add-bg",
      "--ui-diff-add-word",
      "--ui-diff-del-bg",
      "--ui-diff-del-word",
      "--ui-diff-hunk-bg",
    ],
  },
  {
    id: "shape",
    title: "Shape",
    names: [
      "--ui-radius-xs",
      "--ui-radius-sm",
      "--ui-radius-md",
      "--ui-radius-lg",
      "--ui-radius-xl",
      "--ui-radius-pill",
      "--ui-radius-control",
      "--ui-border-w",
      "--ui-border-w-thick",
    ],
  },
  {
    id: "elevation",
    title: "Elevation",
    names: [
      "--ui-shadow-flat",
      "--ui-shadow-raised",
      "--ui-shadow-overlay",
      "--ui-shadow-modal",
      "--ui-shadow-drawer",
      "--ui-glass-bg",
      "--ui-glass-blur",
      "--ui-glass-saturate",
      "--ui-glass-line",
    ],
  },
  {
    id: "shell",
    title: "Shell",
    // The app window's own frame (the `ui-shell` hook): the field behind it — one flat colour,
    // never a gradient — the two columns' fills, the rule between them, and the main column's
    // inset, corner and shadow when it floats. Primer's values are today's rendering.
    names: [
      "--ui-shell-field",
      "--ui-shell-nav-bg",
      "--ui-shell-main-bg",
      "--ui-shell-line",
      "--ui-shell-gap",
      "--ui-shell-radius",
      "--ui-shell-shadow",
    ],
  },
  {
    id: "structure",
    title: "Structure — trees and fields",
    // What the `ui-tree` and `ui-field` hooks measure with: a tree row's base inset and its
    // indent per level (a host indents its rows by these two, so every theme's connector rules
    // land on the same columns), the colour of a connector or guide rule, and a field's label
    // column width (Console's tabular rows) and the gap between its label and its control.
    // Primer's values are today's file tree and form rows.
    names: [
      "--ui-tree-inset",
      "--ui-tree-indent",
      "--ui-tree-guide",
      "--ui-field-label-w",
      "--ui-field-gap",
    ],
  },
  {
    id: "controls",
    title: "Controls — the switch",
    // The switch's off track and the knob on it, and the knob on the on track (the accent). A
    // knob keeps 3:1 against its track in every theme, mode and preset — `knob-on` follows the
    // accent's label ink, which already flips to a dark ink on a light fill — so the knob never
    // vanishes on a near-white dark accent. `knob-line` is the knob's hairline edge: where the
    // knob itself does not reach 3:1 on the off track (Primer's white knob on gray-200, kept),
    // the edge does — a gray-500 hairline there (2026-09-30), a faint one elsewhere.
    names: [
      "--ui-switch-track",
      "--ui-switch-knob",
      "--ui-switch-knob-on",
      "--ui-switch-knob-line",
    ],
  },
  {
    id: "badge",
    title: "Badges — the tag",
    // What `Badge` and `Count` draw a tag with, so a theme decides what a tag looks like without
    // the component asking which theme runs: the width of the inset rule a soft tag draws in its
    // tone's line (0px where the tone's tint alone sets the tag off its row — a length, never a
    // bare 0, since the ring adds it to an offset), the tag's weight, the md tag's padding as
    // `<block> <inline>` (a theme with one tag size gives it the sm tag's `1px` by one and a half
    // space units), and the tag's font size and line-height (`size` / `lh`): a tag is set one step
    // under the theme's small rung (user decision, 2026-10-02 — the model marks read too large),
    // and the line-height is fixed so a tag's height does not follow its row's.
    names: [
      "--ui-badge-soft-ring",
      "--ui-badge-weight",
      "--ui-badge-pad-md",
      "--ui-badge-size",
      "--ui-badge-lh",
    ],
  },
  {
    id: "type-families",
    title: "Typography — families",
    names: [
      "--ui-font-sans",
      "--ui-font-ui",
      "--ui-font-mono",
      "--ui-font-display",
      "--ui-font-cjk",
    ],
  },
  {
    id: "type-scale",
    title: "Typography — scale and roles",
    names: [
      "--ui-text-body-size",
      "--ui-text-body-lh",
      "--ui-text-small-size",
      "--ui-text-small-lh",
      "--ui-text-caption-size",
      "--ui-text-caption-lh",
      "--ui-text-code-size",
      "--ui-text-code-lh",
      "--ui-text-prose-size",
      "--ui-text-prose-lh",
      "--ui-h1-size",
      "--ui-h1-lh",
      "--ui-h1-weight",
      "--ui-h1-tracking",
      "--ui-h1-transform",
      "--ui-h1-font",
      "--ui-h2-size",
      "--ui-h2-lh",
      "--ui-h2-weight",
      "--ui-h2-tracking",
      "--ui-h2-transform",
      "--ui-h2-font",
      "--ui-h3-size",
      "--ui-h3-lh",
      "--ui-h3-weight",
      "--ui-h3-tracking",
      "--ui-h3-transform",
      "--ui-h3-font",
      "--ui-h4-size",
      "--ui-h4-lh",
      "--ui-h4-weight",
      "--ui-h4-tracking",
      "--ui-h4-transform",
      "--ui-h4-font",
      "--ui-h5-size",
      "--ui-h5-lh",
      "--ui-h5-weight",
      "--ui-h5-tracking",
      "--ui-h5-transform",
      "--ui-h5-font",
      "--ui-h6-size",
      "--ui-h6-lh",
      "--ui-h6-weight",
      "--ui-h6-tracking",
      "--ui-h6-transform",
      "--ui-h6-font",
      "--ui-md-h1-size",
      "--ui-md-h2-size",
      "--ui-md-h3-size",
      "--ui-weight-body",
      "--ui-weight-medium",
      "--ui-weight-strong",
      "--ui-tracking-body",
      "--ui-tracking-mono",
      "--ui-tracking-label",
    ],
  },
  {
    id: "density",
    title: "Density",
    names: [
      "--ui-space-unit",
      "--ui-control-py-sm",
      "--ui-control-py-md",
      "--ui-control-py-lg",
      "--ui-control-px-sm",
      "--ui-control-px-md",
      "--ui-control-px-lg",
      "--ui-control-gap-sm",
      "--ui-control-gap-md",
      "--ui-row-py",
      "--ui-row-px",
      "--ui-menu-row-py",
      "--ui-menu-row-px",
      "--ui-card-p",
      "--ui-panel-p",
      "--ui-stack-0",
      "--ui-stack-1",
      "--ui-stack-2",
      "--ui-stack-3",
      "--ui-stack-4",
    ],
  },
  {
    id: "motion",
    title: "Motion",
    names: [
      "--ui-dur-fast",
      "--ui-dur-base",
      "--ui-dur-slow",
      "--ui-ease-out",
      "--ui-ease-in-out",
      "--ui-ease-spring",
      "--ui-ease-overlay-in",
      "--ui-ease-overlay-out",
      "--ui-live-timing",
      "--ui-dur-enter",
      "--ui-dur-exit",
      "--ui-ease-enter",
      "--ui-ease-exit",
      "--ui-enter-shift",
      "--ui-enter-scale",
      "--ui-enter-blur",
      "--ui-dur-reveal",
      "--ui-reveal-blur",
      "--ui-dur-layout",
      "--ui-ease-layout",
    ],
  },
  {
    id: "stream",
    title: "Streaming — how a reply is revealed",
    // What AssistantText's reveal hook reads, once per theme, to pace an assistant reply that
    // is still arriving: the reveal (`instant` shows the text as it lands, `fade` reveals it word
    // by word, each run of words fading in over the theme's `--ui-dur-reveal`, `typewriter`
    // character by character — the exact keywords) and its rate, a plain number of characters
    // per second (0 where the reveal is `instant` and no rate applies). The look of the arriving
    // text is the `ui-stream` hook's (hooks.ts); these two say only how fast it arrives. Neither
    // varies by mode.
    names: ["--ui-stream-reveal", "--ui-stream-rate"],
  },
  {
    id: "icons",
    title: "Icons",
    // The line set's stroke; the opacity of its duotone body (`DUOTONE`, icons/sets/duotone.ts),
    // 0 in a theme that draws no such layer; and the nine hues a decorative icon may wear
    // (`ICON_TINTS`), which a theme that colours decorative icons paints them in by
    // `data-tint`. The hues are declared in every theme, each a mark that reads at 3:1 on the
    // theme's page surfaces and its navigation column, whether or not the theme uses them.
    names: [
      "--ui-icon-stroke",
      "--ui-icon-cap",
      "--ui-icon-join",
      "--ui-icon-duo-opacity",
      "--ui-icon-tint-blue",
      "--ui-icon-tint-violet",
      "--ui-icon-tint-pink",
      "--ui-icon-tint-red",
      "--ui-icon-tint-orange",
      "--ui-icon-tint-amber",
      "--ui-icon-tint-green",
      "--ui-icon-tint-teal",
      "--ui-icon-tint-slate",
    ],
  },
  {
    id: "focus",
    title: "Focus, selection and scrollbar",
    names: [
      "--ui-focus-ring",
      "--ui-focus-ring-offset",
      "--ui-focus-ring-input",
      "--ui-selection-bg",
      "--ui-scrollbar-w",
      "--ui-scrollbar-thumb",
      "--ui-scrollbar-thumb-hover",
      "--ui-scrollbar-track",
      "--ui-scrollbar-visibility",
    ],
  },
] as const;

export type TokenGroup = (typeof TOKEN_GROUPS)[number];
export type TokenGroupId = TokenGroup["id"];
/** One contract name, e.g. `"--ui-surface"`. */
export type TokenName = TokenGroup["names"][number];

/** Every contract name, flattened in group order. The contract test diffs the theme files against this. */
export const TOKEN_NAMES: readonly TokenName[] = /* @__PURE__ */ TOKEN_GROUPS.flatMap(
  (group): readonly TokenName[] => group.names,
);

/**
 * The keywords `--ui-stream-reveal` takes, exactly: `instant` (a streaming reply shows as it
 * lands), `fade` (it is revealed word by word, each run fading in over `--ui-dur-reveal`) and
 * `typewriter` (character by character), the last two at `--ui-stream-rate` characters per
 * second. A value outside the list reads as
 * `instant`, so a reader never paces text a theme did not ask to pace.
 */
export const STREAM_REVEALS = ["instant", "fade", "typewriter"] as const;
export type StreamReveal = (typeof STREAM_REVEALS)[number];

/** `var(--ui-…)` for a contract name — for inline styles and SVG attributes that cannot take a class. */
export function tokenVar(name: TokenName): `var(${TokenName})` {
  return `var(${name})`;
}
