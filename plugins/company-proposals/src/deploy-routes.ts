/**
 * The deploy routes (deploy.ts), mounted inside the proposal routes and so behind the same
 * cookie gate and the same identity rules (route-input.ts):
 *
 *   GET    /deploy-scripts        { scripts }
 *   POST   /deploy-scripts        { id, command: string[], description? } → the script (201)
 *   DELETE /deploy-scripts/:id    → 204
 *   POST   /deploys               { script, proposal | pr, head?, args?, dryRun? } → { run } (202) or { plan }
 *   GET    /deploys/:id?from=<n>  → { run, output, from, next }
 *
 * The routes read `user.isAdmin` off the gate: registering or removing a script is a server
 * admin's (deploy.ts says why).
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { ProposalDeployScriptsResponse } from "@prismshadow/penguin-server/api";
import type { DeployRequest, DeployService } from "./deploy.js";
import { ProposalError } from "./service.js";
import {
  actorOf,
  actorOfQuery,
  jsonBody,
  optionalString,
  param,
  requireString,
} from "./route-input.js";

function isAdmin(c: Context): boolean {
  return (c.get("user" as never) as { isAdmin?: boolean }).isAdmin === true;
}

function positiveInt(body: Record<string, unknown>, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new ProposalError(400, "bad_request", `${key} must be a positive integer.`);
  }
  return value;
}

export function deployRoutes(deploys: DeployService): Hono {
  const app = new Hono();

  app.get("/deploy-scripts", async (c) =>
    c.json({
      scripts: await deploys.scripts(param(c, "projectId"), param(c, "orgId"), actorOfQuery(c)),
    } satisfies ProposalDeployScriptsResponse),
  );

  app.post("/deploy-scripts", async (c) => {
    const body = await jsonBody(c);
    const description = optionalString(body, "description", 500);
    const script = await deploys.register(
      param(c, "projectId"),
      param(c, "orgId"),
      actorOf(c, body),
      isAdmin(c),
      {
        id: requireString(body, "id", 64),
        command: body.command,
        ...(description !== undefined ? { description } : {}),
      },
    );
    return c.json(script, 201);
  });

  app.delete("/deploy-scripts/:id", async (c) => {
    await deploys.remove(
      param(c, "projectId"),
      param(c, "orgId"),
      actorOfQuery(c),
      isAdmin(c),
      c.req.param("id"),
    );
    return c.body(null, 204);
  });

  app.post("/deploys", async (c) => {
    const body = await jsonBody(c);
    const proposal = positiveInt(body, "proposal");
    const pr = positiveInt(body, "pr");
    const head = optionalString(body, "head", 40);
    const req: DeployRequest = {
      script: requireString(body, "script", 64),
      ...(proposal !== undefined ? { proposal } : {}),
      ...(pr !== undefined ? { pr } : {}),
      ...(head !== undefined ? { head } : {}),
      ...(body.args !== undefined ? { args: body.args } : {}),
      dryRun: body.dryRun === true,
    };
    const res = await deploys.start(
      param(c, "projectId"),
      param(c, "orgId"),
      actorOf(c, body),
      req,
    );
    return c.json(res, "run" in res ? 202 : 200);
  });

  app.get("/deploys/:id", async (c) => {
    const from = Number(c.req.query("from") ?? "0");
    return c.json(
      await deploys.get(
        param(c, "projectId"),
        param(c, "orgId"),
        actorOfQuery(c),
        c.req.param("id"),
        Number.isInteger(from) && from > 0 ? from : 0,
      ),
    );
  });

  return app;
}
