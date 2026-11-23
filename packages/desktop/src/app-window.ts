/**
 * Another window of this app on the App, opened by the shell for the command palette's New
 * Window.
 *
 * The request arrives over the server's message port (relayed from POST /api/desktop/window)
 * rather than as a window-open request from the page: the shell refuses those for the App
 * itself, since it cannot tell which frame asked (see classifyWindowOpen in util.ts). The
 * window it opens is a subordinate one, like a detached terminal: the same options a page-opened
 * window gets, the same guard, and no `<webview>` — the built-in browser's tabs are guests of
 * the main window alone, and the page does not offer the built-in browser where the tag is
 * missing. The main window stays the one that hides to the tray, reloads after a crash and
 * signs back in.
 */
import type { BrowserWindowConstructorOptions } from "electron";
import type { DesktopOpenWindowMessage } from "@prismshadow/penguin-server/api";
import { APP_WINDOW_OPTIONS } from "./util.js";

/** Whether a frame off the port is the request to open a window. */
export function parseOpenWindowRequest(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as Partial<DesktopOpenWindowMessage>).type === "desktop-open-window";
}

/**
 * The options of a window the shell opens on the App. The hardening is the page-opened
 * window's (openWindowFor in main.ts): no Node, no `<webview>`, and nothing that hides it.
 */
export function appWindowOptions(iconPath: string | null): BrowserWindowConstructorOptions {
  return {
    ...(iconPath !== null ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
    ...APP_WINDOW_OPTIONS,
  };
}

export interface AppWindowDeps<W> {
  /** The App's origin; null before the embedded server has one. */
  origin: string | null;
  iconPath: string | null;
  create(options: BrowserWindowConstructorOptions): W;
  /** The rules every window this app opens lives under (guardOpenedWindow in main.ts). */
  guard(window: W): void;
  load(window: W, url: string): Promise<void>;
  log(line: string): void;
}

/** Opens the window on the App's front page. Before boot has an origin there is nothing to show. */
export function openAppWindow<W>(deps: AppWindowDeps<W>): W | null {
  if (deps.origin === null) {
    deps.log("[shell] a window was asked for before the server was up");
    return null;
  }
  const window = deps.create(appWindowOptions(deps.iconPath));
  deps.guard(window);
  deps.load(window, `${deps.origin}/`).catch((err: unknown) => {
    deps.log(`[shell] the new window did not load: ${String(err)}`);
  });
  return window;
}
