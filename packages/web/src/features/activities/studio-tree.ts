/**
 * The activity hierarchy, in Loom's shape.
 *
 * Loom navigates an activity through one text tree: the script, the documents generated
 * from it, and the scenes with their media grouped by kind. Authors moving over from Loom
 * know where things are by that tree, so the studio keeps its order and its names rather
 * than inventing new ones. Each row either opens a workspace section or selects an asset;
 * a section whose subject does not exist yet stays in the tree, disabled, so the tree never
 * looks like an activity with fewer parts than Loom showed.
 *
 * Pure: the view draws what this returns and holds no derivation of its own, so the tree,
 * the main panel and the tests cannot disagree about what a row does.
 */
import type { SceneAssetSelection } from "./scene-asset-tree";
import type { SceneAssetTree, SceneAssetType } from "./scene-assets";
import { phaseOf, type StudioPhase, type WorkspaceSection, type WorkspaceSectionEntry } from "./workspace-model";

/** What choosing a row does. */
export type StudioTarget =
  | { kind: "section"; section: WorkspaceSection }
  | { kind: "asset"; selection: SceneAssetSelection };

/** The one piece of state a row may carry; the view owns the words and the colour. */
export type StudioMark = "unbound" | null;

export interface StudioNode {
  /** Stable across rebuilds, so open and closed branches survive a refresh. */
  id: string;
  /** A dictionary key for fixed rows, or the activity's own text for scenes and assets. */
  label: { key: StudioLabel } | { text: string };
  /** Absent on a branch that only groups (a scene's "Audios"), which opens instead. */
  target?: StudioTarget;
  disabled: boolean;
  mark: StudioMark;
  children: StudioNode[];
}

/** The fixed rows' names, looked up in the dictionary by the view. */
export type StudioLabel =
  | "activityScript"
  | "activitySpec"
  | "implementationFeatures"
  | "configurationData"
  | "assessmentData"
  | "moduleDefinition"
  | "audios"
  | "scenes"
  | "activityStats"
  | "unassigned"
  | "mediaLibrary"
  | "history"
  | "deploy"
  | `group:${SceneAssetType}`
  | "group:bookWord";

/** Loom lists a scene's media as images, then videos, then audios, then animations. */
const GROUP_ORDER: readonly SceneAssetType[] = ["image", "video", "audio", "animation"];

function sectionRow(
  id: string,
  key: StudioLabel,
  section: WorkspaceSection,
  sections: readonly WorkspaceSectionEntry[],
  children: StudioNode[] = [],
): StudioNode {
  const entry = sections.find((candidate) => candidate.key === section);
  return {
    id,
    label: { key },
    target: { kind: "section", section },
    disabled: !entry?.enabled,
    mark: null,
    children,
  };
}

function assetRow(
  sceneId: string,
  asset: { key: string; bound: boolean; word?: string },
): StudioNode {
  return {
    id: `asset:${sceneId}:${asset.key}`,
    label: { text: asset.word ?? asset.key },
    target: { kind: "asset", selection: { sceneId, key: asset.key } },
    disabled: false,
    mark: asset.bound ? null : "unbound",
    children: [],
  };
}

/** The whole hierarchy, top to bottom, in Loom's order. */
export function buildStudioTree(
  sections: readonly WorkspaceSectionEntry[],
  scenes: SceneAssetTree,
): StudioNode[] {
  const sceneRows: StudioNode[] = scenes.scenes.map((scene) => {
    const groups = GROUP_ORDER.flatMap((type) => {
      const category = scene.categories.find((entry) => entry.type === type);
      // A decodable book's words are audio, but they are the book's, not the scene's own
      // sound, so they get a group of their own after it.
      const own = category?.assets.filter((asset) => !asset.bookWord) ?? [];
      const words = category?.assets.filter((asset) => asset.bookWord) ?? [];
      return [
        ...(own.length
          ? [
              {
                id: `group:${scene.sceneId}:${type}`,
                label: { key: `group:${type}` as const },
                disabled: false,
                mark: null,
                children: own.map((asset) => assetRow(scene.sceneId, asset)),
              } satisfies StudioNode,
            ]
          : []),
        ...(words.length
          ? [
              {
                id: `group:${scene.sceneId}:bookWord`,
                label: { key: "group:bookWord" as const },
                disabled: false,
                mark: null,
                children: words.map((asset) => assetRow(scene.sceneId, asset)),
              } satisfies StudioNode,
            ]
          : []),
      ];
    });
    return {
      id: `scene:${scene.sceneId}`,
      label: { text: scene.sceneId },
      disabled: false,
      // A scene is marked when anything under it is, so a closed scene still says so.
      mark: groups.some((group) => group.children.some((row) => row.mark)) ? "unbound" : null,
      children: groups,
    };
  });
  if (scenes.unassigned.length)
    sceneRows.push({
      id: "scene:",
      label: { key: "unassigned" },
      disabled: false,
      mark: "unbound",
      children: scenes.unassigned.map((asset) => assetRow("", asset)),
    });
  return [
    sectionRow("script", "activityScript", "description", sections),
    sectionRow("spec", "activitySpec", "specification", sections),
    sectionRow("features", "implementationFeatures", "features", sections),
    sectionRow("scenes", "scenes", "scenes", sections, sceneRows),
    sectionRow("audios", "audios", "speech", sections),
    sectionRow("library", "mediaLibrary", "library", sections),
    sectionRow("module", "moduleDefinition", "module", sections),
    sectionRow("configuration", "configurationData", "configuration", sections),
    sectionRow("assessment", "assessmentData", "assessment", sections),
    sectionRow("deploy", "deploy", "deploy", sections),
    sectionRow("stats", "activityStats", "stats", sections),
    sectionRow("history", "history", "history", sections),
  ];
}

