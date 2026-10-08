import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, AssetManifest } from "@prismshadow/penguin-server/api";
import { buildSceneTree } from "../src/features/activities/scene-assets";
import { sessionRuns } from "../src/features/activities/sessions-panel";
import {
  assetForPick,
  buildStudioTree,
  isCurrent,
  pathTo,
  phaseOfNode,
  pickCandidates,
  type StudioNode,
} from "../src/features/activities/studio-tree";
import {
  SIDE_PANEL_KEY,
  SIDE_PANEL_MAX_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
  SIDE_PANEL_WORK_MIN,
  readSidePanelExpanded,
  readSidePanelWidth,
  sidePanelWidthAfterKey,
  sidePanelWidthFor,
  writeSidePanelExpanded,
  writeSidePanelWidth,
  readSidePanel,
  sidePanelFitsBeside,
  workspaceSections,
  writeSidePanel,
} from "../src/features/activities/workspace-model";

type MediaAsset = AssetManifest["assets"][string][number];

const usage = (sceneId: string, key: string) => ({
  sceneId,
  sourceKey: key,
  occurrence: 1,
  sceneOccurrenceCount: 1,
});
const asset = (over: Partial<MediaAsset> & Pick<MediaAsset, "key" | "type">): MediaAsset =>
  ({ description: over.key, usages: [], ...over }) as MediaAsset;

const spec = { scenes: [{ id: "scene-1" }, { id: "scene-4" }] };
const assets: MediaAsset[] = [
  asset({
    key: "backdrop",
    type: "video",
    path: "media/v.mp4",
    usages: [usage("scene-4", "backdrop")],
  }),
  asset({ key: "find_P", type: "audio", usages: [usage("scene-4", "find_P")] }),
  asset({ key: "rocks", type: "image", path: "media/r.png", usages: [usage("scene-4", "rocks")] }),
  asset({ key: "lost", type: "audio", usages: [usage("gone", "lost")] }),
];
const full = workspaceSections({ hasSpec: true, hasPlan: true, hasModule: true });
const fresh = workspaceSections({ hasSpec: false, hasPlan: false, hasModule: false });
const tree = buildStudioTree(full, buildSceneTree(spec, assets));

const labels = (nodes: readonly StudioNode[]) =>
  nodes.map((node) => ("text" in node.label ? node.label.text : node.label.key));
const find = (nodes: readonly StudioNode[], id: string): StudioNode | undefined => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const below = find(node.children, id);
    if (below) return below;
  }
  return undefined;
};

