/**
 * A Session's transcript as the studio shows it beside the work: the chat page's stream,
 * with its approvals answered in place, so a run waiting on the author can be let through
 * without leaving the activity.
 */
import { useCallback, useMemo, useState } from "react";
import { ApiError } from "../../api/client";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { approvalKey } from "../../lib/omni/stream-model";
import type { StreamRenderContext } from "../chat/message-stream";
import { useSessionStream } from "../chat/use-session-stream";

export function useSessionTranscript(sessionId: string | null, initialStatus: "idle" | "running") {
  const stream = useSessionStream(sessionId, initialStatus);
  const [error, setError] = useState<string | null>(null);
  const running = stream.taskState === "running";
  const onApprove = useCallback(
    async (toolCallId: string, decision: "allow" | "deny", origin: string[]) => {
      if (!sessionId) return;
      stream.markLocalDecision(toolCallId);
      const key = approvalKey(origin, toolCallId);
      try {
        await api.postApproval(sessionId, toolCallId, { decision });
        stream.resolveApproval(key);
      } catch (cause) {
        if (cause instanceof ApiError && cause.status === 404) stream.resolveApproval(key);
        else setError(apiErrorText(cause));
      }
    },
    [sessionId, stream],
  );
  const ctx: StreamRenderContext = useMemo(
    () => ({
      pendingApprovals: stream.pendingApprovals,
      onApprove,
      origin: [],
      taskRunning: running,
    }),
    [stream.pendingApprovals, onApprove, running],
  );
  const items = useMemo(
    () =>
      stream.prefixItems.length
        ? [...stream.prefixItems, ...stream.model.items]
        : stream.model.items,
    // The model mutates in place; its version is the repaint signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stream.version],
  );
  const older = {
    hasMore: stream.older.hasMore,
    loading: stream.older.loading,
    error: stream.older.error,
    prependedCount: stream.prefixItems.length,
    onLoad: stream.loadOlder,
  };
  return { stream, running, ctx, items, older, error, setError };
}
