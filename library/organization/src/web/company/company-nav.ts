/**
 * Company-mode navigation, the web half's forward of the host's lib/company-nav.ts: the same
 * values and types the feature's own shell exposed before the move, no more — the host seam's
 * other exports (api, useAuth, …) stay behind it.
 */
export {
  COMPANY_NAV_KEYS,
  ORG_PAGE_RENDERERS,
  ORG_ROUTE_PREFIX,
  groupOrganizationsByProject,
  homePath,
  isOrgRoute,
  orgChannelPath,
  orgCreatedPath,
  orgCreatedTarget,
  orgKey,
  orgPagePath,
  parseOrgKey,
  resolveOrgLanding,
} from "@prismshadow/penguin-web/internal";
export type { CompanyNavKey, OrgPageRenderer, WorkMode } from "@prismshadow/penguin-web/internal";
