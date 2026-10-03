/**
 * Company mode's routes, mounted by the shell as the one page `/org/*` (module.ts); the paths
 * below are relative to `/org`. `/org` resolves to an organization (or the empty landing), and
 * an organization opens on its overview — the page that says what the whole organization is
 * doing; its channels are the sidebar's own list beside it. Both fall back to /chat while
 * company mode is unavailable (see OrgLayout), and so does any other `/org/...` path, as the
 * shell's own catch-all would.
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
import { OrgProposalsPage } from "../proposals/proposals-page";
import { orgPagesOf } from "../../web-app/page-table";
import { useOrgPages } from "./use-org-pages";

export function OrgRoutes() {
  const pages = orgPagesOf(useOrgPages());
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
        {pages.map((page) => (
          <Route key={page.id} path={page.path} element={
            "iframe" in page.renderer
              ? <iframe title={page.key} src={page.renderer.iframe.src} className="h-full w-full border-0" />
              : page.renderer.builtin === "OrgProposalsPage" ? <OrgProposalsPage /> : <Navigate to="overview" replace />
          } />
        ))}
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
