/**
 * Session list context for all Agents in the current Project:
 * the sidebar groups by Agent, so all Agents' Sessions are loaded at once (fetched in parallel);
 * the chat page shares this same data for status sync / title events / self-healing reload.
 *
 * **Paged per (Agent, category)**: the default load fetches only the **active** category
 * (user-created, non-archived) plus per-category totals — archived / subagent / schedule
 * Sessions are not loaded until their collapsed folder is opened. Each pair fetches
 * SIDEBAR_PAGE_SIZE sessions per page (requesting one extra to detect "has more" — see
 * splitPage); `loadMoreFor` fetches a pair's first page when unloaded and the next page
 * otherwise (deduplicated by sessionId — new sessions shift server offsets), so every
 * category's paging is independent of the others. A reload resets each **loaded** pair
 * back to its first page (an open folder must not blank on an event-triggered refresh)
 * and leaves unopened folders unloaded.
 *
 * **Sessions are not auto-created here**: a new conversation starts as a draft (chat page `/chat/new`),
 * and the Session is only actually created when the first message is sent — after landing, the user
 * may still switch models or configure an API key first, so persisting the Session early would both
 * lock in the model and fail outright when no credential is configured yet.
 *
 * State lives in a zustand vanilla store (one instance per Provider mount); the Provider is a
 * thin lifecycle component (initial fetch, refetch on Project/Agent-set/filter changes, the
 * user-event subscription) and republishes the store's state through the same context value
 * as before. Mutations read current values via store.getState() (the old refs' job).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ServerEvent,
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import { useStore } from "zustand/react";
import { createStore } from "zustand/vanilla";
import * as api from "../api/endpoints";
import { openUserEvents } from "../api/sse";
import {
  FOLDER_CATEGORIES,
  SIDEBAR_PAGE_SIZE,
  sessionCategory,
  splitPage,
} from "../lib/session-grouping";
import { useProject } from "./project";

interface SessionsContextValue {
  /** Loaded list (paged per Agent and category; each Agent's entries newest first). */
  sessions: SessionInfo[];
  /** agentId → that Agent's loaded Session list, newest first (empty array if none). */
  byAgent: ReadonlyMap<string, SessionInfo[]>;
  /** agentId → per-category totals from the last list fetch (folder labels; kept in step locally on add / remove / archive toggles). */
  countsByAgent: ReadonlyMap<string, SessionCategoryCounts>;
  /** agentId → the same totals broken down by Workspace path (workspace-mode groups read their own share from it; maintained like countsByAgent). */
  workspaceCountsByAgent: ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>;
  /** Whether a pair's first page has been fetched (false = the folder shows nothing because nothing was asked for yet). */
  isLoadedFor: (agentId: string, category: SessionCategory) => boolean;
  /** Whether the server still holds unfetched Sessions of a category for an Agent — an unloaded pair answers from the counts. */
  hasMoreFor: (agentId: string, category: SessionCategory) => boolean;
  loading: boolean;
  reload: () => Promise<void>;
  /** Fetches a category's first page for each given unloaded Agent and the next page for each loaded one with more (no-op otherwise). */
  loadMoreFor: (agentIds: string[], category: SessionCategory) => Promise<void>;
  /** Prepend to the list on success (draft materialized by the first message, or explicit creation via dialog). */
  add: (session: SessionInfo) => void;
  /** Remove from the list in place after deletion (also tombstones the id — see isDeleted). */
  remove: (sessionId: string) => void;
  /**
   * Whether this client deleted the Session during this page's lifetime. A row missing from
   * the paged list normally means "not fetched yet", which the chat page resolves with a
   * direct lookup; for an id we deleted ourselves that lookup is guaranteed to 404, so
   * callers consult this first and skip the request entirely.
   */
  isDeleted: (sessionId: string) => boolean;
  /** Replace the whole entry with the PATCH result. */
  replace: (session: SessionInfo) => void;
  /**
   * Live run status of one row — from the open Session's own stream (`task_state`), and from
   * the user channel (`session_state`) for every row this tab is not subscribed to. `row` is
   * the server's own fields riding the user-channel event; the Session stream has none to give.
   */
  setStatus: (sessionId: string, status: SessionStatus, row?: LiveRowFields) => void;
  /** session_title server event → update the title in place. */
  setTitle: (sessionId: string, title: string) => void;
  /** Whether CLI-created Sessions are listed too (persisted per user; default off = the list is served from the DB without Trace scanning). */
  showCliSessions: boolean;
  /** Flip the CLI-session preference: persists it and refetches the whole list under the new filter. */
  setShowCliSessions: (value: boolean) => void;
}

