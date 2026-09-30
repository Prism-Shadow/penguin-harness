/**
 * The session credential: what a server-driven Session's tool subprocesses get as
 * PENGUIN_API_TOKEN instead of the admin authority the boot token carries.
 *
 * `pst1.<claims>.<mac>` — the claims (Project, Agent, Session and, for a desk or ticket
 * session, the organization) as base64url JSON, and an HMAC-SHA256 over them. The key is
 * derived from the boot's local API token, which never leaves the process: no key file, and
 * a restart rotates every credential it minted, exactly as it rotates the boot token. Nothing
 * is stored per credential; the claims are the whole state, and what they reach is decided
 * per request by the route table in session-scope.ts.
 */
import { createHmac } from "node:crypto";
import { tokensEqual } from "./api-token.js";

/** Who a session credential speaks for. */
export interface SessionClaims {
  projectId: string;
  agentId: string;
  sessionId: string;
  /** The organization the Session works for (a desk or ticket session); absent otherwise. */
  orgId?: string;
}

const PREFIX = "pst1.";
const KEY_LABEL = "penguin-session-token/v1";

function keyOf(apiToken: string): Buffer {
  return createHmac("sha256", apiToken).update(KEY_LABEL).digest();
}

function macOf(apiToken: string, payload: string): string {
  return createHmac("sha256", keyOf(apiToken)).update(payload).digest("base64url");
}

/** Whether a Bearer value has the session credential's shape (it may still fail to verify). */
export function isSessionToken(token: string): boolean {
  return token.startsWith(PREFIX);
}

/** Mints the credential for one Session, signed by this boot's token. */
export function mintSessionToken(apiToken: string, claims: SessionClaims): string {
  const body: SessionClaims = {
    projectId: claims.projectId,
    agentId: claims.agentId,
    sessionId: claims.sessionId,
    ...(claims.orgId !== undefined ? { orgId: claims.orgId } : {}),
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${PREFIX}${payload}.${macOf(apiToken, payload)}`;
}

/** The claims of a credential this boot signed; null for any other value. */
export function verifySessionToken(apiToken: string, token: string): SessionClaims | null {
  if (!isSessionToken(token)) return null;
  const rest = token.slice(PREFIX.length);
  const dot = rest.indexOf(".");
  if (dot <= 0) return null;
  const payload = rest.slice(0, dot);
  if (!tokensEqual(rest.slice(dot + 1), macOf(apiToken, payload))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const str = (v: unknown): v is string => typeof v === "string" && v !== "";
  if (!str(row.projectId) || !str(row.agentId) || !str(row.sessionId)) return null;
  return {
    projectId: row.projectId,
    agentId: row.agentId,
    sessionId: row.sessionId,
    ...(str(row.orgId) ? { orgId: row.orgId } : {}),
  };
}
