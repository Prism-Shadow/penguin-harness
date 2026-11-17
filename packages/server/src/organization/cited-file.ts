/**
 * Where a file cited in an organization's messages lives, when it is the organization's to show.
 *
 * Employees cite files by full path — `<app_data_dir>/organizations/<orgId>/workspace/…`, or the
 * real spelling of the same place — and a reader opens the citation from a channel or a desk
 * conversation. A citation is text an employee wrote, so it is parsed here, at the boundary:
 *
 * - **Spelling.** `<app_data_dir>` is the Project directory (the Environment's App Data Dir), `~`
 *   the server account's home; anything else must be absolute. `\` and `/` both separate.
 * - **Where.** The path must lie inside one of the organization's roots: its handbook, its shared
 *   workspace, and each employee's workspace as the chart resolves it — which a person may have
 *   pointed at any existing directory. That is checked on the path as written before anything is
 *   read from disk, so a path outside every root is refused the same way whether or not it exists.
 *   It is checked again on the real path (symlinks resolved), so a link cannot lead out.
 * - **Secrets.** A Project config or an Agent vault is refused by name wherever it lies, written
 *   or resolved: a workspace pointed at a wide directory would otherwise hold one.
 *
 * The answer is the root and the path under it, which the workspace file handlers serve with their
 * own confinement and the same hardening a Files panel read gets.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HttpError } from "../http/errors.js";

/** A cited file, as the root it was found under and its `/`-separated path below that root. */
export interface CitedFileLocation {
  workspace: string;
  path: string;
}

const SECRET_NAMES = new Set([".project_config.toml", ".vault.toml"]);

const PLACEHOLDER = /^<app_data_dir>(?=[/\\])/;
const HOME = /^~(?=[/\\])/;

function refused(cited: string, why: string): HttpError {
  return new HttpError(403, "org_file_refused", `${cited} ${why}`);
}

function refuseSecret(p: string, cited: string): void {
  if (SECRET_NAMES.has(path.basename(p))) throw refused(cited, "cannot be opened from here.");
}

/** The absolute path a citation names, or null when it names none. */
export function citedAbsolute(cited: string, appDataDir: string, home: string): string | null {
  const spelled = cited.replace(PLACEHOLDER, appDataDir).replace(HOME, home);
  if (!path.isAbsolute(spelled)) return null;
  return path.resolve(spelled.replace(/[/\\]/g, path.sep));
}

/** `p` below `root`, `/`-separated, or null when `p` is `root` itself or lies outside it. */
function below(root: string, p: string): string | null {
  const rel = path.relative(root, p);
  if (rel === "" || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep).join("/");
}

/**
 * Locates `cited` inside one of `roots`.
 *
 * @throws 400 org_file_invalid: not a path.
 * @throws 403 org_file_refused: a secret, or outside every root — decided before the path is
 *   looked up when the path as written is outside.
 * @throws 404 org_file_not_found: inside a root, and nothing there or a directory.
 */
export async function locateCitedFile(
  cited: string,
  opts: { appDataDir: string; home: string; roots: readonly string[] },
): Promise<CitedFileLocation> {
  const absolute = citedAbsolute(cited, opts.appDataDir, opts.home);
  if (absolute === null) {
    throw new HttpError(
      400,
      "org_file_invalid",
      "path must be an absolute or <app_data_dir> path.",
    );
  }
  refuseSecret(absolute, cited);
  // A root is the organization's, not the caller's, so resolving it reveals nothing. Both its
  // spellings count: a citation may use either (`/var/…` and `/private/var/…` on macOS).
  const roots = (
    await Promise.all(
      opts.roots.map(async (root) => {
        const real = await fs.realpath(root).catch(() => null);
        return real === null ? null : { written: path.resolve(root), real };
      }),
    )
  ).filter((root) => root !== null);
  const outside = refused(cited, "is not in the organization's handbook or workspaces.");
  if (!roots.some((root) => below(root.written, absolute) ?? below(root.real, absolute))) {
    throw outside;
  }
  const real = await fs.realpath(absolute).catch(() => null);
  const stat = real === null ? null : await fs.stat(real).catch(() => null);
  if (real === null || stat === null || !stat.isFile()) {
    throw new HttpError(404, "org_file_not_found", `${cited} is not a file.`);
  }
  refuseSecret(real, cited);
  for (const root of roots) {
    const rel = below(root.real, real);
    if (rel !== null) return { workspace: root.real, path: rel };
  }
  throw outside;
}
