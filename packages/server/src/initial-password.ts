/**
 * The first-run sign-in notice.
 *
 * A fresh server seeds its admin with a random password that is generated, hashed, and
 * discarded — nobody ever sees it, and it is written nowhere. What the operator gets instead
 * is a one-time link carrying this boot's first-login token (auth/service.ts), printed inside
 * a hard-to-miss frame on every start until a password is actually set.
 *
 * Nothing has to be stored for that to be repeatable: the link is regenerated at every boot,
 * so an operator who scrolled past one just restarts.
 *
 * Published as `@prismshadow/penguin-server/initial-password` (side-effect-free, like ./lock)
 * so the CLI can print the same notice when it attaches to a live instance.
 */
import fs from "node:fs";
import path from "node:path";

export function initialAdminPasswordPath(root: string): string {
  return path.join(root, "initial-admin-password");
}

/**
 * Removes the plaintext a previous build stored here (idempotent, best-effort).
 *
 * Nothing writes this file any more; the sweep runs at every start so a root carried over
 * from an older build stops holding a password in the clear. Losing it costs that root
 * nothing: the account's password is unchanged, and a server still on its initial password
 * prints the first-login link instead.
 *
 * TODO(compat): this whole module goes away — the sweep, the path helper, and the export —
 * once no supported upgrade path can still carry an `initial-admin-password` file, i.e. once
 * the oldest release able to upgrade in place is one that never wrote it.
 */
export function clearInitialAdminPassword(root: string): void {
  try {
    fs.rmSync(initialAdminPasswordPath(root), { force: true });
  } catch {
    // Best-effort: a leftover file only re-prints a password that no longer works.
  }
}

/** Interior padding (spaces) between the frame bars and the text on each side. */
const NOTICE_PADDING = 3;

/**
 * The framed notice, ready for console.log. Plain ASCII (`+`/`-`/`|`) rather than
 * box-drawing characters: the server may run under terminals and log collectors with
 * non-UTF-8 code pages (legacy Windows consoles above all), and a misrendered frame would
 * bury exactly the line it exists to highlight. Width follows the longest line, so a long
 * origin widens the frame instead of breaking it.
 */
export function renderFirstLoginNotice(url: string): string {
  const lines = [
    "This server has no admin password yet. Open this link to claim it:",
    "",
    `  ${url}`,
    "",
    "The link lasts 30 days or until a password is set; restarting prints a fresh one.",
  ];
  const width = Math.max(...lines.map((line) => line.length));
  const bar = `+${"-".repeat(width + NOTICE_PADDING * 2)}+`;
  const pad = " ".repeat(NOTICE_PADDING);
  const body = lines.map((line) => `|${pad}${line.padEnd(width)}${pad}|`);
  return [bar, ...body, bar].join("\n");
}
