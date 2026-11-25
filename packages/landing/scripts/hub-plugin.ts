/**
 * The Vite plugin behind the Plugins, Benchmarks and Leaderboards pages. It reads the source files
 * at build time (scripts/hub/) and serves them as modules:
 *
 * - `virtual:penguin-plugin-featured` — the curated carousel, independent of the directory;
 * - `virtual:penguin-hub` — the lists' summaries and the market's curation, plus one loader per
 *   detail page;
 * - `virtual:penguin-hub/<kind>/<id>` — one detail record, a chunk of its own, fetched when its
 *   page opens.
 *
 * A build clones penguin-harness-benchmark and fetches the published market document and plugin
 * index afresh, before any module is read (hub/published.mjs); the dev server reuses the cached
 * copies and reloads the page when a plugin's files change.
 */
import type { Plugin } from "vite";
import { createRequire } from "node:module";
import { loadHub, PLUGINS_DIR } from "./hub/hub.mjs";
import { fetchPublished } from "./hub/published.mjs";

const INDEX = "virtual:penguin-hub";
const FEATURED = "virtual:penguin-plugin-featured";
const COUNTS = "virtual:penguin-catalog-counts";
const coreRequire = createRequire(new URL("../../core/package.json", import.meta.url));
const KINDS = ["plugin", "benchmark", "leaderboard"] as const;

type Hub = ReturnType<typeof loadHub>;

const json = (value: unknown) => JSON.stringify(value);

function indexModule(hub: Hub): string {
  const loaders = KINDS.map((kind) => {
    const entries = Object.keys(hub.details[kind]).map(
      (id) => `${json(id)}: () => import(${json(`${INDEX}/${kind}/${id}`)})`,
    );
    return `export const ${kind}Details = {${entries.join(",")}};`;
  });
  return [
    `export const plugins = ${json(hub.index.plugins)};`,
    `export const market = ${json(hub.index.market)};`,
    `export const benchmarks = ${json(hub.index.benchmarks)};`,
    `export const leaderboards = ${json(hub.index.leaderboards)};`,
    ...loaders,
  ].join("\n");
}

export function hubData(): Plugin {
  let hub: Hub | undefined;
  let refresh = false;
  let base = "/";
  const read = () => (hub ??= loadHub({ refresh }));
  return {
    name: "penguin:hub",
    configResolved(config) {
      refresh = config.command === "build";
      base = config.base;
    },
    async buildStart() {
      await fetchPublished({ refresh });
    },
    resolveId(id) {
      return id === COUNTS || id === FEATURED || id === INDEX || id.startsWith(`${INDEX}/`)
        ? `\0${id}`
        : null;
    },
    load(id) {
      if (id === `\0${COUNTS}`) {
        const { listSupportedModels } = coreRequire("@prismshadow/mmsp") as {
          listSupportedModels(): { model: string }[];
        };
        const { plugins, benchmarks } = read().index;
        return `export default ${json({
          models: new Set(listSupportedModels().map((entry) => entry.model)).size,
          algorithms: plugins.filter((entry) => entry.category === "rsi").length,
          benchmarks: benchmarks.length,
        })};`;
      }
      if (id === `\0${FEATURED}`) {
        const { market, plugins } = read().index;
        const featured = market.selected.flatMap((id: string) =>
          plugins.filter((plugin) => plugin.id === id),
        );
        const leads = market.hero
          .map((id: string) => featured.findIndex((plugin) => plugin.id === id))
          .filter((index: number) => index >= 0);
        const url = refresh
          ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name: "plugin-directory.json", source: json(plugins) })}`
          : json(`${base}plugin-directory.json`);
        return `export const directoryUrl = ${url}; export const featured = ${json(featured)}; export const leads = ${json(leads)};`;
      }
      if (!id.startsWith(`\0${INDEX}`)) return null;
      const data = read();
      const name = id.slice(1);
      if (name === INDEX) return indexModule(data);
      const [kind, ...rest] = name.slice(INDEX.length + 1).split("/");
      const detail = (data.details as Record<string, Record<string, unknown>>)[kind ?? ""]?.[
        rest.join("/")
      ];
      if (detail === undefined) throw new Error(`[penguin:hub] no ${name}`);
      return `export default ${json(detail)};`;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== `${base}plugin-directory.json`) return next();
        response.setHeader("Content-Type", "application/json");
        response.end(json(read().index.plugins));
      });
      server.watcher.add(PLUGINS_DIR);
      server.watcher.on("change", (file) => {
        if (!file.startsWith(PLUGINS_DIR)) return;
        hub = undefined;
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (
            module.id === `\0${COUNTS}` ||
            module.id === `\0${FEATURED}` ||
            module.id?.startsWith(`\0${INDEX}`)
          )
            server.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}
