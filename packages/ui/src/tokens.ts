/**
 * The token contract: every CSS custom property a theme must define, grouped the way the
 * gallery's Foundations pages present them.
 *
 * One name set for every theme. Each of `themes/github.css`, `themes/modern.css` and
 * `themes/geek.css` gives **every** name below a value in **both** modes (light and dark): its
 * base rule declares all of them with the light values, and its dark rule declares only the names
 * whose value dark changes — a group that does not vary by mode (shape, families, type scale,
 * density, motion, icons) lives once, in the base rule. The contract test parses the three files
 * and diffs each mode (the base rule plus that mode's own) against {@link TOKEN_NAMES}. Components
 * read these names only — through the semantic Tailwind utilities `theme.css` bridges
 * (`bg-surface`, `text-fg-muted`, `border-line`, …) or through `var(--ui-*)` directly — and never
 * branch on which theme is active.
 *
 * Adding, renaming or removing a name is a contract change: every theme file changes in the
 * same commit, and so does the bridge in `theme.css` when the name has a utility alias.
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
 * composer's input, which opt in with `font-sans`). Primer and Frost point both at one family;
 * Console sets the chrome in a monospaced face and keeps reading text in a sans.
 *
 * Motion is three languages behind one set of names: the presence tokens (`--ui-dur-enter`,
 * `--ui-enter-shift`, `--ui-enter-scale`, `--ui-enter-blur`, …) drive the theme-independent
 * rules in `theme.css` for `data-presence`, `data-backdrop`, `data-reveal` and
 * `data-layout-motion`; a theme picks a quick fade, a soft spring or a `steps()` jump by value
 * alone. `--ui-dur-fast` / `base` / `slow` stay the state-change durations a component may name.
 */

/** Stable, lowercase theme ids. Display names (Primer / Frost / Console) are UI copy, not ids. */
export const THEME_IDS = ["github", "modern", "geek"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** The theme an absent or unknown `data-theme` resolves to. Its file needs no attribute selector. */
export const DEFAULT_THEME_ID: ThemeId = "github";

/** The two modes every theme file defines. `system` is a preference, not a mode. */
export const THEME_MODES = ["light", "dark"] as const;
export type ThemeModeName = (typeof THEME_MODES)[number];

/**
 * One accent preset a theme lists: its id (the `data-accent` value, lowercase, the same in both
 * languages) and its swatch — the `--ui-accent` its light rule sets, spelled exactly as the theme
 * file spells it, so a picker can paint the swatch without a stylesheet probe. A theme's dark rule
 * may lift the preset (a dark theme wants a lighter fill with dark ink); the swatch is the light
 * one, and a test holds it equal to the CSS.
 */
export interface AccentPresetSpec {
  readonly id: string;
  readonly swatch: string;
}

/**
 * The user's accent presets, per theme (user decision, 2026-09-19). Each theme declares its own
 * list and values in its own file, in `@layer ui-accent`, on `:root[data-accent="<id>"]` scoped to
 * that theme; a preset overrides the six accent tokens and nothing else. `neutral` is the absence
 * of a preset — no `data-accent` attribute — and resolves to the active theme's accent.
 *
 * A stored choice outlives the theme that listed it: the root carries `data-accent` for any known
 * id, a theme's preset rules match only their own theme, so a preset the active theme does not
 * list paints nothing (the theme's own accent shows, as `neutral` would) and comes back when the
 * user returns to a theme that lists it. Primer keeps the five ids and values the Web App has
 * always had, so nothing there moves; Frost's five are warm and muted, Console's five are terminal
 * hues.
 */
export const ACCENT_PRESETS = {
  github: [
    { id: "blue", swatch: "#2563eb" },
    { id: "green", swatch: "#15803d" },
    { id: "violet", swatch: "#7c3aed" },
    { id: "rose", swatch: "#be123c" },
    { id: "amber", swatch: "#b45309" },
  ],
  modern: [
    { id: "ocean", swatch: "#3b6ea8" },
    { id: "clay", swatch: "#b8552f" },
    { id: "plum", swatch: "#7a4d8f" },
    { id: "honey", swatch: "#96660f" },
    { id: "slate", swatch: "#5c6470" },
  ],
  geek: [
    { id: "phosphor", swatch: "#1f7a1f" },
    { id: "cyan", swatch: "#0e7490" },
    { id: "magenta", swatch: "#b0177e" },
    { id: "gold", swatch: "#8a6d00" },
    { id: "cobalt", swatch: "#003ee9" },
  ],
} as const satisfies Readonly<Record<ThemeId, readonly AccentPresetSpec[]>>;

/** Every preset id any theme lists. */
export type AccentPreset = (typeof ACCENT_PRESETS)[ThemeId][number]["id"];

/** The preset ids each theme lists, in the theme's own order — what a picker offers. */
export const THEME_ACCENT_PRESETS: Readonly<Record<ThemeId, readonly AccentPreset[]>> = {
  github: ACCENT_PRESETS.github.map((preset) => preset.id),
  modern: ACCENT_PRESETS.modern.map((preset) => preset.id),
  geek: ACCENT_PRESETS.geek.map((preset) => preset.id),
};

/** Every id once, across the themes — what a stored value is validated against. */
export const ACCENT_PRESET_IDS: readonly AccentPreset[] = [
  ...new Set(THEME_IDS.flatMap((id) => THEME_ACCENT_PRESETS[id])),
];

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
      "--ui-inset",
      "--ui-overlay",
      "--ui-overlay-backdrop",
    ],
  },
  {
    id: "color-text",
    title: "Colour — text",
    names: ["--ui-fg", "--ui-fg-muted", "--ui-fg-subtle", "--ui-fg-link", "--ui-fg-link-hover"],
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
    id: "color-charts",
    title: "Colour — charts",
    names: [
      "--ui-chart-1",
      "--ui-chart-2",
      "--ui-chart-3",
      "--ui-chart-4",
      "--ui-chart-5",
      "--ui-chart-6",
      "--ui-chart-cache-read",
      "--ui-chart-cache-write",
      "--ui-chart-output",
      "--ui-chart-grid",
      "--ui-chart-axis",
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
    // The app window's own frame (the `ui-shell` hook): the field behind it, the two washes a
    // theme may paint over the field, the two columns' fills, the rule between them, and the main
    // column's inset, corner and shadow when it floats. Primer's values are today's rendering.
    names: [
      "--ui-shell-field",
      "--ui-shell-wash-1",
      "--ui-shell-wash-2",
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
    id: "icons",
    title: "Icons",
    names: ["--ui-icon-stroke", "--ui-icon-cap", "--ui-icon-join"],
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
export const TOKEN_NAMES: readonly TokenName[] = TOKEN_GROUPS.flatMap(
  (group): readonly TokenName[] => group.names,
);

/** `var(--ui-…)` for a contract name — for inline styles and SVG attributes that cannot take a class. */
export function tokenVar(name: TokenName): `var(${TokenName})` {
  return `var(${name})`;
}
