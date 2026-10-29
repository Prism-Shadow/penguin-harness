import type { ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router";
import { ContributedPage, orgPagesOf } from "../../lib/early-frame-index";
import type { OrgPageRenderer } from "../../lib/company-nav";
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

/** The component of each builtin renderer a contributed company-mode page may name. */
const ORG_PAGE_COMPONENTS: Readonly<Record<OrgPageRenderer, ComponentType>> = {};

export function OrgRoutes() {
  const contributed = orgPagesOf(useOrgPages());
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
        {contributed.map((page) => (
          <Route
            key={page.id}
            path={page.path}
            element={<ContributedPage page={page} builtins={ORG_PAGE_COMPONENTS} />}
          />
        ))}
        <Route path="*" element={<Navigate to="overview" replace />} />
      </Route>
      <Route path="*" element={<Navigate to={homePath} replace />} />
    </Routes>
  );
}
