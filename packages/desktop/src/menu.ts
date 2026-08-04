/**
 * Application menu.
 *
 * It exists for two reasons: it carries the "Check for Updates…" entry (the shell surfaces
 * updates through native UI only — see updater.ts), and a custom menu must still provide
 * the standard edit/window roles, without which copy, paste and select-all stop working
 * in the window on macOS.
 */
import { app, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { checkForUpdatesManually } from "./updater.js";

const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";

export function installApplicationMenu(): void {
  const checkForUpdates: MenuItemConstructorOptions = {
    label: "Check for Updates…",
    click: () => void checkForUpdatesManually(),
  };
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: "about" },
              checkForUpdates,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] satisfies MenuItemConstructorOptions[])
      : []),
    {
      label: "File",
      submenu: [isMac ? { role: "close" } : { role: "quit" }],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(isMac ? [] : [checkForUpdates, { type: "separator" } as MenuItemConstructorOptions]),
        {
          label: "Project on GitHub",
          click: () => void shell.openExternal(REPO_URL),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
