/**
 * Which attention notice the composer raises above its input. There is one slot, holding one
 * notice at a time, with the same two buttons (open the Agent's settings, dismiss):
 *
 * - `refused` — the Session's latest compaction was forced by the provider refusing a request
 *   (`refusalHandoffOccurrence`): the model's window is set larger than the real one, or the
 *   threshold sits too close to it. It goes first, because nothing else on screen can see it.
 * - `window` — the model's window is below the Agent's compaction threshold.
 *
 * A dismissal is remembered per Session: the refusal per occurrence, so the next one is raised
 * again, and the small window per model, so switching the conversation onto another model asks
 * afresh. Raised only where a Session id gives the dismissal a key; the draft and subagent
 * composers have none.
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
  /** Keys of the notices already put down. */
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
