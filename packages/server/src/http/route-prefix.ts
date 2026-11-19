/**
 * How a contributed prefix claims paths — a route group's (`HttpModule.routes`) and a WebSocket
 * endpoint's (`HttpModule.upgrades`) alike: the path itself and everything below it, never a
 * sibling that merely starts with the same letters (`/pair` does not cover `/pairings`). A
 * trailing slash on either side is not significant.
 */

const trimmed = (path: string): string => path.replace(/\/+$/, "");

export function coversPath(prefix: string, path: string): boolean {
  const p = trimmed(prefix);
  const target = trimmed(path);
  return target === p || target.startsWith(`${p}/`);
}

/** The entries whose prefix covers `path` most specifically — several when they share that prefix. */
export function mostSpecific<T extends { prefix: string }>(
  entries: readonly T[],
  path: string,
): T[] {
  let best = -1;
  let found: T[] = [];
  for (const entry of entries) {
    if (!coversPath(entry.prefix, path)) continue;
    const length = trimmed(entry.prefix).length;
    if (length > best) {
      best = length;
      found = [entry];
    } else if (length === best) {
      found.push(entry);
    }
  }
  return found;
}
