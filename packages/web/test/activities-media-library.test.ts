import { describe, expect, it } from "vitest";
import type { UploadedMedia } from "@prismshadow/penguin-server/api";
import {
  UPLOAD_ACCEPT,
  boundUpload,
  fileSizeText,
  isUploadPath,
  libraryMatches,
  uploadKindFor,
} from "../src/features/activities/media-library";

function entry(over: Partial<UploadedMedia> & Pick<UploadedMedia, "name" | "kind">): UploadedMedia {
  return {
    path: `media/uploads/${over.name}`,
    mimeType: "image/png",
    byteLength: 1024,
    sha256: "a".repeat(64),
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...over,
  } as UploadedMedia;
}

const media: UploadedMedia[] = [
  entry({ name: "cat-1111aaaa.png", kind: "image", updatedAt: "2026-09-20T10:00:00.000Z" }),
  entry({ name: "dog-2222bbbb.png", kind: "image", updatedAt: "2026-09-21T10:00:00.000Z" }),
  entry({ name: "bell-3333cccc.wav", kind: "audio", updatedAt: "2026-09-19T10:00:00.000Z" }),
  entry({ name: "clip-4444dddd.mp4", kind: "video", updatedAt: "2026-09-18T10:00:00.000Z" }),
];

describe("upload kinds", () => {
  it("authors an animation as a video, and keeps every other kind apart", () => {
    expect(uploadKindFor("image")).toBe("image");
    expect(uploadKindFor("audio")).toBe("audio");
    expect(uploadKindFor("video")).toBe("video");
    expect(uploadKindFor("animation")).toBe("video");
  });

  it("offers the picker only the formats the server accepts", () => {
    expect(UPLOAD_ACCEPT.image).toContain("image/png");
    expect(UPLOAD_ACCEPT.image).not.toContain("svg");
    expect(UPLOAD_ACCEPT.audio).toContain("audio/wav");
    expect(UPLOAD_ACCEPT.video).toContain("video/mp4");
  });
});

describe("library matching", () => {
  it("shows only the uploads a scene asset can be bound to, newest first", () => {
    expect(libraryMatches(media, "image", "").map((entry) => entry.name)).toEqual([
      "dog-2222bbbb.png",
      "cat-1111aaaa.png",
    ]);
    expect(libraryMatches(media, "audio", "").map((entry) => entry.name)).toEqual([
      "bell-3333cccc.wav",
    ]);
  });

  it("draws an animation from the video uploads", () => {
    expect(libraryMatches(media, "animation", "").map((entry) => entry.name)).toEqual([
      "clip-4444dddd.mp4",
    ]);
  });

  it("searches by name, ignoring case and surrounding space", () => {
    expect(libraryMatches(media, "image", "  CAT ").map((entry) => entry.name)).toEqual([
      "cat-1111aaaa.png",
    ]);
    expect(libraryMatches(media, "image", "zebra")).toEqual([]);
  });
});

describe("binding provenance", () => {
  it("recognises a binding served from the activity workspace", () => {
    expect(isUploadPath("media/uploads/cat-1111aaaa.png")).toBe(true);
    expect(isUploadPath("media/images/cat.png")).toBe(false);
    expect(isUploadPath(undefined)).toBe(false);
  });

  it("finds the upload a binding points at", () => {
    expect(boundUpload(media, "media/uploads/cat-1111aaaa.png")?.kind).toBe("image");
    expect(boundUpload(media, "media/images/cat.png")).toBeUndefined();
    expect(boundUpload(media, undefined)).toBeUndefined();
  });
});

describe("file sizes", () => {
  it("reads at a glance", () => {
    expect(fileSizeText(512)).toBe("512 B");
    expect(fileSizeText(1024)).toBe("1.0 KB");
    expect(fileSizeText(1536)).toBe("1.5 KB");
    expect(fileSizeText(20 * 1024)).toBe("20 KB");
    expect(fileSizeText(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(fileSizeText(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("says nothing rather than something wrong", () => {
    expect(fileSizeText(-1)).toBe("");
    expect(fileSizeText(Number.NaN)).toBe("");
  });
});
