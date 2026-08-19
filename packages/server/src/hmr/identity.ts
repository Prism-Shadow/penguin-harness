/**
 * Who a seam request belongs to.
 *
 * A pushed platform is offered every request BEFORE the runtime's auth middleware runs.
 * That ordering is deliberate — a push must be able to decide its own authentication — but
 * it means the Hono context's `user` does not exist yet when platform code sees a request.
 *
 * Rather than have every pushed platform re-implement session lookup, the runtime
 * publishes a resolver through the resource registry. Authenticating is the runtime
 * layer's own job ("boots, transports, authenticates" — see README.md), and a copy of it
 * inside a bundle would be a second implementation to keep in step with cookie names,
 * session TTLs and renewal. This module is the contract between the two: the runtime
 * registers, the platform claims.
 */
import type { Resources } from "@prismshadow/penguin-core/kernel";

/** Registry key the runtime publishes its resolver under. */
export const IDENTITY_RESOURCE_ID = "runtime:identity";

export interface IdentifiedUser {
  userId: string;
}

export type Identity = (request: Request) => Promise<IdentifiedUser | null>;

/**
 * The published resolver, or one that authenticates nobody. A runtime too old to publish
 * it must not silently serve a platform's API to everyone: an unattributable request is
 * not a request from every user, it is a request from none.
 */
export function identityFrom(resources: Resources): Identity {
  const resolver = resources.claim<Identity>(IDENTITY_RESOURCE_ID);
  return resolver ?? (async () => null);
}
