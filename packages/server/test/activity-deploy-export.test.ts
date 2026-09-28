/**
 * The activity data a QA deploy writes, worked out from the refs of a product: the template
 * (pinned to the released module, one source per ref that is not archived), each ref's
 * configuration with its media pointed at the media address, the assessment of a ref that
 * uses one, and the deploy list. Pure: nothing is read or written.
 */
import { describe, expect, it } from "vitest";
import {
  ExportLayoutError,
  activityTemplate,
  configurationWithMediaUrls,
  exportFiles,
  mainModule,
  manifestAssetList,
  modulePublishedName,
  navbarTheme,
  type ExportInput,
} from "../src/activities/deploy-export.js";

const assets = manifestAssetList({
  assets: {
    "en-US": [
      { key: "intro", type: "audio", path: "media/loom/rwords/rwords-0/intro.mp3" },
      {
        key: "introVo",
        sourceKey: "intro_vo",
        type: "audio",
        path: "media/loom/rwords/rwords-0/intro-vo.mp3",
      },
      { key: "cover", type: "video", role: "bookIntro", path: "media/loom/rwords/cover.mp4" },
      { key: "unbound", type: "image" },
    ],
    "es-US": [{ key: "intro", type: "audio", path: "media/loom/rwords/rwords-0/es/intro.mp3" }],
  },
});

function input(overrides: Partial<ExportInput> = {}): ExportInput {
  return {
    productCode: "rwords",
    title: "Rhyming words",
    layout: "mainOnly",
    theme: null,
    moduleFolder: "waf-module-RWords",
    version: "1.5.0",
    mediaBase: "/media/",
    refs: [
      {
        refNum: 0,
        displayName: "Level A",
        configuration: { rwords: { telemetry: false, "en-US": { title: "Hi" } } },
        assessment: { items: [{ title: "q1" }] },
        usesAssessment: true,
        assets,
      },
      {
        refNum: 1,
        displayName: null,
        configuration: { rwords: { telemetry: false } },
        assessment: null,
        usesAssessment: false,
        assets: [],
        archived: true,
      },
    ],
    ...overrides,
  };
}

describe("deploy export", () => {
  it("names the module and themes the navigation bar by the product code", () => {
    expect(modulePublishedName("waf-module-RWords")).toBe("rwords");
    expect(mainModule("waf-module-RWords", "1.5.0")).toBe("rwords@^1.5.0");
    expect(navbarTheme("rwords")).toBe("blue");
    expect(navbarTheme("mcount")).toBe("green");
    expect(navbarTheme("words")).toBe("park");
  });

  it("writes the template as the activity-data repository expects it", () => {
    expect(activityTemplate(input())).toEqual({
      id: "rwords",
      title: "Rhyming words",
      description: "Rhyming words",
      configuration: {},
      sources: [
        {
          description: "Level A",
          configurations: ["loom/rwords-0.json"],
          refNums: [0],
          assessment: "loom/rwords-0.json",
        },
      ],
      layout: {
        name: "mainOnly",
        compartments: {
          main: { module: "rwords@^1.5.0", theme: "park" },
          navBar: { module: "navbar@^3.0.0", theme: "blue" },
        },
      },
    });
  });

  it("uses the specification's theme, names a ref without a name by its number, and refuses other layouts", () => {
    const template = activityTemplate(
      input({
        theme: "space",
        layout: null,
        refs: [{ ...input().refs[0]!, displayName: " ", usesAssessment: false }],
      }),
    );
    expect(template.layout.compartments.main.theme).toBe("space");
    expect(template.sources).toEqual([
      { description: "Ref 0", configurations: ["loom/rwords-0.json"], refNums: [0] },
    ]);
    expect(() => activityTemplate(input({ layout: "mainWithSidebar" }))).toThrow(ExportLayoutError);
  });

  it("points every bound media file at the media address, under both keys of a renamed asset", () => {
    const configuration = configurationWithMediaUrls(
      { rwords: { telemetry: false, "en-US": { title: "Hi", old: "{{MEDIA}}/loom/old.mp3" } } },
      assets,
      "rwords",
      "/media/",
    );
    expect(configuration).toEqual({
      rwords: {
        telemetry: false,
        "en-US": {
          title: "Hi",
          old: "/media/loom/old.mp3",
          intro: "/media/loom/rwords/rwords-0/intro.mp3",
          introVo: "/media/loom/rwords/rwords-0/intro-vo.mp3",
          intro_vo: "/media/loom/rwords/rwords-0/intro-vo.mp3",
        },
        "es-US": { intro: "/media/loom/rwords/rwords-0/es/intro.mp3" },
      },
    });
    // The framework's token can be kept for the framework to replace.
    const kept = configurationWithMediaUrls({}, assets, "rwords", "{{MEDIA}}/");
    expect((kept["en-US"] as Record<string, string>).intro).toBe(
      "{{MEDIA}}/loom/rwords/rwords-0/intro.mp3",
    );
    // An address on another host is joined the same way.
    const cdn = configurationWithMediaUrls({}, assets, "rwords", "https://cdn.example.org/m/");
    expect((cdn["en-US"] as Record<string, string>).intro).toBe(
      "https://cdn.example.org/m/loom/rwords/rwords-0/intro.mp3",
    );
  });

  it("writes one configuration, the assessment, the template and the deploy list, leaving archived refs out", () => {
    const files = exportFiles(input());
    expect(files.map((file) => file.path)).toEqual([
      "data/configurations/loom/rwords-0.json",
      "data/assessments/loom/rwords-0.json",
      "data/templates/loom/rwords.json",
      "deployLists/loom-rwords.txt",
    ]);
    expect(files[3]!.content).toBe("data/templates/loom/rwords.json\n");
    expect(JSON.parse(files[1]!.content)).toEqual({ items: [{ title: "q1" }] });
    expect(JSON.parse(files[2]!.content)).toEqual(activityTemplate(input()));
    // The file is the configuration the export was handed: an author's edit when there is one.
    expect(JSON.parse(files[0]!.content).rwords["en-US"].title).toBe("Hi");
    for (const file of files) expect(file.content.endsWith("\n")).toBe(true);
  });

  it("names a missing assessment in the template so the check reports it, and skips a missing configuration", () => {
    const files = exportFiles(
      input({
        refs: [{ ...input().refs[0]!, configuration: null, assessment: null }],
      }),
    );
    expect(files.map((file) => file.path)).toEqual([
      "data/templates/loom/rwords.json",
      "deployLists/loom-rwords.txt",
    ]);
    expect(JSON.parse(files[0]!.content).sources[0].assessment).toBe("loom/rwords-0.json");
  });
});
