/**
 * GET /api/contributions — the web slots' contributions, as data. What a pushed platform
 * or an installed plugin adds to the web app arrives here; the app merges it with its
 * own module.json and renders what it has a renderer for.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { Interface } from "@prismshadow/penguin-core/kernel";
import type { ContributionsResponse, RendererRef } from "../../api/types.js";
import { Bind, Module, Provide } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { WebContribution } from "../../api/types.js";

export interface ContributionsRouteDeps {
  web: WebShell;
}

export function contributionsRoutes(deps: ContributionsRouteDeps): Hono<AppEnv> {
  const routes = new Hono<AppEnv>();
  routes.get("/", (c) => c.json(deps.web.contributions()));
  return routes;
}

/**
 * The frontend's slots, declared on the SERVER so a server module (or a plugin) can
 * contribute a page, an Agent settings tab or a Session tab as manifest data. The web
 * app reads them back through GET /api/contributions and renders the ones whose
 * renderer it knows: a `builtin` name from its own registry, or an `iframe`. No code
 * crosses this boundary — only data.
 */

export abstract class WebShell extends Interface<{
  /** Every contribution to the web slots, by slot, in module order. */
  contributions(): ContributionsResponse;
}>() {}

export interface WebShellSlots {
  /** A page: its route, whether it sits in the main nav, whether it is admin-only. */
  pages: { key: string; path: string; nav: "main" | "none"; admin: boolean; renderer: RendererRef };
  /** A tab on the Agent settings page. */
  agentTabs: { key: string; order: number; renderer: RendererRef };
  /** A tab beside a Session's chat (a workflow UI lives here). */
  sessionTabs: { key: string; renderer: RendererRef };
}

@Module({
  contributes: {
    "HttpModule.routes": [
      {
        id: "web.contributions",
        prefix: "/api/contributions",
        auth: "user",
        order: 65,
      },
    ],
  },
})
export class WebModule {
  @Provide() web!: WebShell;
  @Bind("web.contributions") contributionsRoutes!: Hono<AppEnv>;
  setup({ contributions }: ClassCtx) {
    const collect = (slot: string): WebContribution[] =>
      (contributions[slot] ?? []).map(
        (c) => ({ id: c.id, from: c.from, ...c.data }) as WebContribution,
      );
    const response: ContributionsResponse = {
      pages: collect("pages"),
      agentTabs: collect("agentTabs"),
      sessionTabs: collect("sessionTabs"),
    };
    const web: WebShell = { contributions: () => response };
    this.web = web;
    this.contributionsRoutes = contributionsRoutes({ web });
  }
}
