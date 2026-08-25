/**
 * The owner token — `<root>/owner-token`, minted fresh at every process start.
 *
 * The one authorization axiom this server has always leaned on is "whoever can read the data
 * root owns this server": the root holds every credential the server can reach, so local read
 * access IS ownership. This file is that axiom given a single, deliberately short-lived
 * anchor. A client that can read it proves ownership by presenting its value to
 * `POST /api/auth/owner` (over loopback HTTP, the transport every platform has) and receives
 * an ordinary signed session in exchange.
 *
 * What it replaces is a hierarchy of worse anchors, each a long-lived secret at rest:
 * `auth-token-secret` (a permanent signing key — a leaked backup meant forging sessions
 * forever) and `initial-admin-password` (a plaintext password). The owner token is neither a
 * key nor a password: it signs nothing, it is not derived from anything, and it dies with the
 * process — a fresh value is written on every boot, so a copy that leaks through a backup is
 * overwhelmingly a value the server no longer honors.
 *
 * A socket would make the ownership check kernel-enforced at connection time, but sockets are
 * exactly the platform-dependent surface this design refuses: a magic-cookie file plus
 * loopback HTTP behaves identically everywhere Node runs. The cost, stated honestly: the
 * check happens at read time, so a value exfiltrated mid-boot stays usable until the next
 * restart — a bounded window where the old scheme's was unbounded.
 *
 * 0600 on create AND re-asserted, since the mode option only applies to new files. The value
 * is held in memory by the AuthService for comparison; the file exists for CLIENTS to read.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { writeSecretFile } from "../secret-file.js";

const FILE = "owner-token";

export function ownerTokenPath(root: string): string {
  return path.join(root, FILE);
}

/** Writes this boot's owner token and returns its value. Called once at process start. */
export function issueOwnerToken(root: string): string {
  const value = randomBytes(32).toString("base64url");
  fs.mkdirSync(root, { recursive: true });
  // Symlink-safe (writeSecretFile): the root's own mode is the umask's, so a write-only
  // attacker must not be able to redirect this token into a file they can read.
  writeSecretFile(ownerTokenPath(root), value + "\n");
  return value;
}

/** Reads the current owner token — the client half. Null when no server has written one. */
export function readOwnerToken(root: string): string | null {
  try {
    const value = fs.readFileSync(ownerTokenPath(root), "utf8").trim();
    return value === "" ? null : value;
  } catch {
    return null;
  }
}

/** Constant-time equality, so the redemption endpoint cannot be timed into a value. */
export function ownerTokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
