/**
 * The glyph of each company-mode nav entry, read off NAV_ICONS by manifest key so the pinned
 * sidebar and the collapsed rail draw the same mark for the same page (kept apart from
 * company-nav.ts, which stays free of any icon import so the route grammar is testable alone).
 */
import { NAV_ICONS } from "../../components/ui/icons";
import type { CompanyNavKey } from "./company-nav";

export const COMPANY_NAV_ICONS: Record<CompanyNavKey, string> = {
  overview: NAV_ICONS.orgOverview,
  chart: NAV_ICONS.orgChart,
  calendar: NAV_ICONS.orgCalendar,
  tickets: NAV_ICONS.orgTickets,
  finance: NAV_ICONS.orgFinance,
  chat: NAV_ICONS.orgChat,
};
