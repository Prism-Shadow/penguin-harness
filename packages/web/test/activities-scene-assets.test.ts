import { describe, expect, it } from "vitest";
import type { AssetManifest } from "@prismshadow/penguin-server/api";
import {
  bindingCounts,
  buildSceneTree,
  filterTree,
  isGeneralScene,
  mediaPathProblem,
  reuseCandidates,
  sharedScenes,
  treeLeaves,
  treeSelections,
} from "../src/features/activities/scene-assets";

type MediaAsset = AssetManifest["assets"][string][number];

function usage(sceneId: string, key: string, occurrence = 1, count = 1) {
  return { sceneId, sourceKey: key, occurrence, sceneOccurrenceCount: count };
}

function asset(over: Partial<MediaAsset> & Pick<MediaAsset, "key" | "type">): MediaAsset {
  return { description: `${over.key} description`, usages: [], ...over } as MediaAsset;
}

const spec = {
  scenes: [
    { id: "intro", description: "The opening" },
    { id: "general", description: "Shared media" },
    { id: "quiz", description: "The question" },
  ],
};

const assets: MediaAsset[] = [
  asset({
    key: "logo",
    type: "image",
    path: "media/images/logo.png",
    usages: [usage("general", "logo"), usage("quiz", "logo")],
  }),
  asset({ key: "intro_art", type: "image", usages: [usage("intro", "intro_art")] }),
  asset({
    key: "welcome",
    type: "audio",
    script: "Hello",
    path: "media/generated/run_" + "a".repeat(32) + ".wav",
    generatedAudio: { runId: "run_" + "a".repeat(32), sha256: "b".repeat(64) },
    usages: [usage("intro", "welcome")],
  }),
  asset({
    key: "chime",
    type: "audio",
    usages: [usage("quiz", "chime", 1, 2), usage("quiz", "chime", 2, 2)],
  }),
  asset({ key: "orphan", type: "video", usages: [usage("deleted_scene", "orphan")] }),
];

describe("scene asset tree", () => {
  it("orders general scenes first and keeps the specification's order after them", () => {
    const tree = buildSceneTree(spec, assets);
    expect(tree.scenes.map((scene) => scene.sceneId)).toEqual(["general", "intro", "quiz"]);
  });

  it("groups a scene's media into categories and omits the ones it does not use", () => {
    const tree = buildSceneTree(spec, assets);
    const intro = tree.scenes.find((scene) => scene.sceneId === "intro")!;
    expect(intro.description).toBe("The opening");
    expect(intro.categories.map((category) => category.type)).toEqual(["image", "audio"]);
    expect(intro.categories[0]!.assets.map((leaf) => leaf.key)).toEqual(["intro_art"]);
  });

  it("marks binding, generation provenance, sharing and repeat use on a leaf", () => {
    const tree = buildSceneTree(spec, assets);
    const quiz = tree.scenes.find((scene) => scene.sceneId === "quiz")!;
    const logo = quiz.categories
      .flatMap((category) => category.assets)
      .find((leaf) => leaf.key === "logo")!;
    expect(logo).toMatchObject({ bound: true, generated: false, shared: true, occurrences: 1 });
    const chime = quiz.categories
      .flatMap((category) => category.assets)
      .find((leaf) => leaf.key === "chime")!;
    expect(chime).toMatchObject({ bound: false, shared: false, occurrences: 2 });
    const welcome = treeLeaves(tree).find((leaf) => leaf.key === "welcome")!;
    expect(welcome).toMatchObject({ bound: true, generated: true });
  });

  it("addresses a selection by scene as well as by key", () => {
    const tree = buildSceneTree(spec, assets);
    expect(treeSelections(tree)).toEqual([
      { sceneId: "general", key: "logo" },
      { sceneId: "intro", key: "intro_art" },
      { sceneId: "intro", key: "welcome" },
      { sceneId: "quiz", key: "logo" },
      { sceneId: "quiz", key: "chime" },
      { sceneId: "", key: "orphan" },
    ]);
  });

  it("does not accept a key that only exists under another scene", () => {
    const tree = buildSceneTree(spec, assets);
    const drawn = treeSelections(tree);
    // "logo" is drawn under general and quiz, never under intro.
    expect(drawn.some((entry) => entry.sceneId === "intro" && entry.key === "logo")).toBe(false);
    expect(drawn.some((entry) => entry.sceneId === "quiz" && entry.key === "logo")).toBe(true);
  });

  it("surfaces manifest entries no scene references instead of dropping them", () => {
    const tree = buildSceneTree(spec, assets);
    expect(tree.unassigned.map((leaf) => leaf.key)).toEqual(["orphan"]);
    expect(treeLeaves(tree).map((leaf) => leaf.key)).toEqual([
      "logo",
      "intro_art",
      "welcome",
      "logo",
      "chime",
      "orphan",
    ]);
  });

  it("reads the legacy stages alias and tolerates a missing specification", () => {
    const legacy = buildSceneTree({ stages: [{ id: "intro", description: "x" }] }, assets);
    expect(legacy.scenes.map((scene) => scene.sceneId)).toEqual(["intro"]);
    expect(buildSceneTree(null, assets).scenes).toEqual([]);
    expect(buildSceneTree(null, assets).unassigned).toHaveLength(assets.length);
  });

  it("recognises a general scene by id, not by position", () => {
    expect(isGeneralScene("general")).toBe(true);
    expect(isGeneralScene("General-Media")).toBe(true);
    expect(isGeneralScene("generally-hard")).toBe(false);
    expect(isGeneralScene("intro")).toBe(false);
  });
});

