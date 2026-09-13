/**
 * Error→Project attribution, shared by the runtime shell's onError (app.ts) and the
 * business app's (app.ts). A leaf module so the platform bundle can import
 * it without dragging the runtime shell into its graph.
 */
import type { Context } from "hono";
import type { ProjectAccess } from "../services/project-access.js";
import type { AppEnv } from "../auth/middleware.js";
import type { UserRow } from "../db/repos/users.js";

/**
 * The Project an error is attributed to: only
 * attributed when the URL has a `:projectId` **and** the requester genuinely has
 * access to that Project; otherwise recorded as unattributed (`project_id IS
 * NULL`, visible only to admins).
 *
 * onError also has to handle requests that **haven't passed permission checks
 * yet** — a 401 from being logged out, a 404 from not being a member, both get
 * recorded here. Attributing directly from the URL parameter would let anyone
 * (not necessarily a member of that Project, or even logged in) pick a projectId
 * and hammer it repeatedly to pollute another user's Project with error stats.
 * Traces that can't be attributed simply fall into the admin view (unattributed
 * errors are only visible to admins by design anyway), which is exactly where
 * unauthorized probing belongs.
 *
 * Two defenses here, because this code runs on the error-handling path:
 * - `c.var.user`'s static type is non-null, but authMiddleware never sets it
 *   **before** throwing the 401 when logged out, so at runtime it may actually be
 *   undefined — it can only be read safely, never destructured directly.
 * - Exceptions are swallowed entirely: throwing here would break onError itself
 *   (possibly recursively); any judgment failure falls back to unattributed.
 */
export function attributedProjectId(
  c: Context<AppEnv>,
  deps: { access: ProjectAccess },
): string | undefined {
  try {
    const projectId = c.req.param("projectId");
    if (projectId === undefined) return undefined;
    const user = c.get("user") as UserRow | undefined;
    if (user === undefined) return undefined;
    return deps.access.canAccess(user.userId, projectId) ? projectId : undefined;
  } catch {
    return undefined;
  }
}
