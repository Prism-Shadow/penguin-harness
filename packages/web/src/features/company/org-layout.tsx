/**
 * The route shell of company mode. `/org` alone resolves to an organization (the one last
 * opened, else the first of the current Project, else the first anywhere) or, with none, to
 * an empty landing that offers creating one; `/org/:projectId/:orgId/<page>` renders the
 * page inside an organization context. Both fall back to a Session's own page while company mode
 * is unavailable — the admin master switch off, or the user's own switch off — so a stale
 * bookmark never shows an empty shell.
 *
 * Entering an organization's routes has three side effects the shell relies on: the work
 * mode flips to company (a deep link is a mode choice), the current Project follows the
 * route (the session list and the Agent set belong to the Project), and the organization
 * becomes the shell's current one (its channels and their badges, its desks, the switcher's
 * label) — and stays so after these routes unmount, since a desk conversation is one of the
 * organization's own surfaces even though it lives at `/chat/:sessionId`.
 *
 * The page primitives live here too — `OrgPage`, `OrgSection`, `OrgEmptyLine` and the
 * skeleton — so every organization page shares one frame, one header row and one section
 * rule instead of each drawing its own.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router";
import type { OrganizationSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { COMPANY_MODE_ICON } from "../../components/ui/icons";
import { InfoPopover } from "../../components/ui/info-popover";
import { Skeleton } from "../../components/ui/skeleton";
import { orgChannelPath, orgKey, resolveOrgLanding } from "./company-nav";
import { DEFAULT_CHANNEL_ID } from "./channel-list";
import { CreateOrganizationDialog } from "./org-dialogs";
import { FIRST_STEPS } from "./overview-summary";
import type { FirstStep } from "./overview-summary";

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

/** The scrolling column every organization surface sits in, and the width the narrow pages read best at. */
function OrgFrame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className={wide ? "min-w-0" : "mx-auto max-w-6xl"}>{children}</div>
    </div>
  );
}

/** `/org` with no organization named. */
export function OrgIndexRedirect() {
  const company = useCompany();
  const { currentProject } = useProject();
  if (!company.available) return <Navigate to="/chat" replace />;
  // The list is still on its way: a placeholder page rather than a blank one, so a slow
  // first load never reads as a broken route.
  if (!company.orgsLoaded) {
    return (
      <OrgFrame>
        <OrgPageSkeleton />
      </OrgFrame>
    );
  }
  const target = resolveOrgLanding(
    company.lastOrgKey,
    company.organizations,
    currentProject?.projectId ?? null,
  );
  if (target === null) return <OrgEmptyLanding />;
  // An organization opens on its all-hands channel: channels are where company mode works.
  return (
    <Navigate to={orgChannelPath(target.projectId, target.orgId, DEFAULT_CHANNEL_ID)} replace />
  );
}

/** The three first steps as the landing tells them: what happens once the organization exists. */
const STEP_TEXT: Record<FirstStep, () => { title: string; body: string }> = {
  ceo: () => ({
    title: S.company.overview.stepCeoTitle,
    body: S.company.overview.stepCeoBody,
  }),
  hire: () => ({
    title: S.company.overview.stepHireTitle,
    body: S.company.overview.stepHireBody,
  }),
  schedule: () => ({
    title: S.company.overview.stepScheduleTitle,
    body: S.company.overview.stepScheduleBody,
  }),
};

