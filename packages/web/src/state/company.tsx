/**
 * Company-mode shell state: whether the mode is available at all, which mode the shell is
 * in, which organization is open, the organizations this user can reach, the open
 * organization's channels, and the live counters their badges show.
 *
 * Availability is two switches ANDed: the server's master switch (`MeResponse.companyMode`,
 * read through the auth context) and the user's own (`UiPrefs.companyMode`, default on). Off
 * on either side, the shell renders no mode switch and every `/org` route falls back to a
 * Session's own page; organizations keep running regardless — the personal switch only hides the
 * user's own view of them.
 *
 * Turning a switch on only offers the mode: the mode switch appears, and the shell stays in
 * development on the page it is showing. The store holds that by keeping the chosen mode at
 * development while company mode is unavailable — a stored "company" is written back the moment
 * the store sees either switch off, whether the switch goes off in this tab, was already off at
 * load, or the preferences holding the choice arrive while it is. A choice kept through the off
 * spell would take effect when the switch comes back on, swapping in the company sidebar under
 * whatever page is open (the new-chat page, say) instead of the company landing. Company mode is
 * entered only by the user: the mode switch, or an `/org` route.
 *
 * Entering company mode is also where the shell says the mode is a beta: the first switch
 * into it in a browser raises the notice once (features/company/beta-badge.tsx keeps the
 * flag), which is why `setWorkMode` is the single handler both mode switches call.
 *
 * The chosen mode and the organization last opened are user preferences (`workMode`,
 * `lastOrgKey` in ui_prefs) mirrored into localStorage (lib/work-mode.ts) so a reload stands
 * in the right mode before the preferences arrive; the stored copy wins once it does. Both
 * the open and the remembered organization are forgotten once a complete listing comes back
 * without them: a deleted organization that keeps the shell aimed at it costs a broken
 * sidebar on every later visit.
 *
 * The open ticket lives here too. A ticket's detail is a dialog opened in place from every
 * company surface — the board, the finance ledger, the overview's inbox, a channel's ticket
 * reference — so which ticket is open is shell state rather than one page's, and the single
 * host (features/company/org-layout.tsx) renders whatever this says. Following a parent or a
 * child inside the dialog pushes the ticket left behind onto a stack, which is what the
 * dialog's back control pops.
 *
 * Company events ride the same user-level event stream the session list consumes
 * (state/sessions.tsx forwards them through `publishCompanyEvent`): the store keeps the
 * channel counters of the open organization in step and bumps a version per event family,
 * which the pages watch to refetch — the query routes carry the durable state, the events only say
 * that it moved.
 *
 * State lives in a zustand vanilla store (one instance per Provider mount) like the Project
 * and Session stores; the Provider is the lifecycle component that hydrates it.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  CompanyServerEvent,
  MessagingChannel,
  OrgChannelItem,
  OrgChartResponse,
  OrgSessionsResponse,
  OrganizationSummary,
  ServerEvent,
  UiPrefs,
} from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { apiErrorText } from "../lib/api-error";
import { S } from "../lib/strings";
import { toastAttention } from "../components/ui/toast";
import { markBetaNoticeShown, shouldShowBetaNotice } from "../features/company/beta-badge";
import { channelBadgeCounts } from "../features/company/channel-list";
import { orgKey, parseOrgKey } from "../features/company/company-nav";
import type { WorkMode } from "../features/company/company-nav";
import { withDeskMessagingChannel } from "../features/company/org-sessions";
import {
  clearLastOrgKey,
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

/**
 * The user channel reconnected past its replay buffer (`resync_required`): any number of the
 * events above were lost, and so were the `session_state` flips company surfaces take run state
 * from — the session list store forgets those on the same event, and the company store re-reads
 * the snapshots they would otherwise have corrected (`resync`).
 */
const resyncListeners = new Set<() => void>();

export function publishCompanyResync(): void {
  for (const listener of resyncListeners) listener();
}

