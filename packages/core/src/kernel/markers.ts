/**
 * Type-level markers the interface generator (scripts/gen-ifaces.mjs) recognizes in a
 * package. They exist only to be projected; at runtime they are the types
 * they wrap.
 */

/**
 * A host object compared by NAME across the push boundary: `Opaque<"AbortSignal">`
 * projects to `{ opaque: "AbortSignal" }`. The generator refuses an unmarked class type
 * — writing this out is how a declaration says "structure not checked here".
 */
export type Opaque<Name extends string, T = unknown> = T & { readonly __opaque?: Name };

/**
 * An interface as a CLASS: `abstract class Db extends Interface<{ prepare(sql: string): … }>() {}`
 * has exactly the instance type it is given and is also a runtime value, so a manifest
 * names it by reference (`requires: { db: [Db, RuntimeModule] }`) instead of by string.
 * Nothing is ever constructed from it and nothing is checked by `instanceof`: the check
 * is structural (kernel/sig.ts); the class is only the handle. The generator projects
 * the instance type like any other interface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Interface<T>(): abstract new () => T {
  return class {} as unknown as abstract new () => T;
}

/**
 * A contribution slot with a CODE half: the data one contribution carries in the manifest,
 * and the implementation the contributor binds by id. A slot written as a plain object type
 * is data-only.
 */
export interface Slot<Data, Code = never> {
  data: Data;
  code: Code;
}
