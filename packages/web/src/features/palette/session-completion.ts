/**
 * Session completion for the command palette: typing the start of a session id (`session-…`)
 * offers that session — its title beside its run state, Enter jumps to its chat page. The rows
 * are the sidebar's own (the session store the sidebar pages into), so a completion names what
 * the app already holds and nothing is fetched for it.
 *
 * Pure core plus a hook: `sessionCompletionActions` builds the actions from rows the caller
 * passes (the hook reads the store; the tests pass literals), and `useSessionCompletion` is the
 * function AppLayout hands the palette. The palette calls it with the raw query on every
 * keystroke; it answers nothing at all until the query's first token starts a session id.
 */
import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router";
import type { PaletteAction } from "@prismshadow/penguin-ui";
import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { isSidebarRow } from "../../lib/session-grouping";
import { useSessions } from "../../state/sessions";

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
 * The sessions whose id starts the query, most recently active first, as palette actions: the
 * title (the sidebar's untitled fallback), the status word beside it, and a jump to the chat
 * page on run. Rows the sidebar does not draw are never offered — a completion lands somewhere
 * the sidebar itself could have taken the user.
 */
export function sessionCompletionActions(
  sessions: readonly SessionInfo[],
  query: string,
  navigate: (path: string) => void,
): readonly PaletteAction[] {
  const prefix = sessionQueryPrefix(query);
  if (prefix === null) return [];
  const matches = sessions.filter(
    (s) => isSidebarRow(s) && s.sessionId.toLowerCase().startsWith(prefix),
  );
  return matches.slice(0, SESSION_COMPLETION_MAX).map((s) => ({
    id: `session:${s.sessionId}`,
    label: s.title ?? S.chat.defaultSessionTitle,
    keywords: [s.sessionId],
    detail: sessionStatusWord(s.status),
    run: () => navigate(`/chat/${encodeURIComponent(s.sessionId)}`),
  }));
}

/** The completion as the palette takes it: the store's rows and the router's navigate, memoized. */
export function useSessionCompletion(): (query: string) => readonly PaletteAction[] {
  const { sessions } = useSessions();
  const navigate = useNavigate();
  const goTo = useCallback((path: string) => void navigate(path), [navigate]);
  return useMemo(
    () => (query: string) => sessionCompletionActions(sessions, query, goTo),
    [sessions, goTo],
  );
}
