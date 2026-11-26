/**
 * Whether one page's route lies under another's, by their patterns: the rule a page removal
 * follows to take the pages under the removed one along (page-table.ts `removedPagesOf`), and the
 * one the App Center's nav row follows to stay lit on a system app's pages (lib/system-apps.ts).
 *
 * A pattern lies under a root when it starts with every non-splat segment of the root, so
 * `/agents/:agentId` lies under `/agents` and not the other way round: what lives under
 * a page's URL belongs to that page. A root ending in a splat (`/reports/*`) answers the rest of
 * the URL, its own bare path included, so every pattern whose leading segments match it lies
 * under it, however those name their parameters. A root that is nothing but the splat (home,
 * `*`) or nothing at all (`/`) holds nothing: everything would match it.
 */

/** A route pattern's segments: "/agents/:agentId" → ["agents", ":agentId"]. */
export const routeSegmentsOf = (path: string) => path.split("/").filter((s) => s !== "");

/** Whether the pattern `path` lies under the pattern `root` (a pattern lies under itself). */
export function routeUnder(path: string, root: string): boolean {
  const under = routeSegmentsOf(root);
  if (under.length === 0) return false;
  const splat = under[under.length - 1] === "*";
  const stem = splat ? under.length - 1 : under.length;
  const segments = routeSegmentsOf(path);
  if (stem === 0 || segments.length < stem) return false;
  return under.slice(0, stem).every((s, i) => s === segments[i]);
}
