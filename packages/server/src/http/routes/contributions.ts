/**
 * GET /api/contributions — the web slots' contributions, as data. What a pushed platform
 * or an installed plugin adds to the web app arrives here; the app merges it with its
 * own pages and renders what it has a renderer for.
 */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import { Interface, Bind, Module, Provide, Use } from "@prismshadow/penguin-core/kernel";
import type { Hmr } from "../../hmr/capabilities.js";
import { pluginHostFrom } from "../../plugin/host.js";
import { packageNamed, uiStampOf } from "../../plugin/package.js";
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
  WebWidgetContribution,
  WebWidgetData,
} from "../../api/types.js";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";

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
    renderer: { builtin: string } | { iframe: { src: string } };
  };
  /** A small always-visible widget the web app docks beside the status bar (WebWidgetData). */
  widgets: WebWidgetData;
}

/**
 * A plugin document the server itself serves: `/api/plugins/<package>/ui/<file>`. Only that
 * shape carries a stamp — a contribution pointing anywhere else (another origin, a path the
 * app resolves) is versioned by whoever serves it.
 */
const PLUGIN_UI_SRC = /^\/api\/plugins\/((?:@[^/]+\/)?[^/]+)\/ui\//;

/**
 * A widget whose document is a plugin's own file, with that package's UI stamp on the URL
 * (`?v=`, plugin/package.ts). The dock mounts this frame ahead of the click that opens it
 * (web-app/app-layout.tsx), so its document and the hundreds of files a figure pack loads
 * beside it are fetched once and then served from the browser's cache without a question —
 * while an edit under `ui/` moves the stamp and with it the URL (http/static-files.ts).
 */
function stampedWidget(
  widget: WebWidgetContribution,
  stampOf: (pkg: string) => string | null,
): WebWidgetContribution {
  if (!("iframe" in widget.renderer)) return widget;
  const src = widget.renderer.iframe.src;
  const pkg = PLUGIN_UI_SRC.exec(src)?.[1];
  if (pkg === undefined) return widget;
  const stamp = stampOf(pkg);
  if (stamp === null) return widget;
  const join = src.includes("?") ? "&" : "?";
  return {
    ...widget,
    renderer: {
      iframe: { ...widget.renderer.iframe, src: `${src}${join}v=${encodeURIComponent(stamp)}` },
    },
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
  @Provide() web!: WebShell;
  @Use() private readonly hmr!: Hmr;
  @Bind("web.contributions") contributionsRoutes!: Hono<AppEnv>;
  setup({ contributions }: ClassCtx) {
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
      widgets: collect<WebWidgetContribution>("widgets"),
    };
    // Claimed per call rather than captured, as the ui route does: a hot swap hands the same
    // process a new plugin host.
    const hmr = this.hmr;
    const stampOf = (name: string): string | null => {
      const entries = [...pluginHostFrom(hmr.resources).entries().values()].map((e) => e.file);
      const pkg = packageNamed(entries, name);
      return pkg === null ? null : uiStampOf(pkg.dir);
    };
    const web: WebShell = {
      contributions: () => ({
        ...response,
        widgets: response.widgets.map((w) => stampedWidget(w, stampOf)),
      }),
    };
    this.web = web;
    this.contributionsRoutes = contributionsRoutes({ web });
  }
}
