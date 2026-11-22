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
 * - On Windows a rename answered EPERM, EACCES or EBUSY is tried again, backing off, for up to
 *   a minute — an antivirus scanner or an indexer briefly holds files just written, which is
 *   why npm's own file system layer (graceful-fs) does the same.
 * - When the old directory cannot be moved back either, nothing deletes it: its staging entry
 *   is marked kept, the sweep leaves it, and the refusal says where it is.
 * - Leftovers — a crashed install's staging, an old version a held file kept from being
 *   removed — are swept before each write once they are an hour old.
 * - Writes to one prefix take turns within the process, so two admins' installs never
 *   interleave their swaps or their package.json edits.
 * - The prefix's package.json is read before anything moves (one that will not parse refuses
 *   the install), and written the way npm writes it: dependencies sorted by name, a two-space
 *   indent and a trailing newline. npm's hidden lockfile (`node_modules/.package-lock.json`,
 *   its cache of the tree it last wrote) is removed, so a later npm reads the tree from disk;
 *   `package-lock.json` is left to npm, which reconciles it against package.json on its next run.
 * - Whatever the file system answers along the way (no space left, a name or a path it will not
 *   take) is a refusal in words, never a raw error.
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
/** How long a busy rename is tried again (graceful-fs's window). */
export const RENAME_RETRY_MS = 60_000;
/** The file that marks a staging entry holding the only copy of an installed version. */
export const KEPT_MARKER = "KEPT.txt";

/** A failure of an install made without npm, in its own words (the route does not call it npm's). */
export function refusal(
  message: string,
  reason: "unavailable" | "unreachable" | "other" = "other",
): PluginInstallError {
  const error = new PluginInstallError(message);
  error.reason = reason;
  error.withoutNpm = true;
  return error;
}

/** The file system moves the swap makes, and the clock it retries by; a test stands in. */
export interface PrefixOps {
  rename(from: string, to: string): Promise<void>;
  /** Whether a rename answered EPERM, EACCES or EBUSY is tried again (Windows). */
  retryBusy: boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
}

