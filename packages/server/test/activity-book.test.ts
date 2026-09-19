import { describe, expect, it } from "vitest";
import { validateActivitySpec } from "../src/activities/domain.js";
import { validateBookSpec } from "../src/activities/book.js";

const runtime = {
  engine: "html",
  layout: "mainOnly",
  theme: "park",
  resolution: "640x480",
  usesAssessment: false,
};

function page(
  id: string,
  description: string,
  role?: string,
  imageKey = `${id}-image`,
  audio: unknown[] = [{ key: `${id}-audio`, script: "A child reads." }],
) {
  const tracks = audio.map((track) => ({
    ...(track as Record<string, unknown>),
    description: (track as Record<string, unknown>).description ?? "Narration.",
  }));
  return {
    id,
    description,
    ...(role ? { role } : {}),
    media: {
      images: [{ key: imageKey, description: "A clear illustrated scene." }],
      video: [],
      animations: [],
    },
    audio: { tracks },
  };
}

function spec(scenes: unknown[], key: "scenes" | "stages" = "scenes") {
  return validateActivitySpec({
    id: "storybook",
    moduleFolder: "waf-module-storybook",
    title: "Storybook",
    runtime,
    activityDescription: "Read a short story.",
    [key]: scenes,
  });
}

describe("book activity contract", () => {
  it("accepts explicit cover/title/story roles and the stages alias", () => {
    const value = spec(
      [
        page("cover", "Cover page", "cover", "image-cover"),
        page("title", "Title page", "title", "image-title"),
        page("story-1", "Story page", "story"),
      ],
      "stages",
    );
    expect(() => validateBookSpec(value)).not.toThrow();
  });

  it("infers roles from headings, ids, and legacy image keys without mutating", () => {
    const value = spec([
      page("opaque-cover", "A visual opening", undefined, "cover-image"),
      // The visible-word rule applies only to story narration. This cue makes a
      // mistaken title-as-story classification observable at the boundary.
      page("opaque-title", "A title card", undefined, "title-image", [
        { key: "title-cue", script: "..." },
      ]),
      page("scene-3-story", "Scene 3: Story page 1"),
    ]);
    const before = structuredClone(value);
    expect(() => validateBookSpec(value)).not.toThrow();
    expect(value).toEqual(before);
  });

  it.each([
    ["duplicate scene ids", [page("same", "Story"), page("same", "Story")]],
    ["cover after story", [page("story", "Story"), page("cover", "Cover page", "cover")]],
    ["title after story", [page("story", "Story"), page("title", "Title page", "title")]],
    [
      "title after a storyless cover gap",
      [
        page("cover", "Cover page", "cover"),
        page("story", "Story"),
        page("title", "Title page", "title"),
      ],
    ],
    ["unsupported role", [page("story", "Story", "chapter")]],
  ])("rejects malformed structure: %s", (_label, scenes) => {
    expect(() => validateBookSpec(spec(scenes))).toThrow();
  });

  it.each([
    [
      "missing image",
      {
        ...page("story", "Story", "story", "", []),
        media: { images: [], video: [], animations: [] },
      },
    ],
    [
      "two images",
      {
        ...page("story", "Story", "story"),
        media: {
          images: [
            { key: "a", description: "A" },
            { key: "b", description: "B" },
          ],
          video: [],
          animations: [],
        },
      },
    ],
    [
      "empty image description",
      {
        ...page("story", "Story", "story"),
        media: { images: [{ key: "a", description: "   " }], video: [], animations: [] },
      },
    ],
    [
      "scene video",
      {
        ...page("story", "Story", "story"),
        media: {
          images: [{ key: "a", description: "A" }],
          video: [{ key: "v", description: "V" }],
          animations: [],
        },
      },
    ],
    [
      "scene animation",
      {
        ...page("story", "Story", "story"),
        media: {
          images: [{ key: "a", description: "A" }],
          video: [],
          animations: [{ key: "a", description: "A" }],
        },
      },
    ],
  ])("rejects malformed media: %s", (_label, scene) => {
    expect(() => validateBookSpec(spec([scene]))).toThrow();
  });

  it("lets explicit roles override headings and recovers title after an image-recovered cover", () => {
    expect(() =>
      validateBookSpec(
        spec([
          page("first", "Story page", "cover", "ordinary-image"),
          page("second", "Story page", undefined, "ordinary-title"),
          page("third", "Story page", "story"),
        ]),
      ),
    ).not.toThrow();
    expect(() =>
      validateBookSpec(
        spec([
          page("opaque-first", "Story page", undefined, "cover-image"),
          page("opaque-second", "Story page", undefined, "title-image"),
          page("opaque-third", "Story page", "story"),
        ]),
      ),
    ).not.toThrow();
  });

  it("requires unique nonempty audio keys and visible words in the first story cue", () => {
    expect(() =>
      validateBookSpec(
        spec([page("story", "Story", "story", "image", [{ key: "", script: "Words" }])]),
      ),
    ).toThrow();
    expect(() =>
      validateBookSpec(
        spec([
          page("one", "Story", "story", "one", [{ key: "same", script: "Words" }]),
          page("two", "Story", "story", "two", [{ key: "same", script: "Words" }]),
        ]),
      ),
    ).toThrow();
    expect(() =>
      validateBookSpec(
        spec([page("story", "Story", "story", "image", [{ key: "cue", script: "... — !!!" }])]),
      ),
    ).toThrow();
    expect(() =>
      validateBookSpec(
        spec([
          page("story", "Story", "story", "image", [{ key: "cue", script: "Read the page." }]),
        ]),
      ),
    ).not.toThrow();
  });
});
