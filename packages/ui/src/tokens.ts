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
 * Heights are shared: the padding-block of controls, rows and menu rows carries the same values in
 * every theme, and so will the line-heights and the type scale once Primer adopts the shared scale
 * in W1a. Until then Primer keeps the app's rem line-heights (a small control is 29px at the 18px
 * root, 31.25px in Frost and Console); from W1a switching themes never reflows a layout
 * vertically. All type and density lengths are rem, so the 16 / 18 / 20 px root tiers keep
 * scaling them.
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
 * The user's accent presets. Each overrides the theme's own accent in `@layer ui-accent`
 * (`theme.css`); `neutral` is the absence of a preset — no `data-accent` attribute — and
 * resolves to the active theme's accent.
 */
export const ACCENT_PRESETS = ["blue", "green", "violet", "rose", "amber"] as const;
export type AccentPreset = (typeof ACCENT_PRESETS)[number];

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
    id: "type-families",
    title: "Typography — families",
    names: ["--ui-font-sans", "--ui-font-mono", "--ui-font-display", "--ui-font-cjk"],
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
