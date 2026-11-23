/**
 * GET /api/contributions — the web slots' contributions, as data, and the start page's
 * contributed counts (`startMetrics`, routes/start-page.ts). What a pushed platform or an
 * installed plugin adds to the web app arrives here; the app merges it with its own pages and
 * renders what it has a renderer for. It also names the server modules plugins run in this
 * generation (`modules`), which is how the app knows to draw a plugin's web half.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { Interface, Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Hmr } from "../../hmr/capabilities.js";
import { pluginHostFrom, runningPluginModules } from "../../plugin/host.js";
import type {
  ContributionsResponse,
  RendererRef,
  WebContribution,
  WebFileRendererContribution,
  WebFileRendererData,
  WebPageContribution,
  WebPageData,
  WebPageRemovalContribution,
  WebPageRemovalData,
} from "../../api/types.js";
import type { WorkbenchTabRenderer } from "@prismshadow/penguin-library-workbench";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { StartPage } from "./start-page.js";

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
 * contribute a page, a page removal, a file renderer, an Agent settings tab or a Session tab
 * as manifest data. The web app reads them back through GET /api/contributions and renders
 * the ones whose renderer it knows: a `builtin` name from its own registry, or an `iframe`.
 * No code crosses this boundary — only data.
 */

@Interface()
export abstract class WebShell {
  /** Every contribution to the web slots, by slot, in module order. */
  abstract contributions(): ContributionsResponse;
}

export interface WebShellSlots {
  /** A page (WebPageData says what each field means). */
  pages: WebPageData;
  /** Linked Workspace file renderer data. */
  fileRenderers: WebFileRendererData;
  /** A page the web app drops, its own or a contributed one (WebPageRemovalData). */
  pageRemovals: WebPageRemovalData;
  /** A tab on the Agent settings page. */
  agentTabs: { key: string; order: number; renderer: RendererRef };
  /**
   * A tab beside a Session's chat. A workbench contributes here too, from its own tree, where
   * the host publishes this slot under this module's name and scopes the tab to its Agent.
   */
  sessionTabs: {
    key: string;
    title: string;
    titleZh?: string;
    renderer: WorkbenchTabRenderer;
    /**
     * The launcher label when the tab installs as its own app (`/app/…/<key>`): overrides
     * the title for the PWA manifest's short_name. Absent or blank it means the title.
     */
    shortName?: string;
    /**
     * The tab's app icon, optional: an SVG's markup or a PNG's bytes base64-encoded. The
     * FIRST tab that names one is the workbench's PWA app icon (what installing carries);
     * the tab strip itself draws no icon.
     */
    icon?: { kind: "svg" | "png"; data: string };
  };
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
  @Use() private readonly hmr!: Hmr;
  /** The start page's counts ride the same answer (routes/start-page.ts). */
  @Use() private readonly startPage!: StartPage;
  @Provide() web!: WebShell;
  @Bind("web.contributions") contributionsRoutes!: Hono<AppEnv>;
  setup({ contributions }: ClassCtx) {
    const hmr = this.hmr;
    // The kernel checked each contribution's data against its slot's type at boot.
    const collect = <T extends WebContribution>(slot: string): T[] =>
      (contributions[slot] ?? []).map(
        // The contribution's own fields first: `id` and `from` are the server's attribution,
        // and a data field of the same name must not replace them.
        (c) => ({ ...c.data, id: c.id, from: c.from }) as T,
      );
    const response: ContributionsResponse = {
      pages: collect<WebPageContribution>("pages"),
      fileRenderers: collect<WebFileRendererContribution>("fileRenderers"),
      pageRemovals: collect<WebPageRemovalContribution>("pageRemovals"),
      agentTabs: collect("agentTabs"),
      sessionTabs: collect("sessionTabs"),
      startMetrics: this.startPage.metrics(),
    };
    // The host is claimed per call: what the boot left out is recorded on it after this setup.
    const web: WebShell = {
      contributions: () => ({
        ...response,
        modules: runningPluginModules(pluginHostFrom(hmr.resources)),
      }),
    };
    this.web = web;
    this.contributionsRoutes = contributionsRoutes({ web });
  }
}
