/**
 * Company mode's routes, mounted by the shell as the one page `/org/*` (module.ts); the paths
 * below are relative to `/org`. `/org` resolves to an organization (or the empty landing), and
 * an organization opens on its overview — the page that says what the whole organization is
 * doing; its channels are the sidebar's own list beside it. Both fall back to /chat while
 * company mode is unavailable (see OrgLayout); any other `/org/...` path goes where the
 * shell's own catch-all would, the home of the mode the shell stands in.
 *
 * After the organization's own pages come the company-mode pages a plugin contributes
 * (`nav: "org"`, use-org-pages.ts): their paths are relative to the organization, and the nav
 * row beside them is the sidebar's (company-nav.ts ORG_PAGE_RENDERERS). Each is drawn with the
 * component the shell resolved its renderer to — an iframe, or the component a module
 * contributed under its builtin name (`WebAppModule.pageRenderers`).
 */
import { Navigate, Route, Routes } from "react-router";
import { OrgIndexRedirect, OrgLayout } from "./org-layout";
import { OverviewPage } from "./overview-page";
import { OrgChartPage } from "./org-chart-page";
import { CalendarPage } from "./calendar-page";
import { TicketsPage } from "./tickets-page";
import { FinancePage } from "./finance-page";
import { ChannelView } from "./channel-view";
import { HandbookPage } from "./handbook-page";
import { useOrgPages } from "./use-org-pages";
import { useCompany } from "./company-state";

export function OrgRoutes() {
  // Built but not yet offered: kept out of the organization layout.
  const contributed = useOrgPages().filter((page) => page.released);
  const { homePath } = useCompany();
  return (
    <Routes>
      <Route index element={<OrgIndexRedirect />} />
      <Route path=":projectId/:orgId" element={<OrgLayout />}>
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="chart" element={<OrgChartPage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="tickets" element={<TicketsPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="handbook" element={<HandbookPage />} />
        <Route path="channels/:channelId" element={<ChannelView />} />
        {contributed.map(({ id, path, Component }) => (
          <Route key={id} path={path} element={<Component />} />
        ))}
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
      <Route path="*" element={<Navigate to={homePath} replace />} />
    </Routes>
  );
}
