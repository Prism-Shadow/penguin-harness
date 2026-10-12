/**
 * Whether a one-time migration of a file in a data root may be written back to disk.
 *
 * A migration rewrites a file into the shape the code running it reads. A server older than
 * that code, still serving the same data root, reads the file next — and may not understand
 * the new shape: an installed release fails every Session once a newer CLI has renamed its
 * models' client types. So while such a server holds the root, the migrated table is used in
 * memory only and the file is left as it is; the migration runs again on the next read, and
 * is written back once no older server is in the way.
 *
 * "Older" compares release numbers only (`0.2.13+hmr.<hash>`, a hot-pushed build, is release
 * 0.2.13), and an equal release is not older. A lock without a version is older: servers
 * started recording one at the same time as this rule, so a live lock without one is a server
 * from before it.
 *
 * Removal of the missing-version branch: at the 0.3.0 release preparation, by whoever prepares
 * it, together with migrateLegacyClientTypes — once no server from before the version field can
 * still be running against a data root. The rule itself goes with the last one-time migration
 * that calls it; see changelog/unreleased/2026-10-12-backward-compatibility.md.
 */
import path from "node:path";
// Circular (index → state → project-config → here), like environment/mcp/provider.ts's:
// VERSION is read only inside functions, at call time, after every module has evaluated.
import { VERSION } from "../index.js";
import { compareVersions, normalizeVersion } from "../internal/version.js";
import { isServerLockAlive, readServerLock, type ServerLock } from "./server-lock.js";

/** The release part of a version string: no leading `v`, no pre-release, no build metadata. */
function releasePart(version: string): string {
  return normalizeVersion(version).split(/[-+]/, 1)[0]!;
}

/** Whether a server whose lock records `serverVersion` predates the code at `ownVersion`. */
function predates(serverVersion: string | undefined, ownVersion: string): boolean {
  // Compatibility: a lock without a version comes from a server older than this rule.
  if (serverVersion === undefined) return true;
  return compareVersions(releasePart(serverVersion), releasePart(ownVersion)) < 0;
}

/**
 * The live server holding `root` that predates this code, or null when there is none — no
 * lock, a stale one, a same-or-newer server, or this very process. The last case matters for
 * a server reading its own root: whatever its lock says, the code reading is this code (a
 * platform hot-pushed onto an older runtime carries a newer core than the runtime recorded).
 */
async function olderServerHolding(root: string): Promise<ServerLock | null> {
  const lock = readServerLock(root);
  if (lock === null || lock.pid === process.pid || !predates(lock.version, VERSION)) return null;
  return (await isServerLockAlive(lock)) ? lock : null;
}

/** Data roots already told about, so a CLI command that reads many Projects says it once. */
const reported = new Set<string>();

/**
 * Whether the migrated table of `file`, a file in `root`, may be written back. False while a
 * live server older than this code holds `root`; the first time per root, says which server
 * and why nothing was written (stderr).
 */
export async function mayWriteBackMigration(root: string, file: string): Promise<boolean> {
  const holder = await olderServerHolding(root);
  if (holder === null) return true;
  const key = path.resolve(root);
  if (!reported.has(key)) {
    reported.add(key);
    const version = holder.version === undefined ? "no version recorded" : `v${holder.version}`;
    console.warn(
      `[penguin] ${root} is served by an older PenguinHarness server (pid ${holder.pid}, port ` +
        `${holder.port}, ${version}) than this code (v${VERSION}), which may not read files ` +
        `migrated to the current shape. Files there that need a one-time migration, starting ` +
        `with ${file}, are migrated in memory only and written once that server has been ` +
        `upgraded or stopped.`,
    );
  }
  return false;
}
