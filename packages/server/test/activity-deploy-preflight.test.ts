/**
 * The check of exported activity data before anything is published, answered from a map of
 * the clone's files: nothing is read from disk.
 */
import { describe, expect, it } from "vitest";
import { exportFiles } from "../src/activities/deploy-export.js";
import { mediaReferences, runPreflight } from "../src/activities/deploy-preflight.js";

const files = exportFiles({
  productCode: "words",
  title: "Words",
  layout: "mainOnly",
  theme: null,
  moduleFolder: "waf-module-words",
  version: "2.0.0",
  mediaBase: "/media/",
  refs: [
    {
      refNum: 1,
      displayName: null,
      configuration: { words: { "en-US": { pic: "{{MEDIA}}/loom/words/pic.png" } } },
      assessment: {
        configuration: { maxItems: 1 },
        items: [{ title: "q", prompt: "/media/loom/words/q.mp3" }],
      },
      usesAssessment: true,
      assets: [{ key: "hello", type: "audio", path: "media/loom/words/hello.mp3" }],
    },
  ],
});

function reader(overrides: Record<string, string | null> = {}) {
  const map = new Map<string, string | null>(files.map((file) => [file.path, file.content]));
  for (const [key, value] of Object.entries(overrides)) map.set(key, value);
  return async (relative: string) => map.get(relative) ?? null;
}

const base = { productCode: "words", expectedModule: "words@^2.0.0", mediaBase: "/media/" };

describe("deploy preflight", () => {
  it("passes exported data and lists the media it names", async () => {
    const report = await runPreflight({ ...base, read: reader() });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.counts).toEqual({ templates: 1, configurations: 1, assessments: 1, media: 3 });
    expect(report.media).toEqual([
      "media/loom/words/hello.mp3",
      "media/loom/words/pic.png",
      "media/loom/words/q.mp3",
    ]);
  });

  it("fails a template pinned to another module, a missing deploy list and a missing configuration", async () => {
    const report = await runPreflight({
      ...base,
      expectedModule: "words@^2.1.0",
      read: reader({
        "deployLists/loom-words.txt": null,
        "data/configurations/loom/words-1.json": null,
      }),
    });
    expect(report.errors).toEqual([
      { code: "file_missing", file: "deployLists/loom-words.txt" },
      { code: "layout_module_mismatch", expected: "words@^2.1.0", found: "words@^2.0.0" },
      { code: "file_missing", file: "data/configurations/loom/words-1.json" },
    ]);
  });

  it("fails a deploy list naming something else, JSON that does not parse, and an empty or miscounted assessment", async () => {
    const report = await runPreflight({
      ...base,
      read: reader({
        "deployLists/loom-words.txt": "data/templates/loom/other.json\n",
        "data/configurations/loom/words-1.json": "{ not json",
        "data/assessments/loom/words-1.json": JSON.stringify({ items: [] }),
      }),
    });
    expect(report.errors).toEqual([
      { code: "deploy_list_mismatch", file: "deployLists/loom-words.txt" },
      { code: "file_invalid", file: "data/configurations/loom/words-1.json" },
      { code: "assessment_empty", file: "data/assessments/loom/words-1.json" },
    ]);
    const counted = await runPreflight({
      ...base,
      read: reader({
        "data/assessments/loom/words-1.json": JSON.stringify({
          configuration: { maxItems: 3 },
          items: [{}, {}],
        }),
      }),
    });
    expect(counted.errors).toEqual([
      {
        code: "assessment_count_mismatch",
        file: "data/assessments/loom/words-1.json",
        items: 2,
        maxItems: 3,
      },
    ]);
  });

  it("fails media that leaves the media folder, still points at a preview, or keeps the token", async () => {
    const configuration = {
      words: {
        "en-US": {
          a: "/media/../secrets.txt",
          b: "/api/projects/p/activities/a/sandbox/media/loom/x.mp3",
          c: "{{MEDIA}}/loom/y.mp3",
        },
      },
    };
    const report = await runPreflight({
      ...base,
      read: reader({ "data/configurations/loom/words-1.json": JSON.stringify(configuration) }),
    });
    const file = "data/configurations/loom/words-1.json";
    expect(report.errors).toEqual([
      { code: "media_path_unsafe", file, reference: "/media/../secrets.txt" },
      {
        code: "media_preview_url",
        file,
        reference: "/api/projects/p/activities/a/sandbox/media/loom/x.mp3",
      },
      { code: "media_token_left", file, reference: "{{MEDIA}}/loom/y.mp3" },
    ]);
    expect(report.warnings).toEqual([{ code: "configuration_without_media", file }]);
  });

  it("reads references against the media address, less a query", () => {
    expect(mediaReferences({ a: "{{MEDIA}}/loom/a.mp3?v=3" }, "{{MEDIA}}/")).toEqual([
      { kind: "media", path: "media/loom/a.mp3", reference: "{{MEDIA}}/loom/a.mp3?v=3" },
    ]);
    expect(
      mediaReferences(["https://cdn.example.org/m/b.png"], "https://cdn.example.org/m/"),
    ).toEqual([
      { kind: "media", path: "media/b.png", reference: "https://cdn.example.org/m/b.png" },
    ]);
    expect(mediaReferences({ n: 3, s: "plain text" }, "/media/")).toEqual([]);
  });
});
