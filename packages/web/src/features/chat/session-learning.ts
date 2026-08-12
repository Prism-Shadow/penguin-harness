/**
 * Builds the first, read-only turn for "Learn from this chat". The review runs as an ordinary
 * Builder Session: the source Trace is evidence, never an instruction channel, and no write or
 * optimization is allowed until the user has seen the proposal and explicitly follows up.
 *
 * Read `S` inside the function because locale switching swaps the active dictionary at runtime.
 */
import { S } from "../../lib/strings";

export interface SessionLearningSource {
  agentId: string;
  sessionId: string;
  tracePath: string;
  workspace: string;
}

/** The entry belongs only to settled, trace-backed, user-created conversations. */
export function canLearnFromSession(args: {
  source?: string;
  hasTrace: boolean;
  taskCount: number;
  taskState: "idle" | "running" | "compacting";
}): boolean {
  return (
    args.source === undefined && args.taskState === "idle" && (args.hasTrace || args.taskCount > 0)
  );
}

export function buildSessionLearningPrompt(source: SessionLearningSource): string {
  return S.chat.learningReviewPrompt({
    agentId: JSON.stringify(source.agentId),
    sessionId: JSON.stringify(source.sessionId),
    tracePath: JSON.stringify(source.tracePath),
    workspace: JSON.stringify(source.workspace),
  });
}
