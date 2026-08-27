/** The framed first-run notice carrying the first-login link (minted in auth/service.ts). */
import fs from "node:fs";
import path from "node:path";

export function initialAdminPasswordPath(root: string): string {
  return path.join(root, "initial-admin-password");
}

/**
 * Removes the plaintext an older build stored here; nothing writes it any more.
 *
 * TODO(compat): goes once no supported upgrade path can carry an `initial-admin-password`.
 */
export function clearInitialAdminPassword(root: string): void {
  try {
    fs.rmSync(initialAdminPasswordPath(root), { force: true });
  } catch {
    // Best-effort: a leftover file only re-prints a password that no longer works.
  }
}

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
