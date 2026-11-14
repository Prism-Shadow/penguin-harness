import type { ModuleDef } from "./module.js";
import type { Decoration, OperatorOrigin, Provision } from "./pass.js";
import { provisionsOf } from "./pass.js";

/** A deferred callback failed after rewriting; the candidate must be rebuilt without its owner. */
export class DecorationError extends Error {
  constructor(
    readonly origin: OperatorOrigin,
    target: Provision,
    phase: "selection" | "wrapping",
    cause: unknown,
  ) {
    super(
      `${origin.pass}/${origin.operator}#${origin.index}: ${phase} '${target.module}.${target.alias}' failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "DecorationError";
  }
}

/** Select on final manifests; runtime wrappers never re-enter target selection. */
export function materializeDecorations(tree: ModuleDef, rules: readonly Decoration[]): ModuleDef {
  if (rules.length === 0) return tree;
  const visit = (node: ModuleDef): ModuleDef => {
    const provisions = provisionsOf(node);
    const selected = rules
      .map((rule) => ({
        rule,
        targets: provisions.filter((target) => {
          try {
            return rule.select(target);
          } catch (cause) {
            throw new DecorationError(rule.origin, target, "selection", cause);
          }
        }),
      }))
      .filter(({ targets }) => targets.length > 0);
    const children = node.children?.map(visit);
    if (
      selected.length === 0 &&
      children?.every((child, i) => child === node.children?.[i]) !== false
    )
      return node;
    return {
      ...node,
      ...(children === undefined ? {} : { children }),
      ...(selected.length === 0
        ? {}
        : {
            async create(ctx, context) {
              const instance = await node.create(ctx, context);
              const api = { ...instance.api };
              for (const { rule, targets } of selected) {
                const before = { ...api };
                const wrapped = new Set<unknown>();
                for (const target of targets) {
                  const value = before[target.alias];
                  if (value === undefined || wrapped.has(value)) continue;
                  let next: unknown;
                  try {
                    next = rule.wrap(value, target);
                  } catch (cause) {
                    throw new DecorationError(rule.origin, target, "wrapping", cause);
                  }
                  wrapped.add(value);
                  // Component aliases often expose the same instance. Keep them coherent.
                  for (const alias of Object.keys(before))
                    if (before[alias] === value) api[alias] = next;
                }
              }
              return { ...instance, api };
            },
          }),
    };
  };
  return visit(tree);
}

export type MethodWrappers<T extends object> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? (original: T[K]) => T[K] : never;
};

/** A facade binds prototype methods and accessors to the original object, including private fields. */
export function wrapMethods<T extends object>(target: T, wrappers: MethodWrappers<T>): T {
  const methods = new Map<PropertyKey, { original: unknown; wrapped: unknown }>();
  const transforms = wrappers as Record<PropertyKey, ((original: unknown) => unknown) | undefined>;
  return new Proxy(Object.create(null) as T, {
    get(_facade, key) {
      const value: unknown = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      const cached = methods.get(key);
      if (cached?.original === value) return cached.wrapped;
      const bound = value.bind(target);
      const wrapped = Object.hasOwn(transforms, key) ? transforms[key]!(bound) : bound;
      methods.set(key, { original: value, wrapped });
      return wrapped;
    },
    set: (_facade, key, value) => Reflect.set(target, key, value, target),
    has: (_facade, key) => Reflect.has(target, key),
    ownKeys: () => Reflect.ownKeys(target),
    getPrototypeOf: () => Reflect.getPrototypeOf(target),
    getOwnPropertyDescriptor(_facade, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      return descriptor === undefined ? undefined : { ...descriptor, configurable: true };
    },
  });
}
