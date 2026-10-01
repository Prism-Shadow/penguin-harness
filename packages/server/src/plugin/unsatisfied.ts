/**
 * Boots a module tree without the installed plugins it cannot satisfy.
 *
 * A hot push replaces the platform but leaves the installed plugins where they are, so a
 * platform can meet a plugin built against slots or interfaces it does not carry (a plugin
 * from a newer line contributing to a module this build lacks, say). Rejecting the whole
 * tree for that would let one plugin refuse every push; instead a contribution to a slot this
 * platform lacks is dropped (the plugin stays), the plugins any other problem is traced to are
 * left out of this generation, both are named in the log, and the rest boots. The
 * plugin host is not changed: the next generation tries the same plugins again, so a build
 * that carries their slots runs them as before. Any problem that is not traced to a plugin
 * still rejects the tree as it always did.
 */
import {
  ModuleBootError,
  type ModuleDef,
  type ModuleTree,
  type Problem,
} from "@prismshadow/penguin-core/kernel";
import type { LoadedPlugin } from "./host.js";

/** What `boot` is given: the plugin modules and stand-ins left in. */
export interface PluginSelection {
  modules: ModuleDef[];
  replacements: ReadonlyMap<string, ModuleDef>;
}

/**
 * The plugins (by specifier) that every problem is traced to, or null when some problem is
 * not a plugin's. A problem is a plugin's when a segment of its module path, or the module it
 * names (`from`, `other`), is one of that plugin's modules or stand-ins.
 */
export function pluginsBehind(
  problems: readonly Problem[],
  plugins: readonly LoadedPlugin[],
): Set<string> | null {
  const owner = new Map<string, string>();
  for (const p of plugins) {
    for (const m of [...p.modules, ...p.replaces]) owner.set(m.manifest.name, p.specifier);
  }
  const found = new Set<string>();
  for (const problem of problems) {
    const names = problem.path.split("/").filter((s) => s !== "");
    if ("from" in problem) names.push(problem.from);
    if ("other" in problem) names.push(...problem.other.split("/").filter((s) => s !== ""));
    const hit = names.map((n) => owner.get(n)).find((s) => s !== undefined);
    if (hit === undefined) return null;
    found.add(hit);
  }
  return found.size > 0 ? found : null;
}

/** Problems that only concern one contribution, which the tree can boot without. */
const CONTRIBUTION_KINDS = new Set<Problem["kind"]>(["no-such-slot", "bad-contribution"]);

/** `def` (and its children) without the contributions `drop` names, by module then slot key. */
function stripped(def: ModuleDef, drop: ReadonlyMap<string, ReadonlySet<string>>): ModuleDef {
  const gone = drop.get(def.manifest.name);
  const children = def.children?.map((c) => stripped(c, drop));
  if (gone === undefined && children === undefined) return def;
  const contributes =
    gone === undefined
      ? def.manifest.contributes
      : Object.fromEntries(
          Object.entries(def.manifest.contributes).filter(([slotKey]) => !gone.has(slotKey)),
        );
  return { ...def, manifest: { ...def.manifest, contributes }, ...(children ? { children } : {}) };
}

/**
 * `boot` with every plugin, then — while it is rejected for problems that are all traced to
 * plugins — again: a contribution to a slot this platform does not declare (or of a shape it
 * does not take) is dropped, since nothing here would consume it, and the plugin stays; any
 * other problem leaves the whole plugin out. Returns the tree and the plugins left out, each
 * with the rejection that named it; dropped contributions are logged.
 */
export async function bootWithoutUnsatisfied(
  plugins: readonly LoadedPlugin[],
  boot: (selection: PluginSelection) => Promise<ModuleTree>,
): Promise<{ tree: ModuleTree; left: Map<string, string> }> {
  const left = new Map<string, string>();
  const drop = new Map<string, Set<string>>();
  for (;;) {
    const kept = plugins.filter((p) => !left.has(p.specifier));
    try {
      const tree = await boot({
        modules: kept.flatMap((p) => p.modules.map((m) => stripped(m, drop))),
        replacements: new Map(
          kept.flatMap((p) => p.replaces.map((m) => [m.manifest.name, stripped(m, drop)])),
        ),
      });
      for (const [module, slots] of drop) {
        console.warn(
          `[platform] plugin module '${module}': contributions to ${[...slots].join(", ")} dropped — this platform does not declare those slots`,
        );
      }
      return { tree, left };
    } catch (err) {
      if (!(err instanceof ModuleBootError)) throw err;
      if (pluginsBehind(err.problems, kept) === null) throw err;
      let progressed = false;
      for (const problem of err.problems) {
        const module =
          problem.path
            .split("/")
            .filter((s) => s !== "")
            .at(-1) ?? "";
        if (CONTRIBUTION_KINDS.has(problem.kind) && "slotKey" in problem) {
          const isPlugin = pluginsBehind([problem], kept) !== null;
          const slots = drop.get(module) ?? new Set<string>();
          if (isPlugin && !slots.has(problem.slotKey)) {
            slots.add(problem.slotKey);
            drop.set(module, slots);
            progressed = true;
            continue;
          }
        }
        for (const specifier of pluginsBehind([problem], kept) ?? []) {
          if (!left.has(specifier)) {
            left.set(specifier, err.message);
            progressed = true;
          }
        }
      }
      if (!progressed) throw err;
    }
  }
}
