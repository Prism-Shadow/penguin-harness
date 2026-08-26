/**
 * Locating the installer that runs ON the remote machine (./remote-installer.cjs).
 *
 * It is a FILE, not a string in this module: the platform copies it and scp's it, and never
 * imports it, so it rides along the way node-pty's binaries do (deploy.mjs's assets →
 * hmr/host.ts's UpgradeAssets). One readable .cjs, no generated literal to keep in step.
 *
 * Where it is follows from what this server IS, so there is nothing to search: a hot-pushed
 * bundle has an assets directory (published with the very version this code came from, so the
 * two always agree) and the file is there; anything else is a packaged install and the file is
 * beside this module — src/machines/ from source, dist/ from a build, which is why the build
 * copies it there.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The name it keeps everywhere: the asset key, the copy in dist/, the source file. */
export const REMOTE_INSTALLER_FILE = "remote-installer.cjs";

/** The installer's text. `assets` is the hmr capability's assetsDir accessor (null when packaged). */
export function readRemoteInstaller(assets?: () => string | null): string {
  const dir = assets?.() ?? path.dirname(fileURLToPath(import.meta.url));
  return fs.readFileSync(path.join(dir, REMOTE_INSTALLER_FILE), "utf8");
}
