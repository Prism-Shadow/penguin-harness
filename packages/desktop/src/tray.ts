/**
 * The system tray icon: a lightweight entry point that survives closing the window, so the
 * app can keep serving in the background without leaving the user hunting for a way back in.
 *
 * Electron-facing and untested, like main.ts and menu.ts — the menu entries, the preference
 * file and the icon lookup are pure modules beside it, and they carry the tests.
 *
 * How the menu is opened splits by platform, for reasons noted at the split below.
 */
import { Menu, nativeImage, Tray } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { TRAY_NAV_PATHS, trayMenuTemplate } from "./tray-menu.js";
import type { TrayMenuItem } from "./tray-menu.js";
import { readTrayPrefs, updateTrayPrefs } from "./tray-prefs.js";

export interface TrayHandle {
  /** The live preference: the window's close handler asks at close time, not at install time. */
  closeToTray(): boolean;
  dispose(): void;
}

export interface TrayOptions {
  userDataDir: string;
  /** Resolved tray image, or null when the asset is missing (see app-icon.ts). */
  iconPath: string | null;
  appName: string;
  onShowWindow: () => void;
  onNavigate: (path: string) => void;
  onQuit: () => void;
  log: (line: string) => void;
}

/**
 * Installs the tray icon, or returns null when the platform cannot host one — a Linux desktop
 * without a tray implementation, or a headless CI run. The tray is a convenience; nothing
 * about it may keep the app from starting.
 */
export function installTray(opts: TrayOptions): TrayHandle | null {
  if (opts.iconPath === null) {
    opts.log("no tray icon asset was found; running without a tray icon");
    return null;
  }
  let prefs = readTrayPrefs(opts.userDataDir);
  let tray: Tray;
  try {
    const image = nativeImage.createFromPath(opts.iconPath);
    // A template image is drawn as a mask, so the menu bar inverts it with its own light or
    // dark appearance. Electron also infers this from the `…Template` file name; saying it
    // here keeps the behavior if the asset is ever renamed.
    if (process.platform === "darwin") image.setTemplateImage(true);
    tray = new Tray(image);
  } catch (err) {
    opts.log(`the tray icon could not be created: ${String(err)}`);
    return null;
  }
  tray.setToolTip(opts.appName);

  function setCloseToTray(next: boolean): void {
    // Optimistic: the checkbox shows the click even when the write below fails.
    prefs = { ...prefs, closeToTray: next };
    try {
      // Read-modify-write: the Appearance switch writes showTrayIcon into the same file,
      // and this snapshot was taken when the tray was installed.
      prefs = updateTrayPrefs(opts.userDataDir, { closeToTray: next });
    } catch (err) {
      opts.log(`the tray preference could not be saved: ${String(err)}`);
    }
    // An attached menu is a snapshot: rebuild it so the checkbox shows what was just written.
    attachMenu();
  }

  function nativeItem(item: TrayMenuItem): MenuItemConstructorOptions {
    if (item.type === "separator") return { type: "separator" };
    const base: MenuItemConstructorOptions = { label: item.label };
    switch (item.action) {
      case "open":
        return { ...base, click: opts.onShowWindow };
      case "new-session":
        return { ...base, click: () => opts.onNavigate(TRAY_NAV_PATHS["new-session"]) };
      case "models":
        return { ...base, click: () => opts.onNavigate(TRAY_NAV_PATHS.models) };
      case "toggle-close-to-tray":
        return {
          ...base,
          type: "checkbox",
          checked: item.checked === true,
          click: (menuItem) => setCloseToTray(menuItem.checked),
        };
      case "quit":
        return { ...base, click: opts.onQuit };
      default:
        return base;
    }
  }

  // Built fresh for each popup (and re-attached on each toggle where the menu is attached), so
  // the checkbox shows the preference as it stands rather than as it was at install.
  function buildMenu(): Menu {
    const template = trayMenuTemplate({
      appName: opts.appName,
      closeToTray: prefs.closeToTray,
    });
    return Menu.buildFromTemplate(template.map(nativeItem));
  }

  // How the menu is reached splits by platform. The AppIndicator / StatusNotifierItem trays
  // most Linux desktops use emit neither `click` nor `right-click`, and an attached context
  // menu is the only reliable way to open one there — the desktop itself decides which click
  // opens it. On macOS an attached menu opens on a left click too, which would cost the icon
  // its one-click path back to the window, so those two pop the menu by hand.
  const ATTACHES_MENU = process.platform === "linux";

  /** No-op off Linux: the menu is built per popup there instead. */
  function attachMenu(): void {
    if (ATTACHES_MENU) tray.setContextMenu(buildMenu());
  }

  // Registered everywhere: harmless on a tray that never emits it, and where the click does
  // arrive it is the shortest way back to the window. Where it does not, the menu's first
  // entry opens the window instead.
  tray.on("click", (event) => {
    // macOS treats Ctrl+click as a right click; where the OS still delivers it as a plain
    // click, this keeps it on the menu rather than raising the window.
    if (process.platform === "darwin" && event.ctrlKey) {
      tray.popUpContextMenu(buildMenu());
      return;
    }
    opts.onShowWindow();
  });
  if (!ATTACHES_MENU) tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));
  attachMenu();

  return {
    closeToTray: () => prefs.closeToTray,
    dispose: () => tray.destroy(),
  };
}
