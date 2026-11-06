/**
 * New Window, the command palette's way to a second window of the desktop app.
 *
 * The page cannot open one itself — the shell refuses a window-open request for the App — so
 * the action asks the server, which has the shell open it (POST /api/desktop/window). This
 * file keeps the one decision pure (vitest runs node-only here, so nothing renders — same
 * split as account-menu.ts).
 */
import { isDesktopShellWindow } from "./account-menu";
import type { AccountMenuSession } from "./account-menu";

/**
 * Whether to offer New Window at all: only a window of the desktop app, because only there is
 * there a shell to open one — see isDesktopShellWindow for why both halves of that are
 * required. The server enforces the same pair on the route.
 */
export function offersNewWindow(session: AccountMenuSession): boolean {
  return isDesktopShellWindow(session);
}
