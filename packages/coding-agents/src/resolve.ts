/**
 * Filesystem command resolution: find an executable on PATH without spawning a shell.
 * A server process (a GUI-launched Electron app, a Windows service, an npm-shim-only
 * install) often has CLIs that `spawn` cannot find by bare name, so both discovery and
 * the manager resolve through here first. Pure `node:fs` — the same reason no `which`:
 * every spawn is gated and slow under privilege managers, and existence checks need none.
 */
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

function pathDirs(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? "").split(path.delimiter).filter((dir) => dir.trim() !== "");
}

/**
 * Candidate extensions for a bare command name. On Windows the extensions come before
 * anything else on purpose: npm leaves an extensionless POSIX shim (`gemini`, `npx`)
 * beside the real `gemini.cmd`, and the bare file exists but cannot be spawned by
 * Windows — trying it first would resolve discovery to the wrong twin. The exact name
 * is only a fallback for commands that spell a dot themselves (`tool.cmd`); a bare
 * name's extensionless match is skipped entirely, even when it is all a PATH dir has
 * (fnm's multishell dirs hold only the shim).
 */
function candidateExtensions(env: NodeJS.ProcessEnv, command: string): string[] {
  if (process.platform !== "win32") return [""];
  const exts = (env.PATHEXT ?? "")
    .split(";")
    .map((e) => e.trim())
    .filter((e) => e !== "")
    .map((e) => (e.startsWith(".") ? e : `.${e}`));
  return [...(exts.length > 0 ? exts : DEFAULT_PATHEXT), ...(command.includes(".") ? [""] : [])];
}

async function isExecutable(file: string): Promise<boolean> {
  const stat = await fs.stat(file).catch(() => undefined);
  if (stat === undefined || !stat.isFile()) return false;
  if (process.platform === "win32") return true;
  return (stat.mode & 0o111) !== 0;
}

/**
 * Directory listings shared across lookups, keyed by dir: names lowercased, `null` for a dir
 * that cannot be listed. Pass one map to every `resolveCommandPath` of a single scan and each
 * dir is read once, instead of one `stat` per dir × extension × command — tens of thousands
 * on a long Windows PATH, nearly all misses.
 *
 * Lowercased on every platform, not only Windows: whether a volume ignores case is a property
 * of the volume, and macOS's default one does, so a stat of `claude` finds `Claude` there. A
 * listing therefore only rules out a name it lacks in every case, and the stat decides the
 * rest — a case-sensitive volume still refuses `claude` for `Claude`, as it did before.
 */
export type DirListings = Map<string, Promise<Set<string> | null>>;

function listingKey(name: string): string {
  return name.toLowerCase();
}

function listDir(listings: DirListings, dir: string): Promise<Set<string> | null> {
  let listing = listings.get(dir);
  if (listing === undefined) {
    listing = fs.readdir(dir).then(
      (names) => new Set(names.map(listingKey)),
      () => null,
    );
    listings.set(dir, listing);
  }
  return listing;
}

async function firstMatch(
  dirs: string[],
  basename: string,
  listings: DirListings | undefined,
): Promise<string | undefined> {
  for (const dir of dirs) {
    // A listing only rules a name out; a name it holds is still stat'ed (a dir, a
    // non-executable). An unlistable dir falls back to the stat alone.
    const listing = listings === undefined ? null : await listDir(listings, dir);
    if (listing !== null && !listing.has(listingKey(basename))) continue;
    const file = path.join(dir, basename);
    if (await isExecutable(file)) return file;
  }
  return undefined;
}

/**
 * Resolve a command to an absolute path by walking PATH (plus `extraDirs`, discovery's
 * version-manager install homes). A command carrying a directory separator is returned
 * unchanged — an explicit path means the caller (or the eventual spawn error) already
 * knows best, and the cwd is deliberately never searched. `listings` (see `DirListings`)
 * lets a batch of lookups share directory reads.
 */
export async function resolveCommandPath(
  command: string,
  options: { env?: NodeJS.ProcessEnv; extraDirs?: string[]; listings?: DirListings } = {},
): Promise<string> {
  const env = options.env ?? process.env;
  if (command.includes("/") || command.includes("\\")) return command;
  const dirs = [...pathDirs(env), ...(options.extraDirs ?? [])];
  for (const ext of candidateExtensions(env, command)) {
    const found = await firstMatch(dirs, `${command}${ext}`, options.listings);
    if (found !== undefined) return found;
  }
  return command;
}
