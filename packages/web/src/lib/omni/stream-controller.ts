/**
 * Session stream controller (connect-first + dedup): a pure
 * logic module, no React dependency, driven by use-session-stream (so protocol behavior is unit-testable).
 *
 * - Phase machine: buffering (history not ready yet, events are held in a
 *   buffer) → live (fed straight to the reducer);
 * - Load epoch: incremented on every load/rebuild. The replay loop aborts the
 *   current round as soon as it detects an epoch mismatch, handing the
 *   remaining buffer off to the new round — this eliminates the
 *   out-of-order/duplication that "a rebuild re-entering mid-buffer-replay" would otherwise cause;
 * - Authoritative running state: the server sends the current task_state
 *   snapshot as the first initial event on every subscription; the
 *   in-stream task_state overrides the Session list's snapshot, and history
 *   finalization trusts only the in-stream state;
 * - resync rebuild: clears the pending-approvals table (the server then
 *   resends still-pending approval_request events on the same connection),
 *   swaps in a new model but injects the shared localDecisions set (an
 *   approval clicked on this end is still labeled "manual" after the rebuild);
 * - Pending-approvals table key = `origin + " " + toolCallId` (approvalKey);
 *   when a resent approval_request can't find its tool card (sub-session
 *   messages aren't written to the parent Trace, so the card can be missing
 *   after a reload), the toolCall carried by the event (with origin) is fed
 *   to the reducer to rebuild the nested card, making the sub-session's approval visible and decidable.
 */
import { isEventMessage, isPartialPayload } from "@prismshadow/penguin-core/omnimessage";
import type { OmniMessage, ToolCallPayload } from "@prismshadow/penguin-core/omnimessage";
import type { ServerEvent, SessionStatus } from "@prismshadow/penguin-server/api";
import {
  approvalKey,
  buildDedupIndex,
  createStreamModel,
  discardFragmentFor,
  finalizeHistory,
  findToolCard,
  isDuplicate,
  notifyTaskIdle,
  pushMessage,
  pushMessages,
  registerLocalDecision,
} from "./stream-model";
import type { StreamModel } from "./stream-model";

/** A single pending approval (keyed by approvalKey(origin, toolCallId)). */
export interface PendingApproval {
  toolCall: OmniMessage<ToolCallPayload>;
  origin?: string[];
}

type BufferedEvent = { kind: "omni"; msg: OmniMessage } | { kind: "server"; ev: ServerEvent };

export interface StreamControllerDeps {
  /** Fetch history messages (GET /api/sessions/:id/messages). */
  loadMessages: () => Promise<OmniMessage[]>;
  /** Authoritative running state from the stream (covers both the subscription snapshot and transition events). */
  onTaskState: (state: SessionStatus) => void;
  onLoading: (loading: boolean) => void;
  /** History load failure message (null = clear). */
  onError: (message: string | null) => void;
  /** View model content changed (triggers a re-render). */
  onModelChange: () => void;
  /** Pending-approvals table changed. */
  onPendingChange: () => void;
  /** Auto-generated title pushed by the server (for updating the Session list in place). */
  onSessionTitle?: (sessionId: string, title: string) => void;
  /** A new session has been registered (sub-sessions are pushed along the parent session's channel; used to refresh the Session list). */
  onSessionCreated?: (sessionId: string) => void;
  /** Local clock (injectable for tests). */
  now?: () => number;
}

export interface StreamController {
  /** The current view model (a resync rebuild swaps in a new object). */
  readonly model: StreamModel;
  readonly pendingApprovals: ReadonlyMap<string, PendingApproval>;
  /** Load history for the first time (called once after connect-first). */
  load: () => Promise<void>;
  /** Retry entry point after a history load failure (keeps the buffer, refetches history). */
  retry: () => Promise<void>;
  /** SSE OmniMessage entry point. */
  handleOmni: (msg: OmniMessage) => void;
  /** SSE server-event entry point. */
  handleServer: (ev: ServerEvent) => void;
  /** Register that this end clicked an approval ("manual" label, persists across resync rebuilds). */
  markLocalDecision: (toolCallId: string) => void;
  /** Remove a pending approval by its composite key (optimistic update; also removed as a fallback when the event arrives). */
  resolveApproval: (key: string) => void;
  dispose: () => void;
}

