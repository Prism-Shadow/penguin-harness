/**
 * How tall the bottom dock (and the narrow merged view, which is a bottom surface) is drawn while
 * docked, kept free of the DOM and of the store so the rule is unit-testable. The dock panel
 * renders with it, its boundary drag clamps and snaps with it, and the drag overlay previews a
 * landing with it, so the three cannot disagree.
 *
 * The stored preference is a ratio of the chat page column (dock-state.ts). The height drawn is
 * that ratio's share of the column, clamped between the dock's own minimum and a ceiling. The
 * ceiling keeps the conversation row whole: the composer at its full height, measured, so the dock
 * gives way as the composer grows with its text, attachments or queued messages, and a strip of
 * messages above it tall enough for the floating controls that ride that strip. When the column
 * is too short for all three, the strip gives way first, then the dock's own minimum; the composer
 * never does. Only fullscreen, the size past the ceiling, covers it.
 */
import { LAUNCHER_BODY_MIN_HEIGHT } from "./dock-launcher-state";

/** The share of the chat page column the stored height ratio may reach. */
export const DOCK_RATIO_MAX = 0.85;
/** The bottom dock's own minimum height (px), kept until the composer needs the room. */
export const DOCK_MIN_HEIGHT_PX = 140;
/**
 * The least height the message list keeps above the composer while the bottom dock is docked
 * (px). The floating controls riding the list stay inside it: the launcher ball with its caption,
 * the tallest of them, and the back-to-bottom button over the list's bottom edge.
 */
export const CONVERSATION_MIN_HEIGHT_PX = LAUNCHER_BODY_MIN_HEIGHT;

/** The measurements the bottom dock's height is decided from (px). */
export interface BottomDockSpace {
  /** The chat page column ([data-dock-host]): the basis of the stored ratio. */
  host: number;
  /**
   * The part of the column below the toolbar ([data-dock-area]), which the conversation row and
   * the dock share. It does not change with the dock's height.
   */
  area: number;
  /** The composer's height: the part of the row the docked dock never covers. */
  composer: number;
}

/**
 * The tallest the bottom dock is drawn while docked (px): what the area leaves once the composer
 * and the message strip have their room, never less than the dock's minimum while the composer
 * leaves that much, and never more than the ratio's ceiling. The boundary drag stops here, and
 * pulling past it by the snap slack goes fullscreen.
 */
export function bottomDockMaxHeight({ host, area, composer }: BottomDockSpace): number {
  const room = Math.max(0, area - composer);
  const ceiling = Math.max(room - CONVERSATION_MIN_HEIGHT_PX, Math.min(DOCK_MIN_HEIGHT_PX, room));
  return Math.floor(Math.min(DOCK_RATIO_MAX * host, ceiling));
}

/** The bottom dock's drawn height (px) for a stored ratio: its share of the column, clamped. */
export function bottomDockHeight(ratio: number, space: BottomDockSpace): number {
  const asked = Math.round(Math.max(DOCK_MIN_HEIGHT_PX, ratio * space.host));
  return Math.min(bottomDockMaxHeight(space), asked);
}
