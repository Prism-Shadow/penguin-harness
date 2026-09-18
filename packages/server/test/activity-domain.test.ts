import { describe, expect, it } from "vitest";
import {
  contentRevision,
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
