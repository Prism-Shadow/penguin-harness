/**
 * The compile's own module: the node that owns pass REGISTRATION. A pass reaches a
 * compile as manifest data — an id, and the ids it runs after — contributed to
 * CompileModule's `passes` slot, exactly the way a route group reaches HttpModule or a
 * settings group reaches the plugin config. The slot lives on the Compile interface
 * (CompileSlots below), so the checker validates every registration against the schema
 * the generator projects — before any code runs, like every other contribution.
 *
 * The CODE half of a pass cannot travel with the data: `bind` hands a contributor its
 * contribution only inside create(), and the compile runs before the first create().
 * So the host resolves an id to its pass when it starts the compile (the pipeline's
 * `resolve` option); a plugin host answers with the factory a plugin bundle exports.
 * What the manifest buys is the part that had no home until now: WHICH passes a tree
 * runs, and in what order, declared where the tree is assembled and checked — not a
 * list inside the booter.
 */
import type { ModuleDef, Slot } from "@prismshadow/penguin-core/kernel";
import { defineModule, Interface } from "@prismshadow/penguin-core/kernel";

/**
 * The compile's interface. It carries no members of its own yet: what it carries is the
 * registration slot (CompileSlots below), so a tree that wants passes declares
 * CompileModule and the registrations become checkable data. A module may still require
 * `Compile` for what later grows here.
 */
@Interface()
export abstract class Compile {}

/** The slots Compile receives — what a module contributes to a compile. */
export interface CompileSlots {
  /**
   * One pass, as data. The entry's `id` is the contribution's id — the checker's
   * per-entry identity, unique in the slot — and the pass's id: the word the host
   * resolves to the pass's code. `after` names the passes this one runs behind, so
   * ordering is declared with the registration and checked as data too. An `after`
   * naming an id no one registered is vacuous — "behind it, if present".
   */
  passes: Slot<{ after?: string[] }>;
}

/** A pass registration as it sits in a manifest (`CompileModule.passes`). */
export interface PassDecl {
  readonly id: string;
  readonly after?: readonly string[];
}

export const COMPILE_MODULE = "CompileModule";
/** The slot key registrations use: `<node>.<slot>`, split and resolved by the checker. */
export const PASSES_SLOT = `${COMPILE_MODULE}.passes`;

/**
 * CompileModule: the node that provides the registration surface. Its api is empty —
 * the slot is the point; the pipeline reads the registrations off the assembled tree's
 * manifests, and this node stands in the tree so the checker has a target to validate
 * them against. Pre-gen note (same as every new module): the table entry for `Compile`
 * — and the `passes` slot beside it — exists only after gen:ifaces runs, so until then
 * the checker reports the provides and this slot as unknown; `typecheck`, the server's
 * `build` and `test` each regenerate the table before it is read.
 *
 * The manifest's `name` is spelled through the `COMPILE_MODULE` constant ON PURPOSE.
 * The generator keys an interface class by the module its file belongs to, and a
 * directory's module name is read from its `module.ts` by a text scan that looks for a
 * defineModule or decorator literal opening with a QUOTED name property — a string
 * literal here would name this directory's module `CompileModule` and re-key `Compile`
 * away from the package key the manifest's provides names below. The constant keeps
 * the scan missing, so the key falls back to the package name — the one the provides
 * string names. (The scan reads this whole file as text, so this comment deliberately
 * avoids spelling the exact shape it matches.)
 */
export const compileModuleDef = (): ModuleDef =>
  defineModule(
    {
      name: COMPILE_MODULE,
      requires: {},
      provides: { compile: "@prismshadow/penguin-server#Compile" },
      contributes: {},
      children: [],
    },
    { create: () => ({ api: { compile: {} } }) },
  );
