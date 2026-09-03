/**
 * Company-mode shell state: whether the mode is available at all, which mode the shell is
 * in, which organization is open, the organizations this user can reach, and the live
 * counters the chat entry's badges show.
 *
 * Availability is two switches ANDed: the server's master switch (`MeResponse.companyMode`,
 * read through the auth context) and the user's own (`UiPrefs.companyMode`, default on). Off
 * on either side, the shell renders no mode switch and every `/org` route falls back to the
 * chat page; organizations keep running regardless — the personal switch only hides the
 * user's own view of them.
 *
 * The chosen mode and the organization last opened are user preferences (`workMode`,
 * `lastOrgKey` in ui_prefs) mirrored into localStorage (lib/work-mode.ts) so a reload stands
 * in the right mode before the preferences arrive; the stored copy wins once it does.
 *
 * Company events ride the same user-level event stream the session list consumes
 * (state/sessions.tsx forwards them through `publishCompanyEvent`): the store keeps the
 * chat counters of the open organization in step and bumps a version per event family, which
 * the pages watch to refetch — the query routes carry the durable state, the events only say
 * that it moved.
 *
 * State lives in a zustand vanilla store (one instance per Provider mount) like the Project
 * and Session stores; the Provider is the lifecycle component that hydrates it.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CompanyServerEvent,
  OrgSessionsResponse,
  OrganizationSummary,
  ServerEvent,
} from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { orgKey, parseOrgKey } from "../features/company/company-nav";
import type { WorkMode } from "../features/company/company-nav";
import {
  initialLastOrgKey,
  initialWorkMode,
  storeLastOrgKey,
  storeWorkMode,
} from "../lib/work-mode";
import { useAuth } from "./auth";
import { useProject } from "./project";

/** The event families the organization scheduler publishes on the user channel. */
export function isCompanyEvent(ev: ServerEvent): ev is CompanyServerEvent {
  return (
    ev.type === "org_run" ||
    ev.type === "org_channel" ||
    ev.type === "org_ticket" ||
    ev.type === "org_budget"
  );
}

// ---------------------------------------------------------------------------
// Event fan-out: the one SSE connection (state/sessions.tsx) publishes here, and the store
// plus any mounted page subscribe. Module level, because the connection outlives every page.
// ---------------------------------------------------------------------------

type CompanyEventListener = (ev: CompanyServerEvent) => void;
const listeners = new Set<CompanyEventListener>();

export function publishCompanyEvent(ev: CompanyServerEvent): void {
  for (const listener of listeners) listener(ev);
}

export function subscribeCompanyEvents(listener: CompanyEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribes a component to company events for its mounted lifetime; the latest handler is always the one called. */
export function useCompanyEvents(handler: CompanyEventListener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeCompanyEvents((ev) => ref.current(ev)), []);
}

/** Version counters, one per event family: a page refetches when the one it depends on moves. */
export interface CompanyVersions {
  /** The organization list (an org's summary counts changed: a budget pause, a run). */
  orgs: number;
  chat: number;
  tickets: number;
  /** A desk or ticket Session was opened by the scheduler. */
  runs: number;
  budget: number;
}

interface CompanyStoreState {
  /** The user's own switch (`UiPrefs.companyMode`); on until the preferences say otherwise. */
  personalEnabled: boolean;
  /** The preferences have been read once (before that the mirrors below stand in). */
  prefsLoaded: boolean;
  workMode: WorkMode;
  /** `<projectId>/<orgId>` of the organization last opened, or null. */
  lastOrgKey: string | null;
  /** The organization the shell is currently inside (set by the org routes), or null elsewhere. */
  currentOrgKey: string | null;
  /** Every organization of every Project the user can reach. */
  organizations: OrganizationSummary[];
  orgsLoading: boolean;
  orgsLoaded: boolean;
  /** Unread chat messages of the open organization, and how many of those mention the user (or all). */
  chatUnread: number;
  chatMentions: number;
  /** Desk and ticket Sessions per organization of the current Project, keyed by org key. */
  orgSessions: ReadonlyMap<string, OrgSessionsResponse>;
  versions: CompanyVersions;

  setWorkMode: (mode: WorkMode) => void;
  setPersonalEnabled: (enabled: boolean) => void;
  setCurrentOrg: (key: string | null) => void;
  setChatCounters: (unread: number, mentions: number) => void;
  reloadOrganizations: (projectIds: readonly string[]) => Promise<void>;
  reloadOrgSessions: (projectId: string) => Promise<void>;
  applyCompanyEvent: (ev: CompanyServerEvent, userId: string | null) => void;
}

/**
 * Builds one Provider's store. Exported as a test seam: the package's vitest runs in Node
 * with no DOM, so the event routing below is exercised against the store directly.
 */