export function subscribeCompanyResync(listener: () => void): () => void {
  resyncListeners.add(listener);
  return () => {
    resyncListeners.delete(listener);
  };
}

/** Subscribes a component to company events for its mounted lifetime; the latest handler is always the one called. */
export function useCompanyEvents(handler: CompanyEventListener): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribeCompanyEvents((ev) => ref.current(ev)), []);
}

/** Which ticket the detail dialog is showing; a ticket is always read inside one organization. */
export interface TicketDialogTarget {
  projectId: string;
  orgId: string;
  ticketId: string;
}

/** Version counters, one per event family: a page refetches when the one it depends on moves. */
export interface CompanyVersions {
  /** The organization list (an org's summary counts changed: a budget pause, a run, a resync). */
  orgs: number;
  /** A new message landed in one of the organization's channels. */
  messages: number;
  tickets: number;
  /** A desk or ticket Session was opened by the scheduler, or a resync may have lost that news. */
  runs: number;
  budget: number;
}

interface CompanyStoreState {
  /** The server's master switch (`MeResponse.companyMode`), as the auth context last read it. */
  serverEnabled: boolean;
  /** The user's own switch (`UiPrefs.companyMode`); on until the preferences say otherwise. */
  personalEnabled: boolean;
  /** The mode the user chose, held at development while company mode is unavailable (settleWorkMode). */
  workMode: WorkMode;
  /** `<projectId>/<orgId>` of the organization last opened, or null. */
  lastOrgKey: string | null;
  /** The organization the shell is currently inside (set by the org routes), or null elsewhere. */
  currentOrgKey: string | null;
  /** Every organization of every Project the user can reach. */
  organizations: OrganizationSummary[];
  orgsLoading: boolean;
  orgsLoaded: boolean;
  /**
   * At least one Project's listing failed in the last read, so `organizations` is missing
   * whatever that Project holds. An absent organization then means "not listed this time",
   * not "gone", which is what keeps a transient failure from forgetting the open one.
   */
  orgsPartial: boolean;
  /**
   * The open organization's channels, as `GET /channels` last answered them — the sidebar's
   * list, the rail's rows and the channel view all read this one copy. Null before the first
   * listing of the organization now open.
   */
  channels: OrgChannelItem[] | null;
  /** The last listing attempt's failure, kept beside whatever the list still holds. */
  channelsError: string | null;
  /** When each channel was last marked read here, so a listing that left earlier cannot resurrect its badge. */
  channelReadAt: ReadonlyMap<string, number>;
  /** Unread messages waiting in the open organization's channels, and how many of those name the user. */
  channelUnread: number;
  channelMentions: number;
  /** Desk and ticket Sessions per organization of the current Project, keyed by org key. */
  orgSessions: ReadonlyMap<string, OrgSessionsResponse>;
  /**
   * The open organization's chart — the sidebar's 工位 group is one row per EMPLOYEE, and
   * this is the only listing that holds employees whose desk has never been opened. Null
   * before the first read of the organization now open.
   */
  orgChart: OrgChartResponse | null;
  /** The last chart read's failure, kept beside whatever the roster still holds. */
  orgChartError: string | null;
  /** The ticket whose detail dialog is open, from wherever it was opened; null when none is. */
  ticketDialog: TicketDialogTarget | null;
  /**
   * The tickets the open one was reached from, oldest first — one entry per parent or child
   * followed inside the dialog. Ids only: they name tickets of the open organization.
   */
  ticketStack: readonly string[];
  versions: CompanyVersions;

