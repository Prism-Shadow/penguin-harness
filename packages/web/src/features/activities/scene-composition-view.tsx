/**
 * Scene video (experimental), in a video or animation asset's editor: an agent composes a
 * short animated scene from the scene's description and images, and the author watches it
 * here and asks again until it fits. Nothing is recorded or bound yet.
 *
 * The composition is agent-written HTML, so it plays in a sandboxed frame from the preview
 * origin (the link route redirects there) and is driven only by messages: Play, Pause and
 * Restart are posted to it, and what it reports back is read as one of a few known states.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  ActivityRunSummary,
  AssetManifest,
  CompositionCandidate,
} from "@prismshadow/penguin-server/api";
import { apiFetch } from "../../api/client";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { InfoPopover } from "../../components/ui/info-popover";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import {
  compositionFailure,
  compositionRuns,
  formatSeconds,
  isShowable,
  PREVIEW_GRACE_MS,
  parseCandidate,
  previewCommand,
  previewState,
  compositionScene,
  sceneHasImage,
  sceneHasLearnerChoice,
  type PreviewState,
} from "./scene-composition";
import { MediaComparison } from "./media-comparison";
import { MediaPlayer } from "./media-player";
import {
  comparedRecording,
  isRecordable,
  recordingFailure,
  recordingUrl,
  videoRuns,
} from "./scene-video";

type Asset = AssetManifest["assets"][string][number];

export function SceneCompositionView({
  asset,
  group,
  language,
  runs,
  endpoint,
  revision,
  editable,
  canGenerate,
  spec,
  onCompose,
  canRecord = false,
  onRecord,
  onAcceptVideo,
  current,
}: {
  asset: Asset;
  /** The assets of the language shown, which the scene's images are among. */
  group: readonly Asset[];
  language: string;
  runs: readonly ActivityRunSummary[];
  endpoint: string;
  revision: string;
  editable: boolean;
  canGenerate: boolean;
  /** The saved specification, which says whether the scene asks the learner to choose. */
  spec: unknown;
  onCompose: (language: string, assetKey: string) => void;
  /** Whether a composition may be recorded or a recording kept now (no unsaved edits, no run). */
  canRecord?: boolean;
  /** Record a kept composition to a video. */
  onRecord?: (compositionRunId: string) => void;
  /** Bind a recording to this asset. */
  onAcceptVideo?: (runId: string) => void;
  /** The asset's video now, shown beside a new recording. */
  current?: ReactNode;
}) {
  const compositions = compositionRuns(runs, language, asset.key);
  const composing = compositions.some((run) => run.status === "running");
  const shown = compositions.find(isShowable) ?? null;
  const recordings = videoRuns(runs, language, asset.key);
  const recording = recordings.some((run) => run.status === "running");
  // New recordings the author chose to keep the current video over; they stay in the list.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const compared = comparedRecording(recordings, asset, revision, kept);
  const hasImage = sceneHasImage(group, asset);
  const choice = sceneHasLearnerChoice(spec, compositionScene(asset));
  return (
    <section className="space-y-3" aria-label={S.activities.video.title}>
      <h4 className="flex items-center gap-2 text-xs font-semibold">
        {S.activities.video.title}
        <InfoPopover label={S.activities.video.title}>{S.activities.video.info}</InfoPopover>
        <Badge tone="amber">{S.activities.video.experimental}</Badge>
      </h4>
      {choice && <p className="text-xs text-gray-500">{S.activities.video.choiceWarning}</p>}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!canGenerate || !hasImage || composing}
            onClick={() => onCompose(language, asset.key)}
          >
            {composing
              ? S.activities.video.composing
              : shown
                ? S.activities.video.recompose
                : S.activities.video.compose}
          </Button>
          {!hasImage && <p className="text-xs text-gray-500">{S.activities.video.noImages}</p>}
        </div>
      )}
      {shown && (
        <CompositionPreview
          key={shown.runId}
          run={shown}
          endpoint={endpoint}
          stale={shown.inputRevision !== revision}
        />
      )}
      {editable && onRecord && isRecordable(shown) && (
        <div className="space-y-1">
          <Button
            size="sm"
            disabled={!canRecord || recording}
            onClick={() => onRecord(shown.runId)}
          >
            {recording
              ? S.activities.video.recording
              : recordings.some((run) => run.status === "succeeded")
                ? S.activities.video.rerecord
                : S.activities.video.record}
          </Button>
          <p className="text-xs text-gray-500">{S.activities.video.leadIn}</p>
        </div>
      )}
      {compared && editable && onAcceptVideo && (
        <MediaComparison
          current={
            current ?? <p className="text-xs text-gray-500">{S.activities.video.noCurrent}</p>
          }
          next={
            <MediaPlayer
              key={compared.runId}
              kind="video"
              src={recordingUrl(endpoint, compared.runId)}
              label={S.activities.mediaComparison.next}
            />
          }
          disabled={!canRecord}
          useLabel={S.activities.video.useNew}
          keepLabel={S.activities.video.keepCurrent}
          onUse={() => onAcceptVideo(compared.runId)}
          onKeep={() => setKept((previous) => new Set(previous).add(compared.runId))}
        />
      )}
      {recordings.length > 0 && (
        <section className="space-y-2" aria-label={S.activities.video.recordings}>
          <h5 className="text-xs font-semibold">{S.activities.video.recordings}</h5>
          <ul className="space-y-2">
            {recordings.map((run) => {
              const failure = run.status === "succeeded" ? null : recordingFailure(run);
              return (
                <li
                  key={run.runId}
                  className="space-y-1 border-t border-gray-200 pt-2 text-xs dark:border-gray-800"
                >
                  <p>
                    {new Date(run.createdAt).toLocaleString()} ·{" "}
                    {S.activities.speechStatus[run.status]}
                    {run.runId === asset.generatedVideo?.runId
                      ? ` · ${S.activities.video.recorded}`
                      : ""}
                  </p>
                  {run.status === "succeeded" && run.inputRevision !== revision && (
                    <p className="text-gray-500">{S.activities.video.olderRecording}</p>
                  )}
                  {failure && (
                    <p
                      className={`break-words ${run.status === "failed" ? toneInk.danger : "text-gray-500"}`}
                    >
                      {failure}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {compositions.length > 0 && (
        <section className="space-y-2" aria-label={S.activities.video.candidates}>
          <h5 className="text-xs font-semibold">{S.activities.video.candidates}</h5>
          <ul className="space-y-2">
            {compositions.map((run) => {
              const failure = run.status === "succeeded" ? null : compositionFailure(run);
              return (
                <li
                  key={run.runId}
                  className="space-y-1 border-t border-gray-200 pt-2 text-xs dark:border-gray-800"
                >
                  <p>
                    {new Date(run.createdAt).toLocaleString()} ·{" "}
                    {S.activities.speechStatus[run.status]}
                  </p>
                  {failure && (
                    <p
                      className={`break-words ${run.status === "failed" ? toneInk.danger : "text-gray-500"}`}
                    >
                      {failure}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </section>
  );
}

/** The kept composition playing in its sandboxed frame, with its controls and frame list. */
function CompositionPreview({
  run,
  endpoint,
  stale,
}: {
  run: ActivityRunSummary;
  endpoint: string;
  stale: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PreviewState>("loading");
  const [candidate, setCandidate] = useState<CompositionCandidate | null>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const width = run.composition?.width ?? 640;
  const height = run.composition?.height ?? 480;
  const runPath = `${endpoint}/runs/${encodeURIComponent(run.runId)}`;

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ candidate: string | null }>(`${runPath}/candidate`)
      .then((value) => {
        if (!cancelled) setCandidate(parseCandidate(value.candidate));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [runPath]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      // Only this frame's page, and only a state it is known to report.
      if (event.source !== frame.current?.contentWindow) return;
      const next = previewState(event.data);
      if (next) setState(next);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);

  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = boxWidth > 0 ? Math.min(1, boxWidth / width) : 1;
  // The page is on another origin, so a message is all that reaches it.
  const send = (action: "play" | "pause" | "restart") =>
    frame.current?.contentWindow?.postMessage(previewCommand(action), "*");
  const playable =
    state === "ready" || state === "playing" || state === "paused" || state === "ended";

  // A refused link (switched off, or the page changed since it was checked) loads an error
  // body that never reports in; after a grace period the author is told it is unavailable.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) return;
    const timer = window.setTimeout(
      () => setState((current) => (current === "loading" ? "unavailable" : current)),
      PREVIEW_GRACE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [loaded]);

  return (
    <div className="space-y-2">
      {stale && <p className="text-xs text-gray-500">{S.activities.video.older}</p>}
      <div ref={box} className="w-full max-w-2xl">
        <div
          className="overflow-hidden rounded-lg border border-gray-200 bg-black dark:border-gray-800"
          style={{ height: Math.round(height * scale), width: Math.round(width * scale) }}
        >
          <iframe
            ref={frame}
            src={`${runPath}/composition-link`}
            title={S.activities.video.preview}
            sandbox="allow-scripts"
            onLoad={() => setLoaded(true)}
            className="block border-0"
            style={{
              width,
              height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {state === "playing" ? (
          <Button size="sm" onClick={() => send("pause")}>
            {S.activities.video.pause}
          </Button>
        ) : (
          <Button size="sm" disabled={!playable} onClick={() => send("play")}>
            {S.activities.video.play}
          </Button>
        )}
        <Button size="sm" disabled={!playable} onClick={() => send("restart")}>
          {S.activities.video.restart}
        </Button>
        <p
          aria-live="polite"
          className={`text-xs ${state === "broken" || state === "unavailable" ? toneInk.danger : "text-gray-500"}`}
        >
          {S.activities.video.states[state]}
          {candidate ? ` · ${S.activities.video.seconds(formatSeconds(candidate.seconds))}` : ""}
        </p>
      </div>
      {candidate && candidate.frames.length > 0 && (
        <section className="space-y-1" aria-label={S.activities.video.frames}>
          <h5 className="text-xs font-semibold">{S.activities.video.frames}</h5>
          <ol className="space-y-1 text-xs">
            {candidate.frames.map((entry, index) => (
              <li key={entry.id}>
                <span className="font-medium">
                  {S.activities.video.frame(index + 1, formatSeconds(entry.seconds))}
                </span>{" "}
                <span className="text-gray-600 dark:text-gray-300">{entry.description}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
