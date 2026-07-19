/**
 * Session list context for all Agents in the current Project:
 * the sidebar groups by Agent, so all Agents' Sessions are loaded at once (fetched in parallel);
 * the chat page shares this same data for status sync / title events / self-healing reload.
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
import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { openUserEvents } from "../api/sse";
import { useProject } from "./project";

interface SessionsContextValue {
  /** Full list (each Agent's entries keep server-side reverse chronological order). */
  sessions: SessionInfo[];
  /** agentId → that Agent's Session list (empty array if none). */
  byAgent: ReadonlyMap<string, SessionInfo[]>;
  loading: boolean;
  reload: () => Promise<void>;
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

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { currentProject, agents } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Stable key for the Agent set: the list object is a new reference on every reload,
  // so join the ids to avoid unnecessary reloads.
  const agentIdsKey = agents.map((a) => a.agentId).join(",");

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  // Generation counter: invalidates any in-flight response once the Project/Agent set
  // changes or a reload happens.
  const gen = useRef(0);

  const reload = useCallback(async () => {
    const agentIds = agentIdsKey === "" ? [] : agentIdsKey.split(",");
    if (!projectId || agentIds.length === 0) return;
    const g = ++gen.current;
    setLoading(true);
    try {
      const results = await Promise.all(
        agentIds.map(async (agentId) => {
          try {
            return (await api.listSessions(projectId, agentId)).sessions;
          } catch {
            return []; // A single Agent's fetch failure shouldn't bring down the whole batch (e.g. its directory was deleted externally).
          }
        }),
      );
      if (g !== gen.current) return;
      setSessions(results.flat());
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, [projectId, agentIdsKey]);

  useEffect(() => {
    setSessions([]);
    void reload();
  }, [reload]);

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

  const add = useCallback((session: SessionInfo) => {
    // Invalidate any in-flight reload: the newly created entry mustn't be wiped by a stale snapshot.
    gen.current += 1;
    setSessions((prev) => [session, ...prev.filter((s) => s.sessionId !== session.sessionId)]);
  }, []);

  const remove = useCallback((sessionId: string) => {
    // Invalidate any in-flight reload: the deletion mustn't be undone by a stale snapshot.
    gen.current += 1;
    setSessions((prev) => prev.filter((s) => s.sessionId !== sessionId));
  }, []);

  const replace = useCallback((session: SessionInfo) => {
    setSessions((prev) => prev.map((s) => (s.sessionId === session.sessionId ? session : s)));
  }, []);

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
    return {
      sessions,
      byAgent,
      loading,
      reload,
      add,
      remove,
      replace,
      setStatus,
      setTitle,
    };
  }, [sessions, loading, reload, add, remove, replace, setStatus, setTitle]);

  return <SessionsContext.Provider value={value}>{children}</SessionsContext.Provider>;
}

export function useSessions(): SessionsContextValue {
  const ctx = useContext(SessionsContext);
  if (!ctx) throw new Error("useSessions 必须在 SessionsProvider 内使用");
  return ctx;
}