  setWorkMode: (mode: WorkMode) => void;
  setServerEnabled: (enabled: boolean) => void;
  setPersonalEnabled: (enabled: boolean) => void;
  applyPrefs: (prefs: UiPrefs) => void;
  setCurrentOrg: (key: string | null) => void;
  reloadChannels: (projectId: string, orgId: string) => Promise<void>;
  markChannelRead: (channelId: string) => void;
  reloadOrganizations: (projectIds: readonly string[]) => Promise<void>;
  forgetMissingOrganizations: () => void;
  reloadOrgSessions: (projectId: string) => Promise<void>;
  /** A desk was bound to a messaging bot here (or unbound: null): its row's mark follows without a re-read. */
  setDeskMessagingChannel: (sessionId: string, channel: MessagingChannel | null) => void;
  reloadOrgChart: (projectId: string, orgId: string) => Promise<void>;
  openTicket: (projectId: string, orgId: string, ticketId: string) => void;
  closeTicket: () => void;
  backTicket: () => void;
  ticketsChanged: () => void;
  applyCompanyEvent: (ev: CompanyServerEvent, userId: string | null) => void;
  resync: () => void;
}

/** The two badge numbers of a channel listing (channel-list.ts), in the shape the store stores them. */
function counters(channels: readonly OrgChannelItem[]): {
  channelUnread: number;
  channelMentions: number;
} {
  const { unread, mentions } = channelBadgeCounts(channels);
  return { channelUnread: unread, channelMentions: mentions };
}

/** Both switches on: the mode switch renders and `/org` routes resolve. */
export function companyModeAvailable(switches: {
  serverEnabled: boolean;
  personalEnabled: boolean;
}): boolean {
  return switches.serverEnabled && switches.personalEnabled;
}

/**
 * The mode the shell stands in: the chosen one while company mode is available, development
 * otherwise. The store writes the choice itself back to development as soon as it sees a switch
 * off (settleWorkMode); this covers the renders that come before it has, such as the first one
 * after a load that finds "company" in the localStorage mirror while the server's switch is off.
 */
export function effectiveWorkMode(state: {
  serverEnabled: boolean;
  personalEnabled: boolean;
  workMode: WorkMode;
}): WorkMode {
  return companyModeAvailable(state) ? state.workMode : "dev";
}

/**
 * Company mode is unavailable, so a company choice goes back to development in the store, the
 * localStorage mirror and the preference alike (setWorkMode writes all three). Level, not edge:
 * it runs whenever the store learns a switch's value, so a choice stored before the switch went
 * off, in a tab or a browser that never saw it go, is settled on the first load that sees it off.
 */
function settleWorkMode(state: CompanyStoreState): void {
  if (state.workMode === "company" && !companyModeAvailable(state)) state.setWorkMode("dev");
}

/**
 * Builds one Provider's store. Exported as a test seam: the package's vitest runs in Node
 * with no DOM, so the event routing below is exercised against the store directly.
 * `serverEnabled` seeds the server's master switch (the Provider passes the auth context's), so
 * the first render already knows whether company mode may be entered.
 */
