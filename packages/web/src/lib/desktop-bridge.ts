/**
 * The desktop shell's preload bridge (packages/desktop/src/preload.ts): exactly one
 * capability, opening Electron DevTools on this window. Absent in a plain browser tab —
 * feature-detect with desktopBridge() and degrade (a browser has its own DevTools
 * shortcut; a page cannot open them programmatically).
 */
export interface PenguinDesktopBridge {
  openDevTools(): void;
}

declare global {
  interface Window {
    penguinDesktop?: PenguinDesktopBridge;
  }
}

/** The bridge when running inside the desktop shell, null in a plain browser. */
export function desktopBridge(): PenguinDesktopBridge | null {
  if (typeof window === "undefined") return null;
  return window.penguinDesktop ?? null;
}
