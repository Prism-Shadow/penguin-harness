/**
 * The session token: a statement the server signed, not a record it stored — so auth, which
 * runs on every request, verifies on CPU and touches the database only for the user row and
 * revocation (both held in memory after boot).
 *
 * Format `v1.<payload b64url>.<mac b64url>`, payload = JSON of {@link TokenClaims}. HMAC not
 * JWT on purpose: one algorithm, no header to negotiate, no `alg:none` parser to get wrong;
 * the version prefix is room for a future format, and verifyToken refuses anything without it.
 *
 * The signing key is generated in memory at process start and written nowhere — nothing a
 * backup can leak, and a restart IS the rotation (every outstanding token dies with it, paid
 * as one re-typed browser password; hot pushes keep the process, minted tokens re-mint). The
 * one property the row model had that this gives up: issuance leaves no audit trail, only
 * revocations do.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** What a token asserts about itself. Short keys: the payload rides in a cookie on every request. */
export interface TokenClaims {
  /** userId */
  u: string;
  /** How the session was established: "password" | "desktop" | "setup" | "cli". Verification maps anything else to "password". */
  v: string;
  /** Issued at, epoch ms — compared against the user's not-before mark to revoke per user. */
  iat: number;
  /** Expires at, epoch ms. */
  exp: number;
  /** Token id, for the revocation list: revoking stores this, never the token. */
  jti: string;
}

const PREFIX = "v1";

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
