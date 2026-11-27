/**
 * The context the proposals pages were written against, held by one provider at the page:
 * which organization the route is in, who the viewer is, the organization's chart (employee
 * names and avatar revisions), and the one copy of the open organization's proposals index
 * that the page and every `proposal:<n>` capsule read.
 *
 * It is smaller than the shell's company state by design: the shell keeps everything a whole
 * sidebar needs, and these pages only the page. The plugin's events reach it through this
 * half's own handler (`SessionsModule.userEvents`, bound in module.ts) fanning out to the
 * listeners below — the same bump the index's own writes cause, so every surface refetches off
 * one version counter. A ticket named on the page opens the shell's ticket board with the
 * ticket in its deep link; the dialog itself stays the shell's.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import type {
  OrganizationSummary,
  ProposalItem,
  ProposalPluginEvent,
  ServerEvent,
} from "@prismshadow/penguin-server/api";
import type { UserEventHandler } from "@prismshadow/penguin-web-plugin";
import { apiErrorText } from "@prismshadow/penguin-web-plugin";
import * as api from "./api";
import { orgContributedPagePath, orgKey } from "./nav";

// ---------------------------------------------------------------------------
// Event fan-out: the handler bound in module.ts publishes here, and the provider plus any
// mounted page subscribe. Module level, because the connection outlives every page.
// ---------------------------------------------------------------------------

/** The plugin id whose events move the proposals index. */
export const PROPOSALS_PLUGIN = "company-proposals";

type EventListener = (ev: ServerEvent) => void;
const listeners = new Set<EventListener>();
const resyncListeners = new Set<() => void>();

/** The plugin's own event, once its `data` has the shape the plugin publishes. */
export function proposalEventOf(ev: ServerEvent): ProposalPluginEvent | null {
  if (ev.type !== "plugin" || ev.plugin !== PROPOSALS_PLUGIN) return null;
  const data = ev.data as Partial<ProposalPluginEvent> | null;
  if (
    data === null ||
    typeof data !== "object" ||
    typeof data.projectId !== "string" ||
    typeof data.orgId !== "string" ||
    typeof data.number !== "number"
  ) {
    return null;
  }
  return data as ProposalPluginEvent;
}

/** The handler bound in module.ts: this half's share of the user event stream. */
export const proposalsUserEvents: UserEventHandler = {
  event: (ev) => publishProposalEvent(ev as ServerEvent),
  resync: () => publishProposalResync(),
};

export function publishProposalEvent(ev: ServerEvent): void {
  for (const listener of listeners) listener(ev);
}

export function publishProposalResync(): void {
  for (const listener of resyncListeners) listener();
}

