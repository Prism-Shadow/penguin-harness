/**
 * Port forwarding routes, relative to `/api/port-forwards` (admin only):
 *
 * GET    /?machine=&workspace=  — the forwards and what is known of each; `workspace` alone
 *                                 is meaningless (a directory is only a Workspace on its
 *                                 machine), `machine` alone is that machine's every forward.
 * POST   /                      — forward a port; 201, 404 unknown machine, 409 when the
 *                                 forward exists, the asked local port is taken, or an `out`
 *                                 forward is asked of a hub whose ssh cannot carry one.
 * DELETE /:id                   — close its listener and connections, forget it.
 *
 * Admin rather than any logged-in user, the rule `/server/<machineId>/` already has: a
 * forward reaches into another computer over ssh access that is the server account's.
 */
import { Hono } from "hono";
import type { PortForwardInfo, PortForwardsResponse } from "../api/types.js";
import type { AppEnv } from "../auth/middleware.js";
import { HttpError } from "../http/errors.js";
import { badRequest, pathParam, readJson, requireString } from "../http/validate.js";
import { MIN_LOCAL_PORT, isDirection, isPort, type PortForwardService } from "./service.js";

const MAX_WORKSPACE_LEN = 4096;

export function portForwardRoutes(forwards: PortForwardService): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    if (!c.var.user.isAdmin) {
      throw new HttpError(403, "admin_required", "Only an admin can forward a machine's port.");
    }
    await next();
  });

  app.get("/", (c) => {
    const machineId = c.req.query("machine");
    const workspace = c.req.query("workspace");
    if (workspace !== undefined && machineId === undefined) {
      throw badRequest("workspace requires machine.");
    }
    const body: PortForwardsResponse = { forwards: forwards.list({ machineId, workspace }) };
    return c.json(body);
  });

  app.post("/", async (c) => {
    const body = await readJson(c);
    const machineId = requireString(body, "machineId", { minLen: 1, maxLen: 64 });
    const workspace = requireString(body, "workspace", { minLen: 1, maxLen: MAX_WORKSPACE_LEN });
    const direction = body.direction ?? "in";
    if (!isDirection(direction)) throw badRequest('direction must be "in" or "out".');
    const remotePort = body.remotePort;
    if (!isPort(remotePort)) throw badRequest("remotePort must be a port (1-65535).");
    const localPort = body.localPort ?? undefined;
    if (localPort !== undefined && (!isPort(localPort) || localPort < MIN_LOCAL_PORT)) {
      throw badRequest(`localPort must be a port (${MIN_LOCAL_PORT}-65535).`);
    }
    // An `out` forward sends a service of ours: which one is the caller's to say.
    if (direction === "out" && localPort === undefined) {
      throw badRequest("localPort is required for an out forward.");
    }

    const made = await forwards.create({ machineId, workspace, direction, remotePort, localPort });
    if (!("error" in made)) return c.json<PortForwardInfo>(made, 201);
    switch (made.error) {
      case "unknown_machine":
        throw new HttpError(404, "unknown_machine", "No machine by that id.");
      case "forward_exists":
        throw new HttpError(
          409,
          "forward_exists",
          `Port ${remotePort} of this Workspace is already forwarded, to localhost:${made.existing.localPort}.`,
        );
      case "local_port_in_use":
        throw new HttpError(
          409,
          "local_port_in_use",
          `Local port ${made.localPort} is in use on this server.`,
        );
      case "no_free_local_port":
        throw new HttpError(409, "local_port_in_use", "No free local port near that one.");
      case "unsupported_here":
        throw new HttpError(
          409,
          "unsupported_here",
          "This server's ssh cannot carry an out forward (Win32 OpenSSH has no control socket).",
        );
    }
  });

  app.delete("/:id", async (c) => {
    if (!(await forwards.remove(pathParam(c, "id")))) {
      throw new HttpError(404, "not_found", "No such port forward.");
    }
    return c.body(null, 204);
  });

  return app;
}
