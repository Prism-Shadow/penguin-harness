/**
 * Runtime window and tray icons — pure path logic, no Electron imports (unit-tested).
 *
 * The window icon is only needed on Linux (and Windows dev runs): a packaged Windows app gets
 * its taskbar icon from the exe resources electron-builder embeds, and macOS ignores
 * BrowserWindow icons entirely (the Dock icon comes from the bundle's icns). The tray icon is
 * needed on all three, in two forms — macOS takes a monochrome template image the menu bar
 * inverts with its own appearance, the other two a small colour image.
 *
 * The committed masters are build/icon.png and build/tray/*.png (rendered by
 * scripts/render-icon.mjs), which is electron-builder's buildResources directory and does not
 * ship inside the app; scripts/build-assets.mjs copies them into dist/, so the same
 * app-path-relative lookup serves both a source run and a packaged app.
 */
import fs from "node:fs";
import path from "node:path";

/** Window icon location relative to the app directory (the package dir for a source run). */
export const WINDOW_ICON_RELPATH = ["dist", "icon.png"];

/** The window-icon path for a platform, or null where window icons are not used (macOS). */
export function windowIconPathFor(appPath: string, platform: NodeJS.Platform): string | null {
  if (platform === "darwin") return null;
  return path.join(appPath, ...WINDOW_ICON_RELPATH);
}

/** Same, but only when the file actually exists (a missing icon must not break windows). */
export function resolveWindowIcon(appPath: string, platform: NodeJS.Platform): string | null {
  const iconPath = windowIconPathFor(appPath, platform);
  return iconPath !== null && fs.existsSync(iconPath) ? iconPath : null;
}

/**
 * Tray icon location relative to the app directory. The `…Template` name is what tells macOS
 * to treat the image as a mask; each file has an `@2x` sibling that the image loader picks up
 * on a high-DPI display.
 */
export function trayIconRelPath(platform: NodeJS.Platform): string[] {
  return platform === "darwin"
    ? ["dist", "tray", "trayTemplate.png"]
    : ["dist", "tray", "tray.png"];
}

/** The tray-icon path for a platform, whether or not the file is there. */
export function trayIconPathFor(appPath: string, platform: NodeJS.Platform): string {
  return path.join(appPath, ...trayIconRelPath(platform));
}

/** Same, but only when the file exists — a missing icon leaves the app without a tray. */
export function resolveTrayIcon(appPath: string, platform: NodeJS.Platform): string | null {
  const iconPath = trayIconPathFor(appPath, platform);
  return fs.existsSync(iconPath) ? iconPath : null;
}
