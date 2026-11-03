/**
 * macOS only: repair node-pty's `spawn-helper` file mode.
 *
 * On darwin node-pty does not exec the shell directly — it spawns a small `spawn-helper`
 * binary that hands the child its controlling terminal. node-pty's npm tarball ships the
 * prebuilt helper with mode 0644 (no exec bit), and its install script skips the source
 * build whenever a `prebuilds/<platform>-<arch>` directory exists. The addon itself still
 * loads (a dylib needs no exec bit), so everything looks healthy right up to the point
 * where `posix_spawnp` refuses the helper and every terminal fails to start with a bare
 * "posix_spawnp failed." — which is how the terminal panel came to open blank on macOS
 * with nothing in any log.
 *
 * The repair is a chmod, done once per process before the first pty is created. Where it
 * cannot be done (a signed .app under /Applications is not writable by the running user),
 * `spawnHelperHint()` turns the residual spawn failure into a message that names the file
 * and what is wrong with it — and the desktop packaging step fixes the mode in the staged
 * tree so a shipped app never gets there.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/** Exec bits for user/group/other. */
const EXEC_BITS = 0o111;

/**
 * Adds the exec bit to every `spawn-helper` under `pkgDir` that lacks it, following
 * node-pty's own native-module search order (build/Release, build/Debug, then the
 * platform prebuild). Returns the paths it changed. Exported for tests: the logic is
 * plain filesystem work, so it is verifiable on any platform.
 */
export function repairSpawnHelpers(pkgDir: string, arch: string = process.arch): string[] {
  const candidates = [
    path.join(pkgDir, "build", "Release", "spawn-helper"),
    path.join(pkgDir, "build", "Debug", "spawn-helper"),
    path.join(pkgDir, "prebuilds", `darwin-${arch}`, "spawn-helper"),
  ];
  const repaired: string[] = [];
  for (const helper of candidates) {
    let mode: number;
    try {
      mode = fs.statSync(helper).mode;
    } catch {
      continue; // node-pty did not ship/build this variant
    }
    if ((mode & EXEC_BITS) !== 0) continue;
    try {
      fs.chmodSync(helper, mode | EXEC_BITS);
      repaired.push(helper);
    } catch {
      // Read-only install: spawnHelperHint() reports it when the spawn then fails.
    }
  }
  return repaired;
}

/** node-pty's package directory, or null when it cannot be resolved from here. */
function nodePtyDir(): string | null {
  try {
    return path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
  } catch {
    return null;
  }
}

/** The package directories already repaired in this process. */
const repaired = new Set<string>();

/**
 * Idempotent, darwin-only: run the repair once per copy of node-pty, before its first pty
 * spawn. `pkgDir` is the copy actually loaded (pty-module.ts's loadedNodePtyDir) — on a
 * machine running a pushed platform that is the installed program's, whose helper the
 * release ships as 0644 too — and this module's own resolution when it is not given.
 */
export function ensureSpawnHelperExecutable(pkgDir: string | null = nodePtyDir()): void {
  if (process.platform !== "darwin" || pkgDir === null || repaired.has(pkgDir)) return;
  repaired.add(pkgDir);
  for (const fixed of repairSpawnHelpers(pkgDir)) {
    console.log(`[terminal] restored the exec bit on ${fixed} (node-pty ships it as 0644)`);
  }
}

/**
 * A one-line explanation to append to a spawn failure, when a helper is present but still
 * not executable — the case the repair could not fix. Null when that is not the problem,
 * so an unrelated failure is never mislabelled. `pkgDir` as for the repair.
 */
export function spawnHelperHint(pkgDir: string | null = nodePtyDir()): string | null {
  if (process.platform !== "darwin") return null;
  if (pkgDir === null) return null;
  for (const helper of [
    path.join(pkgDir, "build", "Release", "spawn-helper"),
    path.join(pkgDir, "prebuilds", `darwin-${process.arch}`, "spawn-helper"),
  ]) {
    try {
      if ((fs.statSync(helper).mode & EXEC_BITS) === 0) {
        return `${helper} is not executable — run: chmod +x "${helper}"`;
      }
    } catch {
      continue;
    }
  }
  return null;
}
