/**
 * The glyph of each company-mode nav entry, as a name in the UI package's icon registry, by
 * manifest key — the pinned sidebar and the collapsed rail draw the same mark for the same page
 * (kept apart from company-nav.ts, which stays free of any icon knowledge so the route grammar is
 * testable alone).
 */
import type { IconName } from "@prismshadow/penguin-ui";

import { NAV_ICONS } from "../../lib/nav-icons";
import type { CompanyNavKey, OrgPageRenderer } from "../../lib/company-nav";

export const COMPANY_NAV_ICONS: Record<CompanyNavKey, IconName> = {
  overview: "dashboard",
  chart: "network",
  /** The same calendar the session list's time grouping wears. */
  calendar: "calendar",
  tickets: "kanban",
  finance: "dollarCircle",
  /** The handbook, the company's knowledge base. */
  handbook: "bookOpen",
};

/** The glyph of each contributed company-mode page, by what its contribution names (ORG_PAGE_RENDERERS). */
export const ORG_PAGE_ICONS: Record<OrgPageRenderer, string> = {
  OrgProposalsPage: NAV_ICONS.orgProposals,
};
