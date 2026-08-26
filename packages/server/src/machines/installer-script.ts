/**
 * Locating the installer that runs ON the remote machine (./remote-installer.cjs).
 *
 * It is an ASSET, not a string in this module: the file travels with the pushed platform the
 * way node-pty's binaries do (deploy.mjs's native assets → hmr/host.ts's UpgradeAssets), and
 * is read from disk at push time. That keeps one copy of it — a real .cjs that lints, formats
 * and runs — instead of a generated escaped literal that no reviewer can read and a test has
 * to keep in step with its source.
 *
 * Two homes, because the server pushing it can be either shape:
 *   - packaged (tarball / desktop / a dev checkout): beside this module in the package;
 *   - hot-pushed bundle: a single .mjs in the hmr store with no siblings, so the file rides
 *     along as an asset and is found through the hmr capability's assetsDir().
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Asset-relative path, and the name it keeps in the package — the same on both sides. */
export const REMOTE_INSTALLER_ASSET = "machines/remote-installer.cjs";

/**
 * The installer's text. `assets` is the hmr capability's assetsDir accessor; a packaged
 * server has no assets dir and reads its own sibling instead.
 */
export function readRemoteInstaller(assets?: () => string | null): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = assets?.() ?? null;
  const candidates = [
    // Hot-pushed bundle: unpacked beside it by the runtime (hmr/host.ts's UpgradeAssets).
    ...(dir === null ? [] : [path.join(dir, ...REMOTE_INSTALLER_ASSET.split("/"))]),
    // Source tree (dev, vitest): this module's own sibling.
    path.join(here, "remote-installer.cjs"),
    // Built package: tsup collapses the modules into dist/, and the build copies the file to
    // the same relative path the asset uses (packages/server/scripts/copy-machine-assets.mjs).
    path.join(here, ...REMOTE_INSTALLER_ASSET.split("/")),
  ];

  for (const candidate of candidates) {
    try {
      return fs.readFileSync(candidate, "utf8");
    } catch {
      // Try the next shape.
    }
  }
  throw new Error(`the remote installer was not found (looked in: ${candidates.join(", ")})`);
}
