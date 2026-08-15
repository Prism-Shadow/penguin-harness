/**
 * The app-root mount point for developer tooling: the Ctrl+P command palette, and the
 * console.info replay that surfaces HMR update notifications in the developer console.
 *
 * "Developer console" means the real one — Electron DevTools in the desktop shell
 * (Ctrl+Shift+I via the standard View menu), the browser's own in a tab (F12). The
 * app deliberately has no way to open it (the shell keeps a zero-preload window);
 * notifications reach it as console.info lines instead: the SSE handler records
 * `web_updated` to sessionStorage before the reload it triggers (see
 * lib/dev-console.ts), and this component replays the latest entry once per page
 * load — so after the auto-reload, opening the console shows what just landed.
 */
import { useEffect, useMemo } from "react";
import { CommandPalette } from "./command-palette";
import type { PaletteAction } from "./command-palette";
import { readDevConsoleEvents } from "../../lib/dev-console";
import { S } from "../../lib/strings";

export function DevTools() {
  // The cross-reload update notification, in the console itself: latest entry first,
  // the full feed attached for expansion. Once per page load, on purpose — each reload
  // lands on a fresh console, and the line is how the update that caused it stays
  // visible there.
  useEffect(() => {
    const events = readDevConsoleEvents(window.sessionStorage);
    const latest = events[events.length - 1];
    if (latest !== undefined) {
      console.info(`[hmr] web updated to rev ${latest.rev} (${latest.at})`, { feed: events });
    }
  }, []);

  const actions = useMemo<PaletteAction[]>(
    () => [
      {
        id: "reload-page",
        label: S.commandPalette.reloadPage,
        run: () => window.location.reload(),
      },
    ],
    [],
  );

  return <CommandPalette actions={actions} />;
}
