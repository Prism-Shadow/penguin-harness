/**
 * Chromium's cookie encryption, decryption side only. An `encrypted_value` starts with a
 * three-byte version tag:
 *
 * - macOS and Linux: `v10` / `v11` + AES-128-CBC (IV of 16 spaces, PKCS7) under a key that
 *   PBKDF2-HMAC-SHA1 derives from a password with the salt "saltysalt" (see chromium-keys.ts).
 * - Windows: `v10` / `v11` + a 12-byte nonce + AES-256-GCM ciphertext + a 16-byte tag, under
 *   the key DPAPI unwraps from `Local State`.
 * - `v20`: Chrome's app-bound encryption (127+, Windows), which only the browser itself can
 *   undo.
 *
 * From store version 24 on, the plaintext starts with SHA-256(host_key), which ties the value
 * to its host; it is verified and stripped. A candidate key that yields a mismatched digest,
 * bad padding or control characters is the wrong key, so the caller can try several.
 */
import crypto from "node:crypto";

export type CookieCipher = "v10" | "v11" | "v20" | "unknown";

const CBC_IV = Buffer.alloc(16, 0x20);
const SALT = "saltysalt";
const GCM_NONCE = 12;
const GCM_TAG = 16;
const HOST_DIGEST = 32;
/** The store version from which plaintexts carry SHA-256(host_key). */
export const HOST_DIGEST_VERSION = 24;

/** PBKDF2-HMAC-SHA1(password, "saltysalt", iterations) → a 16-byte AES-128 key. */
export function deriveCbcKey(password: string, iterations: number): Buffer {
  return crypto.pbkdf2Sync(password, SALT, iterations, 16, "sha1");
}

export function cipherOf(encrypted: Uint8Array): CookieCipher {
  const tag = Buffer.from(encrypted.subarray(0, 3)).toString("latin1");
  return tag === "v10" || tag === "v11" || tag === "v20" ? tag : "unknown";
}

/**
 * Decrypts one `encrypted_value` (version tag included) with one candidate key; null when the
 * key does not fit. `mode` is the platform's scheme: CBC on macOS and Linux, GCM on Windows.
 */
export function decryptCookieValue(
  encrypted: Uint8Array,
  key: Buffer,
  mode: "cbc" | "gcm",
  hostKey: string,
  storeVersion: number,
): string | null {
  const payload = Buffer.from(encrypted.subarray(3));
  const plaintext = mode === "cbc" ? decryptCbc(payload, key) : decryptGcm(payload, key);
  return plaintext === null ? null : valueOf(plaintext, hostKey, storeVersion);
}

function decryptCbc(payload: Buffer, key: Buffer): Buffer | null {
  if (payload.length === 0 || payload.length % 16 !== 0) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, CBC_IV);
    return Buffer.concat([decipher.update(payload), decipher.final()]);
  } catch {
    return null;
  }
}

function decryptGcm(payload: Buffer, key: Buffer): Buffer | null {
  if (payload.length < GCM_NONCE + GCM_TAG) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, payload.subarray(0, GCM_NONCE));
    decipher.setAuthTag(payload.subarray(payload.length - GCM_TAG));
    return Buffer.concat([
      decipher.update(payload.subarray(GCM_NONCE, payload.length - GCM_TAG)),
      decipher.final(),
    ]);
  } catch {
    return null;
  }
}

/** The cookie value inside a plaintext: the host digest checked and stripped, then text only. */
function valueOf(plaintext: Buffer, hostKey: string, storeVersion: number): string | null {
  let body = plaintext;
  if (storeVersion >= HOST_DIGEST_VERSION) {
    if (plaintext.length < HOST_DIGEST) return null;
    const digest = crypto.createHash("sha256").update(hostKey, "utf8").digest();
    if (!digest.equals(plaintext.subarray(0, HOST_DIGEST))) return null;
    body = plaintext.subarray(HOST_DIGEST);
  }
  const value = body.toString("utf8");
  // A cookie value is text: control characters (tab aside) mean a key that only happened to unpad.
  return /[\u0000-\u0008\u000a-\u001f\u007f]/.test(value) ? null : value;
}
