/**
 * Local API token (`<root>/api-token`): the boot's admin credential on disk.
 *
 * Minted fresh at every server boot (same recipe as auth-session tokens) and held on the
 * runtime auth state (auth/runtime-state.ts), so it outlives the Apps a push replaces and dies
 * at a restart. It does two jobs:
 *
 * - It is written to the data root with owner-only permissions and accepted as
 *   `Authorization: Bearer` for the built-in admin. Local filesystem access to the data root
 *   already IS admin authority — the rule `penguin server reset-admin-password` stands on —
 *   and the CLI outside a Session, scripts doing `$(cat <root>/api-token)` and existing
 *   automation still depend on it.
 * - It signs the session credentials a server-driven Session's tool subprocesses get as
 *   PENGUIN_API_TOKEN (session-token.ts). The boot token itself is never handed to a Session.
 *
 * Every App writes the file when it starts (AuthService.setup), not only the boot: a root whose
 * file was removed — by an earlier build that deleted it, or by hand — gets it back from the
 * next hot push instead of waiting for a restart.
 *
 * The file is to be removed once sign-ins and session credentials have taken over all of its
 * uses (the CLI, scripts, deploy automation) and the server sees no caller presenting it.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function apiTokenPath(root: string): string {
  return path.join(root, "api-token");
}

/** Mints a boot-scoped local API token (the auth-session token recipe). */
export function mintApiToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Persists the boot token (owner-only file, tmp + rename so a concurrent reader never sees a
 * partial write). Idempotent: a file already holding this token, owner-only, is left alone, so
 * every App start may call it. Best-effort like the initial-password file: an exotic read-only
 * root must not stop the server — local CLI callers then fall back to a stored sign-in or
 * PENGUIN_API_TOKEN.
 */
export function storeApiToken(root: string, token: string): void {
  try {
    const target = apiTokenPath(root);
    if (readApiToken(root) === token && ownerOnly(target)) return;
    fs.mkdirSync(root, { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    // Best-effort: Bearer auth still works for callers holding a credential some other way.
  }
}

function ownerOnly(file: string): boolean {
  return process.platform === "win32" || (fs.statSync(file).mode & 0o077) === 0;
}

/** The stored token, or null when absent/unreadable/empty. */
export function readApiToken(root: string): string | null {
  try {
    const value = fs.readFileSync(apiTokenPath(root), "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/**
 * Constant-time equality for token checks: both sides are reduced to fixed-size sha256
 * digests first, so the comparison's timing depends on neither the content nor the
 * length of an attacker-supplied value.
 */
export function tokensEqual(a: string, b: string): boolean {
  const digest = (v: string): Buffer => createHash("sha256").update(v).digest();
  return timingSafeEqual(digest(a), digest(b));
}
