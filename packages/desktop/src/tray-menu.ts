/**
 * The tray menu as data — pure, no Electron imports (unit-tested). src/tray.ts turns it
 * into a native menu and binds the actions.
 *
 * The entries are deliberately few: the window is the product, and the tray is the way back
 * to it. The two navigation entries are ordinary in-window URL loads, so the window stays a
 * plain browser and the shell gains no channel into the Web App.
 */

/** What a menu entry does when it is clicked. */
export type TrayAction = "open" | "new-session" | "models" | "toggle-close-to-tray" | "quit";

export interface TrayMenuItem {
  action?: TrayAction;
  label?: string;
  type?: "separator" | "checkbox";
  checked?: boolean;
}

/**
 * In-window destinations of the navigation entries, relative to the app origin.
 *
 * "New Session" is the draft route and not `/chat`: the chat page with no session in the path
 * redirects to the most recent conversation, so a bare `/chat` reopens the last session rather
 * than starting one. `new` is the Web App's draft sentinel (`DRAFT_SESSION_ID` in
 * features/chat/chat-page.tsx), repeated here because this package does not depend on the Web
 * App — the test pins the two together.
 */
export const TRAY_NAV_PATHS: Record<"new-session" | "models", string> = {
  "new-session": "/chat/new",
  models: "/models",
};

export const CLOSE_TO_TRAY_LABEL = "Keep running in the tray when the window closes";

/** The menu entries, in order. `appName` carries the dev suffix on an unpackaged run. */
export function trayMenuTemplate(opts: { appName: string; closeToTray: boolean }): TrayMenuItem[] {
  return [
    { action: "open", label: `Open ${opts.appName}` },
    { type: "separator" },
    { action: "new-session", label: "New Session" },
    { action: "models", label: "Models" },
    { type: "separator" },
    {
      action: "toggle-close-to-tray",
      label: CLOSE_TO_TRAY_LABEL,
      type: "checkbox",
      checked: opts.closeToTray,
    },
    { type: "separator" },
    { action: "quit", label: "Quit" },
  ];
}