/** The phase a top-level row sits under; null for rows that are not sections. */
export function phaseOfNode(node: StudioNode): StudioPhase | null {
  const target = node.target;
  if (!target || target.kind !== "section" || target.section === "newRef") return null;
  return phaseOf(target.section);
}

/** Whether a row is the one the main panel is showing. */
export function isCurrent(
  node: StudioNode,
  section: WorkspaceSection,
  selection: SceneAssetSelection | null,
): boolean {
  const target = node.target;
  if (!target) return false;
  if (target.kind === "asset")
    return (
      section === "scenes" &&
      !!selection &&
      selection.sceneId === target.selection.sceneId &&
      selection.key === target.selection.key
    );
  if (target.kind !== "section") return false;
  // With an asset open the Scenes row is its ancestor, not the thing on screen.
  if (target.section === "scenes") return section === "scenes" && !selection;
  return target.section === section;
}

/**
 * The branches that must be open to show the current row, so a selection made elsewhere
 * (a speech coverage link, a picked element in the player) is never hidden in a closed
 * scene.
 */
export function pathTo(
  nodes: readonly StudioNode[],
  section: WorkspaceSection,
  selection: SceneAssetSelection | null,
): string[] {
  for (const node of nodes) {
    if (isCurrent(node, section, selection)) return [];
    const below = pathTo(node.children, section, selection);
    if (below.length || node.children.some((child) => isCurrent(child, section, selection)))
      return [node.id, ...below];
  }
  return [];
}

/**
 * The ids a picked element could be known by, most specific first. Modules name elements
 * differently: some give a content element its asset key as its id and its label that key
 * plus `__label` (the `waf-element-ids` skill), others namespace every id under the module
 * (`module-x__rock-2-A__letter`). So each id the page reported is tried whole, then each of
 * its `__` parts, and the tap target last.
 */
export function pickCandidates(pick: {
  id: string | null;
  ids?: readonly string[];
  interactableId: string | null;
}): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  const ids = pick.ids?.length ? pick.ids : pick.id ? [pick.id] : [];
  for (const value of [...ids, ...(pick.interactableId ? [pick.interactableId] : [])]) {
    add(value);
    for (const part of value.split("__")) add(part);
  }
  return out;
}

/**
 * The asset a picked element shows, or null when nothing in the hierarchy is named the way
 * it is. The scene the player reports being in is searched first, since a key reused across
 * scenes should open where the author is looking; ids are case-sensitive, because in a
 * letters activity `P` and `p` are different assets.
 */
export function assetForPick(
  scenes: SceneAssetTree,
  sceneId: string | null,
  pick: { id: string | null; ids?: readonly string[]; interactableId: string | null },
): SceneAssetSelection | null {
  const ordered = [
    ...scenes.scenes.filter((scene) => scene.sceneId === sceneId),
    ...scenes.scenes.filter((scene) => scene.sceneId !== sceneId),
  ];
  for (const candidate of pickCandidates(pick)) {
    for (const scene of ordered)
      for (const category of scene.categories)
        if (category.assets.some((asset) => asset.key === candidate))
          return { sceneId: scene.sceneId, key: candidate };
    if (scenes.unassigned.some((asset) => asset.key === candidate))
      return { sceneId: "", key: candidate };
  }
  return null;
}
