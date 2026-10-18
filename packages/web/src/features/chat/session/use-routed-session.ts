/**
 * From the route to the conversation on screen: the draft page (`/chat/new`, a parked draft) and
 * its picked Workspace, or the routed Session — held across a refetch that momentarily does not
 * list it, until the direct lookup says it is gone.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { openPanel } from "../../dock";
import { DRAFT_SESSION_ID, parkedDraftIdOf } from "../draft-sessions";
import { heldRouteSession, resolveRoutedSession, sessionProbeKey } from "../session-project";
import type { ChatInputs } from "./use-chat-inputs";

export function useRoutedSession({
  location,
  routeSessionId,
  projectId,
  sessions,
}: Pick<ChatInputs, "location" | "routeSessionId" | "projectId" | "sessions">) {
  // Parked draft conversations (`/chat/draft-…`) render the same DraftView as `/chat/new`,
  // just bound to their own stored entry — every "this is a draft, not a Session" branch
  // below treats the two alike.
  const parkedDraftId = parkedDraftIdOf(routeSessionId);
  const draft = routeSessionId === DRAFT_SESSION_ID || parkedDraftId !== null;
  /**
   * The folder the draft has picked, and its machine — what the dock's Files panel browses
   * while there is no Session to address it by. Null for a temporary Workspace, which has no
   * directory until the first message makes one.
   */
  const [draftWorkspace, setDraftWorkspace] = useState<{
    path: string;
    machineId: string | null;
  } | null>(null);
  const onDraftWorkspace = useCallback((path: string, machineId: string | null) => {
    const trimmed = path.trim();
    setDraftWorkspace((prev) =>
      trimmed === ""
        ? null
        : prev !== null && prev.path === trimmed && prev.machineId === machineId
          ? prev
          : { path: trimmed, machineId },
    );
  }, []);
  // A Workspace group's "Browse files" in the sidebar lands on a draft for that folder and asks
  // for the Files panel: opened once per navigation, in the draft's own dock scope (AppLayout
  // points the dock at the route in a layout effect, which runs before this one).
  const browseFilesKey =
    draft && (location.state as { browseFiles?: boolean } | null)?.browseFiles === true
      ? location.key
      : null;
  const openedForBrowse = useRef<string | null>(null);
  useEffect(() => {
    if (browseFilesKey === null || openedForBrowse.current === browseFilesKey) return;
    openedForBrowse.current = browseFilesKey;
    openPanel("workspace");
  }, [browseFilesKey]);
  /**
   * The row the direct lookup below produced, kept beside the list: the list is replaced by
   * every reload, and a row that only a lookup knows about (an organization's desk, a
   * deep-linked conversation past the fetched pages) would otherwise disappear from under
   * the open conversation. See resolveRoutedSession.
   */
  const [fetchedSession, setFetchedSession] = useState<SessionInfo | null>(null);
  const listed = draft
    ? null
    : resolveRoutedSession(routeSessionId, sessions, fetchedSession, projectId);
  /**
   * The routed Session, held across a refetch that momentarily does not list it.
   *
   * `listed` is derived from a list that reload() rebuilds WHOLESALE: for the tick between
   * the fetches landing and the merged array being set, a source that answers slower, a
   * machine that misses one round, or a Session whose category changed under a page that is
   * not loaded, all read as "that row is not here". None of them mean the conversation on
   * screen has gone anywhere, so the render must not take them for it — dropping `selected`
   * for that tick paints the skeleton over a conversation the reader is in the middle of.
   *
   * Held only for the route it was seen on, and only until the direct lookup SAYS it is gone:
   * `routeSessionPending` and the redirect below still read `listed`, so a Session actually
   * deleted still probes, still fails, and still redirects — one tick later than before.
   */
  const probeKey = projectId && routeSessionId ? sessionProbeKey(projectId, routeSessionId) : null;
  const [probeFailedKey, setProbeFailedKey] = useState<string | null>(null);
  const [probeMissingKey, setProbeMissingKey] = useState<string | null>(null);
  const heldSession = useRef<SessionInfo | null>(null);
  heldSession.current = heldRouteSession(
    heldSession.current,
    listed,
    routeSessionId ?? null,
    probeKey !== null && probeFailedKey === probeKey,
    projectId,
  );
  const selected = draft ? null : heldSession.current;
  return {
    parkedDraftId,
    draft,
    draftWorkspace,
    onDraftWorkspace,
    setFetchedSession,
    listed,
    probeKey,
    probeFailedKey,
    setProbeFailedKey,
    probeMissingKey,
    setProbeMissingKey,
    selected,
  };
}

export type RoutedSession = ReturnType<typeof useRoutedSession>;
