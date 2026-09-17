import { Component, Interface } from "@prismshadow/penguin-core/kernel";
/**
 * Password hashing (slow-hash storage).
 *
 * Uses node:crypto's scrypt (built-in, no extra dependency, meets the same
 * slow-hash requirement as bcrypt/argon2). Storage format:
 * `scrypt$N$r$p$<salt b64>$<hash b64>` — parameters are stored alongside the hash,
 * so old hashes remain verifiable after future parameter tuning; comparison uses
 * timingSafeEqual to guard against timing side-channels, and a sign-in for an account
 * that does not exist costs the same derivation as a wrong password
 * (verifyAccountPassword).
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Work factor for new hashes. `hashPassword` takes it as a defaulted argument so the server's
 * own test suite can hash at a token cost: almost every case there seeds an admin, provisions
 * users and logs them in, and one derivation at this strength costs on the order of 100ms.
 * Nothing on the production path passes the argument, and no configuration reaches it —
 * `buildAppDeps`, which carries the test override, is not part of this package's exports.
 */
export const SCRYPT_COST = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

function scryptAsync(
  password: string,
  salt: Buffer,
  keyLen: number,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLen, { N: n, r, p, maxmem: 128 * 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Generates a password hash in `scrypt$N$r$p$salt$hash` format. `cost` is scrypt's N and
 * is recorded in the hash, so `verifyPassword` re-derives at whatever cost produced the
 * stored string.
 */
export async function hashPassword(password: string, cost: number = SCRYPT_COST): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, KEY_BYTES, cost, SCRYPT_R, SCRYPT_P);
  return [
    "scrypt",
    String(cost),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * What checking a password against a stored string found. `match` and `mismatch` each cost one
 * scrypt derivation; `unverifiable` — not the `scrypt$N$r$p$salt$hash` format, or parameters
 * scrypt refuses — cost none.
 */
export type PasswordCheck = "match" | "mismatch" | "unverifiable";

/** Checks a password against a stored hash. Never throws. */
export async function checkPassword(password: string, stored: string): Promise<PasswordCheck> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return "unverifiable";
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return "unverifiable";
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length === 0 || expected.length === 0) return "unverifiable";
  let actual: Buffer;
  try {
    actual = await scryptAsync(password, salt, expected.length, n, r, p);
  } catch {
    return "unverifiable";
  }
  return timingSafeEqual(actual, expected) ? "match" : "mismatch";
}

/** Verifies a password; returns false if the stored string has an invalid format (never throws, so the login path can uniformly treat it as a credential error). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  return (await checkPassword(password, stored)) === "match";
}

/**
 * Verifies a sign-in password for an account that may not exist, at the cost a real account's
 * check has. `stored` is the account's hash, or null when there is no such account. When there is
 * nothing to derive against — no account, an empty hash, or one `checkPassword` finds
 * unverifiable — the password is checked against `dummyHash` instead and the result is false, so
 * every call runs exactly one scrypt derivation and how long a failure takes does not tell a
 * missing username from a wrong password. `check` is a parameter so a test can count the
 * derivations.
 */
export async function verifyAccountPassword(
  password: string,
  stored: string | null,
  dummyHash: () => Promise<string>,
  check: (password: string, stored: string) => Promise<PasswordCheck> = checkPassword,
): Promise<boolean> {
  const outcome = stored === null ? "unverifiable" : await check(password, stored);
  if (outcome !== "unverifiable") return outcome === "match";
  await check(password, await dummyHash());
  return false;
}

/** Hashes the passwords this server writes; a test stands in a cheap one. */
export abstract class PasswordHasher extends Interface<{
  hash(password: string): Promise<string>;
}>() {}

/** scrypt at full strength. */
@Component()
export class ScryptHasher implements PasswordHasher {
  hash(password: string): Promise<string> {
    return hashPassword(password, SCRYPT_COST);
  }
}
