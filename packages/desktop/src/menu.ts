/**
 * Application menu. Electron's default menu cannot be extended, only replaced, so the
 * standard structure is rebuilt here. The custom entries are native-only shell actions:
 * installing the bundled `penguin` command, installing this build's server onto a machine
 * reachable over SSH, and checking for desktop updates.
 */
import { app, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { checkForUpdatesManually, updatesAvailableInThisForm } from "./updater.js";

export const INSTALL_CLI_MENU_LABEL = "Install 'penguin' Command…";
export const REMOTE_MENU_LABEL = "Install Server on Remote Host";

const CHECK_FOR_UPDATES_MENU_LABEL = "Check for Updates…";
const REPO_URL = "https://github.com/Prism-Shadow/penguin-harness";

export function installAppMenu(opts: {
  includeCliInstall: boolean;
  onInstallCli: () => void;
  /** Host aliases from ~/.ssh/config; empty hides nothing — the entry explains itself instead. */
  remoteHosts?: string[];
  onInstallRemote?: (alias: string) => void;
}): void {
  const isMac = process.platform === "darwin";
  const cliItems: MenuItemConstructorOptions[] = opts.includeCliInstall
    ? [{ label: INSTALL_CLI_MENU_LABEL, click: opts.onInstallCli }]
    : [];
  // One entry per ssh alias rather than a free-text host field: targets come from
  // ~/.ssh/config, which is the only host list this app reads and never writes.
  const remoteHosts = opts.remoteHosts ?? [];
  const onInstallRemote = opts.onInstallRemote;
  const remoteItems: MenuItemConstructorOptions[] = onInstallRemote
    ? [
        {
          label: REMOTE_MENU_LABEL,
          submenu:
            remoteHosts.length > 0
              ? remoteHosts.map((alias) => ({
                  label: alias,
                  click: () => onInstallRemote(alias),
                }))
              : [{ label: "No hosts in ~/.ssh/config", enabled: false }],
        },
      ]
    : [];
  const checkForUpdates: MenuItemConstructorOptions = {
    label: CHECK_FOR_UPDATES_MENU_LABEL,
    enabled: updatesAvailableInThisForm(),
    click: () => void checkForUpdatesManually(),
  };
  const projectOnGitHub: MenuItemConstructorOptions = {
    label: "Project on GitHub",
    click: () => void shell.openExternal(REPO_URL),
  };

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        ...cliItems,
        ...remoteItems,
        ...(cliItems.length + remoteItems.length > 0
          ? ([{ type: "separator" }] as MenuItemConstructorOptions[])
          : []),
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
    });
  } else {
    template.push({
      label: "File",
      submenu: [
        ...cliItems,
        ...remoteItems,
        ...(cliItems.length + remoteItems.length > 0
          ? ([{ type: "separator" }] as MenuItemConstructorOptions[])
          : []),
        { role: "quit" },
      ],
    });
  }
  template.push(
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(isMac ? [] : [checkForUpdates, { type: "separator" } as MenuItemConstructorOptions]),
        projectOnGitHub,
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
