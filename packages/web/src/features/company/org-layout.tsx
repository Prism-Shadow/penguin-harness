/**
 * The route shell of company mode. `/org` alone resolves to an organization (the one last
 * opened, else the first of the current Project, else the first anywhere) and opens its
 * overview, or, with none, renders an empty landing that offers creating one;
 * `/org/:projectId/:orgId/<page>` renders the page inside an organization context. Both fall
 * back to a Session's own page while company mode is unavailable — the admin master switch
 * off, or the user's own switch off — so a stale bookmark never shows an empty shell.
 *
 * Entering an organization's routes has three side effects the shell relies on: the work
 * mode flips to company (a deep link is a mode choice), the current Project follows the
 * route (the session list and the Agent set belong to the Project), and the organization
 * becomes the shell's current one (its channels and their badges, its desks, the switcher's
 * label) — and stays so after these routes unmount, since a desk conversation is one of the
 * organization's own surfaces even though it lives at `/chat/:sessionId`.
 *
 * The organization layout is also where the ticket dialog is mounted, once: a ticket's detail
 * is read in place from whichever surface named it — the board, the finance ledger, the
 * overview's inbox, a channel's reference — so the window belongs to the shell around the
 * pages rather than to any one of them.
 *
 * The page primitives live here too — `OrgPage` (the UI package's page frame and header at the
 * organization pages' width), `OrgEmptyLine` and the skeleton — so every organization page
 * shares one frame and one header row instead of each drawing its own; a page's sections are
 * the package's `RuledSection`.
 */
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router";
import type { OrganizationSummary } from "@prismshadow/penguin-server/api";
import {
  Button,
  EmptyState,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_SIZE,
  PageFrame,
  PageHeader,
  Skeleton,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useCompany } from "../../state/company";
import { useProject } from "../../state/project";
import { orgKey, orgPagePath, resolveOrgLanding } from "./company-nav";
import { CreateOrganizationDialog, useOrganizationCreated } from "./org-dialogs";
import { ORG_EXAMPLES } from "./org-examples";
import { TicketDialogHost } from "./ticket-dialog";

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

/**
 * The frame the two organization-less surfaces sit in — the empty landing and the stale deep
 * link. Each is one short block of guidance with nothing above or below it, so the column
 * centres it in the window instead of parking it against the top edge, the way the dialogs
 * are centred. `min-h-full` rather than a fixed centred height: a window shorter than the
 * block grows the column and scrolls it whole, where `justify-center` alone would push its
 * top out of reach.
 */
function OrgCenteredFrame({ children }: { children: ReactNode }) {
  return (
    <PageFrame width="full" contentClassName="flex min-h-full flex-col justify-center">
      {children}
    </PageFrame>
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
      <PageFrame width="xl">
        <OrgPageSkeleton />
      </PageFrame>
    );
  }
  const target = resolveOrgLanding(
    company.lastOrgKey,
    company.organizations,
    currentProject?.projectId ?? null,
  );
  if (target === null) return <OrgEmptyLanding />;
  // An organization opens on its overview: the one page that says what the whole
  // organization is doing. Its channels are one click away in the sidebar's own list.
  return <Navigate to={orgPagePath(target.projectId, target.orgId, "overview")} replace />;
}

/**
 * The landing of a user who has no organization anywhere: what one is, the button that makes
 * one, and four companies worth starting.
 *
 * Each proposal is a card with a name to recognize the shape of the company by and a one-line
 * summary of what it does. A mission runs to a paragraph, and four of them side by side buried
 * the landing in text, so the card says just enough to choose by and the mission arrives with
 * the click: each card opens the dialog filled in with its name and its whole mission — the
 * hardest part of an empty landing is not the form, it is having nothing to type into it — and
 * leaves the id to the field's own generator. Everything a card says is on show, so it carries
 * no tooltip.
 *
 * The cards stretch to one height and lay their content out as a column, so the names sit on
 * one line and each summary starts under its own name: a `<button>` centres its own content
 * vertically, which left the shorter cards' names floating half a line below the tallest
 * card's.
 */
