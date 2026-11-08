export * from "../../lib/company-nav";

/**
 * The company-mode pages a plugin contributes (`nav: "org"` in the page table): the nav rows
 * after the organization's six, each keyed by what the contribution names, so the label
 * (`S.nav.org.<label>`) and the glyph (company-nav-icons.ts) are this build's and the
 * contribution only says that the page exists. A page this build draws itself is named by its
 * builtin renderer (`kind: "builtin"`); a page the plugin serves itself in an iframe is named by
 * its key (`kind: "iframe"`) — the two never stand in for each other. `segment` is the route's
 * first segment under `/org/:projectId/:orgId/`, where the row leads; the page's own params
 * (`proposals/:number?`) come after it.
 *
 * The entries' order is the rows' order. Contribution order cannot say it — it is the Project's
 * `[plugins]` order, the order the plugins happen to be listed and loaded in — so the build does,
 * as it does the label and the glyph. The roadmaps page (key `roadmaps`) has no row here: its
 * roadmaps are the sidebar's own ROADMAPS section, below the channels (features/company/roadmaps.ts).
 */
export const ORG_PAGE_RENDERERS = {
  OrgProposalsPage: { label: "proposals", segment: "proposals", kind: "builtin" },
} as const satisfies Record<string, { label: string; segment: string; kind: "builtin" | "iframe" }>;
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
  return `${ORG_ROUTE_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(orgId)}/${segment}`;
}

/** One contributed company-mode page as a nav row: its renderer (the label's and glyph's key) and where it leads. */
export interface OrgPageRow {
  key: string;
  renderer: OrgPageRenderer;
  /** Null while company mode has no organization, which renders the row disabled. */
  to: string | null;
}

/** Each renderer's place among the rows: its position in ORG_PAGE_RENDERERS. */
const ORG_PAGE_RANK: ReadonlyMap<string, number> = new Map(
  Object.keys(ORG_PAGE_RENDERERS).map((renderer, rank) => [renderer, rank]),
);

/**
 * The nav rows of the contributed company-mode pages this build can draw, in ORG_PAGE_RENDERERS
 * order — never in contribution order, which follows the Project's `[plugins]` list — and, for
 * two pages with the same renderer, in contribution order (the sort is stable). A page this build has no row for is skipped here: a builtin renderer it does not know
 * (the router skips that one too: no renderer, no route), or an iframe page whose key it has no
 * label and glyph for (routed, but reachable by URL only).
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
    if (page.nav !== "org") continue;
    const builtin = "builtin" in page.renderer;
    const renderer = "builtin" in page.renderer ? page.renderer.builtin : page.key;
    if (!isOrgPageRenderer(renderer)) continue;
    if (ORG_PAGE_RENDERERS[renderer].kind !== (builtin ? "builtin" : "iframe")) continue;
    rows.push({
      key: page.key,
      renderer,
      to:
        org === null
          ? null
          : orgContributedPagePath(org.projectId, org.orgId, orgPageSegment(page.path)),
    });
  }
  return rows.sort((a, b) => ORG_PAGE_RANK.get(a.renderer)! - ORG_PAGE_RANK.get(b.renderer)!);
}

/** Path of one proposal of one organization (the proposals page with that proposal selected). */
export function orgProposalPath(projectId: string, orgId: string, number: number): string {
  return `${orgContributedPagePath(projectId, orgId, "proposals")}/${number}`;
}

/**
 * The mode a conversation page claims when it is entered, the way an organization route claims
 * company mode: the new-chat draft and the user's own conversations are development mode's;
 * an organization's desk or ticket Session is reached from both modes and claims neither
 * (null) — and so does a Session not resolved yet (`orgSession` null), which is decided once
 * it is.
 */
export function conversationMode(draft: boolean, orgSession: boolean | null): WorkMode | null {
  if (draft) return "dev";
  return orgSession === false ? "dev" : null;
}

