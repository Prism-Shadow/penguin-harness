/**
 * Session stream hook (connect-first + dedupe on use): React adapter layer — the protocol state machine lives in
 * lib/omni/stream-controller.ts (pure logic, unit-testable).
 *
 * 1. On entering a Session, connect SSE first; events are handed to the controller (buffered if
 *    history isn't ready yet);
 * 2. GET messages renders history, then replays the buffer (overlap deduped); on load failure,
 *    expose error and a retry entry point;
 * 3. Disconnects are auto-reconnected by the browser (Last-Event-ID built in; server replays from
 *    its buffer); resync_required → controller rebuilds the model and keeps consuming the same
 *    connection;
 * 4. task_state in the stream is the authoritative run state (server pushes the current snapshot
 *    on subscribe); initialStatus only serves as the first-frame placeholder, driving the input
 *    area state and the Session list badge;
 * 5. The pending-approval table is keyed by `origin + toolCallId` (approvalKey); on reconnect the
 *    server re-sends still-pending requests.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GoalServerEvent, SessionStatus } from "@prismshadow/penguin-server/api";
import { getGoal, getMe, getMessages } from "../../api/endpoints";
import { openSessionStream } from "../../api/sse";
import { createStreamController } from "../../lib/omni/stream-controller";
import type { PendingApproval, StreamController } from "../../lib/omni/stream-controller";
import { createStreamModel } from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";
import type { GoalBannerState } from "./goal-use";

export type { PendingApproval } from "../../lib/omni/stream-controller";

/** Minimum spacing between version commits: below one frame at 8fps, invisible as staleness, but ~8× fewer full re-parses of the growing message during a fast large-code stream. */
const BUMP_MIN_INTERVAL_MS = 120;

export interface SessionStreamState {
  /** View model (updated in place; version bump triggers re-render). */
  model: StreamModel;
  version: number;
  /** True until history finishes loading. */
  loading: boolean;
  taskState: SessionStatus;
  /** approvalKey(origin, toolCallId) → pending approval. */
  pendingApprovals: ReadonlyMap<string, PendingApproval>;
  /** Recorded when this client clicks an approval decision (marks it as "manual"). */
  markLocalDecision: (toolCallId: string) => void;
  /** Removed from the pending table immediately after this client submits a decision (optimistic update; keyed by approvalKey). */
  resolveApproval: (key: string) => void;
  /** History load failure message (paired with retry to show a retry entry point). */
  error: string | null;
  /** Re-fetch history (only meaningful after a load failure). */
  retry: () => void;
  /**
   * Goal-banner state: an in-flight goal restored from goal_state on load (only when still
   * active), then kept live by goal_* server events; terminal states reached during this
   * page's lifetime stay visible until the session changes. Null = no banner.
   */
  goal: GoalBannerState | null;
}

const EMPTY_PENDING: ReadonlyMap<string, PendingApproval> = new Map();

