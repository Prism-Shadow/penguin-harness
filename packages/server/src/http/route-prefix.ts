/**
 * How a contributed prefix claims paths — a WebSocket endpoint's (`HttpModule.upgrades`) and,
 * for the runtime's check in front of the seam, an own-origin route group's: segment by segment,
 * the path itself and everything below it, never a sibling that merely starts with the same
 * letters (`/pair` does not cover `/pairings`). A `:name` segment stands for any one non-empty
 * segment, as it does in a route group's Hono prefix (`/api/projects/:projectId/hooks`). A
 * trailing slash on either side is not significant.
 *
 * Hono's other pattern forms — a wildcard `*`, a regular-expression parameter `:id{[0-9]+}`, an
 * optional `:id?` — have no single reading here. {@link prefixPatternProblem} names them so a
 * declaration that must be exact (an endpoint) can be refused, and {@link coversPath} reads any
 * segment that carries one as matching every segment, so a declaration that only widens a
 * check another layer repeats (the runtime's own-origin pre-check) errs toward letting through.
 */

const segmentsOf = (path: string): string[] => path.split("/").filter((s) => s !== "");

const isPattern = (segment: string): boolean => segment.startsWith(":") || segment.includes("*");

export function coversPath(prefix: string, path: string): boolean {
  const want = segmentsOf(prefix);
  const got = segmentsOf(path);
  if (want.length > got.length) return false;
  return want.every((segment, i) => (isPattern(segment) ? true : segment === got[i]));
}

/** Why `prefix` cannot be matched exactly (a pattern form other than `:name`); null when it can. */
export function prefixPatternProblem(prefix: string): string | null {
  for (const segment of segmentsOf(prefix)) {
    if (segment.includes("*")) return `the wildcard in '${segment}'`;
    if (segment.startsWith(":") && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      return `the parameter pattern '${segment}' (only a plain ':name' is matched)`;
    }
  }
  return null;
}

/**
 * The entries whose prefix covers `path` most specifically — several when they tie. More
 * segments is more specific, then more literal segments: `/api/rooms/lobby` over
 * `/api/rooms/:room` over `/api/rooms`.
 */
export function mostSpecific<T extends { prefix: string }>(
  entries: readonly T[],
  path: string,
): T[] {
  const rank = (prefix: string): [number, number] => {
    const segments = segmentsOf(prefix);
    return [segments.length, segments.filter((s) => !isPattern(s)).length];
  };
  let best: [number, number] = [-1, -1];
  let found: T[] = [];
  for (const entry of entries) {
    if (!coversPath(entry.prefix, path)) continue;
    const r = rank(entry.prefix);
    const order = r[0] - best[0] || r[1] - best[1];
    if (order > 0) {
      best = r;
      found = [entry];
    } else if (order === 0) {
      found.push(entry);
    }
  }
  return found;
}
