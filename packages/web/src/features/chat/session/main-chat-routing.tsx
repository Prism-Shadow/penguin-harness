import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../../lib/strings";
import { useDocumentTitle } from "../../../lib/use-document-title";
import type { MemoryLocateTarget } from "../../../lib/omni/memory-changes";
import { DRAFT_SESSION_ID, parkedDraftIdOf } from "../draft-sessions";
import {
  heldRouteSession,
  resolveRoutedSession,
  routedView,
  sessionProbeKey,
} from "../session-project";
import { machineForSession } from "../../../lib/session-machines";
import { useMachineModels } from "../../../lib/machine-models";
import { setDockCwd, dockVersion, openPanel, panelDock, subscribeDock } from "../../dock";
import { terminalApiSupported, subscribeTerminals } from "../../terminal";
import type { useMainChatInputs } from "./main-chat-inputs";

/** Exact consecutive main ChatPage statements 26..61; called once, in original order. */
export function useMainChatRouting(scope: ReturnType<typeof useMainChatInputs>) {
  const { location, params, projectId, agentId, sessions, isSessionDeleted } = scope;

  const routeSessionId = params.sessionId ?? null;
  // The docks' arrangement lives in the dock store (features/dock) — tabs, active tab,
  // sizes, all global and persisted. This page re-renders on any dock change and owns only
  // the stream-driven JUMP COMMANDS the panel bodies consume: each is a fresh object per
  // call (identity-compared, so repeating the same jump still re-triggers the view's
  // effect), and each resets on a Session switch because it pointed into the old session's
  // stream. The tabs themselves deliberately survive the switch — the panels re-bind to
  // the conversation on screen.
  useSyncExternalStore(subscribeDock, dockVersion);
  useSyncExternalStore(subscribeTerminals, terminalApiSupported);
  /** Workspace tab: locate this file in the tree (a message file card's click, or a reply's link to a file). */
  const [fileOpenRequest, setFileOpenRequest] = useState<{ path: string } | null>(null);
  /**
   * Brings the Workspace tab up on a Workspace-relative path. Both callers have already
   * normalized the text they hold (toWorkspaceRelative strips an absolute prefix and converts
   * Windows separators). Stable on purpose: every link rendered in the transcript reads it
   * through context, so a fresh function per render would re-render them all on every frame.
   */
  const openWorkspaceFile = useCallback((path: string) => {
    openPanel("workspace");
    setFileOpenRequest({ path });
  }, []);
  /** Memory tab: land on this memory's detail (a card row), or the list (null target). */
  const [memoryRequest, setMemoryRequest] = useState<{
    target: MemoryLocateTarget | null;
  } | null>(null);
  /** Agents tab: select this child conversation (a subagent chip's click; the chain ends with the child's own id). */
  const [subagentFocus, setSubagentFocus] = useState<{
    sessionId: string;
    origin: string[];
  } | null>(null);
  /**
   * Which Task's topology the agents tab displays. Null = the LATEST Task; a chip click
   * pins the graph to the Task containing that chip instead — `anchorSessionId` is the
   * clicked child's TOP-LEVEL ancestor, which the view resolves to its Task slice.
   */
  const [subagentTaskScope, setSubagentTaskScope] = useState<{
    anchorSessionId: string;
  } | null>(null);
  useEffect(() => {
    setFileOpenRequest(null);
    setMemoryRequest(null);
    setSubagentFocus(null);
    setSubagentTaskScope(null);
  }, [routeSessionId]);
  // A command also resets when its panel's TAB closes: the tab body unmounts with the tab,
  // so a re-added tab is a fresh mount that would otherwise replay the stale command —
  // reopening the Workspace would re-locate a long-clicked file, and reopening the agents
  // tab would come back pinned to an old Task instead of the latest.
  const workspaceTabExists = panelDock("workspace") !== null;
  const memoryTabExists = panelDock("memory") !== null;
  const agentsTabExists = panelDock("agents") !== null;
  useEffect(() => {
    if (!workspaceTabExists) setFileOpenRequest(null);
  }, [workspaceTabExists]);
  useEffect(() => {
    if (!memoryTabExists) setMemoryRequest(null);
  }, [memoryTabExists]);
  useEffect(() => {
    if (!agentsTabExists) {
      setSubagentFocus(null);
      setSubagentTaskScope(null);
    }
  }, [agentsTabExists]);
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
  // A Session this page deleted, or heard was deleted, is not shown from a stale lookup either:
  // its route probes, fails at once on the tombstone, and moves on.
  const listed =
    draft || (routeSessionId !== null && isSessionDeleted(routeSessionId))
      ? null
      : resolveRoutedSession(routeSessionId, sessions, fetchedSession);
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
  /** The probe that failed did so with a 404: the server has no such Session for this user. */
  const [probeMissingKey, setProbeMissingKey] = useState<string | null>(null);
  const heldSession = useRef<SessionInfo | null>(null);
  heldSession.current = heldRouteSession(
    heldSession.current,
    listed,
    routeSessionId ?? null,
    probeKey !== null && probeFailedKey === probeKey,
  );
  const routed = draft ? null : heldSession.current;
  /**
   * An archived Session the route names is shown as a stub (archived-session-stub.tsx), never as
   * a conversation (routedView). None of the conversation's machinery — its stream and history,
   * its composer, its dock panels, its usage and processes — runs for it: `selected` is null and
   * the stub reads `archivedRow` instead. Unarchiving swaps the row in and the conversation loads
   * in place.
   */
  const { conversation: selected, archived: archivedRow } = routedView(routed);
  /**
   * The Agent this page renders under: the conversation's own, else the current Agent (a draft
   * has no Session, and an archived Session's stub runs nothing of its conversation). The
   * current Agent is resolved against THIS server's Agent list and is adopted from the Session
   * only when that list carries it — an organization's employee whose Agent lives on a machine
   * is never in it, so going by the current Agent alone left that conversation on the
   * placeholder for good, with nothing to say why.
   */
  const draftOwnerKey = `${projectId}:${parkedDraftId ?? location.key}`;
  const [draftOwner, setDraftOwner] = useState<{
    key: string;
    agentId: string | null;
    machineId: string | null;
  } | null>(null);
  const onDraftAgent = useCallback(
    (agentId: string | null, machineId: string | null) => {
      setDraftOwner({ key: draftOwnerKey, agentId, machineId });
    },
    [draftOwnerKey],
  );
  const resolvedDraftOwner = draftOwner?.key === draftOwnerKey ? draftOwner : null;
  const pageAgentId = draft
    ? (resolvedDraftOwner?.agentId ?? null)
    : (selected?.agentId ?? agentId);
  const pageMachineId = draft
    ? (resolvedDraftOwner?.machineId ?? null)
    : selected === null
      ? null
      : machineForSession(selected.sessionId);
  /**
   * The models this page offers and prices by: those of the server it acts on. A draft whose
   * workspace is on a machine creates its Session over there, and a conversation on a machine
   * runs there — either way the machine's own models are the ones it can take.
   */
  const machineModels = useMachineModels(projectId, pageMachineId);
  const models = pageMachineId === null ? scope.models : machineModels;
  // The tabs beside a conversation are its OWN Agent's, asked of the server that Agent's
  // workflows live on: a Session on a machine runs a copy of the Agent there, and the workflows
  // it built are in that copy. The current Agent is always one of this server's, so going by
  // it listed the wrong Agent's workflows (or none) for every Session on a machine.
  const workflowMachineId = draft
    ? (resolvedDraftOwner?.machineId ?? null)
    : selected === null
      ? null
      : machineForSession(selected.sessionId);
  // New shells start in this conversation's Workspace — its files are what a terminal
  // opened here is for. While drafting, the Workspace is the one picked in the draft and
  // DraftView publishes it instead (a child effect runs before this one, so this must
  // yield rather than clobber it with null). Leaving the chat for another page keeps the
  // last conversation's Workspace: it is a better default than home for the hotkey,
  // which stays live everywhere. With the machine that Workspace is on: the path only means
  // anything on its own filesystem, and a shell for this conversation belongs beside the
  // agent running it.
  useEffect(() => {
    if (draft) return;
    setDockCwd(
      selected?.workspace ?? null,
      selected === null ? null : machineForSession(selected.sessionId),
    );
  }, [draft, selected]);

  // Currently effective model (session state, the model reference comes from the Session DTO): model selection in draft state is handled internally by DraftView.
  const activeModelRef = selected
    ? { provider: selected.provider, modelId: selected.modelId }
    : null;

  // Tab title follows the current Session (refreshes in sync once the auto-generated title arrives).
  useDocumentTitle(routed ? (routed.title ?? S.chat.defaultSessionTitle) : S.nav.chat);
  return {
    ...scope,
    routeSessionId,
    fileOpenRequest,
    setFileOpenRequest,
    openWorkspaceFile,
    memoryRequest,
    setMemoryRequest,
    subagentFocus,
    setSubagentFocus,
    subagentTaskScope,
    setSubagentTaskScope,
    workspaceTabExists,
    memoryTabExists,
    agentsTabExists,
    parkedDraftId,
    draft,
    draftWorkspace,
    setDraftWorkspace,
    onDraftWorkspace,
    onDraftAgent,
    browseFilesKey,
    openedForBrowse,
    fetchedSession,
    setFetchedSession,
    listed,
    probeKey,
    probeFailedKey,
    setProbeFailedKey,
    probeMissingKey,
    setProbeMissingKey,
    heldSession,
    routed,
    selected,
    archivedRow,
    pageAgentId,
    pageMachineId,
    models,
    workflowMachineId,
    activeModelRef,
  };
}