function OrgEmptyLanding() {
  const company = useCompany();
  const onOrgCreated = useOrganizationCreated();
  const [createOpen, setCreateOpen] = useState(false);
  /** The proposal the dialog opens filled in with; null when the plain create button opened it. */
  const [picked, setPicked] = useState<{ name: string; mission: string } | null>(null);
  const openCreate = (example: { name: string; mission: string } | null) => {
    setPicked(example);
    setCreateOpen(true);
  };
  // Landing on `/org` is a choice of mode like entering an organization is: the sidebar
  // shows the company shell around this page rather than the development list.
  const { available, setWorkMode } = company;
  useEffect(() => {
    if (available) setWorkMode("company");
  }, [available, setWorkMode]);
  return (
    <OrgCenteredFrame>
      <div className="mx-auto max-w-2xl py-8 text-center md:py-14">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300">
          <GlyphIcon d={ICONS.building} size={ICON_SIZE.sectionMark + 6} />
        </span>
        <Heading level={1} display className="mt-4">
          {S.company.landingTitle}
        </Heading>
        <p className="mx-auto mt-2 max-w-xl text-sm text-gray-600 dark:text-gray-300">
          {S.company.landingBody}
        </p>
        <div className="mt-6">
          <Button variant="primary" onClick={() => openCreate(null)}>
            {S.company.createOrg}
          </Button>
        </div>
        <ul className="mx-auto mt-10 grid max-w-2xl grid-cols-1 gap-3 text-left sm:grid-cols-2">
          {ORG_EXAMPLES.map((example) => {
            const copy = S.company.missionExamples[example.id];
            return (
              <li key={example.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => openCreate({ name: copy.name, mission: copy.mission })}
                  className="flex h-full w-full flex-col rounded-md border border-gray-200 p-3 text-left transition-colors duration-150 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/60"
                >
                  <span className="block text-sm font-medium">{copy.name}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    {copy.summary}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <CreateOrganizationDialog
        open={createOpen}
        {...(picked !== null ? { initial: picked } : {})}
        onClose={() => setCreateOpen(false)}
        onCreated={(detail) => {
          setCreateOpen(false);
          company.setWorkMode("company");
          void onOrgCreated(detail);
        }}
      />
    </OrgCenteredFrame>
  );
}

/**
 * The list is settled and the routed organization is not in it: gone, or never reachable —
 * a bookmark that outlived what it pointed at. The page says so and then offers the two ways
 * on, rather than leaving the reader on a dead end: make one, or go back to the list (which
 * lands on another organization, or on the empty landing when there is none).
 */
function OrgGone() {
  const navigate = useNavigate();
  const onOrgCreated = useOrganizationCreated();
  const [createOpen, setCreateOpen] = useState(false);
  return (
    <OrgCenteredFrame>
      <EmptyState
        title={S.company.orgGoneTitle}
        description={S.company.orgGoneBody}
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {S.company.createOrg}
            </Button>
            <Button onClick={() => navigate("/org", { replace: true })}>
              {S.company.backToOrgs}
            </Button>
          </div>
        }
      />
      <CreateOrganizationDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(detail) => {
          setCreateOpen(false);
          void onOrgCreated(detail);
        }}
      />
    </OrgCenteredFrame>
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
      <TicketDialogHost />
    </OrgContext.Provider>
  );
}

/**
 * The page every organization page is: the package's page frame at the organization pages'
 * width, with its header — the page title, its "?" (the page's semantics, disclosed on
 * request) and the header actions on one row — and the content below. The organization's
 * name is not repeated in the title — the switcher above the sidebar already names it; the
 * overview's own hero is the one place it is.
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
    <PageFrame width={wide ? "full" : "xl"}>
      <PageHeader title={title} info={info} actions={actions} />
      {children}
    </PageFrame>
  );
}

/** A page still fetching: placeholder bands where its header and sections will be. Shown only until the first data (or the first error) arrives. */
export function OrgPageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-20" />
      <Skeleton className="h-24" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    </div>
  );
}

/** A section with nothing to list: one quiet line where the rows would be. */
export function OrgEmptyLine({ children }: { children: ReactNode }) {
  return <p className="py-1 text-xs text-gray-400 dark:text-gray-500">{children}</p>;
}
