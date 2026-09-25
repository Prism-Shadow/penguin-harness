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
    productId: null,
    displayName: null,
    stable: false,
    refNum: 1,
    title: "Words",
    activityType: "standard",
    archived: false,
    tags: [],
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
  it("keeps a narration's translation source, word timings and length through validation", () => {
    const usage = { sceneId: "intro", sourceKey: "hi", occurrence: 1, sceneOccurrenceCount: 1 };
    const narration = {
      key: "hi",
      type: "audio",
      description: "Greeting",
      script: "Hola amigos",
      translatedFrom: "Hello friends",
      durationMs: 900,
      wordTimings: [
        { word: "Hola", startMs: 0, endMs: 400 },
        { word: "amigos", startMs: 450, endMs: 850 },
      ],
      usages: [usage],
    };
    const validated = validateManifest(
      { productCode: "words", refNum: 1, assets: { "es-MX": [narration] } },
      { productCode: "words", refNum: 1 },
    );
    expect(validated.assets["es-MX"]![0]).toEqual(narration);
    expect(() =>
      validateManifest(
        {
          productCode: "words",
          refNum: 1,
          assets: {
            "en-US": [{ ...narration, wordTimings: [{ word: "x", startMs: 5, endMs: 5 }] }],
          },
        },
        { productCode: "words", refNum: 1 },
      ),
    ).toThrow(/Word timings/);
  });

  it("keeps a narration's chosen voice and refuses one anywhere else", () => {
    const usage = { sceneId: "intro", sourceKey: "hi", occurrence: 1, sceneOccurrenceCount: 1 };
    const address = { productCode: "words", refNum: 1 };
    const narration = {
      key: "hi",
      type: "audio",
      description: "Greeting",
      script: "Hello",
      voice: "Fenrir",
      usages: [usage],
    };
    const check = (asset: Record<string, unknown>) =>
      validateManifest({ ...address, assets: { "en-US": [asset] } }, address);
    expect(check(narration).assets["en-US"]![0]).toEqual(narration);
    const { voice: _voice, ...plain } = narration;
    expect(check(plain).assets["en-US"]![0]).not.toHaveProperty("voice");
    expect(() =>
      check({ key: "cat", type: "image", description: "A cat", voice: "Kore", usages: [usage] }),
    ).toThrow(/Only a narration may name a voice/);
    expect(() =>
      check({
        key: "song",
        type: "audio",
        description: "Theme",
        kind: "music",
        channel: "music",
        loop: true,
        volume: 0.5,
        voice: "Kore",
        usages: [usage],
      }),
    ).toThrow(/Only a narration may name a voice/);
    for (const voice of ["", "x".repeat(65), "Kore<script>", 5])
      expect(() => check({ ...narration, voice })).toThrow(/Only a narration may name a voice/);
  });

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

  it("writes an author's edited configuration and assessment in place of the generated ones", async () => {
    const a = activity();
    a.draft.mediaPlan = planMedia(a);
    const edited = { P: { telemetry: false, "en-US": { cat: "{{MEDIA}}/images/mine.png" } } };
    const assessment = { items: [{ title: "q", configuration: { order: {} } }] };
    a.draft.moduleDocuments = {
      configuration: { value: edited, basis: null, editedAt: "now" },
      assessment: { value: assessment, basis: null, editedAt: "now" },
    };
    const files = scaffoldModule(a);
    expect(JSON.parse(files["configurations/P-1.json"]!)).toEqual(edited);
    expect(JSON.parse(files["assessments/P-1.json"]!)).toEqual(assessment);
    const read = async (name: string) =>
      files[name.replaceAll("\\", "/").replace(/^module\//, "")]!;
    // The edit is what is checked, not the bindings the plan would have generated.
    await expect(verifyMediaArtifacts("", a, read)).resolves.toBeUndefined();
    files["configurations/P-1.json"] = JSON.stringify({ P: { ...edited.P, rounds: 3 } });
    await expect(verifyMediaArtifacts("", a, read)).resolves.toBeUndefined();
    files["configurations/P-1.json"] = JSON.stringify({ P: { telemetry: false } });
    await expect(verifyMediaArtifacts("", a, read)).rejects.toThrow("edited configuration");
    files["configurations/P-1.json"] = JSON.stringify(edited);
    files["assessments/P-1.json"] = JSON.stringify({ items: [] });
    await expect(verifyMediaArtifacts("", a, read)).rejects.toThrow("edited assessment");
    // Without an edit, no assessment file is written by the scaffold.
    delete a.draft.moduleDocuments;
    expect(scaffoldModule(a)["assessments/P-1.json"]).toBeUndefined();
  });
});