export function createCompanyStore() {
  return createStore<CompanyStoreState>((set, get) => ({
    personalEnabled: true,
    prefsLoaded: false,
    workMode: initialWorkMode(),
    lastOrgKey: initialLastOrgKey(),
    currentOrgKey: null,
    organizations: [],
    orgsLoading: false,
    orgsLoaded: false,
    chatUnread: 0,
    chatMentions: 0,
    orgSessions: new Map(),
    versions: { orgs: 0, chat: 0, tickets: 0, runs: 0, budget: 0 },

    setWorkMode: (mode) => {
      if (mode === get().workMode) return;
      storeWorkMode(mode);
      set({ workMode: mode });
      // Server-side copy is best-effort: a lost write only costs the choice on another browser.
      void api.putPrefs({ workMode: mode }).catch(() => undefined);
    },

    setPersonalEnabled: (enabled) => {
      set({ personalEnabled: enabled });
      void api.putPrefs({ companyMode: enabled }).catch(() => undefined);
    },

    setCurrentOrg: (key) => {
      const prev = get();
      if (key === prev.currentOrgKey) return;
      // Leaving one organization for another drops the old one's counters: they belong to
      // the organization they were counted for.
      set({ currentOrgKey: key, chatUnread: 0, chatMentions: 0 });
      if (key === null || key === prev.lastOrgKey) return;
      storeLastOrgKey(key);
      set({ lastOrgKey: key });
      void api.putPrefs({ lastOrgKey: key }).catch(() => undefined);
    },

    setChatCounters: (unread, mentions) => {
      if (unread === get().chatUnread && mentions === get().chatMentions) return;
      set({ chatUnread: unread, chatMentions: mentions });
    },

    reloadOrganizations: async (projectIds) => {
      set({ orgsLoading: true });
      try {
        const lists = await Promise.all(
          projectIds.map((projectId) =>
            api
              .listOrganizations(projectId)
              .then((res) => res.organizations)
              // One Project's failure (lost access, a transient error) must not hide the rest.
              .catch(() => [] as OrganizationSummary[]),
          ),
        );
        set({ organizations: lists.flat(), orgsLoaded: true });
      } finally {
        set({ orgsLoading: false });
      }
    },

    reloadOrgSessions: async (projectId) => {
      const orgs = get().organizations.filter((o) => o.projectId === projectId);
      const entries = await Promise.all(
        orgs.map(async (o) => {
          try {
            return [
              orgKey(o.projectId, o.orgId),
              await api.getOrgSessions(o.projectId, o.orgId),
            ] as const;
          } catch {
            return null;
          }
        }),
      );
      const next = new Map<string, OrgSessionsResponse>();
      for (const entry of entries) if (entry !== null) next.set(entry[0], entry[1]);
      set({ orgSessions: next });
    },

    applyCompanyEvent: (ev, userId) => {
      const state = get();
      const key = orgKey(ev.projectId, ev.orgId);
      const versions = { ...state.versions };
      if (ev.type === "org_run") {
        versions.runs += 1;
        versions.orgs += 1;
      } else if (ev.type === "org_ticket") {
        versions.tickets += 1;
        versions.orgs += 1;
      } else if (ev.type === "org_budget") {
        versions.budget += 1;
        versions.orgs += 1;
      } else {
        versions.chat += 1;
        // The open organization's counters move with its stream; a message the user sent
        // themselves is read by definition.
        if (key === state.currentOrgKey && ev.message.sender !== `user:${userId ?? ""}`) {
          const me = `user:${userId ?? ""}`;
          const addressed = ev.message.mentions.includes(me) || ev.message.mentions.includes("all");
          set({
            chatUnread: state.chatUnread + 1,
            chatMentions: state.chatMentions + (addressed ? 1 : 0),
          });
        }
      }
      set({ versions });
    },
  }));
}

export type CompanyStore = ReturnType<typeof createCompanyStore>;

