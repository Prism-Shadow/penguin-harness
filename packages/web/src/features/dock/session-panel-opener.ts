import { useContext, useEffect } from "react";
import { ChatSessionContext } from "../../lib/chat-session";
import { usePageWorkspace } from "../../lib/page-workspace";
import { machineForSession } from "../../lib/session-machines";
import { isSessionWorkbenchKind, sessionWorkbenchPage } from "../../lib/session-workbenches";
import { currentDockScope, setSessionPanelOpener } from "./dock-state";
import { dockPanelDefinition } from "./panel-registry";

const openers = new Map<string, (id: string) => boolean>();
export function installSessionPanelOpener() {
  setSessionPanelOpener((id) => openers.get(currentDockScope())?.(id) ?? false);
}

/** The launcher can be hidden. Its mounted conversation still owns file links, keys and panel actions. */
export function useSessionPanelOpener() {
  const chat = useContext(ChatSessionContext);
  const workspace = usePageWorkspace();
  const session = chat?.selected;
  const sid = session?.sessionId;
  const projectId = chat?.projectId;
  useEffect(() => {
    if (!sid || !projectId || !workspace || !session) return;
    const open = (id: string) => {
      if (!isSessionWorkbenchKind(id)) return false;
      const definition = dockPanelDefinition(id);
      if (!definition || definition.offered?.() === false) return false;
      const scope = { projectId, sessionId: sid, machineId: machineForSession(sid) };
      workspace.openBesideSession(sid, sessionWorkbenchPage(id, scope, definition.label()), {
        ...scope,
        session,
      });
      return true;
    };
    openers.set(sid, open);
    return () => {
      if (openers.get(sid) === open) openers.delete(sid);
    };
  }, [sid, projectId, workspace, session]);
}
