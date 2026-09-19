/**
 * Whether this page is drawn by the desktop shell's renderer — an Electron window — whatever
 * session it holds.
 *
 * This is a different question from isDesktopShellWindow (lib/account-menu), which asks
 * whether the page may drive the shell around it and is answered by the session, because the
 * server enforces it. What the renderer is decides only how the page itself may behave, and
 * the session cannot answer it: in attach mode the shell's window signs in through the login
 * page like a browser (`desktopMode` false, `sessionVia` "password"), yet it is still an
 * Electron window — one with no popup blocker, whose shell refuses every blank window.
 *
 * Electron's default user agent carries `Electron/<version>` after Chrome's, and the shell
 * sets no user agent of its own (nothing in packages/desktop calls setUserAgent or sets
 * userAgentFallback). No browser's user agent contains that token.
 */
export function isElectronRenderer(userAgent: string): boolean {
  return /\bElectron\//.test(userAgent);
}