/**
 * The row fields a `session_state` event carries alongside the status, straight from the
 * server's row. Both are needed to draw the glyph without refetching the list: `lastActiveAt`
 * decides read vs unread against the seen marker, and `hasTrace` decides settled vs never-ran.
 */
export interface LiveRowFields {
  lastActiveAt: string;
  hasTrace: boolean;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

/** Page-state key of one (Agent, category) pair ("\0" never appears in Agent ids). */
const pageKey = (agentId: string, category: SessionCategory) => `${agentId}\0${category}`;

/** One pair's paging cursor. */
interface PagePosition {
  /** Whether the server still has unfetched rows past `fetched`. */
  hasMore: boolean;
  /**
   * Rows consumed from the server's category stream — the exact offset of the next
   * page. Deliberately NOT derived from the loaded list: `add()` prepends rows that
   * were never part of any page (deep-link self-heal), and counting those would skip
   * a server row on the next fetch.
   */
  fetched: number;
}

/** Store state: the context value's raw ingredients plus the mutation functions (byAgent / isLoadedFor / hasMoreFor are derived in the Provider). */
interface SessionsStoreState {
  /** Provider-synced fetch context: the current Project and its Agent set (what reload() targets). */
  projectId: string | null;
  agentIds: string[];

  sessions: SessionInfo[];
  /**
   * Ids this client deleted during the page's lifetime (see isDeleted). Deliberately kept
   * OUTSIDE the rendered state: it must not be read as "the list changed", and nothing
   * renders from it — consumers only ask whether a specific id is in it.
   */
  deletedSessionIds: ReadonlySet<string>;
  /** pageKey → that pair's paging cursor; a key is present iff its first page has been fetched. */
  pageState: ReadonlyMap<string, PagePosition>;
  countsByAgent: ReadonlyMap<string, SessionCategoryCounts>;
  workspaceCountsByAgent: ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>;
  loading: boolean;
  // "Show CLI sessions" preference: server-persisted per user (ui_prefs); hydrated once by the
  // Provider on mount, default off. Changing it makes the Provider's reset effect refetch the
  // whole list under the new filter.
  showCliSessions: boolean;

