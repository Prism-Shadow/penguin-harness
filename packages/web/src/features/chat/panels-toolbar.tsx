/**
 * Top-right dock switcher of the chat toolbar (Codex-style): exactly two icon buttons —
 * pull open the bottom dock, pull open the right dock. Opening a dock that has no tabs
 * yet lands on its picker (choose what to open there); everything element-specific — the
 * tab strips, each dock's "+" menu, the pickers — lives on the dock surfaces themselves
 * (features/dock), so this component stays two toggles.
 *
 * The pending-approval amber dot rides the button of the dock that holds the agents tab
 * (the right one while the panel is closed — the default edge panels open on), keeping a
 * nested approval discoverable while the panel is off screen.
 */
import { useSyncExternalStore } from "react";
import { S } from "../../lib/strings";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { toneDot } from "../../lib/tone";
import { confirmClose } from "../dock/close-guard";
import {
  dockTabs,
  dockVersion,
  isDockVisible,
  panelDock,
  subscribeDock,
  tabKey,
  toggleDock,
  type DockPosition,
} from "../dock/dock-state";

/** Window with a bottom pane / a right pane: the two pull-open buttons. */
const PANEL_BOTTOM_ICON = "M4 5h16v14H4zM4 14h16";
const PANEL_RIGHT_ICON = "M4 5h16v14H4zM14 5v14";

export interface PanelsToolbarProps {
  /** A pending approval inside a subagent: amber dot beside the agents tab's dock button. */
  agentsPending: boolean;
}

const triggerClass = (active: boolean) =>
  `relative flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors duration-150 ${
    active
      ? "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200"
      : "text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
  }`;

export function PanelsToolbar({ agentsPending }: PanelsToolbarProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  // The dot follows the agents tab's dock; with the panel closed it sits on the right
  // button — the edge the panel opens on.
  const pendingDock: DockPosition = panelDock("agents") ?? "right";

  const toggles: Array<{ position: DockPosition; label: string; icon: string }> = [
    { position: "bottom", label: S.dock.bottomDock, icon: PANEL_BOTTOM_ICON },
    { position: "right", label: S.dock.rightDock, icon: PANEL_RIGHT_ICON },
  ];

  // Hiding a dock unmounts its panel bodies once it has collapsed, so a tab holding unsaved
  // work (the Files panel's editor) gets to ask first; opening never needs to.
  const toggle = (position: DockPosition): void => {
    if (!isDockVisible(position)) {
      toggleDock(position);
      return;
    }
    void confirmClose(dockTabs(position).map(tabKey)).then((ok) => {
      if (ok) toggleDock(position);
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-1" data-testid="panels-toolbar">
      {toggles.map(({ position, label, icon }) => (
        <button
          key={position}
          type="button"
          aria-expanded={isDockVisible(position)}
          onClick={() => toggle(position)}
          title={label}
          aria-label={label}
          data-testid={`dock-toggle-${position}`}
          className={triggerClass(isDockVisible(position))}
        >
          <GlyphIcon d={icon} size={ICON_SIZE.iconButton} />
          {agentsPending && pendingDock === position && (
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${toneDot.attention}`} />
          )}
        </button>
      ))}
    </div>
  );
}
