/**
 * Where a file cited in an organization's messages lives, when it is the organization's to show.
 *
 * Employees cite files by full path — `<app_data_dir>/organizations/<orgId>/workspace/…`, or the
 * real spelling of the same place — and a reader opens the citation from a channel or a desk
 * conversation. A citation is text an employee wrote, so it is parsed here, at the boundary:
 *
 * - **Spelling.** `<app_data_dir>` is the Project directory (the Environment's App Data Dir), `~`
 *   the server account's home; anything else must be absolute. `\` and `/` both separate.
 * - **Where.** The file's real path (symlinks resolved) must lie inside one of the organization's
 *   roots: its handbook, its shared workspace, and each employee's workspace as the chart resolves
 *   it — which a person may have pointed at any existing directory. Anything else is refused.
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

function lastSegment(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? "";
}

function refuseSecret(p: string, cited: string): void {
  if (SECRET_NAMES.has(lastSegment(p))) {
    throw new HttpError(403, "org_file_refused", `${cited} cannot be opened from here.`);
  }
}

/** The absolute path a citation names, or null when it names none. */
export function citedAbsolute(cited: string, appDataDir: string, home: string): string | null {
  const spelled = cited.replace(PLACEHOLDER, appDataDir).replace(HOME, home);
  if (!path.isAbsolute(spelled)) return null;
  return path.resolve(spelled.replace(/[/\\]/g, path.sep));
}

async function realpathOrNull(p: string): Promise<string | null> {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
}

/**
 * Locates `cited` inside one of `roots`.
 *
 * @throws 400 org_file_invalid: not a path.
 * @throws 403 org_file_refused: a secret, or outside every root.
 * @throws 404 org_file_not_found: nothing there, or a directory.
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
  const real = await realpathOrNull(absolute);
  const stat = real === null ? null : await fs.stat(real).catch(() => null);
  if (real === null || stat === null || !stat.isFile()) {
    throw new HttpError(404, "org_file_not_found", `${cited} is not a file.`);
  }
  refuseSecret(real, cited);
  for (const root of opts.roots) {
    const realRoot = await realpathOrNull(root);
    if (realRoot === null) continue;
    const rel = path.relative(realRoot, real);
    const outside = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
    if (rel !== "" && !outside) {
      return { workspace: realRoot, path: rel.split(path.sep).join("/") };
    }
  }
  throw new HttpError(
    403,
    "org_file_refused",
    `${cited} is not in the organization's handbook or workspaces.`,
  );
}
