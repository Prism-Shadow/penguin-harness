/**
 * The panel kinds' display identity — label and glyph — shared by every surface that names
 * them: the toolbar's triggers and menu rows, the docks' tab strips, and the docks' add
 * menus. One table, so a panel never has two names or two marks.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { FOLDER_ICON } from "../../components/ui/group-list";
import { NAV_ICONS } from "../../components/ui/icons";
import { ICON_SIZE } from "../../lib/icon-scale";
import type { PanelKind } from "./dock-state";

/** Open book: the Memory panel's mark (same glyph as the memory-changes card header). */
const MEMORY_ICON =
  "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z";

/** Chat bubble: the Messaging panel's mark (this conversation's messaging binding). */
const MESSAGING_ICON = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

/** The subagents spawn-tree glyph is multi-element (circles + edges), so it is a component. */
export function AgentsGlyph({ size = ICON_SIZE.iconButton }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="5" cy="12" r="2.5" />
      <circle cx="19" cy="5.5" r="2.5" />
      <circle cx="19" cy="18.5" r="2.5" />
      <path d="M7.4 11 16.7 6.6M7.4 13l9.3 4.4" />
    </svg>
  );
}

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
  }
}

export function panelGlyph(kind: PanelKind, size: number = ICON_SIZE.iconButton): ReactNode {
  switch (kind) {
    case "agents":
      return <AgentsGlyph size={size} />;
    case "workspace":
      return <GlyphIcon d={FOLDER_ICON} size={size} />;
    case "memory":
      return <GlyphIcon d={MEMORY_ICON} size={size} />;
    case "trace":
      return <GlyphIcon d={NAV_ICONS.traces} size={size} />;
    case "messaging":
      return <GlyphIcon d={MESSAGING_ICON} size={size} />;
  }
}
