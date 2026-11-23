/**
 * The Storage page's routes, under the current user (`/api/me/storage`), so what they measure and
 * clean is by construction what this user may see: the Projects they own or are a member of, and
 * for an admin the whole data root. The storage plugin's server module (./module.ts) mounts them.
 *
 *   GET  /           the figures: by category, per Project and Agent, and for an admin the server
 *   POST /refresh    measure every unit in scope again
 *   GET  /cleanup    the review: what can be removed safely now (`olderThanDays=` for idle ones)
 *   POST /cleanup    remove the chosen items, each judged again (a person's sign-in only)
 *   GET  /sessions   the Sessions by size and age (deleting them is the archive page's batch)
 *   POST /reveal     show a Project's folder, or the data root, in the file manager
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { isValidId } from "@prismshadow/penguin-core/plugin";
import {
  HttpError,
  badRequest,
  isHttpError,
  listingViewOfRequest,
  parseNonNegativeInt,
  readJson,
  requireHuman,
} from "@prismshadow/penguin-server/plugin";
import type { Access, AppEnv, DataLayout, FileReveal } from "@prismshadow/penguin-server/plugin";
import type { StorageSessionListing, StorageSessionSort, StorageSessionsQuery } from "../types.js";
import { CLEANUP_BATCH_MAX, parseIdleDays } from "./cleanup.js";
import type { StorageCleanupService } from "./cleanup.js";
import type { StorageSessionsService } from "./sessions.js";
import type { StorageCaller, StorageUsageService } from "./usage.js";

const LISTINGS: readonly StorageSessionListing[] = ["all", "active", "archived"];
const SORTS: readonly StorageSessionSort[] = ["size", "age"];

/** What the route group reaches. */
export interface StorageRouteDeps {
  usage: StorageUsageService;
  cleanup: StorageCleanupService;
  sessions: StorageSessionsService;
  access: Pick<Access, "requireProjectAccess">;
  layout: DataLayout;
  /** Whether the server runs under the desktop shell (the reveal's first condition). */
  desktopMode: boolean;
  fileReveal: FileReveal;
}

function callerOf(c: Context<AppEnv>): StorageCaller {
  return { userId: c.var.user.userId, isAdmin: c.var.user.isAdmin };
}

/** A measurement that could not be made reaches the page as one answer naming why. */
function measureFailed(err: unknown): HttpError {
  if (isHttpError(err)) return err;
  return new HttpError(
    500,
    "storage_measure_failed",
    err instanceof Error ? err.message : "The data root could not be measured.",
  );
}

/** The Trace list's filters, from the query string. */
function parseSessionsQuery(raw: Record<string, string>): StorageSessionsQuery {
  const query: StorageSessionsQuery = {};
  const projectNotFound = () =>
    new HttpError(404, "project_not_found", "Project does not exist or you do not have access.");
  if (raw.projectId !== undefined && raw.projectId !== "") {
    if (!isValidId(raw.projectId)) throw projectNotFound();
    query.projectId = raw.projectId;
  }
  if (raw.agentId !== undefined && raw.agentId !== "") {
    if (query.projectId === undefined) throw badRequest("agentId needs projectId.");
    if (!isValidId(raw.agentId)) throw badRequest("agentId is not an id.");
    query.agentId = raw.agentId;
  }
  if (raw.listing !== undefined && raw.listing !== "") {
    if (!LISTINGS.includes(raw.listing as StorageSessionListing)) {
      throw badRequest(`listing must be one of ${LISTINGS.join(" / ")}.`);
    }
    query.listing = raw.listing as StorageSessionListing;
  }
  if (raw.olderThanDays !== undefined && raw.olderThanDays !== "") {
    const days = parseNonNegativeInt(raw.olderThanDays);
    if (days === null || days > 3650) {
      throw badRequest("olderThanDays must be a whole number of days between 0 and 3650.");
    }
    query.olderThanDays = days;
  }
  if (raw.sort !== undefined && raw.sort !== "") {
    if (!SORTS.includes(raw.sort as StorageSessionSort)) {
      throw badRequest(`sort must be one of ${SORTS.join(" / ")}.`);
    }
    query.sort = raw.sort as StorageSessionSort;
  }
  return query;
}

export function storageRoutes(deps: StorageRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  /**
   * Whether the caller may show a folder (the reveal below): outside desktop mode there is no
   * window on this machine to open it beside, and a browser session is refused because the server
   * cannot tell one signed in on this machine from one signed in from elsewhere.
   */
  const reveals = (c: Context<AppEnv>) => deps.desktopMode && c.var.sessionVia === "desktop";

  app.get("/", async (c) =>
    c.json({
      ...(await deps.usage.usage(callerOf(c), { wait: c.req.query("wait") === "1" })),
      reveal: reveals(c),
    }),
  );

  app.post("/refresh", async (c) =>
    c.json({ ...(await deps.usage.usage(callerOf(c), { refresh: true })), reveal: reveals(c) }),
  );

  app.get("/cleanup", async (c) => {
    const days = parseIdleDays(c.req.query("olderThanDays"));
    try {
      return c.json(await deps.cleanup.review(callerOf(c), days));
    } catch (err) {
      throw measureFailed(err);
    }
  });

  // Removing files is a person's decision: the local API token every Agent's shell holds is
  // refused (`human_required`), as for the other writes only a person makes. Reading is anyone's.
  app.post("/cleanup", async (c) => {
    requireHuman(c);
    const body = await readJson(c);
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > CLEANUP_BATCH_MAX) {
      throw badRequest(`items must be an array of 1–${CLEANUP_BATCH_MAX} item ids.`);
    }
    if (!items.every((id) => typeof id === "string" && id.length <= 1024)) {
      throw badRequest("items must hold item ids.");
    }
    const olderThanDays = parseIdleDays(body.olderThanDays);
    return c.json(
      await deps.cleanup.remove(callerOf(c), { items: items as string[], olderThanDays }),
    );
  });

  app.get("/sessions", async (c) =>
    c.json(
      await deps.sessions.list(
        c.var.user.userId,
        parseSessionsQuery(c.req.query()),
        listingViewOfRequest(c),
      ),
    ),
  );

  /**
   * Shows a folder in the machine's own file manager. Gated as the Workspace files' reveal is
   * (`reveals` above). The data root is an admin's; a Project's folder is its members'.
   */
  app.post("/reveal", async (c) => {
    const body = await readJson(c);
    if (!deps.desktopMode) throw new HttpError(404, "not_found", "Desktop mode is not enabled.");
    if (c.var.sessionVia !== "desktop") {
      throw new HttpError(
        403,
        "desktop_shell_only",
        "Showing a folder is available from the desktop app's own window.",
      );
    }
    let target: string;
    if (body.projectId === undefined) {
      if (!c.var.user.isAdmin) {
        throw new HttpError(403, "admin_required", "Only an admin can show the data root.");
      }
      target = deps.layout.root();
    } else {
      if (typeof body.projectId !== "string" || !isValidId(body.projectId)) {
        throw new HttpError(
          404,
          "project_not_found",
          "Project does not exist or you do not have access.",
        );
      }
      deps.access.requireProjectAccess(c.var.user.userId, body.projectId);
      target = deps.layout.projectDir(body.projectId);
    }
    try {
      await deps.fileReveal.reveal(target);
    } catch (err) {
      throw new HttpError(
        502,
        "reveal_failed",
        err instanceof Error ? err.message : "The file manager could not be opened.",
      );
    }
    return c.body(null, 204);
  });

  return app;
}
