/**
 * A plugin's cover, wherever one is drawn: a market card, the selected carousel (its slide and
 * its rail), the detail's hero. The picture the market's curation names for the plugin's
 * package (`PluginMarketResponse.art`) when there is one; otherwise — no curation answer yet, no
 * picture for this package, or a picture that does not load — the UI package's generated cover,
 * in the plugin's tile hue (slate for a server module with no library part, which has no tile
 * colour of its own), with the plugin's icon on its tile (plugin-market.ts `marketIcon`; the
 * product logo there for a plugin with none) and the product logo in the corner.
 */
import type { PluginArt } from "@prismshadow/penguin-server/api";
import { Cover, type CoverSource } from "@prismshadow/penguin-ui";
import { PENGUIN_LOGO_URL } from "@prismshadow/penguin-web/internal";
import { skillTileHue } from "@prismshadow/penguin-web/internal";
import type { PluginRow } from "./plugin-groups";
import { marketIcon } from "./plugin-market";

/** The authored cover the curation names, as the UI package's cover takes it; null without one. */
export function coverSource(art: PluginArt | null | undefined): CoverSource | null {
  const cover = art?.cover;
  if (cover === undefined) return null;
  return {
    src: cover.url,
    ...(cover.thumbUrl !== undefined ? { thumb: cover.thumbUrl } : {}),
    ...(cover.tone !== undefined ? { tone: cover.tone } : {}),
  };
}

export function PluginCover({
  row,
  art = null,
  rendition = "thumb",
  eager = false,
}: {
  row: PluginRow;
  /** The curation's art for the row's package; null or absent draws the generated cover. */
  art?: PluginArt | null;
  rendition?: "thumb" | "full";
  /** Load the picture at once: the slide on show, the hero of an open detail. */
  eager?: boolean;
}) {
  return (
    <Cover
      image={coverSource(art)}
      rendition={rendition}
      seed={row.name}
      hue={row.library === undefined ? "slate" : skillTileHue(row.name)}
      icon={marketIcon(row, art) ?? null}
      logo={PENGUIN_LOGO_URL}
      eager={eager}
    />
  );
}
