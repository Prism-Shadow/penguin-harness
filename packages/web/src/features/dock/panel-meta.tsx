/**
 * The panel kinds' display identity — label and glyph — shared by every surface that names
 * them: the toolbar's triggers and menu rows, the docks' tab strips, and the docks' add
 * menus. One table, so a panel never has two names or two marks.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON } from "../../components/ui/group-list";
import {
  AGENTS_PAIR_ICON,
  MEMORY_ICON,
  MESSAGING_RELAY_ICON,
  NAV_ICONS,
  SCHEDULE_ICON,
} from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
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

export function panelGlyph(kind: PanelKind, size: number = ICON_SIZE.iconButton): ReactNode {
  switch (kind) {
    case "agents":
      return <GlyphIcon d={AGENTS_PAIR_ICON} size={size} />;
    case "workspace":
      return <GlyphIcon d={FOLDER_ICON} size={size} />;
    case "memory":
      return <GlyphIcon d={MEMORY_ICON} size={size} />;
    case "trace":
      return <GlyphIcon d={NAV_ICONS.traces} size={size} />;
    case "messaging":
      return <GlyphIcon d={MESSAGING_RELAY_ICON} size={size} />;
    case "schedules":
      return <GlyphIcon d={SCHEDULE_ICON} size={size} />;
  }
}
