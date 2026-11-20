/**
 * Putting a package into the plugin prefix, and taking it out, without npm (direct-install.ts),
 * to the same end state npm leaves: the package's files at `<prefix>/node_modules/<name>`, and
 * its entry in the prefix's package.json.
 *
 * - Files are written to `<prefix>/.staging/<uuid>/package` first and swapped in by rename: the
 *   installed directory is renamed aside (to `.staging/<uuid>/previous`), the new one renamed
 *   into its place, and only then is the old one removed — Windows can rename a directory it
 *   could not delete at once. When the second rename fails, the old directory is renamed back:
 *   the install is refused and the previous version stays. A directory that cannot be renamed
 *   at all (a program inside it is running, on Windows) refuses the install the same way.
 * - Leftovers — a crashed install's staging, an old version a held file kept from being
 *   removed — are swept before each write once they are an hour old.
 * - Writes to one prefix take turns within the process, so two admins' installs never
 *   interleave their swaps or their package.json edits.
 * - The package.json entry is written the way npm writes it: dependencies sorted by name, a
 *   two-space indent and a trailing newline. npm's hidden lockfile
 *   (`node_modules/.package-lock.json`, its cache of the tree it last wrote) is removed, so a
 *   later npm reads the tree from disk; `package-lock.json` is left to npm, which reconciles it
 *   against package.json on its next run.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ensurePrefix,
  installedPackageDir,
  PluginInstallError,
  pluginsPrefix,
  pruneArchives,
  STAGING_DIR,
} from "./install.js";
import type { TarballFile } from "./tarball.js";

/** How old a staging entry must be before the sweep takes it: past any install in flight. */
export const STAGING_SWEEP_AGE_MS = 60 * 60 * 1000;

/** A failure of an install made without npm, in its own words (the route does not call it npm's). */
export function refusal(
  message: string,
  reason: "unavailable" | "other" = "other",
): PluginInstallError {
  const error = new PluginInstallError(message);
  error.reason = reason;
  error.withoutNpm = true;
  return error;
}

/** The turn each prefix's next write waits for. */
const turns = new Map<string, Promise<unknown>>();

/** Runs `write` once every earlier write to the same prefix has settled. */
export function serialized<T>(prefix: string, write: () => Promise<T>): Promise<T> {
  const key = path.resolve(prefix);
  const previous = turns.get(key) ?? Promise.resolve();
  const next = previous.then(write, write);
  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  turns.set(key, settled);
  void settled.then(() => {
    if (turns.get(key) === settled) turns.delete(key);
  });
  return next;
}

/** Removes staging entries older than STAGING_SWEEP_AGE_MS; nothing here fails a write. */
async function sweep(prefix: string, now = Date.now()): Promise<void> {
  const staging = path.join(prefix, STAGING_DIR);
  let entries: string[];
  try {
    entries = await fs.readdir(staging);
  } catch {
    return;
  }
  for (const entry of entries) {
    const at = path.join(staging, entry);
    try {
      const { mtimeMs } = await fs.lstat(at);
      if (now - mtimeMs > STAGING_SWEEP_AGE_MS) {
        await fs.rm(at, { recursive: true, force: true });
      }
    } catch {
      // Still held, or already gone: the next sweep tries again.
    }
  }
}

/** Writes `files` under `dir` (relative POSIX paths, already checked by the reader that produced them). */
async function writeFiles(dir: string, files: ReadonlyMap<string, TarballFile>): Promise<void> {
  for (const [rel, file] of files) {
    const target = path.join(dir, ...rel.split("/"));
    if (!target.startsWith(dir + path.sep)) {
      throw refusal(`a file of the package leaves its directory: ${rel}`);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.data, { mode: file.executable ? 0o755 : 0o644 });
  }
}

