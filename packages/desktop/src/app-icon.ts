/**
 * Runtime window icon — pure path logic, no Electron imports (unit-tested).
 *
 * Only Linux (and Windows dev runs) need it: a packaged Windows app gets its taskbar
 * icon from the exe resources electron-builder embeds, and macOS ignores BrowserWindow
 * icons entirely (the Dock icon comes from the bundle's icns). The PNG lives at
 * build/icon.png both in the source package (committed, rendered by
 * scripts/render-icon.mjs) and in the staged app directory (copied by scripts/stage.mjs),
 * so the same app-path-relative lookup serves dev and packaged runs.
 */
import fs from "node:fs";
import path from "node:path";

/** Window icon location relative to the app directory (dev package dir / staged app dir). */
export const WINDOW_ICON_RELPATH = ["build", "icon.png"];

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
