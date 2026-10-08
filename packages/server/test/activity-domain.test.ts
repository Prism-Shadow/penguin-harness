import { describe, expect, it } from "vitest";
import { activitySpec } from "./activity-fixtures.js";
import {
  contentRevision,
  DISPLAY_NAME_MAX,
  normalizeDisplayName,
  normalizeProductCode,
  normalizeRefNum,
  validateActivitySpec,
} from "../src/activities/domain.js";

describe("native activity domain", () => {
  it("keeps the Loom activity address safe and typed", () => {
    expect(normalizeProductCode("  sight-words ")).toBe("sight-words");
    expect(normalizeRefNum(0)).toBe(0);
    expect(() => normalizeProductCode("../outside")).toThrow();
    expect(() => normalizeRefNum(-1)).toThrow();
  });

  it("accepts the minimum activity specification contract", () => {
    expect(
      validateActivitySpec({
        id: "sight-words",
        moduleFolder: "waf-module-sight-words",
        title: "Sight words",
        runtime: {
          engine: "html",
          layout: "mainOnly",
          theme: "park",
          resolution: "640x480",
          usesAssessment: false,
        },
        activityDescription: "Practice sight words",
        scenes: [{ id: "intro", description: "Choose a word" }],
      }).title,
    ).toBe("Sight words");
    expect(() => validateActivitySpec({ title: "incomplete" })).toThrow();
  });

  it("accepts an asset that has not been produced yet", () => {
    // Loom writes null for every asset a generation stage has not filled in, which is most
    // of them for most of a project's life. Refusing null refuses the ordinary state of an
    // unfinished activity; measured on the real checkout, it lost two whole specifications.
    const withAssets = (targetPath: unknown) => ({
      ...activitySpec,
      scenes: [
        {
          id: "intro",
          description: "Choose a word",
          media: { images: [{ key: "k", description: "d", targetPath }] },
          audio: { tracks: [{ key: "a", description: "d", targetPath, script: "hello" }] },
        },
      ],
    });
    expect(validateActivitySpec(withAssets(null))).toBeTruthy();
    expect(validateActivitySpec(withAssets(undefined))).toBeTruthy();
    expect(validateActivitySpec(withAssets("images/k.png"))).toBeTruthy();
    expect(() => validateActivitySpec(withAssets(7))).toThrow("targetPath must be a string");
  });

  it("refuses media written straight on a scene, which no plan reads", () => {
    const scene = (extra: Record<string, unknown>) => ({
      ...activitySpec,
      scenes: [{ id: "intro", description: "Choose a word", ...extra }],
    });
    expect(() =>
      validateActivitySpec(scene({ tracks: [{ key: "a", description: "d", script: "hi" }] })),
    ).toThrow("Scene intro: put tracks under audio.tracks.");
    expect(() => validateActivitySpec(scene({ videos: [] }))).toThrow(
      "put videos under media.video",
    );
    expect(() => validateActivitySpec(scene({ images: [] }))).toThrow(
      "put images under media.images",
    );
  });

  it("treats a ref's display name as a label, absent rather than invalid when empty", () => {
    // The product code and ref number stay the address; a ref with no name shows that.
    expect(normalizeDisplayName("  Round one  ")).toBe("Round one");
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName(null)).toBeNull();
    expect(normalizeDisplayName(undefined)).toBeNull();
    expect(() => normalizeDisplayName("a".repeat(DISPLAY_NAME_MAX + 1))).toThrow("characters");
    expect(() => normalizeDisplayName("line\nbreak")).toThrow("control characters");
  });

  it("changes the content revision when draft content changes", () => {
    expect(contentRevision({ description: "a" })).not.toBe(contentRevision({ description: "b" }));
    expect(contentRevision({ spec: { scenes: [{ description: "a" }] } })).not.toBe(
      contentRevision({ spec: { scenes: [{ description: "b" }] } }),
    );
    expect(contentRevision({ spec: { a: 1, b: [2, 3] } })).toBe(
      contentRevision({ spec: { b: [2, 3], a: 1 } }),
    );
    expect(contentRevision({ spec: { b: [2, 3] } })).not.toBe(
      contentRevision({ spec: { b: [3, 2] } }),
    );
  });
});
