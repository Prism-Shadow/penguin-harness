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
 * completion a mount inside the providers publishes for the palette. The palette calls it with
 * the raw query on every keystroke; it answers nothing at all until the query's first token
 * starts a session id.
 *
 * The palette itself is mounted at the App root, outside the providers, because the pages
 * outside the shell share it (the terminal, a workflow's full-page app, the login screen). So a
 * mount that has the sessions — the layout — publishes its completion here for the palette to
 * read, the same in-memory publication lib/terminal-machines.ts uses: rebuilt by the mount that
 * owns it, absent while nothing is mounted. Reading the store at the root instead threw
 * `useSessions must be used within a SessionsProvider` and took the whole App down through the
 * error boundary (2026-10-28).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { cachedCompletionRows, rememberCompletionRows } from "../../lib/completion-cache";
import { cachedMachineAgents } from "../../lib/machine-cache";
import { S } from "../../lib/strings";
import { useSessions } from "../../state/sessions";
import { useProject } from "../../state/project";

/** Every session id starts with this; the completion's trigger token starts with it too. */
export const SESSION_ID_PREFIX = "session-";

/** How many sessions one completion may offer: the palette is a picker, not a list page. */
export const SESSION_COMPLETION_MAX = 20;

/**
 * The cap one source's query rides: a source out of reach — a machine, or this server under a
 * heavy load — must not hold the wait. The cap rejects the call, the call's signal aborts the
 * HTTP path underneath (the socket path is bounded by its own answer timeout), and the source
 * is silently dropped; the rows the cache and the loaded store hold answer meanwhile.
 */
export const SOURCE_TIMEOUT_MS = 3_000;

/** How long a keystroke waits before the sources are asked: a typed prefix lands as one query, not one per key. */
export const QUERY_DEBOUNCE_MS = 250;

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
 * Whether the completion offers this row: the palette is the picker for every conversation a
 * session id can name, not the sidebar's stream — an archived conversation (its chat page
 * opens as a stub until it is unarchived) and an organization's desk or ticket session (the
 * chat page opens it as a direct lookup) belong here; a subagent session does not, its
 * parent's Agent panel is where it is reached.
 */
export function isCompletionRow(s: SessionInfo): boolean {
  return s.source !== "subagent";
}

/**
 * The sessions whose id starts the query, in the order the caller holds them (the store's, most
 * recently active first), as palette actions: the title (the sidebar's untitled fallback), the
 * status word beside it, and a jump to the chat page on run. Rows the app cannot open from the
 * id alone are never offered — a subagent session's panel is where it is reached — while an
 * archived conversation and an organization's session (including the trace-only ones the
 * prefix query's answer carries) land on the pages the app itself already serves for them.
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
    .filter((s) => isCompletionRow(s) && s.sessionId.toLowerCase().startsWith(prefix))
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
 * A machine source's query under its cap: the promise rejects past {@link ms} even when the
 * transport has no answer and carries the abort into the HTTP path with it, so a machine out
 * of reach is cut loose instead of holding the wait.
 */
export function cappedSourceQuery<T>(
  request: (signal?: AbortSignal) => Promise<T>,
  ms: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new DOMException("The source did not answer in time.", "TimeoutError"));
    }, ms);
    void request(controller.signal).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/** One source of the query: this server's own (no machine) or one of the Project's machines. */
export interface CompletionSource {
  source: string | null;
  /** The Agents of that source whose sessions are asked (this server's, or the machine's own). */
  agentIds: readonly string[];
}

/**
 * Asks every source the prefix live, one call per (source, Agent), and reports the answers and
 * the wait: each call runs in its own try, so a source that fails or is dropped past its cap
 * contributes nothing and does not hold the others — the wait ends when the last source
 * settles, and it is that wait (`onSettled`) the hook's `pending` stands for.
 *
 * Every source's call is capped (see {@link SOURCE_TIMEOUT_MS}) and rides a signal that
 * aborts its HTTP path — this server's own read included, for a host with a heavy session
 * index must not hold the palette either. Fire and forget: the completion merges the answers
 * as they land and clears the wait when `onSettled` runs — nothing is awaited.
 */
export function askCompletionSources(args: {
  projectId: string;
  prefix: string;
  agentsBySource: readonly CompletionSource[];
  ask: (
    projectId: string,
    agentId: string,
    opts: { limit: number; order: "activity"; sessionIdPrefix: string },
    source: string | null,
    call?: { signal?: AbortSignal },
  ) => Promise<{ readonly sessions: readonly SessionInfo[] }>;
  /** One source's answer, as it lands — the hook remembers and merges it live. */
  onAnswer: (source: string | null, agentId: string, rows: readonly SessionInfo[]) => void;
  /** When every source has answered or been dropped — the hook clears its wait. */
  onSettled: () => void;
}): void {
  const opts = {
    limit: SESSION_COMPLETION_MAX,
    order: "activity" as const,
    sessionIdPrefix: args.prefix,
  };
  let outstanding = 0;
  const settled = (): void => {
    outstanding -= 1;
    if (outstanding === 0) args.onSettled();
  };
  for (const { source, agentIds } of args.agentsBySource) {
    for (const agentId of agentIds) {
      const answer = cappedSourceQuery(
        (signal) =>
          args.ask(args.projectId, agentId, opts, source, signal === undefined ? {} : { signal }),
        SOURCE_TIMEOUT_MS,
      );
      answer
        .then((res) => args.onAnswer(source, agentId, res.sessions))
        .catch(() => {})
        .finally(settled);
      outstanding += 1;
    }
  }
  if (outstanding === 0) args.onSettled();
}

