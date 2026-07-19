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
import type { SessionStatus } from "@prismshadow/penguin-server/api";
import { getMe, getMessages } from "../../api/endpoints";
import { openSessionStream } from "../../api/sse";
import { createStreamController } from "../../lib/omni/stream-controller";
import type { PendingApproval, StreamController } from "../../lib/omni/stream-controller";
import { createStreamModel } from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";

export type { PendingApproval } from "../../lib/omni/stream-controller";

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
  const onTitleRef = useRef(onSessionTitle);
  onTitleRef.current = onSessionTitle;
  const onCreatedRef = useRef(onSessionCreated);
  onCreatedRef.current = onSessionCreated;

  const controllerRef = useRef<StreamController | null>(null);
  // Empty model placeholder before the controller is established (first frame).
  const placeholderRef = useRef<StreamModel | null>(null);
  if (placeholderRef.current === null) placeholderRef.current = createStreamModel();
  const rafRef = useRef<number | null>(null);

  // Coalesce high-frequency deltas: multiple pushes within one frame trigger only a single re-render.
  const bump = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setVersion((v) => v + 1);
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
    setPendingTick((t) => t + 1);

    const controller = createStreamController({
      loadMessages: async () => (await getMessages(sessionId)).messages,
      onTaskState: setTaskState,
      onLoading: setLoading,
      onError: setError,
      onModelChange: bump,
      onPendingChange: () => setPendingTick((t) => t + 1),
      onSessionTitle: (sid, title) => onTitleRef.current?.(sid, title),
      onSessionCreated: () => onCreatedRef.current?.(),
    });
    controllerRef.current = controller;

    // Connect-first: subscribe to the stream before fetching history.
    const conn = openSessionStream(sessionId, {
      onOmniMessage: controller.handleOmni,
      onServerEvent: controller.handleServer,
      // EventSource can't read the status code: when the connection is judged a fatal error and
      // closes, probe once with GET /api/me; if the session has expired (401), the client's
      // global handler clears the user and redirects to the login page.
      onError: (closed) => {
        if (closed) void getMe().catch(() => undefined);
      },
    });
    void controller.load();

    return () => {
      controller.dispose();
      conn.close();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
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
  };
}