export function createCompanyStore(options: { serverEnabled?: boolean } = {}) {
  return createStore<CompanyStoreState>((set, get) => ({
    serverEnabled: options.serverEnabled ?? false,
    personalEnabled: true,
    workMode: initialWorkMode(),
    lastOrgKey: initialLastOrgKey(),
    currentOrgKey: null,
    organizations: [],
    orgsLoading: false,
    orgsLoaded: false,
    orgsPartial: false,
    channels: null,
    channelsError: null,
    channelReadAt: new Map(),
    channelUnread: 0,
    channelMentions: 0,
    orgSessions: new Map(),
    orgChart: null,
    orgChartError: null,
    ticketDialog: null,
    ticketStack: [],
    versions: { orgs: 0, messages: 0, tickets: 0, runs: 0, budget: 0 },

    setWorkMode: (mode) => {
      if (mode === get().workMode) return;
      // Company mode is entered only while it is available: a company choice written while a
      // switch is off would come into force the moment the switch comes back on.
      if (mode === "company" && !companyModeAvailable(get())) return;
      storeWorkMode(mode);
      set({ workMode: mode });
      // The mode is a beta, and this is the one place a person enters it: both switches and
      // the `/org` landing come through here, and hydrating the stored preference does not
      // (it sets the field directly), so the notice follows a deliberate move and never a
      // reload. Once per browser — the flag is the only state it keeps.
      if (mode === "company" && shouldShowBetaNotice()) {
        markBetaNoticeShown();
        toastAttention(S.company.betaNotice);
      }
      // Leaving company mode is what drops the open organization — not leaving its routes.
      // A desk or ticket conversation renders at `/chat/:sessionId` with the company sidebar
      // around it, and that sidebar lists this organization's channels and desks.
      if (mode !== "company") get().setCurrentOrg(null);
      // Server-side copy is best-effort: a lost write only costs the choice on another browser.
      void api.putPrefs({ workMode: mode }).catch(() => undefined);
    },

    /**
     * The server's master switch as /api/me last reported it. Seen off, the choice goes back
     * to development (settleWorkMode), so turning the switch on again offers company mode
     * instead of entering it.
     */
    setServerEnabled: (enabled) => {
      if (enabled !== get().serverEnabled) set({ serverEnabled: enabled });
      settleWorkMode(get());
    },

    setPersonalEnabled: (enabled) => {
      set({ personalEnabled: enabled });
      // Hiding company mode hides its shell with it (see setWorkMode), and takes it off the
      // user's choice: turning the switch back on offers the mode rather than entering it.
      if (!enabled) get().setCurrentOrg(null);
      settleWorkMode(get());
      void api.putPrefs({ companyMode: enabled }).catch(() => undefined);
    },

    /**
     * The stored preferences have arrived, and they win over the localStorage mirrors: the
     * user's switch, the mode and the organization last opened. A company choice among them
     * while company mode is unavailable is settled back to development (settleWorkMode) before
     * the mirror is written, so the mirror only ever holds the settled mode — a tab closed in
     * between must not leave the next load a choice this one has already refused.
     */
    applyPrefs: (prefs) => {
      const patch: Partial<CompanyStoreState> = {};
      if (prefs.companyMode === false) patch.personalEnabled = false;
      if (prefs.workMode === "company" || prefs.workMode === "dev") patch.workMode = prefs.workMode;
      if (typeof prefs.lastOrgKey === "string" && parseOrgKey(prefs.lastOrgKey) !== null) {
        patch.lastOrgKey = prefs.lastOrgKey;
        storeLastOrgKey(prefs.lastOrgKey);
      }
      set(patch);
      settleWorkMode(get());
      storeWorkMode(get().workMode);
    },

    setCurrentOrg: (key) => {
      const prev = get();
      if (key === prev.currentOrgKey) return;
      // Leaving one organization for another drops its channels and their counters: both
      // belong to the organization they were read for, and so does an open ticket.
      set({
        currentOrgKey: key,
        channels: null,
        channelsError: null,
        channelReadAt: new Map(),
        channelUnread: 0,
        channelMentions: 0,
        orgChart: null,
        orgChartError: null,
        ticketDialog: null,
        ticketStack: [],
      });
      if (key === null || key === prev.lastOrgKey) return;
      storeLastOrgKey(key);
      set({ lastOrgKey: key });
      void api.putPrefs({ lastOrgKey: key }).catch(() => undefined);
    },

    /**
     * Re-reads the open organization's channels. A response for an organization the shell has
     * since left is dropped, and a channel marked read after the request went out keeps its
     * local zero: the server's read cursor may not have been written yet when the listing was
     * computed, and a badge that comes back from the dead reads as a bug.
     */
    reloadChannels: async (projectId, orgId) => {
      const key = orgKey(projectId, orgId);
      const startedAt = Date.now();
      try {
        const res = await api.listOrgChannels(projectId, orgId);
        const state = get();
        if (state.currentOrgKey !== key) return;
        const channels = res.channels.map((c) =>
          (state.channelReadAt.get(c.channelId) ?? 0) >= startedAt
            ? { ...c, unread: 0, mentionsMe: 0 }
            : c,
        );
        set({ channels, channelsError: null, ...counters(channels) });
      } catch (e) {
        if (get().currentOrgKey === key) set({ channelsError: apiErrorText(e) });
      }
    },

    /** The reader reached the end of a channel: its badge clears here before the server confirms. */
    markChannelRead: (channelId) => {
      const state = get();
      const readAt = new Map(state.channelReadAt);
      readAt.set(channelId, Date.now());
      const channels =
        state.channels === null
          ? null
          : state.channels.map((c) =>
              c.channelId === channelId ? { ...c, unread: 0, mentionsMe: 0 } : c,
            );
      set({
        channelReadAt: readAt,
        channels,
        ...(channels === null ? {} : counters(channels)),
      });
    },

    reloadOrganizations: async (projectIds) => {
      set({ orgsLoading: true });
      try {
        const lists = await Promise.all(
          projectIds.map((projectId) =>
            api
              .listOrganizations(projectId)
              .then((res) => res.organizations)
              // One Project's failure (lost access, a transient error) must not hide the
              // rest — but it is recorded, since the shortened list is not evidence that
              // anything was deleted (forgetMissingOrganizations).
              .catch(() => null),
          ),
        );
        set({
          organizations: lists.filter((list) => list !== null).flat(),
          orgsLoaded: true,
          orgsPartial: lists.some((list) => list === null),
        });
      } finally {
        set({ orgsLoading: false });
      }
    },

    /**
     * Drops the open and the remembered organization when the settled list no longer holds
     * them — a deletion, or access lost. Neither key is a cache the shell can afford to keep
     * stale: `currentOrgKey` is what the channel listing and the roster are fetched for (a
     * deleted organization answers 404 and the sidebar shows a load failure), and
     * `lastOrgKey` is where `/org` lands, so a stale one sends every later visit at an
     * organization that is gone. The remembered key is cleared in all three places it lives:
     * the store, the localStorage mirror and the server preference — written as an empty
     * string, which `parseOrgKey` reads as none (`UiPrefs.lastOrgKey` is a string).
     *
     * A partial list is not evidence: one Project's listing failing would otherwise forget an
     * organization that is merely unreachable this minute.
     */
    forgetMissingOrganizations: () => {
      const state = get();
      if (!state.orgsLoaded || state.orgsPartial) return;
      const known = (key: string | null): boolean => {
        const parsed = parseOrgKey(key);
        if (parsed === null) return false;
        return state.organizations.some(
          (o) => o.projectId === parsed.projectId && o.orgId === parsed.orgId,
        );
      };
      if (state.currentOrgKey !== null && !known(state.currentOrgKey)) {
        get().setCurrentOrg(null);
      }
      if (get().lastOrgKey !== null && !known(get().lastOrgKey)) {
        clearLastOrgKey();
        set({ lastOrgKey: null });
        void api.putPrefs({ lastOrgKey: "" }).catch(() => undefined);
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

    setDeskMessagingChannel: (sessionId, channel) => {
      // A Session id is unique across organizations, so every entry is asked and at most one
      // changes; nothing is set when none does.
      let changed = false;
      const next = new Map<string, OrgSessionsResponse>();
      for (const [key, sessions] of get().orgSessions) {
        const patched = withDeskMessagingChannel(sessions, sessionId, channel);
        if (patched !== sessions) changed = true;
        next.set(key, patched);
      }
      if (changed) set({ orgSessions: next });
    },

    /**
     * Re-reads the open organization's chart (the 工位 group's roster). A response for an
     * organization the shell has since left is dropped, and a failure leaves whatever the
     * group already shows: the roster changes only when someone hires or offboards, so a
     * stale list is a better answer than an empty one.
     */
    reloadOrgChart: async (projectId, orgId) => {
      const key = orgKey(projectId, orgId);
      try {
        const chart = await api.getOrgChart(projectId, orgId);
        if (get().currentOrgKey === key) set({ orgChart: chart, orgChartError: null });
      } catch (e) {
        if (get().currentOrgKey === key) set({ orgChartError: apiErrorText(e) });
      }
    },

    /**
     * Opens a ticket's detail dialog. Another ticket of the organization already on screen is
     * pushed onto the back stack — that is a parent or a child followed from inside the dialog,
     * and the reader has to be able to come back — while a ticket of another organization, or
     * the first one opened, starts a fresh stack. Re-opening the ticket already shown does
     * nothing, so a deep link the page has just written into its own query cannot stack a
     * ticket on top of itself.
     */
    openTicket: (projectId, orgId, ticketId) => {
      const open = get().ticketDialog;
      const target = { projectId, orgId, ticketId };
      if (open === null || open.projectId !== projectId || open.orgId !== orgId) {
        set({ ticketDialog: target, ticketStack: [] });
        return;
      }
      if (open.ticketId === ticketId) return;
      set({ ticketDialog: target, ticketStack: [...get().ticketStack, open.ticketId] });
    },

    closeTicket: () => {
      if (get().ticketDialog === null) return;
      set({ ticketDialog: null, ticketStack: [] });
    },

    /** Back to the ticket this one was opened from; nothing to do with an empty stack. */
    backTicket: () => {
      const { ticketDialog, ticketStack } = get();
      const previous = ticketStack[ticketStack.length - 1];
      if (ticketDialog === null || previous === undefined) return;
      set({
        ticketDialog: { ...ticketDialog, ticketId: previous },
        ticketStack: ticketStack.slice(0, -1),
      });
    },

    /**
     * A ticket was written from this browser (the dialog's saves, the board's moves). The
     * writer's own request carries the change back to it alone, so the version the other
     * surfaces watch is bumped here exactly as the scheduler's event would bump it — the board,
     * the finance ledger and the organization summaries refetch off one signal instead of each
     * writer reloading its neighbours by hand.
     */
    ticketsChanged: () => {
      const versions = get().versions;
      set({ versions: { ...versions, tickets: versions.tickets + 1, orgs: versions.orgs + 1 } });
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
        versions.messages += 1;
        // The open organization's counters move with the channel the message landed in; a
        // message the user sent themselves is read by definition, and a channel the user is
        // not in is waiting for nobody. `mentionsMe` counts the user's own principal only —
        // the same rule the server's listing applies, so the optimistic bump and the refresh
        // that follows it agree.
        const channels = state.channels;
        if (
          key === state.currentOrgKey &&
          channels !== null &&
          ev.message.sender !== `user:${userId ?? ""}`
        ) {
          const addressed = ev.message.mentions.includes(`user:${userId ?? ""}`);
          const next = channels.map((c) =>
            c.channelId === ev.channelId && c.isMember
              ? {
                  ...c,
                  unread: c.unread + 1,
                  mentionsMe: c.mentionsMe + (addressed ? 1 : 0),
                  lastMessageAt: ev.message.time,
                }
              : c,
          );
          set({ channels: next, ...counters(next) });
        }
      }
      set({ versions });
    },

    /**
     * Events were lost (see publishCompanyResync): re-read the snapshots that carry run state
     * through the versions that already drive them — `runs` the sessions route, `orgs` the
     * organization list and the open chart — so the surfaces stand on current state again.
     */
    resync: () => {
      const versions = get().versions;
      set({ versions: { ...versions, runs: versions.runs + 1, orgs: versions.orgs + 1 } });
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
  /** The open organization's channels; null until the first listing arrives. */
  channels: OrgChannelItem[] | null;
  channelsError: string | null;
  /** Unread and @me summed over the channels the user belongs to — the sidebar's and the rail's badges. */
  channelUnread: number;
  channelMentions: number;
  reloadChannels: () => Promise<void>;
  markChannelRead: (channelId: string) => void;
  /** Desk and ticket Sessions of every organization of the current Project, keyed by org key. */
  orgSessions: ReadonlyMap<string, OrgSessionsResponse>;
  /** Writes a desk's messaging binding change into `orgSessions` (null = unbound), so its row's mark follows at once. */
  setDeskMessagingChannel: (sessionId: string, channel: MessagingChannel | null) => void;
  /** The open organization's employees, in chart order; null until the first read. */
  orgChart: OrgChartResponse | null;
  orgChartError: string | null;
  reloadOrgChart: () => Promise<void>;
  /** The ticket the detail dialog is showing; null when it is closed. */
  ticketDialog: TicketDialogTarget | null;
  /** How many tickets the dialog can go back through (the parents and children followed inside it). */
  ticketBackDepth: number;
  openTicket: (projectId: string, orgId: string, ticketId: string) => void;
  closeTicket: () => void;
  backTicket: () => void;
  /** Say that a ticket was written here, so every surface that lists tickets refetches. */
  ticketsChanged: () => void;
  versions: CompanyVersions;
  reloadOrganizations: () => Promise<void>;
  reloadOrgSessions: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const { user, companyMode } = useAuth();
  const { projects, currentProject } = useProject();
  const [store] = useState(() => createCompanyStore({ serverEnabled: companyMode }));
  const state = useStore(store);
  const { serverEnabled } = state;
  const userId = user?.userId ?? null;
  const currentProjectId = currentProject?.projectId ?? null;
  const projectIdsKey = projects.map((p) => p.projectId).join(",");

  // The server's master switch reaches the store on mount and on every later read of /api/me
  // (the admin's own flip refreshes it). Seen off, the store puts the chosen mode back to
  // development, which is what keeps turning the switch on from entering company mode.
  useEffect(() => {
    store.getState().setServerEnabled(companyMode);
  }, [store, companyMode]);

  // Preferences: the stored switch, mode and last organization win over the localStorage
  // mirrors once they arrive. Read once per signed-in user.
  useEffect(() => {
    if (userId === null) return;
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled) store.getState().applyPrefs(res.prefs);
      })
      // Unreachable preferences leave the localStorage mirrors standing; nothing here is critical.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [store, userId]);

  // The organization list spans every Project the user can reach; it refreshes when the
  // Project set changes and whenever an event says a summary moved.
  const { orgs: orgsVersion, runs: runsVersion, tickets: ticketsVersion } = state.versions;
  useEffect(() => {
    if (!serverEnabled || projectIdsKey === "") {
      store.setState({
        organizations: [],
        orgsLoaded: false,
        orgsPartial: false,
        orgSessions: new Map(),
      });
      return;
    }
    void store.getState().reloadOrganizations(projectIdsKey.split(","));
  }, [store, serverEnabled, projectIdsKey, orgsVersion]);

  const { orgsLoaded, orgsPartial } = state;
  const orgListKey = state.organizations.map((o) => orgKey(o.projectId, o.orgId)).join(",");

  // A deleted organization must not leave the shell aimed at it. The list is the only place
  // that knows: once it has settled, the open key and the remembered one are checked against
  // it, so the sidebar drops to its no-organization shape instead of failing to load the
  // channels of something that is gone.
  useEffect(() => {
    store.getState().forgetMissingOrganizations();
  }, [store, orgsLoaded, orgsPartial, orgListKey]);

  // The current Project's desk and ticket Sessions: the company sidebar lists them, and the
  // development sidebar folds them into an "organization" folder.
  // Keyed on the list's identity as well: a newly created organization has no sessions entry
  // until its first event otherwise.
  useEffect(() => {
    if (!serverEnabled || currentProjectId === null || !orgsLoaded) return;
    void store.getState().reloadOrgSessions(currentProjectId);
  }, [store, serverEnabled, currentProjectId, orgsLoaded, orgListKey, runsVersion, ticketsVersion]);

  // The open organization's channels: the sidebar's list and every badge on it. Re-read when
  // the organization changes and whenever a message event says one of its counters moved —
  // the listing carries the server's read cursors, which no client-side bump can know.
  const { currentOrgKey, versions } = state;
  const messageVersion = versions.messages;
  useEffect(() => {
    const open = parseOrgKey(currentOrgKey);
    if (!serverEnabled || open === null) return;
    void store.getState().reloadChannels(open.projectId, open.orgId);
  }, [store, serverEnabled, currentOrgKey, messageVersion]);

  // The open organization's roster: the sidebar's 工位 group has a row per employee, desk or
  // no desk. Re-read when the organization changes and when a run or a personnel change
  // (both bump `orgs`) says the chart moved.
  useEffect(() => {
    const open = parseOrgKey(currentOrgKey);
    if (!serverEnabled || open === null) return;
    void store.getState().reloadOrgChart(open.projectId, open.orgId);
  }, [store, serverEnabled, currentOrgKey, orgsVersion]);

  // In company mode the shell always has a current organization: the one its sidebar names.
  // The organization routes announce it, but a desk or ticket conversation lives at
  // `/chat/:sessionId` — reload there and no route ever would, which used to leave the
  // channel list on a skeleton and the 工位 group without its roster. The organization last
  // opened is exactly what the sidebar is already showing, so the shell adopts it.
  const { workMode, personalEnabled, lastOrgKey } = state;
  useEffect(() => {
    if (!serverEnabled || !personalEnabled || workMode !== "company") return;
    if (currentOrgKey !== null || lastOrgKey === null) return;
    store.getState().setCurrentOrg(lastOrgKey);
  }, [store, serverEnabled, personalEnabled, workMode, currentOrgKey, lastOrgKey]);

  useEffect(
    () => subscribeCompanyEvents((ev) => store.getState().applyCompanyEvent(ev, userId)),
    [store, userId],
  );
  useEffect(() => subscribeCompanyResync(() => store.getState().resync()), [store]);

  const value = useMemo<CompanyContextValue>(() => {
    const available = companyModeAvailable(state);
    const shownKey = state.currentOrgKey ?? state.lastOrgKey;
    const shown = parseOrgKey(shownKey);
    const currentOrg =
      shown === null
        ? null
        : (state.organizations.find(
            (o) => o.projectId === shown.projectId && o.orgId === shown.orgId,
          ) ?? null);
    return {
      serverEnabled: state.serverEnabled,
      personalEnabled: state.personalEnabled,
      available,
      workMode: effectiveWorkMode(state),
      setWorkMode: state.setWorkMode,
      setPersonalEnabled: state.setPersonalEnabled,
      organizations: state.organizations,
      orgsLoading: state.orgsLoading,
      orgsLoaded: state.orgsLoaded,
      currentOrgKey: state.currentOrgKey,
      currentOrg,
      lastOrgKey: state.lastOrgKey,
      setCurrentOrg: state.setCurrentOrg,
      channels: state.channels,
      channelsError: state.channelsError,
      channelUnread: state.channelUnread,
      channelMentions: state.channelMentions,
      reloadChannels: () => {
        const open = parseOrgKey(state.currentOrgKey);
        return open === null ? Promise.resolve() : state.reloadChannels(open.projectId, open.orgId);
      },
      markChannelRead: state.markChannelRead,
      orgSessions: state.orgSessions,
      setDeskMessagingChannel: state.setDeskMessagingChannel,
      orgChart: state.orgChart,
      orgChartError: state.orgChartError,
      reloadOrgChart: () => {
        const open = parseOrgKey(state.currentOrgKey);
        return open === null ? Promise.resolve() : state.reloadOrgChart(open.projectId, open.orgId);
      },
      ticketDialog: state.ticketDialog,
      ticketBackDepth: state.ticketStack.length,
      openTicket: state.openTicket,
      closeTicket: state.closeTicket,
      backTicket: state.backTicket,
      ticketsChanged: state.ticketsChanged,
      versions: state.versions,
      reloadOrganizations: () =>
        state.reloadOrganizations(projectIdsKey === "" ? [] : projectIdsKey.split(",")),
      reloadOrgSessions: () =>
        currentProjectId === null ? Promise.resolve() : state.reloadOrgSessions(currentProjectId),
    };
  }, [state, projectIdsKey, currentProjectId]);

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const ctx = useContext(CompanyContext);
  if (!ctx) throw new Error("useCompany must be used within a CompanyProvider");
  return ctx;
}
