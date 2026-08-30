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
import { mergeCounts } from "../lib/session-merge";
import {
  forgetSessionMachines,
  machineForSession,
  rememberSessionMachine,
} from "../lib/session-machines";
import { workspaceMachines } from "../lib/workspace-machines";
import { cachedMachineSessions, rememberMachineSessions } from "../lib/machine-cache";
import { ensureMachineConnected, onMachineAutoConnected } from "../lib/machine-autoconnect";
import { openUserEvents } from "../api/sse";
import { ApiError, setMachineConnector } from "../api/client";
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
   * Whether the list has NOTHING to show yet — including the window where the Agent set it
   * is fetched for is itself being refetched (a Project switch clears it). Consumers gate
   * their "no sessions" empty state on this, so it must not read false while the answer is
   * merely not known yet.
   *
   * Emphatically not "a fetch is in flight". A refresh over rows already on screen leaves
   * this false: the chat page renders a skeleton IN PLACE OF the open conversation while it
   * is true, so a refresh that raised it would blank the conversation you are reading — and
   * the list refreshes whenever the machine set moves, which a machine that flaps does over
   * and over.
   */
  loading: boolean;
  /**
   * Whether a machine of this Project could not be asked — its forward is down, or the
   * server behind it is not answering.
   *
   * A Session missing from the list means "this server has not got it", which is only the
   * same as "it does not exist" when every server that could hold it answered. The chat page
   * reads this before deciding a routed id is gone: concluding that from a lookup against
   * THIS server, while the machine the Session lives on is down, drops the reader out of a
   * conversation that is merely out of reach.
   */
  machinesUnreachable: boolean;
  /**
   * The Project's machines that did not answer this round, by machine id. Their rows on
   * screen come from the cache (lib/session-cache.ts), so a caller that has to decide
   * whether a Session is REACHABLE — not merely whether it is listed — asks this.
   */
  offlineMachineIds: string[];
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
 * Page-state key of one (Agent, category, Workspace-group, source) run. The scope is the
 * server's query form of a group (workspaceGroupQuery) — a path or the temp sentinel — and
 * "" means the Agent's whole stream. The source is the machine whose Sessions that stream is
 * walked on (`null` = this server): each server pages its own rows with its own offsets, so
 * one shared cursor would ask machine B for rows only machine A had reached. "\0" appears in
 * none of the four (the merged temp group's own key does contain one, which is exactly why
 * the query form is what gets stored).
 */
const pageKey = (
  agentId: string,
  category: SessionCategory,
  scope = "",
  source: string | null = null,
) => `${agentId}\0${category}\0${scope}\0${source ?? ""}`;

/** Every list category, in the order the store loads them (active eagerly, the folders on demand). */
const ALL_CATEGORIES: readonly string[] = ["active", ...FOLDER_CATEGORIES];

