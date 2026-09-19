/**
 * Data hooks for the Coding agents page: the definition + session lists, and one live SSE
 * subscription for the selected session. The stream's initial `coding_agent_snapshot`
 * server event IS the transcript loader — it is delivered synchronously at subscribe time,
 * before any later publish can reach the same listener, so no separate fetch races it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CodingAgentEvent,
  CodingAgentServerInfo,
  CodingAgentSessionInfo,
  ServerEvent,
} from "@prismshadow/penguin-server/api";
import {
  createCodingAgentSession,
  getCodingAgentSession,
  listCodingAgentSessions,
  listCodingAgents,
} from "../../api/endpoints";
import { openCodingAgentStream, type StreamConnection } from "../../api/sse";

export interface CodingAgentsData {
  agents: CodingAgentServerInfo[];
  sessions: CodingAgentSessionInfo[];
  loading: boolean;
  loadError: boolean;
  reload: () => void;
}

export function useCodingAgents(): CodingAgentsData {
  const [agents, setAgents] = useState<CodingAgentServerInfo[]>([]);
  const [sessions, setSessions] = useState<CodingAgentSessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([listCodingAgents(), listCodingAgentSessions()])
      .then(([agentsRes, sessionsRes]) => {
        if (cancelled) return;
        setAgents(agentsRes.agents);
        setSessions(sessionsRes.sessions);
        setLoadError(false);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return {
    agents,
    sessions,
    loading,
    loadError,
    reload: () => {
      reload();
      void listCodingAgentSessions()
        .then((res) => setSessions(res.sessions))
        .catch(() => undefined);
    },
  };
}

export interface SessionStreamState {
  events: CodingAgentEvent[];
  connected: boolean;
  /** The server does not know this session (it ended, or the server restarted). */
  missing: boolean;
}

/** Live events for one session; `onSettled` fires when a turn_end lands (busy marks moved). */
export function useCodingAgentStream(
  sessionId: string | null,
  onSettled?: () => void,
): SessionStreamState {
  const [events, setEvents] = useState<CodingAgentEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [missing, setMissing] = useState(false);
  const settledRef = useRef(onSettled);
  settledRef.current = onSettled;

  useEffect(() => {
    if (sessionId === null) {
      setEvents([]);
      setConnected(false);
      setMissing(false);
      return;
    }
    let connection: StreamConnection | null = null;
    setEvents([]);
    setConnected(false);
    setMissing(false);

    connection = openCodingAgentStream(sessionId, {
      onEvent: (event) => setEvents((prev) => [...prev, event]),
      onServerEvent: (event: ServerEvent) => {
        if (event.type === "coding_agent_snapshot") {
          setEvents(event.events);
          setConnected(true);
        } else if (event.type === "resync_required") {
          // The buffer evicted our position: rebuild from the detail endpoint.
          void getCodingAgentSession(sessionId).then((d) => setEvents(d.events));
        }
      },
      onOpen: () => setConnected(true),
      onError: (closed) => {
        if (closed) setMissing(true);
      },
    });

    return () => connection?.close();
  }, [sessionId]);

  useEffect(() => {
    if (events.some((e) => e.type === "turn_end")) settledRef.current?.();
  }, [events]);

  return { events, connected, missing };
}
