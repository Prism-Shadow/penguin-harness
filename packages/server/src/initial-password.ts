/**
 * Initial-admin-password persistence (`<root>/initial-admin-password`) and the startup
 * reminder notice.
 *
 * The seeded admin password used to be printed exactly once, at first seed; if that line
 * scrolled away unread, the credential was unrecoverable. The plaintext is now kept in
 * the data root FOR AS LONG AS the admin password remains the initial one, so every
 * server start — and `penguin web` attaching to an already-running instance — can
 * re-print it inside a hard-to-miss ASCII frame together with the change-it reminder.
 *
 * The file is removed the moment the admin's password is updated by any path (self
 * change, desktop set, or an admin reset picking a new value — the reset re-arms the
 * initial FLAG, but the file's content would be stale, and an admin-chosen password is
 * never persisted). Only the auto-generated / PENGUIN_SEED_ADMIN_PASSWORD seed value is
 * ever stored, with owner-only permissions; the SQLite db next to it already holds
 * strictly more sensitive data. Legacy roots seeded before this file existed simply have
 * no file: the reminder then stays silent (the plaintext is genuinely unrecoverable).
 *
 * Published as `@prismshadow/penguin-server/initial-password` (side-effect-free, like
 * ./lock) so the CLI can print the same notice when it attaches to a live instance.
 */
import fs from "node:fs";
import path from "node:path";

export function initialAdminPasswordPath(root: string): string {
  return path.join(root, "initial-admin-password");
}

/** Persists the seeded plaintext (owner-only file). Best-effort: the seed itself must not fail on an exotic filesystem — the reminder just degrades to first-start-only. */
export function storeInitialAdminPassword(root: string, password: string): void {
  try {
    fs.writeFileSync(initialAdminPasswordPath(root), `${password}\n`, { mode: 0o600 });
  } catch {
    // e.g. a read-only root: the password was still printed once by the seed path.
  }
}

/** The stored plaintext, or null when absent/unreadable/empty. */
export function readInitialAdminPassword(root: string): string | null {
  try {
    const value = fs.readFileSync(initialAdminPasswordPath(root), "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/** Removes the stored plaintext (idempotent, best-effort). */
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
 * The framed reminder block, ready for console.log. Plain ASCII (`+`/`-`/`|`) rather
 * than box-drawing characters: the server may run under terminals and log collectors
 * with non-UTF-8 code pages (legacy Windows consoles above all), and a misrendered frame
 * would bury exactly the line it exists to highlight. Width follows the longest line, so
 * a long pinned password widens the frame instead of breaking it.
 */
export function renderInitialPasswordNotice(userId: string, password: string): string {
  const lines = [
    `Web sign-in:  ${userId} / ${password}`,
    "",
    "This is the initial password and it has not been changed yet.",
    "Please sign in and change it soon (user menu -> Change password).",
  ];
  const width = Math.max(...lines.map((line) => line.length));
  const bar = `+${"-".repeat(width + NOTICE_PADDING * 2)}+`;
  const pad = " ".repeat(NOTICE_PADDING);
  const body = lines.map((line) => `|${pad}${line.padEnd(width)}${pad}|`);
  return [bar, ...body, bar].join("\n");
}
