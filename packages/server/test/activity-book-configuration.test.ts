import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import { planMedia } from "../src/activities/media.js";
import { compileBookConfiguration } from "../src/activities/book-configuration.js";
import { activitySpec } from "./activity-fixtures.js";

function bookActivity(): ActivityDetail {
  const spec = {
    ...activitySpec,
    scenes: [
      {
        id: "scene-1-cover",
        role: "cover",
        description: "Cover",
        media: { images: [{ key: "cover", description: "A blue penguin" }] },
      },
      {
        id: "scene-2-title",
        role: "title",
        description: "Title",
        media: { images: [{ key: "title", description: "A penguin story" }] },
      },
      {
        id: "scene-3-story",
        role: "story",
        description: "Story",
        media: { images: [{ key: "story", description: "A penguin walking home" }] },
        audio: {
          tracks: [
            {
              key: "narration-1",
              description: "Narration",
              script: "The penguin walks home. It waves.",
            },
          ],
        },
      },
    ],
  };
  const activity: ActivityDetail = {
    id: "activity-book",
    collectionId: "collection-book",
    productCode: "penguin-book",
    refNum: 1,
    title: "Penguin book",
    activityType: "book",
    archived: false,
    createdAt: "",
    updatedAt: "",
    draft: {
      draftId: "draft-book",
      activityId: "activity-book",
      baseVersionId: null,
      contentRevision: "revision",
      status: "valid",
      description: "",
      spec,
      updatedAt: "",
    },
  };
  activity.draft.mediaPlan = planMedia(activity);
  return activity;
}

function languageManifest(activity: ActivityDetail) {
  const manifest = structuredClone(activity.draft.mediaPlan!.manifest);
  for (const asset of manifest.assets["en-US"]!) {
    asset.path = `media/${asset.type}/${asset.key}.${asset.type === "audio" ? "mp3" : "png"}`;
    if (asset.type === "image") asset.sourceKey = `${asset.key}-alias`;
  }
  manifest.assets["es-MX"] = manifest.assets["en-US"]!.map((asset) => ({
    ...asset,
    path: `media/es/${asset.key}.${asset.type === "audio" ? "mp3" : "png"}`,
    ...(asset.type === "image"
      ? { description: `ES ${asset.description}` }
      : { script: `ES ${asset.script}` }),
  }));
  manifest.assets["fr-FR"] = manifest.assets["en-US"]!.map((asset) => ({
    ...asset,
    path: `media/fr/${asset.key}.${asset.type === "audio" ? "mp3" : "png"}`,
  }));
  return manifest;
}

