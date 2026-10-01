/**
 * The one line-icon renderer: a 24x24 path in currentColor, stroked at the active theme's
 * `--ui-icon-stroke` (1.7 in the default theme), so the mark follows the caller's text colour and
 * every glyph carries the same weight. The paths come from the registry (`ICONS`) or from the
 * app's own manifests built on it, and the size from the role-named scale (`ICON_SIZE`).
 *
 * A registry glyph is drawn in every icon set at once and carries the `ui-glyph` hook, so each
 * theme's CSS shows its own drawing (glyph-sets.tsx): the line drawing with its optional duotone
 * body, the Octicon, the pixel drawing. The path is the glyph's identity — `iconNameOf` finds
 * the name it is registered under — and a path the registry does not hold is drawn as a line
 * alone, the same in every theme.
 *
 * `decor` marks an icon that says nothing its label does not already say — a nav row's glyph, a
 * group header's, a menu row's, an empty state's illustration — so a theme may recolour it or
 * drop it. The renderer writes the style hook and the role, and for a registry glyph its tint
 * (`data-tint`, the hue a theme that colours decorative icons paints it in); the call site
 * decides, because only it knows whether a label stands beside the icon. A status mark, a file
 * kind or a tool glyph carries information and never passes it.
 */
import { ICON_SIZE } from "../../../icon-scale";
import { DUOTONE, ICON_TINTS, iconNameOf } from "../sets";
import { GlyphSets } from "./glyph-sets";

/** The places a decorative icon sits in, which the themes tint apart. */
export type IconDecorRole = "nav" | "group" | "menu" | "empty";

export function GlyphIcon({
  d,
  size = ICON_SIZE.inlineGlyph,
  className = "",
  filled = false,
  decor,
}: {
  d: string;
  size?: number;
  className?: string;
  /** Fill the path in currentColor — for a mark whose "on" state is a solid shape (a pinned tack). */
  filled?: boolean;
  /** Decorative beside a label that already says it: a theme may recolour or hide the icon. */
  decor?: IconDecorRole;
}) {
  const name = iconNameOf(d);
  const line = <path d={d} fill={filled ? "currentColor" : "none"} />;
  const duo = name === undefined ? undefined : DUOTONE[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      // A style, not the attribute: an SVG presentation attribute cannot read a custom property.
      // The fallback is the default theme's weight, for a page that has not loaded the theme CSS.
      style={{ strokeWidth: "var(--ui-icon-stroke, 1.7)" }}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`block shrink-0 ${decor === undefined ? "" : "ui-icon-decor"} ${className}${name === undefined ? "" : " ui-glyph"}`}
      data-role={decor}
      data-tint={decor === undefined || name === undefined ? undefined : ICON_TINTS[name]}
      aria-hidden
    >
      {name === undefined ? (
        line
      ) : (
        <GlyphSets glyph={name} grid={24} size={size} filled={filled}>
          {duo !== undefined && <path data-part="duo" d={duo} fill="currentColor" stroke="none" />}
          {line}
        </GlyphSets>
      )}
    </svg>
  );
}