export function useSessionStream(
  sessionId: string | null,
  initialStatus: SessionStatus,
  /** Notification of a server auto-generated title (for updating the list in place); held in a ref, doesn't trigger a reconnect. */
  onSessionTitle?: (sessionId: string, title: string) => void,
  /** New session has been registered (sub-sessions are pushed over the parent session's channel); held in a ref, doesn't trigger a reconnect. */
  onSessionCreated?: () => void,
): SessionStreamState {
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [taskState, setTaskState] = useState<SessionStatus>(initialStatus);
  const [error, setError] = useState<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0);
  const [goal, setGoal] = useState<GoalBannerState | null>(null);

  /** Fold one goal_* event into the banner state (a mid-goal join without goal_started keeps prior fields where known). */
  const onGoalEvent = useCallback((ev: GoalServerEvent) => {
    setGoal((prev) => {
      if (ev.type === "goal_started") {
        return { objective: ev.objective, status: "active", budget: ev.budget, used: 0, rounds: 0 };
      }
      if (ev.type === "goal_round") {
        return {
          objective: prev?.objective ?? "",
          status: "active",
          budget: ev.budget,
          used: ev.used,
          rounds: ev.round,
        };
      }
      return {
        objective: prev?.objective ?? "",
        status: ev.outcome,
        budget: prev?.budget ?? -1,
        used: ev.used,
        rounds: ev.rounds,
      };
    });
  }, []);
  const onTitleRef = useRef(onSessionTitle);
  onTitleRef.current = onSessionTitle;
  const onCreatedRef = useRef(onSessionCreated);
  onCreatedRef.current = onSessionCreated;

  const controllerRef = useRef<StreamController | null>(null);
  // Empty model placeholder before the controller is established (first frame).
  const placeholderRef = useRef<StreamModel | null>(null);
  if (placeholderRef.current === null) placeholderRef.current = createStreamModel();
  const rafRef = useRef<number | null>(null);
  const throttleRef = useRef<number | null>(null);
  const lastBumpAtRef = useRef(0);

  // Coalesce high-frequency deltas: multiple pushes within one frame trigger only a single
  // re-render, and commits are additionally spaced ≥BUMP_MIN_INTERVAL_MS apart. Every commit
  // re-renders (and re-parses) the currently streaming message at its full accumulated length,
  // so per-frame commits during a large streamed reply go O(n²) and freeze the main thread —
  // the interval caps that at a bounded, invisible staleness. Inside the interval a single
  // trailing timer is armed (the flush): the final deltas always land even if no further push
  // ever arrives.
  const bump = useCallback(() => {
    if (rafRef.current !== null || throttleRef.current !== null) return;
    const commit = () => {
      lastBumpAtRef.current = Date.now();
      setVersion((v) => v + 1);
    };
    const wait = lastBumpAtRef.current + BUMP_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) {
      throttleRef.current = window.setTimeout(() => {
        throttleRef.current = null;
        commit();
      }, wait);
      return;
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      commit();
    });
  }, []);

  useEffect(() => {
    if (!sessionId) {
      // Draft state (no session to connect to): reset to idle. If the previous session's running
      // state lingers, the draft input area would misjudge "still running" and disable sending —
      // so "A is still running" would block sending in the new draft B after switching.
      controllerRef.current?.dispose();
      controllerRef.current = null;
      setTaskState("idle");
      setLoading(false);
      setError(null);
      setGoal(null);
      setPendingTick((t) => t + 1);
      setVersion((v) => v + 1);
      return;
    }
    setVersion((v) => v + 1);
    setLoading(true);
    setError(null);
    // First-frame placeholder: the task_state snapshot from the stream (pushed on subscribe)
    // subsequently overrides it as the authoritative state.
    setTaskState(initialStatus);
    setGoal(null);
    setPendingTick((t) => t + 1);

    // Restore an in-flight goal's banner (only when still active — a long-finished goal
    // shouldn't greet every visit); live goal_* events override this snapshot. Fetched from
    // the stream's onOpen (below), never before it: reading the DB before subscribing races a
    // goal that finishes in that window — its goal_finished isn't replayed to a fresh
    // subscription, so a stale `active` read would pin a "running" banner forever. Once
    // subscribed, the DB already reflects the terminal status for anything that finished before
    // we connected, and anything finishing after arrives live on the stream.
    let goalFetchStale = false;
    const hydrateGoal = () => {
      void getGoal(sessionId)
        .then((res) => {
          if (goalFetchStale || !res.goal || res.goal.status !== "active") return;
          setGoal((prev) => prev ?? res.goal);
        })
        .catch(() => undefined);
    };

    const controller = createStreamController({
      loadMessages: async () => (await getMessages(sessionId)).messages,
      onTaskState: setTaskState,
      onLoading: setLoading,
      onError: setError,
      onModelChange: bump,
      onPendingChange: () => setPendingTick((t) => t + 1),
      onSessionTitle: (sid, title) => onTitleRef.current?.(sid, title),
      onSessionCreated: () => onCreatedRef.current?.(),
      onGoalEvent,
    });
    controllerRef.current = controller;

    // Connect-first: subscribe to the stream before fetching history.
    const conn = openSessionStream(sessionId, {
      onOmniMessage: controller.handleOmni,
      onServerEvent: controller.handleServer,
      // Hydrate the goal banner only once the subscription is live (fires on first connect and
      // every reconnect); the prev/active guards keep it from clobbering a live banner.
      onOpen: hydrateGoal,
      // EventSource can't read the status code: when the connection is judged a fatal error and
      // closes, probe once with GET /api/me; if the session has expired (401), the client's
      // global handler clears the user and redirects to the login page.
      onError: (closed) => {
        if (closed) void getMe().catch(() => undefined);
      },
    });
    void controller.load();

    return () => {
      goalFetchStale = true;
      controller.dispose();
      conn.close();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (throttleRef.current !== null) {
        window.clearTimeout(throttleRef.current);
        throttleRef.current = null;
      }
    };
    // initialStatus only serves as the first-frame placeholder; it doesn't rebuild the connection
    // on parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const markLocalDecision = useCallback((toolCallId: string) => {
    controllerRef.current?.markLocalDecision(toolCallId);
  }, []);

  const resolveApproval = useCallback((key: string) => {
    controllerRef.current?.resolveApproval(key);
  }, []);

  const retry = useCallback(() => {
    void controllerRef.current?.retry();
  }, []);

  // pendingTick participates in the render dependencies, ensuring pending-table changes trigger a re-render.
  void pendingTick;

  return {
    model: controllerRef.current?.model ?? placeholderRef.current,
    version,
    loading,
    taskState,
    pendingApprovals: controllerRef.current?.pendingApprovals ?? EMPTY_PENDING,
    markLocalDecision,
    resolveApproval,
    error,
    retry,
    goal,
  };
}
