/**
 * The `--root` option's meaning, in one place.
 *
 * Every command that touches the data root offers it, and the priority is a documented part
 * of the CLI's contract (/docs/cli): the option wins, then PENGUIN_HOME, then the default
 * root. Two copies of that rule is two chances for one of them to drift.
 */
import path from "node:path";
import { resolveRoot } from "@prismshadow/penguin-core";

/** Data root: `--root` first (relative paths against cwd), else PENGUIN_HOME / ~/.penguin/data. */
export function resolveRootOption(root: string | undefined): string {
  return root !== undefined ? path.resolve(root) : resolveRoot();
}
