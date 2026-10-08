import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import { planMedia } from "../src/activities/media.js";
import { seedMediaPlaceholders } from "../src/activities/media-placeholder.js";
import { activitySpec } from "./activity-fixtures.js";

const VIDEO = "media/loom/sight/sight-1/videos/english/empty.mp4";
const ANIMATION = "media/loom/sight/sight-1/animations/english/empty.json";

function videoActivity(): ActivityDetail {
  return {
    id: "activity-video",
    collectionId: "collection-video",
    productCode: "sight",
    productId: null,
    displayName: null,
    stable: false,
    refNum: 1,
    title: "Sight words",
    activityType: "standard",
    archived: false,
    tags: [],
    createdAt: "",
    updatedAt: "",
    draft: {
      draftId: "draft-video",
      activityId: "activity-video",
      baseVersionId: null,
      contentRevision: "revision",
      status: "valid",
      description: "",
      spec: {
        ...activitySpec,
        scenes: [
          {
            id: "intro",
            description: "Choose a word",
            media: {
              images: [{ key: "scene-background", description: "A park" }],
              video: [
                { key: "intro-video", description: "A frog jumps" },
                { key: "outro-video", description: "A frog waves" },
              ],
              animations: [{ key: "frog-jump", description: "The frog jumps in place" }],
            },
          },
        ],
      },
      updatedAt: "",
    },
  };
}

describe("media placeholders", () => {
  it("binds videos to Loom's empty.mp4, animations to its empty.json, and leaves images unbound", () => {
    const assets = planMedia(videoActivity()).manifest.assets["en-US"]!;
    const paths = Object.fromEntries(assets.map((asset) => [asset.key, asset.path]));
    expect(paths).toEqual({
      "scene-background": undefined,
      "intro-video": VIDEO,
      "outro-video": VIDEO,
      "frog-jump": ANIMATION,
    });
  });

  it("keeps a video's real binding on a re-plan", () => {
    const activity = videoActivity();
    activity.draft.mediaPlan = planMedia(activity);
    const intro = activity.draft.mediaPlan.manifest.assets["en-US"]!.find(
      (asset) => asset.key === "intro-video",
    )!;
    intro.path = "media/loom/sight/sight-1/uploads/intro.mp4";
    const replanned = planMedia(activity).manifest.assets["en-US"]!;
    expect(replanned.find((asset) => asset.key === "intro-video")!.path).toBe(intro.path);
  });

  it("seeds each placeholder once, without replacing a file already there", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-placeholder-"));
    try {
      const activity = videoActivity();
      const { assets } = planMedia(activity).manifest;
      await seedMediaPlaceholders(root, activity, assets);
      const file = path.join(root, VIDEO);
      const seeded = await fs.readFile(file);
      expect(seeded.subarray(4, 8).toString("ascii")).toBe("ftyp");
      const lottie = JSON.parse(await fs.readFile(path.join(root, ANIMATION), "utf8"));
      expect(lottie.layers.length).toBeGreaterThan(0);

      await fs.writeFile(file, "kept");
      await seedMediaPlaceholders(root, activity, assets);
      expect(await fs.readFile(file, "utf8")).toBe("kept");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
