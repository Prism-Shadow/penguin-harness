/**
 * Pure model behind the per-scene asset tree. The saved specification owns scene
 * order and the media each scene asks for; the manifest owns what is bound to it.
 * Everything here reads both and produces the tree the workbench renders, so the
 * view holds no derivation of its own.
 */

import type { AssetManifest } from "@prismshadow/penguin-server/api";

type MediaAsset = AssetManifest["assets"][string][number];
export type SceneAssetType = MediaAsset["type"];

/** Categories keep the specification's own order: pictures, then sound, then motion. */
export const SCENE_ASSET_TYPES: readonly SceneAssetType[] = [
  "image",
  "audio",
  "video",
  "animation",
];

export interface SceneAssetLeaf {
  key: string;
  type: SceneAssetType;
  /** How many times this scene asks for the asset; 1 for the ordinary case. */
  occurrences: number;
  bound: boolean;
  /** Bound by an accepted generation run rather than by a path the author chose. */
  generated: boolean;
  /** Referenced by more than one scene, so a rebinding reaches all of them. */
  shared: boolean;
}

export interface SceneAssetCategory {
  type: SceneAssetType;
  assets: SceneAssetLeaf[];
}

export interface SceneAssetNode {
  sceneId: string;
  description: string;
  /** A scene that supplies shared media rather than a step of the activity. */
  general: boolean;
  categories: SceneAssetCategory[];
}

export interface SceneAssetTree {
  scenes: SceneAssetNode[];
  /** Manifest entries no scene references — never hidden, or an author cannot fix them. */
  unassigned: SceneAssetLeaf[];
}

function scenesOf(spec: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  const scenes = spec?.scenes ?? spec?.stages;
  return Array.isArray(scenes)
    ? scenes.filter(
        (scene): scene is Record<string, unknown> =>
          !!scene && typeof scene === "object" && typeof scene.id === "string" && !!scene.id,
      )
    : [];
}

/** A general scene holds media the rest of the activity reuses, so it leads the tree. */
export function isGeneralScene(sceneId: string): boolean {
  return /^general(?:[-_.].*)?$/i.test(sceneId.trim());
}

function leaf(asset: MediaAsset, sceneId: string): SceneAssetLeaf {
  const usages = asset.usages.filter((usage) => usage.sceneId === sceneId);
  return {
    key: asset.key,
    type: asset.type,
    occurrences: usages.length,
    bound: !!asset.path,
    generated: !!asset.generatedAudio || !!asset.generatedImage,
    shared: new Set(asset.usages.map((usage) => usage.sceneId)).size > 1,
  };
}

/**
 * The tree for one language group. Scene order follows the specification, except
 * that general scenes lead, and a scene contributes no category it has no media for.
 */
export function buildSceneTree(
  spec: Record<string, unknown> | null | undefined,
  assets: readonly MediaAsset[],
): SceneAssetTree {
  const scenes = scenesOf(spec);
  const order = new Map(scenes.map((scene, index) => [String(scene.id), index]));
  const nodes: SceneAssetNode[] = scenes.map((scene) => {
    const sceneId = String(scene.id);
    const members = assets.filter((asset) =>
      asset.usages.some((usage) => usage.sceneId === sceneId),
    );
    return {
      sceneId,
      description: typeof scene.description === "string" ? scene.description : "",
      general: isGeneralScene(sceneId),
      categories: SCENE_ASSET_TYPES.map((type) => ({
        type,
        assets: members.filter((asset) => asset.type === type).map((asset) => leaf(asset, sceneId)),
      })).filter((category) => category.assets.length > 0),
    };
  });
  nodes.sort((left, right) => {
    if (left.general !== right.general) return left.general ? -1 : 1;
    return (order.get(left.sceneId) ?? 0) - (order.get(right.sceneId) ?? 0);
  });
  const unassigned = assets
    .filter((asset) => !asset.usages.some((usage) => order.has(usage.sceneId)))
    .map((asset) => ({ ...leaf(asset, ""), occurrences: 0 }));
  return { scenes: nodes, unassigned };
}

