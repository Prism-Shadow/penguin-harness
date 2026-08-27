/**
 * The plugin contract: what a plugin package compiles against.
 *
 * Types only — the host that drives them lives in whatever embeds this SDK (for the
 * harness, `@prismshadow/penguin-server/plugin`). A plugin reaches this module with
 * `import type`, so it carries no runtime dependency on either and stays a
 * self-contained library that happens to satisfy an interface.
 *
 * A plugin is a set of MODULES — the same unit the harness itself is built from
 * (core kernel/module.ts). Each module's static half is a manifest in the package's
 * `package.json#penguin.modules` (requires / provides / contributes / context /
 * children), read and checked by the host without executing the package; its code half
 * is the entry of the same name in the package's default export:
 *
 *   // package.json
 *   "penguin": { "modules": [
 *     { "name": "sandbox-bwrap",
 *       "contributes": { "sandbox.providers": [{ "id": "sandbox-bwrap.provider", "name": "penguin-bwrap", "dimensions": ["fs-write", "network", "mask-paths"] }] } }
 *   ] }
 *   // src/index.ts
 *   export default { modules: { "sandbox-bwrap": { create: () => ({ api: {}, bind: { "sandbox-bwrap.provider": createProvider() } }) } } } satisfies Plugin;
 *
 * The modules boot as children of the host's tree, once per App creation — the
 * packaged boot and each hot-swap boot alike — so what a module registers never
 * survives into a generation it did not register with. What it may require is what the
 * host publishes as interfaces (for the harness: everything under
 * `@prismshadow/penguin-server/plugin`); the requirement is checked structurally,
 * at signature level, before the module is created.
 */
import type { Json, ModuleCtx, ModuleInstance } from "../kernel/index.js";

export type * from "./sandbox.js";
export type * from "./languages.js";

/** One module's code half. Its manifest is the `package.json#penguin.modules` entry of the same name. */
export interface PluginModule {
  /** Context migrations by from-version, chained (1→2→3). */
  migrations?: Record<number, (old: Json) => Json>;
  create(ctx: ModuleCtx, context: Json): ModuleInstance | Promise<ModuleInstance>;
}

/**
 * What a plugin package's default export is.
 *
 * `modules` ADD nodes under the host's root. `replaces` STAND IN for nodes the host
 * already has, by name — any node: a component, a module, a whole group with its
 * children — its manifest (`package.json#penguin.replaces`) keeping the replaced node's
 * name and declaring its own requires / provides / contributes / children / exports.
 * Nothing about a replacement is checked when it is put in place; the tree it results
 * in is checked as one, before any node runs — every requirement resolved at signature
 * level, every provision present on the instance — so a replacement that offers less
 * than its consumers need is refused by name, and the App does not boot.
 */
export interface Plugin {
  modules?: Record<string, PluginModule>;
  replaces?: Record<string, PluginModule>;
}
