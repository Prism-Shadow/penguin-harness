import { useContext, useSyncExternalStore } from "react";
import { ICONS, toastInfo } from "@prismshadow/penguin-ui";
import { ChatSessionContext, PageIdentity, S, machineForSession, usePageWorkspace } from "@prismshadow/penguin-web/internal";

import {
  launcherHiddenVersion,
  readLauncherHidden,
  subscribeLauncherHidden,
  writeLauncherHidden,
} from "./dock-launcher-state";
import { openPanel, type DockPosition } from "./dock-state";
import type { DockPanelDefinition } from "./panel-registry";
import type { CommandId } from "../../lib/shortcuts/types";

/**
 * One thing a conversation's launch surfaces open: a menu row reads `label`, a start-page tile
 * `name` (the App Center's "Open App Center" row is its "App Center" tile), and a tile's hint
 * names `shortcut`'s keys while they are bound.
 */
export interface SessionShortcut {
  key: string;
  label: string;
  name: string;
  glyph: string;
  shortcut?: CommandId;
  choose: () => void;
}

/**
 * The conversation's launch surfaces — the launcher's fan, the right dock's "+" menu and its start
 * page — open the same visible Session's capability-filtered panels, in this order. Only the
 * floating launcher offers "hide the launcher": it is the ball's own control, while the dock's "+"
 * menu is for opening things and a hidden ball is shown again in Settings.
 */
export function useSessionShortcuts(
  panels: DockPanelDefinition[],
  position?: DockPosition,
  options: { hideEntry?: boolean } = {},
) {
  const chat = useContext(ChatSessionContext);
  const selected = chat?.selected;
  const host = useContext(PageIdentity)?.sessionHost;
  const workspace = usePageWorkspace();
  useSyncExternalStore(subscribeLauncherHidden, launcherHiddenVersion);
  const hidden = readLauncherHidden();
  const entries: SessionShortcut[] = panels.map((panel) => ({
    key: panel.id,
    label: panel.label(),
    name: panel.label(),
    glyph: panel.glyph,
    ...(panel.shortcut !== undefined ? { shortcut: panel.shortcut } : {}),
    choose: () => openPanel(panel.id, position, panel.defaultPosition),
  }));
  if (
    workspace &&
    selected &&
    selected.projectId === chat?.projectId &&
    (!host ||
      (host.session.sessionId === selected.sessionId &&
        host.session.projectId === selected.projectId))
  ) {
    entries.unshift({
      key: "app-center",
      label: S.dock.openAppCenter,
      name: S.appCenter.title,
      glyph: ICONS.tiles,
      choose: () =>
        workspace.openAppCenterBesideSession(selected.sessionId, {
          projectId: selected.projectId,
          machineId: host ? host.machineId : machineForSession(selected.sessionId),
          session: selected,
        }),
    });
  }
  if (!options.hideEntry) return entries;
  entries.push({
    key: "hide",
    label: hidden ? S.dock.launcherShow : S.dock.launcherHide,
    name: hidden ? S.dock.launcherShow : S.dock.launcherHide,
    glyph: hidden ? ICONS.eye : ICONS.eyeOff,
    choose: () => {
      writeLauncherHidden(!hidden);
      if (!hidden) toastInfo(S.dock.launcherHiddenToast);
    },
  });
  return entries;
}
