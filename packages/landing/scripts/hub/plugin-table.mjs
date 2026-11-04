/**
 * What a plugin package declares for the plugin library, read from its built table: the
 * `ifaces.json` its `build` (`gen-ifaces`) writes beside its `package.json`. A plugin declares its
 * card, Skills, hook package, MCP servers and Workbenches as contributions of its own modules to
 * the five slots of `PluginLibraryModule` (RFC-0003); only the modules its default export
 * names (`plugin.modules`, `plugin.replaces`) count, with their children. The site reads the
 * entries as written: the server's reader checks them field by field, and a shipped plugin whose
 * entries do not check fails its own tests before it reaches the site.
 *
 * The tables are build output, so the landing lists every plugin package as a `workspace:*`
 * devDependency: pnpm then builds them before the landing, in `pnpm -r build` and in a CI shard
 * that builds `landing...` alike. A new plugin joins that list.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const IFACES_FILE = "ifaces.json";

const SLOT = {
  cards: "PluginLibraryModule.cards",
  skills: "PluginLibraryModule.skills",
  hooks: "PluginLibraryModule.hooks",
  workbenches: "PluginLibraryModule.workbenches",
};

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The library entries of the package at `dir`, by slot: `{ card, skills, hooks, workbenches }`
 * (`card` and `hooks` are the first entry or undefined, the others lists). Throws, naming the
 * file, when the package was never built or its table is not the generator's.
 */
export function readLibraryEntries(dir) {
  const file = join(dir, IFACES_FILE);
  if (!existsSync(file)) {
    throw new Error(
      `${file}: missing; build the plugins first (pnpm -r --filter './plugins/**' build)`,
    );
  }
  let table;
  try {
    table = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`${file}: not valid JSON`);
  }
  if (!isRecord(table) || !isRecord(table.modules)) {
    throw new Error(`${file}: expected the gen-ifaces table ({ ifaces, types, modules, plugin })`);
  }
  const plugin = isRecord(table.plugin) ? table.plugin : {};
  const reached = [];
  const visit = (name) => {
    const manifest = table.modules[name];
    if (reached.includes(name) || !isRecord(manifest)) return;
    reached.push(name);
    for (const child of Array.isArray(manifest.children) ? manifest.children : []) {
      visit(typeof child === "string" ? child : child?.keyed);
    }
  };
  for (const name of [
    ...(Array.isArray(plugin.modules) ? plugin.modules : []),
    ...(Array.isArray(plugin.replaces) ? plugin.replaces : []),
  ]) {
    visit(name);
  }
  const entries = (slot) =>
    reached.flatMap((name) => {
      const list = table.modules[name].contributes?.[slot];
      return Array.isArray(list) ? list.filter(isRecord) : [];
    });
  return {
    card: entries(SLOT.cards)[0],
    skills: entries(SLOT.skills),
    hooks: entries(SLOT.hooks)[0],
    workbenches: entries(SLOT.workbenches),
  };
}
