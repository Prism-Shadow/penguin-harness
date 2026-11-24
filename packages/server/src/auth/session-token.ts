/**
 * Per-Session Bearer tokens for commands an Agent runs inside a Session (`PENGUIN_API_TOKEN`).
 *
 * Derived with HMAC-SHA256 from this boot's local API token and the Session's id: unforgeable
 * without the server's secret, automatically rotated on restart, and valid across HMR pushes
 * without storing another table. On the server it authenticates as a synthetic Session principal
 * (`session:<projectId>:<sessionId>`) with member-level access confined strictly to that
 * Session's Project — never admin, never another Project, never Project owner, and never
 * accepted by `apiTokenOnly` (remote session exchange) or `requireHuman` routes.
 */
import { createHmac } from "node:crypto";
import { tokensEqual } from "./api-token.js";

/** Wire prefix distinguishing a per-Session token from the boot's local API token. */
export const SESSION_TOKEN_PREFIX = "psess_";

/**
 * Reserved synthetic `userId` prefix for a Session-scoped principal.
 * Real `userId`s never contain `:`, so this namespace is disjoint from `users.user_id`.
 */
export const SESSION_PRINCIPAL_PREFIX = "session:";

export interface SessionPrincipal {
  readonly projectId: string;
  readonly sessionId: string;
}

function mac(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`session-token:v1:${sessionId}`).digest("base64url");
}

/** Mints the deterministic per-Session Bearer token for `sessionId` under this boot's secret. */
export function mintSessionToken(secret: string, sessionId: string): string {
  return `${SESSION_TOKEN_PREFIX}${sessionId}.${mac(secret, sessionId)}`;
}

/** Verifies a per-Session token and returns its `sessionId`, or `null` when malformed or invalid. */
export function verifySessionToken(secret: string, token: string): string | null {
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  const body = token.slice(SESSION_TOKEN_PREFIX.length);
  const dot = body.lastIndexOf(".");
  if (dot <= 0 || dot === body.length - 1) return null;
  const sessionId = body.slice(0, dot);
  const sig = body.slice(dot + 1);
  if (!tokensEqual(sig, mac(secret, sessionId))) return null;
  return sessionId;
}

/** Formats the synthetic `userId` carried on `c.var.user` for a Session-scoped token. */
export function sessionPrincipalId(projectId: string, sessionId: string): string {
  return `${SESSION_PRINCIPAL_PREFIX}${projectId}:${sessionId}`;
}

/** Parses a synthetic Session principal id, or returns `null` for any real user account id. */
export function parseSessionPrincipal(userId: string): SessionPrincipal | null {
  if (!userId.startsWith(SESSION_PRINCIPAL_PREFIX)) return null;
  const rest = userId.slice(SESSION_PRINCIPAL_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return {
    projectId: rest.slice(0, sep),
    sessionId: rest.slice(sep + 1),
  };
}

/** True when `userId` is a synthetic Session principal rather than a row in `users`. */
export function isSessionPrincipal(userId: string): boolean {
  return parseSessionPrincipal(userId) !== null;
}
