/**
 * The page on screen as its route's pattern — "/chat/:sessionId", "/org/:projectId/:orgId/chart"
 * — from a data router's matches: what a problem report names as the page, since the address
 * itself carries a Session's, a Project's or a machine's ids. Null when nothing matched.
 */
export function routePattern(matches: readonly { route: { path?: string } }[]): string | null {
  let pattern = "";
  for (const { route } of matches) {
    const path = route.path;
    if (path === undefined || path === "") continue;
    // An absolute path starts over; a relative one continues its parent's.
    pattern = path.startsWith("/") ? path : `${pattern.replace(/\/$/, "")}/${path}`;
  }
  return pattern === "" ? null : pattern;
}