/** Subscribes a component to the plugin's events for its mounted lifetime; the latest handler is always the one called. */
export function usePluginEvents(handler: EventListener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (ev: ServerEvent) => ref.current(ev);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/** Which organization the routed page is in. */
export interface OrgContextValue {
  projectId: string;
  orgId: string;
  /** The organization's summary from the server's list; null until the list holds it. */
  org: OrganizationSummary | null;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrg must be used within an organization route");
  return ctx;
}

/** The viewer, as far as these pages need them: the id their read marks carry. */
export interface AuthContextValue {
  /** undefined = initializing; null = not signed in. */
  user: api.MeUser | null | undefined;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within the proposals provider");
  return ctx;
}

/** Version counters: a page refetches when the one it depends on moves. */
export interface CompanyVersions {
  /** A proposal of the open organization moved (the plugin's event, or a write from this browser). */
  proposals: number;
}

export interface CompanyContextValue {
  /** The open organization's employees, in chart order; null until the first read. */
  orgChart: api.OrgChart | null;
  /** The summary of the open organization, when the list holds it. */
  currentOrg: OrganizationSummary | null;
  /** `<projectId>/<orgId>` of the organization the route is in. */
  currentOrgKey: string;
  /** The same key: these pages have no organization to remember beyond the route. */
  lastOrgKey: string | null;
  /** The page is contributed by the running plugin, so the index exists to be read. */
  proposalsEnabled: boolean;
  /** The open organization's proposals; null until the first listing. */
  proposals: ProposalItem[] | null;
  proposalsError: string | null;
  /** The index entry a capsule names, or null when the listing has no such number. */
  proposalOf: (number: number) => ProposalItem | null;
  reloadProposals: () => Promise<void>;
  /** The reader opened a proposal: its badge clears here before the server's read position is written. */
  markProposalRead: (number: number) => void;
  /** Say that a proposal was written here, so the page and every capsule refetch. */
  proposalsChanged: () => void;
  versions: CompanyVersions;
  /**
   * Opens a ticket named on these pages: the shell's ticket board with the ticket in its deep
   * link — the dialog itself is the shell's, not this half's.
   */
  openTicket: (projectId: string, orgId: string, ticketId: string) => void;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within the proposals provider");
  return ctx;
}

/** The company context where there is one, null where there is not — for a Markdown element that may render outside the tree. */
export function useCompanyOptional(): CompanyContextValue | null {
  return useContext(CompanyContext);
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export function ProposalsProvider({
  projectId,
  orgId,
  children,
}: {
  projectId: string;
  orgId: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const key = orgKey(projectId, orgId);

  // The viewer: read once. A failure leaves the viewer unknown; the page still renders, and
  // the read marks it writes are best-effort either way.
  const [user, setUser] = useState<api.MeUser | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api
      .getMe()
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The organization's summary: the page titles read its name. A failure leaves it null —
  // the pages fall back to the page's own name in the title, and nothing else reads it.
  const [org, setOrg] = useState<OrganizationSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOrg(null);
    api
      .listOrganizations(projectId)
      .then((res) => {
        if (!cancelled) {
          setOrg(res.organizations.find((o) => o.orgId === orgId) ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, orgId]);

  // The chart: employee names and avatar revisions. Read on the organization and again on the
  // orgs version (an event that says the roster moved), a failure leaving whatever is held.
  const [orgChart, setOrgChart] = useState<api.OrgChart | null>(null);
  const [orgsVersion, setOrgsVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api
      .getOrgChart(projectId, orgId)
      .then((chart) => {
        if (!cancelled) setOrgChart(chart);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, orgId, orgsVersion]);

  // The proposals index: the page's queue and every capsule read this one copy. Re-read when
  // the organization changes and whenever the versions say a proposal moved; a failure leaves
  // what the index already holds, and the page's own error line names it.
  const [proposals, setProposals] = useState<ProposalItem[] | null>(null);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [versions, setVersions] = useState<CompanyVersions>({ proposals: 0 });
  const loadRef = useRef(0);
  const reloadProposals = useCallback(async () => {
    const read = ++loadRef.current;
    try {
      const res = await api.listOrgProposals(projectId, orgId);
      if (loadRef.current !== read) return;
      setProposals(res.proposals);
      setProposalsError(null);
    } catch (e) {
      if (loadRef.current !== read) return;
      setProposalsError(apiErrorText(e));
    }
  }, [projectId, orgId]);
  useEffect(() => {
    void reloadProposals();
  }, [reloadProposals, versions.proposals]);

  const markProposalRead = useCallback((number: number) => {
    setProposals((prev) =>
      prev === null ? prev : prev.map((p) => (p.number === number ? { ...p, unread: 0 } : p)),
    );
  }, []);

  const proposalsChanged = useCallback(() => {
    setVersions((prev) => ({ proposals: prev.proposals + 1 }));
  }, []);

  // The plugin's events: a proposal event for the open organization is the same bump a write
  // from this browser causes; the scheduler's other families only move the chart.
  usePluginEvents((ev) => {
    const proposal = proposalEventOf(ev);
    if (proposal !== null) {
      if (orgKey(proposal.projectId, proposal.orgId) === key) proposalsChanged();
    } else if (ev.type === "org_run" || ev.type === "org_ticket" || ev.type === "org_budget") {
      if (orgKey(ev.projectId, ev.orgId) === key) setOrgsVersion((v) => v + 1);
    }
  });
  useEffect(() => {
    const onResync = () => {
      proposalsChanged();
      setOrgsVersion((v) => v + 1);
    };
    resyncListeners.add(onResync);
    return () => {
      resyncListeners.delete(onResync);
    };
  }, [proposalsChanged]);

  const value = useMemo<CompanyContextValue>(() => {
    return {
      orgChart,
      currentOrg: org,
      currentOrgKey: key,
      lastOrgKey: key,
      proposalsEnabled: true,
      proposals,
      proposalsError,
      proposalOf: (number) => proposals?.find((p) => p.number === number) ?? null,
      reloadProposals,
      markProposalRead,
      proposalsChanged,
      versions,
      openTicket: (pid, oid, ticketId) => {
        void navigate(
          `${orgContributedPagePath(pid, oid, "tickets")}?ticket=${encodeURIComponent(ticketId)}`,
        );
      },
    };
  }, [
    org,
    orgChart,
    key,
    proposals,
    proposalsError,
    reloadProposals,
    markProposalRead,
    proposalsChanged,
    versions,
    navigate,
  ]);

  const orgValue = useMemo<OrgContextValue>(
    () => ({ projectId, orgId, org }),
    [projectId, orgId, org],
  );
  const authValue = useMemo<AuthContextValue>(() => ({ user }), [user]);

  return (
    <OrgContext.Provider value={orgValue}>
      <AuthContext.Provider value={authValue}>
        <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
      </AuthContext.Provider>
    </OrgContext.Provider>
  );
}
