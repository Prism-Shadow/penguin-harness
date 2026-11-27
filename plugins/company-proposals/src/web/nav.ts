/**
 * Organization navigation: the identity an organization carries across Projects, and the
 * `/org/:projectId/:orgId/...` paths its surfaces hang off. Pure, so the pages' suites can
 * stand in for the router.
 */
export const ORG_ROUTE_PREFIX = "/org";

/** An organization's identity across Projects: `<projectId>/<orgId>` (both ids are semantic ids, so `/` never appears inside either). */
export function orgKey(projectId: string, orgId: string): string {
  return `${projectId}/${orgId}`;
}

/** The pair an org key names, or null for anything that is not one (a stale reference, an empty string). */
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
export function orgRoot(projectId: string, orgId: string): string {
  return `${ORG_ROUTE_PREFIX}/${encodeURIComponent(projectId)}/${encodeURIComponent(orgId)}`;
}

/** Path of one contributed company-mode page of one organization, by its route's first segment. */
export function orgContributedPagePath(projectId: string, orgId: string, segment: string): string {
  return `${orgRoot(projectId, orgId)}/${segment}`;
}

/** Path of one proposal of one organization (the proposals page with that proposal selected). */
export function orgProposalPath(projectId: string, orgId: string, number: number): string {
  return `${orgRoot(projectId, orgId)}/proposals/${number}`;
}

/** Path of one channel of one organization. */
export function orgChannelPath(projectId: string, orgId: string, channelId: string): string {
  return `${orgRoot(projectId, orgId)}/channels/${encodeURIComponent(channelId)}`;
}