describe("studio tree", () => {
  it("keeps Loom's order and names at the top level", () => {
    expect(labels(tree)).toEqual([
      "activityScript",
      "activitySpec",
      "implementationFeatures",
      "scenes",
      "audios",
      "mediaLibrary",
      "moduleDefinition",
      "configurationData",
      "assessmentData",
      "deploy",
      "activityStats",
      "history",
    ]);
  });

  it("orders top-level rows by phase and names each row's phase", () => {
    expect(tree.map((node) => phaseOfNode(node))).toEqual([
      "write",
      "write",
      "write",
      "media",
      "media",
      "media",
      "build",
      "build",
      "build",
      "build",
      "more",
      "more",
    ]);
  });

  it("opens Loom's implementation features whatever else exists", () => {
    const early = buildStudioTree(fresh, buildSceneTree(null, []));
    expect(find(early, "features")!.disabled).toBe(false);
    expect(find(early, "features")!.target).toEqual({ kind: "section", section: "features" });
  });

  it("opens the module's configuration and assessment once there is a module", () => {
    expect(find(tree, "configuration")!.target).toEqual({
      kind: "section",
      section: "configuration",
    });
    expect(find(tree, "assessment")!.disabled).toBe(false);
    const early = buildStudioTree(fresh, buildSceneTree(null, []));
    expect(find(early, "configuration")!.disabled).toBe(true);
    expect(find(early, "assessment")!.disabled).toBe(true);
  });

  it("disables a section row exactly when its workspace section is unavailable", () => {
    const early = buildStudioTree(fresh, buildSceneTree(null, []));
    expect(find(early, "module")!.disabled).toBe(true);
    expect(find(early, "audios")!.disabled).toBe(true);
    expect(find(early, "script")!.disabled).toBe(false);
    expect(find(early, "scenes")!.disabled).toBe(false);
  });

  it("groups a scene's media as Loom does: images, videos, audios", () => {
    const scene = find(tree, "scene:scene-4")!;
    expect(labels(scene.children)).toEqual(["group:image", "group:video", "group:audio"]);
    expect(labels(find(tree, "group:scene-4:audio")!.children)).toEqual(["find_P"]);
  });

  it("drops a scene with no media into no groups, and lists orphans last", () => {
    expect(find(tree, "scene:scene-1")!.children).toEqual([]);
    const scenes = find(tree, "scenes")!.children;
    expect(scenes.at(-1)!.label).toEqual({ key: "unassigned" });
    expect(labels(scenes.at(-1)!.children)).toEqual(["lost"]);
  });

  it("marks unbound media, and carries the mark up to its scene", () => {
    expect(find(tree, "asset:scene-4:find_P")!.mark).toBe("unbound");
    expect(find(tree, "asset:scene-4:rocks")!.mark).toBeNull();
    expect(find(tree, "scene:scene-4")!.mark).toBe("unbound");
    expect(find(tree, "scene:scene-1")!.mark).toBeNull();
  });

  it("makes an asset row current only while the scenes section shows that asset", () => {
    const row = find(tree, "asset:scene-4:find_P")!;
    const selection = { sceneId: "scene-4", key: "find_P" };
    expect(isCurrent(row, "scenes", selection)).toBe(true);
    expect(isCurrent(row, "description", selection)).toBe(false);
    expect(isCurrent(row, "scenes", { sceneId: "scene-4", key: "rocks" })).toBe(false);
    // The Scenes row is the ancestor of an open asset, not the thing on screen.
    expect(isCurrent(find(tree, "scenes")!, "scenes", selection)).toBe(false);
    expect(isCurrent(find(tree, "scenes")!, "scenes", null)).toBe(true);
  });

  it("opens every branch above the current row, and nothing for a top-level one", () => {
    expect(pathTo(tree, "scenes", { sceneId: "scene-4", key: "find_P" })).toEqual([
      "scenes",
      "scene:scene-4",
      "group:scene-4:audio",
    ]);
    expect(pathTo(tree, "description", null)).toEqual([]);
  });
});

describe("picking in the player", () => {
  const scenes = buildSceneTree({ scenes: [{ id: "scene-1" }, { id: "scene-4" }] }, [
    asset({ key: "P", type: "image", usages: [usage("scene-1", "P")] }),
    asset({ key: "p", type: "image", usages: [usage("scene-4", "p")] }),
    asset({
      key: "rock",
      type: "image",
      usages: [usage("scene-1", "rock"), usage("scene-4", "rock")],
    }),
    asset({ key: "lost", type: "audio", usages: [usage("gone", "lost")] }),
  ]);

  it("tries the id, its stem, then the tap target, without repeats", () => {
    expect(pickCandidates({ id: "rock__label", interactableId: "rock" })).toEqual([
      "rock__label",
      "rock",
      "label",
    ]);
    expect(pickCandidates({ id: null, interactableId: "tap__hit" })).toEqual([
      "tap__hit",
      "tap",
      "hit",
    ]);
    // Every id out to the activity, each whole and then in parts.
    expect(
      pickCandidates({
        id: "module-x__rock-2-A__letter",
        ids: ["module-x__rock-2-A__letter", "module-x__rock-2-A", "choices"],
        interactableId: null,
      }),
    ).toEqual([
      "module-x__rock-2-A__letter",
      "module-x",
      "rock-2-A",
      "letter",
      "module-x__rock-2-A",
      "choices",
    ]);
    expect(pickCandidates({ id: null, interactableId: null })).toEqual([]);
  });

  it("opens a label's asset, in the scene the player is in first", () => {
    const pick = { id: "rock__label", interactableId: null };
    expect(assetForPick(scenes, "scene-4", pick)).toEqual({ sceneId: "scene-4", key: "rock" });
    expect(assetForPick(scenes, "scene-1", pick)).toEqual({ sceneId: "scene-1", key: "rock" });
  });

  it("tells P from p, falls back to other scenes and orphans, and gives up quietly", () => {
    expect(assetForPick(scenes, "scene-4", { id: "P", interactableId: null })).toEqual({
      sceneId: "scene-1",
      key: "P",
    });
    expect(assetForPick(scenes, null, { id: "lost", interactableId: null })).toEqual({
      sceneId: "",
      key: "lost",
    });
    expect(
      assetForPick(scenes, "scene-1", { id: "wrapper", interactableId: "nothing" }),
    ).toBeNull();
  });
});

