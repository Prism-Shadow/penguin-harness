/**
 * Whether this page is drawn by the desktop shell's renderer — an Electron window — whatever
 * session it holds.
 *
 * This is a different question from isDesktopShellWindow (lib/account-menu), which asks
 * whether the page may drive the shell around it and is answered by the session, because the
 * server enforces it. What the renderer is decides only how the page itself may behave, and
 * the session cannot answer it: in attach mode the shell's window is signed in to a server
 * that was not started in desktop mode (`desktopMode` false, whatever `sessionVia` says), yet
 * it is still an Electron window — one with no popup blocker, whose shell refuses every blank
 * window.
 *
 * Electron's default user agent carries `Electron/<version>` after Chrome's, and the shell
 * leaves it alone on the App's windows: the one setUserAgent in packages/desktop is on the
 * built-in browser's own partition (builtin-browser.ts). No browser's user agent contains that
 * token.
 */
export function isElectronRenderer(userAgent: string): boolean {
  return /\bElectron\//.test(userAgent);
}
