/**
 * The boot's local API token: minted fresh at every server boot and held in memory only
 * (auth/runtime-state.ts). It signs the session credentials a server-driven Session's tool
 * subprocesses get as PENGUIN_API_TOKEN (session-token.ts) and is accepted as no credential
 * by itself, so there is nothing admin-level to hand out or to read off the disk.
 *
 * Builds before this one wrote it to `<root>/api-token` and accepted it as the admin; the CLI
 * read that file when PENGUIN_API_TOKEN was unset. A person's command line now signs in
 * instead (`penguin auth login` / `penguin auth token`).
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
 * Removes the `<root>/api-token` an older build wrote. Best-effort: a root the process cannot
 * write is one it could not have written the file to either.
 */
export function removeApiTokenFile(root: string): void {
  try {
    fs.rmSync(apiTokenPath(root), { force: true });
  } catch {
    // Nothing to do: see above.
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
