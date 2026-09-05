/**
 * Version routes: the running release identity, the update-check reminder, and the
 * admin-only self-update with its restart.
 *
 *   GET  /api/version               -> versionReport(): the running build's identity plus
 *                                      this root's pushed harness, the same record
 *                                      `penguin version --json` prints
 *   GET  /api/version/update-check  -> UpdateCheckService (fail-soft, cached, opt-out env;
 *                                      ?force=1 bypasses the cache for the manual check)
 *   GET  /api/version/update        -> admin only: the self-update job's status
 *   POST /api/version/update        -> admin only: starts the job — `penguin update --yes`
 *                                      in the background, progress readable at GET
 *                                      (services/update-job.ts owns the run)
 *   POST /api/version/restart       -> admin only: restart into the installed release
 *
 * The restart is the supervisor's job: `penguin server|web` runs this process as a child and
 * relaunches it when it exits with core's SERVER_RESTART_EXIT_CODE, which is how the
 * platform's own restart control leaves after the graceful shutdown
 * (services/process-restart.ts). Without a supervisor the route says so (`no_supervisor`)
 * instead of stopping a service nobody would bring back, and the page shows the manual
 * restart hint.
 */
import { versionReport } from "../../version-report.js";
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  RestartResponse,
  UpdateJobStatus,
  UpdateRunResponse,
  VersionHistoryDiffResponse,
  VersionHistoryResponse,
  VersionResponse,
  VersionRollbackResponse,
} from "../../api/types.js";
import { diffIfaces } from "../../hmr/ifaces-diff.js";
import type { HarnessHistoryIface } from "../../services/harness-history.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";
import type { UpdateCheck } from "../../services/update-check-service.js";
import type { UpdateJob } from "../../services/update-job.js";
import type { RestartControl } from "../../services/process-restart.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface VersionRouteDeps {
  config: ServerConfig;
  updateCheck: UpdateCheck;
  /** The admin self-update run in the background (`penguin update --yes`), with its progress for the update modal. */
  updateJob: UpdateJob;
  /** The "restart to update" step: whether a supervisor relaunches this process, and the leaving (services/process-restart.ts). */
  restart: RestartControl;
  history: HarnessHistoryIface;
}

// The classifier lives with the job now; re-exported so its unit tests keep their import.
export { classifyUpdateRun } from "../../services/update-job.js";

/** Delay between answering the restart request and leaving: lets the response flush. */
const RESTART_DELAY_MS = 50;

function requireAdmin(c: Context<AppEnv>): void {
  if (!c.var.user.isAdmin) {
    throw new HttpError(403, "admin_required", "Only an admin can perform this operation.");
  }
}

export function versionRoutes(deps: VersionRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    return c.json((await versionReport(deps.config.root)) satisfies VersionResponse);
  });

  /** The versions that have booted on this root, newest first, with the runtime's current commit. */
  app.get("/history", async (c) => {
    return c.json((await deps.history.list()) satisfies VersionHistoryResponse);
  });

  /** A recorded interface table by hash — what a version was built from. */
  app.get("/history/ifaces/:hash", async (c) => {
    const table = await deps.history.table(c.req.param("hash"));
    if (table === null) throw new HttpError(404, "not_found", "No interface table with that hash.");
    return c.json(table);
  });

  /** What changed between two recorded tables (`from` / `to` are hashes; either may be "none"). */
  app.get("/history/diff", async (c) => {
    const load = async (q: string | undefined) =>
      q === undefined || q === "none" ? null : await deps.history.table(q);
    const [from, to] = await Promise.all([load(c.req.query("from")), load(c.req.query("to"))]);
    const asTable = (t: unknown) => t as Parameters<typeof diffIfaces>[0];
    return c.json(diffIfaces(asTable(from), asTable(to)) satisfies VersionHistoryDiffResponse);
  });

  /** Pushes a kept version back through the runtime (admin). Answers before the swap: this platform is what gets replaced. */
  app.post("/history/rollback", async (c) => {
    if (!c.get("user").isAdmin) throw new HttpError(403, "forbidden", "Rollback is admin-only.");
    const { id } = (await c.req.json().catch(() => ({}))) as { id?: unknown };
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]+$/.test(id))
      throw new HttpError(400, "bad_request", "`id` names a recorded version.");
    const entries = (await deps.history.list()).entries;
    const target = entries.find((e) => e.id === id);
    if (target === undefined || !target.rollbackable)
      throw new HttpError(404, "not_found", "No kept artifacts for that version.");
    void deps.history.rollback(id).catch(() => undefined);
    return c.json({ started: true, id } satisfies VersionRollbackResponse, 202);
  });

  app.get("/update-check", async (c) => {
    // ?force=1 (the web's manual "check for updates" action) bypasses the TTL cache;
    // see UpdateCheckService.check for why a user-initiated press-through is acceptable.
    return c.json(await deps.updateCheck.check(c.req.query("force") === "1"));
  });

  app.get("/update", (c) => {
    requireAdmin(c);
    return c.json(deps.updateJob.status() satisfies UpdateJobStatus);
  });

  app.post("/update", async (c) => {
    requireAdmin(c);
    // Which release the run targets is a label for the modal, read from the server's own
    // (cached) lookup — never from the request, and never something the run depends on:
    // `penguin update` resolves the release itself.
    const check = await deps.updateCheck.check(false);
    const target = check.updateAvailable ? check.latestVersion : null;
    const cliEntry = process.env.PENGUIN_CLI_ENTRY ?? null;
    return c.json(deps.updateJob.start(cliEntry, target) satisfies UpdateJobStatus);
  });

  app.post("/restart", (c) => {
    requireAdmin(c);
    if (!deps.restart.supervised()) {
      return c.json({ restarting: false, reason: "no_supervisor" } satisfies RestartResponse);
    }
    // Answer first, then leave: the response must be on the wire before the listener closes.
    setTimeout(() => deps.restart.request(), RESTART_DELAY_MS).unref();
    return c.json({ restarting: true } satisfies RestartResponse);
  });

  return app;
}
