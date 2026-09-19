import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import { contentRevision } from "../src/activities/domain.js";
import { IMAGE_MAX_BYTES, readBoundImage } from "../src/activities/image.js";
import { activitySpec } from "./activity-fixtures.js";

const PNG = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
]);

describe("activity image preview binding", () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
  });

  async function wafFixture(relativePath = "media/images/cat.png") {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-waf-image-"));
    roots.push(root);
    await fs.mkdir(path.join(root, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(root, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(root, "modules"));
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), PNG);
    return root;
  }

  function activity(relativePath = "media/images/cat.png"): ActivityDetail {
    const spec = {
      ...activitySpec,
      scenes: [
        {
          id: "intro",
          description: "Look",
          media: { images: [{ key: "cat", description: "A cat" }] },
        },
      ],
    };
    const revision = "draft-revision";
    return {
      id: "activity-1",
      productCode: "sight-words",
      refNum: 1,
      collectionId: "collection-1",
      title: "Sight words",
      activityType: "standard",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
      draft: {
        draftId: "draft-1",
        activityId: "activity-1",
        baseVersionId: null,
        contentRevision: revision,
        status: "valid",
        description: "",
        spec,
        updatedAt: "2026-01-01T00:00:00.000Z",
        mediaPlan: {
          specRevision: contentRevision(spec),
          requirements: { cat: "requirement" },
          manifest: {
            productCode: "sight-words",
            refNum: 1,
            assets: {
              "en-US": [
                {
                  key: "cat",
                  type: "image",
                  description: "A cat",
                  path: relativePath,
                  usages: [],
                },
              ],
            },
          },
        },
      },
    };
  }

  it("reads a bound PNG and identifies its content type", async () => {
    const root = await wafFixture();
    const result = await readBoundImage(activity(), {
      language: "en-US",
      assetKey: "cat",
      expectedRevision: "draft-revision",
      wafRoot: root,
    });
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes).toEqual(PNG);
  });

  it("rejects stale revisions and stale or missing plans", async () => {
    const root = await wafFixture();
    await expect(
      readBoundImage(activity(), {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "stale",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 409, code: "draft_conflict" });

    const stale = activity();
    stale.draft.mediaPlan!.specRevision = "old-spec";
    await expect(
      readBoundImage(stale, {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 409, code: "media_stale" });
  });

  it("rejects unbound, wrong-type, and unsafe saved bindings", async () => {
    const root = await wafFixture();
    const missing = activity();
    missing.draft.mediaPlan!.manifest.assets["en-US"] = [];
    await expect(
      readBoundImage(missing, {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 404, code: "image_unbound" });

    const wrongType = activity();
    wrongType.draft.mediaPlan!.manifest.assets["en-US"]![0]!.type = "audio";
    await expect(
      readBoundImage(wrongType, {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 404, code: "image_unbound" });

    for (const unsafePath of ["media/../secret.png", "media/images/../cat.png"]) {
      const unsafe = activity(unsafePath);
      await expect(
        readBoundImage(unsafe, {
          language: "en-US",
          assetKey: "cat",
          expectedRevision: "draft-revision",
          wafRoot: root,
        }),
      ).rejects.toMatchObject({ status: 400, code: "image_path_invalid" });
    }
  });

  it("rejects symlinked media, directories, oversized files, and non-images", async () => {
    const root = await wafFixture();
    const outside = path.join(root, "outside.png");
    await fs.writeFile(outside, PNG);
    const linked = "media/images/linked.png";
    await fs.symlink(outside, path.join(root, linked));
    await expect(
      readBoundImage(activity(linked), {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 404, code: "image_unavailable" });

    const directory = "media/images/directory.png";
    await fs.mkdir(path.join(root, directory));
    await expect(
      readBoundImage(activity(directory), {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 404, code: "image_unavailable" });

    const oversized = "media/images/large.png";
    await fs.writeFile(
      path.join(root, oversized),
      Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)]),
    );
    await expect(
      readBoundImage(activity(oversized), {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 404, code: "image_unavailable" });

    const text = "media/images/text.png";
    await fs.writeFile(path.join(root, text), "not an image");
    await expect(
      readBoundImage(activity(text), {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 415, code: "image_unsupported" });
  });

  it("rejects a symlink used as the WAF media root", async () => {
    const root = await wafFixture();
    const outside = path.join(root, "outside-media");
    await fs.mkdir(path.join(outside, "images"), { recursive: true });
    await fs.writeFile(path.join(outside, "images", "cat.png"), PNG);
    await fs.rm(path.join(root, "media"), { recursive: true, force: true });
    try {
      await fs.symlink(outside, path.join(root, "media"), "junction");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EACCES") return;
      throw error;
    }
    await expect(
      readBoundImage(activity(), {
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "draft-revision",
        wafRoot: root,
      }),
    ).rejects.toMatchObject({ status: 404, code: "image_unavailable" });
  });
});
