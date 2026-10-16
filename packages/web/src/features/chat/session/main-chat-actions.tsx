import { useCallback } from "react";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { createStreamModel, finalizeHistory, pushMessage } from "../../../lib/omni/stream-model";
import { bucketCostUsd } from "../../../lib/omni/task-stats";
import type { StreamRenderContext } from "../message-stream";
import type { ForkTarget } from "../task-stats-line";
import { prepareNewChatDraft } from "../new-chat";
import { DRAFT_SESSION_ID } from "../draft-sessions";
import { turnPricing, sameModelRef } from "../../models";
import { openPanel } from "../../dock";
import type { useMainChatControls } from "./main-chat-controls";

/** Exact consecutive main ChatPage statements 159..164; called once, in original order. */
export function useMainChatActions(scope: ReturnType<typeof useMainChatControls>) {
  const {
    navigate,
    user,
    projectId,
    addSession,
    models,
    openWorkspaceFile,
    setMemoryRequest,
    setSubagentFocus,
    setSubagentTaskScope,
    selected,
    activeModelRef,
    stream,
    deletedMemoryKeys,
    statFiles,
    onStop,
    onRetry,
    a2uiActions,
    onApprove,
    onSendToBackground,
  } = scope;

  // "New Chat" = enter draft state: no Session is created until the first message is sent.
  // Typed-but-unsent text in the ACTIVE new-chat draft first becomes a parked draft
  // conversation (a sidebar row, sendable anytime) instead of lingering invisibly in the
  // cache, and the draft starts on the Project's new-chat defaults — the sidebar's own
  // new-chat entries do the same (new-chat.ts).
  const newChat = useCallback(() => {
    if (user && projectId) prepareNewChatDraft(user.userId, projectId);
    navigate(`/chat/${DRAFT_SESSION_ID}`);
  }, [user, projectId, navigate]);

  // Auth-dead notice primary CTA: the Models page is where the credential is actually fixed.

  const onFork = useCallback(
    async (target: ForkTarget): Promise<void> => {
      if (!selected) return;
      try {
        let position = target.position;
        // Live SSE messages do not carry disk coordinates. Once the Task is idle, one history
        // read resolves the just-finished footer onto the immutable Trace position; the fork
        // request itself always sends that position, never display text or a timestamp.
        if (position === undefined) {
          const history = await api.getMessages(selected.sessionId);
          const model = createStreamModel();
          for (const message of history.messages) pushMessage(model, message);
          finalizeHistory(model);
          const match = [...model.items]
            .reverse()
            .find(
              (item) =>
                item.kind === "task_stats" &&
                item.assistantText === target.assistantText &&
                item.atMs === target.atMs &&
                item.forkPosition !== undefined,
            );
          position = match?.kind === "task_stats" ? match.forkPosition : undefined;
        }
        if (position === undefined) {
          toastError(S.chat.forkSessionFailed);
          return;
        }
        const created = await api.forkSession(selected.sessionId, { position });
        addSession(created.session);
        navigate(`/chat/${created.session.sessionId}`);
      } catch (e) {
        toastError(apiErrorText(e, { modelId: selected.modelId }));
      }
    },
    [selected, addSession, navigate],
  );

  // Real-time cost for a turn: converts the Task's bucketed usage using a Model's (paired
  // reference) current pricing; null if no pricing is configured. That pricing is the list
  // price, so a promotion the models response reports for the Model comes off it here, as it
  // does on the recorded cost. A Task is priced on the model it ran on when its row names one
  // (a Session can switch models between Tasks), else on the Session's own.
  const pricingOf = (ref: ModelRefDto | null) => turnPricing(models?.models, ref);
  const modelPricing = pricingOf(activeModelRef);
  const ctx: StreamRenderContext = {
    pendingApprovals: stream.pendingApprovals,
    onApprove,
    onSendToBackground,
    origin: [],
    // Any non-idle state (running / compacting) counts as "not yet stopped": compaction can
    // happen mid-turn, and if only running were checked, the trailing group would flash
    // "finished running" during compaction before flipping back to "running".
    taskRunning: stream.taskState !== "idle",
    taskCost: (stats, model) =>
      bucketCostUsd(stats.tokensByBucket, model ? pricingOf(model) : modelPricing),
    // Reconnect countdown controls (live waiting state only): retry-now skips the
    // remaining backoff server-side (benign no-op on timing races), give-up is the
    // ordinary session abort — the engine's abort-during-backoff path ends the turn.
    onRetryNow: () => {
      if (selected) void api.postRetryNow(selected.sessionId).catch(() => undefined);
    },
    onGiveUp: () => {
      void onStop();
    },
    // Retry after a failed run: offered only while the composer could send — a Session on
    // screen with nothing running or compacting, the same state its Send requires.
    ...(selected && stream.taskState === "idle" ? { onRetry } : {}),
    onOpenFile: openWorkspaceFile,
    onOpenSubagent: (sessionId, origin) => {
      // Chip click: the agents tab focused on that child (the focus chain ends with the
      // child's own id), with the graph pinned to this chip's Task.
      openPanel("agents");
      setSubagentTaskScope({ anchorSessionId: origin[0] ?? sessionId });
      setSubagentFocus({ sessionId, origin: [...origin, sessionId] });
    },
    onOpenMemory: () => {
      // The Memory tab on its list.
      openPanel("memory");
      setMemoryRequest({ target: null });
    },
    onLocateMemoryChange: (row) => {
      openPanel("memory");
      setMemoryRequest({
        target: {
          scope: row.scope,
          ...(row.scopeKey !== undefined ? { scopeKey: row.scopeKey } : {}),
          file: row.file,
        },
      });
    },
    ...(deletedMemoryKeys !== undefined ? { deletedMemoryKeys } : {}),
    workspace: selected?.workspace ?? null,
    statFiles,
    onFork,
    a2uiActions,
  };

  // Any pending approval sitting inside a subagent (approvalKey = "originChain toolCallId";
  // main-session keys start with a space): surfaces an amber dot on the toolbar button so a
  // nested approval stays discoverable while the panel is closed.
  const anySubagentPending = [...stream.pendingApprovals.keys()].some((k) => !k.startsWith(" "));
  return { ...scope, newChat, onFork, pricingOf, modelPricing, ctx, anySubagentPending };
}
