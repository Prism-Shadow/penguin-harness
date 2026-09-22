/**
 * Company mode's navigation manifest and route grammar (pure, unit tested): the six page
 * entries in rendered order, the `/org/:projectId/:orgId/<page>` paths they lead to, the
 * `/channels/:channelId` path of a channel, the `<projectId>/<orgId>` key the shell remembers
 * an organization by, where a freshly created one opens and which key the shell becomes
 * current at when it does, and which organization `/org` resolves to when it is opened without
 * naming one (the page it then opens is the overview, the first entry below). The sidebar,
 * the collapsed rail and the router all derive their rows from this file, so the covered
 * range is pinned here (and in the unit tests) rather than duplicated.
 */

/** The two work modes of the shell: development (the default) or company. */
export type WorkMode = "dev" | "company";

/**
 * Company-mode page entries, in rendered order: each key names its route segment, its S.nav
 * label (`S.nav.org.<key>`) and its NAV_ICONS glyph (`NAV_ICONS.org<Key>`). Channels are not
 * among them — they are the sidebar's own list, the way conversations are in development
 * mode, and they live under `/channels/:channelId` rather than behind a nav row.
 */
export const COMPANY_NAV_KEYS = [
  "overview",
  "chart",
  "calendar",
  "tickets",
  "finance",
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

/** The `/org/<projectId>/<orgId>` prefix every surface of one organization hangs off. */
function orgRoot(projectId: string, orgId: string): string {
  return `${ORG_ROUTE_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(orgId)}`;
}

/** Path of one company-mode page of one organization. */
export function orgPagePath(projectId: string, orgId: string, page: CompanyNavKey): string {
  return `${orgRoot(projectId, orgId)}/${page}`;
}

/**
 * The company-mode pages a plugin contributes (`nav: "org"` in the page table): the nav rows
 * after the organization's six, each keyed by the builtin renderer the contribution names, so
 * the label (`S.nav.org.<label>`) and the glyph (company-nav-icons.ts) are this build's and the
 * contribution only says that the page exists. `segment` is the route's first segment under
 * `/org/:projectId/:orgId/`, where the row leads; the page's own params (`proposals/:number?`)
 * come after it.
 */
export const ORG_PAGE_RENDERERS = {
  OrgProposalsPage: { label: "proposals", segment: "proposals" },
} as const;
export type OrgPageRenderer = keyof typeof ORG_PAGE_RENDERERS;

/** Whether a contributed page's renderer is one the company layout knows a row for. */
export function isOrgPageRenderer(name: string): name is OrgPageRenderer {
  return Object.hasOwn(ORG_PAGE_RENDERERS, name);
}

/** The first segment of a contributed page's relative path — the row's destination, with the page's own params (`:number?`) left off. */
export function orgPageSegment(path: string): string {
  return path.replace(/^\/+/, "").split("/")[0] ?? "";
}

/** Path of one contributed company-mode page of one organization, by its route's first segment. */
export function orgContributedPagePath(projectId: string, orgId: string, segment: string): string {
  return `${orgRoot(projectId, orgId)}/${segment}`;
}

/** One contributed company-mode page as a nav row: its renderer (the label's and glyph's key) and where it leads. */
export interface OrgPageRow {
  key: string;
  renderer: OrgPageRenderer;
  /** Null while company mode has no organization, which renders the row disabled. */
  to: string | null;
}

/**
 * The nav rows of the contributed company-mode pages this build can draw, in contribution
 * order. A page whose renderer this build has no row for is skipped here (the router skips it
 * too: no renderer, no route).
 */
export function orgPageRows(
  pages: ReadonlyArray<{
    key: string;
    path: string;
    nav: string;
    renderer: { builtin: string } | { iframe: unknown };
  }>,
  org: { projectId: string; orgId: string } | null,
): OrgPageRow[] {
  const rows: OrgPageRow[] = [];
  for (const page of pages) {
    if (page.nav !== "org" || !("builtin" in page.renderer)) continue;
    const renderer = page.renderer.builtin;
    if (!isOrgPageRenderer(renderer)) continue;
    rows.push({
      key: page.key,
      renderer,
      to:
        org === null
          ? null
          : orgContributedPagePath(org.projectId, org.orgId, orgPageSegment(page.path)),
    });
  }
  return rows;
}

/** Path of one proposal of one organization (the proposals page with that proposal selected). */
export function orgProposalPath(projectId: string, orgId: string, number: number): string {
  return `${orgRoot(projectId, orgId)}/proposals/${number}`;
}

/**
 * Path of one channel of one organization. A channel is reached from the sidebar's list, not
 * from a landing: the organization switcher and a bare `/org/<projectId>/<orgId>` open the
 * overview instead, which is the page that says what the whole organization is doing.
 */
export function orgChannelPath(projectId: string, orgId: string, channelId: string): string {
  return `${orgRoot(projectId, orgId)}/channels/${encodeURIComponent(channelId)}`;
}

/**
 * Where a newly created organization opens: the CEO's desk session, so the conversation
 * about the mission starts in the same click that made the organization, and its overview
 * when no desk session came back with it.
 */
export function orgCreatedPath(created: {
  projectId: string;
  orgId: string;
  ceoDeskSessionId?: string;
}): string {
  return created.ceoDeskSessionId !== undefined
    ? `/chat/${created.ceoDeskSessionId}`
    : orgPagePath(created.projectId, created.orgId, "overview");
}

/**
 * What the shell adopts when an organization has just been created: the
 * `<projectId>/<orgId>` key it becomes current at, and the path it opens. The two travel
 * together because a creation lands in the CEO's desk session, which lives at
 * `/chat/:sessionId` — not one of the organization's own routes, and those routes are the
 * only thing that otherwise announces which organization the shell is inside. Without the
 * key the sidebar would keep listing the previous organization's channels around the
 * conversation the new one just opened.
 */
export function orgCreatedTarget(created: {
  projectId: string;
  orgId: string;
  ceoDeskSessionId?: string;
}): { key: string; path: string } {
  return { key: orgKey(created.projectId, created.orgId), path: orgCreatedPath(created) };
}

/** Whether a location is inside company mode's own routes (a Session's own page is shared by both modes and is not). */
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
