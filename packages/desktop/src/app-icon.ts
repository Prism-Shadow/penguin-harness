/**
 * Runtime window icon — pure path logic, no Electron imports (unit-tested).
 *
 * Only Linux (and Windows dev runs) need it: a packaged Windows app gets its taskbar
 * icon from the exe resources electron-builder embeds, and macOS ignores BrowserWindow
 * icons entirely (the Dock icon comes from the bundle's icns). The committed master is
 * build/icon.png (rendered by scripts/render-icon.mjs), which is electron-builder's
 * buildResources directory and does not ship inside the app; scripts/build-assets.mjs
 * copies it into dist/, so the same app-path-relative lookup serves both a source run and
 * a packaged app.
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
