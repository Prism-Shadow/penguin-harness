/**
 * Application menu. Electron's default menu cannot be extended, only replaced, so the
 * standard structure is rebuilt here — on macOS the Edit roles are what make clipboard
 * shortcuts work inside the window, so they must be present. The one custom entry is
 * "Install 'penguin' Command…" (see cli-install.ts), shown only where installing makes
 * sense (packaged macOS / Windows / AppImage; deb ships /usr/bin/penguin itself).
 * On Windows/Linux the window uses autoHideMenuBar, so the bar appears on Alt.
 */
import { app, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";

export const INSTALL_CLI_MENU_LABEL = "Install 'penguin' Command…";

export function installAppMenu(opts: {
  includeCliInstall: boolean;
  onInstallCli: () => void;
}): void {
  const isMac = process.platform === "darwin";
  const cliItems: MenuItemConstructorOptions[] = opts.includeCliInstall
    ? [{ label: INSTALL_CLI_MENU_LABEL, click: opts.onInstallCli }]
    : [];

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        ...(cliItems.length > 0
          ? ([{ type: "separator" }, ...cliItems] as MenuItemConstructorOptions[])
          : []),
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [
        ...cliItems,
        ...(cliItems.length > 0 ? ([{ type: "separator" }] as MenuItemConstructorOptions[]) : []),
        { role: "quit" },
      ],
    });
  }
  template.push({ role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
