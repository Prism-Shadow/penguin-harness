import { describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import { contentRevision } from "../src/activities/domain.js";
import {
  mediaTextPrompt,
  mediaTextTarget,
  parseMediaTextCandidate,
} from "../src/activities/media-text.js";
import { planMedia } from "../src/activities/media.js";
import { activitySpec } from "./activity-fixtures.js";

function activity(): ActivityDetail {
  const spec = {
    ...activitySpec,
    scenes: [
      {
        id: "intro",
        description: "Look",
        media: { images: [{ key: "cover", description: "A blue penguin" }] },
        audio: { tracks: [{ key: "voice", description: "Say it", script: "Penguin" }] },
      },
    ],
  };
  const draft: ActivityDraft = {
    draftId: "draft-1",
    activityId: "activity-1",
    baseVersionId: null,
    contentRevision: "",
    status: "valid" as const,
    description: "",
    spec,
    updatedAt: "",
  };
  draft.mediaPlan = planMedia({
    id: "activity-1",
    collectionId: "collection-1",
    productCode: "p",
    refNum: 1,
    title: "Words",
    activityType: "standard",
    archived: false,
    createdAt: "",
    updatedAt: "",
    draft: { ...draft, contentRevision: contentRevision(spec) },
  });
  draft.contentRevision = contentRevision({
    description: draft.description,
    spec: draft.spec,
    mediaPlan: draft.mediaPlan,
  });
  return {
    id: "activity-1",
    collectionId: "collection-1",
    productCode: "p",
    refNum: 1,
    title: "Words",
    activityType: "standard",
    archived: false,
    createdAt: "",
    updatedAt: "",
    draft,
  };
}

describe("activity media text candidates", () => {
  it("targets the selected image or audio source text without needing a provider credential", () => {
    const a = activity();
    expect(mediaTextTarget(a, { language: "en-US", assetKey: "cover" })).toEqual({
      language: "en-US",
      assetKey: "cover",
      type: "image",
      text: "A blue penguin",
    });
    expect(mediaTextTarget(a, { language: "en-US", assetKey: "voice" })).toEqual({
      language: "en-US",
      assetKey: "voice",
      type: "audio",
      text: "Penguin",
    });
    expect(mediaTextPrompt(mediaTextTarget(a, { language: "en-US", assetKey: "cover" }))).toContain(
      "Improve only the selected image prompt",
    );
  });

  it.each([
    ["unknown asset", { language: "en-US", assetKey: "missing" }, 422],
    ["bad language", { language: "fr-FR", assetKey: "cover" }, 422],
  ])("rejects %s", (_label, input, status) => {
    expect(() => mediaTextTarget(activity(), input)).toThrowError(
      expect.objectContaining({ status }),
    );
  });

  it("rejects a stale media plan before generation", () => {
    const a = activity();
    a.draft.mediaPlan!.specRevision = "stale";
    expect(() => mediaTextTarget(a, { language: "en-US", assetKey: "cover" })).toThrowError(
      expect.objectContaining({ status: 409, code: "media_stale" }),
    );
  });

  it("accepts only an exact target identity and bounded replacement text", () => {
    const target = mediaTextTarget(activity(), { language: "en-US", assetKey: "cover" });
    expect(
      parseMediaTextCandidate(JSON.stringify({ ...target, text: "A bright blue penguin" }), target),
    ).toBe("A bright blue penguin");
    for (const value of [
      { ...target, text: "   " },
      { ...target, text: "x".repeat(5001) },
      { ...target, text: "new", extra: true },
      { ...target, assetKey: "voice", text: "new" },
      { ...target, type: "audio", text: "new" },
      "not json",
    ]) {
      expect(() =>
        parseMediaTextCandidate(typeof value === "string" ? value : JSON.stringify(value), target),
      ).toThrow();
    }
  });
});
