/**
 * Locating the installer that runs ON the remote machine (./remote-installer.cjs).
 *
 * It is a FILE, not a string in this module: the platform copies it and scp's it, and never
 * imports it, so it rides along the way node-pty's binaries do (deploy.mjs's assets →
 * hmr/host.ts's UpgradeAssets). One readable .cjs, no generated literal to keep in step.
 *
 * Two places it can be, because the pushing server is one of two shapes: a hot-pushed bundle
 * (a lone .mjs in the hmr store, so the file arrives as an asset) or a packaged install
 * (tarball, desktop, dev checkout — the file sits beside this module, in src/machines/ from
 * source and in dist/ from a build, which is why the build copies it there).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The name it keeps everywhere: the asset key, the copy in dist/, the source file. */
export const REMOTE_INSTALLER_FILE = "remote-installer.cjs";

/** The installer's text. `assets` is the hmr capability's assetsDir accessor (null when packaged). */
export function readRemoteInstaller(assets?: () => string | null): string {
  const dirs = [assets?.(), path.dirname(fileURLToPath(import.meta.url))];
  const tried: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, REMOTE_INSTALLER_FILE);
    tried.push(candidate);
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
  }
  throw new Error(`the remote installer was not found (looked in: ${tried.join(", ")})`);
}
