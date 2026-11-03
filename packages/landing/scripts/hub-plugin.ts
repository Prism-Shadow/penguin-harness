/**
 * The Vite plugin behind the Plugins, Benchmarks and Leaderboards pages. It reads the source files
 * at build time (scripts/hub/) and serves them as modules:
 *
 * - `virtual:penguin-hub` — the lists' summaries, plus one loader per detail page;
 * - `virtual:penguin-hub/<kind>/<id>` — one detail record, a chunk of its own, fetched when its
 *   page opens.
 *
 * A build clones penguin-harness-benchmark afresh; the dev server reads the cached clone and
 * reloads the page when a plugin's files change.
 */
import type { Plugin } from "vite";
import { loadHub, PLUGINS_DIR } from "./hub/hub.mjs";

const INDEX = "virtual:penguin-hub";
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
    `export const benchmarks = ${json(hub.index.benchmarks)};`,
    `export const leaderboards = ${json(hub.index.leaderboards)};`,
    ...loaders,
  ].join("\n");
}

export function hubData(): Plugin {
  let hub: Hub | undefined;
  let refresh = false;
  const read = () => (hub ??= loadHub({ refresh }));
  return {
    name: "penguin:hub",
    configResolved(config) {
      refresh = config.command === "build";
    },
    resolveId(id) {
      return id === INDEX || id.startsWith(`${INDEX}/`) ? `\0${id}` : null;
    },
    load(id) {
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
      server.watcher.add(PLUGINS_DIR);
      server.watcher.on("change", (file) => {
        if (!file.startsWith(PLUGINS_DIR)) return;
        hub = undefined;
        for (const module of server.moduleGraph.idToModuleMap.values()) {
          if (module.id?.startsWith(`\0${INDEX}`)) server.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}
