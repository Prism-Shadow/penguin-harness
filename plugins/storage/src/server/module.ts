/**
 * The Storage page's server module, which the storage plugin adds to the platform tree: one node
 * that builds the measuring, the cleanup and the Sessions list over what the host hands a plugin,
 * and mounts their routes under `/api/me/storage`.
 *
 * It reaches the host only through the plugin face (`@prismshadow/penguin-server/plugin`) and
 * core's plugin subpath, both bundled into the plugin's dist (tsup.config.ts):
 * - the data root's layout (`DataLayout`), so every path follows the host's helpers;
 * - the session runtime's in-use answers (`SessionActivity`), asked in the same synchronous step
 *   as a removal;
 * - the deleting folders (`DeletingFolders`), the host's one way to move a folder aside and
 *   remove it in the background — the way an Agent deletion goes;
 * - the access rule (`Access`), the Project, Session and Trace indexes, the listing rule and the
 *   Agents' names.
 * Deleting a Session is not here: the page sends the chosen ids to the archive page's batch,
 * the host's single-Session delete path.
 */
import { Bind, Module, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx } from "@prismshadow/penguin-core/plugin";
import type { Hono } from "hono";
import { FsLimiter } from "@prismshadow/penguin-server/plugin";
import type {
  Access,
  AgentConfig,
  AppEnv,
  DataLayout,
  DeletingFolders,
  Desktop,
  FileReveal,
  Log,
  ProjectConfigStore,
  Projects,
  SessionActivity,
  SessionIndex,
  SessionServiceIface,
  TraceIndex,
  TraceIndexStore,
} from "@prismshadow/penguin-server/plugin";
import { StorageCleanupService } from "./cleanup.js";
import { storageRoutes } from "./routes.js";
import { StorageSessionsService } from "./sessions.js";
import { StorageUsageService } from "./usage.js";

/**
 * Filesystem calls the measuring keeps in flight. libuv gives file I/O four threads by default;
 * two leave the rest to the requests the server is answering meanwhile (the share the host's
 * background removals take too).
 */
const STORAGE_FS_SLOTS = 2;

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "StorageModule.routes",
        prefix: "/api/me/storage",
        auth: "user",
        order: 276,
      },
    ],
  },
})
export class StorageModule {
  @Use() private readonly layout!: DataLayout;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly log!: Log;
  @Use() private readonly access!: Access;
  @Use() private readonly projects!: Projects;
  @Use() private readonly projectConfig!: ProjectConfigStore;
  @Use() private readonly agentConfig!: AgentConfig;
  @Use() private readonly activity!: SessionActivity;
  @Use() private readonly folders!: DeletingFolders;
  @Use() private readonly sessionService!: SessionServiceIface;
  @Use() private readonly sessionsRepo!: SessionIndex;
  @Use() private readonly traceIndex!: TraceIndex;
  @Use() private readonly traceStore!: TraceIndexStore;
  @Use() private readonly fileReveal!: FileReveal;
  @Bind("StorageModule.routes") routes!: Hono<AppEnv>;
  /** Ends this generation's measurements when it is disposed. */
  private readonly stopping = new AbortController();

  setup(ctx: ClassCtx) {
    ctx.effect(() => this.stopping.abort());
    const layout = this.layout;
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
      layout,
      limiter,
      signal,
      listProjects: (userId) => access.listProjects(userId),
      isIndexedProject: (projectId) => this.projects.findById(projectId) !== null,
      agentName,
      now,
      log,
    });
    const activity = this.activity;
    const sessionService = this.sessionService;
    const cleanup = new StorageCleanupService({
      layout,
      usage,
      activity: {
        sessionInUse: (sessionId) => activity.sessionInUse(sessionId),
        agentInUse: (projectId, agentId) => activity.agentInUse(projectId, agentId),
      },
      folders: this.folders,
      sessions: this.sessionsRepo,
      allProjectIds: () => this.projects.listAll().map((row) => row.projectId),
      traceStore: this.traceStore,
      listingOf: (row) => sessionService.listingOf(row),
      canAccess: (userId, projectId) => access.canAccess(userId, projectId),
      projectName: async (projectId) => (await this.projectConfig.getName(projectId)) ?? projectId,
      now,
      log,
    });
    const sessions = new StorageSessionsService({
      listProjects: (userId) => access.listProjects(userId),
      sessions: this.sessionsRepo,
      listingOf: (row, view) => sessionService.listingOf(row, view),
      traceIndex: this.traceIndex,
      traceStore: this.traceStore,
      sessionInUse: (sessionId) => activity.sessionInUse(sessionId),
      agentName,
      scratchpadBytes: (projectId, agentId, sessionId) =>
        usage.projectFigures(projectId)?.agents.get(agentId)?.scratchpads.get(sessionId)?.bytes,
      now,
    });
    // What an earlier process left in a server cache's deleting folder; a Project's
    // `agents/.deleting/` the host removes at every start.
    void cleanup.resumePurges().catch((err: unknown) => {
      log(`[storage] resuming the cache purge failed: ${(err as Error).message}`);
    });
    this.routes = storageRoutes({
      usage,
      cleanup,
      sessions,
      access,
      layout,
      desktopMode: this.desktop.current() !== null,
      fileReveal: this.fileReveal,
    });
  }
}
