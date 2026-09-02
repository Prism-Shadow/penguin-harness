/**
 * The route shell of company mode. `/org` alone resolves to an organization (the one last
 * opened, else the first of the current Project, else the first anywhere) or, with none, to
 * an empty landing that offers creating one; `/org/:projectId/:orgId/<page>` renders the
 * page inside an organization context. Both fall back to the chat page while company mode
 * is unavailable — the admin master switch off, or the user's own switch off — so a stale
 * bookmark never shows an empty shell.
 *
 * Entering an organization's routes has three side effects the shell relies on: the work
 * mode flips to company (a deep link is a mode choice), the current Project follows the
 * route (the session list and the Agent set belong to the Project), and the organization
 * becomes the shell's current one (its chat counters, the switcher's label).
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router";
import type { OrganizationSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_GAP } from "../../lib/icon-scale";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { InfoPopover } from "../../components/ui/info-popover";
import { Skeleton } from "../../components/ui/skeleton";
import { orgKey, orgPagePath, resolveOrgLanding } from "./company-nav";
import { CreateOrganizationDialog } from "./org-dialogs";

export interface OrgContextValue {
  projectId: string;
  orgId: string;
  /** The organization's summary from the shell's list; null until the list holds it. */
  org: OrganizationSummary | null;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within an organization route");
  return ctx;
}

/** `/org` with no organization named. */
export function OrgIndexRedirect() {
  const company = useCompany();
  const { currentProject } = useProject();
  if (!company.available) return <Navigate to="/chat" replace />;
  if (!company.orgsLoaded) return null;
  const target = resolveOrgLanding(
    company.lastOrgKey,
    company.organizations,
    currentProject?.projectId ?? null,
  );
  if (target === null) return <OrgEmptyLanding />;
  return <Navigate to={orgPagePath(target.projectId, target.orgId, "overview")} replace />;
}

/** The landing of a user who has no organization anywhere: what one is, and the button that makes the first. */
function OrgEmptyLanding() {
  const navigate = useNavigate();
  const company = useCompany();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-2xl">
        <EmptyState
          title={S.company.landingTitle}
          description={S.company.landingBody}
          action={
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {S.company.createOrg}
            </Button>
          }
        />
      </div>
      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(detail) => {
          setCreateOpen(false);
          company.setWorkMode("company");
          void company.reloadOrganizations();
          navigate(
            detail.ceoDeskSessionId !== undefined
              ? `/chat/${detail.ceoDeskSessionId}`
              : orgPagePath(detail.projectId, detail.orgId, "overview"),
          );
        }}
      />
    </div>
  );
}

/** The list is settled and the routed organization is not in it: gone, or never reachable. */
function OrgGone() {
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <EmptyState
        title={S.errors.byCode.org_not_found}
        action={
          <Button variant="primary" onClick={() => navigate("/org", { replace: true })}>
            {S.company.switcher}
          </Button>
        }
      />
    </div>
  );
}

export function OrgLayout() {
  const params = useParams<{ projectId: string; orgId: string }>();
  const projectId = params.projectId ?? "";
  const orgId = params.orgId ?? "";
  const company = useCompany();
  const { projects, currentProject, setCurrentProjectId } = useProject();
  const key = orgKey(projectId, orgId);

  // A deep link into an organization is a choice of mode.
  const { available, workMode, setWorkMode, setCurrentOrg } = company;
  useEffect(() => {
    if (available && workMode !== "company") setWorkMode("company");
  }, [available, workMode, setWorkMode]);

  // The session list and the Agent set belong to the Project, so it follows the route.
  const currentProjectId = currentProject?.projectId ?? null;
  const knownProject = projects.some((p) => p.projectId === projectId);
  useEffect(() => {
    if (knownProject && currentProjectId !== null && currentProjectId !== projectId) {
      setCurrentProjectId(projectId);
    }
  }, [knownProject, currentProjectId, projectId, setCurrentProjectId]);

  useEffect(() => {
    setCurrentOrg(key);
    return () => setCurrentOrg(null);
  }, [key, setCurrentOrg]);

  if (!available) return <Navigate to="/chat" replace />;
  const org =
    company.organizations.find((o) => o.projectId === projectId && o.orgId === orgId) ?? null;
  if (org === null && company.orgsLoaded) return <OrgGone />;
  return (
    <OrgContext.Provider value={{ projectId, orgId, org }}>
      <Outlet />
    </OrgContext.Provider>
  );
}

/**
 * The page frame every organization page shares: a scrolling column with the page title,
 * its "?" (the page's semantics, disclosed on request) and the header actions on one row,
 * the content below. The organization's name is not repeated here — the switcher above the
 * sidebar already names it.
 */
export function OrgPage({
  title,
  info,
  actions,
  wide = false,
  children,
}: {
  title: string;
  info?: string;
  actions?: ReactNode;
  /** Board-shaped pages take the whole width; the rest read better in a column. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className={wide ? "min-w-0" : "mx-auto max-w-5xl"}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h1 className={`flex items-center ${ICON_GAP.row} text-xl font-semibold`}>
            {title}
            {info !== undefined && <InfoPopover label={title}>{info}</InfoPopover>}
          </h1>
          {actions !== undefined && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A page still fetching: three placeholder bands where its sections will be. */
export function OrgPageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

/**
 * A ruled section: a small uppercase title with its "?" and optional trailing controls,
 * a rule beneath, then the body. Sections, not cards — the page reads as one column of
 * titled runs rather than a grid of boxes.
 */
export function OrgSection({
  title,
  info,
  actions,
  children,
  className = "",
}: {
  title: string;
  info?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-gray-200 pb-1.5 dark:border-gray-800">
        <h2
          className={`flex items-center ${ICON_GAP.row} text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400`}
        >
          {title}
          {info !== undefined && <InfoPopover label={title}>{info}</InfoPopover>}
        </h2>
        {actions !== undefined && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
