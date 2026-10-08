import { describe, expect, it } from "vitest";
import { stepSpan } from "../src/features/activities/pipeline-panel";
import { runPanel } from "../src/features/activities/studio-status";
import {
  mediaElementSpans,
  sceneHeadingPrefix,
  sceneRanges,
} from "../src/features/activities/script-model";
import {
  buildStudioTree,
  scriptSceneFor,
  sectionTrails,
} from "../src/features/activities/studio-tree";
import { workspaceSections } from "../src/features/activities/workspace-model";

describe("stage times", () => {
  const runs = new Map([
    [
      "a",
      {
        status: "succeeded",
        createdAt: "2026-10-08T10:00:00Z",
        finishedAt: "2026-10-08T10:01:00Z",
      },
    ],
    [
      "b",
      {
        status: "succeeded",
        createdAt: "2026-10-08T10:00:30Z",
        finishedAt: "2026-10-08T10:02:00Z",
      },
    ],
    ["c", { status: "running", createdAt: "2026-10-08T10:03:00Z", finishedAt: null }],
  ] as const);

  it("spans from the first run's start to the last run's finish", () => {
    expect(stepSpan({ runIds: ["a", "b"] }, runs)).toEqual({
      startMs: Date.parse("2026-10-08T10:00:00Z"),
      endMs: Date.parse("2026-10-08T10:02:00Z"),
    });
  });

  it("stays open while any of its runs is still running", () => {
    expect(stepSpan({ runIds: ["a", "c"] }, runs)?.endMs).toBeNull();
  });

  it("has no span when no run is known", () => {
    expect(stepSpan({ runIds: ["missing"] }, runs)).toBeNull();
  });
});

describe("script media and headings", () => {
  it("spans a media element from its opening tag to its closing one", () => {
    const line = 'Says <audio voice="Mia">Hi.</audio> then <video>Chest</video>';
    expect(mediaElementSpans(line)).toEqual([
      { from: 5, to: 35, element: "audio" },
      { from: 41, to: 61, element: "video" },
    ]);
  });

  it("leaves unclosed and self-closing tags as tags only", () => {
    expect(mediaElementSpans("<audio>open <image src='x' />")).toEqual([]);
  });

  it("measures the Scene N part of a heading", () => {
    expect(sceneHeadingPrefix("Scene 2: Getting Started")).toBe("Scene 2: ".length);
    expect(sceneHeadingPrefix("## **Scene 3. Rocks")).toBe("## **Scene 3. ".length);
    expect(sceneHeadingPrefix("Just prose")).toBe(0);
  });
});

describe("rail states", () => {
  const scenes = sceneRanges("Scene 1: Intro\ntext\nScene 2: Getting Started\nmore");

  it("names a scene by the script heading its id's number points at", () => {
    expect(scriptSceneFor("scene-2", scenes)?.title).toBe("Getting Started");
    expect(scriptSceneFor("scene-9", scenes)).toBeUndefined();
    expect(scriptSceneFor("intro", scenes)).toBeUndefined();
  });

  it("says what a closed section waits for", () => {
    const sections = workspaceSections({ hasSpec: true, hasPlan: false, hasModule: false });
    const by = new Map(sections.map((entry) => [entry.key, entry]));
    expect(by.get("speech")?.waitsFor).toBe("plan");
    expect(by.get("deploy")?.waitsFor).toBe("module");
    expect(by.get("description")?.waitsFor).toBeUndefined();
  });

  it("carries trails, titles and prerequisites onto the rows", () => {
    const sections = workspaceSections({ hasSpec: false, hasPlan: false, hasModule: false });
    const nodes = buildStudioTree(
      sections,
      {
        scenes: [{ sceneId: "scene-1", description: "", general: false, categories: [] }],
        unassigned: [],
      },
      { description: { kind: "unsaved" } },
      scenes,
    );
    const by = new Map(nodes.map((node) => [node.id, node]));
    expect(by.get("script")?.trail).toEqual({ kind: "unsaved" });
    expect(by.get("deploy")?.waitsFor).toBe("module");
    expect(by.get("module")?.waitsFor).toBe("spec");
    const scene = by.get("scenes")?.children[0];
    expect(scene?.label).toEqual({ text: "Intro" });
    expect(scene?.sceneNumber).toBe(1);
    expect(scene?.sceneId).toBe("scene-1");
  });

  it("says unsaved before valid, and counts scenes and distinct audios", () => {
    const audio = (key: string) => ({
      key,
      type: "audio" as const,
      occurrences: 1,
      bound: true,
      generated: false,
      shared: false,
      bookWord: false,
    });
    const scenes = {
      scenes: [
        {
          sceneId: "s1",
          description: "",
          general: false,
          categories: [{ type: "audio" as const, assets: [audio("a"), audio("b")] }],
        },
        {
          sceneId: "s2",
          description: "",
          general: false,
          categories: [{ type: "audio" as const, assets: [audio("a")] }],
        },
        { sceneId: "shared", description: "", general: true, categories: [] },
      ],
      unassigned: [],
    };
    const base = { descriptionDirty: false, specDirty: false, mediaDirty: false, scenes };
    expect(sectionTrails({ ...base, draftStatus: "valid" })).toEqual({
      specification: { kind: "valid" },
      scenes: { kind: "count", count: 2 },
      speech: { kind: "count", count: 2 },
    });
    expect(sectionTrails({ ...base, specDirty: true, draftStatus: "valid" }).specification).toEqual(
      {
        kind: "unsaved",
      },
    );
    expect(sectionTrails({ ...base, draftStatus: "draft" }).specification).toBeUndefined();
  });
});

describe("following a run from the header", () => {
  const run = (kind: string) => ({ kind }) as Parameters<typeof runPanel>[0];

  it("opens Stages only while a sequence of stages runs", () => {
    expect(runPanel(run("module"), true)).toBe("run");
    // An Assemble pressed in Build has its transcript in Sessions, not in Stages.
    expect(runPanel(run("module"), false)).toBe("sessions");
  });

  it("sends tests, quality checks and the conversation to their own panels", () => {
    expect(runPanel(run("test"), true)).toBe("tests");
    expect(runPanel(run("quality"), false)).toBe("quality");
    expect(runPanel(run("assist"), false)).toBe("conversation");
  });
});
