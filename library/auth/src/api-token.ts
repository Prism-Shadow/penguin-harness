/**
 * Local API token (`<root>/api-token`): the machine-local credential behind
 * `Authorization: Bearer`.
 *
 * Minted fresh at every server boot (same recipe as auth-session tokens) and written to
 * the data root with owner-only permissions, so anything that can read the file can call
 * the API as the admin. That equivalence is the authorization model, not an accident:
 * local filesystem access to the data root already IS admin authority — the same rule
 * `penguin server reset-admin-password` stands on (whoever can run it owns web.db
 * anyway) — and agents driving their own harness through the CLI is the product feature
 * this token exists for (server-driven Sessions hand it to tool subprocesses as
 * PENGUIN_API_TOKEN). Rotation per boot bounds the life of any leaked copy to the
 * process that minted it.
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
 * Persists the boot token (owner-only file, tmp + rename so a concurrent reader never
 * sees a partial write). Best-effort like the initial-password file: an exotic read-only
 * root must not stop the server — local CLI callers then fall back to
 * PENGUIN_API_TOKEN.
 */
export function storeApiToken(root: string, token: string): void {
  try {
    fs.mkdirSync(root, { recursive: true });
    const target = apiTokenPath(root);
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${token}\n`, { mode: 0o600 });
    fs.renameSync(tmp, target);
  } catch {
    // Best-effort: Bearer auth still works for callers holding the token some other way.
  }
}

/** The stored token, or null when absent/unreadable/empty (shared with the CLI's file fallback). */
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
