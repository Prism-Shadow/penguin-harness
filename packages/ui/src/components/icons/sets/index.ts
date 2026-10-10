/**
 * The icon sets: every registry glyph and every component mark drawn three ways, one per theme
 * family, and the theme's CSS shows its own (the `ui-glyph` hook, hooks.ts).
 *
 * - `line` — the 24-grid stroke drawings: `ICONS` itself, and each mark's own drawing in its
 *   component; `DUOTONE` adds an optional filled body under a line drawing, at the opacity the
 *   theme gives `--ui-icon-duo-opacity`.
 * - `octicons` — GitHub's Octicons, 16-grid filled paths (`OCTICONS`).
 * - `pixel` — 16x16 pixel drawings, one-pixel lines (`PIXEL_ICONS`, drawn by `pixelPath`).
 *
 * A path is a registry glyph's identity: the renderer is handed `ICONS.gear`, not the name, so
 * `iconNameOf` maps a path back to its name to find the glyph's other drawings. A path the
 * registry does not hold (a feature file's own glyph) has no other drawings and stays a line in
 * every theme.
 */
import { ICONS } from "../icons";
import type { IconName } from "../icons";
import { ICON_TINTS } from "./duotone";
import type { IconTint } from "./duotone";

export type { GlyphKey, MarkName, PixelGrid } from "./types";
export { OCTICONS, OCTICONS_FILLED } from "./octicons";
export { PIXEL_ICONS, PIXEL_ICONS_FILLED, pixelPath } from "./pixel";
export { DUOTONE, ICON_TINTS, ICON_TINT_NAMES } from "./duotone";
export type { IconTint } from "./duotone";

/** Built once: the registry's values are unique, so each path names exactly one glyph. */
const NAME_BY_PATH: ReadonlyMap<string, IconName> = new Map(
  (Object.entries(ICONS) as [IconName, string][]).map(([name, d]) => [d, name]),
);

/** The registry name a path is drawn under, or undefined for a path the registry does not hold. */
export function iconNameOf(d: string): IconName | undefined {
  return NAME_BY_PATH.get(d);
}

/**
 * The hue a registry glyph wears where it is decorative, for a wrapper that carries the
 * decorative-icon hook itself (`data-tint` beside its `data-role`); undefined for any other path.
 */
export function iconTintOf(d: string): IconTint | undefined {
  const name = NAME_BY_PATH.get(d);
  return name === undefined ? undefined : ICON_TINTS[name];
}
