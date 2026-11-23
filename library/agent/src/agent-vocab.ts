/**
 * Agent State file-name vocabulary the agent domain's export/zip/avatar paths share with the
 * server's workbench store: the single State file's name and the temp-suffix convention.
 */
/** The Agent State file inside each Agent's directory (workbenches/store reads it back). */
export const STATE_FILE = "state.json";
/** In-progress write suffix: a name carrying it is a temp copy, never listed. */
export const TMP_SUFFIX = ".penguin-tmp";

export const isTempName = (name: string): boolean => name.includes(TMP_SUFFIX);

/** A workbench folder's id: one plain segment a package may name a data folder with. */
export function isWorkbenchId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id) && id !== "." && id !== "..";
}

/** The characters HFS+ ignores in a name. */
const HFS_IGNORED = /[\u200C-\u200F\u202A-\u202E\u206A-\u206F\uFEFF]/g;

/**
 * A tree entry name git refuses, by isomorphic-git's own check (git's `verify_path`): one that
 * holds a path separator, that is `.` or `..` once the characters HFS+ ignores are dropped, or
 * that spells `.git` — any case, trailing dots or spaces (NTFS), an NTFS short name (`git~1`),
 * or before a `:` stream.
 */
export function isGitName(name: string): boolean {
  const visible = name.replace(HFS_IGNORED, "");
  const normalized = (visible.split(":")[0] ?? "").toLowerCase().replace(/[. ]+$/, "");
  return (
    name.includes("/") ||
    name.includes("\\") ||
    visible === "." ||
    visible === ".." ||
    normalized === ".git" ||
    /^\.?git~[1-9]$/.test(normalized)
  );
}

/** Vault file name inside a snapshot/import package (used for archive filtering). */
export const VAULT_BASENAME = ".vault.toml";

/**
 * An archive path's segments as extraction places them: separators unified, a drive prefix
 * (`C:`, which tar strips only after filtering) and `.` segments dropped.
 */
function segmentsOf(entryPath: string): string[] {
  return entryPath
    .replaceAll("\\", "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
}

/**
 * What a snapshot or an export leaves out and an import never takes from a package: any vault, in
 * any letter case, the server's staging leftovers (`*.penguin-tmp*`), and each workbench's
 * emitted code and installed packages. Paths are rooted at `agent_state/`.
 */
export function isLeftOut(entryPath: string): boolean {
  const segments = segmentsOf(entryPath);
  if (segments.at(-1)?.toLowerCase() === VAULT_BASENAME || segments.some(isTempName)) return true;
  const [top, child, ...rest] = segments;
  // Anywhere inside `agent_state/workbenches/<id>/`.
  return (
    top === "agent_state" &&
    child === "workbenches" &&
    rest.slice(1).some((s) => s === ".build" || s === "node_modules")
  );
}

/** An entry inside a git directory, under any spelling git itself treats as `.git`. */
export function isGitEntry(entryPath: string): boolean {
  return segmentsOf(entryPath).some(isGitName);
}
