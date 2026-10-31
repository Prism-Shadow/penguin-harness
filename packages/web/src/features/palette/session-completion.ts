/**
 * Session completion for the command palette: typing the start of a session id (`session-…`)
 * offers that session — its title beside its status word and id, Enter jumps to its chat page.
 * The rows are the sidebar's own (the session store the sidebar pages into), so a completion
 * names what the app already holds without waiting for the network — and every query also asks
 * the servers live: each source (this server and the Project's machines) answers the prefix
 * from its whole index, so a session no loaded page carries is completed all the same. The
 * three merge, deduplicated by id; a source that does not answer takes nothing from the offer.
 *
 * Pure core plus a hook: `sessionCompletionActions` builds the actions from rows the caller
 * passes (the hook reads the store; the tests pass literals), and `useSessionCompletion` is the
 * function AppLayout hands the palette. The palette calls it with the raw query on every
 * keystroke; it answers nothing at all until the query's first token starts a session id.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { cachedCompletionRows, rememberCompletionRows } from "../../lib/completion-cache";
import { cachedMachineAgents } from "../../lib/machine-cache";
import { S } from "../../lib/strings";
import { isSidebarRow } from "../../lib/session-grouping";
import { useSessions } from "../../state/sessions";
import { useProject } from "../../state/project";

/** Every session id starts with this; the completion's trigger token starts with it too. */
export const SESSION_ID_PREFIX = "session-";

/** How many sessions one completion may offer: the palette is a picker, not a list page. */
export const SESSION_COMPLETION_MAX = 20;

/** The query's session-id prefix, or null when the query does not start one. */
export function sessionQueryPrefix(query: string): string | null {
  const first = query.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return first.startsWith(SESSION_ID_PREFIX) ? first : null;
}

/** The status's word for a completion row (the sidebar's glyph carries no text of its own). */
export function sessionStatusWord(status: SessionStatus): string {
  if (status === "running") return S.chat.statusRunning;
  if (status === "compacting") return S.chat.statusCompacting;
  return S.chat.statusIdle;
}

/**
 * How much of a session id one completion's detail keeps: the id rides beside the status word
 * as the row's secondary text, and ids past this length end with an ellipsis so the title —
 * the row's main text — keeps its room.
 */
export const SESSION_DETAIL_ID_MAX = 44;

/** A session id trimmed to {@link SESSION_DETAIL_ID_MAX} characters, the tail ellipsed. */
export function sessionDetailId(sessionId: string): string {
  return sessionId.length > SESSION_DETAIL_ID_MAX
    ? `${sessionId.slice(0, SESSION_DETAIL_ID_MAX)}…`
    : sessionId;
}

/** The row's secondary text: the status's word beside the session's id. */
export function sessionDetail(status: SessionStatus, sessionId: string): string {
  return `${sessionStatusWord(status)} · ${sessionDetailId(sessionId)}`;
}

/**
 * The sessions whose id starts the query, in the order the caller holds them (the store's, most
 * recently active first), as palette actions: the title (the sidebar's untitled fallback), the
 * status word beside it, and a jump to the chat page on run. Rows the sidebar does not draw are
 * never offered — a completion lands somewhere the sidebar itself could have taken the user.
 * The row's secondary text carries the status word beside the session's id.
 */
export function sessionCompletionActions(
  sessions: readonly SessionInfo[],
  query: string,
  navigate: (path: string) => void,
): readonly PaletteAction[] {
  const prefix = sessionQueryPrefix(query);
  if (prefix === null) return [];
  return sessions
    .filter((s) => isSidebarRow(s) && s.sessionId.toLowerCase().startsWith(prefix))
    .slice(0, SESSION_COMPLETION_MAX)
    .map((s) => ({
      id: `session:${s.sessionId}`,
      label: s.title ?? S.chat.defaultSessionTitle,
      keywords: [s.sessionId],
      detail: sessionDetail(s.status, s.sessionId),
      run: () => navigate(`/chat/${encodeURIComponent(s.sessionId)}`),
    }));
}

/**
 * The rows in the activity order the sidebar pages by: most recently active first, ties by id.
 * The store holds its rows in this order already; a source's answer arrives in the order its
 * server chose, and a merge over several sources needs one order of its own.
 */
function mostRecentFirst(sessions: readonly SessionInfo[]): SessionInfo[] {
  return [...sessions].sort(
    (a, b) =>
      b.lastActiveAt.localeCompare(a.lastActiveAt) || b.sessionId.localeCompare(a.sessionId),
  );
}

