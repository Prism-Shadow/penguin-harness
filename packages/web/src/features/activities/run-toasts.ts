/**
 * What to announce when work an author started in the background settles: a run that was
 * running and now is not, or the stages as a whole. Kept pure so "settled since last look"
 * is decided in one place, and a page opened on finished runs announces nothing.
 */
import type { ActivityRunSummary, PipelineState } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

export type Announcement = {
  kind: "success" | "error" | "info" | "attention";
  text: string;
};

/** What a run is, as the history names it. */
export function runKindLabel(run: Pick<ActivityRunSummary, "kind">): string {
  const words = S.activities;
  if (run.kind === "module") return words.moduleRun;
  if (run.kind === "audio") return words.audioRun;
  if (run.kind === "image") return words.imageRun;
  if (run.kind === "media-text") return words.textRun;
  if (run.kind === "assist") return words.assistRun;
  if (run.kind === "assessment") return words.assessmentRun;
  if (run.kind === "quality") return words.qualityRun;
  return words.specRun;
}

/** The asset a media run worked on, when it worked on one. */
function subject(run: ActivityRunSummary): string {
  const target = run.audio ?? run.image ?? run.mediaText;
  return target ? `${runKindLabel(run)} · ${target.assetKey}` : runKindLabel(run);
}

/** Runs that were running at the last look and have settled since, announced in order. */
export function settledRuns(
  before: ReadonlyMap<string, ActivityRunSummary["status"]>,
  runs: readonly ActivityRunSummary[],
): Announcement[] {
  const words = S.activities.runSettled;
  return runs
    .filter((run) => before.get(run.runId) === "running" && run.status !== "running")
    .map((run) => {
      const what = subject(run);
      if (run.status === "succeeded") return { kind: "success", text: words.succeeded(what) };
      if (run.status === "cancelled") return { kind: "info", text: words.cancelled(what) };
      if (run.status === "conflict") return { kind: "attention", text: words.conflict(what) };
      return { kind: "error", text: words.failed(what) };
    });
}

/** The stages' outcome, once, when a sequence seen running has stopped. */
export function settledPipeline(
  before: PipelineState["status"] | null,
  pipeline: PipelineState | null,
): Announcement | null {
  if (before !== "running" || !pipeline || pipeline.status === "running") return null;
  const words = S.activities.studioRun;
  if (pipeline.status === "succeeded") return { kind: "success", text: words.finished };
  if (pipeline.status === "cancelled") return { kind: "info", text: words.stopped };
  return { kind: "error", text: words.failed(pipeline.error ?? words.status.failed) };
}