/** Sets (or, with null, removes) `name` in the prefix's package.json dependencies, as npm writes it. */
async function recordDependency(prefix: string, name: string, spec: string | null): Promise<void> {
  const file = path.join(prefix, "package.json");
  const manifest = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
  const deps = { ...((manifest.dependencies as Record<string, string> | undefined) ?? {}) };
  if (spec === null) {
    if (!(name in deps)) return;
    delete deps[name];
  } else {
    deps[name] = spec;
  }
  manifest.dependencies = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b, "en")),
  );
  await fs.writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** npm's hidden lockfile goes: it describes the tree npm last wrote, which this one is not. */
async function dropHiddenLockfile(prefix: string): Promise<void> {
  await fs.rm(path.join(prefix, "node_modules", ".package-lock.json"), { force: true });
}

/** Whether something (a directory, a link) sits at `at`. */
async function exists(at: string): Promise<boolean> {
  return fs.lstat(at).then(
    () => true,
    () => false,
  );
}

/** Why a rename of an installed package failed, in words. */
function heldMessage(name: string, err: unknown): string {
  const code = (err as { code?: unknown }).code;
  const why = typeof code === "string" ? code : err instanceof Error ? err.message : String(err);
  return `the installed ${name} could not be moved (${why}): something may be using its files; stop it and try again`;
}

/**
 * Installs `files` as `name` in the prefix (see the header), recording `spec` for it in the
 * prefix's package.json. `beforeSwap` runs on the staged directory before anything installed
 * moves — a failure there leaves the prefix as it was.
 */
export async function placePackage(
  root: string,
  name: string,
  files: ReadonlyMap<string, TarballFile>,
  spec: string,
  beforeSwap?: (staged: string) => Promise<void>,
): Promise<void> {
  const prefix = pluginsPrefix(root);
  await serialized(prefix, async () => {
    // Inside the turn: two first installs must not both write the prefix's empty manifest,
    // the second after the first had recorded its package.
    await ensurePrefix(root);
    await sweep(prefix);
    const work = path.join(prefix, STAGING_DIR, randomUUID());
    const staged = path.join(work, "package");
    const aside = path.join(work, "previous");
    try {
      await fs.mkdir(staged, { recursive: true });
      await writeFiles(staged, files);
      await beforeSwap?.(staged);
      const target = installedPackageDir(prefix, name);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const replacing = await exists(target);
      if (replacing) {
        try {
          await fs.rename(target, aside);
        } catch (err) {
          throw refusal(heldMessage(name, err));
        }
      }
      try {
        await fs.rename(staged, target);
      } catch (err) {
        if (replacing) await fs.rename(aside, target).catch(() => undefined);
        throw refusal(
          `${name} could not be put in place (${err instanceof Error ? err.message : String(err)}); the installed version is unchanged`,
        );
      }
      await recordDependency(prefix, name, spec);
      await dropHiddenLockfile(prefix);
      await pruneArchives(prefix);
    } finally {
      // The old version and anything left of the staging; a held file stays for the sweep.
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/**
 * Takes `name` out of the prefix: its directory (renamed aside first, so a held file cannot
 * leave it half-deleted in place) and its package.json entry; tarballs nothing names any more
 * go too. A package that is not there is not an error, nor is a prefix never created.
 */
export async function removePackage(root: string, name: string): Promise<void> {
  const prefix = pluginsPrefix(root);
  if (!(await exists(path.join(prefix, "package.json")))) return;
  await serialized(prefix, async () => {
    await sweep(prefix);
    const target = installedPackageDir(prefix, name);
    if (await exists(target)) {
      const work = path.join(prefix, STAGING_DIR, randomUUID());
      await fs.mkdir(work, { recursive: true });
      try {
        await fs.rename(target, path.join(work, "previous"));
      } catch (err) {
        await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
        throw refusal(heldMessage(name, err));
      }
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
      // An emptied scope directory goes, as npm takes it.
      if (name.startsWith("@")) await fs.rmdir(path.dirname(target)).catch(() => undefined);
    }
    await recordDependency(prefix, name, null);
    await dropHiddenLockfile(prefix);
    await pruneArchives(prefix);
  });
}