export function createStreamController(deps: StreamControllerDeps): StreamController {
  const now = deps.now ?? (() => Date.now());
  /** Approvals decided on this end (persists at the hook level: injected into every generation of the model, never lost across a resync rebuild). */
  const localDecisions = new Set<string>();
  const pending = new Map<string, PendingApproval>();

  let model = createStreamModel(localDecisions);
  let disposed = false;
  let phase: "buffering" | "live" = "buffering";
  let buffer: BufferedEvent[] = [];
  /** The most recent in-stream task_state (null = the snapshot hasn't arrived yet; history finalization trusts only this value). */
  let streamStatus: SessionStatus | null = null;
  /** Load epoch: incremented on rebuild/retry; any replay or finalization from an older epoch is discarded. */
  let epoch = 0;
  /** Whether the most recent load failed (retry only takes effect after a failure, to avoid mistakenly replaying history). */
  let failed = false;

  const clearPending = (): void => {
    if (pending.size === 0) return;
    pending.clear();
    deps.onPendingChange();
  };

  const feedOmni = (msg: OmniMessage, dedup: Set<string> | null): void => {
    // The SDK has already produced an approval_decision: sync the pending-approvals table (keyed by the origin composite key).
    if (isEventMessage(msg) && msg.payload.type === "approval_decision") {
      if (pending.delete(approvalKey(msg.origin, msg.payload.tool_call_id))) {
        deps.onPendingChange();
      }
    }
    if (dedup && !isPartialPayload(msg.payload) && isDuplicate(dedup, msg)) {
      // Overlap dedup: when a complete message matches, also discard the corresponding in-flight fragment.
      discardFragmentFor(model, msg);
      return;
    }
    pushMessage(model, msg, now());
  };

  const handleServer = (ev: ServerEvent): void => {
    switch (ev.type) {
      case "approval_request": {
        const toolCallId = ev.toolCall.payload.tool_call_id;
        const entry: PendingApproval = { toolCall: ev.toolCall };
        if (ev.origin) entry.origin = ev.origin;
        pending.set(approvalKey(ev.origin, toolCallId), entry);
        // Resend scenario (reload / mid-stream join): sub-session messages
        // aren't in the parent Trace, so the tool card can be missing —
        // feed the event's toolCall (with origin) to the reducer to rebuild the nested card, so the approval button is visible.
        if (!findToolCard(model, ev.origin, toolCallId)) {
          const msg: OmniMessage = { ...ev.toolCall };
          if (ev.origin && ev.origin.length > 0) msg.origin = [...ev.origin];
          else delete msg.origin;
          pushMessage(model, msg, now());
          deps.onModelChange();
        }
        deps.onPendingChange();
        return;
      }
      case "task_state": {
        // The in-stream task_state is the authoritative running state (the
        // server sends the current snapshot as soon as it subscribes; the list's snapshot is only a first-frame placeholder).
        streamStatus = ev.state;
        deps.onTaskState(ev.state);
        if (ev.state === "idle") {
          // Task ended (or the snapshot confirms idle): finalize the current Task's stats; pending approvals have already converged server-side.
          notifyTaskIdle(model, now());
          clearPending();
          deps.onModelChange();
        }
        return;
      }
      case "resync_required": {
        // The buffer has been evicted: refetch history to rebuild the model, then continue consuming the same connection.
        void rebuild();
        return;
      }
      case "hello":
        return;
    }
  };

  const rebuild = async (): Promise<void> => {
    epoch += 1;
    phase = "buffering";
    buffer = [];
    // Clear the pending-approvals table: an approval decided while
    // disconnected shouldn't leave a lingering button; the server will
    // resend still-pending approval_request events on the same connection afterward, naturally rebuilding it.
    clearPending();
    // Swap in a new model, injecting the shared localDecisions: approvals decided on this end are still labeled "manual" after the rebuild.
    model = createStreamModel(localDecisions);
    await load(epoch);
  };

  const load = async (currentEpoch: number): Promise<void> => {
    try {
      const messages = await deps.loadMessages();
      if (disposed || currentEpoch !== epoch) return;
      const target = model;
      pushMessages(target, messages, now());
      const dedup = buildDedupIndex(messages, 100);
      // Replay the buffer (events that arrived while fetching history), with dedup.
      const replay = buffer;
      buffer = [];
      for (let i = 0; i < replay.length; i += 1) {
        const e = replay[i]!;
        if (e.kind === "omni") feedOmni(e.msg, dedup);
        else handleServer(e.ev);
        if (disposed) return;
        if (currentEpoch !== epoch) {
          // A rebuild was triggered mid-replay (e.g. resync_required): this
          // round is discarded, and the remaining events are handed off to
          // the new round's buffer — phase is left unchanged and the old buffer is never fed to the new model.
          buffer.push(...replay.slice(i + 1));
          return;
        }
      }
      phase = "live";
      // History finalization trusts only the in-stream authoritative state:
      // finalize the last Task at the end of history only when idle; if the
      // snapshot hasn't arrived yet (rare), don't finalize — the
      // task_state:idle branch will complete the equivalent finalization once it arrives.
      if (streamStatus === "idle") finalizeHistory(target);
      failed = false;
      deps.onError(null);
      deps.onLoading(false);
      deps.onModelChange();
    } catch (e) {
      if (disposed || currentEpoch !== epoch) return;
      failed = true;
      deps.onLoading(false);
      deps.onError(e instanceof Error ? e.message : String(e));
    }
  };

  return {
    get model() {
      return model;
    },
    get pendingApprovals(): ReadonlyMap<string, PendingApproval> {
      return pending;
    },
    load: () => {
      epoch += 1;
      return load(epoch);
    },
    retry: async () => {
      if (disposed || !failed) return;
      // On failure the model was never written to and the buffer kept accumulating: keep both, just refetch history and replay again.
      deps.onError(null);
      deps.onLoading(true);
      epoch += 1;
      await load(epoch);
    },
    handleOmni: (msg) => {
      if (disposed) return;
      if (phase === "buffering") {
        buffer.push({ kind: "omni", msg });
        return;
      }
      feedOmni(msg, null);
      deps.onModelChange();
    },
    handleServer: (ev) => {
      if (disposed) return;
      // session_title / session_created only affect list display (unrelated
      // to the view model/history): forwarded immediately at any phase, never buffered.
      if (ev.type === "session_title") {
        deps.onSessionTitle?.(ev.sessionId, ev.title);
        return;
      }
      if (ev.type === "session_created") {
        deps.onSessionCreated?.(ev.sessionId);
        return;
      }
      if (phase === "buffering") {
        // task_state is reflected immediately in the input area (authoritative
        // state, doesn't wait for history replay); model side effects like
        // finalization are still processed in replay order (idempotent on the same value, eventually consistent).
        if (ev.type === "task_state") {
          streamStatus = ev.state;
          deps.onTaskState(ev.state);
        }
        buffer.push({ kind: "server", ev });
        return;
      }
      handleServer(ev);
    },
    markLocalDecision: (toolCallId) => {
      registerLocalDecision(model, toolCallId);
    },
    resolveApproval: (key) => {
      if (pending.delete(key)) deps.onPendingChange();
    },
    dispose: () => {
      disposed = true;
    },
  };
}
