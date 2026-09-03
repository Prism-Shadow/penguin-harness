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
 * The value `Interface()` returns: a handle that is both a base class and a class
 * decorator, so one call site serves both spellings below. It is a plain function rather
 * than a class because a class cannot be invoked as a decorator without `new`.
 */
export type IfaceHandle<T> = (abstract new () => T) &
  (<C>(target: C, context: ClassDecoratorContext) => C);

/**
 * An interface as a CLASS. It is also a runtime value, so a manifest names it by
 * reference (`requires: { db: [Db, RuntimeModule] }`) instead of by string. Nothing is
 * ever constructed from it and nothing is checked by `instanceof`: the check is
 * structural (kernel/sig.ts); the class is only the handle. The generator projects the
 * instance type like any other interface.
 *
 * Two spellings, for two different things.
 *
 * **The interface declares its own members** — `@Interface()`, and the members are the
 * class's, which is where their doc comments belong:
 *
 * ```ts
 * @Interface()
 * export abstract class Db {
 *   abstract prepare(sql: string): Opaque<"StatementSync", StatementSync>;
 *   abstract close(): void;
 * }
 * ```
 *
 * A decorated class must be exactly a declaration: no heritage, no constructor, no
 * concrete or private member. The generator rejects the rest rather than deciding what
 * belongs in the contract.
 *
 * **The interface IS an existing type** — the base-class form, which the decorator
 * cannot express: TypeScript has no way to carry a decorator's type argument into the
 * instance type, so the members would be invisible to every consumer.
 *
 * ```ts
 * export abstract class Config extends Interface<ServerConfig>() {}
 * ```
 */
export function Interface<T = unknown>(): IfaceHandle<T> {
  // Applied as a decorator it is called with the class and hands it back untouched;
  // named in a heritage clause it is the (never constructed) base. One function does both
  // — a `class {}` would throw "cannot be invoked without 'new'" in the first position.
  function handle(target?: unknown, _context?: unknown): unknown {
    return target;
  }
  return handle as unknown as IfaceHandle<T>;
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
