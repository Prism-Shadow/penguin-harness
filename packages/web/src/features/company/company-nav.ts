/**
 * Company mode's navigation manifest and route grammar (pure, unit tested): the seven page
 * entries in rendered order, the `/org/:projectId/:orgId/<page>` paths they lead to, the
 * `<projectId>/<orgId>` key the shell remembers an organization by, and where `/org` lands
 * when it is opened without naming an organization. The sidebar, the collapsed rail and the
 * router all derive their rows from this file, so the covered range is pinned here (and in
 * the unit tests) rather than duplicated.
 */

/** The two work modes of the shell: development (the default) or company. */
export type WorkMode = "dev" | "company";

/** Company-mode page entries, in rendered order: each key names its route segment, its S.nav label (`S.nav.org.<key>`) and its NAV_ICONS glyph (`NAV_ICONS.org<Key>`). */
export const COMPANY_NAV_KEYS = [
  "overview",
  "chart",
  "calendar",
  "tickets",
  "finance",
  "chat",
  "handbook",
] as const;
export type CompanyNavKey = (typeof COMPANY_NAV_KEYS)[number];

/** The route prefix every company-mode page lives under. */
export const ORG_ROUTE_PREFIX = "/org";

/** An organization's identity across Projects: `<projectId>/<orgId>` (both ids are semantic ids, so `/` never appears inside either). */
export function orgKey(projectId: string, orgId: string): string {
  return `${projectId}/${orgId}`;
}

/** The pair an org key names, or null for anything that is not one (a stale preference, an empty string). */
export function parseOrgKey(
  key: string | null | undefined,
): { projectId: string; orgId: string } | null {
  if (!key) return null;
  const at = key.indexOf("/");
  if (at <= 0 || at === key.length - 1) return null;
  const projectId = key.slice(0, at);
  const orgId = key.slice(at + 1);
  if (orgId.includes("/")) return null;
  return { projectId, orgId };
}

/** Path of one company-mode page of one organization. */
export function orgPagePath(projectId: string, orgId: string, page: CompanyNavKey): string {
  return `${ORG_ROUTE_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(orgId)}/${page}`;
}

/** Whether a location is inside company mode's own routes (the chat page is shared by both modes and is not). */
export function isOrgRoute(pathname: string): boolean {
  return pathname === ORG_ROUTE_PREFIX || pathname.startsWith(`${ORG_ROUTE_PREFIX}/`);
}

/**
 * Where `/org` lands when it names no organization: the one last opened if it still exists,
 * else the first organization of the current Project, else the first organization anywhere —
 * and null when the user has none, which is the empty landing's cue to offer creating one.
 */
export function resolveOrgLanding<T extends { projectId: string; orgId: string }>(
  lastOrgKey: string | null | undefined,
  organizations: readonly T[],
  currentProjectId: string | null,
): T | null {
  const last = parseOrgKey(lastOrgKey);
  if (last) {
    const found = organizations.find(
      (o) => o.projectId === last.projectId && o.orgId === last.orgId,
    );
    if (found) return found;
  }
  if (currentProjectId !== null) {
    const inProject = organizations.find((o) => o.projectId === currentProjectId);
    if (inProject) return inProject;
  }
  return organizations[0] ?? null;
}

/**
 * Organizations grouped by Project for the switcher, in the order the Projects are listed
 * (the Project list is the user's own order; an organization whose Project is not in the list
 * — a stale cache after losing access — is dropped rather than shown under no heading).
 */
export function groupOrganizationsByProject<T extends { projectId: string }>(
  organizations: readonly T[],
  projectIds: readonly string[],
): Array<{ projectId: string; organizations: T[] }> {
  return projectIds
    .map((projectId) => ({
      projectId,
      organizations: organizations.filter((o) => o.projectId === projectId),
    }))
    .filter((g) => g.organizations.length > 0);
}