describe("scene asset filtering", () => {
  it("keeps only the chosen type and drops scenes left with nothing", () => {
    const tree = filterTree(buildSceneTree(spec, assets), "audio");
    expect(tree.scenes.map((scene) => scene.sceneId)).toEqual(["intro", "quiz"]);
    expect(tree.unassigned).toEqual([]);
  });

  it("passes the tree through unchanged when nothing is filtered", () => {
    const tree = buildSceneTree(spec, assets);
    expect(filterTree(tree, "all")).toBe(tree);
  });
});

describe("shared bindings", () => {
  it("names every scene a rebinding would reach, once each", () => {
    expect(sharedScenes(assets[0])).toEqual(["general", "quiz"]);
    expect(sharedScenes(assets[3])).toEqual(["quiz"]);
    expect(sharedScenes(undefined)).toEqual([]);
  });

  it("offers bound assets of the same type, general scenes first", () => {
    const pool: MediaAsset[] = [
      asset({ key: "zebra", type: "image", path: "media/z.png", usages: [usage("quiz", "zebra")] }),
      asset({
        key: "apple",
        type: "image",
        path: "media/a.png",
        usages: [usage("general", "apple")],
      }),
      asset({ key: "banana", type: "image", path: "media/b.png", usages: [usage("quiz", "b")] }),
      asset({ key: "sound", type: "audio", path: "media/s.wav", usages: [usage("quiz", "s")] }),
      asset({ key: "unbound", type: "image", usages: [usage("quiz", "unbound")] }),
      asset({ key: "target", type: "image", usages: [usage("quiz", "target")] }),
    ];
    const target = pool.find((entry) => entry.key === "target")!;
    expect(reuseCandidates(pool, target).map((entry) => entry.key)).toEqual([
      "apple",
      "banana",
      "zebra",
    ]);
    expect(reuseCandidates(pool, undefined)).toEqual([]);
  });

  it("never offers a generated binding, whose path belongs to its run", () => {
    const target = asset({ key: "other", type: "audio", usages: [usage("quiz", "other")] });
    expect(reuseCandidates([...assets, target], target)).toEqual([]);
  });

  it("counts how much of a language group is bound", () => {
    expect(bindingCounts(assets)).toEqual({ total: 5, bound: 2 });
    expect(bindingCounts([])).toEqual({ total: 0, bound: 0 });
  });
});

describe("media path validation", () => {
  it("accepts the relative media paths the server accepts", () => {
    expect(mediaPathProblem("media/audio/welcome.wav")).toBeNull();
    expect(mediaPathProblem("media/images/a b-c_1.png")).toBeNull();
  });

  it("judges the exact string, so it cannot pass what the server will reject", () => {
    // The server's own rule anchors on "media/" and forbids a trailing space in a
    // segment, so a surrounding space has to be reported rather than tidied away.
    expect(mediaPathProblem(" media/images/logo.png")).toBe("prefix");
    expect(mediaPathProblem("media/images/logo.png ")).toBe("segment");
  });

  it("names why a path was rejected", () => {
    expect(mediaPathProblem("")).toBe("empty");
    expect(mediaPathProblem("   ")).toBe("empty");
    expect(mediaPathProblem("audio/welcome.wav")).toBe("prefix");
    expect(mediaPathProblem("https://example.com/a.png")).toBe("prefix");
    expect(mediaPathProblem("media/audio/welcome?.wav")).toBe("characters");
    expect(mediaPathProblem("media/../secrets.wav")).toBe("segment");
    expect(mediaPathProblem("media//welcome.wav")).toBe("segment");
    expect(mediaPathProblem("media/audio./welcome.wav")).toBe("segment");
    expect(mediaPathProblem(`media/${"a".repeat(1100)}.wav`)).toBe("length");
  });
});
