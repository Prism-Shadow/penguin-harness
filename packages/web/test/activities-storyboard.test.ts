import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { storyboardFrames } from "../src/features/activities/storyboard";

type MediaAsset = AssetManifest["assets"][string][number];

const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});

const spec = {
  scenes: [
    { id: "intro", description: "An island appears." },
    { id: "rocks", description: "Find the letter d." },
    { id: "empty", description: "Nothing yet." },
  ],
};

const assets: MediaAsset[] = [
  { key: "island", type: "image", description: "Island", usages: [usage("intro", "island")] },
  {
    key: "map",
    type: "image",
    description: "Map",
    path: "media/generated/run_1.png",
    generatedImage: { runId: "run_1", sha256: "a" },
    usages: [usage("intro", "map")],
  },
  {
    key: "find_d",
    type: "audio",
    description: "Prompt",
    script: "Find d",
    path: "find_d.mp3",
    usages: [usage("rocks", "find_d")],
  },
  { key: "rock", type: "image", description: "Rock", usages: [usage("rocks", "rock")] },
];

const running = (assetKey: string, language = "en-US") =>
  ({
    runId: "run_x",
    kind: "image",
    status: "running",
    image: { language, assetKey, prompt: "", model: "" },
  }) as unknown as ActivityRunSummary;

describe("storyboard frames", () => {
  it("numbers scenes in order and shows each one's first image the saved plan has bound", () => {
    const frames = storyboardFrames(buildSceneTree(spec, assets), assets, [], [], "en-US");
    expect(
      frames.map((frame) => [frame.number, frame.sceneId, frame.thumbnailKey, frame.firstAssetKey]),
    ).toEqual([
      [1, "intro", "map", "island"],
      [2, "rocks", null, "rock"],
      [3, "empty", null, null],
    ]);
    expect(frames[0]).toMatchObject({
      description: "An island appears.",
      assetCount: 2,
      unbound: 1,
    });
    expect(frames[1]).toMatchObject({ assetCount: 2, unbound: 1 });
  });

  it("marks the scenes an agent is generating for, in the language shown", () => {
    const tree = buildSceneTree(spec, assets);
    expect(
      storyboardFrames(tree, assets, [running("rock")], [], "en-US").map((f) => f.working),
    ).toEqual([false, true, false]);
    expect(
      storyboardFrames(tree, assets, [running("rock", "es-MX")], [], "en-US").some(
        (f) => f.working,
      ),
    ).toBe(false);
  });

  it("marks the scenes an open proposal would change", () => {
    const frames = storyboardFrames(
      buildSceneTree(spec, assets),
      assets,
      [],
      [
        { target: "media", language: "en-US", assetKey: "island", field: "description", text: "x" },
        { target: "description", text: "whole script" },
      ],
      "en-US",
    );
    expect(frames.map((frame) => frame.proposed)).toEqual([true, false, false]);
  });
});
