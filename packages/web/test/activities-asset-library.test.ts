import { describe, expect, it } from "vitest";
import type { AssetManifest, UploadedMedia } from "@prismshadow/penguin-server/api";
import {
  filterPlanned,
  filterUploads,
  plannedEntries,
  uploadEntries,
} from "../src/features/activities/asset-library";

type MediaAsset = AssetManifest["assets"][string][number];
const usage = (sceneId: string) => ({
  sceneId,
  sourceKey: "k",
  occurrence: 1,
  sceneOccurrenceCount: 1,
});
const assets: MediaAsset[] = [
  {
    key: "cat",
    type: "image",
    description: "A cat",
    path: "media/uploads/cat-1.png",
    usages: [usage("intro"), usage("intro")],
  },
  {
    key: "dog",
    type: "image",
    description: "A dog",
    path: "media/uploads/cat-1.png",
    usages: [usage("end")],
  },
  { key: "hello", type: "audio", description: "Greeting", usages: [usage("intro")] },
  {
    key: "say",
    type: "audio",
    description: "Line",
    path: "media/generated/r.wav",
    generatedAudio: { runId: "r" } as never,
    usages: [],
  },
  { key: "old", type: "image", description: "Old", path: "images/old.png", usages: [] },
];
const upload = (path: string, kind: UploadedMedia["kind"]) =>
  ({
    path,
    name: path.split("/").pop(),
    kind,
    mimeType: "",
    byteLength: 1,
    updatedAt: "",
  }) as UploadedMedia;

describe("the asset library", () => {
  it("says where each asset's file came from, and which scenes use it", () => {
    const entries = plannedEntries(assets);
    expect(entries.map((entry) => entry.source)).toEqual([
      "upload",
      "upload",
      null,
      "generated",
      "checkout",
    ]);
    expect(entries[0]!.sceneIds).toEqual(["intro"]);
  });

  it("names the assets each upload is bound to", () => {
    const files = uploadEntries(
      [upload("media/uploads/cat-1.png", "image"), upload("media/uploads/spare.wav", "audio")],
      assets,
    );
    expect(files.map((entry) => entry.usedBy)).toEqual([["cat", "dog"], []]);
    expect(filterUploads(files, "all", "unbound", "").map((e) => e.upload.name)).toEqual([
      "spare.wav",
    ]);
    expect(filterUploads(files, "image", "any", "")).toHaveLength(1);
    expect(filterUploads(files, "all", "any", "dog")).toHaveLength(1);
  });

  it("filters the plan by type, binding and words", () => {
    const entries = plannedEntries(assets);
    expect(filterPlanned(entries, "audio", "any", "").map((e) => e.key)).toEqual(["hello", "say"]);
    expect(filterPlanned(entries, "all", "unbound", "").map((e) => e.key)).toEqual(["hello"]);
    expect(filterPlanned(entries, "all", "bound", "END").map((e) => e.key)).toEqual(["dog"]);
  });
});