  reload: () => Promise<void>;
  loadMoreFor: (agentIds: string[], category: SessionCategory) => Promise<void>;
  add: (session: SessionInfo) => void;
  remove: (sessionId: string) => void;
  replace: (session: SessionInfo) => void;
  setStatus: (sessionId: string, status: SessionStatus, row?: LiveRowFields) => void;
  setTitle: (sessionId: string, title: string) => void;
  setShowCliSessions: (value: boolean) => void;
}

/**
 * Cap on remembered deleted ids. Session ids are never reused, so a tombstone never expires
 * on correctness grounds — this only keeps a very long-lived tab from growing the set without
 * bound. Evicts oldest-first (Sets iterate in insertion order); the only cost of dropping a
 * tombstone is that a re-visit of that dead id would fall back to the (404-ing) lookup again.
 */
const DELETED_IDS_MAX = 500;

/**
 * Builds one Provider's store. Exported as a test seam: vitest runs this package in Node with
 * no DOM, so the list's own behaviour is exercised against the store directly rather than
 * through a React tree.
 */
export function createSessionsStore() {
  // Generation counter: invalidates any in-flight response once the Project/Agent set
  // changes or a reload happens.
  let gen = 0;

  return createStore<SessionsStoreState>((set, get) => {
    /** Keeps an Agent's category totals — overall and per Workspace — in step with a local list mutation of `session` (no-op while its counts are unknown). */
    const adjustCount = (session: SessionInfo, category: SessionCategory, delta: number) => {
      const { agentId, workspace } = session;
      const counts = get().countsByAgent;
      const cur = counts.get(agentId);
      if (cur) {
        const next = new Map(counts);
        next.set(agentId, { ...cur, [category]: Math.max(0, cur[category] + delta) });
        set({ countsByAgent: next });
      }
      const workspaceCounts = get().workspaceCountsByAgent;
      const wsCur = workspaceCounts.get(agentId);
      if (wsCur) {
        const ws = wsCur[workspace] ?? { active: 0, subagent: 0, schedule: 0, archived: 0 };
        const next = new Map(workspaceCounts);
        next.set(agentId, {
          ...wsCur,
          [workspace]: { ...ws, [category]: Math.max(0, ws[category] + delta) },
        });
        set({ workspaceCountsByAgent: next });
      }
    };

    return {
      projectId: null,
      agentIds: [],

      sessions: [],
      deletedSessionIds: new Set(),
      pageState: new Map(),
      countsByAgent: new Map(),
      workspaceCountsByAgent: new Map(),
      loading: true,
      showCliSessions: false,

      reload: async () => {
        const { projectId, agentIds, showCliSessions } = get();
        if (!projectId || agentIds.length === 0) return;
        const g = ++gen;
        set({ loading: true });
        try {
          const results = await Promise.all(
            agentIds.map(async (agentId) => {
              // Active first page (with per-category totals) always; plus the first page of
              // every folder category already on screen — a reload triggered by a server
              // event must refresh, not blank, an open folder.
              const categories: SessionCategory[] = [
                "active",
                ...FOLDER_CATEGORIES.filter((cat) => get().pageState.has(pageKey(agentId, cat))),
              ];
              try {
                const pages = await Promise.all(
                  categories.map(async (category) => {
                    const res = await api.listSessions(projectId, agentId, {
                      offset: 0,
                      limit: SIDEBAR_PAGE_SIZE + 1,
                      category,
                      ...(category === "active" ? { withCounts: true } : {}),
                      ...(showCliSessions ? { cli: true } : {}),
                    });
                    return {
                      category,
                      counts: res.counts,
                      workspaceCounts: res.workspaceCounts,
                      ...splitPage(res.sessions, SIDEBAR_PAGE_SIZE),
                    };
                  }),
                );
                return { agentId, pages };
              } catch {
                // A single Agent's fetch failure shouldn't bring down the whole batch (e.g. its directory was deleted externally).
                return { agentId, pages: [] };
              }
            }),
          );
          if (g !== gen) return;
          const nextSessions: SessionInfo[] = [];
          const seen = new Set<string>();
          const nextPageState = new Map<string, PagePosition>();
          const nextCounts = new Map<string, SessionCategoryCounts>();
          const nextWorkspaceCounts = new Map<
            string,
            Readonly<Record<string, SessionCategoryCounts>>
          >();
          for (const r of results) {
            for (const p of r.pages) {
              nextPageState.set(pageKey(r.agentId, p.category), {
                hasMore: p.hasMore,
                fetched: p.items.length,
              });
              if (p.counts) nextCounts.set(r.agentId, p.counts);
              if (p.workspaceCounts) nextWorkspaceCounts.set(r.agentId, p.workspaceCounts);
              for (const s of p.items) {
                if (!seen.has(s.sessionId)) {
                  seen.add(s.sessionId);
                  nextSessions.push(s);
                }
              }
            }
          }
          set({
            sessions: nextSessions,
            pageState: nextPageState,
            countsByAgent: nextCounts,
            workspaceCountsByAgent: nextWorkspaceCounts,
          });
        } finally {
          if (g === gen) set({ loading: false });
        }
      },

      /**
       * Category page fetch for each given Agent: the first page when the pair is unloaded
       * (skipped unless the counts say the category holds anything), the next page when
       * loaded with more. The offset is the pair's `fetched` cursor — rows actually
       * consumed from the server's stream, never rows `add()` slipped in. A session
       * created since the last page still shifts server offsets, so appended rows are
       * deduplicated by sessionId (a short page is fine — `hasMore` comes from the server
       * response, and the next click continues from the advanced cursor).
       */
      loadMoreFor: async (agentIds, category) => {
        const { projectId, showCliSessions } = get();
        if (!projectId) return;
        const targets = [...new Set(agentIds)].filter((agentId) => {
          const position = get().pageState.get(pageKey(agentId, category));
          if (position === undefined)
            return (get().countsByAgent.get(agentId)?.[category] ?? 0) > 0;
          return position.hasMore;
        });
        if (targets.length === 0) return;
        const g = gen;
        const results = await Promise.all(
          targets.map(async (agentId) => {
            const offset = get().pageState.get(pageKey(agentId, category))?.fetched ?? 0;
            try {
              const fetched = (
                await api.listSessions(projectId, agentId, {
                  offset,
                  limit: SIDEBAR_PAGE_SIZE + 1,
                  category,
                  ...(showCliSessions ? { cli: true } : {}),
                })
              ).sessions;
              return { agentId, ...splitPage(fetched, SIDEBAR_PAGE_SIZE) };
            } catch {
              // Transient failure: leave the pair's state untouched (still unloaded / still
              // has-more), so the affordance stays and the user can retry.
              return null;
            }
          }),
        );
        if (g !== gen) return; // Project switch / reload raced this page: drop it.
        const ok = results.filter((r) => r !== null);
        const prev = get().sessions;
        const seen = new Set(prev.map((s) => s.sessionId));
        const appended = ok.flatMap((r) => r.items.filter((s) => !seen.has(s.sessionId)));
        const prevPageState = get().pageState;
        const nextPageState = new Map(prevPageState);
        for (const r of ok) {
          const key = pageKey(r.agentId, category);
          nextPageState.set(key, {
            hasMore: r.hasMore,
            fetched: (prevPageState.get(key)?.fetched ?? 0) + r.items.length,
          });
        }
        set({
          ...(appended.length > 0 ? { sessions: [...prev, ...appended] } : {}),
          pageState: nextPageState,
        });
      },

      add: (session) => {
        // Invalidate any in-flight reload: the newly created entry mustn't be wiped by a stale snapshot.
        gen += 1;
        // Count the row only when the pair's fetched pages provably held its whole category
        // (loaded, no more): the row is then genuinely new to the server totals. Otherwise
        // (deep-link self-heal of an unfetched row) the counts already include it — a
        // possible one-off drift self-heals on the next reload.
        const existed = get().sessions.some((s) => s.sessionId === session.sessionId);
        if (
          !existed &&
          get().pageState.get(pageKey(session.agentId, sessionCategory(session)))?.hasMore === false
        ) {
          adjustCount(session, sessionCategory(session), 1);
        }
        set({
          sessions: [session, ...get().sessions.filter((s) => s.sessionId !== session.sessionId)],
        });
      },

      remove: (sessionId) => {
        // Invalidate any in-flight reload: the deletion mustn't be undone by a stale snapshot.
        gen += 1;
        const row = get().sessions.find((s) => s.sessionId === sessionId);
        if (row) adjustCount(row, sessionCategory(row), -1);
        // Tombstone BEFORE pruning the list, in the same update: consumers re-render on the
        // pruned list, and any of them that reacts to the row's disappearance (the chat
        // page's deep-link lookup) must already be able to see that the id is dead rather
        // than merely unfetched — otherwise it fires a request that can only 404.
        const deleted = new Set(get().deletedSessionIds);
        deleted.add(sessionId);
        while (deleted.size > DELETED_IDS_MAX) {
          const oldest = deleted.values().next();
          if (oldest.done) break;
          deleted.delete(oldest.value);
        }
        set({
          deletedSessionIds: deleted,
          sessions: get().sessions.filter((s) => s.sessionId !== sessionId),
        });
      },

      replace: (session) => {
        // An archive toggle moves the row across categories: keep the folder totals in step.
        const old = get().sessions.find((s) => s.sessionId === session.sessionId);
        if (old && sessionCategory(old) !== sessionCategory(session)) {
          adjustCount(session, sessionCategory(old), -1);
          adjustCount(session, sessionCategory(session), 1);
        }
        set({
          sessions: get().sessions.map((s) => (s.sessionId === session.sessionId ? session : s)),
        });
      },

      /**
       * A status flip changes more of the row than the status, because the glyph is drawn from
       * three fields, not one (see session-activity.ts). The user-channel `session_state` event
       * carries the other two from the server's own row; the open Session's stream calls this
       * with two arguments, having none to give.
       *
       * - `lastActiveAt` is what makes a background completion legible: the read/unread split
       *   compares it against the seen marker (session-seen.ts), so without the server's new
       *   stamp a Session that finished while the user was elsewhere would settle into the
       *   muted "already read" glyph — the exact case the user needs to notice.
       * - `hasTrace` is what keeps a FIRST run from settling into nothing at all. It separates
       *   "finished" from "never ran", and a Session running its first Task still has the
       *   `false` its list row was fetched with: the hourglass shows (status wins), and then
       *   the moment it stops the row would go blank.
       *
       * `hasTrace` is therefore treated as monotonic, and a live status is itself proof the
       * Session has run — server-side it is a one-way cache (`has_trace = 1`, never cleared)
       * set at run start, and a running Session has by definition started a Task. That second
       * half is what keeps the two callers consistent: the Session stream carries no flag, so
       * on its own it would settle a first run into a blank row until the next list fetch.
       *
       * An id no loaded page holds is dropped rather than turned into a row: the event names a
       * Session, it does not describe one, and a row invented from a status and a timestamp
       * would have no title, Agent or Workspace to render. That same drop is what filters
       * another Project's Sessions — this store only ever holds the current Project's rows.
       */
      setStatus: (sessionId, status, row) => {
        const prev = get().sessions;
        const target = prev.find((s) => s.sessionId === sessionId);
        if (!target) return;
        const lastActiveAt = row?.lastActiveAt ?? target.lastActiveAt;
        const live = status === "running" || status === "compacting";
        const hasTrace = target.hasTrace || row?.hasTrace === true || live;
        if (
          target.status === status &&
          target.lastActiveAt === lastActiveAt &&
          target.hasTrace === hasTrace
        ) {
          return;
        }
        set({
          sessions: prev.map((s) =>
            s.sessionId === sessionId ? { ...s, status, lastActiveAt, hasTrace } : s,
          ),
        });
      },

      /**
       * Same drop rule as `setStatus`: an id no loaded page holds is ignored rather than
       * turned into a row. The title now arrives on the user channel too, which carries every
       * Session of every Project this user can see — most of them absent from this list — and
       * both channels deliver the same title to a tab subscribed to both. Replacing the array
       * either way would re-render every row for nothing.
       */
      setTitle: (sessionId, title) => {
        const prev = get().sessions;
        const target = prev.find((s) => s.sessionId === sessionId);
        if (!target || target.title === title) return;
        set({
          sessions: prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s)),
        });
      },

      setShowCliSessions: (value) => {
        set({ showCliSessions: value });
        // Fire-and-forget: PUT /me/prefs merges shallowly; a lost write only costs persistence,
        // the in-memory toggle already took effect.
        void api.putPrefs({ showCliSessions: value }).catch(() => undefined);
      },
    };
  });
}

