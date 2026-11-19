/**
 * The Storage page's routes, under the current user (`/api/me/storage`), so what they measure and
 * clean is by construction what this user may see: the Projects they own or are a member of, and
 * for an admin the whole data root (../../storage/).
 *
 *   GET  /           the figures: by category, per Project and Agent, and for an admin the server
 *   POST /refresh    measure every unit in scope again
 *   GET  /cleanup    the review: what can be removed safely now (`olderThanDays=` for idle ones)
 *   POST /cleanup    remove the chosen items, each judged again
 *   GET  /sessions   the Sessions by size and age (deleting them is the archive page's batch)
 *   POST /reveal     show a Project's folder, or the data root, in the file manager
 */
import { Hono } from "hono";
import type { Context } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { isValidId, projectDir } from "@prismshadow/penguin-core";
import type { Access, ProjectConfigStore, Projects } from "@prismshadow/penguin-library-project";
import type { SessionIndex } from "@prismshadow/penguin-library-session";
import type { TraceIndex, TraceIndexStore } from "@prismshadow/penguin-library-trace";
import type {
  StorageSessionListing,
  StorageSessionSort,
  StorageSessionsQuery,
} from "../../api/storage-types.js";
import type { AppEnv } from "../../auth/middleware.js";
import { Config, Desktop, Log } from "../../hmr/capabilities.js";
import type { AgentConfig } from "../../mechanisms/agents.js";
import type { FileReveal } from "../../mechanisms/workspace.js";
import { Sessions as ManagerIface, SessionServiceIface } from "../../runtime/session-manager.js";
import { FsLimiter } from "../../services/tree-purge.js";
import { CLEANUP_BATCH_MAX, StorageCleanupService, parseIdleDays } from "../../storage/cleanup.js";
import { StorageSessionsService } from "../../storage/sessions.js";
import { StorageUsageService } from "../../storage/usage.js";
import type { StorageCaller } from "../../storage/usage.js";
import { HttpError } from "../errors.js";
import { badRequest, listingViewOfRequest, parseNonNegativeInt, readJson } from "../validate.js";

/**
 * Filesystem calls the Storage page keeps in flight, its measuring and its removals together.
 * libuv gives file I/O four threads by default; two leave the rest to the requests the server is
 * answering meanwhile (the same share the Agent purge takes).
 */
const STORAGE_FS_SLOTS = 2;

const LISTINGS: readonly StorageSessionListing[] = ["all", "active", "archived"];
const SORTS: readonly StorageSessionSort[] = ["size", "age"];

/** What the route group reaches. */
export interface StorageRouteDeps {
  usage: StorageUsageService;
  cleanup: StorageCleanupService;
  sessions: StorageSessionsService;
  access: Pick<Access, "requireProjectAccess">;
  root: string;
  /** Whether the server runs under the desktop shell (the reveal's first condition). */
  desktopMode: boolean;
  fileReveal: FileReveal;
}

function callerOf(c: Context<AppEnv>): StorageCaller {
  return { userId: c.var.user.userId, isAdmin: c.var.user.isAdmin };
}

/** A measurement that could not be made reaches the page as one answer naming why. */
function measureFailed(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
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

  app.get("/", async (c) => c.json(await deps.usage.usage(callerOf(c))));

  app.post("/refresh", async (c) => c.json(await deps.usage.usage(callerOf(c), { refresh: true })));

  app.get("/cleanup", async (c) => {
    const days = parseIdleDays(c.req.query("olderThanDays"));
    try {
      return c.json(await deps.cleanup.review(callerOf(c), days));
    } catch (err) {
      throw measureFailed(err);
    }
  });

  app.post("/cleanup", async (c) => {
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
   * Shows a folder in the machine's own file manager. Gated as the Workspace files' reveal is:
   * outside desktop mode there is no window on this machine to open it beside, and a browser
   * session is refused because the server cannot tell one signed in on this machine from one
   * signed in from elsewhere. The data root is an admin's; a Project's folder is its members'.
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
      target = deps.root;
    } else {
      if (typeof body.projectId !== "string" || !isValidId(body.projectId)) {
        throw new HttpError(
          404,
          "project_not_found",
          "Project does not exist or you do not have access.",
        );
      }
      deps.access.requireProjectAccess(c.var.user.userId, body.projectId);
      target = projectDir(deps.root, body.projectId);
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

/** The Storage page's node: its services over the session runtime, the indexes and the root. */
@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "storage",
        prefix: "/api/me/storage",
        auth: "user",
        order: 276,
      },
    ],
  },
})
export class StorageRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly log!: Log;
  @Use() private readonly access!: Access;
  @Use() private readonly projects!: Projects;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly manager!: ManagerIface;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly traceStore!: TraceIndexStore;
  @Use() private readonly fileReveal!: FileReveal;
  @Bind("storage") routes!: Hono<AppEnv>;
  /** Ends this generation's measurements and removals when it is disposed. */
  private readonly stopping = new AbortController();

  setup(ctx: ClassCtx) {
    ctx.effect(() => this.stopping.abort());
    const root = this.config.root;
    const limiter = new FsLimiter(STORAGE_FS_SLOTS);
    const signal = this.stopping.signal;
    const now = () => Date.now();
    const log = (line: string) => this.log.line(line);
    const access = this.access;
    const agentName = async (projectId: string, agentId: string) => {
      try {
        return (await this.agentConfig.readCardMeta(projectId, agentId)).name ?? agentId;
      } catch {
        return agentId;
      }
    };
    const usage = new StorageUsageService({
      root,
      limiter,
      signal,
      listProjects: (userId) => access.listProjects(userId),
      isIndexedProject: (projectId) => this.projects.findById(projectId) !== null,
      agentName,
      now,
      log,
    });
    const manager = this.manager;
    const sessionService = this.sessionService;
    const cleanup = new StorageCleanupService({
      root,
      usage,
      manager: {
        sessionInUse: (sessionId) => manager.sessionInUse(sessionId),
        agentInUse: (projectId, agentId) => manager.agentInUse(projectId, agentId),
      },
      sessions: this.sessionsRepo,
      allProjectIds: () => this.projects.listAll().map((row) => row.projectId),
      traceStore: this.traceStore,
      listingOf: (row) => sessionService.listingOf(row),
      canAccess: (userId, projectId) => access.canAccess(userId, projectId),
      projectName: async (projectId) => (await this.projectConfig.getName(projectId)) ?? projectId,
      limiter,
      signal,
      now,
      log,
    });
    const sessions = new StorageSessionsService({
      listProjects: (userId) => access.listProjects(userId),
      sessions: this.sessionsRepo,
      listingOf: (row, view) => sessionService.listingOf(row, view),
      traceIndex: this.traceIndex,
      traceStore: this.traceStore,
      sessionInUse: (sessionId) => manager.sessionInUse(sessionId),
      agentName,
      scratchpadBytes: (projectId, agentId, sessionId) =>
        usage.projectFigures(projectId)?.agents.get(agentId)?.scratchpads.get(sessionId)?.bytes,
      now,
    });
    // What an earlier process left in a server cache's trash; a Project's `agents/.deleting/`
    // the Agent service resumes at start.
    void cleanup.resumePurges().catch((err: unknown) => {
      log(`[storage] resuming the cache purge failed: ${(err as Error).message}`);
    });
    this.routes = storageRoutes({
      usage,
      cleanup,
      sessions,
      access,
      root,
      desktopMode: this.desktop.current() !== null,
      fileReveal: this.fileReveal,
    });
  }
}
