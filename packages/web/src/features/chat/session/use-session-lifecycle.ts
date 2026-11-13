/**
 * The routed Session's lifecycle around the list: the direct lookup of a row the paged list does
 * not hold, the auto-select of the last conversation, the list badge's run state, the reloads on
 * a settled turn, and the read marker.
 */
import { useEffect, useRef, useState } from "react";
import type { SessionInfo, SessionStatus } from "@prismshadow/penguin-server/api";
import * as api from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import { latestConversation, withoutOrgSessions } from "../../../lib/session-grouping";
import { noteSessionSeen } from "../../../lib/session-seen";
import { machineForSession } from "../../../lib/session-machines";
import { noteScheduleEvent } from "../../schedules";
import { DRAFT_SESSION_ID } from "../draft-sessions";
import { routeSessionOutcome, sessionForProject } from "../session-project";
import type { SessionStreamState } from "../use-session-stream";
import type { ChatInputs } from "./use-chat-inputs";
import type { RoutedSession } from "./use-routed-session";

type LifecycleParams = Pick<
  ChatInputs,
  | "navigate"
  | "routeSessionId"
  | "projectId"
  | "agents"
  | "reloadAgents"
  | "sessions"
  | "sessionsLoading"
  | "machineLabels"
  | "machinesUnreachable"
  | "offlineMachineIds"
  | "reloadSessions"
  | "addSession"
  | "isSessionDeleted"
  | "setStatus"
> &
  Pick<
    RoutedSession,
    | "draft"
    | "setFetchedSession"
    | "listed"
    | "probeKey"
    | "probeFailedKey"
    | "setProbeFailedKey"
    | "probeMissingKey"
    | "setProbeMissingKey"
  > & {
    selected: SessionInfo | null;
    selectedSessionId: string | null;
    stream: Pick<SessionStreamState, "taskState">;
  };

