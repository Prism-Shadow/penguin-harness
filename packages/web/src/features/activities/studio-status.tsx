/**
 * The two state marks in the activity header: the draft's own state beside its title, and the
 * run in flight, which opens the panel that follows it rather than only naming it.
 */
import type { ActivityDetail, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { toneDot, toneInk, type Tone } from "../../lib/tone";
import { LiveDuration } from "../chat/live-duration";
import { runTitle } from "./sessions-panel";
import type { StudioPanel } from "./workspace-model";

const DRAFT_TONE: Record<ActivityDetail["draft"]["status"], Tone> = {
  draft: "muted",
  valid: "success",
  invalid: "danger",
};

/** Unsaved edits outrank what the saved draft is, since they are what Save would change. */
export function DraftStatus({
  status,
  dirty,
}: {
  status: ActivityDetail["draft"]["status"];
  dirty: boolean;
}) {
  const tone: Tone = dirty ? "attention" : DRAFT_TONE[status];
  return (
    <span
      aria-live="polite"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs whitespace-nowrap dark:border-gray-800 ${
        tone === "muted" ? "text-gray-500 dark:text-gray-400" : toneInk[tone]
      }`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${toneDot[tone]}`} />
      {dirty ? S.activities.unsaved : S.activities.draftStatus[status]}
    </span>
  );
}

/** Where each kind of run is followed; the rest are followed in Stages or Sessions. */
const RUN_PANEL: Partial<Record<ActivityRunSummary["kind"], StudioPanel>> = {
  test: "tests",
  quality: "quality",
  assist: "conversation",
};

export function runPanel(run: ActivityRunSummary, pipelineRunning: boolean): StudioPanel {
  return RUN_PANEL[run.kind] ?? (pipelineRunning || run.kind === "module" ? "run" : "sessions");
}

export function RunningChip({ run, onFollow }: { run: ActivityRunSummary; onFollow: () => void }) {
  const started = Date.parse(run.createdAt);
  return (
    <button
      type="button"
      title={S.activities.followRun}
      onClick={onFollow}
      className={`ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/20 px-2 py-0.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-900 ${toneInk.busy}`}
    >
      <span aria-hidden className={`size-1.5 animate-pulse rounded-full ${toneDot.busy}`} />
      {S.activities.runningChip(runTitle(run.kind))}
      {Number.isFinite(started) && (
        <span className="font-mono tabular-nums text-gray-500 dark:text-gray-400">
          <LiveDuration sinceMs={started} />
        </span>
      )}
      <span aria-hidden>›</span>
    </button>
  );
}
