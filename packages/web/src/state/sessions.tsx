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
  SessionCategory,
  SessionCategoryCounts,
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
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
  /** Remove from the list in place after deletion. */
  remove: (sessionId: string) => void;
  /** Replace the whole entry with the PATCH result. */
  replace: (session: SessionInfo) => void;
  /** Live stream task_state → list badge. */
  setStatus: (sessionId: string, status: SessionStatus) => void;
  /** session_title server event → update the title in place. */
  setTitle: (sessionId: string, title: string) => void;
}

const SessionsContext = createContext<SessionsContextValue | null>(null);

/** Page-state key of one (Agent, category) pair ("\0" never appears in Agent ids). */
const pageKey = (agentId: string, category: SessionCategory) => `${agentId}\0${category}`;

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Stable key for the Agent set: the list object is a new reference on every reload,
  // so join the ids to avoid unnecessary reloads.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  /** pageKey → server-has-more for that pair; a key is present iff its first page has been fetched. */
  const [pageState, setPageState] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [countsByAgent, setCountsByAgent] = useState<ReadonlyMap<string, SessionCategoryCounts>>(
    new Map(),
  );
  const [workspaceCountsByAgent, setWorkspaceCountsByAgent] = useState<
    ReadonlyMap<string, Readonly<Record<string, SessionCategoryCounts>>>
  >(new Map());
  const [loading, setLoading] = useState(true);
  // Generation counter: invalidates any in-flight response once the Project/Agent set
  // changes or a reload happens.
  const gen = useRef(0);
  // Current values for loadMoreFor (offsets are computed from what is actually loaded).
  const sessionsRef = useRef<SessionInfo[]>([]);
  sessionsRef.current = sessions;
  const pageStateRef = useRef<ReadonlyMap<string, boolean>>(pageState);
  pageStateRef.current = pageState;
  const countsRef = useRef<ReadonlyMap<string, SessionCategoryCounts>>(countsByAgent);
  countsRef.current = countsByAgent;

  const reload = useCallback(async () => {
    const agentIds = agentIdsKey === "" ? [] : agentIdsKey.split(",");
    if (!projectId || agentIds.length === 0) return;
    const g = ++gen.current;
    setLoading(true);
    try {
      const results = await Promise.all(
        agentIds.map(async (agentId) => {
          // Active first page (with per-category totals) always; plus the first page of
          // every folder category already on screen — a reload triggered by a server
          // event must refresh, not blank, an open folder.
          const categories: SessionCategory[] = [
            "active",
            ...FOLDER_CATEGORIES.filter((cat) => pageStateRef.current.has(pageKey(agentId, cat))),
          ];
          try {
            const pages = await Promise.all(
              categories.map(async (category) => {
                const res = await api.listSessions(projectId, agentId, {
                  offset: 0,
                  limit: SIDEBAR_PAGE_SIZE + 1,
                  category,
                  ...(category === "active" ? { withCounts: true } : {}),
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
      if (g !== gen.current) return;
      const nextSessions: SessionInfo[] = [];
      const seen = new Set<string>();
      const nextPageState = new Map<string, boolean>();
      const nextCounts = new Map<string, SessionCategoryCounts>();
      const nextWorkspaceCounts = new Map<
        string,
        Readonly<Record<string, SessionCategoryCounts>>
      >();
      for (const r of results) {
        for (const p of r.pages) {
          nextPageState.set(pageKey(r.agentId, p.category), p.hasMore);
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
      setSessions(nextSessions);
      setPageState(nextPageState);
      setCountsByAgent(nextCounts);
      setWorkspaceCountsByAgent(nextWorkspaceCounts);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [projectId, agentIdsKey]);

  useEffect(() => {
    setSessions([]);
    // reload() reads the ref synchronously to pick the categories to refetch — reset it
    // in place so a Project switch can't carry folder page state across via shared Agent
    // ids (default_agent exists in every Project).
    pageStateRef.current = new Map();
    setPageState(pageStateRef.current);
    setCountsByAgent(new Map());
    setWorkspaceCountsByAgent(new Map());
    void reload();
  }, [reload]);

  /**
   * Category page fetch for each given Agent: the first page when the pair is unloaded
   * (skipped unless the counts say the category holds anything), the next page when
   * loaded with more. Offsets are the currently loaded per-pair counts; a session
   * created since the last page shifts server offsets, so appended rows are
   * deduplicated by sessionId (a short page is fine — `hasMore` comes from the server
   * response, and the next click continues from the new count).
   */
  const loadMoreFor = useCallback(
    async (agentIds: string[], category: SessionCategory) => {
      if (!projectId) return;
      const targets = [...new Set(agentIds)].filter((agentId) => {
        const loaded = pageStateRef.current.get(pageKey(agentId, category));
        if (loaded === undefined) return (countsRef.current.get(agentId)?.[category] ?? 0) > 0;
        return loaded;
      });
      if (targets.length === 0) return;
      const g = gen.current;
      const results = await Promise.all(
        targets.map(async (agentId) => {
          const offset = sessionsRef.current.filter(
            (s) => s.agentId === agentId && sessionCategory(s) === category,
          ).length;
          try {
            const fetched = (
              await api.listSessions(projectId, agentId, {
                offset,
                limit: SIDEBAR_PAGE_SIZE + 1,
                category,
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
      if (g !== gen.current) return; // Project switch / reload raced this page: drop it.
      const ok = results.filter((r) => r !== null);
      setSessions((prev) => {
        const seen = new Set(prev.map((s) => s.sessionId));
        const appended = ok.flatMap((r) => r.items.filter((s) => !seen.has(s.sessionId)));
        return appended.length > 0 ? [...prev, ...appended] : prev;
      });
      setPageState((prev) => {
        const next = new Map(prev);
        for (const r of ok) next.set(pageKey(r.agentId, category), r.hasMore);
        return next;
      });
    },
    [projectId],
  );

  const isLoadedFor = useCallback(
    (agentId: string, category: SessionCategory) => pageState.has(pageKey(agentId, category)),
    [pageState],
  );

  const hasMoreFor = useCallback(
    (agentId: string, category: SessionCategory) => {
      const loaded = pageState.get(pageKey(agentId, category));
      if (loaded !== undefined) return loaded;
      // Unloaded pair: anything the counts report is by definition still unfetched.
      return (countsByAgent.get(agentId)?.[category] ?? 0) > 0;
    },
    [pageState, countsByAgent],
  );

  /** Keeps an Agent's category totals — overall and per Workspace — in step with a local list mutation of `session` (no-op while its counts are unknown). */
  const adjustCount = useCallback(
    (session: SessionInfo, category: SessionCategory, delta: number) => {
      const { agentId, workspace } = session;
      setCountsByAgent((prev) => {
        const cur = prev.get(agentId);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(agentId, { ...cur, [category]: Math.max(0, cur[category] + delta) });
        return next;
      });
      setWorkspaceCountsByAgent((prev) => {
        const cur = prev.get(agentId);
        if (!cur) return prev;
        const ws = cur[workspace] ?? { active: 0, subagent: 0, schedule: 0, archived: 0 };
        const next = new Map(prev);
        next.set(agentId, {
          ...cur,
          [workspace]: { ...ws, [category]: Math.max(0, ws[category] + delta) },
        });
        return next;
      });
    },
    [],
  );

  // User-level event stream (/api/events): a scheduled task firing may have created a new
  // Session (new-session mode); reload the list so it appears immediately. schedule_queued
  // doesn't change the list (the target Session already exists), so it's ignored.
  // refs hold the current values: the connection stays a single one for the whole login
  // session and doesn't reconnect on Project switches.
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  useEffect(() => {
    const conn = openUserEvents({
      onOmniMessage: () => undefined,
      onServerEvent: (ev) => {
        if (ev.type !== "schedule_fired") return;
        // The event carries projectId: a trigger from another Project is unrelated to the current list.
        if (ev.projectId === projectIdRef.current) void reloadRef.current();
      },
    });
    return () => conn.close();
  }, []);

  const add = useCallback(
    (session: SessionInfo) => {
      // Invalidate any in-flight reload: the newly created entry mustn't be wiped by a stale snapshot.
      gen.current += 1;
      // Count the row only when the pair's fetched pages provably held its whole category
      // (loaded, no more): the row is then genuinely new to the server totals. Otherwise
      // (deep-link self-heal of an unfetched row) the counts already include it — a
      // possible one-off drift self-heals on the next reload.
      const existed = sessionsRef.current.some((s) => s.sessionId === session.sessionId);
      if (
        !existed &&
        pageStateRef.current.get(pageKey(session.agentId, sessionCategory(session))) === false
      ) {
        adjustCount(session, sessionCategory(session), 1);
      }
      setSessions((prev) => [session, ...prev.filter((s) => s.sessionId !== session.sessionId)]);
    },
    [adjustCount],
  );

  const remove = useCallback(
    (sessionId: string) => {
      // Invalidate any in-flight reload: the deletion mustn't be undone by a stale snapshot.
      gen.current += 1;
      const row = sessionsRef.current.find((s) => s.sessionId === sessionId);
      if (row) adjustCount(row, sessionCategory(row), -1);
      setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
    },
    [adjustCount],
  );

  const replace = useCallback(
    (session: SessionInfo) => {
      // An archive toggle moves the row across categories: keep the folder totals in step.
      const old = sessionsRef.current.find((s) => s.sessionId === session.sessionId);
      if (old && sessionCategory(old) !== sessionCategory(session)) {
        adjustCount(session, sessionCategory(old), -1);
        adjustCount(session, sessionCategory(session), 1);
      }
      setSessions((prev) => prev.map((s) => (s.sessionId === session.sessionId ? session : s)));
    },
    [adjustCount],
  );

  const setStatus = useCallback((sessionId: string, status: SessionStatus) => {
    setSessions((prev) => {
      const target = prev.find((s) => s.sessionId === sessionId);
      if (!target || target.status === status) return prev;
      return prev.map((s) => (s.sessionId === sessionId ? { ...s, status } : s));
    });
  }, []);

  const setTitle = useCallback((sessionId: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s)));
  }, []);

  const value = useMemo<SessionsContextValue>(() => {
    const byAgent = new Map<string, SessionInfo[]>();
    for (const s of sessions) {
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
      sessions,
      byAgent,
      countsByAgent,
      workspaceCountsByAgent,
      isLoadedFor,
      hasMoreFor,
      loading,
      reload,
      loadMoreFor,
      add,
      remove,
      replace,
      setStatus,
      setTitle,
    };
  }, [
    sessions,
    countsByAgent,
    workspaceCountsByAgent,
    isLoadedFor,
    hasMoreFor,
    loading,
    reload,
    loadMoreFor,
    add,
    remove,
    replace,
    setStatus,
    setTitle,
  ]);

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions must be used within a SessionsProvider");
  return ctx;
}
