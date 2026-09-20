import { describe, expect, it } from "vitest";
import { contentRevision, draftRevision, type ActivityDetail } from "../src/activities/domain.js";
import {
  planMedia,
  validateManifest,
  validateMediaCoverage,
  mediaConfiguration,
} from "../src/activities/media.js";
import { scaffoldModule, verifyMediaArtifacts } from "../src/activities/waf-module.js";
import { activitySpec } from "./activity-fixtures.js";

function activity(): ActivityDetail {
  return {
    id: "act_one",
    collectionId: "col_one",
    productCode: "P",
    refNum: 1,
    title: "Words",
    activityType: "standard",
    archived: false,
    createdAt: "",
    updatedAt: "",
    draft: {
      draftId: "draft_one",
      activityId: "act_one",
      baseVersionId: null,
      contentRevision: "",
      status: "valid",
      description: "Words",
      updatedAt: "",
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Look",
            media: {
              images: [{ key: "cat", description: "A cat", targetPath: "media/not-generated.png" }],
            },
            audio: { tracks: [{ key: "voice", description: "Say cat", script: "Cat" }] },
          },
          {
            id: "practice",
            description: "Choose",
            media: { images: [{ key: "cat", description: "A cat" }] },
          },
        ],
      },
    },
  };
}

describe("activity media planning", () => {
  it("coalesces reused scene assets without claiming target paths are existing media", () => {
    const plan = planMedia(activity());
    expect(plan.manifest.assets["en-US"]).toHaveLength(2);
    expect(plan.manifest.assets["en-US"]![0]).toMatchObject({
      key: "cat",
      type: "image",
      usages: [{ sceneId: "intro" }, { sceneId: "practice" }],
    });
    expect(plan.manifest.assets["en-US"]![0]!.path).toBeUndefined();
    expect(plan.manifest.assets["en-US"]![1]!.script).toBe("Cat");
  });
  it("preserves unchanged bindings but clears changed requirements and removes obsolete assets", () => {
    const a = activity();
    a.draft.mediaPlan = planMedia(a);
    a.draft.mediaPlan.manifest.assets["en-US"]![0]!.path = "media/cat.png";
    expect(planMedia(a).manifest.assets["en-US"]![0]!.path).toBe("media/cat.png");
    a.draft.spec = {
      ...a.draft.spec,
      scenes: [
        {
          id: "intro",
          description: "Look",
          media: { images: [{ key: "cat", description: "A different cat" }] },
        },
      ],
    };
    const next = planMedia(a);
    expect(next.manifest.assets["en-US"]).toHaveLength(1);
    expect(next.manifest.assets["en-US"]![0]!.path).toBeUndefined();
    expect(next.specRevision).not.toBe(a.draft.mediaPlan.specRevision);
  });
  it("rejects ambiguous keys across scenes", () => {
    const a = activity();
    const scenes = a.draft.spec!.scenes as { media: { images: { description: string }[] } }[];
    scenes[1]!.media.images[0]!.description = "Different cat";
    expect(() => planMedia(a)).toThrow("conflicting requirements");
  });
  it("preserves reviewed translations across unrelated spec edits and clears changed translations", () => {
    const a = activity();
    a.draft.mediaPlan = planMedia(a);
    const voice = a.draft.mediaPlan.manifest.assets["en-US"]![1]!;
    a.draft.mediaPlan.manifest.assets["es-MX"] = [
      { ...voice, script: "Gato", path: "media/gato.mp3" },
    ];
    a.draft.spec = { ...a.draft.spec, title: "New title" };
    expect(planMedia(a).manifest.assets["es-MX"]![0]).toMatchObject({
      script: "Gato",
      path: "media/gato.mp3",
    });
    const scenes = a.draft.spec.scenes as { audio?: { tracks: { script: string }[] } }[];
    scenes[0]!.audio!.tracks[0]!.script = "Dog";
    expect(planMedia(a).manifest.assets["es-MX"]).toEqual([]);
  });
  it.each([
    "../private",
    "media/../secret",
    "media/ok/../../secret",
    "C:/secret",
    "https://example.org/a",
    "media/a%2fb",
    "media/x\\y",
    "media/a/",
    "media/x./a",
  ])("rejects unsafe reference %s", (path) => {
    const a = activity();
    const manifest = planMedia(a).manifest;
    manifest.assets["en-US"]![0]!.path = path;
    expect(() => validateManifest(manifest, a)).toThrow("Media paths");
  });
  it("validates identity, aliases, coverage and scene references", () => {
    const a = activity();
    const manifest = planMedia(a).manifest;
    expect(() => validateManifest({ ...manifest, refNum: 2 }, a)).toThrow("match");
    manifest.assets["en-US"]![1]!.sourceKey = "cat";
    expect(() => validateManifest(manifest, a)).toThrow("aliases conflict");
    delete manifest.assets["en-US"]![1]!.sourceKey;
    manifest.assets["en-US"]![0]!.usages[0]!.sceneId = "unknown";
    expect(() => validateMediaCoverage(manifest, a)).toThrow("unknown scene");
    manifest.assets["en-US"] = [];
    expect(() => validateMediaCoverage(manifest, a)).toThrow("every asset");
  });
  it("validates generated image provenance and its immutable media path", () => {
    const a = activity();
    const manifest = planMedia(a).manifest;
    const image = manifest.assets["en-US"]![0]!;
    const runId = "run_0123456789abcdef0123456789abcdef";
    const sha256 = "a".repeat(64);
    image.path = `media/generated/${runId}.png`;
    image.generatedImage = { runId, sha256 };
    expect(validateManifest(manifest, a).assets["en-US"]![0]!.generatedImage).toEqual({
      runId,
      sha256,
    });
    for (const change of [
      {
        generatedImage: { runId: "run_0123456789abcdef0123456789abcdef", sha256 },
        path: "media/cat.png",
      },
      {
        generatedImage: { runId: "run_0123456789abcdef0123456789abcdeg", sha256 },
        path: `media/generated/${runId}.png`,
      },
      { generatedImage: { runId, sha256: "bad" }, path: `media/generated/${runId}.png` },
      { generatedImage: { runId, sha256 }, path: `media/generated/${runId}.wav` },
    ]) {
      const invalid = planMedia(a).manifest;
      Object.assign(invalid.assets["en-US"]![0]!, change);
      expect(() => validateManifest(invalid, a)).toThrow("generated image");
    }
    const wrongType = planMedia(a).manifest;
    const wrong = wrongType.assets["en-US"]![0]!;
    wrong.type = "audio";
    wrong.path = `media/generated/${runId}.png`;
    wrong.generatedImage = { runId, sha256 };
    expect(() => validateManifest(wrongType, a)).toThrow("generated image");
  });
  it("leaves legacy revisions unchanged and includes media edits in concurrency control", () => {
    const a = activity();
    expect(draftRevision(a.draft)).toBe(
      contentRevision({ description: a.draft.description, spec: a.draft.spec }),
    );
    const before = draftRevision(a.draft);
    a.draft.mediaPlan = planMedia(a);
    expect(draftRevision(a.draft)).not.toBe(before);
    const planned = draftRevision(a.draft);
    a.draft.mediaPlan.manifest.assets["en-US"]![0]!.path = "media/cat.png";
    expect(draftRevision(a.draft)).not.toBe(planned);
  });
  it("emits language-specific WAF configuration, preserves unbound assets and rejects stale assembly", async () => {
    const a = activity();
    a.draft.mediaPlan = planMedia(a);
    const manifest = a.draft.mediaPlan.manifest;
    manifest.assets["en-US"]![0]!.path = "media/images/cat.png";
    manifest.assets["en-US"]![0]!.sourceKey = "picture";
    manifest.assets["es-MX"] = [
      { ...manifest.assets["en-US"]![0]!, path: "media/images/gato.png" },
    ];
    expect(mediaConfiguration(manifest)).toEqual({
      P: {
        telemetry: false,
        "en-US": { cat: "{{MEDIA}}/images/cat.png", picture: "{{MEDIA}}/images/cat.png" },
        "es-MX": { cat: "{{MEDIA}}/images/gato.png", picture: "{{MEDIA}}/images/gato.png" },
      },
    });
    const files = scaffoldModule(a);
    expect(JSON.parse(files["generated/P/refs/P-1/spec/asset_manifest.json"]!)).toEqual(manifest);
    const read = async (name: string) =>
      files[name.replaceAll("\\", "/").replace(/^module\//, "")]!;
    await expect(verifyMediaArtifacts("", a, read)).resolves.toBeUndefined();
    files["configurations/P-1.json"] = JSON.stringify({ P: {} });
    await expect(verifyMediaArtifacts("", a, read)).rejects.toThrow("approved media configuration");
    a.draft.spec = { ...a.draft.spec, title: "New title" };
    expect(() => scaffoldModule(a)).toThrow("Rebuild the media plan");
  });
});
