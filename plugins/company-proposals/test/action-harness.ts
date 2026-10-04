/**
 * The Action registry as the tests drive it: the plugin's own contributions — their data halves
 * read from the generated manifest (ifaces.json, so a test fails when the manifest and the code
 * disagree), their code halves from builtin-actions.ts — plus whatever a test adds, behind the
 * real action routes and the proposal read routes, in one Hono app.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { OrgActor, OrgGateway } from "@prismshadow/penguin-server/plugin";
import {
  ActionRegistry,
  actionRoutes,
  noticeCode,
  proposalCode,
  proposalRoutes,
  type Contributed,
  type ProposalService,
  type RegistryDeps,
} from "../src/index.js";

export const PLUGIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

interface Manifests {
  modules: Record<
    string,
    { contributes: Record<string, Array<{ id: string } & Record<string, unknown>>> }
  >;
}

/** A module's contributions to the registry's slot, as the generated manifest of `dir` declares them. */
export function manifestContributions(
  dir: string,
  module: string,
  code: Record<string, unknown>,
): Contributed[] {
  const table = JSON.parse(readFileSync(path.join(dir, "ifaces.json"), "utf8")) as Manifests;
  const entries = table.modules[module]?.contributes["CompanyActionRegistry.actions"] ?? [];
  return entries.map(({ id, ...data }) => ({ id, from: module, data, code: code[id] }));
}

/** The plugin's own contributions over `service`: the proposal Actions and their notices. */
export function proposalContributions(service: ProposalService): Contributed[] {
  return [
    ...manifestContributions(PLUGIN_DIR, "CompanyProposalsPlugin", proposalCode(service)),
    ...manifestContributions(PLUGIN_DIR, "ProposalNotices", noticeCode(service)),
  ];
}

export interface ActionApp {
  app: Hono;
  registry: ActionRegistry;
  /** Runs an Action through the route; answers the HTTP status and body. */
  run(
    key: string,
    subject: string,
    params?: Record<string, unknown>,
    actor?: OrgActor,
    extra?: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }>;
  /** A GET of the action routes (`/runs?…`, `?subject=…`). */
  get(suffix: string, actor?: OrgActor): Promise<{ status: number; body: Record<string, unknown> }>;
}

/**
 * The app over `contributions`, mounted at `/p/:projectId/o/:orgId/{actions,proposals}`. The
 * cookie gate is played by a middleware that sets the user and says the request came with the
 * local API token, so an actor's session and Agent claims are honoured.
 */
export function actionApp(opts: {
  gateway: OrgGateway;
  root: string;
  project: string;
  org: string;
  contributions: Contributed[];
  service?: ProposalService;
  deps?: Partial<RegistryDeps>;
}): ActionApp {
  // A clock that moves a millisecond per reading: runs started in one test order by time.
  let tick = Date.parse("2026-10-03T00:00:00Z");
  const registry = new ActionRegistry({
    gateway: opts.gateway,
    root: opts.root,
    log: () => undefined,
    contributions: opts.contributions,
    now: () => tick++,
    ...opts.deps,
  });
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user" as never, { userId: c.req.header("x-user") ?? "boss" } as never);
    c.set("sessionVia" as never, "token" as never);
    await next();
  });
  app.route("/p/:projectId/o/:orgId/actions", actionRoutes(registry));
  if (opts.service !== undefined) {
    app.route("/p/:projectId/o/:orgId/proposals", proposalRoutes(opts.service));
  }
  const base = `/p/${opts.project}/o/${opts.org}/actions`;
  const send = async (url: string, init: RequestInit, actor: OrgActor) => {
    const res = await app.request(url, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), "x-user": actor.userId },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return {
    app,
    registry,
    run: (key, subject, params = {}, actor = { userId: "boss" }, extra = {}) =>
      send(
        `${base}/${key}/runs`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subject,
            params,
            ...(actor.sessionId !== undefined ? { sessionId: actor.sessionId } : {}),
            ...(actor.agentId !== undefined ? { agentId: actor.agentId } : {}),
            ...extra,
          }),
        },
        actor,
      ),
    get: (suffix, actor = { userId: "boss" }) => {
      const q = new URLSearchParams();
      if (actor.sessionId !== undefined) q.set("sessionId", actor.sessionId);
      if (actor.agentId !== undefined) q.set("agentId", actor.agentId);
      const claims = q.toString();
      const sep = suffix.includes("?") ? "&" : "?";
      // The listing is `…/actions`, `…/actions?subject=`: no trailing slash.
      const rest = suffix === "/" ? "" : suffix.startsWith("/?") ? suffix.slice(1) : suffix;
      return send(
        `${base}${rest}${claims === "" ? "" : `${sep}${claims}`}`,
        { method: "GET" },
        actor,
      );
    },
  };
}
