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
import { parseCookieHeader, sessionCookies } from "../auth/middleware.js";

export interface IdentifiedUser {
  userId: string;
}

export type Identity = (request: Request) => Promise<IdentifiedUser | null>;

/** What the resolver needs of the claimed AuthService — the member the handshake verifies. */
export interface AuthenticatesSessions {
  authenticateWithMeta(token: string): { user: { userId: string } } | null;
}

/**
 * Builds the resolver from the claimed auth capability. Null (a bare kernel, which has no
 * auth to claim) authenticates nobody: an unattributable request is not a request from
 * everyone, so terminals stay fail-closed.
 */
export function identityFrom(auth: AuthenticatesSessions | null): Identity {
  if (auth === null) return async () => null;
  return async (request) => {
    const cookies = parseCookieHeader(request.headers.get("cookie"));
    for (const { token } of sessionCookies(cookies, request.headers.get("host") ?? undefined)) {
      const authed = auth.authenticateWithMeta(token);
      if (authed !== null) return { userId: authed.user.userId };
    }
    return null;
  };
}
