/**
 * The activity's Generation History: its saved versions, then every run, newest first, with
 * how it went, its Session, a way to cancel one still running, and the candidate a
 * specification run left.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ActivityRun, ActivityRunSummary } from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Button } from "../../components/ui/button";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { toneInk, toneSurface, type Tone } from "../../lib/tone";
import { runKindLabel, type Announcement } from "./run-toasts";
import { VersionsView } from "./versions-view";

const runTone: Record<ActivityRun["status"], Tone> = {
  running: "busy",
  succeeded: "success",
  failed: "danger",
  conflict: "attention",
  cancelled: "muted",
  interrupted: "attention",
};

export function GenerationHistory({
  runs,
  draftRevision,
  endpoint,
  editable,
  busy,
  onCancel,
  onUseCandidate,
  onAnnounce,
}: {
  runs: readonly ActivityRunSummary[];
  /** The draft's revision, which says when a module was built from an older one. */
  draftRevision: string;
  /** The activity's API path. */
  endpoint: string;
  editable: boolean;
  busy: boolean;
  onCancel: (runId: string) => void;
  /** Put a specification run's candidate in the editor. */
  onUseCandidate: (candidate: string) => void;
  /** Say that a version was saved. */
  onAnnounce: (announcement: Announcement) => void;
}) {
  return (
    <div className="space-y-6">
      <VersionsView
        endpoint={endpoint}
        editable={editable}
        draftRevision={draftRevision}
        onAnnounce={onAnnounce}
      />
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{S.activities.runs}</h3>
        {runs.length === 0 && <p className="text-xs text-gray-500">{S.activities.noRuns}</p>}
        {runs.map((run) => (
          <article
            key={run.runId}
            className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs">{runKindLabel(run)}</span>
              <span className={`rounded px-2 py-0.5 text-xs ${toneSurface[runTone[run.status]]}`}>
                {run.kind === "module" && run.status === "succeeded"
                  ? S.activities.moduleReady
                  : run.kind === "audio" || run.kind === "image" || run.kind === "media-text"
                    ? S.activities.speechStatus[run.status]
                    : S.activities.status[run.status]}
              </span>
              <time className="text-xs text-gray-500" dateTime={run.createdAt}>
                {new Date(run.createdAt).toLocaleString()}
              </time>
            </div>
            {run.error && <p className="break-words text-xs">{run.error}</p>}
            {run.status === "running" && (
              <p className="text-xs text-gray-500">{S.activities.runningHelp}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {run.kind === "module" && run.status === "succeeded" && run.sessionId && (
                <a
                  className="text-xs underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  href={`/api/sessions/${encodeURIComponent(run.sessionId)}/files/preview-redirect?path=preview%2Findex.html`}
                >
                  {S.activities.previewModule}
                </a>
              )}
              {run.kind === "module" && run.inputRevision !== draftRevision && (
                <span className={`text-xs ${toneInk.attention}`}>{S.activities.olderModule}</span>
              )}
              {run.sessionId && (
                <Link
                  className="text-xs underline"
                  to={`/chat/${encodeURIComponent(run.sessionId)}`}
                >
                  {S.activities.openSession}
                </Link>
              )}
              {editable && run.status === "running" && (
                <Button size="sm" disabled={busy} onClick={() => onCancel(run.runId)}>
                  {S.activities.cancel}
                </Button>
              )}
            </div>
            {run.hasCandidate && (
              <CandidateReview
                endpoint={`${endpoint}/runs/${encodeURIComponent(run.runId)}/candidate`}
                editable={editable && run.kind === "spec"}
                busy={busy}
                onUse={onUseCandidate}
              />
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

function CandidateReview({
  endpoint,
  editable,
  busy,
  onUse,
}: {
  endpoint: string;
  editable: boolean;
  busy: boolean;
  onUse: (candidate: string) => void;
}) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load() {
    if (pending.current || candidate !== null) return;
    pending.current = true;
    setError("");
    try {
      const result = await apiFetch<{ candidate: string | null }>(endpoint);
      if (alive.current) setCandidate(result.candidate ?? "");
    } catch (e) {
      if (alive.current) setError(apiErrorText(e));
    } finally {
      pending.current = false;
    }
  }
  return (
    <details
      className="text-xs"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary className="cursor-pointer">{S.activities.candidate}</summary>
      {error ? (
        <div className="my-2 space-y-2">
          <p role="alert" className={toneInk.danger}>
            {error}
          </p>
          <Button size="sm" onClick={() => void load()}>
            {S.common.retry}
          </Button>
        </div>
      ) : (
        <pre className="my-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-gray-50 p-2 dark:bg-gray-900">
          {candidate ?? S.activities.loading}
        </pre>
      )}
      {editable && (
        <Button size="sm" disabled={busy || candidate === null} onClick={() => onUse(candidate!)}>
          {S.activities.useCandidate}
        </Button>
      )}
    </details>
  );
}
