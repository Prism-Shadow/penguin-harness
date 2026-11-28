import {
  dockPageKey,
  existingDockPanel,
  pageSessionId,
  sessionAppPair,
  useNarrow,
  usePageWorkspace,
  useProject,
} from "@prismshadow/penguin-web/internal";
/**
 * Keeps the dock's scope on the conversation on screen (`WebAppModule.layers`, mounted once beside
 * every page). The docks belong to the conversation they were arranged in, so switching Sessions
 * switches the arrangement with it (dock-state.ts). The draft page's route id ("new" / a parked
 * draft id), qualified by its Project, is a scope of its own, handed to the Session the first
 * send creates; pages with no Session scope to a placeholder. The modules listening on
 * `DockModule.scopeListeners` hear of each change first (dock-listeners.ts). Layout effect, not a
 * plain one: it has to land before the chat page's docks paint, or the outgoing conversation's
 * docks flash on the incoming one.
 */
import { useLayoutEffect, useRef } from "react";
import { useLocation, useMatch } from "react-router";

import { announceDockScope } from "./dock-listeners";

import {
  setDockScope,
  openDockPage,
  activateTab,
  panelDock,
  detachDockPage,
  setDockFullscreen,
} from "./dock-state";

export function DockScope() {
  const sessionRoute = useMatch("/chat/:sessionId")?.params.sessionId;
  const workspace = usePageWorkspace();
  const location = useLocation();
  const narrow = useNarrow();
  const pair = workspace?.current && sessionAppPair(workspace.layout);
  // The router arrives one render before the workspace publishes its new Session/app pair.
  // Keep the visible host across that handoff so opening the dock is an ordinary size change.
  const beside =
    location.state?.workspaceRequest && new URLSearchParams(location.search).get("beside");
  const pendingHost =
    !pair && beside
      ? workspace?.layout.pages.find(
          (page) =>
            page.kind === "session" &&
            workspace.layout.visible.includes(page.id) &&
            pageSessionId(page) === beside,
        )
      : undefined;
  const host = pair?.session ?? pendingHost;
  const scope = host ? pageSessionId(host) : (sessionRoute ?? null);
  const visibleSession = host ?? workspace?.current;
  const windowKey = visibleSession?.id.startsWith("scoped-chat:") ? visibleSession.id : undefined;
  const appId = pair ? pair.app.id : null;
  const existingPanel = pair ? existingDockPanel(pair.app) : null;
  const previousScope = useRef<string | null>(null);
  const { currentProject } = useProject();
  useLayoutEffect(() => {
    const projectId = currentProject?.projectId ?? null;
    const provisional = scope === "new" || scope?.startsWith("draft-");
    const dockScope = provisional ? `${projectId ?? "~none"}:${scope}` : scope;
    announceDockScope({ scope: dockScope, projectId });
    setDockScope(dockScope, windowKey);
  }, [scope, windowKey, currentProject?.projectId]);
  useLayoutEffect(() => {
    const owner = windowKey ?? scope;
    const sameScope = previousScope.current === owner;
    previousScope.current = owner;
    if (!appId || !scope) return;
    const key = dockPageKey(appId);
    detachDockPage(key, owner!);
    if (!panelDock(key) || sameScope) openDockPage(key, existingPanel);
    else activateTab(key);
  }, [appId, existingPanel, scope, windowKey]);
  useLayoutEffect(() => {
    if (!appId || location.state?.fullScreenSessionTool !== appId) return;
    setDockFullscreen(narrow ? "bottom" : "right");
    return () => setDockFullscreen(null);
  }, [appId, location.key, narrow]);
  return null;
}
