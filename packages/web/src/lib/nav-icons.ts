/**
 * Which registry glyph a page wears where it is drawn outside the nav: its own header, a jump
 * action (the dock's "view trace"), a reference from another page. The nav rows themselves name
 * their glyph in the page's data (`PageData.icon`, a registry name read with `glyphOf`). The
 * drawings live in the shared registry, named for what they draw; which drawing stands for which
 * page is the app's knowledge, so the map lives here.
 */
import { ICONS, type IconName } from "@prismshadow/penguin-ui";

export const NAV_ICONS = {
  /** Plugin library (the puzzle piece). */
  plugins: ICONS.puzzle,
  /** Machines (two stacked server units). */
  machines: ICONS.server,
  /** Trace observation (an open eye): watching what a run actually did. */
  traces: ICONS.eye,
  /** Terminal (a `>_` prompt in a window frame). */
  terminal: ICONS.terminalWindow,
  /** The org chart. */
  orgChart: ICONS.network,
  /** The ticket board. */
  orgTickets: ICONS.kanban,
  /** Finance. */
  orgFinance: ICONS.dollarCircle,
  /** The handbook, the company's knowledge base. */
  orgHandbook: ICONS.bookOpen,
} as const;

/** The glyph a registry name stands for; "" (no glyph) for a name the registry lacks. */
export function glyphOf(name: string | undefined): string {
  return name !== undefined && Object.hasOwn(ICONS, name) ? ICONS[name as IconName] : "";
}

/** New-chat pen over a baseline: the pinned "New chat" row, the collapsed rail's entry and the session list's drafts and create button. */
export const NEW_CHAT_ICON = ICONS.penLine;
