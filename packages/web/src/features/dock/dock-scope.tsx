import { useProject } from "../../state/project";
import { dispatchBrowser } from "../builtin-browser";
/**
 * Keeps the dock's scope on the conversation on screen (`WebAppModule.layers`, mounted once beside
 * every page). The docks belong to the conversation they were arranged in, so switching Sessions
 * switches the arrangement with it (dock-state.ts). The draft page's route id ("new" / a parked
 * draft id) is a scope of its own, handed to the Session the first send creates; pages with no
 * Session scope to a placeholder. Layout effect, not a plain one: it has to land before the chat
 * page's docks paint, or the outgoing conversation's docks flash on the incoming one.
 */
import { useLayoutEffect } from "react";
import { useMatch } from "react-router";
import { setDockScope } from "./dock-state";

export function DockScope() {
  const scope = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  const { currentProject } = useProject();
  useLayoutEffect(() => {
    const projectId = currentProject?.projectId ?? null;
    const provisional = scope === "new" || scope?.startsWith("draft-");
    const browserScope = provisional
      ? `${projectId ?? "~none"}:${scope}`
      : (scope ?? (projectId === null ? null : `~project:${projectId}`));
    dispatchBrowser({ type: "scope", scope: browserScope, projectId });
    setDockScope(scope);
  }, [scope, currentProject?.projectId]);
  return null;
}
