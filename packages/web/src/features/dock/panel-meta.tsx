/**
 * The panel kinds' display identity — label and glyph — shared by every surface that names
 * them: the toolbar's triggers and menu rows, the docks' tab strips, and the docks' add
 * menus. One table, so a panel never has two names or two marks.
 */
import type { ReactNode } from "react";
import { GlyphIcon, ICONS, ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { NAV_ICONS } from "../../lib/nav-icons";
import type { PanelKind } from "./dock-state";

/** The panel's short display name (read at call time — `S` is a live locale binding). */
export function panelLabel(kind: PanelKind): string {
  switch (kind) {
    case "agents":
      return S.chat.openAgents;
    case "workspace":
      return S.chat.workspacePanel;
    case "memory":
      return S.chat.memoryViewTitle;
    case "trace":
      return S.nav.traces;
    case "messaging":
      return S.messaging.panelTitle;
    case "schedules":
      return S.schedule.panelTitle;
  }
}

/** The panel's mark, as the registry path a Menu row draws on its own. */
export function panelGlyphPath(kind: PanelKind): string {
  switch (kind) {
    case "agents":
      return ICONS.robotPair;
    case "workspace":
      return ICONS.folder;
    case "memory":
      return ICONS.brain;
    case "trace":
      return NAV_ICONS.traces;
    case "messaging":
      return ICONS.paperPlane;
    case "schedules":
      return ICONS.alarmClock;
  }
}

export function panelGlyph(kind: PanelKind, size: number = ICON_SIZE.iconButton): ReactNode {
  return <GlyphIcon d={panelGlyphPath(kind)} size={size} />;
}
