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
 * relaunches it when it exits with core's SERVER_RESTART_EXIT_CODE, which is what the
 * lifecycle capability's trigger does after the graceful shutdown. Without a supervisor the
 * route says so (`no_supervisor`) instead of stopping a service nobody would bring back,
 * and the page shows the manual restart hint.
 */
import { versionReport } from "../../version-report.js";
import { Hono } from "hono";
import type { Context } from "hono";
import type { RestartResponse, UpdateJobStatus, VersionResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { ServerConfig } from "../../config.js";
import type { UpdateCheckService } from "../../services/update-check-service.js";
import type { UpdateJobService } from "../../services/update-job.js";
import type { Lifecycle } from "../../hmr/capabilities.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface VersionRouteDeps {
  config: ServerConfig;
  updateCheck: UpdateCheckService;
  /** The admin self-update run in the background (`penguin update --yes`), with its progress for the update modal. */
  updateJob: UpdateJobService;
  /** Whether a supervisor relaunches this process, and the restart trigger the update flow pulls. */
  lifecycle: Lifecycle;
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
    if (!deps.lifecycle.supervised()) {
      return c.json({ restarting: false, reason: "no_supervisor" } satisfies RestartResponse);
    }
    // Answer first, then leave: the response must be on the wire before the listener closes.
    setTimeout(() => {
      if (!deps.lifecycle.requestRestart()) {
        console.error("[server] restart requested, but no restart trigger is registered");
      }
    }, RESTART_DELAY_MS).unref();
    return c.json({ restarting: true } satisfies RestartResponse);
  });

  return app;
}
