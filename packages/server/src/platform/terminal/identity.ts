/**
 * Who a seam request belongs to.
 *
 * The platform is offered every request BEFORE the runtime's auth middleware runs — that
 * ordering is deliberate (a push must be able to decide its own authentication), but it
 * means `c.var.user` does not exist here. Rather than re-implement session lookup in
 * pushed code, the runtime publishes this capability through the resource registry:
 * authenticating is the runtime layer's own job ("boots, transports, authenticates"), and
 * a copy of it inside a bundle would be a second implementation to keep in step with
 * cookie names, session TTLs and renewal.
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
 * it must not silently hand out terminals — an unattributable request is not a request
 * from everyone.
 */
export function identityFrom(resources: Resources): Identity {
  const resolver = resources.claim<Identity>(IDENTITY_RESOURCE_ID);
  return resolver ?? (async () => null);
}
