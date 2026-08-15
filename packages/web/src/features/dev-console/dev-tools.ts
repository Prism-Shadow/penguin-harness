/**
 * Developer-tooling notification hook, mounted once at the app root (AppLayout).
 *
 * "Developer console" means the real one — Electron DevTools in the desktop shell
 * (Ctrl+Shift+I via the standard View menu), the browser's own in a tab (F12). The app
 * provides no in-app way to open one: an earlier Ctrl+P command palette existed
 * specifically to open a custom in-app console, but with that console cut, filtering a
 * list to reach its one remaining action (reload page) couldn't justify a global
 * shortcut, so the palette was removed too — see git history if you go looking for it.
 *
 * What's left: the SSE handler (state/sessions.tsx) records `web_updated` to
 * sessionStorage right before the reload it triggers (see lib/dev-console.ts's module
 * doc for why that has to be storage-backed rather than live). This hook replays the
 * latest entry as a console.info line once per page load — so after the auto-reload,
 * whoever has the real developer console open sees what just landed.
 */
import { useEffect } from "react";
import { readDevConsoleEvents } from "../../lib/dev-console";

export function useDevTools(): void {
  useEffect(() => {
    const events = readDevConsoleEvents(window.sessionStorage);
    const latest = events[events.length - 1];
    if (latest !== undefined) {
      console.info(`[hmr] web updated to rev ${latest.rev} (${latest.at})`, { feed: events });
    }
  }, []);
}
