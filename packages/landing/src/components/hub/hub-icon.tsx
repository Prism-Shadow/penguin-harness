/**
 * The hub's marks: the tinted tile a card and a page lead with, and the small tags under a page
 * title. A plugin's tile carries its own icon.svg, drawn as a mask so it takes the tile's ink in
 * both themes (the icons stroke `currentColor`, which an <img> would render black); a benchmark
 * or a leaderboard carries a glyph for its kind.
 */
import type { ReactNode } from "react";
import { SiteGlyph } from "@prismshadow/penguin-ui/site";
import type { SiteGlyphName } from "@prismshadow/penguin-ui/site";
import { TONE_TAG, TONE_TILE } from "../../lib/hub/tones";
import type { HubTone } from "../../lib/hub/tones";

const TILE = {
  md: { box: "h-10 w-10 rounded-lg", mark: "h-5 w-5" },
  lg: { box: "h-14 w-14 rounded-xl", mark: "h-7 w-7" },
} as const;

export function HubTile({
  tone,
  src,
  glyph,
  size = "md",
}: {
  tone: HubTone;
  /** A plugin's icon (a data URL); otherwise `glyph` is drawn. */
  src?: string;
  glyph?: SiteGlyphName;
  size?: keyof typeof TILE;
}) {
  const { box, mark } = TILE[size];
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center ${TONE_TILE[tone]}`}
    >
      {src ? (
        <span
          className={`${mark} bg-current`}
          style={{
            maskImage: `url("${src}")`,
            WebkitMaskImage: `url("${src}")`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
          }}
        />
      ) : (
        glyph && <SiteGlyph name={glyph} className={mark} strokeWidth={1.75} />
      )}
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