/**
 * The completion as the palette takes it: the store's rows and the router's navigate, memoized.
 * A query starting a session id answers at once — from the loaded rows, the remembered answers
 * and the previous query's — and asks every source (this server, then the Project's machines)
 * with the prefix live, once the keystroke has settled and never twice for the prefix a live
 * query is already out for; the answers merge in as they land. While the sources are still
 * answering, `pending` says so and the palette draws a word for the wait. A source that fails —
 * the network, a machine out of reach, one cut loose past its cap — is silently dropped: the
 * loaded and remembered rows still answer, which is what the palette did before the live query
 * existed.
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
  /** The keystroke's ask waits this long: a typed prefix lands as one query, not one per key. */
  const askTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The prefix a live query is out for; a keystroke sharing it rides the answer already coming. */
  const asking = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (askTimer.current !== undefined) clearTimeout(askTimer.current);
    },
    [],
  );

  return useMemo(
    () => ({
      suggest: (query: string) => {
        const prefix = sessionQueryPrefix(query);
        // The answer this keystroke shows: the previous query's rows, until this one's are built.
        let answer = live;
        if (prefix === null) {
          asked.current = "";
          if (askTimer.current !== undefined) clearTimeout(askTimer.current);
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
            // prefix by the action builder below. The completion's agents: this server's Agent
            // set, and each machine's own — a machine's Agents are its own
            // (lib/agent-location.ts), and what it was last seen running stands in when it
            // cannot be asked right now, the same account the session store pages by.
            const agentIds = agents.map((a) => a.agentId);
            const agentsBySource = [null, ...machineIds].map((source) => ({
              source,
              agentIds:
                source === null
                  ? agentIds
                  : cachedMachineAgents(projectId, source).map((a) => a.agentId),
            }));
            const merged = mergeCompletionRows(sessions, [], [live]);
            for (const { source, agentIds: agentIdsOfSource } of agentsBySource) {
              for (const agentId of agentIdsOfSource) {
                for (const s of cachedCompletionRows(projectId, source, agentId)) merged.push(s);
              }
            }
            // The sources are asked once the keystroke has settled (a typed prefix lands as
            // one query, not one per key), and a keystroke sharing the prefix a live query is
            // already out for rides that answer instead of re-asking. A slow, failing or
            // capped source simply never contributes, and the loaded and remembered rows
            // carried the answer meanwhile.
            if (askTimer.current !== undefined) clearTimeout(askTimer.current);
            askTimer.current = setTimeout(() => {
              if (asking.current === prefix) return;
              asking.current = prefix;
              askCompletionSources({
                projectId,
                prefix,
                agentsBySource,
                ask: api.listSessions,
                onAnswer: (source, agentId, rows) => {
                  rememberCompletionRows(projectId, source, agentId, rows);
                  setLive((prev) => mergeCompletionRows([], [], [prev, rows]));
                },
                onSettled: () => {
                  if (asking.current === prefix) asking.current = null;
                  setPending(false);
                },
              });
            }, QUERY_DEBOUNCE_MS);
            setPending(true);
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

/** What the mounted shell publishes for the palette; null while nothing publishes. */
let published: {
  suggest: (query: string) => readonly PaletteAction[];
  pending: boolean;
} | null = null;

/**
 * Publishes this mount's completion for the palette while it is mounted — call it inside
 * `SessionsProvider` (the layout), never at the App root, which is outside every provider.
 */
export function usePublishedSessionCompletion(): void {
  const completion = useSessionCompletion();
  useEffect(() => {
    published = completion;
    return () => {
      // A newer mount's publication is not ours to clear.
      if (published === completion) published = null;
    };
  }, [completion]);
}

/**
 * The palette's `suggest`: whatever the mounted shell published, or nothing while no mount
 * holds the sessions (the login screen, the terminal, a workflow's full-page app) — a palette
 * with its standing actions alone, which is what those pages had before completions existed.
 * The wait rides along: a publication that is still answering says so, and the palette draws
 * its word for the wait; one that answered says nothing.
 */
export function paletteSessionCompletion(query: string): readonly PaletteAction[] {
  return published === null ? [] : published.suggest(query);
}

export function paletteSessionPending(): string | undefined {
  return published !== null && published.pending ? S.commandPalette.pending : undefined;
}