/** Every leaf the tree can select, in the order the tree draws them. */
export function treeLeaves(tree: SceneAssetTree): SceneAssetLeaf[] {
  return [
    ...tree.scenes.flatMap((scene) => scene.categories.flatMap((category) => category.assets)),
    ...tree.unassigned,
  ];
}

/**
 * The same leaves addressed the way a selection addresses them. A row is identified by
 * its scene as well as its key, so a selection whose key survived a rebuild under a
 * different scene is not a selection this tree can still draw.
 */
export function treeSelections(tree: SceneAssetTree): { sceneId: string; key: string }[] {
  return [
    ...tree.scenes.flatMap((scene) =>
      scene.categories.flatMap((category) =>
        category.assets.map((asset) => ({ sceneId: scene.sceneId, key: asset.key })),
      ),
    ),
    ...tree.unassigned.map((asset) => ({ sceneId: "", key: asset.key })),
  ];
}

/** Hide categories the type filter excludes, dropping scenes left with nothing. */
export function filterTree(tree: SceneAssetTree, type: SceneAssetType | "all"): SceneAssetTree {
  if (type === "all") return tree;
  return {
    scenes: tree.scenes
      .map((scene) => ({
        ...scene,
        categories: scene.categories.filter((category) => category.type === type),
      }))
      .filter((scene) => scene.categories.length > 0),
    unassigned: tree.unassigned.filter((asset) => asset.type === type),
  };
}

/** The scenes a rebinding would reach, so a shared asset says so before it is edited. */
export function sharedScenes(asset: MediaAsset | undefined): string[] {
  if (!asset) return [];
  return [...new Set(asset.usages.map((usage) => usage.sceneId))].sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Other assets of the same type already pointing at a file, offered so a second
 * scene can share one rather than have its path retyped. Generated bindings are
 * excluded: their path belongs to the run that produced them.
 */
export function reuseCandidates(
  assets: readonly MediaAsset[],
  current: MediaAsset | undefined,
): MediaAsset[] {
  if (!current) return [];
  const general = new Set(
    assets
      .filter((asset) => asset.usages.some((usage) => isGeneralScene(usage.sceneId)))
      .map((asset) => asset.key),
  );
  return assets
    .filter(
      (asset) =>
        asset.key !== current.key &&
        asset.type === current.type &&
        !!asset.path &&
        asset.path !== current.path &&
        !asset.generatedAudio &&
        !asset.generatedImage,
    )
    .sort((left, right) => {
      const lead = Number(general.has(right.key)) - Number(general.has(left.key));
      return lead || left.key.localeCompare(right.key);
    });
}

export type MediaPathProblem = "empty" | "prefix" | "characters" | "segment" | "length";

/**
 * The same rule the server enforces on a manifest path, checked while typing so a
 * rejected save is not the first the author hears of it. Returning the reason
 * rather than a message keeps the copy in the dictionary.
 *
 * The exact stored string is judged, never a tidied copy of it: a check that passes
 * on a value the server will reject is worse than no check, and the editor trims
 * before storing so the two always see the same text.
 */
export function mediaPathProblem(path: string): MediaPathProblem | null {
  if (!path.trim()) return "empty";
  if (path.length > 1024) return "length";
  if (!path.startsWith("media/")) return "prefix";
  if (!/^media\/[A-Za-z0-9_./ -]+$/.test(path)) return "characters";
  if (path.split("/").some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part)))
    return "segment";
  return null;
}

/** How much of a language group is bound, for the tree's summary line. */
export function bindingCounts(assets: readonly MediaAsset[]): { total: number; bound: number } {
  return {
    total: assets.length,
    bound: assets.filter((asset) => !!asset.path).length,
  };
}
