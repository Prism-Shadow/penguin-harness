/**
 * Detach a Browser tab to a tab of the web browser's own, and RETURN it when that tab closes
 * — the terminal's detach, for a page: the dock tab leaves the strip while the page lives
 * in the new tab, and closing that tab puts the dock tab back into the conversation and
 * dock it left. The new tab is the site's `<label>.localhost` URL: the same host, so the
 * page keeps its cookies and storage, and is first-party there. There is no cross-window
 * close event, so a slow poll on the handle's `closed` flag watches for it. (The handle is
 * why the tab is NOT opened with "noopener".)
 *
 * In the desktop app a `<label>.localhost` URL on the instance's port is part of the local
 * surface, so the same call opens a window of the app.
 */
import { currentDockScope, removeTab, restoreBrowserTab } from "../dock/dock-state";
import type { DockPosition } from "../dock/dock-state";
import { browserLocation } from "./browser-tabs";

export function detachBrowser(id: string, position: DockPosition): void {
  const url = browserLocation(id);
  if (url === null) return; // a blank tab has nothing to open
  const fromScope = currentDockScope();
  const popup = window.open(url, "_blank");
  // A blocked popup opened nothing, so there is nothing to move: the dock tab stays.
  if (!popup) return;
  removeTab(`browser:${id}`);
  const timer = window.setInterval(() => {
    if (!popup.closed) return;
    window.clearInterval(timer);
    restoreBrowserTab(fromScope, id, position);
  }, 600);
}
