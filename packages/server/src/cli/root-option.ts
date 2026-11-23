/**
 * The `--root` option's meaning, in one place.
 *
 * Every command that touches the data root offers it, and the priority is a documented part
 * of the CLI's contract (/docs/cli): the option wins, then PENGUIN_HOME, then the default
 * root. Two copies of that rule is two chances for one of them to drift.
 */
import path from "node:path";
import { ensureDataRootLayout, resolveRoot } from "@prismshadow/penguin-core";

/** Data root: `--root` first (relative paths against cwd), else PENGUIN_HOME / ~/.penguin/data. */
export function resolveRootOption(root: string | undefined): string {
  return root !== undefined ? path.resolve(root) : resolveRoot();
}

/**
 * The data root for a command that reads or writes a Project's files itself (`penguin config
 * model`, `penguin config vault`), resolved as above and brought to the current layout first:
 * a root still in the layout before `projects/` is migrated when no server holds it, and refused
 * while one does (core's state/layout-migration/, until 1.0). Without it, a new CLI run on an old
 * root would write a fresh Project folder under `projects/` beside the real one.
 */
export async function resolveProjectRoot(root: string | undefined): Promise<string> {
  const resolved = resolveRootOption(root);
  await ensureDataRootLayout(resolved);
  return resolved;
}