describe("book configuration compiler", () => {
  it("includes only a bound ref-level intro video in the book policy", () => {
    const activity = bookActivity();
    const manifest = languageManifest(activity);
    const intro = {
      key: "book-intro-video",
      type: "video" as const,
      description: "Book introduction",
      usages: [],
      path: "media/book-intro.mp4",
    };
    manifest.assets["en-US"]!.push(intro);
    const product = compileBookConfiguration(activity, "readAlong", manifest)[
      activity.productCode
    ] as any;
    expect(product.book).toMatchObject({
      introVideoKey: "book-intro-video",
      introVideoUrl: "{{MEDIA}}/book-intro.mp4",
    });
    delete (intro as { path?: string }).path;
    expect(
      (compileBookConfiguration(activity, "readAlong", manifest)[activity.productCode] as any).book,
    ).not.toHaveProperty("introVideoKey");
  });

  it("resolves renamed asset source aliases and falls back when a follow-up cue is untranslated", () => {
    const activity = bookActivity();
    const manifest = languageManifest(activity);
    const scene = (activity.draft.spec!.scenes as any[])[2];
    scene.audio.tracks.push({
      key: "follow-up",
      description: "Prompt",
      script: "What happens next?",
    });
    manifest.assets["en-US"]!.push({
      key: "follow-up",
      type: "audio",
      description: "Prompt",
      script: "What happens next?",
      path: "media/follow-up.mp3",
      usages: [],
    });
    const cover = manifest.assets["en-US"]!.find((asset) => asset.key === "cover")!;
    cover.key = "renamed-cover";
    cover.sourceKey = "cover";
    cover.description = "Reviewed cover image";
    const product = compileBookConfiguration(activity, "readAlong", manifest)[
      activity.productCode
    ] as any;
    expect(product["en-US"].scenes[0].media.image).toEqual({
      key: "cover",
      alt: "Reviewed cover image",
    });
    expect(product["en-US"].cover).toBe("{{MEDIA}}/image/cover.png");
    expect(product["en-US"].scenes[2].media.audioCues.map((cue: any) => cue.key)).toEqual([
      "narration-1",
      "follow-up",
    ]);
    expect(product["en-US"].scenes[2].media.narration.script).toBe(
      "The penguin walks home. It waves.",
    );
    expect(product["es-MX"]).toEqual(product["en-US"]);
  });

  it("rejects reserved binding keys and punctuation-only reviewed story narration", () => {
    const activity = bookActivity();
    const manifest = languageManifest(activity);
    manifest.assets["en-US"]![0]!.sourceKey = "scenes";
    expect(() => compileBookConfiguration(activity, "readAlong", manifest)).toThrow(
      "reserved scenes",
    );
    delete manifest.assets["en-US"]![0]!.sourceKey;
    manifest.assets["en-US"]!.find((asset) => asset.type === "audio")!.script = "...";
    expect(() => compileBookConfiguration(activity, "readAlong", manifest)).toThrow(
      "visible words",
    );
  });

  it("emits ordered cover/title/story scenes with derived page numbers and aliases", () => {
    const activity = bookActivity();
    const manifest = languageManifest(activity);
    const before = structuredClone(manifest);
    const result = compileBookConfiguration(activity, "readAlong", manifest);
    const product = result[activity.productCode] as Record<string, any>;
    expect(product.book.mode).toBe("readAlong");
    expect(product["en-US"].scenes.map((scene: any) => [scene.role, scene.pageNumber])).toEqual([
      ["cover", null],
      ["title", null],
      ["story", 1],
    ]);
    expect(product["en-US"].scenes[0].media.image).toMatchObject({
      key: "cover",
      alt: "A blue penguin",
    });
    expect(product["en-US"].scenes[2].media.narration).toMatchObject({
      key: "narration-1",
      script: "The penguin walks home. It waves.",
    });
    expect(product["en-US"].scenes[2].media.narration.words).toEqual([]);
    expect(product["en-US"].scenes[0].media.image.key).toBe("cover");
    expect(manifest).toEqual(before);
  });

  it("uses complete localized image and narration assets, then falls back as a whole locale", () => {
    const activity = bookActivity();
    const manifest = languageManifest(activity);
    manifest.assets["fr-FR"] = manifest.assets["fr-FR"]!.filter((asset) => asset.type !== "audio");
    const result = compileBookConfiguration(activity, "readAlong", manifest);
    const product = result[activity.productCode] as Record<string, any>;
    expect(product["es-MX"].scenes[0].media.image.alt).toBe("ES A blue penguin");
    expect(product["es-MX"].scenes[2].media.narration.script).toBe(
      "ES The penguin walks home. It waves.",
    );
    expect(product["fr-FR"].scenes).toEqual(product["en-US"].scenes);
    expect(product["fr-FR"].cover).toBe(product["en-US"].cover);
    expect(product["fr-FR"]["narration-1"]).toBe(product["en-US"]["narration-1"]);
  });

  it("keeps readAlong narration optional but requires final story narration in decodable mode", () => {
    const activity = bookActivity();
    const manifest = languageManifest(activity);
    const withoutNarration = structuredClone(manifest);
    withoutNarration.assets["en-US"] = withoutNarration.assets["en-US"]!.filter(
      (asset) => asset.type !== "audio",
    );
    expect(() => compileBookConfiguration(activity, "readAlong", withoutNarration)).not.toThrow();
    expect(() => compileBookConfiguration(activity, "decodable", withoutNarration)).toThrow();
  });
});
