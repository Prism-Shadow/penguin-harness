/**
 * The session token itself: a statement the server signed, not a record it stored.
 *
 * Auth runs on EVERY request, which makes it the hottest path in the server. A token that
 * carries its own claims and proves them with a signature keeps that path on CPU — the
 * database is consulted only for what cannot live inside the token: the user row, and
 * revocation (auth_revocations, held in memory after boot).
 *
 * Format: `v1.<payload b64url>.<mac b64url>`, payload = JSON of {@link TokenClaims}. HMAC
 * rather than JWT on purpose — one algorithm, no header to negotiate, no dependency, and no
 * `alg:none` class of parser to get wrong. The version prefix is what lets the auth layer
 * tell a signed token from a legacy database token (those are 43 chars of base64url with no
 * dots) and from any future format.
 *
 * THE KEY NEVER RESTS. It is generated in memory at process start and written nowhere, so
 * there is nothing a backup can leak and nothing to rotate — a restart IS the rotation, and
 * every outstanding signed token dies with it. That cost lands almost entirely on nobody:
 * hot pushes swap the App and keep the process (and key) alive; CLI and machine tokens live
 * an hour and are re-minted on demand; only a browser session across a REAL restart pays,
 * as one re-typed password. Issuance is invisible (no row), so the audit trail is only of
 * revocations — the one property of the row model this scheme genuinely gives up.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** What a token asserts about itself. Short keys: the payload rides in a cookie on every request. */
export interface TokenClaims {
  /** userId */
  u: string;
  /** How the session was established: "password" | "desktop" | "cli". Verification maps unknown values to "password". */
  v: string;
  /** Issued at, epoch ms — compared against the user's not-before mark to revoke per user. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
  /** Token id, for the revocation list: revoking stores this, never the token. */
  jti: string;
}

const PREFIX = "v1";

/** Whether a cookie value is even claiming to be a signed token (vs a legacy row token). */
export function looksSigned(token: string): boolean {
  return token.startsWith(`${PREFIX}.`);
}

export function signToken(claims: TokenClaims, secret: Buffer): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const mac = createHmac("sha256", secret).update(`${PREFIX}.${payload}`).digest("base64url");
  return `${PREFIX}.${payload}.${mac}`;
}

/** Fresh claims for one session. The jti is random, not derived: two tokens minted in the same millisecond must revoke independently. */
export function newClaims(u: string, v: string, nowMs: number, ttlMs: number): TokenClaims {
  return { u, v, iat: nowMs, exp: nowMs + ttlMs, jti: randomBytes(12).toString("base64url") };
}

/**
 * The claims, if and only if the signature is genuine. Expiry is NOT checked here — the
 * caller owns the clock, and revocation (logout) must be able to read the claims of a token
 * that has already expired without being told there is nothing there.
 */
export function verifyToken(token: string, secret: Buffer): TokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, payload, mac] = parts as [string, string, string];
  const expected = createHmac("sha256", secret).update(`${PREFIX}.${payload}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  // Constant-time, and only after the length check timingSafeEqual itself requires.
  if (given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (claims === null || typeof claims !== "object") return null;
  const c = claims as Record<string, unknown>;
  if (
    typeof c.u !== "string" ||
    c.u === "" ||
    typeof c.v !== "string" ||
    typeof c.iat !== "number" ||
    typeof c.exp !== "number" ||
    typeof c.jti !== "string" ||
    c.jti === ""
  ) {
    return null;
  }
  return { u: c.u, v: c.v, iat: c.iat, exp: c.exp, jti: c.jti };
}
