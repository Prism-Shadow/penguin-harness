/**
 * The version manifest: which bound files Penguin owns and keeps, which are checkout
 * references it only records, and a hash that follows content and nothing else.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ActivityDraft } from "../src/activities/domain.js";
import type { AssetManifest, MediaAsset } from "../src/activities/media.js";
import {
  manifestBytes,
  manifestHash,
  mediaBytes,
  ownedMediaPaths,
  versionManifest,
} from "../src/activities/version-manifest.js";

const AUDIO_RUN = `run_${"a".repeat(32)}`;
const IMAGE_RUN = `run_${"b".repeat(32)}`;
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function asset(key: string, extra: Partial<MediaAsset>): MediaAsset {
  return { key, type: "image", description: key, usages: [], ...extra } as MediaAsset;
}

function plan(assets: MediaAsset[]): AssetManifest {
  return {
    productCode: "words",
    refNum: 1,
    assets: { "en-US": assets },
  } as unknown as AssetManifest;
}

const bound = plan([
  asset("hello", {
    type: "audio",
    path: `media/generated/${AUDIO_RUN}.wav`,
    generatedAudio: { runId: AUDIO_RUN, sha256: SHA_A },
  }),
  asset("cat", {
    path: `media/generated/${IMAGE_RUN}.png`,
    generatedImage: { runId: IMAGE_RUN, sha256: SHA_B },
  }),
  asset("dog", { path: "media/uploads/dog-0123456789abcdef.png" }),
  // A second asset bound to the same upload is one file.
  asset("puppy", { path: "media/uploads/dog-0123456789abcdef.png" }),
  asset("tree", { path: "media/loom/scene/tree.png" }),
  asset("unbound", {}),
]);

function draft(overrides: Partial<ActivityDraft> = {}): ActivityDraft {
  return {
    draftId: "drf_1",
    activityId: "act_1",
    baseVersionId: null,
    contentRevision: "r",
    status: "valid",
    description: "Practice words",
    spec: { id: "words" },
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  };
}

describe("ownedMediaPaths", () => {
  it("keeps generated media at their workspace paths and uploads at their own", () => {
    expect(ownedMediaPaths(bound)).toEqual({
      owned: [
        { path: `audio/${AUDIO_RUN}.wav`, expectedSha256: SHA_A },
        { path: `images/${IMAGE_RUN}.png`, expectedSha256: SHA_B },
        { path: "media/uploads/dog-0123456789abcdef.png", expectedSha256: null },
      ],
      references: ["media/loom/scene/tree.png"],
    });
  });

  it("has nothing to keep without a media plan", () => {
    expect(ownedMediaPaths(undefined)).toEqual({ owned: [], references: [] });
  });
});

describe("versionManifest", () => {
  const files = [
    { path: "media/uploads/dog-0123456789abcdef.png", sha256: SHA_B, bytes: 30 },
    { path: `audio/${AUDIO_RUN}.wav`, sha256: SHA_A, bytes: 12 },
  ];

  it("holds the draft's content, the features, the files sorted and the references", () => {
    const manifest = versionManifest(
      draft({ mediaPlan: { specRevision: SHA_A, requirements: {}, manifest: bound } }),
      ["feature-one"],
      files,
    );
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.draft.description).toBe("Practice words");
    expect(manifest.draft.mediaPlan?.manifest).toBe(bound);
    expect(manifest.draft).not.toHaveProperty("moduleDocuments");
    expect(manifest.implementationFeatures).toEqual(["feature-one"]);
    expect(manifest.media.map((file) => file.path)).toEqual([
      `audio/${AUDIO_RUN}.wav`,
      "media/uploads/dog-0123456789abcdef.png",
    ]);
    expect(manifest.references).toEqual(["media/loom/scene/tree.png"]);
    expect(mediaBytes(manifest)).toBe(42);
  });

  it("leaves out what is not content: the draft's id, revision, status and time", () => {
    const one = versionManifest(draft(), null, []);
    const other = versionManifest(
      draft({ draftId: "drf_2", contentRevision: "x", status: "draft", updatedAt: "later" }),
      null,
      [],
    );
    expect(manifestHash(one)).toBe(manifestHash(other));
  });

  it("hashes content, whatever order the files came in", () => {
    const a = versionManifest(draft(), null, files);
    const b = versionManifest(draft(), null, [...files].reverse());
    expect(manifestHash(a)).toBe(manifestHash(b));
    expect(manifestHash(versionManifest(draft({ description: "Changed" }), null, files))).not.toBe(
      manifestHash(a),
    );
    expect(manifestHash(versionManifest(draft(), [], files))).not.toBe(manifestHash(a));
    expect(
      manifestHash(versionManifest(draft(), null, [{ ...files[0]!, sha256: SHA_A }, files[1]!])),
    ).not.toBe(manifestHash(a));
  });

  it("stores as canonical JSON whose digest is the manifest's hash", () => {
    const manifest = versionManifest(
      draft({
        moduleDocuments: {
          configuration: { value: { b: 1, a: 2 }, basis: null, editedAt: "now" },
        },
      }),
      null,
      files,
    );
    const bytes = manifestBytes(manifest);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(manifestHash(manifest));
    expect(bytes.toString("utf8")).toContain('"value":{"a":2,"b":1}');
  });
});
