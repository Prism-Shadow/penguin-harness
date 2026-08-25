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
  it("is a tiny inline PNG data URL, so the probe sends the least it can", () => {
    expect(VISION_PROBE_IMAGE.startsWith("data:image/png;base64,")).toBe(true);
    const b64 = VISION_PROBE_IMAGE.slice("data:image/png;base64,".length);
    const bytes = Buffer.from(b64, "base64");
    // A real PNG signature, and well under 200 bytes.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.length).toBeLessThan(200);
    // Round-trips, i.e. it is valid base64 rather than a truncated paste.
    expect(bytes.toString("base64")).toBe(b64);
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
