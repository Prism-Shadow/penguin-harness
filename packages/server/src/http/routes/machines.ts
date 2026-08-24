/**
 * Machines routes (admin only, 403 for non-admins):
 * GET  /api/machines                    — this machine and the ssh config's host aliases,
 *                                         the version this server would install, the last
 *                                         status probed for each, and the running or last job.
 * POST /api/machines/probe              — refresh the statuses of the installed machines
 *                                         (one ssh round trip each), then answer the list.
 * POST /api/machines/:machineId/install — start an install; 202, or 409 when one runs.
 * POST /api/machines/:machineId/connect — bring that machine's server up and hold a tunnel
 *                                         to it; 202, or 409 when a connect already runs.
 * POST /api/machines/:machineId/disconnect — drop the tunnel (the remote server stays up).
 * GET  /api/machines/:machineId/dirs?path=  — browse that machine's directories over ssh,
 *                                             so picking a workspace on it needs no second
 *                                             login to that machine's own server.
 *
 * Admin rather than any logged-in user, on a multi-user server as much as a personal one:
 * installing spawns ssh with the SERVER ACCOUNT's keys and writes a program directory on
 * another machine. That is an owner's capability, not a visitor's, and the account whose
 * keys are used is not the account making the request.
 *
 * The install is a job because it can take minutes (see ../../machines/service.ts); this
 * route only starts it and reports it. Progress arrives by polling GET rather than over the
 * event channel — the log lines belong to one page that is open while it waits, and a job
 * that dies with its App has nothing to replay to a reconnecting subscriber.
 */
import { Hono } from "hono";
import type { DirListResponse, MachinesResponse } from "../../api/types.js";
import { HttpError } from "../errors.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { rewriteSetCookie } from "../../machines/proxy.js";

export function machinesRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can install on a machine.");
    }
    await next();
  });

  const state = (): MachinesResponse => ({
    machines: deps.machines.list(),
    imageVersion: deps.machines.imageVersion(),
    job: deps.machines.job(),
    connect: deps.machines.connectJob(),
  });

  app.get("/", (c) => c.json(state()));

  // Probing is a POST because it spends ssh round trips — a GET that spawns processes is a
  // GET a proxy or a prefetch may fire on its own. The page drives the schedule, so nothing
  // here runs when nobody is looking at the page.
  app.post("/probe", async (c) => {
    await deps.machines.probeInstalled();
    return c.json(state());
  });

  app.post("/:machineId/install", async (c) => {
    const started = await deps.machines.startInstall(c.req.param("machineId"));
    if (!started.ok) {
      // Each refusal is its own code: the page renders a sentence per case, and "no image"
      // in particular is a property of THIS server rather than of the machine picked.
      if (started.why === "busy") {
        throw new HttpError(409, "install_running", "An install is already running.");
      }
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such host in this server's ssh config.");
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_install",
          "That is the machine this server runs on; it already has this build.",
        );
      }
      if (started.why === "no-image") {
        throw new HttpError(
          409,
          "no_install_image",
          "This server has no install image to push. A packaged or installed server carries one; a development checkout gets one from its first hot push.",
        );
      }
      throw new HttpError(
        502,
        "unresolvable_host",
        "ssh could not resolve that host. Check ~/.ssh/config, or that ssh is on PATH.",
      );
    }
    return c.json(state(), 202);
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
      throw new HttpError(409, "connect_refused", "That machine cannot be connected to.");
    }
    return c.json(state(), 202);
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
   * Signs this browser in ON that machine, without its password crossing the wire: the
   * sign-in happens over ssh on the machine itself and only the cookie comes back, renamed
   * here into that machine's namespace exactly as the proxy would. A person can still sign
   * in by hand — this is the case where they should not have to.
   */
  app.post("/:machineId/signin", async (c) => {
    const machineId = c.req.param("machineId");
    const outcome = await deps.machines.signInOn(machineId);
    if (outcome === null) {
      throw new HttpError(404, "unknown_machine", "No such machine.");
    }
    if (outcome.kind !== "signed-in") {
      throw new HttpError(
        outcome.kind === "refused" ? 409 : 502,
        outcome.kind === "refused" ? "signin_refused" : "signin_failed",
        outcome.detail,
      );
    }
    for (const cookie of outcome.setCookie) {
      c.header("set-cookie", rewriteSetCookie(cookie, machineId), { append: true });
    }
    return c.json({ signedIn: true });
  });

  app.post("/:machineId/disconnect", (c) => {
    deps.machines.disconnect(c.req.param("machineId"));
    return c.json(state());
  });

  return app;
}