/** The run a page key names, or null if it is not one (never, in practice — a guard for the reload scan). */
function parsePageKey(
  key: string,
): { agentId: string; category: SessionCategory; scope: string; source: string | null } | null {
  const parts = key.split("\0");
  if (parts.length !== 4) return null;
  const [agentId, category, scope, source] = parts as [string, string, string, string];
  return ALL_CATEGORIES.includes(category)
    ? {
        agentId,
        category: category as SessionCategory,
        scope,
        source: source === "" ? null : source,
      }
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
  /**
   * Machines whose Sessions are merged into this list, alongside this server's. A Session
   * lives on the server whose filesystem its workspace is on, so a Project's list is not one
   * server's answer — it is every one of them, ordered together (lib/session-merge.ts).
   */
  machineIds: string[];
  /**
   * Whether a machine of this Project is one this list could NOT ask. It is the difference
   * between "this server does not have that Session" and
   * "nobody who might have it answered", which is the whole question for a routed id that is
   * missing from the list (features/chat/chat-page.tsx).
   */
  machinesUnreachable: boolean;
  /** Provider-synced: the machines of this Project that did not answer, by machine id. */
  offlineMachineIds: string[];

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
      machineIds: [],
      machinesUnreachable: false,
      offlineMachineIds: [],

      sessions: [],
      deletedSessionIds: new Set(),
      pageState: new Map(),
      countsByAgent: new Map(),
      workspaceCountsByAgent: new Map(),
      loading: true,

      reload: async () => {
        const { projectId, agentIds, machineIds, offlineMachineIds } = get();
        // No context to fetch against yet. `loading` is deliberately left alone rather than
        // cleared: nothing was loaded, so reporting "done" here would be a lie — and one the
        // empty state renders. The Provider's reset step raised it and a later reload,
        // once an Agent set exists, is what clears it.
        if (!projectId || agentIds.length === 0) return;
        const g = ++gen;
        // Only when there is nothing on screen. Rows already listed stay true while this
        // refetches — a machine appearing or dropping out changes which servers are asked,
        // not whether what is already shown is still so — and the chat page reads this flag
        // to decide whether to draw a skeleton over the open conversation.
        if (get().sessions.length === 0) set({ loading: true });
        let applied = false;
        // This server first, then every machine of the Project. Order matters only as a
        // tie-break — mergeSessionPages sorts by time and keeps source order for equal
        // stamps, so the list stays stable between refreshes instead of shuffling.
        const sources: (string | null)[] = [null, ...machineIds];
        try {
          const results = await Promise.all(
            agentIds.flatMap((agentId) =>
              sources.map(async (source) => {
                // The Agent's whole-stream active first page (with per-category totals)
                // always; plus the first page of every other pair already on screen — an
                // open folder, and each Workspace group paging its own stream — because a
                // reload triggered by a server event must refresh them, not blank them.
                const pairs: { category: SessionCategory; scope: string }[] = [
                  { category: "active", scope: "" },
                ];
                for (const key of get().pageState.keys()) {
                  const parsed = parsePageKey(key);
                  if (parsed === null || parsed.agentId !== agentId || parsed.source !== source)
                    continue;
                  if (parsed.category === "active" && parsed.scope === "") continue;
                  pairs.push({ category: parsed.category, scope: parsed.scope });
                }
                try {
                  const pages = await Promise.all(
                    pairs.map(async ({ category, scope }) => {
                      const res = await api.listSessions(
                        projectId,
                        agentId,
                        {
                          offset: 0,
                          limit: SIDEBAR_PAGE_SIZE + 1,
                          category,
                          ...(scope === "" ? {} : { workspaceGroup: scope }),
                          ...(category === "active" && scope === "" ? { withCounts: true } : {}),
                        },
                        source,
                      );
                      return {
                        category,
                        scope,
                        counts: res.counts,
                        workspaceCounts: res.workspaceCounts,
                        ...splitPage(res.sessions, SIDEBAR_PAGE_SIZE),
                      };
                    }),
                  );
                  return { agentId, source, pages, answered: true };
                } catch (err) {
                  // Two very different things arrive here, and treating them alike is what
                  // emptied the sidebar. An Agent is per-server, so a server simply not
                  // having this one answers 404: an ANSWER, and the ordinary case. Anything
                  // else — this server mid-swap, a forward up but not yet serving, the
                  // network — is a failure to answer at all, and an empty result standing in
                  // for it replaces rows that are perfectly alive.
                  const absent = err instanceof ApiError && err.status === 404;
                  return { agentId, source, pages: [], answered: absent };
                }
              }),
            ),
          );
          if (g !== gen) return;
          // This server did not answer. It holds the Sessions every other source is merged
          // AROUND, so there is no list to build — and building one anyway would replace
          // everything on screen with a handful of remote rows, or with nothing at all. A
          // reload is a refresh, and a refresh that cannot read anything changes nothing:
          // the rows stand, `loading` is left as it was, and the next one tries again. This
          // is the ordinary state during a hot swap and for the moment after a reconnect.
          if (results.some((r) => r.source === null && !r.answered)) return;
          // Machines that did not answer are treated exactly like machines that were never
          // asked: their rows come from the cache below, and their cache is left alone.
          const silent = new Set(
            results.flatMap((r) => (r.source !== null && !r.answered ? [r.source] : [])),
          );
          const nextSessions: SessionInfo[] = [];
          const seen = new Set<string>();
          // What each machine answered, kept so it can be shown after the next restart while
          // that machine's forward is being raised again (lib/session-cache.ts).
          const rowsByMachine = new Map<string, SessionInfo[]>();
          const nextPageState = new Map<string, PagePosition>();
          const nextCounts = new Map<string, SessionCategoryCounts>();
          const nextWorkspaceCounts = new Map<
            string,
            Readonly<Record<string, SessionCategoryCounts>>
          >();
          // Counts are SUMMED across sources, not overwritten: a folder badge that counted
          // one machine would contradict the rows underneath it (mergeCounts).
          const countParts = new Map<string, SessionCategoryCounts[]>();
          const workspaceParts = new Map<
            string,
            Array<Readonly<Record<string, SessionCategoryCounts>>>
          >();
          for (const r of results) {
            for (const p of r.pages) {
              nextPageState.set(pageKey(r.agentId, p.category, p.scope, r.source), {
                hasMore: p.hasMore,
                fetched: p.items.length,
              });
              if (p.counts)
                countParts.set(r.agentId, [...(countParts.get(r.agentId) ?? []), p.counts]);
              if (p.workspaceCounts) {
                workspaceParts.set(r.agentId, [
                  ...(workspaceParts.get(r.agentId) ?? []),
                  p.workspaceCounts,
                ]);
              }
              for (const s of p.items) {
                if (seen.has(s.sessionId)) continue;
                seen.add(s.sessionId);
                nextSessions.push(s);
                if (r.source !== null)
                  rowsByMachine.set(r.source, [...(rowsByMachine.get(r.source) ?? []), s]);
                // Where this row lives, so the two dozen Session-scoped calls about it reach
                // the machine that holds it. Rebuilt by the very list that displays them,
                // which is why the map is in memory and this is the only place it is filled.
                rememberSessionMachine(s.sessionId, r.source);
              }
            }
          }
          for (const [agentId, parts] of countParts) {
            const merged = mergeCounts(parts);
            if (merged) nextCounts.set(agentId, merged);
          }
          for (const [agentId, parts] of workspaceParts) {
            // Per workspace path, summed the same way: two machines may hold Sessions in
            // paths that are equal as strings, and the badge is about the path.
            const byPath = new Map<string, SessionCategoryCounts[]>();
            for (const part of parts) {
              for (const [path, counts] of Object.entries(part)) {
                byPath.set(path, [...(byPath.get(path) ?? []), counts]);
              }
            }
            const out: Record<string, SessionCategoryCounts> = {};
            for (const [path, list] of byPath) {
              const merged = mergeCounts(list);
              if (merged) out[path] = merged;
            }
            nextWorkspaceCounts.set(agentId, out);
          }
          // Only a machine that ANSWERED replaces what it is remembered as holding — including
          // with nothing, which is how a Session deleted over there stops coming back from
          // the cache. `machineIds` is the set that answered the reachability PROBE, which is
          // a different question and a moment earlier: a machine that passed it and then
          // failed this fetch would otherwise erase its own cache, leaving the fallback with
          // nothing to fall back to. That is why an emptied list did not come back.
          for (const machineId of machineIds) {
            if (silent.has(machineId)) continue;
            rememberMachineSessions(projectId, machineId, rowsByMachine.get(machineId) ?? []);
          }
          // And every machine this list could not read contributes what it last held — the
          // ones known to be out of reach, and the ones that went quiet during the fetch.
          // `seen` still guards, so a live answer always wins over a remembered one. Their
          // owner entries are recorded the same way, so opening such a Session addresses the
          // machine that has it rather than this server — which would answer 404 about
          // someone else's.
          //
          // Folder badges are NOT topped up from here: counts come from the servers that
          // answered, so an out-of-reach machine's rows show without being counted. Better
          // than the alternative — a count is a claim about what a server holds now, and the
          // cache cannot make that claim.
          for (const machineId of new Set([...offlineMachineIds, ...silent])) {
            for (const s of cachedMachineSessions(projectId, machineId)) {
              if (seen.has(s.sessionId)) continue;
              seen.add(s.sessionId);
              nextSessions.push(s);
              rememberSessionMachine(s.sessionId, machineId);
            }
          }
          // Newest first across every source: each answered sorted, and concatenating sorted
          // lists does not give a sorted list.
          nextSessions.sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
          );
          set({
            sessions: nextSessions,
            pageState: nextPageState,
            countsByAgent: nextCounts,
            workspaceCountsByAgent: nextWorkspaceCounts,
          });
          applied = true;
        } finally {
          // Only a reload that produced a list may report one. Abandoning above leaves the
          // flag exactly as it was — false with rows on screen, which is still true of them;
          // true with none, because none were fetched and saying otherwise is what paints an
          // empty state over a list that was merely unreadable this round.
          if (g === gen && applied) set({ loading: false });
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
        const { projectId, machineIds } = get();
        if (!projectId) return;
        const sources: (string | null)[] = [null, ...machineIds];
        const scope = scopeOf(workspaceGroup);
        // One target per (Agent, SOURCE): each server pages its own Sessions with its own
        // offsets, so a shared cursor would ask one machine for rows only another had
        // reached — silently skipping the rows in between.
        const targets = [...new Set(agentIds)].flatMap((agentId) =>
          sources
            .filter((source) => {
              const position = get().pageState.get(pageKey(agentId, category, scope, source));
              // An unloaded pair: the Agent's own totals still decide whether asking is
              // worth a request — they are the SUM over sources, so a machine with none
              // still gets one first page, which is what discovers that it has none. A
              // scoped pair cannot consult them (they are not broken down by group here),
              // so it always gets its first page — the caller only asks for a group it has
              // reason to believe holds rows.
              if (position === undefined)
                return scope !== "" || (get().countsByAgent.get(agentId)?.[category] ?? 0) > 0;
              return position.hasMore;
            })
            .map((source) => ({ agentId, source })),
        );
        if (targets.length === 0) return;
        const g = gen;
        /**
         * Rows of this (Agent, category, group) already in the pool from ONE source. They
         * arrived on pages of that source's whole stream, and a prefix of that stream cut by
         * Workspace is a prefix of the group's stream — so the count doubles as the offset a
         * FIRST scoped fetch starts from. Without it that fetch would re-read rows the group
         * already shows and the click would appear to do nothing; counting every source's
         * rows would instead skip rows only this source holds.
         */
        const loadedInScope = (agentId: string, source: string | null, group: string) =>
          get().sessions.filter(
            (s) =>
              s.agentId === agentId &&
              sessionCategory(s) === category &&
              workspaceGroupKey(s.workspace) === group &&
              machineForSession(s.sessionId) === source,
          ).length;
        const results = await Promise.all(
          targets.map(async ({ agentId, source }) => {
            const position = get().pageState.get(pageKey(agentId, category, scope, source));
            const offset =
              position?.fetched ??
              (workspaceGroup === undefined || workspaceGroup === ""
                ? 0
                : loadedInScope(agentId, source, workspaceGroup));
            try {
              const fetched = (
                await api.listSessions(
                  projectId,
                  agentId,
                  {
                    offset,
                    limit: SIDEBAR_PAGE_SIZE + 1,
                    category,
                    ...(scope === "" ? {} : { workspaceGroup: scope }),
                  },
                  source,
                )
              ).sessions;
              return { agentId, source, offset, ...splitPage(fetched, SIDEBAR_PAGE_SIZE) };
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
        const appended: SessionInfo[] = [];
        for (const r of ok) {
          for (const row of r.items) {
            if (seen.has(row.sessionId)) continue;
            seen.add(row.sessionId);
            appended.push(row);
            rememberSessionMachine(row.sessionId, r.source);
          }
        }
        const prevPageState = get().pageState;
        const nextPageState = new Map(prevPageState);
        for (const r of ok) {
          const key = pageKey(r.agentId, category, scope, r.source);
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
        // Per SOURCE and stream: the row belongs to the machine it lives on, and the whole
        // stream (scope "") is the one the totals were fetched against. When its Workspace
        // group also pages its own stream, that cursor is drained too — an open, half-loaded
        // group could still hide the row, so it must not be counted as new.
        const source = machineForSession(session.sessionId);
        const category = sessionCategory(session);
        const groupScope = workspaceGroupQuery(workspaceGroupKey(session.workspace));
        const fullyLoaded = (pairScope: string) =>
          get().pageState.get(pageKey(session.agentId, category, pairScope, source))?.hasMore ===
          false;
        if (
          !existed &&
          fullyLoaded("") &&
          (!get().pageState.has(pageKey(session.agentId, category, groupScope, source)) ||
            fullyLoaded(groupScope))
        ) {
          adjustCount(session, category, 1);
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

  /**
   * The Project's machines, whose Sessions belong in this list too.
   *
   * A Session lives on the server whose filesystem its workspace is on, so a Project's list
   * is not this server's answer — it is every one of them. Fetched once per Project rather
   * than watched: a machine appearing is not a reason to refetch a list nobody asked for,
   * and the Machines page is where that is managed.
   *
   * Failure leaves it empty, which degrades to exactly the old behaviour: this server's
   * Sessions, listed. That is the right failure — a partial list beats none.
   */
  const [machineIdsKey, setMachineIdsKey] = useState("");
  /**
   * Whether any of them could not be reached. Kept beside the reachable set rather than
   * derived from it: a machine that drops out is simply absent from the key, which cannot be
   * told apart from a Project that has no machines at all — and those two answer the "is this
   * Session gone, or merely out of reach" question differently.
   */
  const [machinesUnreachable, setMachinesUnreachable] = useState(false);
  /**
   * Which of them, by machine id — the ones whose rows come from the cache until they answer.
   * A joined key rather than an array so an unchanged set does not re-run anything.
   */
  const [offlineMachineIdsKey, setOfflineMachineIdsKey] = useState("");
  /**
   * Bumped when a machine is connected on this page's behalf (lib/machine-autoconnect.ts):
   * the one moment the reachable set is known to have moved without a Project change, and
   * the Sessions that machine holds should join the list without a reload.
   */
  const [machinesEpoch, setMachinesEpoch] = useState(0);
  useEffect(() => onMachineAutoConnected(() => setMachinesEpoch((epoch) => epoch + 1)), []);
  /**
   * Lets any call about a Session on a machine raise that machine's forward itself, rather
   * than handing the reader a "connect to it first" they can do nothing with (api/client.ts).
   * Registered from here because this is where the current Project is known, and the machine
   * list is per Project.
   */
  useEffect(() => {
    if (projectId === null) return;
    setMachineConnector(
      async (machineId) =>
        (await ensureMachineConnected(projectId, machineId, { api })) === "connected",
    );
    return () => setMachineConnector(null);
  }, [projectId]);
  useEffect(() => {
    if (projectId === null) {
      setMachineIdsKey("");
      setMachinesUnreachable(false);
      setOfflineMachineIdsKey("");
      return;
    }
    let cancelled = false;
    void (async () => {
      let ids: string[];
      try {
        const res = await api.getMachines(projectId);
        ids = workspaceMachines(res)
          .filter((machine) => !machine.local && machine.selectable)
          .map((machine) => machine.id)
          .filter((id): id is string => id !== null);
      } catch {
        return; // No machine list: the store keeps none, and the list is this server's alone.
      }
      // Which of them ANSWER, asked before naming them: a machine listed as connected can
      // still have a dead server behind its forward, and the list's fetch would read that as
      // "that machine has not got this Agent" — rows missing with nothing said. Concurrent,
      // and each failure is that machine's alone: one unreachable host must not cost the
      // others their Sessions. No sign-in step — the proxy reaches a machine as its admin,
      // with a session this server mints over ssh (machines/proxy.ts).
      const reachable = await Promise.all(
        ids.map(async (id) => {
          try {
            await api.meOnMachine(id);
            return id;
          } catch {
            return null; // Not connected, or its server is not answering.
          }
        }),
      );
      if (cancelled) return;
      const answered = reachable.filter((id): id is string => id !== null);
      const offline = ids.filter((_, i) => reachable[i] === null);
      setMachineIdsKey(answered.join(","));
      setMachinesUnreachable(offline.length > 0);
      setOfflineMachineIdsKey(offline.join(","));
      // A forward does not survive a restart, so on a fresh page every machine of the
      // Project is out of reach — and nothing else would raise one until someone visited
      // the Machines page. Raise them here: this is the moment the list learns it is missing
      // a machine's half of itself. ensureMachineConnected is once-per-machine for the
      // page's lifetime, so a machine that keeps refusing is not re-attempted every round;
      // when one comes up it bumps the epoch above, which re-runs this effect and lets the
      // refetch replace that machine's cached rows with what it actually holds.
      for (const machineId of offline) void ensureMachineConnected(projectId, machineId, { api });
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, machinesEpoch]);

  /**
   * The Project and its Agent set: what the list is OF. A change here invalidates every row
   * on screen, so it clears them. The machine set is deliberately not part of it — see below.
   */
  const contextKey = `${projectId ?? ""}\u0000${agentIdsKey}`;
  const appliedContext = useRef<string | null>(null);
  useEffect(() => {
    const contextChanged = appliedContext.current !== contextKey;
    appliedContext.current = contextKey;
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
      machineIds: machineIdsKey === "" ? [] : machineIdsKey.split(","),
      machinesUnreachable,
      offlineMachineIds: offlineMachineIdsKey === "" ? [] : offlineMachineIdsKey.split(","),
      // Cleared only when the CONTEXT changed. A machine appearing, or going unreachable and
      // dropping out, changes which servers are asked — not whether what is already on screen
      // is still true. reload() below rebuilds the list wholesale from whatever answers, so a
      // departed machine's rows leave on their own; clearing first would instead blank the
      // sidebar, and with it the chat page, for as long as an ssh probe takes. A machine that
      // flaps would do it repeatedly, which is the bug this guard exists for.
      ...(contextChanged
        ? {
            sessions: [],
            pageState: new Map(),
            countsByAgent: new Map(),
            workspaceCountsByAgent: new Map(),
            // The pages were just cleared, so the list is loading from this instant —
            // including the window where the Agent set itself is still being refetched (a
            // Project switch empties it, which makes reload() below return without fetching
            // or clearing the flag). Raising it HERE, on fetch-context change, is what keeps
            // an unrelated reloadAgents() — same agent set, fired after every completed turn
            // — from flapping the app-wide flag.
            loading: true,
          }
        : {}),
    });
    // Which machine owns which Session is rebuilt by the very fetch below, so the old
    // answers are dropped with the rows they described: a stale entry would route a call at
    // a machine that may no longer hold — or no longer have — that Session. Only alongside
    // the rows themselves: dropped while they are still displayed, every one of them would
    // route at THIS server until the refetch lands.
    if (contextChanged) forgetSessionMachines();
    void store.getState().reload();
  }, [
    store,
    projectId,
    agentIdsKey,
    machineIdsKey,
    machinesUnreachable,
    offlineMachineIdsKey,
    contextKey,
  ]);

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

  const { pageState, countsByAgent, machineIds } = state;
  const sources = useMemo<(string | null)[]>(() => [null, ...machineIds], [machineIds]);

  // Loaded only when EVERY source has answered: one machine's first page arriving does not
  // make the folder complete, and treating it as loaded would hide the rest behind a
  // "load more" that never appears.
  const isLoadedFor = useCallback(
    (agentId: string, category: SessionCategory, workspaceGroup?: string) =>
      sources.every((source) =>
        pageState.has(pageKey(agentId, category, scopeOf(workspaceGroup), source)),
      ),
    [pageState, sources],
  );

  // More if ANY source has more — or if a source has not been asked at all and the counts,
  // which are the sum over sources, say the category holds something.
  const hasMoreFor = useCallback(
    (agentId: string, category: SessionCategory, workspaceGroup?: string) => {
      const scope = scopeOf(workspaceGroup);
      let anyUnloaded = false;
      for (const source of sources) {
        const position = pageState.get(pageKey(agentId, category, scope, source));
        if (position === undefined) anyUnloaded = true;
        else if (position.hasMore) return true;
      }
      if (!anyUnloaded) return false;
      // Unloaded: the counts are the sum over sources, so anything they report is by
      // definition still unfetched somewhere. A group's own stream is not in those counts,
      // so an unloaded scoped pair answers from the Agent's total for the category — the
      // group's share of it cannot exceed that.
      return (countsByAgent.get(agentId)?.[category] ?? 0) > 0;
    },
    [pageState, countsByAgent, sources],
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
      machinesUnreachable: state.machinesUnreachable,
      offlineMachineIds: state.offlineMachineIds,
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
