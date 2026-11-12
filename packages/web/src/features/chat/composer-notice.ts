/**
 * Which attention notice the composer's one slot raises: `refused` — the Session's latest
 * compaction was a refusal hand-off (`refusalHandoffOccurrence`), the model's window set larger
 * than the real one or the threshold too close to it — else `window` — the model's window is
 * below the Agent's compaction threshold. A dismissal is keyed by Session and by the refusal's
 * occurrence or the model, so the next refusal, or another model, asks afresh; no Session id,
 * no notice.
 */
import { modelWindowBelowCompactionLimit } from "../../lib/context";

export type ComposerNotice =
  | { kind: "refused"; key: string }
  | { kind: "window"; key: string; window: number; threshold: number };

export function composerNotice(state: {
  sessionId: string | undefined;
  model: { provider: string; modelId: string } | null | undefined;
  /** The occurrence id of the Session's latest compaction when a refusal forced it, else null. */
  refusalHandoff: string | null | undefined;
  /** The model's context window, and the Agent's configured compaction threshold. */
  contextWindow: number | undefined;
  compactionLimit: number | undefined;
  dismissed: ReadonlySet<string>;
}): ComposerNotice | null {
  const { sessionId, model, contextWindow, compactionLimit, dismissed } = state;
  if (sessionId === undefined) return null;
  if (state.refusalHandoff) {
    const key = `${sessionId}\u0000refused\u0000${state.refusalHandoff}`;
    if (!dismissed.has(key)) return { kind: "refused", key };
  }
  if (
    model &&
    contextWindow !== undefined &&
    compactionLimit !== undefined &&
    modelWindowBelowCompactionLimit(contextWindow, compactionLimit)
  ) {
    const key = `${sessionId}\u0000${model.provider}\u0000${model.modelId}`;
    if (!dismissed.has(key)) {
      return { kind: "window", key, window: contextWindow, threshold: compactionLimit };
    }
  }
  return null;
}
