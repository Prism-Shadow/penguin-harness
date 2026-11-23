import { useContext, useSyncExternalStore } from "react";
import { ICONS, toastInfo } from "@prismshadow/penguin-ui";
import { ChatSessionContext } from "../../lib/chat-session";
import { PageIdentity } from "../../lib/page-focus";
import { usePageWorkspace } from "../../lib/page-workspace";
import { machineForSession } from "../../lib/session-machines";
import { S } from "../../lib/strings";
import {
  launcherHiddenVersion,
  readLauncherHidden,
  subscribeLauncherHidden,
  writeLauncherHidden,
} from "./dock-launcher-state";
import { openPanel, type DockPosition } from "./dock-state";
import type { DockPanelDefinition } from "./panel-registry";

/** Both conversation menus launch from the same visible Session and capability-filtered panels. */
export function useSessionShortcuts(panels: DockPanelDefinition[], position?: DockPosition) {
  const chat = useContext(ChatSessionContext);
  const selected = chat?.selected;
  const host = useContext(PageIdentity)?.sessionHost;
  const workspace = usePageWorkspace();
  useSyncExternalStore(subscribeLauncherHidden, launcherHiddenVersion);
  const hidden = readLauncherHidden();
  const entries = panels.map((panel) => ({
    key: panel.id,
    label: panel.label(),
    glyph: panel.glyph,
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
      glyph: ICONS.tiles,
      choose: () =>
        workspace.openAppCenterBesideSession(selected.sessionId, {
          projectId: selected.projectId,
          machineId: host ? host.machineId : machineForSession(selected.sessionId),
          session: selected,
        }),
    });
  }
  entries.push({
    key: "hide",
    label: hidden ? S.dock.launcherShow : S.dock.launcherHide,
    glyph: hidden ? ICONS.eye : ICONS.eyeOff,
    choose: () => {
      writeLauncherHidden(!hidden);
      if (!hidden) toastInfo(S.dock.launcherHiddenToast);
    },
  });
  return entries;
}