/** The landing of a user who has no organization anywhere: what one is, what the first three steps will be, and the button that makes it. */
function OrgEmptyLanding() {
  const navigate = useNavigate();
  const company = useCompany();
  const [createOpen, setCreateOpen] = useState(false);
  // Landing on `/org` is a choice of mode like entering an organization is: the sidebar
  // shows the company shell around this page rather than the development list.
  const { available, setWorkMode } = company;
  useEffect(() => {
    if (available) setWorkMode("company");
  }, [available, setWorkMode]);
  return (
    <OrgFrame>
      <div className="mx-auto max-w-2xl py-8 text-center md:py-14">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
          <GlyphIcon d={COMPANY_MODE_ICON} size={ICON_SIZE.sectionMark + 6} />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">{S.company.landingTitle}</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600 dark:text-gray-300">
          {S.company.landingBody}
        </p>
        <div className="mt-6">
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            {S.company.createOrg}
          </Button>
        </div>
        <ol className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {FIRST_STEPS.map((step, i) => {
            const text = STEP_TEXT[step]();
            return (
              <li key={step} className={`flex ${ICON_GAP.menu}`}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{text.title}</span>
                  <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                    {text.body}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
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
              : orgChannelPath(detail.projectId, detail.orgId, DEFAULT_CHANNEL_ID),
          );
        }}
      />
    </OrgFrame>
  );
}

/** The list is settled and the routed organization is not in it: gone, or never reachable. */
function OrgGone() {
  const navigate = useNavigate();
  return (
    <OrgFrame>
      <EmptyState
        title={S.errors.byCode.org_not_found}
        action={
          <Button variant="primary" onClick={() => navigate("/org", { replace: true })}>
            {S.company.switcher}
          </Button>
        }
      />
    </OrgFrame>
  );
}

export function OrgLayout() {
  const params = useParams<{ projectId: string; orgId: string }>();
  const projectId = params.projectId ?? "";
  const orgId = params.orgId ?? "";
  const company = useCompany();
  const { projects, currentProject, setCurrentProjectId } = useProject();
  const key = orgKey(projectId, orgId);

  // Entering an organization route is a choice of mode — asserted when the route is entered,
  // never re-asserted when the mode later changes: the user's own switch to development
  // navigates away, and re-forcing company mode here would undo the click before this
  // layout unmounts.
  const { available, setWorkMode, setCurrentOrg } = company;
  useEffect(() => {
    if (available) setWorkMode("company");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- route entry only, not on every mode change
  }, [available, key, setWorkMode]);

  // The session list and the Agent set belong to the Project, so it follows the route.
  const currentProjectId = currentProject?.projectId ?? null;
  const knownProject = projects.some((p) => p.projectId === projectId);
  useEffect(() => {
    if (knownProject && currentProjectId !== null && currentProjectId !== projectId) {
      setCurrentProjectId(projectId);
    }
  }, [knownProject, currentProjectId, projectId, setCurrentProjectId]);

  // The organization stays the shell's current one after these routes unmount: opening a
  // desk or a ticket session leaves them for `/chat/:sessionId`, and company mode's sidebar
  // has to keep listing that organization's channels and desks around the conversation.
  // Leaving company mode is what drops it (CompanyProvider).
  useEffect(() => {
    setCurrentOrg(key);
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
 * the content below. The organization's name is not repeated in the title — the switcher
 * above the sidebar already names it; the overview's own hero is the one place it is.
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
    <OrgFrame wide={wide}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className={`flex min-w-0 items-center ${ICON_GAP.row} text-xl font-semibold`}>
          {title}
          {info !== undefined && <InfoPopover label={title}>{info}</InfoPopover>}
        </h1>
        {actions !== undefined && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </OrgFrame>
  );
}

/** A page still fetching: placeholder bands where its header and sections will be. Shown only until the first data (or the first error) arrives. */
export function OrgPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-20" />
      <Skeleton className="h-24" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

/**
 * A ruled section: a small uppercase title with an optional count, its "?" and optional
 * trailing controls, a rule beneath, then the body. Sections, not cards — the page reads
 * as one column of titled runs rather than a grid of boxes.
 */
export function OrgSection({
  title,
  info,
  count,
  actions,
  children,
  className = "",
}: {
  title: string;
  info?: string;
  /** How many items the body holds, shown after the title (omit for sections that are not lists). */
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-gray-200 pb-2 dark:border-gray-800">
        <h2
          className={`flex min-w-0 items-center ${ICON_GAP.row} text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400`}
        >
          {title}
          {count !== undefined && (
            <span className="rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold tabular-nums text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {count}
            </span>
          )}
          {info !== undefined && <InfoPopover label={title}>{info}</InfoPopover>}
        </h2>
        {actions !== undefined && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children}
    </section>
  );
}

/** A section with nothing to list: one quiet line where the rows would be. */
export function OrgEmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-1 text-xs text-gray-400 dark:text-gray-500">{children}</p>;
}
