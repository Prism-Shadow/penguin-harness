/**
 * The agent browser follows the conversation on screen (`DockModule.scopeListeners`): a draft's
 * own scope and a Session's id are the browser's scope as they are the docks'; a page with no
 * conversation scopes the browser to its Project, so a page opened there stays the Project's.
 */
import type { DockScopeListener } from "@prismshadow/penguin-web-plugin";
import { dispatchBrowser } from "./browser-store";

type Scope = { scope: string | null; projectId: string | null };
let dock: Scope = { scope: null, projectId: null };
const active = new Map<symbol, Scope>();
function apply(): void {
  const target = [...active.values()].at(-1) ?? dock;
  dispatchBrowser({ type: "scope", ...target });
}
export function showWorkbenchGroup(sessionId: string, projectId: string): () => void {
  const id = Symbol("browser-workbench");
  active.set(id, { scope: sessionId, projectId });
  apply();
  return () => {
    active.delete(id);
    apply();
  };
}
export const followDockScope: DockScopeListener = ({ scope, projectId }) => {
  dock = { scope: scope ?? (projectId === null ? null : `~project:${projectId}`), projectId };
  apply();
};
