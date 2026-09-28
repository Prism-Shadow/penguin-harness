import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import {
  compositionFailure,
  compositionRuns,
  formatSeconds,
  isShowable,
  parseCandidate,
  previewCommand,
  previewState,
  sceneHasImage,
  sceneHasLearnerChoice,
} from "../src/features/activities/scene-composition";
import { S } from "../src/lib/strings";

type Asset = AssetManifest["assets"][string][number];

const usage = (sceneId: string) => ({
  sceneId,
  sourceKey: "k",
  occurrence: 1,
  sceneOccurrenceCount: 1,
});
const asset = (key: string, type: Asset["type"], sceneId: string, path?: string): Asset => ({
  key,
  type,
  description: key,
  usages: [usage(sceneId)],
  ...(path ? { path } : {}),
});

function run(overrides: Partial<ActivityRunSummary>): ActivityRunSummary {
  return {
    kind: "composition",
    runId: "run_1",
    activityId: "a",
    projectId: "p",
    draftId: "d",
    inputRevision: "r",
    agentId: "default_agent",
    sessionId: "s",
    status: "succeeded",
    createdAt: "2026-09-28T10:00:00.000Z",
    finishedAt: null,
    error: null,
    hasCandidate: true,
    composition: {
      language: "en-US",
      assetKey: "intro-video",
      sceneId: "intro",
      width: 640,
      height: 480,
      images: [],
    },
    ...overrides,
  };
}

describe("scene compositions in the studio", () => {
  it("lists an asset's compositions newest first, and nothing else", () => {
    const runs = [
      run({ runId: "old", createdAt: "2026-09-28T09:00:00.000Z" }),
      run({ runId: "new" }),
      run({ runId: "image", kind: "image" }),
      run({
        runId: "other",
        composition: { ...run({}).composition!, assetKey: "outro-video" },
      }),
      run({ runId: "french", composition: { ...run({}).composition!, language: "fr-FR" } }),
    ];
    expect(compositionRuns(runs, "en-US", "intro-video").map((entry) => entry.runId)).toEqual([
      "new",
      "old",
    ]);
  });

  it("offers composing only for a scene with a bound image", () => {
    const video = asset("intro-video", "video", "intro");
    expect(sceneHasImage([video, asset("sky", "image", "intro")], video)).toBe(false);
    expect(
      sceneHasImage([video, asset("sky", "image", "outro", "media/uploads/a.png")], video),
    ).toBe(false);
    expect(
      sceneHasImage([video, asset("sky", "image", "intro", "media/uploads/a.png")], video),
    ).toBe(true);
    expect(sceneHasImage([], { ...video, usages: [] })).toBe(false);
  });

  it("shows only a kept composition", () => {
    expect(isShowable(run({}))).toBe(true);
    expect(isShowable(run({ status: "conflict" }))).toBe(true);
    expect(isShowable(run({ status: "failed", hasCandidate: false }))).toBe(false);
    expect(isShowable(run({ status: "running", hasCandidate: false }))).toBe(false);
  });

  it("reads a candidate's frames and ignores anything malformed", () => {
    const parsed = parseCandidate(
      JSON.stringify({
        frames: [{ id: "f1", description: "Dawn", seconds: 3 }, { id: 2 }],
        seconds: 6,
        sha256: "abc",
        bytes: 10,
      }),
    );
    expect(parsed?.frames).toEqual([{ id: "f1", description: "Dawn", seconds: 3 }]);
    expect(parsed?.seconds).toBe(6);
    expect(parseCandidate("not json")).toBeNull();
    expect(parseCandidate(null)).toBeNull();
    expect(parseCandidate(JSON.stringify({ frames: "no" }))).toBeNull();
    expect(formatSeconds(6)).toBe("6");
    expect(formatSeconds(4.25)).toBe("4.3");
  });

  it("words a failed check by its code, else keeps the server's message", () => {
    expect(
      compositionFailure(
        run({
          status: "failed",
          error: "composition.html reaches the network (https://cdn.example.com)",
          composition: { ...run({}).composition!, problem: "composition_network" },
        }),
      ),
    ).toBe(S.activities.video.problems.composition_network);
    expect(compositionFailure(run({ status: "failed", error: "Session was stopped." }))).toBe(
      "Session was stopped.",
    );
  });

  it("takes only the bridge's known states from the frame, and speaks to it in its own terms", () => {
    expect(previewState({ source: "penguin-composition", state: "playing" })).toBe("playing");
    expect(previewState({ source: "penguin-composition", state: "hacked" })).toBeNull();
    expect(previewState({ source: "elsewhere", state: "ready" })).toBeNull();
    expect(previewState("ready")).toBeNull();
    expect(previewCommand("restart")).toEqual({ source: "penguin-studio", action: "restart" });
  });

  it("warns about a scene that asks the learner to choose, and only that scene", () => {
    const spec = {
      scenes: [
        { id: "intro", description: "The sky at dawn" },
        { id: "quiz", description: "Pick the sun", choices: [{ id: "a" }, { id: "b" }] },
        { id: "empty", description: "Nothing to pick", options: [] },
      ],
    };
    expect(sceneHasLearnerChoice(spec, "quiz")).toBe(true);
    expect(sceneHasLearnerChoice(spec, "intro")).toBe(false);
    expect(sceneHasLearnerChoice(spec, "empty")).toBe(false);
    expect(sceneHasLearnerChoice(spec, "missing")).toBe(false);
    expect(sceneHasLearnerChoice(spec, null)).toBe(false);
    expect(sceneHasLearnerChoice(null, "quiz")).toBe(false);
    expect(
      sceneHasLearnerChoice({ stages: [{ id: "s", interaction: { type: "tap" } }] }, "s"),
    ).toBe(true);
  });

  it("never takes 'unavailable' from the frame: only the studio decides that", () => {
    expect(previewState({ source: "penguin-composition", state: "unavailable" })).toBeNull();
  });

  it("words every refusal the compose route reports by code", () => {
    for (const code of [
      "experiment_off",
      "composition_no_images",
      "composition_asset_invalid",
      "composition_image_too_large",
      "composition_not_found",
    ] as const)
      expect(S.errors.byCode[code]).toBeTruthy();
  });
});
