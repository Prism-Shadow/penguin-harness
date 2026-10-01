/**
 * A stand-in that forwards to whatever `current()` returns at the moment it is used.
 *
 * What lets one app serve a whole describe while each case keeps a boundary fake of its own:
 * the app boots with the stand-in, and each case swaps the object behind it. Methods are
 * bound to the object they came from, so its private fields answer as they would directly.
 */
export function forwardingTo<T extends object>(current: () => T): T {
  return new Proxy({} as T, {
    get: (_stand, key) => {
      const target = current();
      const value: unknown = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has: (_stand, key) => Reflect.has(current(), key),
  });
}
