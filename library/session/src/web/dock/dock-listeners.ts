/**
 * What the dock tells the modules that contribute to it: the conversation on screen changed
 * (`DockModule.scopeListeners`), and a dock surface took one more step into or out of full screen
 * (`DockModule.layoutListeners`). The dock module fills both lists at boot from its slots
 * (module.ts), in `order`; the scope layer and the dock panel announce (dock-scope.tsx,
 * dock-panel.tsx). The dock names none of its listeners.
 *
 * Neither is gated on a contributor's server module (lib/module-gate.ts): they keep a
 * contributor's own state in step with the screen, and a listener skipped while the gate is
 * closed would start from a stale scope once it opens.
 */
import type {
  DockLayoutListener,
  DockScopeChange,
  DockScopeListener,
} from "@prismshadow/penguin-web-plugin";

let scopeListeners: readonly DockScopeListener[] = [];
let layoutListeners: readonly DockLayoutListener[] = [];

/** The dock module's side: the contributed listeners, each list in its contributed order. */
export function setDockListeners(next: {
  scope: readonly DockScopeListener[];
  layout: readonly DockLayoutListener[];
}): void {
  scopeListeners = next.scope;
  layoutListeners = next.layout;
}

/** Tells every scope listener, before the docks themselves switch. */
export function announceDockScope(change: DockScopeChange): void {
  for (const listener of scopeListeners) listener(change);
}

/** Tells every layout listener that a full-screen step has reached the DOM. */
export function announceDockLayout(): void {
  for (const listener of layoutListeners) listener();
}
