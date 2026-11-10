/**
 * The hub's marks: the tinted tile a card and a page lead with, and the small tags under a page
 * title. A plugin's tile carries its own icon through the shared `ImageIcon`: a monochrome SVG as
 * a mask, so it takes the tile's ink in both themes (an <img> would render its `currentColor`
 * black), any other image as itself; a benchmark or a leaderboard carries a glyph for its kind,
 * and so does a plugin without an icon.
 */
import type { ReactNode } from "react";
import { ImageIcon, SiteGlyph } from "@prismshadow/penguin-ui/site";
import type { ImageIconSource, SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { TONE_TAG, TONE_TILE } from "../../lib/hub/tones";
import type { HubTone } from "../../lib/hub/tones";

/** A tile's box, and its mark: the glyph's classes and the image's edge in px (the same size). */
const TILE = {
  md: { box: "h-10 w-10 rounded-lg", mark: "h-5 w-5", px: 20 },
  lg: { box: "h-14 w-14 rounded-xl", mark: "h-7 w-7", px: 28 },
} as const;

export function HubTile({
  tone,
  icon,
  glyph,
  size = "md",
}: {
  tone: HubTone;
  /** A plugin's icon; without one, or when it does not load, `glyph` is drawn. */
  icon?: ImageIconSource;
  glyph?: SiteGlyphName;
  size?: keyof typeof TILE;
}) {
  const { box, mark, px } = TILE[size];
  const fallback = glyph && <SiteGlyph name={glyph} className={mark} strokeWidth={1.75} />;
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center ${TONE_TILE[tone]}`}
    >
      <ImageIcon icon={icon} size={px} fallback={fallback} />
    </span>
  );
}

/** A tag under a page title: a short fact, its glyph, and a tone when the fact has one. */
export function HubTag({
  tone = "slate",
  glyph,
  title,
  children,
}: {
  tone?: HubTone;
  glyph?: SiteGlyphName;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONE_TAG[tone]}`}
    >
      {glyph && <SiteGlyph name={glyph} className="h-3.5 w-3.5 shrink-0" />}
      {children}
    </span>
  );
}