/** The vanilla store backing one Provider mount. */
export type SessionsStore = ReturnType<typeof createSessionsStore>;

/**
 * Routes one user-level server event (/api/events) into the list store.
 *
 * That connection is the only one that outlives every Project switch and every conversation
 * the user opens, which is why the list's cross-Session facts arrive on it rather than on a
 * Session channel. Split out from the subscription so this routing is testable without a React
 * tree or an EventSource, neither of which exists in this package's Node test environment.
 *
 * `onWebUpdated` is the escape hatch for the one event that is not a list update at all.
 */
export function applyUserEvent(
  store: SessionsStore,
  ev: ServerEvent,
  onWebUpdated: () => void,
): void {
  // The served web assets were hot-swapped (dev watch-push / platform upgrade): reload so this
  // window runs the new code.
  if (ev.type === "web_updated") {
    onWebUpdated();
    return;
  }
  // A Session changed run state. This is what keeps every row honest: a tab subscribes to the
  // ONE conversation it has open, so its `task_state` events can only ever move that row's
  // badge. Everything else — the Session the user just navigated away from, a run started from
  // another tab, a schedule, a subagent — would otherwise sit on whatever status the last list
  // fetch happened to return.
  if (ev.type === "session_state") {
    store.getState().setStatus(ev.sessionId, ev.state, {
      lastActiveAt: ev.lastActiveAt,
      hasTrace: ev.hasTrace,
    });
    return;
  }
  // A title landed. Titles generate at Task start, before the brand-new Session's own
  // channel has any subscriber (the tab is still navigating from the draft), so the user
  // channel is the delivery that reliably updates the list row — and rows this tab never
  // opens (another tab's session, a subagent) get their titles the same way.
  if (ev.type === "session_title") {
    store.getState().setTitle(ev.sessionId, ev.title);
    return;
  }
  // The reconnect landed outside the channel's replay buffer, so an unknown number of the flips
  // above were lost — away long enough and a row sits on an hourglass that will never stop.
  // Refetch once, on the event that says so, rather than polling for it.
  if (ev.type === "resync_required") {
    void store.getState().reload();
    return;
  }
  // A scheduled task firing may have created a new Session (new-session mode); reload the list
  // so it appears immediately. schedule_queued doesn't change the list (the target Session
  // already exists), so it is ignored, as is every other Session-scoped event.
  if (ev.type !== "schedule_fired") return;
  // The event carries projectId: a trigger from another Project is unrelated to the current list.
  if (ev.projectId === store.getState().projectId) void store.getState().reload();
}

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Stable key for the Agent set: the list object is a new reference on every reload,
  // so join the ids to avoid unnecessary reloads.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");

  const [store] = useState(createSessionsStore);
  const state = useStore(store);

  // Hydrate the "show CLI sessions" preference once on mount (a bare setState, not the
  // setShowCliSessions action: hydration must not write the preference back).
  useEffect(() => {
    let cancelled = false;
    void api
      .getPrefs()
      .then((res) => {
        if (!cancelled && res.prefs.showCliSessions === true)
          store.setState({ showCliSessions: true });
      })
      .catch(() => undefined); // Unreachable prefs: stay with the default (web only).
    return () => {
      cancelled = true;
    };
  }, [store]);

  const { showCliSessions } = state;
  useEffect(() => {
    // Sync the fetch context and reset the loaded pages in the same synchronous step:
    // reload() picks the categories to refetch from pageState, so a Project switch can't
    // carry folder page state across via shared Agent ids (default_agent exists in every
    // Project). Also reruns on a showCliSessions flip: refetch the whole list under the
    // new filter.
    // deletedSessionIds is deliberately NOT reset: session ids are globally unique and never
    // reused, so a Session deleted before a Project switch is still deleted after it — and
    // re-arming its lookup would just re-create the 404 this set exists to prevent.
    store.setState({
      projectId,
      agentIds: agentIdsKey === "" ? [] : agentIdsKey.split(","),
      sessions: [],
      pageState: new Map(),
      countsByAgent: new Map(),
      workspaceCountsByAgent: new Map(),
    });
    void store.getState().reload();
  }, [store, projectId, agentIdsKey, showCliSessions]);

  // User-level event stream (/api/events); see applyUserEvent for what each event does. The
  // connection stays a single one for the whole login session and doesn't reconnect on Project
  // switches, so the handler reads current values through store.getState() rather than closing
  // over them.
  useEffect(() => {
    const conn = openUserEvents({
      onOmniMessage: () => undefined,
      onServerEvent: (ev) => applyUserEvent(store, ev, () => window.location.reload()),
    });
    return () => conn.close();
  }, [store]);

  const { pageState, countsByAgent } = state;
  const isLoadedFor = useCallback(
    (agentId: string, category: SessionCategory) => pageState.has(pageKey(agentId, category)),
    [pageState],
  );

  const hasMoreFor = useCallback(
    (agentId: string, category: SessionCategory) => {
      const position = pageState.get(pageKey(agentId, category));
      if (position !== undefined) return position.hasMore;
      // Unloaded pair: anything the counts report is by definition still unfetched.
      return (countsByAgent.get(agentId)?.[category] ?? 0) > 0;
    },
    [pageState, countsByAgent],
  );

  // Reads the store directly rather than the subscribed snapshot: this answers "is this id
  // already dead", and a caller asking that inside an effect must get the newest answer even
  // when it runs before its own re-render. Stable identity, so it never re-triggers effects.
  const isDeleted = useCallback(
    (sessionId: string) => store.getState().deletedSessionIds.has(sessionId),
    [store],
  );

  const value = useMemo<SessionsContextValue>(() => {
    const byAgent = new Map<string, SessionInfo[]>();
    for (const s of state.sessions) {
      const list = byAgent.get(s.agentId);
      if (list) list.push(s);
      else byAgent.set(s.agentId, [s]);
    }
    // Encounter order is no longer reliable with paging (appended pages are older, but a
    // deep-linked old session is prepended via add): sort each Agent's list newest first
    // (same key the server sorts by).
    for (const list of byAgent.values()) {
      list.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
      );
    }
    return {
      sessions: state.sessions,
      byAgent,
      countsByAgent: state.countsByAgent,
      workspaceCountsByAgent: state.workspaceCountsByAgent,
      isLoadedFor,
      hasMoreFor,
      loading: state.loading,
      reload: state.reload,
      loadMoreFor: state.loadMoreFor,
      add: state.add,
      remove: state.remove,
      isDeleted,
      replace: state.replace,
      setStatus: state.setStatus,
      setTitle: state.setTitle,
      showCliSessions: state.showCliSessions,
      setShowCliSessions: state.setShowCliSessions,
    };
  }, [state, isLoadedFor, hasMoreFor, isDeleted]);

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within a SessionsProvider");
  return ctx;
}