interface CompanyContextValue {
  /** The server's master switch. */
  serverEnabled: boolean;
  /** The user's own switch. */
  personalEnabled: boolean;
  /** Both switches on: the mode switch renders and `/org` routes resolve. */
  available: boolean;
  /** The effective mode: the chosen one while company mode is available, development otherwise. */
  workMode: WorkMode;
  setWorkMode: (mode: WorkMode) => void;
  setPersonalEnabled: (enabled: boolean) => void;
  organizations: OrganizationSummary[];
  orgsLoading: boolean;
  orgsLoaded: boolean;
  currentOrgKey: string | null;
  /** The summary of the open organization (or, outside its routes, of the one last opened), when the list holds it. */
  currentOrg: OrganizationSummary | null;
  lastOrgKey: string | null;
  setCurrentOrg: (key: string | null) => void;
  chatUnread: number;
  chatMentions: number;
  setChatCounters: (unread: number, mentions: number) => void;
  /** Desk and ticket Sessions of every organization of the current Project, keyed by org key. */
  orgSessions: ReadonlyMap<string, OrgSessionsResponse>;
  /** Every Session id those hold — the development sidebar's "organization" folder membership test. */
  orgSessionIds: ReadonlySet<string>;
  versions: CompanyVersions;
  reloadOrganizations: () => Promise<void>;
  reloadOrgSessions: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user, companyMode: serverEnabled } = useAuth();
  const { projects, currentProject } = useProject();
  const [store] = useState(createCompanyStore);
  const state = useStore(store);
  const userId = user?.userId ?? null;
  const currentProjectId = currentProject?.projectId ?? null;
  const projectIdsKey = projects.map((p) => p.projectId).join(",");

  // Preferences: the stored switch, mode and last organization win over the localStorage
  // mirrors once they arrive. Read once per signed-in user.
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (cancelled) return;
        const prefs = res.prefs;
        const patch: Partial<CompanyStoreState> = { prefsLoaded: true };
        if (prefs.companyMode === false) patch.personalEnabled = false;
        if (prefs.workMode === "company" || prefs.workMode === "dev") {
          patch.workMode = prefs.workMode;
          storeWorkMode(prefs.workMode);
        }
        if (typeof prefs.lastOrgKey === "string" && parseOrgKey(prefs.lastOrgKey) !== null) {
          patch.lastOrgKey = prefs.lastOrgKey;
          storeLastOrgKey(prefs.lastOrgKey);
        }
        store.setState(patch);
      })
      .catch(() => {
        // Unreachable preferences leave the mirrors standing; nothing here is critical.
        if (!cancelled) store.setState({ prefsLoaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [store, userId]);

  // The organization list spans every Project the user can reach; it refreshes when the
  // Project set changes and whenever an event says a summary moved.
  const { orgs: orgsVersion, runs: runsVersion, tickets: ticketsVersion } = state.versions;
  useEffect(() => {
    if (!serverEnabled || projectIdsKey === "") {
      store.setState({ organizations: [], orgsLoaded: false, orgSessions: new Map() });
      return;
    }
    void store.getState().reloadOrganizations(projectIdsKey.split(","));
  }, [store, serverEnabled, projectIdsKey, orgsVersion]);

  // The current Project's desk and ticket Sessions: the company sidebar lists them, and the
  // development sidebar folds them into an "organization" folder.
  // Keyed on the list's identity as well: a newly created organization has no sessions entry
  // until its first event otherwise.
  const { orgsLoaded } = state;
  const orgListKey = state.organizations.map((o) => orgKey(o.projectId, o.orgId)).join(",");
  useEffect(() => {
    if (!serverEnabled || currentProjectId === null || !orgsLoaded) return;
    void store.getState().reloadOrgSessions(currentProjectId);
  }, [store, serverEnabled, currentProjectId, orgsLoaded, orgListKey, runsVersion, ticketsVersion]);

  useEffect(
    () => subscribeCompanyEvents((ev) => store.getState().applyCompanyEvent(ev, userId)),
    [store, userId],
  );

  const value = useMemo<CompanyContextValue>(() => {
    const available = serverEnabled && state.personalEnabled;
    const shownKey = state.currentOrgKey ?? state.lastOrgKey;
    const shown = parseOrgKey(shownKey);
    const currentOrg =
      shown === null
        ? null
        : (state.organizations.find(
            (o) => o.projectId === shown.projectId && o.orgId === shown.orgId,
          ) ?? null);
    const orgSessionIds = new Set<string>();
    for (const res of state.orgSessions.values()) {
      for (const d of res.desks) orgSessionIds.add(d.sessionId);
      for (const t of res.tickets) for (const s of t.sessions) orgSessionIds.add(s.sessionId);
    }
    return {
      serverEnabled,
      personalEnabled: state.personalEnabled,
      available,
      workMode: available ? state.workMode : "dev",
      setWorkMode: state.setWorkMode,
      setPersonalEnabled: state.setPersonalEnabled,
      organizations: state.organizations,
      orgsLoading: state.orgsLoading,
      orgsLoaded: state.orgsLoaded,
      currentOrgKey: state.currentOrgKey,
      currentOrg,
      lastOrgKey: state.lastOrgKey,
      setCurrentOrg: state.setCurrentOrg,
      chatUnread: state.chatUnread,
      chatMentions: state.chatMentions,
      setChatCounters: state.setChatCounters,
      orgSessions: state.orgSessions,
      orgSessionIds,
      versions: state.versions,
      reloadOrganizations: () =>
        state.reloadOrganizations(projectIdsKey === "" ? [] : projectIdsKey.split(",")),
      reloadOrgSessions: () =>
        currentProjectId === null ? Promise.resolve() : state.reloadOrgSessions(currentProjectId),
    };
  }, [state, serverEnabled, projectIdsKey, currentProjectId]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within a CompanyProvider");
  return ctx;
}
