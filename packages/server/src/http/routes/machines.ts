/**
 * Machines routes, under a Project (admin only). Relative to `/api/projects/:projectId/machines`:
 *
 * GET  /                        — this machine and the ssh config's host aliases, the version
 *                                 this server would install, the last status probed for each,
 *                                 and the running or last job.
 * POST /probe                   — refresh the statuses of this Project's machines (one ssh
 *                                 round trip each), then answer the list.
 * POST /:machineId/install      — start an install and give the machine to this Project; 202,
 *                                 or 409 when one runs.
 * POST /:machineId/release      — drop it from this Project. The install stays.
 * POST /:machineId/connect      — bring that machine's server up and hold a tunnel to it; 202,
 *                                 or 409 when a connect already runs.
 * POST /:machineId/disconnect   — drop the tunnel (the remote server stays up).
 * POST /:machineId/restart      — stop that machine's server and start it again; 202, or 409.
 * GET  /:machineId/dirs?path=   — browse that machine's directories over ssh.
 *
 * Under a Project because the page is, and because this Project's Model credentials go to
 * this Project's machines and no others (machines/models-sync.ts). The machine itself is not
 * project-scoped: connect, disconnect and dirs act on one host, shared by every Project using
 * it; what a Project owns is the membership.
 *
 * Admin rather than any logged-in user: installing spawns ssh with the SERVER ACCOUNT's keys
 * and writes a program directory on another machine — an owner's capability, not a visitor's.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { DirListResponse, MachinesResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";

export function machinesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Admin AND a member of the Project: the Project scope says WHICH machines are answered,
  // never who may reach them. Installing still spawns ssh with the server account's keys, so
  // a Project owner who is not an admin does not get that capability by owning a Project.
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

  // Probing is a POST because it spends ssh round trips — a GET that spawns processes is a
  // GET a proxy or a prefetch may fire on its own. The page drives the schedule, so nothing
  // here runs when nobody is looking at the page.
  app.post("/probe", async (c) => {
    await deps.machines.probeInstalled(requireValidId(c, "projectId"));
    return c.json(state(c));
  });

  app.post("/:machineId/install", async (c) => {
    // `replaceProgram`: the answer to a job that came back asking for it (see the job's
    // canReplaceProgram). Read leniently — an absent body is the ordinary install.
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const started = await deps.machines.startInstall(
      requireValidId(c, "projectId"),
      c.req.param("machineId"),
      body.replaceProgram === true,
    );
    if (!started.ok) {
      // Each refusal is its own code: the page renders a sentence per case, and "no image"
      // in particular is a property of THIS server rather than of the machine picked.
      if (started.why === "busy") {
        throw new HttpError(409, "install_running", "An install is already running.");
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_install",
          "That is the machine this server runs on. It cannot push this build over the program directory it is running from.",
        );
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

  app.post("/:machineId/connect", async (c) => {
    const started = await deps.machines.startConnect(c.req.param("machineId"));
    if (!started.ok) {
      if (started.why === "busy") {
        throw new HttpError(409, "connect_running", "A connect is already running.");
      }
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_connect",
          "That is the machine this server runs on — you are already on it.",
        );
      }
      if (started.why === "not-installed") {
        throw new HttpError(
          409,
          "not_installed",
          "Nothing is installed on that machine yet. Install it first.",
        );
      }
      if (started.why === "unsupported") {
        throw new HttpError(
          409,
          "connect_unsupported",
          "A Windows machine cannot be connected yet: its sshd hands commands to cmd.exe, and there is no shell to hold a session on.",
        );
      }
      throw new HttpError(409, "connect_refused", "That machine cannot be connected to.");
    }
    return c.json(state(c), 202);
  });

  // Addressed by the machine's OWN id, like the proxy: this answers "what is on THAT
  // machine", and the ssh alias it happens to be reached through is not that machine's name.
  app.get("/:machineId/dirs", async (c) => {
    const listing = await deps.machines.listDirs(
      c.req.param("machineId"),
      c.req.query("path") ?? "",
    );
    if (listing === null) {
      throw new HttpError(
        404,
        "dir_not_found",
        "That machine could not be reached, or that directory does not exist on it.",
      );
    }
    return c.json(listing satisfies DirListResponse);
  });

  /**
   * Drops a machine from this Project. Deliberately leaves the install alone: another Project
   * may be using it, and "stop listing this here" is not "go wipe that machine".
   */
  app.post("/:machineId/release", (c) => {
    deps.machines.release(requireValidId(c, "projectId"), c.req.param("machineId"));
    return c.json(state(c));
  });

  /**
   * Restarts that machine's server: stop, then start on the same port. What makes it worth a
   * control of its own is that a machine's FILES can be brought forward while it runs — a
   * replicated store, an install that matched — and only a restart makes the process match
   * them. 202, or 409 when a job already runs.
   */
  app.post("/:machineId/restart", async (c) => {
    const started = await deps.machines.startRestart(c.req.param("machineId"));
    if (!started.ok) {
      if (started.why === "busy")
        throw new HttpError(409, "job_running", "A job is already running.");
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      if (started.why === "self") {
        throw new HttpError(409, "self_restart", "That is the machine this server runs on.");
      }
      throw new HttpError(409, "not_installed", "Nothing is installed on that machine yet.");
    }
    return c.json(state(c), 202);
  });

  app.post("/:machineId/disconnect", (c) => {
    deps.machines.disconnect(c.req.param("machineId"));
    return c.json(state(c));
  });

  return app;
}