describe("side panel", () => {
  it("sits beside the work only when the editor still fits beside its narrowest width", () => {
    const needed = SIDE_PANEL_WORK_MIN + SIDE_PANEL_MIN_WIDTH;
    expect(sidePanelFitsBeside(needed)).toBe(true);
    expect(sidePanelFitsBeside(needed - 1)).toBe(false);
    // Unmeasured counts as wide, so the first paint is not the covering layout.
    expect(sidePanelFitsBeside(0)).toBe(true);
  });

  it("takes its stored width, short of crushing the editor", () => {
    expect(sidePanelWidthFor(700, 0)).toBe(700);
    expect(sidePanelWidthFor(700, 2000)).toBe(700);
    expect(sidePanelWidthFor(1200, 1400)).toBe(1400 - SIDE_PANEL_WORK_MIN);
    expect(sidePanelWidthFor(1200, 600)).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(sidePanelWidthFor(Number.NaN, 2000)).toBe(480);
    expect(sidePanelWidthFor(99999, 99999)).toBe(SIDE_PANEL_MAX_WIDTH);
  });

  it("moves its divider by keyboard, left widening the panel", () => {
    expect(sidePanelWidthAfterKey(500, "ArrowLeft")).toBe(516);
    expect(sidePanelWidthAfterKey(500, "ArrowRight", true)).toBe(436);
    expect(sidePanelWidthAfterKey(500, "Home")).toBe(SIDE_PANEL_MIN_WIDTH);
    expect(sidePanelWidthAfterKey(500, "End")).toBe(SIDE_PANEL_MAX_WIDTH);
    expect(sidePanelWidthAfterKey(500, "a")).toBeNull();
  });

  it("remembers its width and whether it fills the workspace", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readSidePanelWidth(storage)).toBe(480);
    writeSidePanelWidth(900, storage);
    expect(readSidePanelWidth(storage)).toBe(900);
    expect(readSidePanelExpanded(storage)).toBe(false);
    writeSidePanelExpanded(true, storage);
    expect(readSidePanelExpanded(storage)).toBe(true);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSidePanelWidth(blocked)).toBe(480);
    expect(readSidePanelExpanded(blocked)).toBe(false);
  });

  it("remembers the open panel and ignores anything it does not recognise", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    expect(readSidePanel(storage)).toBeNull();
    writeSidePanel("player", storage);
    expect(readSidePanel(storage)).toBe("player");
    writeSidePanel(null, storage);
    expect(readSidePanel(storage)).toBeNull();
    store.set(SIDE_PANEL_KEY, "terminal");
    expect(readSidePanel(storage)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readSidePanel(broken)).toBeNull();
  });
});

describe("sessions panel", () => {
  const run = (runId: string, createdAt: string, sessionId: string | null) =>
    ({ runId, createdAt, sessionId, kind: "audio", status: "succeeded" }) as ActivityRunSummary;

  it("lists only runs that became a session, newest first", () => {
    const runs = [
      run("a", "2026-09-20T10:00:00Z", "s1"),
      run("b", "2026-09-22T10:00:00Z", null),
      run("c", "2026-09-21T10:00:00Z", "s3"),
    ];
    expect(sessionRuns(runs).map((entry) => entry.runId)).toEqual(["c", "a"]);
  });
});
