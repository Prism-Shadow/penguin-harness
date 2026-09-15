/**
 * The plugin contract: what a plugin package compiles against.
 *
 * Types, plus the five decorators — the same ones the harness's own modules are written
 * with (core kernel/decorators.ts: no imports, so a plugin's bundle carries them and
 * nothing else of the SDK). The host that drives a plugin lives in whatever embeds this
 * SDK (for the harness, `@prismshadow/penguin-server/plugin`); a plugin reaches THAT with
 * `import type` only and stays a self-contained library that happens to satisfy an
 * interface.
 *
 * A plugin is an npm package; what it carries is what it ships. Its MODULES — the same
 * unit the harness itself is built from — are written the same way: a `@Component` (or
 * `@Module`) class whose `@Use` / `@Provide` / `@Bind` fields are its requirements,
 * provisions and contribution code halves. Their manifests are GENERATED, not written:
 * the package's build runs `scripts/gen-ifaces.mjs` over its own tsconfig and ships the
 * resulting `ifaces.json` beside its `package.json` — the same table the harness
 * generates for itself, holding the manifest of every decorated class and the signature
 * of every interface they name. That table IS the module payload: the host reads it
 * without executing the package, and the package's default export names the classes to
 * boot. A package without one ships no modules.
 *
 *   // package.json
 *   "files": ["dist", "ifaces.json"],
 *   "scripts": { "build": "node ../../scripts/gen-ifaces.mjs --project tsconfig.json --out ifaces.json && tsup" }
 *   // src/index.ts
 *   @Component({ contributes: { "SandboxModule.providers": [{ id: "sandbox-bwrap.provider", name: "penguin-bwrap", dimensions: ["fs-write", "network", "mask-paths"] }] } })
 *   export class SandboxBwrap {
 *     @Bind("sandbox-bwrap.provider") provider!: SandboxProviderSource;
 *     setup() { this.provider = createProvider(); }
 *   }
 *   export default { modules: [SandboxBwrap] } satisfies Plugin;
 *
 * The modules boot as children of the host's tree, once per App creation — the
 * packaged boot and each hot-swap boot alike — so what a module registers never
 * survives into a generation it did not register with. What it may require is what the
 * host publishes as interfaces (for the harness: everything under
 * `@prismshadow/penguin-server/plugin`); the requirement is checked structurally,
 * at signature level, before the module is created.
 */
import type { ModuleClass } from "../kernel/decorators.js";

export type { ClassCtx } from "../kernel/module.js";
export type { ComponentMeta, ModuleClass, ModuleMeta } from "../kernel/decorators.js";
export { Bind, Component, Module, Provide, Use } from "../kernel/decorators.js";
export type { Opaque, Slot } from "../kernel/markers.js";
export { Interface } from "../kernel/markers.js";

export type * from "./sandbox.js";
export type * from "./surfaces.js";

/**
 * What a plugin package's default export is.
 *
 * `modules` ADD nodes under the host's root. `replaces` STAND IN for nodes the host
 * already has, by name — any node: a component, a module, a whole group with its
 * children — a class of the replaced node's NAME, whose manifest in the package's
 * `ifaces.json` declares its own requires / provides / contributes / children / exports.
 * Nothing about a replacement is checked when it is put in place; the tree it results
 * in is checked as one, before any node runs — every requirement resolved at signature
 * level, every provision present on the instance — so a replacement that offers less
 * than its consumers need is refused by name, and the App does not boot.
 */
export interface Plugin {
  modules?: readonly ModuleClass[];
  replaces?: readonly ModuleClass[];
}
