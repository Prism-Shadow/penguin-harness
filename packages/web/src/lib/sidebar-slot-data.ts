export const DEFAULT_MODE = "dev";

export interface SidebarSectionData {
  /** The work mode it belongs to: `"dev"` (the default) or a contributed mode's key. */
  mode: string;
  /** `header`: the switcher row above the nav. `body`: the scroll area, below the page nav. */
  place: "header" | "body";
  /** Its place among the sections of the same mode and place, ascending. */
  order: number;
}

export interface SidebarModeData {
  key: string;
  /** The mode's name on the mode switch, in English and in Chinese. */
  title: string;
  titleZh: string;
  /** The rail toggle's glyph: a name in the UI package's icon registry (`ICONS`). */
  icon: string;
  /** Its place on the mode switch, after the default mode, ascending. */
  order: number;
}

export interface NavBadgeData {
  /** A page's key (its nav row), `account` (the account row and the rail's avatar), or `menu` (the phone's drawer button). */
  anchor: string;
  order: number;
}
