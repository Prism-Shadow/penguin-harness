/**
 * Top-right dock switcher of the chat toolbar (Codex-style): exactly two icon toggles — pull
 * open the bottom dock, pull open the right dock — drawn by the UI package's `PanelsToolbar`
 * and bound here to the dock store. Opening a dock that has no tabs yet lands on its picker
 * (choose what to open there); everything element-specific — the tab strips, each dock's "+"
 * menu, the pickers — lives on the dock surfaces themselves (features/dock).
 *
 * The pending-approval amber dot rides the toggle of the dock that holds the agents tab
 * (the right one while the panel is closed — the default edge panels open on), keeping a
 * nested approval discoverable while the panel is off screen.
 *
 * The new-chat draft has no toolbar, and the one panel it has a use for is Files, on the folder
 * picked there: `FilesPanelToggle` is the same toggle, for that one panel, beside the draft's
 * Workspace pill.
 */
import { useSyncExternalStore } from "react";
import { ICONS, PanelsToolbar } from "@prismshadow/penguin-ui";
import type { PanelsToolbarToggle } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useShortcutTitle } from "../../lib/shortcuts/use-keymap";
import {
  dockVersion,
  isDockVisible,
  isTabShown,
  openPanel,
  panelDock,
  subscribeDock,
  toggleDock,
  type DockPosition,
} from "../dock/dock-state";
import { panelLabel } from "../dock/panel-meta";

export interface DockTogglesProps {
  /** A pending approval inside a subagent: amber dot beside the agents tab's dock toggle. */
  agentsPending: boolean;
}

export function DockToggles({ agentsPending }: DockTogglesProps) {
  useSyncExternalStore(subscribeDock, dockVersion);
  // The dot follows the agents tab's dock; with the panel closed it sits on the right
  // toggle — the edge the panel opens on.
  const pendingDock: DockPosition = panelDock("agents") ?? "right";

  const bottomTitle = useShortcutTitle(S.dock.bottomDock, "dock.toggleBottom");
  const rightTitle = useShortcutTitle(S.dock.rightDock, "dock.toggleRight");

  const toggle = (
    position: DockPosition,
    label: string,
    tooltip: string,
    glyph: string,
  ): PanelsToolbarToggle => ({
    key: position,
    label,
    tooltip,
    glyph,
    active: isDockVisible(position),
    badge: agentsPending && pendingDock === position,
    // Hiding a dock keeps every body mounted (dock-panel.tsx renders it at zero size), so a
    // tab holding unsaved work has nothing to lose and nothing to ask.
    onToggle: () => toggleDock(position),
  });

  return (
    <PanelsToolbar
      toggles={[
        toggle("bottom", S.dock.bottomDock, bottomTitle, ICONS.panelBottom),
        toggle("right", S.dock.rightDock, rightTitle, ICONS.panelRight),
      ]}
    />
  );
}

/**
 * The dock's Files panel, from the new-chat draft: pressed while the panel is on screen, it puts
 * that panel's dock away; otherwise it brings the panel up where it lives (the right dock the
 * first time). A temporary Workspace has no directory until the first message makes one, so
 * there the toggle has nothing to open and says so.
 */
export function FilesPanelToggle({ available }: { available: boolean }) {
  useSyncExternalStore(subscribeDock, dockVersion);
  const label = panelLabel("workspace");
  const shown = available && isTabShown("workspace");
  return (
    <PanelsToolbar
      toggles={[
        {
          key: "files",
          label,
          tooltip: available ? label : S.files.draftTemporary,
          glyph: ICONS.folderOpen,
          active: shown,
          unavailable: !available,
          onToggle: () => {
            const home = panelDock("workspace");
            if (shown && home !== null) toggleDock(home);
            else openPanel("workspace");
          },
        },
      ]}
    />
  );
}
