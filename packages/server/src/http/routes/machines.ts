/**
 * Machines routes, under a Project (admin only). Relative to `/api/projects/:projectId/machines`:
 *
 * GET  /                        — this machine and every machine of every loaded kind, the kinds,
 *                                 the version this server would install, the last status probed
 *                                 for each, and the running or last job.
 * POST /probe                   — refresh the statuses of this Project's machines (one round
 *                                 trip each), then answer the list.
 * POST /:machineId/install      — start an install and give the machine to this Project; 202,
 *                                 or 409 when one runs.
 * POST /:machineId/release      — drop it from this Project. The install stays.
 * POST /:machineId/connect      — bring that machine's server up and hold a tunnel to it; 202,
 *                                 or 409 when a connect already runs.
 * POST /:machineId/disconnect   — drop the tunnel (the remote server stays up).
 * POST   /kinds/:kind/definitions        — define a machine of that kind by hand; 201.
 * GET    /kinds/:kind/definitions/:name  — a definition read back, and whether it may be rewritten.
 * PUT    /kinds/:kind/definitions/:name  — rewrite one; 404 none, 409 not rewritable.
 * DELETE /kinds/:kind/definitions/:name  — forget one the host keeps (never removes anything
 *                                          over there); 409 for a kind that keeps its own.
 * POST /:machineId/restart      — stop that machine's server and start it again; 202, or 409.
 * GET  /:machineId/dirs?path=   — browse that machine's directories over its session.
 *
 * Under a Project because the page is, and because this Project's Model credentials go to
 * this Project's machines and no others (machines/models-sync.ts). The machine itself is not
 * project-scoped: connect, disconnect and dirs act on one host, shared by every Project using
 * it; what a Project owns is the membership.
 *
 * Admin rather than any logged-in user: installing reaches the machine with the SERVER
 * ACCOUNT's credentials (its ssh keys, its container runtime) and writes a program directory
 * there — an owner's capability, not a visitor's.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type {
  DirListResponse,
  MachinesResponse,
  MachineDefinitionResponse,
  MachinesUseResponse,
} from "../../api/types.js";
import { HttpError } from "../errors.js";
import { requireValidId } from "../validate.js";
import type { AppEnv } from "../../auth/middleware.js";
import type { DefinitionRefusal, MachinesService } from "../../machines/service.js";
import type { Access } from "../../mechanisms/projects.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MachinesRouteDeps {
  machines: MachinesService;
  access: Access;
}

export function machinesRoutes(deps: MachinesRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Admin AND a member of the Project: the Project scope says WHICH machines are answered,
  // never who may reach them. Installing still reaches machines with the server account's credentials, so
  // a Project owner who is not an admin does not get that capability by owning a Project.
  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can install on a machine.");
    }
    deps.access.requireProjectAccess(c.var.user.userId, requireValidId(c, "projectId"));
    await next();
  });

  const state = (c: Context<AppEnv>): MachinesResponse => ({
    machines: deps.machines.list(requireValidId(c, "projectId")),
    kinds: deps.machines.kinds(),
    imageVersion: deps.machines.imageVersion(),
    job: deps.machines.job(),
    jobs: deps.machines.jobs(),
  });

  /**
   * Bring machines into use — the one verb a person needs. Each is queued for the whole
   * pipeline (install if needed, hand over, connect, sync); what could be refused without
   * reaching a machine is answered by id in `refused`, and the rest report through `jobs`. 202 always:
   * the queue is the answer, even when some rows were refused.
   */
  app.post("/use", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const machines = Array.isArray(body.machines)
      ? body.machines.filter((m): m is string => typeof m === "string")
      : [];
    if (machines.length === 0) {
      throw new HttpError(400, "bad_request", "Name at least one machine to use.");
    }
    const { refused } = deps.machines.startUse(
      requireValidId(c, "projectId"),
      machines,
      body.replaceProgram === true,
    );
    return c.json({ ...state(c), refused } satisfies MachinesUseResponse, 202);
  });

  /** A definition refusal as the routes answer it: each case its own code, the field named in the message. */
  const refusal = (refused: DefinitionRefusal): HttpError => {
    switch (refused.why) {
      case "unknown-kind":
        return new HttpError(
          404,
          "unknown_machine_kind",
          "No machine kind by that name is loaded here.",
        );
      case "no-form":
        return new HttpError(
          409,
          "definitions_not_accepted",
          "Machines of that kind are not defined by hand.",
        );
      case "exists":
        return new HttpError(
          409,
          "machine_exists",
          "A machine of that kind already has that name.",
        );
      case "not-found":
        return new HttpError(404, "machine_definition_not_found", "No definition by that name.");
      case "foreign":
        return new HttpError(
          409,
          "machine_definition_foreign",
          "That definition was not written here and may carry options the form does not know; edit it where it lives.",
        );
      case "kind-stored":
        return new HttpError(
          409,
          "machine_definition_kind_stored",
          "That kind keeps its own definitions; remove it where it lives.",
        );
      case "invalid":
        return new HttpError(
          400,
          "machine_definition_invalid",
          refused.field === null ? refused.message : `${refused.field}: ${refused.message}`,
        );
    }
  };
  const values = (body: Record<string, unknown>): Record<string, unknown> =>
    typeof body.values === "object" && body.values !== null && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};

  /** Define a machine of a kind by hand; 201 with the list, which now names it. */
  app.post("/kinds/:kind/definitions", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name : "";
    const defined = await deps.machines.defineMachine(c.req.param("kind"), name, values(body));
    if (!defined.ok) throw refusal(defined);
    return c.json(state(c), 201);
  });

  /** A definition read back — for the form that configures it — and whether it may be rewritten. */
  app.get("/kinds/:kind/definitions/:name", (c) => {
    const name = c.req.param("name");
    const found = deps.machines.machineDefinition(c.req.param("kind"), name);
    if (found === null) throw refusal({ why: "not-found" });
    return c.json({ name, ...found } satisfies MachineDefinitionResponse);
  });

  /** Rewrite a definition; the name stays. */
  app.put("/kinds/:kind/definitions/:name", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const updated = await deps.machines.updateMachineDefinition(
      c.req.param("kind"),
      c.req.param("name"),
      values(body),
    );
    if (!updated.ok) throw refusal(updated);
    return c.json(state(c));
  });

  /** Forget a definition the host keeps. Nothing over there is touched. */
  app.delete("/kinds/:kind/definitions/:name", (c) => {
    const forgotten = deps.machines.forgetMachineDefinition(
      c.req.param("kind"),
      c.req.param("name"),
    );
    if (!forgotten.ok) throw refusal(forgotten);
    return c.json(state(c));
  });

  /** Stop using machines: connections dropped, membership released; the install over there stays. */
  app.post("/stop-using", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const machines = Array.isArray(body.machines)
      ? body.machines.filter((m): m is string => typeof m === "string")
      : [];
    if (machines.length === 0) {
      throw new HttpError(400, "bad_request", "Name at least one machine to stop using.");
    }
    deps.machines.stopUsing(requireValidId(c, "projectId"), machines);
    return c.json(state(c));
  });

  app.get("/", (c) => c.json(state(c)));

  // Probing is a POST because it spends round trips to machines — a GET that spawns processes is a
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
      if (started.why === "kind-unavailable") {
        throw new HttpError(
          409,
          "machine_kind_unavailable",
          "That machine's kind is not loaded here: enable its plugin, or check why it failed to load.",
        );
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_install",
          "That is the machine this server runs on. It cannot push this build over the program directory it is running from.",
        );
      }
      if (started.why === "unknown-machine") {
        throw new HttpError(404, "unknown_machine", "No such machine here.");
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
        throw new HttpError(404, "unknown_machine", "No such machine here.");
      }
      if (started.why === "self") {
        throw new HttpError(
          409,
          "self_connect",
          "That is the machine this server runs on — you are already on it.",
        );
      }
      if (started.why === "kind-unavailable") {
        throw new HttpError(
          409,
          "machine_kind_unavailable",
          "That machine's kind is not loaded here: enable its plugin, or check why it failed to load.",
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
          "A Windows machine cannot be connected yet: it hands commands to cmd.exe, and there is no shell to hold a session on.",
        );
      }
      throw new HttpError(409, "connect_refused", "That machine cannot be connected to.");
    }
    return c.json(state(c), 202);
  });

  // Addressed by the machine's OWN id, like the proxy: this answers "what is on THAT
  // machine", and the address it happens to be reached through is not that machine's name.
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
        throw new HttpError(404, "unknown_machine", "No such machine here.");
      }
      if (started.why === "self") {
        throw new HttpError(409, "self_restart", "That is the machine this server runs on.");
      }
      if (started.why === "kind-unavailable") {
        throw new HttpError(
          409,
          "machine_kind_unavailable",
          "That machine's kind is not loaded here: enable its plugin, or check why it failed to load.",
        );
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
