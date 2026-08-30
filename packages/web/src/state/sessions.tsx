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
import { WORKFLOW_UPDATED_EVENT } from "../lib/workflow-tabs";
import {
  FOLDER_CATEGORIES,
  SIDEBAR_PAGE_SIZE,
  sessionCategory,
  splitPage,
  workspaceGroupKey,
  workspaceGroupQuery,
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
  /**
   * Whether a pair's first page has been fetched (false = the folder shows nothing because
   * nothing was asked for yet). `workspaceGroup` asks about ONE group's own stream, which
   * is paged separately from the Agent's whole one.
   */
  isLoadedFor: (agentId: string, category: SessionCategory, workspaceGroup?: string) => boolean;
  /** Whether the server still holds unfetched Sessions of a category for an Agent (or for one of its Workspace groups) — an unloaded pair answers from the counts. */
  hasMoreFor: (agentId: string, category: SessionCategory, workspaceGroup?: string) => boolean;
  /**
   * Whether the list is still being assembled — including the window where the Agent set it
   * is fetched for is itself being refetched (a Project switch clears it). Consumers gate
   * their "no sessions" empty state on this, so it must not read false while the answer is
   * merely not known yet.
   */
  loading: boolean;
  reload: () => Promise<void>;
  /** Fetches a category's first page for each given unloaded Agent and the next page for each loaded one with more (no-op otherwise); `workspaceGroup` pages that group's own stream instead of the Agent's whole one. */
  loadMoreFor: (
    agentIds: string[],
    category: SessionCategory,
    workspaceGroup?: string,
  ) => Promise<void>;
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

/**
 * Page-state key of one (Agent, category, Workspace-group) triple. The scope is the
 * server's query form of a group (workspaceGroupQuery) — a path or the temp sentinel —
 * and "" means the Agent's whole stream, which is what Agent and time grouping page down.
 * "\0" appears in none of the three (the merged temp group's own key does contain one,
 * which is exactly why the query form is what gets stored).
 */
const pageKey = (agentId: string, category: SessionCategory, scope = "") =>
  `${agentId}\0${category}\0${scope}`;

/** Every list category, in the order the store loads them (active eagerly, the folders on demand). */
const ALL_CATEGORIES: readonly string[] = ["active", ...FOLDER_CATEGORIES];

/** The triple a page key names, or null if it is not one (never, in practice — a guard for the reload scan). */
function parsePageKey(
  key: string,
): { agentId: string; category: SessionCategory; scope: string } | null {
  const parts = key.split("\0");
  if (parts.length !== 3) return null;
  const [agentId, category, scope] = parts as [string, string, string];
  return ALL_CATEGORIES.includes(category)
    ? { agentId, category: category as SessionCategory, scope }
    : null;
}

/** Scope string of a Workspace group (undefined / "" = the Agent's whole stream). */
const scopeOf = (workspaceGroup?: string) =>
  workspaceGroup === undefined || workspaceGroup === "" ? "" : workspaceGroupQuery(workspaceGroup);

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

  reload: () => Promise<void>;
  loadMoreFor: (
    agentIds: string[],
    category: SessionCategory,
    workspaceGroup?: string,
  ) => Promise<void>;
  add: (session: SessionInfo) => void;
  remove: (sessionId: string) => void;
  replace: (session: SessionInfo) => void;
  setStatus: (sessionId: string, status: SessionStatus, row?: LiveRowFields) => void;
  setTitle: (sessionId: string, title: string) => void;
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

      reload: async () => {
        const { projectId, agentIds } = get();
        // No context to fetch against yet. `loading` is deliberately left alone rather than
        // cleared: nothing was loaded, so reporting "done" here would be a lie — and one the
        // empty state renders. The Provider's reset step raised it and a later reload,
        // once an Agent set exists, is what clears it.
        if (!projectId || agentIds.length === 0) return;
        const g = ++gen;
        set({ loading: true });
        try {
          const results = await Promise.all(
            agentIds.map(async (agentId) => {
              // The Agent's whole-stream active first page (with per-category totals)
              // always; plus the first page of every other pair already on screen — an open
              // folder, and each Workspace group paging its own stream — because a reload
              // triggered by a server event must refresh them, not blank them.
              const pairs: { category: SessionCategory; scope: string }[] = [
                { category: "active", scope: "" },
              ];
              for (const key of get().pageState.keys()) {
                const parsed = parsePageKey(key);
                if (parsed === null || parsed.agentId !== agentId) continue;
                if (parsed.category === "active" && parsed.scope === "") continue;
                pairs.push({ category: parsed.category, scope: parsed.scope });
              }
              try {
                const pages = await Promise.all(
                  pairs.map(async ({ category, scope }) => {
                    const res = await api.listSessions(projectId, agentId, {
                      offset: 0,
                      limit: SIDEBAR_PAGE_SIZE + 1,
                      category,
                      ...(scope === "" ? {} : { workspaceGroup: scope }),
                      ...(category === "active" && scope === "" ? { withCounts: true } : {}),
                    });
                    return {
                      category,
                      scope,
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
              nextPageState.set(pageKey(r.agentId, p.category, p.scope), {
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
       *
       * `workspaceGroup` pages ONE group's own server stream instead of the Agent's whole
       * one, under its own cursor: this is what keeps a Workspace group's "load more" from
       * consuming the page its siblings were about to read and moving their rows on screen.
       * Rows land in the same pool either way — a scope only decides which stream is being
       * walked, so the pool absorbs any overlap by sessionId.
       */
      loadMoreFor: async (agentIds, category, workspaceGroup) => {
        const { projectId } = get();
        if (!projectId) return;
        const scope = scopeOf(workspaceGroup);
        const targets = [...new Set(agentIds)].filter((agentId) => {
          const position = get().pageState.get(pageKey(agentId, category, scope));
          // An unloaded pair: the Agent's own totals still decide whether asking is worth a
          // request. A scoped pair cannot consult them (they are not broken down by group
          // here), so it always gets its first page — the caller only asks for a group it
          // has reason to believe holds rows.
          if (position === undefined)
            return scope !== "" || (get().countsByAgent.get(agentId)?.[category] ?? 0) > 0;
          return position.hasMore;
        });
        if (targets.length === 0) return;
        const g = gen;
        /**
         * Rows of this (Agent, category, group) already in the pool. They arrived on pages of
         * the Agent's whole stream, and a prefix of that stream cut by Workspace is a prefix
         * of the group's stream — so the count doubles as the offset a FIRST scoped fetch
         * starts from. Without it that fetch would re-read rows the group already shows and
         * the click would appear to do nothing.
         */
        const loadedInScope = (agentId: string, group: string) =>
          get().sessions.filter(
            (s) =>
              s.agentId === agentId &&
              sessionCategory(s) === category &&
              workspaceGroupKey(s.workspace) === group,
          ).length;
        const results = await Promise.all(
          targets.map(async (agentId) => {
            const position = get().pageState.get(pageKey(agentId, category, scope));
            const offset =
              position?.fetched ??
              (workspaceGroup === undefined || workspaceGroup === ""
                ? 0
                : loadedInScope(agentId, workspaceGroup));
            try {
              const fetched = (
                await api.listSessions(projectId, agentId, {
                  offset,
                  limit: SIDEBAR_PAGE_SIZE + 1,
                  category,
                  ...(scope === "" ? {} : { workspaceGroup: scope }),
                })
              ).sessions;
              return { agentId, offset, ...splitPage(fetched, SIDEBAR_PAGE_SIZE) };
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
          const key = pageKey(r.agentId, category, scope);
          nextPageState.set(key, {
            hasMore: r.hasMore,
            // A first scoped fetch started at the rows the group already held (see
            // loadedInScope), so the cursor advances from where it actually read.
            fetched: (prevPageState.get(key)?.fetched ?? r.offset) + r.items.length,
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
  // A workflow of some Agent was (re)loaded: the chat page's tab strip owns that list and
  // listens on window (it is mounted per page, this provider per app).
  if (ev.type === "workflow_updated") {
    window.dispatchEvent(
      new CustomEvent(WORKFLOW_UPDATED_EVENT, {
        detail: { projectId: ev.projectId, agentId: ev.agentId, workflow: ev.workflow },
      }),
    );
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

  useEffect(() => {
    // Sync the fetch context and reset the loaded pages in the same synchronous step:
    // reload() picks the categories to refetch from pageState, so a Project switch can't
    // carry folder page state across via shared Agent ids (default_agent exists in every
    // Project).
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
      // The pages were just cleared, so the list is loading from this instant — including
      // the window where the Agent set itself is still being refetched (a Project switch
      // empties it, which makes reload() below return without fetching or clearing the
      // flag). Raising it HERE, on fetch-context change, is what keeps an unrelated
      // reloadAgents() — same agent set, fired after every completed turn — from flapping
      // the app-wide flag.
      loading: true,
    });
    void store.getState().reload();
  }, [store, projectId, agentIdsKey]);

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
    (agentId: string, category: SessionCategory, workspaceGroup?: string) =>
      pageState.has(pageKey(agentId, category, scopeOf(workspaceGroup))),
    [pageState],
  );

  const hasMoreFor = useCallback(
    (agentId: string, category: SessionCategory, workspaceGroup?: string) => {
      const scope = scopeOf(workspaceGroup);
      const position = pageState.get(pageKey(agentId, category, scope));
      if (position !== undefined) return position.hasMore;
      // Unloaded pair: anything the counts report is by definition still unfetched. A group's
      // own stream is not in those counts, so an unloaded scoped pair answers from the
      // Agent's total for the category — the group's share of it cannot exceed that.
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

  // Keyed on the rows alone: the outer value memo re-runs on every store change (status,
  // titles, page state), and rebuilding + re-sorting every Agent's bucket for those would be
  // pure waste.
  const byAgent = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const s of state.sessions) {
      const list = map.get(s.agentId);
      if (list) list.push(s);
      else map.set(s.agentId, [s]);
    }
    // Encounter order is no longer reliable with paging (appended pages are older, but a
    // deep-linked old session is prepended via add): sort each Agent's list newest first
    // (same key the server sorts by).
    for (const list of map.values()) {
      list.sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
      );
    }
    return map;
  }, [state.sessions]);

  const value = useMemo<SessionsContextValue>(() => {
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
    };
  }, [state, byAgent, isLoadedFor, hasMoreFor, isDeleted]);

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within a SessionsProvider");
  return ctx;
}
