import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import {
  comparedRecording,
  isRecordable,
  recordingFailure,
  recordingUrl,
  videoRuns,
} from "../src/features/activities/scene-video";
import { runKindLabel } from "../src/features/activities/run-toasts";
import { S } from "../src/lib/strings";

type Asset = AssetManifest["assets"][string][number];

const video: Asset = {
  key: "intro-video",
  type: "video",
  description: "The sky",
  usages: [{ sceneId: "intro", sourceKey: "intro-video", occurrence: 1, sceneOccurrenceCount: 1 }],
};

function recording(overrides: Partial<ActivityRunSummary>): ActivityRunSummary {
  return {
    kind: "video",
    runId: "run_1",
    activityId: "a",
    projectId: "p",
    draftId: "d",
    inputRevision: "r",
    agentId: "",
    sessionId: null,
    status: "succeeded",
    createdAt: "2026-09-28T10:00:00.000Z",
    finishedAt: null,
    error: null,
    hasCandidate: true,
    video: {
      language: "en-US",
      assetKey: "intro-video",
      compositionRunId: "run_c",
      width: 640,
      height: 480,
      seconds: 6,
    },
    ...overrides,
  };
}

describe("scene video recordings in the studio", () => {
  it("lists an asset's recordings newest first, and nothing else", () => {
    const runs = [
      recording({ runId: "run_old", createdAt: "2026-09-28T09:00:00.000Z" }),
      recording({ runId: "run_new", createdAt: "2026-09-28T11:00:00.000Z" }),
      recording({ runId: "run_fr", video: { ...recording({}).video!, language: "fr-FR" } }),
      recording({ runId: "run_other", video: { ...recording({}).video!, assetKey: "outro" } }),
      recording({ runId: "run_comp", kind: "composition", video: undefined }),
    ];
    expect(videoRuns(runs, "en-US", "intro-video").map((run) => run.runId)).toEqual([
      "run_new",
      "run_old",
    ]);
  });

  it("records only a composition that succeeded and kept its page", () => {
    const composition = recording({ kind: "composition", video: undefined });
    expect(isRecordable(composition)).toBe(true);
    expect(isRecordable(null)).toBe(false);
    expect(isRecordable({ ...composition, status: "conflict" })).toBe(false);
    expect(isRecordable({ ...composition, hasCandidate: false })).toBe(false);
    expect(isRecordable(recording({}))).toBe(false);
  });

  it("offers the newest recording of this draft that is not bound or put aside", () => {
    const runs = videoRuns(
      [
        recording({ runId: "run_a", createdAt: "2026-09-28T09:00:00.000Z" }),
        recording({ runId: "run_b", createdAt: "2026-09-28T10:00:00.000Z" }),
        recording({ runId: "run_c", createdAt: "2026-09-28T11:00:00.000Z", inputRevision: "old" }),
        recording({ runId: "run_d", createdAt: "2026-09-28T12:00:00.000Z", status: "failed" }),
      ],
      "en-US",
      "intro-video",
    );
    expect(comparedRecording(runs, video, "r", new Set())?.runId).toBe("run_b");
    expect(comparedRecording(runs, video, "r", new Set(["run_b"]))?.runId).toBe("run_a");
    const bound: Asset = {
      ...video,
      path: "media/generated/run_b.webm",
      generatedVideo: { runId: "run_b", sha256: "0".repeat(64) },
    };
    expect(comparedRecording(runs, bound, "r", new Set())?.runId).toBe("run_a");
    expect(comparedRecording(runs, bound, "r", new Set(["run_a"]))).toBeNull();
  });

  it("plays a recording from its run and words a failure with its cause", () => {
    expect(recordingUrl("/api/x", "run_1")).toBe("/api/x/runs/run_1/video");
    expect(recordingFailure(recording({ status: "failed", error: "no timeline" }))).toBe(
      S.activities.video.recordFailed("no timeline"),
    );
    expect(recordingFailure(recording({ status: "failed" }))).toBe(
      S.activities.video.recordFailed(S.activities.video.noCause),
    );
    // A cause the server names by its code is worded by the App, not by the server's sentence.
    const failed = recording({ status: "failed", error: "The recording is not a WebM video." });
    expect(
      recordingFailure({ ...failed, video: { ...failed.video!, problem: "video_invalid" } }),
    ).toBe(S.activities.video.recordProblems.video_invalid);
    expect(
      recordingFailure(recording({ status: "cancelled", error: "Generation cancelled." })),
    ).toBe("Generation cancelled.");
    expect(runKindLabel(recording({}))).toBe(S.activities.video.recordRun);
  });
});
