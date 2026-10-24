import { scoped } from "../../../lib/project-scope";
import { adoptBrowserSession } from "../../builtin-browser";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SessionInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import { toastError, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { configuredCompactionLimit } from "../../../lib/context";
import { humanizeTokens } from "../../../lib/format";
import { latestConversation, withoutOrgSessions } from "../../../lib/session-grouping";
import { noteSessionSeen } from "../../../lib/session-seen";
import { latestTaskHasSubagent, taskStartCount } from "../agent-topology";
import { DRAFT_SESSION_ID } from "../draft-sessions";
import { routeSessionOutcome, sessionForProject } from "../session-project";
import { RouteProbe } from "../route-probe";
import { machineForSession } from "../../../lib/session-machines";
import { CHAT_DEFAULTS_CHANGED_EVENT, chatDefaultsChangedDetail } from "../chat-defaults-event";
import { goalPluginGate } from "../goal-plugin-gate";
import { useAgentSkills } from "../use-agent-skills";
import { applyUsageFetch } from "../header-stats";
import { hasConfiguredKey, sameModelRef } from "../../models";
import { noteScheduleEvent } from "../../schedules";
import { adoptDockScope, isTabShown, openPanel, reownTerminals } from "../../dock";
import { advancePanelTaskScope, createPanelTaskScope } from "../panel-task-scope";
import { exitedProcessIds, reportableProcessFailure } from "../process-list";
import { PROCESS_POLL_MS, STAT_PATHS_PER_REQUEST } from "./main-chat-helpers";
import type { useMainChatTranscript } from "./main-chat-transcript";

/** Exact consecutive main ChatPage statements 75..127; called once, in original order. */
export function useMainChatLifecycle(scope: ReturnType<typeof useMainChatTranscript>) {
  const {
    navigate,
    setCurrentAgentId,
    reloadAgents,
    agents,
    projectId,
    sessions,
    sessionsLoading,
    machineLabels,
    machinesUnreachable,
    offlineMachineIds,
    reloadSessions,
    addSession,
    isSessionDeleted,
    setStatus,
    costHoldRef,
    usageAppliedRef,
    bumpUsageStamp,
    setCredentialGuide,
    infoOpen,
    setModels,
    processes,
    setProcesses,
    procBusy,
    setProcBusy,
    setUsageBuckets,
    setUsageCostParts,
    setThinkingSwitch,
    setModelSwitchAsk,
    routeSessionId,
    draft,
    setFetchedSession,
    listed,
    probeKey,
    probeFailedKey,
    setProbeFailedKey,
    probeMissingKey,
    setProbeMissingKey,
    routed,
    selected,
    stream,
  } = scope;

  // Current Agent follows the Session in the route (keeps the sidebar and stats aligned on deep
  // links / refresh). Only aligns when **the selected Session changes** — never put agentId in
  // the dependency array: otherwise, when switching from a "running session" to a new chat with
  // a different Agent, navigate and setCurrentAgentId aren't in the same batch — a transitional
  // render of "new agentId + old route (old session still selected)" would appear first, and
  // this effect would then flip the Agent back to the old session's Agent based on that,
  // causing the new chat to end up created on the old Agent.
  const selectedSessionId = selected?.sessionId ?? null;
  const selectedAgentId = selected?.agentId ?? null;
  /**
   * The machine the selected Session's Agent lives on (null: this server). A Session on a
   * machine runs that machine's Agent: its settings — the thinking level and compaction threshold
   * the composer shows and edits, the settings page it links to — are that Agent's, read and
   * written over there. The same id on this server is another Agent.
   */
  const selectedAgentMachine = selected === null ? null : machineForSession(selected.sessionId);
  // Goal mode's plugin check, against the Session's Agent on the server that holds it
  // (goal-plugin-gate.ts).
  const goalPlugin = useMemo(
    () =>
      projectId && selectedAgentId
        ? goalPluginGate(projectId, selectedAgentId, selectedAgentMachine)
        : null,
    [projectId, selectedAgentId, selectedAgentMachine],
  );
  // The thinking level pinned on THIS Session, read straight off the Session row
  // (SessionInfo.thinkingLevel, written by the picker through PATCH — see
  // applyTurnThinkingLevel): "" = never pinned, and the picker then displays the Agent
  // config's level (auto-follow — each model context reads the config, so Agent-config edits
  // keep taking effect). A pin is DURABLE: it survives a reload, shows up in a second tab,
  // and core applies it from the Session's next LLM request on (soft-limited — a pick mid-chat
  // is confirmed first, offering to compact, since the change invalidates the model's cached
  // context). It is still never written through to the Agent config (that stays draft-only).
  const turnThinkingLevel = selected?.thinkingLevel ?? "";
  // The Agent list may not carry this Session's Agent yet (an Agent an organization created
  // moments ago): the probe below reloads the list, and this effect re-runs once it lands.
  const selectedAgentKnown =
    selectedAgentId !== null && agents.some((a) => a.agentId === selectedAgentId);
  useEffect(() => {
    if (selectedSessionId && selectedAgentId && selectedAgentKnown)
      setCurrentAgentId(selectedAgentId);
    else if (selectedSessionId && selectedAgentId)
      console.warn(
        `[chat] the Agent ${selectedAgentId} of ${selectedSessionId} is not in this server's Agent list; the conversation renders under the Session's own Agent id`,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, selectedAgentId, selectedAgentKnown, setCurrentAgentId]);

  // Agents tab AUTO-OPEN (the one automatic tab action): the pure tracker
  // (advancePanelTaskScope, unit-tested) brings the agents tab to the front on the CURRENT
  // task's first live spawn, re-armed at every task boundary so a manual close is respected
  // until the next one. It never re-triggers an already-shown tab (that would yank a pinned
  // historical graph back to the latest Task); the tracker consumes the attempt regardless.
  const panelTaskScopeRef = useRef(createPanelTaskScope());
  // Deliberately the LIVE model's items only (never the backfilled prefix): the tracker
  // reads an INCREASE as "the user started a new Task", and a scroll-up backfill growing
  // the count would spuriously re-arm the auto-open mid-conversation. The latest Task
  // always lives in the live tail window, so live-only loses nothing.
  const taskCount = taskStartCount(stream.model.items);
  const liveSpawn = stream.taskState !== "idle" && latestTaskHasSubagent(stream.model);
  useEffect(() => {
    const action = advancePanelTaskScope(panelTaskScopeRef.current, {
      sessionId: selectedSessionId,
      taskCount,
      liveSpawn,
    });
    if (action === "autoOpen" && !isTabShown("agents")) openPanel("agents");
    // The tracker only acts on real transitions of these three observed values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionId, taskCount, liveSpawn]);

  // Skills installed on the session's Agent, on its machine (candidates for the input area's
  // skill dropdown); a switch clears them, which also clears the input area's selection.
  const { skills: agentSkills } = useAgentSkills(projectId, selectedAgentId, selectedAgentMachine);

  // Two readouts come off the session Agent's config, via the same agent-config endpoint the
  // draft picker uses. The configured thinking level ("" = unset/loading) is what the in-session
  // picker DISPLAYS while the user hasn't picked a level (auto-follow — sending still omits the
  // level until touched, see turnThinkingLevel). The configured compaction threshold is the
  // basis the composer's context ring fills against, and the number its small-window notice is
  // judged against. A failed fetch leaves both unset (the picker shows an em dash until picked;
  // the ring falls back to the model window and the notice stays down).
  const [agentThinkingLevel, setAgentThinkingLevel] = useState("");
  const [compactionLimit, setCompactionLimit] = useState<number | undefined>(undefined);
  // Cleared on an Agent switch only. A plain refresh must not blank values that are about to
  // come back unchanged: doing that inside the fetch effect would flash the thinking picker's
  // em dash and drop the ring to the window basis on every refetch.
  useEffect(() => {
    setAgentThinkingLevel("");
    setCompactionLimit(undefined);
  }, [projectId, selectedAgentId]);
  // Re-read on focus as well as on an Agent switch: the threshold is edited on another page, so
  // the value this composer holds can go stale under it. Routing to the settings page and back
  // remounts this page and refetches anyway; the focus listener covers the other tab editing the
  // same Agent. (`models` has no such refresh — a model entry is not edited mid-conversation the
  // way a threshold is, and it already listens for its own change event.)
  const [agentConfigTick, setAgentConfigTick] = useState(0);
  useEffect(() => {
    const onFocus = () => setAgentConfigTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);
  useEffect(() => {
    if (!projectId || !selectedAgentId) return;
    let cancelled = false;
    api
      .getAgentConfig(projectId, selectedAgentId, null)
      .then((res) => {
        if (cancelled) return;
        setAgentThinkingLevel(res.config.model?.thinkingLevel ?? "");
        setCompactionLimit(configuredCompactionLimit(res.config.compaction?.maxContextLength));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selectedAgentId, agentConfigTick]);
  /**
   * Commits the threshold the context panel's cutter proposed, then re-reads the Agent config
   * this page holds so the ring, the cutter and the small-window notice all move together.
   *
   * Compaction settings are re-read by the engine at every compaction checkpoint, so this
   * applies to the conversation on screen without waiting for a rotation — which is what the
   * toast says. Rejecting rather than swallowing the failure is what keeps the dialog open on
   * the value the user typed.
   */
  const onChangeCompactionLimit = useCallback(
    async (maxContextLength: number): Promise<void> => {
      if (!projectId || !selectedAgentId) return;
      try {
        await api.putAgentConfig(
          projectId,
          selectedAgentId,
          { config: { compaction: { maxContextLength } } },
          null,
        );
      } catch (e) {
        toastError(apiErrorText(e));
        throw e;
      }
      setCompactionLimit(configuredCompactionLimit(maxContextLength));
      setAgentConfigTick((n) => n + 1);
      toastSuccess(S.chat.contextThresholdSaved(humanizeTokens(maxContextLength)));
    },
    [projectId, selectedAgentId],
  );

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
   * hung page. Say what is actually the matter instead, and let the machine list open it when
   * the connection is back — the server says so the moment it is (state/machines.tsx).
   */
  const routeSessionOffline = routeSessionPending && probeFailedKey === probeKey;
  /** The direct lookup of the routed Session, one per page (route-probe.ts). */
  const [routeProbe] = useState(() => new RouteProbe());
  /** A row the lookup found while the Session list was still loading, to add once it settles. */
  const addWhenListed = useRef<SessionInfo | null>(null);
  useEffect(() => {
    routeProbe.track(draft ? null : probeKey, sessionsLoading);
    // NOT gated on `sessionsLoading`: the direct lookup is what opens the conversation, and
    // holding it behind the sidebar's list fan-out (one first page per Agent per machine)
    // put seconds of sidebar work in front of the conversation the reader asked for. The
    // failure path below is the one place the list still matters, and it is handled there.
    if (draft || !projectId || !routeSessionId || !probeKey) return;
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
    // Deliberately NOT cancelled on re-run: this lookup is keyed by the routed Session, and
    // its answer stays valid across the list churn that re-runs this effect. Tying its
    // lifetime to one run is what made a deep link issue a dozen identical requests. One
    // lookup per Session in flight, the list's loading read when it settles, and an answer
    // about a Session the route has left dropped: see route-probe.ts.
    routeProbe.run(
      probeKey,
      async () => sessionForProject((await api.getSession(routeSessionId)).session, projectId),
      {
        found: (session, listLoading) => {
          setFetchedSession(session);
          // add() invalidates a reload in flight. During the sidebar's first load that threw
          // the whole load away, leaving the list on this one row and still loading; the
          // conversation needs only the fetched row, so the list gets it once it has settled.
          if (listLoading) addWhenListed.current = session;
          else addSession(session);
          // A Session of an Agent the list has not loaded (company mode creates Agents
          // server-side): fetch the list, or the page has no Agent to render under.
          if (!agents.some((a) => a.agentId === session.agentId)) void reloadAgents();
        },
        // Only once the list has settled: a failure while it loads is not a verdict, and
        // this effect re-runs when it settles and asks again.
        gone: (cause) => {
          setProbeFailedKey(probeKey);
          // Only an answer that the Session does not exist settles it as missing; a failure to
          // get any answer is not that, and keeps the old way on.
          if (cause instanceof ApiError && cause.status === 404) setProbeMissingKey(probeKey);
        },
      },
    );
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
  // The row found during the list's first load, added once the list has settled and only if
  // it did not bring the row itself (one beyond the first page, or an organization's row,
  // which no list page serves and whose status and title events reach only listed rows).
  useEffect(() => {
    const row = addWhenListed.current;
    if (sessionsLoading || row === null) return;
    addWhenListed.current = null;
    if (row.sessionId !== routeSessionId || sessions.some((s) => s.sessionId === row.sessionId))
      return;
    addSession(row);
  }, [sessionsLoading, sessions, routeSessionId, addSession]);

  /**
   * What becomes of the routed Session (session-project.ts): shown, still being looked for, a
   * reason to open another conversation, or — the direct lookup said it does not exist — a
   * dead link the page owns up to in place rather than swapping in some other conversation.
   */
  const routeOutcome = routeSessionOutcome({
    shown: routed !== null,
    pending: routeSessionPending,
    routeSessionId,
    deletedHere: routeSessionId !== null && isSessionDeleted(routeSessionId),
    missing: probeKey !== null && probeMissingKey === probeKey,
  });

  // Auto-select the last conversation when the route doesn't select one: the most recently
  // ACTIVE loaded conversation of the user's own (`user` source), the same rule the collapsed
  // rail's entry follows — archived rows are hidden by choice and background Sessions were
  // opened by a program, so neither is auto-opened. If there is none, fall back to draft state
  // (instead of auto-creating one). A routed id missing from the paged list isn't gone until
  // the direct lookup fails, and one the lookup says does not exist is not replaced at all.
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
      if (projectId !== null) noteScheduleEvent(projectId, machineForSession(selectedSessionId));
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

  // Positive-only existence cache for file summary cards (session-level): normalized relative
  // path -> true, or the shared in-flight lookup. Missing files aren't retained — a later Task may
  // create the same path, so its summary must re-check instead of inheriting stale false state.
  const statCacheRef = useRef(new Map<string, true | Promise<boolean>>());

  // Session switch: resets the usage-fetch marker, the file-card existence cache, any
  // thinking-level switch staged behind its dialog (per-session UI state — a compaction
  // that self-heals to a new session id routes through here too and drops the held pick),
  // a model switch waiting behind its own dialog (it was asked of the conversation left),
  // and the popover's per-session data (process list / token buckets / cost parts),
  // avoiding stale data from the previous Session (the panel jump commands reset in their
  // own effect above, and the cost hold re-keys itself inside advanceCostStat). The thinking level itself needs no reset — it is read off the
  // selected Session row, so it changes with the session by construction.
  useEffect(() => {
    usageAppliedRef.current = null;
    setThinkingSwitch(null);
    setModelSwitchAsk(null);
    statCacheRef.current = new Map();
    setProcesses([]);
    setUsageBuckets(null);
    setUsageCostParts(null);
  }, [routeSessionId]);

  // Batched existence check for file summaries: cache stable positive results and share in-flight
  // requests, but never retain a negative result. Each pending lookup mutates the cache only while
  // it is still the current entry, so an old request can't delete or overwrite a newer one.
  const statFiles = useCallback(
    async (paths: string[]): Promise<ReadonlySet<string>> => {
      const sessionId = selected?.sessionId ?? null;
      const cache = statCacheRef.current;
      const misses = sessionId === null ? [] : paths.filter((p) => !cache.has(p));
      if (sessionId !== null && misses.length > 0) {
        for (let i = 0; i < misses.length; i += STAT_PATHS_PER_REQUEST) {
          const chunk = misses.slice(i, i + STAT_PATHS_PER_REQUEST);
          const batch = api
            .statSessionFiles(sessionId, chunk)
            .then((res) => new Set(res.existing))
            .catch(() => null);
          for (const p of chunk) {
            const pending = batch.then((existing) => existing?.has(p) ?? false);
            cache.set(p, pending);
            void pending.then((exists) => {
              if (cache.get(p) !== pending) return;
              if (exists) cache.set(p, true);
              else cache.delete(p);
            });
          }
        }
      }
      const result = new Set<string>();
      await Promise.all(
        paths.map(async (p) => {
          const hit = cache.get(p);
          if (hit === true || (hit instanceof Promise && (await hit))) result.add(p);
        }),
      );
      return result;
    },
    [selected?.sessionId],
  );

  // Session's cumulative cost (priced by the server in real time from its usage rows): fetched
  // once when the session becomes selected — even mid-run, so a page load during an active run
  // recovers the already-accrued total instead of waiting for idle — then refreshed on every
  // return to idle (the authoritative reconcile, as before). usageAppliedRef marks the initial
  // fetch done only when a response applies, so a cancelled/failed attempt retries on the next
  // transition rather than polling. The cancelled flag doubles as a staleness guard: any
  // task-state change re-runs the effect and discards an in-flight response fetched under the
  // previous run state (whose total would misalign with the live buckets it is snapshotted
  // against — see applyUsageFetch).
  // infoOpen is a refresh trigger on top of the original conditions: opening the details
  // popover mid-run re-fetches once, so its token breakdown isn't a whole Task stale
  // (applyUsageFetch is designed for mid-run reconciles — see header-stats.ts).
  useEffect(() => {
    if (!projectId || !selected) return;
    if (usageAppliedRef.current === selected.sessionId && stream.taskState !== "idle" && !infoOpen)
      return;
    let cancelled = false;
    api
      .getUsage(projectId, { groupBy: "session", agentId: selected.agentId })
      .then((res) => {
        if (cancelled) return;
        usageAppliedRef.current = selected.sessionId;
        const row = res.groups.find((g) => g.key === selected.sessionId);
        applyUsageFetch(costHoldRef.current, selected.sessionId, row ?? null);
        setUsageBuckets(
          row ? { cacheRead: row.cacheRead, cacheWrite: row.cacheWrite, output: row.output } : null,
        );
        setUsageCostParts(row?.costParts ?? null);
        bumpUsageStamp((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [projectId, selected, stream.taskState, infoOpen]);

  // The currently selected Session, readable from an async callback that captured an older
  // one (the process actions below): a state value read through a closure would be the value
  // at click time, which is exactly what must not decide where a late response lands.
  const selectedSessionIdRef = useRef<string | null>(selectedSessionId);
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  // Background-process list: fetched on session entry, then kept fresh while it can still
  // change — during a run (a foreground command may promote to background at any moment),
  // while any listed process is still running (it can exit on its own), and while the
  // details popover shows the list. Otherwise no timer runs: an idle session with no
  // processes has nothing to poll for. Fail-soft — a failed poll keeps the last list.
  const runningProcessCount = processes.filter((p) => p.running).length;
  const processesCanChange =
    stream.taskState !== "idle" || runningProcessCount > 0 || (infoOpen && processes.length > 0);
  // The row's own count moves the moment the server sees a process promoted or gone (the
  // user channel's session_background), so a change there re-reads the list at once instead
  // of a poll interval later — the popover stays in step with the header's count.
  const backgroundProcessCount = selected?.backgroundTasks?.processes ?? 0;
  useEffect(() => {
    if (!selectedSessionId) return;
    let cancelled = false;
    const refresh = () => {
      api
        .getSessionProcesses(selectedSessionId)
        .then((res) => {
          if (!cancelled) setProcesses(res.processes);
        })
        .catch(() => undefined);
    };
    refresh();
    if (!processesCanChange) {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setInterval(refresh, PROCESS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedSessionId, stream.taskState, processesCanChange, backgroundProcessCount]);

  /**
   * Shared body of the process actions (a row's Stop / Remove, the list's "clear exited"):
   * one action at a time (procBusy), one request per entry through the per-entry route, the
   * statuses that only mean "the list was stale" swallowed instead of toasted (at most one
   * toast for the whole batch — see reportableProcessFailure), and the list refreshed
   * however the requests ended — the truth comes from the refresh, not from the responses.
   * The refresh is applied ONLY while its own session is still selected: switching sessions
   * mid-request would otherwise paint the previous session's processes into the new
   * session's card, and with the popover closed and nothing running there is no poll to
   * correct it.
   */
  const runProcessAction = useCallback(
    async (
      processIds: readonly string[],
      request: (sessionId: string, processId: string) => Promise<void>,
      staleStatuses: readonly number[],
    ) => {
      if (!selected || procBusy !== null) return;
      const sessionId = selected.sessionId;
      setProcBusy(processIds);
      try {
        const results = await Promise.allSettled(
          processIds.map((processId) => request(sessionId, processId)),
        );
        const failure = reportableProcessFailure(results, staleStatuses);
        if (failure !== null) toastError(apiErrorText(failure.error));
      } finally {
        setProcBusy(null);
        api
          .getSessionProcesses(sessionId)
          .then((res) => {
            if (selectedSessionIdRef.current === sessionId) setProcesses(res.processes);
          })
          .catch(() => undefined);
      }
    },
    [selected, procBusy],
  );

  // Stop one background process: the kill also removes it from the server-side registry,
  // so the follow-up refresh drops the row (a 404 means it already exited/was reaped —
  // same outcome, not an error worth surfacing).
  const onKillProcess = useCallback(
    (processId: string) => runProcessAction([processId], api.killSessionProcess, [404]),
    [runProcessAction],
  );

  // Remove one EXITED process entry from the list (#312; running rows offer Stop instead).
  // A 404 means the entry is already gone, a 409 that it is in fact (still) running —
  // either way the follow-up refresh shows the truth, so neither is surfaced as an error.
  const onRemoveProcess = useCallback(
    (processId: string) => runProcessAction([processId], api.removeSessionProcess, [404, 409]),
    [runProcessAction],
  );

  // Clear every EXITED entry at once: the rows' own Remove, sent for each of them through the
  // same route, so every entry meets the same checks (an entry that turns out to be running
  // stays, one already gone is no error) and running rows are never touched.
  const exitedIds = useMemo(() => exitedProcessIds(processes), [processes]);
  const onClearExitedProcesses = useCallback(
    () => runProcessAction(exitedIds, api.removeSessionProcess, [404, 409]),
    [runProcessAction, exitedIds],
  );

  // This server's model config (context window + credential guide): fetched once per Project.
  //
  // The credential guide **only ever nags once per lifetime** (first entry after registration):
  // gated by the server prefs' credentialGuideSeen — previously it checked "default model has no
  // key" and popped up a dialog on every visit to the chat page, which was repeated nagging for
  // users who simply don't intend to configure a key / use environment variables instead.
  // "Has a key" is hasConfiguredKey, the same rule the model library and the model picker use: a
  // model backed by an exported environment variable is configured and must not be nagged.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setModels(null);
    void (async () => {
      try {
        const res = await api.getModels(projectId, null);
        if (cancelled) return;
        setModels(scoped(projectId, res));
        const { prefs } = await api.getPrefs();
        if (cancelled || prefs.credentialGuideSeen) return;
        const def = res.models.find((m) => sameModelRef(m, res.defaultModel));
        const missing = !res.defaultModel || !def || !hasConfiguredKey(def);
        if (missing) setCredentialGuide(true);
        // Mark as "seen" regardless of whether the dialog actually popped up: only ever once.
        void api.putPrefs({ credentialGuideSeen: true }).catch(() => undefined);
      } catch {
        // A failed fetch doesn't affect the rest of the page.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Project new-chat defaults saved in this tab (project-settings dialog) with a CHANGED
  // default model: refetch the model config so the "project default" marker and a later
  // draft mount see the fresh default. models goes null first — DraftView's model
  // fallback holds off while null, so it cannot re-pin the stale default from the old
  // response in the meantime (the mounted draft's own selection comes straight from the
  // event payload, see DraftView.onDefaultsChanged); a failed refetch leaves models null,
  // the same degraded state as a failed mount fetch.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const onEvent = (e: Event) => {
      const detail = chatDefaultsChangedDetail(e, projectId);
      if (!detail || detail.defaultModel === undefined) return;
      setModels(null);
      api
        .getModels(projectId, null)
        .then((res) => {
          if (!cancelled) setModels(scoped(projectId, res));
        })
        .catch(() => undefined);
    };
    window.addEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    return () => {
      cancelled = true;
      window.removeEventListener(CHAT_DEFAULTS_CHANGED_EVENT, onEvent);
    };
  }, [projectId]);

  // Self-heal: the server returned a new session_id, update the route and list (shared by tasks and compact).
  const syncHealedSessionId = useCallback(
    async (currentId: string, respondedId: string) => {
      if (respondedId === currentId) return;
      await reloadSessions();
      // Same conversation under a new id: its docks follow, or they are stranded under
      // an id nothing routes to again — its shells first, so its tabs stay its own.
      await adoptBrowserSession(currentId, respondedId);
      await reownTerminals(currentId, respondedId);
      adoptDockScope(respondedId);
      navigate(`/chat/${respondedId}`, { replace: true });
    },
    [reloadSessions, navigate],
  );
  return {
    ...scope,
    selectedSessionId,
    selectedAgentId,
    goalPlugin,
    turnThinkingLevel,
    selectedAgentKnown,
    panelTaskScopeRef,
    taskCount,
    liveSpawn,
    agentSkills,
    agentThinkingLevel,
    setAgentThinkingLevel,
    compactionLimit,
    setCompactionLimit,
    agentConfigTick,
    setAgentConfigTick,
    onChangeCompactionLimit,
    routeSessionOwner,
    machineNameOf,
    routeSessionUnowned,
    routeSessionPending,
    routeSessionOffline,
    routeProbe,
    addWhenListed,
    routeOutcome,
    prevTaskRef,
    settledTurnSignal,
    setSettledTurnSignal,
    selectedLastActiveAt,
    statCacheRef,
    statFiles,
    selectedSessionIdRef,
    runningProcessCount,
    processesCanChange,
    backgroundProcessCount,
    runProcessAction,
    onKillProcess,
    onRemoveProcess,
    exitedIds,
    onClearExitedProcesses,
    syncHealedSessionId,
  };
}
