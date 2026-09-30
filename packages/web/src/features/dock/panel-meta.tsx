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
    case "builtin-browser":
      return S.builtinBrowser.panelTitle;
  }
}

export function panelGlyph(kind: PanelKind, size: number = ICON_SIZE.iconButton): ReactNode {
  switch (kind) {
    case "agents":
      return <GlyphIcon d={ICONS.robotPair} size={size} />;
    case "workspace":
      return <GlyphIcon d={ICONS.folder} size={size} />;
    case "memory":
      return <GlyphIcon d={ICONS.brain} size={size} />;
    case "trace":
      return <GlyphIcon d={NAV_ICONS.traces} size={size} />;
    case "messaging":
      return <GlyphIcon d={ICONS.paperPlane} size={size} />;
    case "schedules":
      return <GlyphIcon d={ICONS.alarmClock} size={size} />;
    case "builtin-browser":
      return <GlyphIcon d={ICONS.globe} size={size} />;
  }
}
