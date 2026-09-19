/**
 * The tray menu as data — pure, no Electron imports (unit-tested). src/tray.ts turns it
 * into a native menu and binds the actions.
 *
 * The entries are deliberately few: the window is the product, and the tray is the way back
 * to it. The two navigation entries are ordinary in-window URL loads, so the window stays a
 * plain browser and the shell gains no channel into the Web App.
 *
 * The shell keeps its own typed labels because it starts before the Web App.
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

/** The supported UI locales, which the tray follows. */
export type TrayLocale = "en";

/** One language's menu wording. `open` takes the app name, which carries a dev suffix unpackaged. */
interface TrayLabels {
  open: (appName: string) => string;
  newSession: string;
  models: string;
  closeToTray: string;
  quit: string;
}

export const TRAY_LABELS: Record<TrayLocale, TrayLabels> = {
  en: {
    open: (appName) => `Open ${appName}`,
    newSession: "New Session",
    models: "Models",
    closeToTray: "Keep running in the tray when the window closes",
    quit: "Quit",
  },
};

/**
 * The device language the shell falls back to until the Web App reports its own — the same
 * rule the Web App applies to `navigator.language` when its own preference is "follow the
 * system", so an untouched install agrees with itself across the window and the tray.
 */
export function resolveTrayLocale(_language: string | undefined): TrayLocale {
  return "en";
}

/** The menu entries, in order, in the given language. */
export function trayMenuTemplate(opts: {
  appName: string;
  closeToTray: boolean;
  locale: TrayLocale;
}): TrayMenuItem[] {
  const t = TRAY_LABELS[opts.locale];
  return [
    { action: "open", label: t.open(opts.appName) },
    { type: "separator" },
    { action: "new-session", label: t.newSession },
    { action: "models", label: t.models },
    { type: "separator" },
    {
      action: "toggle-close-to-tray",
      label: t.closeToTray,
      type: "checkbox",
      checked: opts.closeToTray,
    },
    { type: "separator" },
    { action: "quit", label: t.quit },
  ];
}
