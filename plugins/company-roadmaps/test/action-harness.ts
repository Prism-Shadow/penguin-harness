/**
 * The roadmap Actions as the registry runs them: company-proposals' real Action registry and
 * routes, over this plugin's contributions — their data halves read from the generated manifest
 * (ifaces.json, so a test fails when the manifest and the code disagree), their code halves from
 * builtin-actions.ts — and the roadmap read routes, in one Hono app.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { OrgActor } from "@prismshadow/penguin-server/plugin";
import {
  ActionRegistry,
  BUILTIN_MODULES,
  actionRoutes,
  type Contributed,
} from "@prismshadow/penguin-plugin-company-proposals";
import { roadmapCode, roadmapRoutes, type RoadmapService } from "../src/index.js";
import { ORG, PROJECT, type FakeGateway } from "./fakes.js";

export const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Manifests {
  modules: Record<
    string,
    { contributes: Record<string, Array<{ id: string } & Record<string, unknown>>> }
  >;
}

/** This plugin's contributions to the registry's slot, as its generated manifest declares them. */
export function roadmapContributions(service: RoadmapService): Contributed[] {
  const table = JSON.parse(readFileSync(path.join(PLUGIN_DIR, "ifaces.json"), "utf8")) as Manifests;
  const code = roadmapCode(service) as Record<string, unknown>;
  const entries =
    table.modules.CompanyRoadmapsPlugin?.contributes["CompanyActionRegistry.actions"] ?? [];
  return entries.map(({ id, ...data }) => ({
    id,
    from: "CompanyRoadmapsPlugin",
    data,
    code: code[id],
  }));
}

export interface Answer {
  status: number;
  body: Record<string, unknown>;
}

export interface ActionApp {
  app: Hono;
  /** Runs an Action through the route, as `actor` (its Session claims honoured). */
  run(
    key: string,
    subject: string,
    params?: Record<string, unknown>,
    actor?: OrgActor,
  ): Promise<Answer>;
  /** A GET under the app (`/p/proj/o/acme/…`). */
  get(url: string): Promise<Answer>;
}

/**
 * The app at `/p/:projectId/o/:orgId/{actions,roadmaps}`. The cookie gate is played by a
 * middleware that sets the user and says the request came with the local API token (an `x-via`
 * header says otherwise), so an actor's session and Agent claims are honoured.
 */
export function actionApp(opts: {
  gateway: FakeGateway;
  root: string;
  service: RoadmapService;
}): ActionApp {
  const registry = new ActionRegistry({
    gateway: opts.gateway,
    root: opts.root,
    log: () => undefined,
    contributions: roadmapContributions(opts.service),
    builtin: BUILTIN_MODULES,
  });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { userId: "boss" } as never);
    c.set("sessionVia" as never, (c.req.header("x-via") ?? "token") as never);
    await next();
  });
  app.route("/p/:projectId/o/:orgId/actions", actionRoutes(registry));
  app.route("/p/:projectId/o/:orgId/roadmaps", roadmapRoutes(opts.service));
  const json = async (res: Response): Promise<Answer> => ({
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  });
  return {
    app,
    run: async (key, subject, params = {}, actor = { userId: "boss" }) =>
      json(
        await app.request(`/p/${PROJECT}/o/${ORG}/actions/${key}/runs`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subject,
            params,
            ...(actor.sessionId !== undefined ? { sessionId: actor.sessionId } : {}),
            ...(actor.agentId !== undefined ? { agentId: actor.agentId } : {}),
          }),
        }),
      ),
    get: async (url) => json(await app.request(url)),
  };
}

/** The error code of a refused answer. */
export const codeOf = (a: Answer): string => (a.body.error as { code: string }).code;
