/**
 * A plugin's PACKAGE: which directory an installed plugin's files come from, and the version
 * of the files it ships under `ui/`.
 *
 * The package is found from an entry file — the nearest `package.json` above it — because a
 * plugin's module may have been resolved by bare name (the installation did it) or as a path
 * (a dev checkout); both name the same package here. Its `name` is what the server's
 * `/api/plugins/<package>/ui/*` route answers to, so a document can write its own frame's src
 * without knowing how the plugin was installed.
 *
 * The UI stamp is what makes those files cacheable: a document served under `?v=<stamp>` may
 * be cached forever by the browser, because any edit to anything under `ui/` moves the stamp
 * and therefore the URL. Without it, a plugin document and the hundreds of files a figure
 * pack loads beside it are re-downloaded on every open — the whole set has no validator at
 * all, so `no-cache` alone buys nothing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Where a plugin's shipped UI lives inside its package. */
export const PLUGIN_UI_DIR = "ui";

/** A package found from one of its entry files. */
export interface PluginPackage {
  /** The package's directory — the one holding its `package.json`. */
  dir: string;
  /** Its manifest's `name`: what the ui route answers to. */
  name: string;
}

/**
 * The package above an entry file — its directory and its manifest's name — or null when no
 * readable `package.json` with a string `name` sits above it.
 */
export function packageOf(file: string): PluginPackage | null {
  let dir = path.dirname(file);
  for (;;) {
    try {
      const { name } = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name?: unknown;
      };
      return typeof name === "string" ? { dir, name } : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") return null;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The loaded package called `name`, or null: the first entry whose package matches wins. */
export function packageNamed(
  entries: Iterable<string | null | undefined>,
  name: string,
): PluginPackage | null {
  for (const file of entries) {
    if (file == null) continue;
    const found = packageOf(file);
    if (found?.name === name) return found;
  }
  return null;
}

/** How long a stamp is reused: a document's asset burst walks its tree once, not once per file. */
const STAMP_TTL_MS = 2_000;

const stamps = new Map<string, { at: number; stamp: string }>();

/**
 * What version the `ui/` tree of a package is at: its file count, its total size and its
 * newest modification time, in one short string. Any add, remove, resize or edit moves it.
 *
 * Reads the real directory (a plugin installed by symlink is edited where it really lives),
 * and answers `0-0-0` for a package without a `ui/` — the route that needs a stamp 404s on
 * every file of such a package anyway.
 */
export function uiStampOf(packageDir: string): string {
  const now = Date.now();
  const hit = stamps.get(packageDir);
  if (hit !== undefined && now - hit.at < STAMP_TTL_MS) return hit.stamp;
  const stamp = walkUi(path.join(packageDir, PLUGIN_UI_DIR));
  stamps.set(packageDir, { at: now, stamp });
  return stamp;
}

function walkUi(dir: string): string {
  let files: string[];
  try {
    files = readdirSync(dir, { recursive: true }) as string[];
  } catch {
    return "0-0-0";
  }
  let count = 0;
  let bytes = 0;
  let newest = 0;
  for (const rel of files) {
    let size: number;
    let mtimeMs: number;
    try {
      const stat = statSync(path.join(dir, rel));
      if (!stat.isFile()) continue;
      size = stat.size;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue;
    }
    count += 1;
    bytes += size;
    newest = Math.max(newest, mtimeMs);
  }
  return `${count}-${bytes.toString(36)}-${Math.round(newest).toString(36)}`;
}
