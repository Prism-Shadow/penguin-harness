/**
 * Company mode's routes, mounted by the shell as the one page `/org/*` (module.ts); the paths
 * below are relative to `/org`. `/org` resolves to an organization (or the empty landing), and
 * an organization opens on its overview — the page that says what the whole organization is
 * doing; its channels are the sidebar's own list beside it. Both fall back to /chat while
 * company mode is unavailable (see OrgLayout), and so does any other `/org/...` path, as the
 * shell's own catch-all would.
 *
 * After the organization's own pages come the company-mode pages a plugin contributes
 * (`nav: "org"`, use-org-pages.ts): their paths are relative to the organization, and the nav
 * row beside them is the sidebar's (company-nav.ts ORG_PAGE_RENDERERS). A builtin one is drawn
 * with the component this file names for it.
 */
import type { ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router";
import { ContributedPage, orgPagesOf } from "../../shell";
import { OrgProposalsPage } from "../proposals/proposals-page";
import type { OrgPageRenderer } from "./company-nav";
import { OrgIndexRedirect, OrgLayout } from "./org-layout";
import { OverviewPage } from "./overview-page";
import { OrgChartPage } from "./org-chart-page";
import { CalendarPage } from "./calendar-page";
import { TicketsPage } from "./tickets-page";
import { FinancePage } from "./finance-page";
import { ChannelView } from "./channel-view";
import { HandbookPage } from "./handbook-page";
import { useOrgPages } from "./use-org-pages";

/** The component of each builtin renderer a contributed company-mode page may name. */
const ORG_PAGE_COMPONENTS: Readonly<Record<OrgPageRenderer, ComponentType>> = {
  OrgProposalsPage,
};

export function OrgRoutes() {
  const contributed = orgPagesOf(useOrgPages());
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
        {contributed.map((page) => (
          <Route
            key={page.id}
            path={page.path}
            element={<ContributedPage page={page} builtins={ORG_PAGE_COMPONENTS} />}
          />
        ))}
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
