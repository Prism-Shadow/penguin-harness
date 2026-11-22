/**
 * A plugin's own hue on the market pages: the shared cover's pick from its id (`coverHue`), which
 * its generated cover is drawn in, and the nearest hub tone (tones.ts) for the icon tile beside
 * its name, so the tile and the cover agree. Each plugin has its own, so a row of one category
 * does not read as one block; the category is a tag.
 */
import { coverHue } from "@prismshadow/penguin-ui/site";
import type { CoverHue } from "@prismshadow/penguin-ui/site";
import type { HubTone } from "./tones";

/** The hub has no pink, red, orange or teal tone: pink and red take rose, orange amber, teal cyan. */
const HUE_TONE: Record<CoverHue, HubTone> = {
  blue: "blue",
  violet: "violet",
  pink: "rose",
  red: "rose",
  orange: "amber",
  amber: "amber",
  green: "emerald",
  teal: "cyan",
  slate: "slate",
};

/** The hue a plugin's generated cover is drawn in. */
export const pluginHue = (id: string): CoverHue => coverHue(id);

/** The tone of the icon tile beside a plugin's name: its cover's hue, as near as the hub has. */
export const pluginTone = (id: string): HubTone => HUE_TONE[pluginHue(id)];
