import { useContext, useEffect } from "react";
import { ChatSessionContext } from "../../lib/chat-session";
import { PageIdentity, usePaneFocus } from "../../lib/page-focus";
import { sessionAppPair } from "../../lib/session-app-dock";
import { usePageWorkspace } from "../../lib/page-workspace";
import { machineForSession } from "../../lib/session-machines";
import { isSessionWorkbenchKind, sessionWorkbenchPage } from "../../lib/session-workbenches";
import { currentDockScope, setSessionPanelOpener } from "./dock-state";
import { dockPanelDefinition } from "./panel-registry";

let foreground: ((id: string) => boolean) | undefined;
export function installSessionPanelOpener() {
  setSessionPanelOpener((id) => foreground?.(id) ?? false);
}

/** The launcher can be hidden. Its mounted conversation still owns file links, keys and panel actions. */
export function useSessionPanelOpener() {
  const chat = useContext(ChatSessionContext);
  const workspace = usePageWorkspace();
  const page = useContext(PageIdentity);
  const focused = usePaneFocus();
  const host = page?.sessionHost;
  const paired = workspace && page && sessionAppPair(workspace.layout)?.session.id === page.id;
  const session = chat?.selected;
  const sid = session?.sessionId;
  const projectId = chat?.projectId;
  useEffect(() => {
    if ((!focused && !paired) || !sid || !projectId || !workspace || !session) return;
    if (host && (host.session.sessionId !== sid || host.session.projectId !== projectId)) return;
    const open = (id: string) => {
      if (currentDockScope() !== sid || !isSessionWorkbenchKind(id)) return false;
      const definition = dockPanelDefinition(id);
      if (!definition || definition.offered?.() === false) return false;
      const scope = {
        projectId,
        sessionId: sid,
        machineId: host ? host.machineId : machineForSession(sid),
      };
      workspace.openBesideSession(sid, sessionWorkbenchPage(id, scope, definition.label()), {
        ...scope,
        session,
      });
      return true;
    };
    foreground = open;
    return () => {
      if (foreground === open) foreground = undefined;
    };
  }, [sid, projectId, workspace, session, focused, paired, host]);
}