describe("sound fields in the media manifest", () => {
  const address = { productCode: "words", refNum: 1 };
  const usage = { sceneId: "intro", sourceKey: "door", occurrence: 1, sceneOccurrenceCount: 1 };
  const effect = {
    key: "door",
    type: "audio",
    description: "A door",
    script: "a door creaks",
    kind: "sfx",
    channel: "sfx",
    loop: false,
    volume: 1,
    usages: [usage],
  };
  const check = (asset: Record<string, unknown>) =>
    validateManifest({ ...address, assets: { "en-US": [asset] } }, address).assets["en-US"]![0]!;
  const runId = `run_${"a".repeat(32)}`;
  const sha256 = "b".repeat(64);

  it("keeps a requested length on music or an effect, and only there", () => {
    expect(check({ ...effect, targetDurationMs: 3000 }).targetDurationMs).toBe(3000);
    for (const targetDurationMs of [999, 60001, 2.5, "3000"])
      expect(() => check({ ...effect, targetDurationMs })).toThrow(/requested length/);
    const { kind: _k, channel: _c, loop: _l, volume: _v, ...narration } = effect;
    expect(() => check({ ...narration, targetDurationMs: 3000 })).toThrow(/requested length/);
  });

  it("binds an MP3 clip at its own path and a WAV clip as before", () => {
    const mp3 = check({
      ...effect,
      path: `media/generated/${runId}.mp3`,
      generatedAudio: { runId, sha256, format: "mp3" },
    });
    expect(mp3.generatedAudio).toEqual({ runId, sha256, format: "mp3" });
    expect(
      check({ ...effect, path: `media/generated/${runId}.wav`, generatedAudio: { runId, sha256 } })
        .generatedAudio,
    ).toEqual({ runId, sha256 });
    expect(
      check({
        ...effect,
        path: `media/generated/${runId}.wav`,
        generatedAudio: { runId, sha256, format: "wav" },
      }).generatedAudio?.format,
    ).toBe("wav");
    // The path must match the recorded format, and only the two formats exist.
    expect(() =>
      check({
        ...effect,
        path: `media/generated/${runId}.wav`,
        generatedAudio: { runId, sha256, format: "mp3" },
      }),
    ).toThrow(/generated audio/);
    expect(() =>
      check({ ...effect, path: `media/generated/${runId}.mp3`, generatedAudio: { runId, sha256 } }),
    ).toThrow(/generated audio/);
    expect(() =>
      check({
        ...effect,
        path: `media/generated/${runId}.ogg`,
        generatedAudio: { runId, sha256, format: "ogg" },
      }),
    ).toThrow(/generated audio/);
  });

  it("plans a Loom tag's duration as the requested length", () => {
    const value = activity();
    (value.draft.spec!.scenes as { audio?: unknown }[])[0]!.audio = {
      tracks: [
        { key: "voice", description: "Say cat", script: "Cat" },
        {
          key: "door",
          description: "A door",
          script: '<audio kind="sfx" duration="2">creak</audio>',
        },
      ],
    };
    const assets = planMedia(value).manifest.assets["en-US"]!;
    expect(assets.find((asset) => asset.key === "door")?.targetDurationMs).toBe(2000);
    expect(assets.find((asset) => asset.key === "voice")).not.toHaveProperty("targetDurationMs");
  });
});
