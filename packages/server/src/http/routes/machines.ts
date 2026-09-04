/**
 * Machines routes, under a Project (admin only, 403 for non-admins). Relative to
 * `/api/projects/:projectId/machines`:
 *
 * POST /:machineId/install — start an install and give the machine to this Project; 202, or
 *                            409 when one runs.
 * POST /:machineId/release — drop it from this Project. The install stays.
 * GET  /                   — the ssh config's host aliases with what this Project has
 *                            installed on each, the version this server would install, and
 *                            the running or last job.
 *
 * Under a Project because the page is, and because a Project's machines are where that
 * Project's work runs. The machine itself is not project-scoped — one host, one program,
 * shared by every Project that adopted it; what a Project owns is the membership.
 *
 * Admin rather than any logged-in user, on a multi-user server as much as a personal one:
 * installing spawns ssh with the SERVER ACCOUNT's keys and writes a program directory on
 * another machine. That is an owner's capability, not a visitor's, and the account whose
 * keys are used is not the account making the request. The Project scope says WHICH
 * machines are answered, never who may reach them.
 *
 * The install is a job because it can take minutes (see ../../machines/service.ts); this
 * route only starts it and reports it. Progress arrives by polling GET rather than over the
 * event channel — the log lines belong to one page that is open while it waits, and a job
 * that dies with its App has nothing to replay to a reconnecting subscriber.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { MachinesResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";

export function machinesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can install on a machine.");
    }
    deps.projectService.requireProjectAccess(c.var.user.userId, requireValidId(c, "projectId"));
    await next();
  });

  const state = (c: Context<AppEnv>): MachinesResponse => ({
    machines: deps.machines.list(requireValidId(c, "projectId")),
    imageVersion: deps.machines.imageVersion(),
    job: deps.machines.job(),
  });

  app.get("/", (c) => c.json(state(c)));

  app.post("/:machineId/release", (c) => {
    deps.machines.release(requireValidId(c, "projectId"), c.req.param("machineId"));
    return c.json(state(c));
  });

  app.post("/:machineId/install", async (c) => {
    const started = await deps.machines.startInstall(
      requireValidId(c, "projectId"),
      c.req.param("machineId"),
    );
    if (!started.ok) {
      // Each refusal is its own code: the page renders a sentence per case, and "no image"
      // in particular is a property of THIS server rather than of the machine picked.
      if (started.why === "busy") {
        throw new HttpError(409, "install_running", "An install is already running.");
      }
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      throw new HttpError(
        409,
        "no_install_image",
        "This server has no install image to push. A packaged or installed server carries one; a development checkout gets one from its first hot push.",
      );
    }
    return c.json(state(c), 202);
  });

  return app;
}
