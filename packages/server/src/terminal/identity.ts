/**
 * Who a seam request belongs to.
 *
 * The platform is offered every request BEFORE the runtime's auth middleware runs — that
 * ordering is deliberate (a push must be able to decide its own authentication), so
 * `c.var.user` does not exist here. The resolver is ORDINARY CODE over the claimed auth
 * capability, not a registry entry: the App already authenticates every business request
 * with the same cookie name and the same claimed AuthService (auth/middleware.ts rides in
 * the bundle), so a second, registry-published copy of "cookie → user" was a duplicate
 * channel pretending to be a resource. The registry carries resources and capabilities;
 * a function derivable from an already-claimed capability is neither.
 */
import { SESSION_COOKIE } from "../auth/middleware.js";

export interface IdentifiedUser {
  userId: string;
  /**
   * Whether this is an operator, not merely a signed-in user. A platform surface that can
   * make the harness run code it was not shipped with (see ../workflows/routes.ts) gates
   * on this: an agent able to self-modify the harness it runs inside would be a
   * privilege-escalation hole, so installing one is an operator action.
   */
  isAdmin: boolean;
}

export type Identity = (request: Request) => Promise<IdentifiedUser | null>;

/** What the resolver needs of the claimed AuthService — the member the handshake verifies. */
export interface AuthenticatesSessions {
  authenticateWithMeta(token: string): { user: { userId: string; isAdmin: boolean } } | null;
}

/** The session cookie out of a raw Cookie header (the seam hands over a plain Request). */
export function readSessionCookie(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Builds the resolver from the claimed auth capability. Null (a bare kernel, which has no
 * auth to claim) authenticates nobody: an unattributable request is not a request from
 * everyone, so terminals stay fail-closed.
 */
export function identityFrom(auth: AuthenticatesSessions | null): Identity {
  if (auth === null) return async () => null;
  return async (request) => {
    const token = readSessionCookie(request.headers.get("cookie"));
    const authed = token === null ? null : auth.authenticateWithMeta(token);
    return authed === null ? null : { userId: authed.user.userId, isAdmin: authed.user.isAdmin };
  };
}
