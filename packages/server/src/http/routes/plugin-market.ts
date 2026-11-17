/**
 * The plugin market's curation, for the Web App's plugin market (any signed-in user):
 *   GET /api/plugins/market                        # PluginMarketResponse: hero, selected, art by package name, source
 *   GET /api/plugins/market/asset?path=…&rev=…     # one picture the current document names, as an image
 *
 * The document is the published one once it has answered, else the one embedded in this build
 * (plugin/market.ts). Every picture it names is served by this server from what it fetched and
 * kept (plugin/market-pictures.ts), never by the page from another host. The picture route
 * answers only a path the current document names — a cover, its thumbnail, an icon, a screenshot
 * — so it is not a proxy: any other path is 404 and nothing is fetched. A picture that cannot be
 * had is 404 too, which the page answers with the cover it draws itself. `rev` is only the
 * picture's cache key.
 *
 * A component of its own beside PluginRegistryRoutes: the market reads none of the index's state,
 * and a plugin's rows are matched to its art by package name in the page.
 */
import { Hono } from "hono";
import { ICON_CONTENT_TYPES } from "@prismshadow/penguin-core";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx, Json } from "@prismshadow/penguin-core/kernel";
import type { AppEnv } from "../../auth/middleware.js";
import type { Config, Log } from "../../hmr/capabilities.js";
import {
  marketPicturePaths,
  marketResponse,
  marketSource,
  parseMarketDocument,
  resolvePluginMarketUrl,
} from "../../plugin/market.js";
import type { MarketSnapshot, MarketSource } from "../../plugin/market.js";
import { marketPictureDir, marketPictures } from "../../plugin/market-pictures.js";
import type { MarketPicture, MarketPictures } from "../../plugin/market-pictures.js";
import { errorBody } from "../errors.js";

/** The headers a picture is answered with, beside its content type. */
const PICTURE_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "private, max-age=86400",
};

function pictureResponse(picture: MarketPicture): Response {
  return new Response(new Uint8Array(picture.bytes), {
    status: 200,
    headers: { "Content-Type": ICON_CONTENT_TYPES[picture.format], ...PICTURE_HEADERS },
  });
}

/** The two routes over a document source and a picture cache (both built by the caller). */
export function pluginMarketRoutes({
  source,
  pictures,
}: {
  source: MarketSource;
  pictures: MarketPictures;
}): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", async (c) => c.json(marketResponse(await source.read())));
  // The refusals are answered here rather than thrown: an `<img>` asks for these, and a 404 is
  // the ordinary outcome the page draws its own cover for, not an error to record.
  app.get("/asset", async (c) => {
    const path = c.req.query("path");
    if (path === undefined || path === "") {
      return c.json(errorBody("bad_request", "path is required"), 400);
    }
    const { document } = await source.read();
    if (!marketPicturePaths(document).has(path)) {
      return c.json(errorBody("not_found", "The plugin market names no such picture."), 404);
    }
    // Either document's paths sit beside the published one, of which the embedded is a copy. With
    // the published document off there is nowhere to fetch from, and nothing was ever kept.
    let url: string | null = null;
    if (source.url !== null) {
      try {
        url = new URL(path, source.url).href;
      } catch {
        url = null;
      }
    }
    const picture = url === null ? null : await pictures.get(url);
    if (picture === null) {
      return c.json(
        errorBody("market_picture_unavailable", "The picture could not be fetched."),
        404,
      );
    }
    return pictureResponse(picture);
  });
  return app;
}

/** A parked document read again: the parser decides what a previous App left, as for any source. */
function reseed(parked: unknown): MarketSnapshot | null {
  if (typeof parked !== "object" || parked === null) return null;
  const { at, document } = parked as { at?: unknown; document?: unknown };
  if (typeof at !== "number") return null;
  try {
    return { at, document: parseMarketDocument(document, "a previous App") };
  } catch {
    return null;
  }
}

/**
 * The market's routes, deployment-global like the plugin index. The published document rides a
 * hot push the way the index does: the successor starts from what the last App fetched, so a
 * refresh that fails right after the push still answers with it.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "PluginMarketRoutes.routes", prefix: "/api/plugins/market", auth: "user", order: 68 },
    ],
  },
  context: {
    version: 1,
    schema: { "market?": { at: "number", document: "unknown" } },
  },
})
export class PluginMarketRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly log!: Log;
  @Bind("PluginMarketRoutes.routes") routes!: Hono<AppEnv>;
  private source: MarketSource | null = null;

  setup(_ctx: ClassCtx, context: Json) {
    // A runtime older than PENGUIN_PLUGIN_MARKET publishes no `pluginMarketUrl`: the variable is
    // then read from this process's own environment, so `off` holds on that runtime too.
    const url =
      this.config.pluginMarketUrl !== undefined
        ? this.config.pluginMarketUrl
        : resolvePluginMarketUrl(process.env.PENGUIN_PLUGIN_MARKET);
    const proxy = () => this.config.pluginProxy ?? [];
    const log = (line: string) => this.log.line(line);
    this.source = marketSource({
      url,
      proxy,
      seed: reseed((context as { market?: unknown } | null)?.market),
      onFailure: (message) => log(`[plugin-market] ${message}`),
    });
    this.routes = pluginMarketRoutes({
      source: this.source,
      pictures: marketPictures({ dir: marketPictureDir(this.config.root), proxy, log }),
    });
  }

  park(): Json {
    const market = this.source?.snapshot() ?? null;
    return market === null ? null : ({ market } as unknown as Json);
  }
}
