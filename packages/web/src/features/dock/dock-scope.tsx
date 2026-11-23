import { pageSessionId } from "../../lib/page-layout";
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
import { useMatch } from "react-router";
import { useProject } from "../../state/project";
import { announceDockScope } from "./dock-listeners";
import { usePageWorkspace } from "../../lib/page-workspace";
import { sessionAppPair, dockPageKey } from "../../lib/session-app-dock";
import { setDockScope, openPanel, panelDock, detachDockPage } from "./dock-state";

export function DockScope() {
  const sessionRoute = useMatch("/chat/:sessionId")?.params.sessionId;
  const workspace = usePageWorkspace();
  const pair = workspace?.current && sessionAppPair(workspace.layout);
  const scope = pair ? pageSessionId(pair.session) : (sessionRoute ?? null);
  const visibleSession = pair ? pair.session : workspace?.current;
  const windowKey = visibleSession?.id.startsWith("scoped-chat:") ? visibleSession.id : undefined;
  const appId = pair ? pair.app.id : null;
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
    if (!panelDock(key) || sameScope) openPanel(key, "right");
  }, [appId, scope, windowKey]);
  return null;
}