/**
 * What the app has seen of each Agent's sessions is remembered in lib/completion-cache.ts —
 * rows the sidebar fetched and rows the completion's own live answers brought, per (project,
 * source, agent), no expiry. The next prefix that shares a head with one already asked (which
 * every typed prefix does) offers the remembered sessions at once, and only the tail of the id
 * is still on the network.
 *
 * The loaded rows, the remembered rows and every live answer merge, deduplicated by id and
 * capped: an id several hold is the row whose activity is the newest (a later answer is the
 * truer one), and an id only one holds is kept — the store's own rows, a remembered one and a
 * live one are equally real.
 */
export function mergeCompletionRows(
  loaded: readonly SessionInfo[],
  remembered: readonly (readonly SessionInfo[])[],
  answers: readonly (readonly SessionInfo[])[],
): SessionInfo[] {
  const byId = new Map<string, SessionInfo>();
  for (const s of mostRecentFirst(loaded)) byId.set(s.sessionId, s);
  for (const rows of [...remembered, ...answers]) {
    for (const s of mostRecentFirst(rows)) {
      const known = byId.get(s.sessionId);
      if (known === undefined || known.lastActiveAt < s.lastActiveAt) byId.set(s.sessionId, s);
    }
  }
  return mostRecentFirst([...byId.values()]).slice(0, SESSION_COMPLETION_MAX);
}

/**
 * The completion as the palette takes it: the store's rows and the router's navigate, memoized.
 * A query starting a session id answers at once — from the loaded rows, the remembered answers
 * and the previous query's — and asks every source (this server, then the Project's machines)
 * with the prefix live; the answers merge in as they land. While the sources are still answering,
 * `pending` says so and the palette draws a word for the wait. A source that fails — the network,
 * a machine out of reach — is silently dropped: the loaded and remembered rows still answer,
 * which is what the palette did before the live query existed.
 */
export function useSessionCompletion(): {
  suggest: (query: string) => readonly PaletteAction[];
  pending: boolean;
} {
  const { sessions, machineIds } = useSessions();
  const { currentProject, agents } = useProject();
  const navigate = useNavigate();
  const goTo = useCallback((path: string) => void navigate(path), [navigate]);
  const [live, setLive] = useState<readonly SessionInfo[]>([]);
  const [pending, setPending] = useState(false);
  /** The query the `live` rows answer, so a keystroke that has no answer yet reads the last one's. */
  const asked = useRef<string>("");

  return useMemo(
    () => ({
      suggest: (query: string) => {
        const prefix = sessionQueryPrefix(query);
        // The answer this keystroke shows: the previous query's rows, until this one's are built.
        let answer = live;
        if (prefix === null) {
          asked.current = "";
          setLive([]);
          setPending(false);
          answer = sessions;
        } else if (asked.current !== query) {
          asked.current = query;
          const projectId = currentProject?.projectId;
          if (projectId === undefined) {
            setLive([]);
            setPending(false);
            answer = sessions;
          } else {
            // The immediate answer: the loaded rows, then every source's remembered rows —
            // the cache is read here, at the read the row has to be known by, filtered to the
            // prefix by the action builder below.
            const merged = mergeCompletionRows(sessions, [], [live]);
            // Every source is asked the moment a fresh prefix arrives; a slow or absent one
            // simply never contributes, and the loaded and remembered rows carried the answer
            // meanwhile. The completion's agents: this server's Agent set, and each machine's own.
            const agentIds = agents.map((a) => a.agentId);
            let outstanding = 0;
            for (const source of [null, ...machineIds]) {
              // A machine's Agents are its own (lib/agent-location.ts); what it was last seen
              // running stands in when it cannot be asked right now — the same account the
              // session store pages by.
              const agentIdsOfSource =
                source === null
                  ? agentIds
                  : cachedMachineAgents(projectId, source).map((a) => a.agentId);
              for (const agentId of agentIdsOfSource) {
                for (const s of cachedCompletionRows(projectId, source, agentId)) merged.push(s);
                api
                  .listSessions(
                    projectId,
                    agentId,
                    { limit: SESSION_COMPLETION_MAX, order: "activity", sessionIdPrefix: prefix },
                    source,
                  )
                  .then((res) => {
                    rememberCompletionRows(projectId, source, agentId, res.sessions);
                    setLive((prev) => mergeCompletionRows([], [], [prev, res.sessions]));
                  })
                  .catch(() => {})
                  .finally(() => {
                    outstanding -= 1;
                    if (outstanding === 0) setPending(false);
                  });
                outstanding += 1;
              }
            }
            setPending(outstanding > 0);
            setLive(merged);
            answer = merged;
          }
        }
        return sessionCompletionActions(answer, query, goTo);
      },
      pending,
    }),
    [sessions, live, pending, machineIds, agents, goTo, currentProject],
  );
}
