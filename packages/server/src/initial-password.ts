/**
 * The framed first-run notice carrying the first-login link (minted in auth/service.ts).
 * Exported as `@prismshadow/penguin-server/initial-password` so the CLI can print the same one.
 */
import fs from "node:fs";
import path from "node:path";

export function initialAdminPasswordPath(root: string): string {
  return path.join(root, "initial-admin-password");
}

/**
 * Removes the plaintext an older build stored here (idempotent, best-effort); nothing writes
 * it any more, and losing it costs a root nothing.
 *
 * TODO(compat): this sweep and the path helper go once no supported upgrade path can still
 * carry an `initial-admin-password` file.
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
 * Plain ASCII rather than box-drawing characters: a non-UTF-8 console (legacy Windows above
 * all) would mangle the frame around exactly the line it exists to highlight.
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