const SYSTEM_OPS: PrefixOps = {
  rename: (from, to) => fs.rename(from, to),
  retryBusy: process.platform === "win32",
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

const codeOf = (err: unknown): string | undefined => (err as NodeJS.ErrnoException | null)?.code;

/** What a file system error said, without the staging path it names. */
const said = (err: unknown): string => {
  const code = codeOf(err);
  const message = err instanceof Error ? err.message : String(err);
  return code !== undefined ? `${code}: ${message.replace(/^[A-Z]+:\s*/, "")}` : message;
};

/** A rename, tried again while Windows answers that something holds the file (see the header). */
async function renameEventually(from: string, to: string, ops: PrefixOps): Promise<void> {
  const deadline = ops.now() + RENAME_RETRY_MS;
  let wait = 10;
  for (;;) {
    try {
      await ops.rename(from, to);
      return;
    } catch (err) {
      const code = codeOf(err);
      const busy = code === "EPERM" || code === "EACCES" || code === "EBUSY";
      if (!ops.retryBusy || !busy || ops.now() >= deadline) throw err;
      await ops.sleep(wait);
      wait = Math.min(wait * 2, 1000);
    }
  }
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

/** Removes staging entries older than STAGING_SWEEP_AGE_MS, never a kept one; nothing here fails a write. */
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
      if (await exists(path.join(at, KEPT_MARKER))) continue;
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

/** The prefix's package.json, read before anything moves; refused when it will not parse. */
async function readManifest(prefix: string): Promise<Record<string, unknown>> {
  const file = path.join(prefix, "package.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    throw refusal(
      `the plugin prefix's package.json (${file}) could not be read (${said(err)}); fix it or move it aside, then try again`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw refusal(
      `the plugin prefix's package.json (${file}) is not an object; fix it or move it aside, then try again`,
    );
  }
  return parsed as Record<string, unknown>;
}

/** Writes `manifest` back with `name` set to `spec` (or, with null, removed), as npm writes it. */
async function recordDependency(
  prefix: string,
  manifest: Record<string, unknown>,
  name: string,
  spec: string | null,
): Promise<void> {
  const deps = { ...((manifest.dependencies as Record<string, string> | undefined) ?? {}) };
  if (spec === null) {
    if (!(name in deps)) return;
    delete deps[name];
  } else {
    deps[name] = spec;
  }
  const next = {
    ...manifest,
    dependencies: Object.fromEntries(
      Object.entries(deps).sort(([a], [b]) => a.localeCompare(b, "en")),
    ),
  };
  await fs.writeFile(path.join(prefix, "package.json"), `${JSON.stringify(next, null, 2)}\n`);
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
  return `the installed ${name} could not be moved (${said(err)}): something may be using its files; stop it and try again`;
}

/** Runs one write of the prefix; a file system failure becomes a refusal naming `what`. */
async function inWords<T>(what: string, write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (err instanceof PluginInstallError) throw err;
    throw refusal(`${what} (${said(err)})`);
  }
}

/**
 * Installs `files` as `name` in the prefix (see the header), recording `spec` for it in the
 * prefix's package.json. `beforeSwap` runs on the staged directory before anything installed
 * moves — a failure there leaves the prefix as it was. `ops` stands in for the renames and
 * their retry clock in a test.
 */
export async function placePackage(
  root: string,
  name: string,
  files: ReadonlyMap<string, TarballFile>,
  spec: string,
  {
    beforeSwap,
    ops = SYSTEM_OPS,
  }: { beforeSwap?: (staged: string) => Promise<void>; ops?: PrefixOps } = {},
): Promise<void> {
  const prefix = pluginsPrefix(root);
  await serialized(prefix, async () => {
    const work = path.join(prefix, STAGING_DIR, randomUUID());
    const staged = path.join(work, "package");
    const aside = path.join(work, "previous");
    let kept = false;
    try {
      // Inside the turn: two first installs must not both write the prefix's empty manifest,
      // the second after the first had recorded its package.
      await inWords(`the plugin prefix ${prefix} could not be prepared`, () => ensurePrefix(root));
      const manifest = await readManifest(prefix);
      await sweep(prefix);
      await inWords(`${name} could not be written into the plugin prefix`, async () => {
        await fs.mkdir(staged, { recursive: true });
        await writeFiles(staged, files);
        await beforeSwap?.(staged);
      });
      const target = installedPackageDir(prefix, name);
      const replacing = await inWords(`${name} could not be put in place`, async () => {
        await fs.mkdir(path.dirname(target), { recursive: true });
        return exists(target);
      });
      if (replacing) {
        try {
          await renameEventually(target, aside, ops);
        } catch (err) {
          throw refusal(heldMessage(name, err));
        }
      }
      try {
        await renameEventually(staged, target, ops);
      } catch (err) {
        if (!replacing) {
          throw refusal(`${name} could not be put in place (${said(err)}); nothing was installed`);
        }
        try {
          await renameEventually(aside, target, ops);
        } catch (restoreErr) {
          // The work folder holds the only copy of the installed version now: it is not
          // deleted below, and the sweep leaves it.
          kept = true;
          await fs
            .writeFile(
              path.join(work, KEPT_MARKER),
              `${name}'s installed version, moved here to make room for an install that failed; move ${aside} back to ${target}.\n`,
            )
            .catch(() => undefined);
          throw refusal(
            `${name} could not be put in place (${said(err)}), and the installed version could not be moved back (${said(restoreErr)}): it is kept at ${aside}. Move it back to ${target}, or install ${name} again.`,
          );
        }
        throw refusal(
          `${name} could not be put in place (${said(err)}); the installed version is unchanged`,
        );
      }
      await inWords(
        `${name} was put in place, but the plugin prefix's package.json could not be updated`,
        async () => {
          await recordDependency(prefix, manifest, name, spec);
          await dropHiddenLockfile(prefix);
          await pruneArchives(prefix);
        },
      );
    } finally {
      // The old version and anything left of the staging; a held file stays for the sweep, and
      // a kept old version stays until someone moves it back.
      if (!kept) await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  });
}

/**
 * Takes `name` out of the prefix: its directory (renamed aside first, so a held file cannot
 * leave it half-deleted in place) and its package.json entry; tarballs nothing names any more
 * go too. A package that is not there is not an error, nor is a prefix never created.
 */
export async function removePackage(
  root: string,
  name: string,
  ops: PrefixOps = SYSTEM_OPS,
): Promise<void> {
  const prefix = pluginsPrefix(root);
  if (!(await exists(path.join(prefix, "package.json")))) return;
  await serialized(prefix, async () => {
    const manifest = await readManifest(prefix);
    await sweep(prefix);
    const target = installedPackageDir(prefix, name);
    if (await exists(target)) {
      const work = path.join(prefix, STAGING_DIR, randomUUID());
      await inWords(`${name} could not be removed`, () => fs.mkdir(work, { recursive: true }));
      try {
        await renameEventually(target, path.join(work, "previous"), ops);
      } catch (err) {
        await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
        throw refusal(heldMessage(name, err));
      }
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
      // An emptied scope directory goes, as npm takes it.
      if (name.startsWith("@")) await fs.rmdir(path.dirname(target)).catch(() => undefined);
    }
    await inWords(
      `${name} was removed, but the plugin prefix's package.json could not be updated`,
      async () => {
        await recordDependency(prefix, manifest, name, null);
        await dropHiddenLockfile(prefix);
        await pruneArchives(prefix);
      },
    );
  });
}