export function useSessionLifecycle({
  navigate,
  routeSessionId,
  projectId,
  agents,
  reloadAgents,
  sessions,
  sessionsLoading,
  machineLabels,
  machinesUnreachable,
  offlineMachineIds,
  reloadSessions,
  addSession,
  isSessionDeleted,
  setStatus,
  draft,
  setFetchedSession,
  listed,
  probeKey,
  probeFailedKey,
  setProbeFailedKey,
  probeMissingKey,
  setProbeMissingKey,
  selected,
  selectedSessionId,
  stream,
}: LifecycleParams) {
  // The Session list is paged: a deep-linked Session (old bookmark, cross-page jump) may sit
  // beyond the loaded pages. Look it up directly and insert it before the auto-select effect
  // below concludes it doesn't exist; only a failed probe releases that redirect. `probeKey`
  // and `probeFailedKey` are declared up with `selected`, which needs them to know when to
  // let the held Session go.
  /**
   * The route names a Session we cannot answer for YET: not in the loaded pages, and the
   * direct lookup that settles it has not failed. Ordinary with a paged list — a deep link,
   * a Session just created, a row beyond the first page. Shared by the probe effect, the
   * auto-select effect and the render, so the three cannot disagree about what "pending"
   * means — their disagreeing is what once painted "no Sessions yet" over a conversation
   * that was about to appear.
   */
  /**
   * Nobody who could answer for this Session is answering, so a failed lookup settles nothing.
   *
   * Two shapes of that. Either no owner is recorded and some machine is out of reach — the
   * probe then asks THIS server (lib/session-machines.ts: absence means here), which 404s
   * about a Session that is alive THERE. Or the owner IS recorded and is itself one of the
   * machines not answering, which is every row restored from the cache. Reading either as
   * "gone" is what drops the reader into the draft page mid-conversation.
   */
  const routeSessionOwner = routeSessionId ? machineForSession(routeSessionId) : null;

  /**
   * The ssh alias of the machine a Session is on, or null for this server's own. Falls back
   * to the machine id when the list could not be read (it is admin-only) — honest, where
   * inventing a name is not.
   */
  const machineNameOf = (sessionId: string): string | null => {
    const machineId = machineForSession(sessionId);
    return machineId === null ? null : (machineLabels.get(machineId) ?? machineId);
  };
  const routeSessionUnowned =
    !!routeSessionId &&
    // Except one we deleted ourselves. That is the one case where a failed lookup settles it
    // whoever is out of reach — nobody is going to answer differently — and leaving it open
    // held the page on a skeleton for as long as some machine stayed down, on the ordinary
    // act of deleting the conversation you are looking at.
    !isSessionDeleted(routeSessionId) &&
    (routeSessionOwner === null
      ? machinesUnreachable
      : offlineMachineIds.includes(routeSessionOwner));
  // Read from `listed`, never from `selected`: the held Session above keeps the conversation
  // on screen through a refetch, but it must not tell the probe that the row is loaded — a
  // Session that really is gone has to keep probing until the lookup fails and releases both.
  const routeSessionPending =
    !!routeSessionId && listed === null && (probeFailedKey !== probeKey || routeSessionUnowned);
  /**
   * The lookup has failed and the only servers that could still answer for this Session are
   * out of reach. It is not gone — so the redirect must not fire and the row must not be
   * dropped — but it is not loading either, and a skeleton that never resolves reads as a
   * hung page. Say what is actually the matter instead, and let the recheck open it when the
   * connection is back (state/sessions.tsx: OFFLINE_RECHECK_MS).
   */
  const routeSessionOffline = routeSessionPending && probeFailedKey === probeKey;
  useEffect(() => {
    if (draft || !projectId || !routeSessionId || !probeKey || sessionsLoading) return;
    // Settled (row loaded, or the lookup already failed): nothing to probe — and a failed
    // key must not be re-probed just because the list's identity churned.
    if (!routeSessionPending) return;
    // We deleted this Session ourselves: the row is gone from the list on purpose, so the
    // lookup below could only 404 (and the server would record that as an error). Deleting
    // the conversation you are looking at is the normal way to discard a Session fork, so
    // this path runs on every such delete. Treat it as an already-failed probe, which
    // releases the redirect effect below to move on to another conversation.
    if (isSessionDeleted(routeSessionId)) {
      setProbeFailedKey(probeKey);
      return;
    }
    let cancelled = false;
    api.getSession(routeSessionId).then(
      (res) => {
        if (cancelled) return;
        const session = sessionForProject(res.session, projectId);
        if (session) {
          setFetchedSession(session);
          addSession(session);
          // A Session of an Agent the list has not loaded (company mode creates Agents
          // server-side): fetch the list, or the page has no Agent to render under.
          if (!agents.some((a) => a.agentId === session.agentId)) void reloadAgents();
        } else setProbeFailedKey(probeKey);
      },
      (err: unknown) => {
        if (cancelled) return;
        setProbeFailedKey(probeKey);
        if (err instanceof ApiError && err.status === 404) setProbeMissingKey(probeKey);
      },
    );
    return () => {
      cancelled = true;
    };
    // `selected` rather than `sessions`: while the routed row stays unloaded, list churn
    // (status flips, new pages) keeps it null and leaves the in-flight lookup alone —
    // depending on the array identity cancelled and re-issued it on every user event.
  }, [
    draft,
    projectId,
    routeSessionId,
    probeKey,
    sessionsLoading,
    routeSessionPending,
    selected,
    addSession,
    isSessionDeleted,
  ]);

  const routeOutcome = routeSessionOutcome({
    shown: selected !== null,
    pending: routeSessionPending,
    routeSessionId,
    deletedHere: routeSessionId !== null && isSessionDeleted(routeSessionId),
    missing: probeKey !== null && probeMissingKey === probeKey,
  });

  // Auto-select the last conversation when the route doesn't select one: the most recently
  // ACTIVE loaded active/schedule Session, the same rule the collapsed rail's entry follows —
  // archived rows are hidden by choice and subagent Sessions belong to their parent, so
  // neither is auto-opened. If there is none, fall back to draft state (instead of
  // auto-creating one).
  useEffect(() => {
    if (sessionsLoading || draft) return;
    if (routeOutcome !== "redirect") return;
    // An organization's desk or ticket Session is never auto-opened: landing in one by default
    // would put the user inside a conversation the scheduler drives, and company mode's own
    // groups are where it is reached.
    const last = latestConversation(withoutOrgSessions(sessions));
    navigate(last ? `/chat/${last.sessionId}` : `/chat/${DRAFT_SESSION_ID}`, { replace: true });
  }, [sessionsLoading, draft, routeOutcome, sessions, navigate]);

  // Sync task_state to the sidebar list badge.
  //
  // Keyed on the session ID, not the `selected` row: the row object is replaced whenever
  // anything about it changes — including by the user channel's own `session_state` event for
  // this very Session, which arrives on a second connection with no ordering guarantee against
  // this one. Depending on the object re-ran this effect on that replacement and re-asserted
  // whatever `stream.taskState` still held, so a run that ended could be pushed back to
  // "running" until this tab's Session stream caught up. Depending on the id means only a real
  // state change writes, and the two sources agree instead of overwriting each other.
  useEffect(() => {
    if (selectedSessionId !== null) setStatus(selectedSessionId, stream.taskState);
  }, [stream.taskState, selectedSessionId, setStatus]);

  // Task returns from running/compacting to idle ON THE SAME SESSION: this turn may have
  // spawned a sub-session or auto-created a new Agent — reload both lists so they appear in
  // the sidebar immediately (no manual refresh needed). Guarded by session identity: the
  // stream resets its state to "idle" whenever it detaches (switching conversations,
  // entering the draft), and treating that phantom transition as a completion made every
  // mid-run "new chat" click reload the sessions + agents contexts — an app-wide re-render
  // arriving right after the click, occasionally visible as an uncontrolled flicker. On a
  // switch the tracker restarts from "idle": a state observed in the same commit as the id
  // change still belongs to the previous stream, so it must not seed the new session's
  // baseline (the new stream's own task_state push advances it).
  const prevTaskRef = useRef<{ id: string | null; state: SessionStatus }>({
    id: selectedSessionId,
    state: "idle",
  });
  /**
   * Settled-turn counter handed to the dock panels that read what the Session produced — the
   * Files browser and the Trace panel; every bump means "re-read".
   */
  const [settledTurnSignal, setSettledTurnSignal] = useState(0);
  useEffect(() => {
    const prev = prevTaskRef.current;
    const sameSession = prev.id === selectedSessionId;
    prevTaskRef.current = {
      id: selectedSessionId,
      state: sameSession ? stream.taskState : "idle",
    };
    if (!sameSession || selectedSessionId === null) return;
    if (prev.state !== "idle" && stream.taskState === "idle") {
      void reloadSessions();
      void reloadAgents();
      // The turn that just ended is when the Agent's file writes landed: the Files panel's
      // listing and whatever it has open are stale from this moment on (see the browser's
      // reloadSignal), and so are the Trace panel's file list and the file it is showing —
      // the turn appended its own record to it. Same edge, same guard — a phantom "idle"
      // from a detaching stream never reaches here.
      setSettledTurnSignal((n) => n + 1);
      // The turn may equally have created a scheduled task, switched one off, or consumed a
      // one-off — so the Project's schedule directories are re-read on this same edge, the way
      // the Files and Trace panels re-read theirs. One store refresh serves both surfaces: the
      // store notifies its subscribers, so the dock's schedules panel and the sidebar row's
      // alarm clock come from the same list and cannot disagree.
      if (projectId !== null) noteScheduleEvent(projectId);
    }
  }, [stream.taskState, selectedSessionId, projectId, reloadSessions, reloadAgents]);

  // Looking at a settled Session is what marks it read (session-seen.ts): stamped on open, and
  // again when a run finishes under the user's eyes, so the sidebar row left behind is not
  // flagged unread. Depending on lastActiveAt is what keeps the marker honest across clock skew
  // — the effect above reloads the list on that same active→idle edge, and the refreshed
  // server timestamp re-runs this one.
  const selectedLastActiveAt = selected?.lastActiveAt ?? null;
  useEffect(() => {
    if (selectedSessionId === null || selectedLastActiveAt === null) return;
    if (stream.taskState !== "idle") return; // Still working: nothing settled to have read yet.
    noteSessionSeen(projectId, selectedSessionId, selectedLastActiveAt);
  }, [projectId, selectedSessionId, selectedLastActiveAt, stream.taskState]);
  return {
    routeNotFound: routeOutcome === "notFound",
    routeSessionOwner,
    machineNameOf,
    routeSessionPending,
    routeSessionOffline,
    settledTurnSignal,
  };
}
