import { describe, expect, it } from "vitest";
import type { AssetManifest, MediaAsset } from "@prismshadow/penguin-server/api";
import {
  blockers,
  boundSource,
  decisions,
  groupRows,
  keepAll,
  needsGeneration,
  planRows,
  refNumberFrom,
  regenerateAllImages,
  sceneOrder,
  setAction,
  setFileName,
  setLibraryPath,
  setText,
  voiceForAll,
} from "../src/features/activities/ref-plan";

const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});
const RUN = `run_${"a".repeat(32)}`;

const assets: MediaAsset[] = [
  {
    key: "outro-voice",
    type: "audio",
    description: "Goodbye",
    script: "Bye now",
    usages: [usage("outro", "outro-voice")],
  },
  {
    key: "cat",
    type: "image",
    description: "A cat",
    path: `media/generated/${RUN}.png`,
    usages: [usage("intro", "cat"), usage("outro", "cat")],
  },
  {
    key: "hello",
    type: "audio",
    description: "Greeting",
    script: "Hello",
    voice: "Kore",
    path: `media/generated/${RUN}.wav`,
    generatedAudio: { runId: RUN, sha256: "b".repeat(64) },
    usages: [usage("intro", "hello")],
  },
  {
    key: "theme",
    type: "audio",
    description: "Music",
    kind: "music",
    channel: "music",
    loop: true,
    volume: 0.5,
    path: "media/loom/words/theme.mp3",
    usages: [usage("intro", "theme")],
  },
  { key: "spare", type: "image", description: "Unused", usages: [] },
];
const manifest: AssetManifest = { productCode: "words", refNum: 12, assets: { "en-US": assets } };
const order = ["intro", "outro"];
const rows = () => planRows(manifest, "en-US", order);

describe("ref plan rows", () => {
  it("reads the scene order from a specification", () => {
    expect(sceneOrder({ scenes: [{ id: "intro" }, { id: "outro" }] })).toEqual(order);
    expect(sceneOrder({ stages: [{ id: "a" }] })).toEqual(["a"]);
    expect(sceneOrder(null)).toEqual([]);
  });

  it("orders rows by their first scene, keeping manifest order within one, unused last", () => {
    expect(rows().map((row) => row.key)).toEqual(["cat", "hello", "theme", "outro-voice", "spare"]);
    expect(rows()[0]!.scenes).toEqual(["intro", "outro"]);
    expect(groupRows(rows()).map((group) => [group.sceneId, group.rows.length])).toEqual([
      ["intro", 3],
      ["outro", 1],
      [null, 1],
    ]);
  });

  it("offers actions on narration and images only, starting from keep with the template's text", () => {
    const byKey = Object.fromEntries(rows().map((row) => [row.key, row]));
    expect(byKey.hello).toMatchObject({ narration: true, editable: true, text: "Hello" });
    expect(byKey.cat).toMatchObject({ narration: false, editable: true, text: "A cat" });
    expect(byKey.theme).toMatchObject({ narration: false, editable: false });
    expect(rows().every((row) => row.action === "keep")).toBe(true);
    expect(planRows(manifest, "es-MX", order)).toEqual([]);
  });

  it("changes one row at a time, and never a row copied as it is", () => {
    let next = setAction(rows(), "cat", "regenerate");
    next = setText(next, "cat", "A dog");
    next = setAction(next, "theme", "regenerate");
    expect(next.find((row) => row.key === "cat")).toMatchObject({
      action: "regenerate",
      text: "A dog",
    });
    expect(next.find((row) => row.key === "theme")!.action).toBe("keep");
  });
});

describe("bulk helpers", () => {
  it("regenerates every image", () => {
    const next = regenerateAllImages(rows());
    expect(next.filter((row) => row.action === "regenerate").map((row) => row.key)).toEqual([
      "cat",
      "spare",
    ]);
  });

  it("gives every narration one voice, marking each to regenerate, and none leaves them be", () => {
    const voiced = voiceForAll(rows(), "Puck");
    expect(
      voiced.filter((row) => row.narration).map((row) => [row.key, row.action, row.voice]),
    ).toEqual([
      ["hello", "regenerate", "Puck"],
      ["outro-voice", "regenerate", "Puck"],
    ]);
    expect(voiced.find((row) => row.key === "theme")!.action).toBe("keep");
    const cleared = voiceForAll(voiced, null);
    expect(cleared.find((row) => row.key === "hello")).toMatchObject({
      action: "regenerate",
      voice: null,
    });
  });

  it("keeps all, restoring the template's text and forgetting chosen files", () => {
    let next = voiceForAll(regenerateAllImages(rows()), "Puck");
    next = setText(next, "cat", "A dog");
    next = setAction(setFileName(next, "spare", "x.png"), "spare", "upload");
    const kept = keepAll(next);
    expect(kept.every((row) => row.action === "keep")).toBe(true);
    expect(kept.find((row) => row.key === "cat")!.text).toBe("A cat");
    expect(kept.find((row) => row.key === "hello")!.voice).toBeNull();
    expect(kept.find((row) => row.key === "spare")!.fileName).toBeNull();
  });
});

