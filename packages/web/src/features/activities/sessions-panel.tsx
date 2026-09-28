/**
 * The agent sessions that worked on this activity, newest first, as the right rail's
 * panel. Every generation is a Penguin Session with its own Trace, so this is where an
 * author goes from "an agent changed this" to the conversation and the steps behind it,
 * without leaving the activity to search the global session list for a `run_…` title.
 */
import { useState } from "react";
import { Link } from "react-router";
import type { ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { EmptyState } from "../../components/ui/empty-state";
import { S } from "../../lib/strings";
import { toneDot, type Tone } from "../../lib/tone";
import { RunTranscript } from "./run-transcript";

const statusTone: Record<ActivityRunSummary["status"], Tone> = {
  running: "busy",
  succeeded: "success",
  failed: "danger",
  conflict: "attention",
  cancelled: "muted",
  interrupted: "attention",
};

/** What a run was for, in the words the history section already uses. */
export function runTitle(kind: ActivityRunSummary["kind"]): string {
  switch (kind) {
    case "module":
      return S.activities.moduleRun;
    case "audio":
      return S.activities.audioRun;
    case "image":
      return S.activities.imageRun;
    case "media-text":
      return S.activities.textRun;
    case "assist":
      return S.activities.assistRun;
    case "assessment":
      return S.activities.assessmentRun;
    case "quality":
      return S.activities.qualityRun;
    case "test":
      return S.activities.testRun;
    case "phonemes":
      return S.activities.bookWords.run;
    case "composition":
      return S.activities.video.run;
    case "video":
      return S.activities.video.recordRun;
    default:
      return S.activities.specRun;
  }
}

/** Only runs that became a session can be opened; the rest have nothing to show. */
export function sessionRuns(runs: readonly ActivityRunSummary[]): ActivityRunSummary[] {
  return runs
    .filter((run) => !!run.sessionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function SessionsPanel({ runs }: { runs: readonly ActivityRunSummary[] }) {
  const words = S.activities.studioPanels;
  const sessions = sessionRuns(runs);
  const [open, setOpen] = useState<string | null>(null);
  if (!sessions.length) return <EmptyState title={words.sessionsEmpty} />;
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-800">
      {sessions.map((run) => {
        const expanded = open === run.runId;
        const time = new Date(run.createdAt).toLocaleString();
        const transcriptId = `run-transcript-${run.runId}`;
        return (
          <li key={run.runId}>
            <div className="flex items-center gap-3 px-4 py-2.5">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${toneDot[statusTone[run.status]]}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{runTitle(run.kind)}</span>
                <span className="block truncate text-xs text-gray-500">
                  {S.activities.status[run.status]} · <time dateTime={run.createdAt}>{time}</time>
                </span>
              </span>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={transcriptId}
                aria-label={words.transcriptToggle(
                  expanded ? words.hideTranscript : words.showTranscript,
                  runTitle(run.kind),
                  time,
                )}
                onClick={() => setOpen((current) => (current === run.runId ? null : run.runId))}
                className="shrink-0 text-sm text-brand-600 hover:text-brand-700 dark:text-brand-300"
              >
                {expanded ? words.hideTranscript : words.showTranscript}
              </button>
            </div>
            {expanded && (
              <div id={transcriptId}>
                <RunTranscript sessionId={run.sessionId!} running={run.status === "running"} />
                <Link
                  to={`/chat/${encodeURIComponent(run.sessionId!)}`}
                  className="block px-4 py-2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                >
                  {words.openFullPage} ↗
                </Link>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
