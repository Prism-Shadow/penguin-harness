/**
 * The agent browser follows the conversation on screen (`DockModule.scopeListeners`): a draft's
 * own scope and a Session's id are the browser's scope as they are the docks'; a page with no
 * conversation scopes the browser to its Project, so a page opened there stays the Project's.
 */
import type { DockScopeListener } from "@prismshadow/penguin-web-plugin";
import { dispatchBrowser } from "./browser-store";

export const followDockScope: DockScopeListener = ({ scope, projectId }) => {
  dispatchBrowser({
    type: "scope",
    scope: scope ?? (projectId === null ? null : `~project:${projectId}`),
    projectId,
  });
};
