/**
 * Vision probe classification: the three-valued verdict that decides whether the models
 * dialog turns "supports vision" on, off, or leaves it alone.
 *
 * The distinction under test is the whole point of the feature: a model that ANSWERS "I
 * cannot take images" has told us something definitive (switch it off), while a probe that
 * failed on auth or the network has told us nothing (leave the user's setting untouched).
 * Getting that backwards would silently disable vision on a working model.
 */
import { describe, expect, it } from "vitest";
import { crc32, inflateSync } from "node:zlib";
import type { LLMOutcome } from "@prismshadow/penguin-core";
import {
  VISION_PROBE_IMAGE,
  VISION_PROBE_MAX_TOKENS,
  classifyVisionProbe,
  classifyVisionProbeError,
  isImageRejection,
} from "../src/services/vision-detect.js";

const failed = (errorMessage: string): LLMOutcome => ({ status: "fatal", errorMessage });

describe("VISION_PROBE_IMAGE", () => {
  const bytes = Buffer.from(VISION_PROBE_IMAGE.slice("data:image/png;base64,".length), "base64");

  it("is a tiny inline PNG data URL, so the probe sends the least it can", () => {
    expect(VISION_PROBE_IMAGE.startsWith("data:image/png;base64,")).toBe(true);
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeLessThan(200);
  });

  it("decodes: every chunk's CRC holds and the IDAT inflates to the pixel bytes the IHDR declares", () => {
    // A strict decoder (LiteLLM and the gateways built on it) answers a short image with a 400
    // "unsupported image", which isImageRejection reads as the model refusing images.
    const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
    expect(bytes.readUInt32BE(16)).toBe(1);
    expect(bytes.readUInt32BE(20)).toBe(1);
    const colorType = bytes[25]!;
    expect(channels[colorType]).toBeDefined();
    let inflated = Buffer.alloc(0);
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      expect(crc32(Buffer.concat([Buffer.from(type, "ascii"), data]))).toBe(
        bytes.readUInt32BE(offset + 8 + length),
      );
      if (type === "IDAT") inflated = Buffer.concat([inflated, inflateSync(data)]);
      offset += 12 + length;
    }
    expect(inflated.length).toBe(1 + channels[colorType]!);
  });

  it("caps the probe's output so a success cannot run up a bill", () => {
    expect(VISION_PROBE_MAX_TOKENS).toBeLessThanOrEqual(16);
  });
});

describe("classifyVisionProbe", () => {
  it("treats a completed answer as vision support", () => {
    expect(classifyVisionProbe({ status: "completed" }, false)).toBe("supported");
  });

  it("treats streamed content as support even if the run then trips its tiny cap", () => {
    // Same allowance the connectivity probe makes: the image was plainly accepted, which
    // is the only question being asked.
    expect(classifyVisionProbe(failed("max tokens reached"), true)).toBe("supported");
  });

  it("reads an image-specific rejection as a definitive no", () => {
    for (const msg of [
      "Invalid content type 'image_url' for this model",
      "This model does not support image input",
      "400 Bad Request: unsupported image content",
      "The selected model has no vision capability",
      "modality not supported: image",
    ]) {
      expect(classifyVisionProbe(failed(msg), false)).toBe("unsupported");
    }
  });

  it("does NOT read an unrelated failure as a no — the setting must survive it", () => {
    for (const msg of [
      "401 Unauthorized: invalid api key",
      "fetch failed: ECONNREFUSED",
      "request timed out",
      "429 rate limit exceeded",
      "Invalid request: missing parameter 'model'",
      "500 Internal Server Error",
    ]) {
      expect(classifyVisionProbe(failed(msg), false)).toBe("failed");
    }
  });
});

describe("classifyVisionProbeError (the SDK can throw before streaming)", () => {
  it("keeps the same split for thrown errors", () => {
    expect(classifyVisionProbeError(new Error("image_url is not supported"))).toBe("unsupported");
    expect(classifyVisionProbeError(new Error("OPENAI_API_KEY is not set"))).toBe("failed");
    expect(classifyVisionProbeError("some string failure")).toBe("failed");
  });
});

describe("isImageRejection", () => {
  it("matches case-insensitively", () => {
    expect(isImageRejection("UNSUPPORTED IMAGE")).toBe(true);
    expect(isImageRejection("Vision")).toBe(true);
  });

  it("never fires on a bare validation error with no image concept in it", () => {
    // The asymmetry that matters: a false positive switches vision off on a working model.
    expect(isImageRejection("invalid request")).toBe(false);
    expect(isImageRejection("bad request")).toBe(false);
    expect(isImageRejection("unauthorized")).toBe(false);
  });
});
