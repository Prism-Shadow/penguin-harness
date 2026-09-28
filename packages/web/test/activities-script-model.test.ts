import { describe, expect, it } from "vitest";
import {
  diffMarkers,
  isSceneHeading,
  mediaTagSpans,
  sceneRanges,
  scenesTouched,
} from "../src/features/activities/script-model";
import { diffLines } from "../src/features/activities/spec-diff";

const SCRIPT = [
  "Description",
  "",
  "usesAssessment=true",
  "An activity about letters.",
  "",
  "Scene 1: Intro",
  "<video>An island.</video>",
  "",
  "## **Scene 2. Getting Started",
  'The narrator says <audio kind="speech" voice="Mia">We go.</audio>',
  "Scene 2a: an aside",
  "Scene 3 – Rocks",
  "<image>Rocks</image>",
  "Activity End",
  "Notes after the end.",
].join("\n");

describe("scene headings", () => {
  it("reads Loom's heading forms and leaves sub-scenes to their parent", () => {
    expect(isSceneHeading("Scene 1: Intro")).toBe(true);
    expect(isSceneHeading("## **Scene 2. Getting Started")).toBe(true);
    expect(isSceneHeading("Scene 3 – Rocks")).toBe(true);
    expect(isSceneHeading("  scene 12 - Last")).toBe(true);
    expect(isSceneHeading("Scene 8a: aside")).toBe(false);
    expect(isSceneHeading("In scene 3 the rocks move")).toBe(false);
  });

  it("ranges each scene up to the next heading or the activity end", () => {
    expect(sceneRanges(SCRIPT)).toEqual([
      { number: 1, title: "Intro", heading: 6, last: 8 },
      { number: 2, title: "Getting Started", heading: 9, last: 11 },
      { number: 3, title: "Rocks", heading: 12, last: 13 },
    ]);
  });

  it("finds no scenes in text without headings", () => {
    expect(sceneRanges("Just a description.\nNo scenes yet.")).toEqual([]);
  });
});

describe("media tags", () => {
  it("marks the four media elements, with or without attributes, and nothing else", () => {
    const line = 'Says <audio kind="speech">Hi</audio> then <b>bold</b> <image/>';
    const spans = mediaTagSpans(line);
    expect(spans.map((span) => [line.slice(span.from, span.to), span.element])).toEqual([
      ['<audio kind="speech">', "audio"],
      ["</audio>", "audio"],
      ["<image/>", "image"],
    ]);
  });

  it("is case-insensitive about element names", () => {
    expect(mediaTagSpans("<Video>x</VIDEO>").map((span) => span.element)).toEqual([
      "video",
      "video",
    ]);
  });
});

describe("changes against a scene layout", () => {
  it("names the scenes whose lines changed, including removed lines", () => {
    const edited = SCRIPT.replace("<image>Rocks</image>", "<image>Big rocks</image>").replace(
      "<video>An island.</video>\n",
      "",
    );
    const rows = diffLines(SCRIPT, edited);
    expect(scenesTouched(rows, sceneRanges(edited))).toEqual([1, 3]);
  });

  it("names nothing when the change is before the first scene", () => {
    const edited = SCRIPT.replace("An activity about letters.", "About letters.");
    expect(scenesTouched(diffLines(SCRIPT, edited), sceneRanges(edited))).toEqual([]);
  });

  it("places minimap markers by line of the edited text, merging adjacent changes", () => {
    const before = "a\nb\nc\nd\ne\nf\ng\nh\ni\nj";
    const after = "a\nB\nC\nd\ne\nf\ng\nh\ni\nJ";
    expect(diffMarkers(diffLines(before, after), 10)).toEqual([
      { line: 2, top: 10, height: 20 },
      { line: 10, top: 90, height: 10 },
    ]);
  });
});