describe("blockers", () => {
  it("needs a free whole number", () => {
    expect(refNumberFrom(" 13 ")).toBe(13);
    expect(refNumberFrom("1.5")).toBeNull();
    expect(blockers(rows(), "", [])).toEqual([{ code: "missingRefNum" }]);
    expect(blockers(rows(), "-1", [])).toEqual([{ code: "missingRefNum" }]);
    expect(blockers(rows(), "12", [12])).toEqual([{ code: "refNumTaken", refNum: 12 }]);
    expect(blockers(rows(), "13", [12])).toEqual([]);
  });

  it("needs a file for an upload, a pick for the library, and text to regenerate from", () => {
    let next = setAction(rows(), "cat", "upload");
    next = setAction(next, "spare", "library");
    next = setText(setAction(next, "hello", "regenerate"), "hello", "  ");
    next = setText(setAction(next, "outro-voice", "regenerate"), "outro-voice", "x".repeat(5001));
    expect(blockers(next, "13", [])).toEqual([
      { code: "uploadMissing", key: "cat" },
      { code: "scriptMissing", key: "hello" },
      { code: "scriptTooLong", key: "outro-voice" },
      { code: "libraryMissing", key: "spare" },
    ]);
    next = setFileName(next, "cat", "cat.png");
    next = setLibraryPath(next, "spare", "media/loom/words/words-1/uploads/spare-1.png");
    next = setText(next, "hello", "Hi");
    next = setText(next, "outro-voice", "Bye");
    expect(blockers(next, "13", [])).toEqual([]);
  });

  it("refuses an empty or overlong image description", () => {
    const empty = setText(setAction(rows(), "cat", "regenerate"), "cat", "");
    expect(blockers(empty, "13", [])).toEqual([{ code: "descriptionMissing", key: "cat" }]);
    const long = setText(empty, "cat", "y".repeat(5001));
    expect(blockers(long, "13", [])).toEqual([{ code: "descriptionTooLong", key: "cat" }]);
  });
});

describe("decisions", () => {
  it("sends only a voice for kept rows, clears regenerated and uploaded ones, and binds picks", () => {
    let next = voiceForAll(rows(), "Puck");
    next = setText(next, "hello", "Hi");
    next = setAction(next, "outro-voice", "keep");
    next = setText(setAction(next, "cat", "regenerate"), "cat", "A dog");
    next = setAction(setFileName(next, "spare", "spare.png"), "spare", "upload");
    expect(decisions(next, "en-US")).toEqual([
      { language: "en-US", assetKey: "cat", action: "clear", description: "A dog" },
      { language: "en-US", assetKey: "hello", action: "clear", script: "Hi", voice: "Puck" },
      // Kept, but the template has no clip for it: the run speaks it in the chosen voice.
      { language: "en-US", assetKey: "outro-voice", action: "clear", voice: "Puck" },
      { language: "en-US", assetKey: "spare", action: "clear" },
    ]);
    // A kept narration the template has a clip for keeps that clip and its voice.
    expect(decisions(setAction(voiceForAll(rows(), "Puck"), "hello", "keep"), "en-US")).toEqual([
      {
        language: "en-US",
        assetKey: "outro-voice",
        action: "clear",
        script: "Bye now",
        voice: "Puck",
      },
    ]);
    const picked = setLibraryPath(
      setAction(rows(), "cat", "library"),
      "cat",
      "media/loom/words/words-1/uploads/a.png",
    );
    expect(decisions(picked, "en-US")).toEqual([
      {
        language: "en-US",
        assetKey: "cat",
        action: "bind",
        path: "media/loom/words/words-1/uploads/a.png",
      },
    ]);
    expect(decisions(rows(), "en-US")).toEqual([]);
  });

  it("says whether anything is left to generate", () => {
    expect(needsGeneration(rows())).toBe(false);
    expect(needsGeneration(setAction(rows(), "cat", "upload"))).toBe(false);
    expect(needsGeneration(regenerateAllImages(rows()))).toBe(true);
  });
});

describe("boundSource", () => {
  const endpoint = "/api/projects/p/activities/act";
  it("plays a generated clip from its run, an upload from the uploads, the rest from the checkout", () => {
    expect(boundSource(assets[2]!, endpoint)).toBe(`${endpoint}/runs/${RUN}/audio`);
    expect(
      boundSource({ ...assets[0]!, path: "media/loom/words/words-1/uploads/bye-1.wav" }, endpoint),
    ).toBe(`${endpoint}/media-upload?path=media%2Floom%2Fwords%2Fwords-1%2Fuploads%2Fbye-1.wav`);
    expect(boundSource(assets[3]!, endpoint)).toBe(
      `${endpoint}/sandbox/media/loom/words/theme.mp3`,
    );
    expect(boundSource(assets[0]!, endpoint)).toBeNull();
  });
});
