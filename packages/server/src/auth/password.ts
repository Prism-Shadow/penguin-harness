import { Component, Interface } from "@prismshadow/penguin-core/kernel";
/**
 * Password hashing (slow-hash storage).
 *
 * Uses node:crypto's scrypt (built-in, no extra dependency, meets the same
 * slow-hash requirement as bcrypt/argon2). Storage format:
 * `scrypt$N$r$p$<salt b64>$<hash b64>` — parameters are stored alongside the hash,
 * so old hashes remain verifiable after future parameter tuning; comparison uses
 * timingSafeEqual to guard against timing side-channels.
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

/** Verifies a password; returns false if the stored string has an invalid format (never throws, so the login path can uniformly treat it as a credential error). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4]!, "base64");
    expected = Buffer.from(parts[5]!, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = await scryptAsync(password, salt, expected.length, n, r, p);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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
