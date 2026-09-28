import { describe, expect, it } from "vitest";
import type { AssetManifest, MediaStat, UploadedMedia } from "@prismshadow/penguin-server/api";
import {
  bitrateKbps,
  detailsFor,
  fileFactsFor,
  formatLength,
  formatName,
} from "../src/features/activities/media-details";
import { fileSizeText } from "../src/features/activities/media-library";

describe("bitrateKbps", () => {
  it("averages the file over its length in kilobits a second", () => {
    expect(bitrateKbps(32000, 2)).toBe(128);
    expect(bitrateKbps(32044, 2)).toBe(128);
    expect(bitrateKbps(1_000_000, 60)).toBe(133);
  });

  it("is null when either value is missing or the length is not positive", () => {
    expect(bitrateKbps(null, 2)).toBeNull();
    expect(bitrateKbps(32000, null)).toBeNull();
    expect(bitrateKbps(undefined, 2)).toBeNull();
    expect(bitrateKbps(32000, 0)).toBeNull();
    expect(bitrateKbps(32000, -1)).toBeNull();
    expect(bitrateKbps(32000, Number.POSITIVE_INFINITY)).toBeNull();
    expect(bitrateKbps(Number.NaN, 2)).toBeNull();
  });
});

describe("formatLength", () => {
  it("writes minutes, seconds and tenths under an hour", () => {
    expect(formatLength(2)).toBe("0:02.0");
    expect(formatLength(0)).toBe("0:00.0");
    expect(formatLength(65.34)).toBe("1:05.3");
    expect(formatLength(59.96)).toBe("1:00.0");
    expect(formatLength(3599.9)).toBe("59:59.9");
  });

  it("adds hours from an hour on", () => {
    expect(formatLength(3600)).toBe("1:00:00.0");
    expect(formatLength(3725.5)).toBe("1:02:05.5");
  });

  it("is empty for a length that is not one", () => {
    expect(formatLength(Number.NaN)).toBe("");
    expect(formatLength(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatLength(-1)).toBe("");
  });
});

describe("formatName", () => {
  it("names the formats Penguin serves", () => {
    expect(formatName("audio/wav")).toBe("wav");
    expect(formatName("audio/x-wav")).toBe("wav");
    expect(formatName("audio/mpeg")).toBe("mp3");
    expect(formatName("audio/ogg")).toBe("ogg");
    expect(formatName("video/mp4")).toBe("mp4");
    expect(formatName("audio/mp4")).toBe("mp4");
    expect(formatName("video/webm")).toBe("webm");
    expect(formatName("Video/WebM; codecs=vp9")).toBe("webm");
  });

  it("calls anything else other", () => {
    expect(formatName("image/png")).toBe("other");
    expect(formatName("application/octet-stream")).toBe("other");
    expect(formatName("")).toBe("other");
  });
});

describe("detailsFor", () => {
  it("fills every value for a known 2 s, 32 000-byte WAV", () => {
    const details = detailsFor({ bytes: 32000, mimeType: "audio/wav" }, { seconds: 2 });
    expect(details).toMatchObject({ format: "wav", bytes: 32000, seconds: 2, kbps: 128 });
    expect(fileSizeText(details.bytes!)).toBe("31 KB");
    expect(formatLength(details.seconds!)).toBe("0:02.0");
  });

  it("is still measuring while the facts load", () => {
    expect(detailsFor(undefined, {})).toEqual({
      format: undefined,
      bytes: undefined,
      seconds: undefined,
      kbps: undefined,
      width: undefined,
      height: undefined,
    });
    // Size known, length not yet: the bitrate waits for it.
    expect(detailsFor({ bytes: 10, mimeType: "audio/wav" }, {}).kbps).toBeUndefined();
  });

  it("says unknown rather than measuring once something cannot be known", () => {
    const missing = detailsFor(null, { seconds: null, width: null, height: null });
    expect(missing).toEqual({
      format: null,
      bytes: null,
      seconds: null,
      kbps: null,
      width: null,
      height: null,
    });
    // A missing file, still being measured: its size is unknown, so is the bitrate.
    expect(detailsFor({ bytes: null, mimeType: "audio/wav" }, {}).kbps).toBeNull();
    // A length the browser could not settle on is not a length.
    expect(detailsFor(null, { seconds: Number.POSITIVE_INFINITY }).seconds).toBeNull();
    expect(detailsFor({ bytes: 5, mimeType: null }, { seconds: 1 }).format).toBeNull();
  });

  it("keeps a video's dimensions, and treats zero as unknown", () => {
    expect(detailsFor(null, { seconds: 1, width: 640, height: 360 })).toMatchObject({
      width: 640,
      height: 360,
    });
    expect(detailsFor(null, { seconds: 1, width: 0, height: 0 })).toMatchObject({
      width: null,
      height: null,
    });
  });
});

describe("fileFactsFor", () => {
  const saved: AssetManifest = {
    productCode: "words",
    refNum: 1,
    assets: {
      "en-US": [
        { key: "hi", type: "audio", description: "", path: "media/audio/hi.wav", usages: [] },
      ],
    },
  } as AssetManifest;
  const stats: MediaStat[] = [
    {
      language: "en-US",
      key: "hi",
      type: "audio",
      bound: true,
      bytes: 32000,
      mimeType: "audio/wav",
    },
  ];
  const upload: UploadedMedia = {
    path: "media/uploads/hi-1.mp3",
    name: "hi.mp3",
    kind: "audio",
    mimeType: "audio/mpeg",
    byteLength: 4096,
    updatedAt: "2026-09-25T00:00:00.000Z",
  };
  const base = { language: "en-US", assetKey: "hi", uploads: [upload], saved };

  it("reads the saved binding's stat", () => {
    expect(fileFactsFor({ ...base, path: "media/audio/hi.wav", stats })).toEqual({
      bytes: 32000,
      mimeType: "audio/wav",
    });
  });

  it("prefers an upload's own listing, saved or not", () => {
    expect(fileFactsFor({ ...base, path: upload.path, stats })).toEqual({
      bytes: 4096,
      mimeType: "audio/mpeg",
    });
  });

  it("is measuring while stats load and unknown when they failed or do not apply", () => {
    expect(fileFactsFor({ ...base, path: "media/audio/hi.wav", stats: undefined })).toBe(undefined);
    expect(fileFactsFor({ ...base, path: "media/audio/hi.wav", stats: null })).toBeNull();
    // Rebound but not saved: the stats describe the old file.
    expect(fileFactsFor({ ...base, path: "media/audio/other.wav", stats })).toBeNull();
    expect(fileFactsFor({ ...base, assetKey: "gone", path: "media/audio/hi.wav", stats })).toBe(
      null,
    );
  });
});
